import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSynthFixtures } from '../scripts/make-synth-fixtures';
import { teachFromDir } from '../node/teach';
import { scoreDir } from '../node/score';
import { readWavFile } from '../node/files';
import { Segmenter } from '../core/segment';
import type { SoundModel } from '../core/types';
import {
  BACKGROUND,
  NOISE_FLOOR_WARMUP_MS,
  RECOMMENDED_EXAMPLES_PER_LABEL,
  SYNTH_FIXTURE_LEAD_MARGIN_MS,
  SYNTH_FIXTURE_SAMPLE_RATE_HZ,
} from '../core/constants';
import { removeTempDirs, tempDir } from './helpers/score-fixture';

// Test-only values.
const SYNTH_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'audio', 'synth');
const SIZE_LIMIT_BYTES = 2 * 1024 * 1024;
const MIN_SCORE = 0.9;
const MS_PER_SECOND = 1000;
const LABELS = [BACKGROUND, 'high', 'low', 'mid', 'ring'];
const WAV_CHANNELS_OFFSET = 22;
const WAV_RATE_OFFSET = 24;
const WAV_BITS_OFFSET = 34;
const SLOW_MS = 120000;
const INTEGER_TOLERANCE = 1e-6;

afterEach(removeTempDirs);

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out.sort();
}

const rel = (base: string, files: string[]): string[] => files.map((f) => relative(base, f).split('\\').join('/'));

async function generated(): Promise<{ dir: string; files: string[] }> {
  const dir = await tempDir('tokk-synth-');
  await makeSynthFixtures(dir);
  return { dir, files: await listFiles(dir) };
}

describe('synthetic fixtures generator', () => {
  it('writes byte-identical files in two runs', async () => {
    const a = await generated();
    const b = await generated();
    expect(rel(a.dir, a.files)).toEqual(rel(b.dir, b.files));
    for (const f of rel(a.dir, a.files)) {
      expect(Buffer.compare(await readFile(join(a.dir, f)), await readFile(join(b.dir, f))), f).toBe(0);
    }
  }, SLOW_MS);

  it('writes sounds/<label>/*.wav for five labels and quick/*.wav with a same-name .json', async () => {
    const a = await generated();
    const names = rel(a.dir, a.files);
    const labels = new Set(names.filter((n) => n.startsWith('sounds/')).map((n) => n.split('/')[1]));
    expect([...labels].sort()).toEqual(LABELS);
    const quick = names.filter((n) => n.startsWith('quick/'));
    const wavs = quick.filter((n) => n.endsWith('.wav')).map((n) => n.replace(/\.wav$/, ''));
    const jsons = quick.filter((n) => n.endsWith('.json')).map((n) => n.replace(/\.json$/, ''));
    expect(wavs.length).toBeGreaterThanOrEqual(2);
    expect(jsons).toEqual(wavs);
  }, SLOW_MS);

  it('writes 16-bit mono WAV at the fixture rate, with a quiet lead where no segment opens', async () => {
    const a = await generated();
    const wavs = a.files.filter((f) => f.endsWith('.wav'));
    expect(wavs.length).toBeGreaterThan(0);
    const leadSamples = Math.round(((NOISE_FLOOR_WARMUP_MS + SYNTH_FIXTURE_LEAD_MARGIN_MS) * SYNTH_FIXTURE_SAMPLE_RATE_HZ) / MS_PER_SECOND);
    for (const f of wavs) {
      const bytes = await readFile(f);
      expect(bytes.readUInt16LE(WAV_CHANNELS_OFFSET), f).toBe(1);
      expect(bytes.readUInt32LE(WAV_RATE_OFFSET), f).toBe(SYNTH_FIXTURE_SAMPLE_RATE_HZ);
      expect(bytes.readUInt16LE(WAV_BITS_OFFSET), f).toBe(16);
      const { samples, sampleRate } = await readWavFile(f);
      expect(sampleRate).toBe(SYNTH_FIXTURE_SAMPLE_RATE_HZ);
      const seg = new Segmenter(sampleRate);
      const found = [...seg.push(samples.slice(0, leadSamples))];
      expect(found, f).toEqual([]);
    }
  }, SLOW_MS);

  it('writes label files in the design 8.9 form with t times the rate an integer', async () => {
    const a = await generated();
    const labels = a.files.filter((f) => f.includes('quick') && f.endsWith('.json'));
    for (const f of labels) {
      const j = JSON.parse(await readFile(f, 'utf8'));
      expect(j.device).toBe('synthetic');
      expect(j.room).toBe('none');
      expect(j.sampleRate).toBe(SYNTH_FIXTURE_SAMPLE_RATE_HZ);
      expect(j.events.length).toBeGreaterThan(0);
      const classes = new Set<string>(j.events.map((e: { label: string }) => e.label));
      expect([...classes].sort()).toEqual(['high', 'low', 'mid', 'ring']);
      for (const e of j.events as { label: string; t: number }[]) {
        const samples = e.t * SYNTH_FIXTURE_SAMPLE_RATE_HZ;
        expect(Math.abs(samples - Math.round(samples)), `${f} ${e.t}`).toBeLessThan(INTEGER_TOLERANCE);
      }
    }
  }, SLOW_MS);

  it('stays under the size limit', async () => {
    const a = await generated();
    let total = 0;
    for (const f of a.files) total += (await stat(f)).size;
    expect(total).toBeLessThan(SIZE_LIMIT_BYTES);
  }, SLOW_MS);
});

describe('committed synthetic fixtures', () => {
  it('match a fresh generation byte for byte and the committed folder stays under the size limit', async () => {
    const a = await generated();
    const committed = await listFiles(SYNTH_DIR);
    const committedRel = new Set(rel(SYNTH_DIR, committed));
    for (const f of rel(a.dir, a.files)) {
      expect(committedRel.has(f), `${f} committed`).toBe(true);
      expect(Buffer.compare(await readFile(join(a.dir, f)), await readFile(join(SYNTH_DIR, f))), f).toBe(0);
    }
    const generatedRel = new Set(rel(a.dir, a.files));
    const extra = [...committedRel].filter((f) => !generatedRel.has(f)).sort();
    expect(extra).toEqual(['scores-quick.json', 'sounds.json']);
    let total = 0;
    for (const f of committed) total += (await stat(f)).size;
    expect(total).toBeLessThan(SIZE_LIMIT_BYTES);
  }, SLOW_MS);

  let taught: Awaited<ReturnType<typeof teachFromDir>>;
  beforeAll(async () => {
    taught = await teachFromDir(join(SYNTH_DIR, 'sounds'));
  }, SLOW_MS);

  it('teach gives five labels, no warnings, no confused pair and enough examples per label', () => {
    expect(taught.report.labels.map((l) => l.label)).toEqual(LABELS);
    expect(taught.report.warnings).toEqual([]);
    expect(taught.report.confusedPairs).toEqual([]);
    for (const l of taught.report.labels) expect(l.examples, l.label).toBeGreaterThanOrEqual(RECOMMENDED_EXAMPLES_PER_LABEL);
  });

  it('sounds.json is a model with the five labels and the example ids of a fresh rebuild', async () => {
    const model = JSON.parse(await readFile(join(SYNTH_DIR, 'sounds.json'), 'utf8')) as SoundModel;
    expect(model.version).toBe(1);
    expect([...new Set(model.examples.map((e) => e.label))].sort()).toEqual(LABELS);
    expect(model.examples.map((e) => e.id)).toEqual(taught.model.examples.map((e) => e.id));
    for (const e of model.examples) expect(Object.keys(e).sort()).toEqual(['id', 'label', 'v']);
  });

  it('scores quick at least 0.9 per label with no inCalibration', async () => {
    const model = JSON.parse(await readFile(join(SYNTH_DIR, 'sounds.json'), 'utf8')) as SoundModel;
    const report = await scoreDir(resolve(SYNTH_DIR, 'quick'), model);
    expect(report.perLabel.length).toBe(4);
    for (const l of report.perLabel) {
      expect(l.recall, `${l.label} recall`).toBeGreaterThanOrEqual(MIN_SCORE);
      expect(l.precision, `${l.label} precision`).toBeGreaterThanOrEqual(MIN_SCORE);
    }
    expect(report.inCalibration).toBe(0);
  }, SLOW_MS);
});
