import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { teachFromDir, expectEvents, ExpectEventsError, TooFewExamplesError } from '../node/index';
import { runSamples } from '../core/engine';
import { writeWavFile } from '../node/files';
import { rng, synthNoise, synthTone, place } from '../core/synth';
import {
  BACKGROUND_WINDOW_MS, BACKGROUND_WINDOW_OVERLAP_PERCENT, FEATURE_LENGTH,
} from '../core/constants';
import { LEAD_MS, TRAIL_MS, TRAIN_SPACING_MS, buildModel, makeSignal, type Hit, type ImpactName } from './helpers/engine-fixture';

// Test-only values.
const SR_HZ = 44100;
const PER_CLASS = 10;
const NOISE_DB = -30;
const BG_SHORT_S = 30;
const BG_LONG_S = 120;
const BG_CAP = 200;
const ZERO_START_S = 3;
const ZERO_END_S = 6;
const BG_MIX_TOTAL_S = 9;
const MIN_WINDOWS = 5;
const MS_PER_SECOND = 1000;
const WAV_24_BITS = 24;

let tmp: string[] = [];
afterEach(async () => {
  for (const d of tmp) await rm(d, { recursive: true, force: true });
  tmp = [];
});

async function newDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'tokk-teach-'));
  tmp.push(d);
  return d;
}

function impactSignal(cls: ImpactName, count: number, seed: number, firstMs = LEAD_MS): Float32Array {
  const hits: Hit[] = Array.from({ length: count }, (_, i) => ({ atMs: firstMs + i * TRAIN_SPACING_MS, cls, gainDb: -6 }));
  return makeSignal({ sampleRate: SR_HZ, totalMs: firstMs + count * TRAIN_SPACING_MS + TRAIL_MS, hits, seed });
}

async function putFile(dir: string, label: string, file: string, samples: Float32Array): Promise<void> {
  await mkdir(join(dir, label), { recursive: true });
  await writeWavFile(join(dir, label, file), samples, SR_HZ);
}

async function classDir(classes: ImpactName[]): Promise<string> {
  const dir = await newDir();
  let seed = 100;
  for (const c of classes) await putFile(dir, c, 'a.wav', impactSignal(c, PER_CLASS, (seed += 100)));
  return dir;
}

function wav24(samples: Float32Array): Uint8Array {
  const bytes = WAV_24_BITS / 8;
  const data = samples.length * bytes;
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  tag(0, 'RIFF'); v.setUint32(4, 36 + data, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR_HZ, true); v.setUint32(28, SR_HZ * bytes, true); v.setUint16(32, bytes, true);
  v.setUint16(34, WAV_24_BITS, true); tag(36, 'data'); v.setUint32(40, data, true);
  return b;
}

const winLen = () => Math.round((BACKGROUND_WINDOW_MS * SR_HZ) / MS_PER_SECOND);
const winStep = () => Math.round((winLen() * (100 - BACKGROUND_WINDOW_OVERLAP_PERCENT)) / 100);

describe('teachFromDir examples (Req 8, 12)', () => {
  it('labels from folder names, looAccuracy >= 0.9, no confused pair', async () => {
    const dir = await classDir(['low', 'mid', 'high', 'ring']);
    const { model, report } = await teachFromDir(dir);
    expect(report.labels.map((l) => l.label)).toEqual(['high', 'low', 'mid', 'ring']);
    for (const l of report.labels) {
      expect(l.examples).toBe(PER_CLASS);
      expect(l.looAccuracy).toBeGreaterThanOrEqual(0.9);
    }
    expect(report.confusedPairs).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(Object.keys(model.thresholds).sort()).toEqual(['high', 'low', 'mid', 'ring']);
  });

  it('gives ids label/file#n, holds only id, label and v, and ignores non-wav files and dot folders', async () => {
    const dir = await newDir();
    await putFile(dir, 'low', 'a.wav', impactSignal('low', 3, 1));
    await putFile(dir, 'low', 'B.WAV', impactSignal('low', 4, 2));
    await writeFile(join(dir, 'low', 'notes.txt'), 'x');
    await putFile(dir, '.hidden', 'z.wav', impactSignal('mid', 2, 3));
    await putFile(dir, 'mid', 'a.wav', impactSignal('mid', PER_CLASS, 4));
    const { model } = await teachFromDir(dir);
    const ids = model.examples.map((e) => e.id);
    expect(ids).toContain('low/a.wav#0');
    expect(ids).toContain('low/a.wav#1');
    expect(ids).toContain('low/a.wav#2');
    expect(ids).not.toContain('low/a.wav#3');
    expect(ids).toContain('low/B.WAV#3');
    expect(ids.some((i) => i.startsWith('.hidden'))).toBe(false);
    expect(model.examples).toHaveLength(3 + 4 + PER_CLASS);
    for (const e of model.examples) {
      expect(Object.keys(e).sort()).toEqual(['id', 'label', 'v']);
      expect(e.v).toHaveLength(FEATURE_LENGTH);
    }
  });

  it('rejects with TooFewExamplesError for 4 examples, a silent folder and an empty directory', async () => {
    const dir = await newDir();
    await putFile(dir, 'low', 'a.wav', impactSignal('low', 4, 1));
    await putFile(dir, 'mid', 'a.wav', impactSignal('mid', PER_CLASS, 2));
    await putFile(dir, 'quiet', 'a.wav', new Float32Array(SR_HZ * 3));
    const err = await teachFromDir(dir).catch((e) => e);
    expect(err).toBeInstanceOf(TooFewExamplesError);
    expect(err.counts).toEqual({ low: 4, mid: PER_CLASS, quiet: 0 });

    const empty = await newDir();
    const err2 = await teachFromDir(empty).catch((e) => e);
    expect(err2).toBeInstanceOf(TooFewExamplesError);
    expect(err2.counts).toEqual({});
  });

  it('rejects a missing directory with ENOENT', async () => {
    const dir = await newDir();
    await expect(teachFromDir(join(dir, 'nope'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('classifies its own sound and rejects a far one for a single-label folder', async () => {
    const dir = await classDir(['low']);
    const { model } = await teachFromDir(dir);
    const own = runSamples(impactSignal('low', 1, 999), SR_HZ, model);
    expect(own.events.map((e) => (e.kind === 'sound' ? e.label : ''))).toEqual(['low']);
    const far = runSamples(impactSignal('high', 1, 998), SR_HZ, model);
    expect(far.events).toEqual([]);
    expect(far.unknowns).toHaveLength(1);
  });

  it('rejects a 24-bit file with the path and 16-bit PCM', async () => {
    const dir = await classDir(['low']);
    await writeFile(join(dir, 'low', 'deep.wav'), wav24(new Float32Array(SR_HZ)));
    const err = await teachFromDir(dir).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message.startsWith(join('low', 'deep.wav').split('\\').join('/')) || err.message.startsWith(join('low', 'deep.wav'))).toBe(true);
    expect(err.message).toContain('16-bit PCM');
    expect(err.cause).toBeInstanceOf(Error);
  });

  it('gives equal reports on two runs', async () => {
    const dir = await classDir(['low', 'mid']);
    const a = await teachFromDir(dir);
    const b = await teachFromDir(dir);
    expect(b.report).toEqual(a.report);
    expect(b.model).toEqual(a.model);
  });
});

describe('background (Req 9)', () => {
  async function withBackground(file: Float32Array): Promise<{ dir: string; ids: string[]; warnings: { file: string }[] }> {
    const dir = await classDir(['low']);
    await putFile(dir, 'background', 'noise.wav', file);
    const { model, report } = await teachFromDir(dir);
    return { dir, ids: model.examples.filter((e) => e.label === 'background').map((e) => e.id), warnings: report.warnings };
  }
  const noise = (s: number, seed: number) => synthNoise('white', s * MS_PER_SECOND, NOISE_DB, SR_HZ, rng(seed));

  it('turns 30 s of steady noise into window examples from sample 0, without calibration warnings', async () => {
    const { ids, warnings } = await withBackground(noise(BG_SHORT_S, 1));
    const windows = ids.filter((i) => i.includes('#w'));
    expect(windows.length).toBeGreaterThanOrEqual(MIN_WINDOWS);
    expect(windows).toContain('background/noise.wav#w0');
    expect(warnings.filter((w) => w.file.startsWith('background'))).toEqual([]);
  });

  it('skips an all-zero window', async () => {
    const x = new Float32Array(BG_MIX_TOTAL_S * SR_HZ);
    x.set(noise(ZERO_START_S, 2), 0);
    x.set(noise(BG_MIX_TOTAL_S - ZERO_END_S, 3), ZERO_END_S * SR_HZ);
    const { ids } = await withBackground(x);
    const first = Math.ceil((ZERO_START_S * SR_HZ) / winStep());
    const last = Math.floor((ZERO_END_S * SR_HZ - winLen()) / winStep());
    expect(last).toBeGreaterThan(first);
    for (let j = first; j <= last; j++) expect(ids).not.toContain(`background/noise.wav#w${j}`);
    expect(ids).toContain('background/noise.wav#w0');
  });

  it('keeps exactly 200 evenly spaced candidates for 120 s of noise', async () => {
    const x = noise(BG_LONG_S, 4);
    const { ids } = await withBackground(x);
    const n = Math.floor((x.length - winLen()) / winStep()) + 1;
    expect(ids.every((i) => i.includes('#w'))).toBe(true);
    const expected = Array.from({ length: BG_CAP }, (_, j) => `background/noise.wav#w${Math.floor((j * n) / BG_CAP)}`);
    expect([...ids].sort()).toEqual(expected.sort());
  }, 120_000);
});

describe('warnings (Req 10, 11)', () => {
  async function dirWith(file: string, samples: Float32Array): Promise<string> {
    const dir = await classDir(['low', 'mid']);
    await putFile(dir, 'low', file, samples);
    return dir;
  }
  const warningsOf = async (dir: string, file: string) =>
    (await teachFromDir(dir)).report.warnings.filter((w) => w.file === file).map((w) => w.code);

  it('reports an impact at 300 ms as sound-in-calibration and teaches nothing from it', async () => {
    const dir = await dirWith('early.wav', impactSignal('low', 1, 5, 300));
    const { model, report } = await teachFromDir(dir);
    expect(report.warnings.filter((w) => w.file === 'low/early.wav').map((w) => w.code)).toEqual(['no-sound-found', 'sound-in-calibration']);
    expect(model.examples.some((e) => e.id.startsWith('low/early.wav'))).toBe(false);
    const w = report.warnings.find((x) => x.code === 'sound-in-calibration')!;
    expect(w.message.length).toBeGreaterThan(0);
  });

  it('reports a file shorter than the calibration period', async () => {
    const dir = await dirWith('short.wav', new Float32Array(Math.round(0.8 * SR_HZ)));
    expect(await warningsOf(dir, 'low/short.wav')).toContain('shorter-than-calibration');
  });

  it('reports a file with no sound', async () => {
    const dir = await dirWith('silent.wav', new Float32Array(SR_HZ * 3));
    expect(await warningsOf(dir, 'low/silent.wav')).toEqual(['no-sound-found']);
  });

  it('gives no warning for an impact at 1050 ms', async () => {
    const dir = await dirWith('late.wav', impactSignal('low', 1, 6, 1050));
    expect(await warningsOf(dir, 'low/late.wav')).toEqual([]);
  });

  it('sorts warnings by file, then code', async () => {
    const dir = await dirWith('early.wav', impactSignal('low', 1, 5, 300));
    await putFile(dir, 'mid', 'silent.wav', new Float32Array(SR_HZ * 3));
    const { warnings } = (await teachFromDir(dir)).report;
    expect(warnings.length).toBeGreaterThanOrEqual(3);
    const cmp = [...warnings].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    expect(warnings).toEqual(cmp);
  });

});

describe('expectEvents (Req 13)', () => {
  const m = () => buildModel(['low', 'high'], SR_HZ);
  async function file(hits: Hit[]): Promise<string> {
    const dir = await newDir();
    const path = join(dir, 'x.wav');
    await writeWavFile(path, makeSignal({ sampleRate: SR_HZ, totalMs: LEAD_MS + 5000, hits, seed: 9 }), SR_HZ);
    return path;
  }
  const lowHigh: Hit[] = [{ atMs: LEAD_MS, cls: 'low', gainDb: -6 }, { atMs: LEAD_MS + 1500, cls: 'high', gainDb: -6 }];

  it('passes for matching labels', async () => {
    await expect(expectEvents(await file(lowHigh), ['low', 'high'], { sounds: m() })).resolves.toBeUndefined();
  });

  it('rejects with expected and actual and shows both lists', async () => {
    const err = await expectEvents(await file(lowHigh), ['low'], { sounds: m() }).catch((e) => e);
    expect(err).toBeInstanceOf(ExpectEventsError);
    expect(err.expected).toEqual(['low']);
    expect(err.actual).toEqual(['low', 'high']);
    expect(err.message).toContain('[low]');
    expect(err.message).toContain('[low, high]');
  });

  it('names unknown sounds and does not fail for an unexpected unknown alone', async () => {
    const dir = await newDir();
    const path = join(dir, 'u.wav');
    const x = makeSignal({ sampleRate: SR_HZ, totalMs: LEAD_MS + 5000, hits: [lowHigh[0]], seed: 9 });
    const tone = synthTone({ f0Hz: 800, durationMs: 300, gainDb: -6 }, SR_HZ);
    x.set(tone, Math.round(((LEAD_MS + 2000) * SR_HZ) / MS_PER_SECOND));
    await writeWavFile(path, x, SR_HZ);
    await expect(expectEvents(path, ['low'], { sounds: m() })).resolves.toBeUndefined();
    const err = await expectEvents(path, ['low', 'low'], { sounds: m() }).catch((e) => e);
    expect(err).toBeInstanceOf(ExpectEventsError);
    expect(err.message).toContain('unknown');
  });

  it('rejects an unsupported file unchanged', async () => {
    const dir = await newDir();
    const path = join(dir, 'deep.wav');
    await writeFile(path, wav24(new Float32Array(SR_HZ)));
    const err = await expectEvents(path, [], { sounds: m() }).catch((e) => e);
    expect(err).not.toBeInstanceOf(ExpectEventsError);
    expect(err.message).toContain('16-bit PCM');
  });
});

describe('hum teaching (Task 6)', () => {
  const HUM_MS = 2000;
  const HUM_FILE_MS = 2500;
  const HUM_A_HZ = 200;
  const HUM_B_HZ = 210;
  const HUM_TOLERANCE_HZ = 3;
  const HUM_GAIN_DB = -10;
  const humFile = (hz: number) => place([{ atMs: 0, samples: synthTone({ f0Hz: hz, durationMs: HUM_MS, gainDb: HUM_GAIN_DB }, SR_HZ) }], HUM_FILE_MS, SR_HZ);

  it('the hum folder sets pitch.baselineHz near the tone frequency', async () => {
    const dir = await classDir(['low', 'mid']);
    await putFile(dir, 'hum', 'a.wav', humFile(HUM_A_HZ));
    await putFile(dir, 'hum', 'b.wav', humFile(HUM_B_HZ));
    const { model, report } = await teachFromDir(dir);
    expect(Math.abs(model.pitch!.baselineHz - (HUM_A_HZ + HUM_B_HZ) / 2)).toBeLessThan(HUM_TOLERANCE_HZ);
    expect(report.warnings).toEqual([]);
    expect(report.labels.map((l) => l.label)).not.toContain('hum');
    expect(report.confusedPairs.some((p) => p.a === 'hum' || p.b === 'hum')).toBe(false);
    expect(model.examples.some((e) => e.label === 'hum')).toBe(false);
    expect(Object.keys(model.pitch!)).toEqual(['baselineHz']);
  });

  it('warns with no-pitch-found for a hum file of noise and sets no pitch', async () => {
    const dir = await classDir(['low', 'mid']);
    await putFile(dir, 'hum', 'noise.wav', synthNoise('white', HUM_FILE_MS, NOISE_DB, SR_HZ, rng(3)));
    const { model, report } = await teachFromDir(dir);
    expect(model.pitch).toBeUndefined();
    expect(report.warnings.map((w) => [w.file, w.code])).toEqual([['hum/noise.wav', 'no-pitch-found']]);
    expect(report.warnings[0].message).toContain('2 s');
  });

  it('warns for the file without a hum and uses the others', async () => {
    const dir = await classDir(['low', 'mid']);
    await putFile(dir, 'hum', 'a.wav', humFile(HUM_A_HZ));
    await putFile(dir, 'hum', 'noise.wav', synthNoise('white', HUM_FILE_MS, NOISE_DB, SR_HZ, rng(3)));
    const { model, report } = await teachFromDir(dir);
    expect(Math.abs(model.pitch!.baselineHz - HUM_A_HZ)).toBeLessThan(HUM_TOLERANCE_HZ);
    expect(report.warnings.map((w) => [w.file, w.code])).toEqual([['hum/noise.wav', 'no-pitch-found']]);
  });

  it('names the hum folder when it holds no file', async () => {
    const dir = await classDir(['low', 'mid']);
    await mkdir(join(dir, 'hum'), { recursive: true });
    const { model, report } = await teachFromDir(dir);
    expect(model.pitch).toBeUndefined();
    expect(report.warnings.map((w) => [w.file, w.code])).toEqual([['hum', 'no-pitch-found']]);
  });

  it('does not count the hum folder toward the minimum', async () => {
    const dir = await classDir(['low', 'mid']);
    await putFile(dir, 'hum', 'a.wav', humFile(HUM_A_HZ));
    await expect(teachFromDir(dir)).resolves.toBeDefined();
    const dir2 = await newDir();
    await putFile(dir2, 'hum', 'a.wav', humFile(HUM_A_HZ));
    await expect(teachFromDir(dir2)).rejects.toBeInstanceOf(TooFewExamplesError);
  });

  it('builds an engine with hum.rise from the taught model', async () => {
    const dir = await classDir(['low', 'mid']);
    await putFile(dir, 'hum', 'a.wav', humFile(HUM_A_HZ));
    const { model } = await teachFromDir(dir);
    expect(() => runSamples(new Float32Array(SR_HZ), SR_HZ, model, ['hum.rise'])).not.toThrow();
  });
});
