// Tests of core/teach.ts (Task 12): teachFromRecordings, retrainLabel. Recordings are built in memory.
// The one folder test reads fixtures/audio/synth/sounds.

import { beforeAll, describe, expect, it } from 'vitest';
import { test as propTest } from '@fast-check/vitest';
import fc from 'fast-check';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { retrainLabel, teachFromRecordings, type Recording } from '../core/teach';
import { teachFromDir } from '../node/teach';
import { readWavFile } from '../node/files';
import { TooFewExamplesError, trainVectors } from '../core/classify/knn';
import { BACKGROUND, HUM_LABEL, MIN_EXAMPLES_PER_LABEL } from '../core/constants';
import { place, rng, synthNoise, synthTone } from '../core/synth';
import { LEAD_MS, TRAIL_MS, TRAIN_SPACING_MS, makeSignal, type Hit, type ImpactName } from './helpers/engine-fixture';
import type { SoundModel } from '../core/types';

// Test-only values.
const SR_HZ = 44100;
const OTHER_SR_HZ = 48000;
const HITS = 6;
const HITS_NEW = 7;
const GAIN_DB = -6;
const NOISE_DB = -30;
const BG_SHORT_MS = 3000;
const BG_LONG_MS = 40000;
const BG_CAP = 200;
const HUM_MS = 2000;
const HUM_FILE_MS = 2500;
const HUM_HZ = 200;
const HUM_NEW_HZ = 300;
const HUM_TOLERANCE_HZ = 3;
const HUM_GAIN_DB = -10;
const SEED_BASE = 1000;
const SEED_STEP = 101;
const KEEP_COUNT = 6;
const KEEP_COUNT_BG = 10;
const WINDOW_SEARCH_LIMIT = 265;
const BASE_COUNT = 8;                 // 3 labels x 2 files, one hum file, one background file
const PROP_BASE_TIMEOUT_MS = 60_000;
const PROP_PER_RUN_MS = 1_500;
const SETUP_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 120_000;
const PBT_RUNS = Number(process.env.PBT_RUNS ?? '100');
const PROP_TIMEOUT_MS = PROP_BASE_TIMEOUT_MS + PBT_RUNS * PROP_PER_RUN_MS;

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function impactRec(label: string, file: string, cls: ImpactName, hits: number, seed: number, sampleRate = SR_HZ): Recording {
  const list: Hit[] = Array.from({ length: hits }, (_, i) => ({ atMs: LEAD_MS + i * TRAIN_SPACING_MS, cls, gainDb: GAIN_DB }));
  const samples = makeSignal({ sampleRate, totalMs: LEAD_MS + hits * TRAIN_SPACING_MS + TRAIL_MS, hits: list, seed });
  return { label, file, samples, sampleRate };
}

function humRec(file: string, hz: number): Recording {
  const tone = synthTone({ f0Hz: hz, durationMs: HUM_MS, gainDb: HUM_GAIN_DB }, SR_HZ);
  return { label: HUM_LABEL, file, samples: place([{ atMs: 0, samples: tone }], HUM_FILE_MS, SR_HZ), sampleRate: SR_HZ };
}

function noiseRec(label: string, file: string, ms: number, seed: number): Recording {
  return { label, file, samples: synthNoise('white', ms, NOISE_DB, SR_HZ, rng(seed)), sampleRate: SR_HZ };
}

const CLASSES: ImpactName[] = ['low', 'mid', 'high'];
let base: Recording[] = [];
let baseModel: SoundModel;
let newMid: Recording[] = [];

beforeAll(() => {
  base = [];
  CLASSES.forEach((cls, c) => {
    for (const [f, file] of ['a.wav', 'b.wav'].entries()) {
      base.push(impactRec(cls, file, cls, HITS, SEED_BASE + c * SEED_STEP + f));
    }
  });
  base.push(humRec('tone.wav', HUM_HZ), noiseRec(BACKGROUND, 'room.wav', BG_SHORT_MS, SEED_BASE));
  if (base.length !== BASE_COUNT) throw new Error('BASE_COUNT is wrong');
  baseModel = teachFromRecordings(base).model;
  newMid = [impactRec('mid', 'new.wav', 'mid', HITS_NEW, SEED_BASE * 3)];
}, SETUP_TIMEOUT_MS);

function snapshot(recs: Recording[]): { label: string; file: string; samples: number[]; sampleRate: number }[] {
  return recs.map((r) => ({ label: r.label, file: r.file, samples: Array.from(r.samples), sampleRate: r.sampleRate }));
}

function hasSamples(x: unknown): boolean {
  if (x instanceof Float32Array) return true;
  if (Array.isArray(x)) return x.some(hasSamples);
  if (x !== null && typeof x === 'object') {
    return Object.entries(x).some(([k, v]) => k === 'samples' || hasSamples(v));
  }
  return false;
}

function idsOf(model: SoundModel, label: string): string[] {
  return model.examples.filter((e) => e.label === label).map((e) => e.id);
}

describe('teachFromRecordings (Task 12)', () => {
  it('gives the same model and report as teachFromDir for a folder (test 1)', async () => {
    const dir = join('fixtures', 'audio', 'synth', 'sounds');
    const recs: Recording[] = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      for (const f of await readdir(join(dir, e.name))) {
        const { samples, sampleRate } = await readWavFile(join(dir, e.name, f));
        recs.push({ label: e.name, file: f, samples, sampleRate });
      }
    }
    const fromDir = await teachFromDir(dir);
    expect(JSON.stringify(teachFromRecordings(recs))).toBe(JSON.stringify(fromDir));
  }, TEST_TIMEOUT_MS);

  it('gives the same result for a reversed and a rotated list (test 2)', () => {
    const ref = teachFromRecordings(base);
    expect(teachFromRecordings([...base].reverse())).toEqual(ref);
    expect(teachFromRecordings([...base.slice(3), ...base.slice(0, 3)])).toEqual(ref);
  }, TEST_TIMEOUT_MS);

  it('does not modify the input array or the recordings (test 3)', () => {
    const list = [...base].reverse();
    const labels = list.map((r) => `${r.label}/${r.file}`);
    const before = snapshot(list);
    teachFromRecordings(list);
    expect(list.map((r) => `${r.label}/${r.file}`)).toEqual(labels);
    expect(snapshot(list)).toEqual(before);
  }, TEST_TIMEOUT_MS);

  it('makes ids and keeps only id, label and v (test 4)', () => {
    const ids = baseModel.examples.map((e) => e.id);
    expect(ids.filter((id) => id.startsWith('low/'))).toSatisfy((l: string[]) => l.length > 0 && l.every((id) => /^low\/[ab]\.wav#\d+$/.test(id)));
    expect(idsOf(baseModel, BACKGROUND).some((id) => /^background\/room\.wav#w\d+$/.test(id))).toBe(true);
    expect(idsOf(baseModel, BACKGROUND).every((id) => /^background\/room\.wav#w?\d+$/.test(id))).toBe(true);
    for (const e of baseModel.examples) expect(Object.keys(e).sort()).toEqual(['id', 'label', 'v']);
    expect(hasSamples(baseModel)).toBe(false);
  });

  it('a hum recording sets the pitch and is not a label (test 5)', () => {
    expect(Math.abs(baseModel.pitch!.baselineHz - HUM_HZ)).toBeLessThan(HUM_TOLERANCE_HZ);
    expect(Object.keys(baseModel.pitch!)).toEqual(['baselineHz']);
    expect(baseModel.examples.some((e) => e.label === HUM_LABEL)).toBe(false);
    const { report } = teachFromRecordings(base.filter((r) => r.label === HUM_LABEL || r.label === 'low'));
    expect(report.labels.map((l) => l.label)).toEqual(['low']);
    // Hum files do not count toward the minimum.
    const humOnly = [humRec('a.wav', HUM_HZ), humRec('b.wav', HUM_HZ)];
    expect(() => teachFromRecordings(humOnly)).toThrow(TooFewExamplesError);
  }, TEST_TIMEOUT_MS);

  it('a noise hum recording warns no-pitch-found and sets no pitch (test 6)', () => {
    const noise = noiseRec(HUM_LABEL, 'noise.wav', HUM_FILE_MS, 3);
    const { model, report } = teachFromRecordings([...base.filter((r) => r.label !== HUM_LABEL), noise]);
    expect(model.pitch).toBeUndefined();
    expect(report.warnings.map((w) => [w.file, w.code])).toEqual([['hum/noise.wav', 'no-pitch-found']]);
  }, TEST_TIMEOUT_MS);

  it('emptyFolders: hum warns, another name counts 0 (test 7)', () => {
    const recs = base.filter((r) => r.label !== HUM_LABEL);
    const { model, report } = teachFromRecordings(recs, { emptyFolders: [HUM_LABEL] });
    expect(model.pitch).toBeUndefined();
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0].file).toBe(HUM_LABEL);
    expect(report.warnings[0].code).toBe('no-pitch-found');
    expect(report.warnings[0].message).toContain('The hum folder has no .wav file');
    let caught: unknown;
    try { teachFromRecordings(recs, { emptyFolders: ['ghost'] }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(TooFewExamplesError);
    expect((caught as TooFewExamplesError).counts.ghost).toBe(0);
  }, TEST_TIMEOUT_MS);

  it('rejects two recordings with the same label and file (test 8)', () => {
    const dup = [...base, { ...base[0] }];
    expect(() => teachFromRecordings(dup)).toThrow(RangeError);
    expect(() => teachFromRecordings(dup)).toThrow(`${base[0].label}/${base[0].file}`);
  });
});

describe('retrainLabel (Task 12)', () => {
  it('leaves the entries of other labels bit for bit (test 9)', () => {
    const { model } = retrainLabel(baseModel, 'mid', newMid);
    const others = (m: SoundModel) => m.examples.filter((e) => e.label !== 'mid');
    expect(others(model)).toEqual(others(baseModel));
    expect(idsOf(model, 'mid').every((id) => id.startsWith('mid/new.wav#'))).toBe(true);
    expect(idsOf(model, 'mid').length).toBeGreaterThanOrEqual(MIN_EXAMPLES_PER_LABEL);
  }, TEST_TIMEOUT_MS);

  it('retrains the whole model like trainVectors (test 10)', () => {
    const { model } = retrainLabel(baseModel, 'mid', newMid);
    const others = baseModel.examples.filter((e) => e.label !== 'mid');
    const newVectors = model.examples.filter((e) => e.label === 'mid');
    const expected = trainVectors([...others, ...newVectors], baseModel.sampleRate);
    const { pitch, ...rest } = model;
    expect(pitch).toEqual(baseModel.pitch);
    expect(rest).toEqual(expected);
    expect(model.mean.some((m, j) => m !== baseModel.mean[j]) || model.std.some((s, j) => s !== baseModel.std[j])).toBe(true);
  }, TEST_TIMEOUT_MS);

  it('reproduces the model from its own recordings (test 11)', () => {
    const own = base.filter((r) => r.label === 'mid');
    expect(retrainLabel(baseModel, 'mid', own).model).toEqual(baseModel);
  }, TEST_TIMEOUT_MS);

  it('keep drops other ids, ignores unknown ids, order and duplicates (test 12)', () => {
    const all = idsOf(retrainLabel(baseModel, 'mid', newMid).model, 'mid');
    const chosen = all.slice(0, KEEP_COUNT);
    const keepA = [...chosen, 'mid/none.wav#0'];
    const keepB = [...chosen].reverse().concat(chosen, 'mid/none.wav#0');
    const a = retrainLabel(baseModel, 'mid', newMid, { keep: keepA }).model;
    const b = retrainLabel(baseModel, 'mid', newMid, { keep: keepB }).model;
    expect(idsOf(a, 'mid')).toEqual([...chosen].sort(cmp));
    expect(b).toEqual(a);
  }, TEST_TIMEOUT_MS);

  it('adds a new label with its own threshold (test 13)', () => {
    const zap = [impactRec('zap', 'z.wav', 'ring', HITS_NEW, SEED_BASE * 5)];
    const { model, report } = retrainLabel(baseModel, 'zap', zap);
    expect(model.thresholds.zap).toBeGreaterThan(0);
    const labels = report.labels.map((l) => l.label);
    expect(labels).toEqual([...labels].sort(cmp));
    expect(labels).toContain('zap');
    expect(labels).not.toContain(HUM_LABEL);
  }, TEST_TIMEOUT_MS);

  it('too few kept examples reject with the counts (test 14)', () => {
    const all = idsOf(retrainLabel(baseModel, 'mid', newMid).model, 'mid');
    const expected = (n: number) => {
      const counts: Record<string, number> = {};
      for (const e of baseModel.examples) if (e.label !== 'mid') counts[e.label] = (counts[e.label] ?? 0) + 1;
      counts.mid = n;
      return counts;
    };
    for (const n of [MIN_EXAMPLES_PER_LABEL - 1, 0]) {
      let caught: unknown;
      try { retrainLabel(baseModel, 'mid', newMid, { keep: all.slice(0, n) }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(TooFewExamplesError);
      expect((caught as TooFewExamplesError).counts).toEqual(expected(n));
    }
  }, TEST_TIMEOUT_MS);

  it('warns about a sample rate mismatch once per recording and still uses it (test 15)', () => {
    const recs = [
      impactRec('mid', 'x48.wav', 'mid', HITS_NEW, SEED_BASE * 7, OTHER_SR_HZ),
      impactRec('mid', 'y48.wav', 'mid', HITS_NEW, SEED_BASE * 8, OTHER_SR_HZ),
      impactRec('mid', 'z44.wav', 'mid', HITS_NEW, SEED_BASE * 9),
    ];
    const { model, report } = retrainLabel(baseModel, 'mid', recs);
    const mism = report.warnings.filter((w) => w.code === 'sample-rate-mismatch');
    expect(mism.map((w) => w.file)).toEqual(['mid/x48.wav', 'mid/y48.wav']);
    expect(mism[0].message).toContain(String(OTHER_SR_HZ));
    expect(mism[0].message).toContain(String(SR_HZ));
    expect(model.sampleRate).toBe(baseModel.sampleRate);
    expect(idsOf(model, 'mid').some((id) => id.startsWith('mid/x48.wav#'))).toBe(true);
  }, TEST_TIMEOUT_MS);

  it('rejects a recording with another label (test 16)', () => {
    const wrong = [impactRec('low', 'w.wav', 'low', HITS, SEED_BASE)];
    expect(() => retrainLabel(baseModel, 'mid', wrong)).toThrow(RangeError);
    expect(() => retrainLabel(baseModel, 'mid', wrong)).toThrow('low/w.wav');
  });

  it('background: windows, cap 200, keep after the cap (test 17)', () => {
    const long = [noiseRec(BACKGROUND, 'long.wav', BG_LONG_MS, SEED_BASE)];
    const capped = idsOf(retrainLabel(baseModel, BACKGROUND, long).model, BACKGROUND);
    expect(capped).toHaveLength(BG_CAP);
    expect(capped.every((id) => id.startsWith('background/long.wav#'))).toBe(true);
    expect(capped.some((id) => id.includes('#w'))).toBe(true);
    const dropped = Array.from({ length: WINDOW_SEARCH_LIMIT }, (_, w) => `background/long.wav#w${w}`).find((id) => !capped.includes(id))!;
    const chosen = capped.slice(0, KEEP_COUNT_BG);
    const { model } = retrainLabel(baseModel, BACKGROUND, long, { keep: [dropped, ...chosen] });
    expect(idsOf(model, BACKGROUND)).toEqual([...chosen].sort(cmp));
  }, TEST_TIMEOUT_MS);

  it('hum: replaces the pitch only, ignores keep, keeps the old pitch on noise (test 18)', () => {
    const { model } = retrainLabel(baseModel, HUM_LABEL, [humRec('new.wav', HUM_NEW_HZ)], { keep: ['nothing'] });
    expect(Math.abs(model.pitch!.baselineHz - HUM_NEW_HZ)).toBeLessThan(HUM_TOLERANCE_HZ);
    expect(model.examples).toEqual(baseModel.examples);
    expect(model.mean).toEqual(baseModel.mean);
    expect(model.std).toEqual(baseModel.std);
    expect(model.thresholds).toEqual(baseModel.thresholds);
    const noisy = retrainLabel(baseModel, HUM_LABEL, [noiseRec(HUM_LABEL, 'noise.wav', HUM_FILE_MS, 3)]);
    expect(noisy.model.pitch).toEqual(baseModel.pitch);
    expect(noisy.report.warnings.map((w) => [w.file, w.code])).toEqual([['hum/noise.wav', 'no-pitch-found']]);
    expect(noisy.report.labels.map((l) => l.label)).not.toContain(HUM_LABEL);
  }, TEST_TIMEOUT_MS);

  it('does not modify the input model and returns no samples (test 19)', () => {
    const copy = structuredClone(baseModel);
    const recsBefore = snapshot(newMid);
    const result = retrainLabel(baseModel, 'mid', newMid);
    expect(baseModel).toEqual(copy);
    expect(snapshot(newMid)).toEqual(recsBefore);
    expect(hasSamples(result)).toBe(false);
    for (const e of result.model.examples) expect(Object.keys(e).sort()).toEqual(['id', 'label', 'v']);
  }, TEST_TIMEOUT_MS);
});

describe('layer rule (Task 12)', () => {
  it('core/teach.ts has no I/O, DOM, clock or randomness (test 20)', async () => {
    const src = await readFile('core/teach.ts', 'utf8');
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(spec.startsWith('./') || spec.startsWith('../')).toBe(true);
    for (const spec of imports) expect(spec).not.toMatch(/^(node:|fs|path)/);
    for (const word of ['document', 'window', 'AudioContext', 'fetch', 'Math.random', 'Date', 'performance']) {
      expect(src, word).not.toMatch(new RegExp(`\\b${word.replace('.', '\\.')}\\b`));
    }
  });
});

describe('order independence', () => {
  let refTeach: ReturnType<typeof teachFromRecordings>;
  let refRetrain: ReturnType<typeof retrainLabel>;
  const midRecs = (): Recording[] => [
    impactRec('mid', 'p.wav', 'mid', HITS, SEED_BASE * 11),
    impactRec('mid', 'q.wav', 'mid', HITS, SEED_BASE * 12),
    impactRec('mid', 'r.wav', 'mid', HITS, SEED_BASE * 13),
  ];
  let mids: Recording[] = [];
  beforeAll(() => {
    mids = midRecs();
    refTeach = teachFromRecordings([...base].sort((a, b) => cmp(a.label, b.label) || cmp(a.file, b.file)));
    refRetrain = retrainLabel(baseModel, 'mid', mids);
  }, SETUP_TIMEOUT_MS);

  // P8 (order independence), extended from examples to whole recordings: Req 2.8.
  propTest.prop([fc.shuffledSubarray(Array.from({ length: BASE_COUNT }, (_, i) => i), { minLength: BASE_COUNT, maxLength: BASE_COUNT })])(
    'teachFromRecordings gives one result for any order of the recordings (Req 2.8)',
    (perm) => {
      expect(teachFromRecordings(perm.map((i) => base[i]))).toEqual(refTeach);
    },
    PROP_TIMEOUT_MS,
  );

  // Same property for retrainLabel (Req 4.5 uses the rules of Req 2.8).
  propTest.prop([fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 })])(
    'retrainLabel gives one result for any order of the recordings (Req 2.8)',
    (perm) => {
      expect(retrainLabel(baseModel, 'mid', perm.map((i) => mids[i]))).toEqual(refRetrain);
    },
    PROP_TIMEOUT_MS,
  );
});
