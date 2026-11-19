import { describe, it, expect, beforeAll } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { readFileSync } from 'node:fs';
import { knnClassifier, trainVectors, classifyVector, TooFewExamplesError, BACKGROUND } from '../core/classify/knn';
import { extractFeatures } from '../core/features';
import { rng, synthImpact, synthNoise, synthTone, SYNTH_CLASSES } from '../core/synth';
import {
  BACKGROUND_MAX_EXAMPLES,
  BACKGROUND_WINDOW_MS,
  DISTANCE_THRESHOLD_FACTOR,
  FEATURE_LENGTH,
  KNN_K,
  MIN_EXAMPLES_PER_LABEL,
  STD_FLOOR_ABSOLUTE,
} from '../core/constants';
import type { ClassifyResult, Segment, SoundModel } from '../core/types';

// Test-only values. The engine never reads these, so they stay out of core/constants.ts.
const TEST_SAMPLE_RATE_HZ = 44100;
const OTHER_SAMPLE_RATE_HZ = 48000;
const LOW_SAMPLE_RATE_HZ = 16000;
const TRAIN_SEED_BASE = 1000;
const HELDOUT_SEED_BASE = 900000;
const BACKGROUND_TRAIN_SEED_BASE = 5000000;
const BACKGROUND_HELDOUT_SEED_BASE = 7000000;
const TRAIN_GAIN_DB = -6;
const TRAIN_PER_CLASS = 10;
const HELDOUT_PER_CLASS = 20;
const POOL_SEEDS_PER_CLASS = 40;
const BACKGROUND_HELDOUT_COUNT = 40;
const BACKGROUND_GAIN_MIN_DB = -50;
const BACKGROUND_GAIN_RANGE_DB = 30;
const BACKGROUND_TONE_EVERY = 4;
const BACKGROUND_TONE_BASE_HZ = 100;
const BACKGROUND_TONE_SPAN_HZ = 700;
const ACCURACY_MIN = 0.95;
const BACKGROUND_REJECT_MIN = 0.9;
const BACKGROUND_COST_MAX = 0.05;
const TRAIN_TIME_MAX_MS = 500;
const TIMING_EXAMPLES = 240;
const TIMING_LABELS = 4;
const MS_PER_SECOND = 1000;
const EPS = 1e-9;

// Property test timeouts grow with PBT_RUNS.
const PBT_RUNS = Number(process.env.PBT_RUNS ?? '100');
const P7_MS_PER_RUN = 1000;
const P_MS_PER_RUN = 200;
const TIMEOUT_FLOOR_MS = 60_000;
const SETUP_TIMEOUT_MS = 120_000;

type ClassName = keyof typeof SYNTH_CLASSES;
const CLASS_NAMES = Object.keys(SYNTH_CLASSES) as ClassName[];

interface Pooled {
  id: string;
  label: string;
  v: number[];
  segment: Segment;
}

function toSegment(samples: Float32Array, sampleRate: number): Segment {
  return { t: 0, durationMs: (samples.length * MS_PER_SECOND) / sampleRate, samples, sampleRate };
}

function impactSegment(cls: ClassName, seed: number, gainDb: number, sampleRate: number): Segment {
  const samples = synthImpact({ ...SYNTH_CLASSES[cls], gainDb }, sampleRate, rng(seed));
  return toSegment(samples, sampleRate);
}

function pooled(label: string, seed: number, segment: Segment): Pooled {
  return { id: `${label}/${seed}#0`, label, v: extractFeatures(segment), segment };
}

// Background window i: soft tone for every fourth window, otherwise white or pink noise (not impacts).
function backgroundSegment(index: number, seed: number): Segment {
  const rand = rng(seed);
  const gainDb = BACKGROUND_GAIN_MIN_DB + rand() * BACKGROUND_GAIN_RANGE_DB;
  if (index % BACKGROUND_TONE_EVERY === BACKGROUND_TONE_EVERY - 1) {
    const f0Hz = BACKGROUND_TONE_BASE_HZ + rand() * BACKGROUND_TONE_SPAN_HZ;
    return toSegment(synthTone({ f0Hz, durationMs: BACKGROUND_WINDOW_MS, gainDb }, TEST_SAMPLE_RATE_HZ), TEST_SAMPLE_RATE_HZ);
  }
  const kind = index % 2 === 0 ? 'white' : 'pink';
  return toSegment(synthNoise(kind, BACKGROUND_WINDOW_MS, gainDb, TEST_SAMPLE_RATE_HZ, rand), TEST_SAMPLE_RATE_HZ);
}

const trainPool = {} as Record<ClassName, Pooled[]>;
const heldoutPool = {} as Record<ClassName, Pooled[]>;
let backgroundTrain: Pooled[] = [];
let backgroundHeldout: Pooled[] = [];

beforeAll(() => {
  for (const cls of CLASS_NAMES) {
    trainPool[cls] = [];
    heldoutPool[cls] = [];
    for (let i = 0; i < POOL_SEEDS_PER_CLASS; i++) {
      const seed = TRAIN_SEED_BASE + i;
      trainPool[cls].push(pooled(cls, seed, impactSegment(cls, seed, TRAIN_GAIN_DB, TEST_SAMPLE_RATE_HZ)));
    }
    for (let i = 0; i < HELDOUT_PER_CLASS; i++) {
      const seed = HELDOUT_SEED_BASE + i;
      heldoutPool[cls].push(pooled(cls, seed, impactSegment(cls, seed, TRAIN_GAIN_DB, TEST_SAMPLE_RATE_HZ)));
    }
  }
  backgroundTrain = [];
  for (let i = 0; i < BACKGROUND_MAX_EXAMPLES; i++) {
    const seed = BACKGROUND_TRAIN_SEED_BASE + i;
    backgroundTrain.push(pooled(BACKGROUND, seed, backgroundSegment(i, seed)));
  }
  backgroundHeldout = [];
  for (let i = 0; i < BACKGROUND_HELDOUT_COUNT; i++) {
    const seed = BACKGROUND_HELDOUT_SEED_BASE + i;
    backgroundHeldout.push(pooled(BACKGROUND, seed, backgroundSegment(i, seed)));
  }
}, SETUP_TIMEOUT_MS);

// Helpers

function trainingSet(classes: readonly ClassName[], perClass: number): Pooled[] {
  return classes.flatMap((c) => trainPool[c].slice(0, perClass));
}

function allHeldout(): Pooled[] {
  return CLASS_NAMES.flatMap((c) => heldoutPool[c]);
}

function vectorsOf(list: Pooled[]): { id: string; label: string; v: number[] }[] {
  return list.map(({ id, label, v }) => ({ id, label, v }));
}

function fraction(list: Pooled[], model: SoundModel): number {
  let ok = 0;
  for (const p of list) {
    const r = classifyVector(model, p.v);
    if (r.kind === 'match' && r.label === p.label) ok++;
  }
  return ok / list.length;
}

// One-dimensional model. ids are `<label>/<index>#0`, in the order given.
function oneDim(entries: [string, number[]][]): { id: string; label: string; v: number[] }[] {
  return entries.flatMap(([label, values]) =>
    values.map((x, i) => ({ id: `${label}/${String(i).padStart(3, '0')}#0`, label, v: [x] })),
  );
}

function fiveAt(label: string, first: number, rest: number[]): [string, number[]] {
  return [label, [first, ...rest]];
}

// A model written by hand: mean 0 and std 1, so a standardized value equals the raw value exactly.
function handModel(entries: [string, number[]][], thresholds: Record<string, number>): SoundModel {
  return {
    version: 1,
    k: KNN_K,
    sampleRate: TEST_SAMPLE_RATE_HZ,
    mean: [0],
    std: [1],
    examples: oneDim(entries),
    thresholds,
  };
}

function popStd(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const ss = values.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  return Math.sqrt(ss / values.length);
}

function requireMatch(r: ClassifyResult): Extract<ClassifyResult, { kind: 'match' }> {
  if (r.kind !== 'match') throw new Error(`expected match, got unknown (nearest ${r.nearest.id})`);
  return r;
}

describe('knn classifier', () => {
  // Training and classification with real sounds

  it('classifies held-out examples of 4 synth classes with at least 95 % accuracy (10 train, 20 test per class, other seeds) (Req 5.1)', () => {
    const model = knnClassifier.train(trainingSet(CLASS_NAMES, TRAIN_PER_CLASS).map(({ id, label, segment }) => ({ id, label, segment })));
    let ok = 0;
    const held = allHeldout();
    for (const p of held) {
      const r = knnClassifier.classify(model, p.segment);
      if (r.kind === 'match' && r.label === p.label) ok++;
    }
    const accuracy = ok / held.length;
    expect(accuracy).toBeGreaterThanOrEqual(ACCURACY_MIN);
    expect(model.version).toBe(1);
    expect(model.k).toBe(KNN_K);
    expect(model.pitch).toBeUndefined();
    expect(model.mean).toHaveLength(FEATURE_LENGTH);
    expect(model.std).toHaveLength(FEATURE_LENGTH);
  });

  it('throws TooFewExamplesError listing counts when a label has 4 examples (Req 2.1, 2.2)', () => {
    const list = oneDim([['clap', [1, 2, 3, 4]], ['knock', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]]]);
    let error: unknown;
    try {
      trainVectors(list, TEST_SAMPLE_RATE_HZ);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TooFewExamplesError);
    const err = error as TooFewExamplesError;
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TooFewExamplesError');
    expect(err.counts).toEqual({ clap: 4, knock: 12 });
    expect(err.message).toBe('Too few examples (minimum 5): clap 4 (too few), knock 12');
  });

  it('the error message marks labels below 5 and lists labels alphabetically; a background label with 4 examples also throws; an empty list throws with {} (Req 2.2, 2.3)', () => {
    const list = oneDim([
      ['zeta', [1, 2, 3, 4, 5]],
      ['alpha', [1, 2, 3]],
      ['mid', [1, 2, 3, 4]],
    ]);
    expect(() => trainVectors(list, TEST_SAMPLE_RATE_HZ)).toThrow('Too few examples (minimum 5): alpha 3 (too few), mid 4 (too few), zeta 5');

    const withBackground = oneDim([['a', [1, 2, 3, 4, 5]], [BACKGROUND, [1, 2, 3, 4]]]);
    expect(() => trainVectors(withBackground, TEST_SAMPLE_RATE_HZ)).toThrow(TooFewExamplesError);

    let error: unknown;
    try {
      trainVectors([], TEST_SAMPLE_RATE_HZ);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TooFewExamplesError);
    expect((error as TooFewExamplesError).counts).toEqual({});
    expect(() => knnClassifier.train([])).toThrow(TooFewExamplesError);
  });

  it('trains with exactly 5 examples per label (Req 2.4)', () => {
    const model = trainVectors(oneDim([['a', [0, 1, 2, 3, 4]], ['b', [10, 11, 12, 13, 14]]]), TEST_SAMPLE_RATE_HZ);
    expect(model.examples).toHaveLength(2 * MIN_EXAMPLES_PER_LABEL);
    expect(Object.keys(model.thresholds).sort()).toEqual(['a', 'b']);
  });

  it('a single-label model classifies its own sound and rejects a far one as unknown (a different synth class, and a tone) (Req 2.4, 5.5)', () => {
    const model = knnClassifier.train(trainingSet(['low'], TRAIN_PER_CLASS).map(({ id, label, segment }) => ({ id, label, segment })));
    const own = knnClassifier.classify(model, heldoutPool.low[0].segment);
    expect(own.kind).toBe('match');
    const other = knnClassifier.classify(model, heldoutPool.high[0].segment);
    expect(other.kind).toBe('unknown');
    const tone = toSegment(synthTone({ f0Hz: 440, durationMs: 600, gainDb: -6 }, TEST_SAMPLE_RATE_HZ), TEST_SAMPLE_RATE_HZ);
    expect(knnClassifier.classify(model, tone).kind).toBe('unknown');
  });

  it('model JSON round-trips through JSON.stringify and parse with identical results on all held-out segments (Req 8.1)', () => {
    const model = knnClassifier.train(trainingSet(CLASS_NAMES, TRAIN_PER_CLASS).map(({ id, label, segment }) => ({ id, label, segment })));
    const copy = JSON.parse(JSON.stringify(model)) as SoundModel;
    expect(copy).toEqual(model);
    for (const p of allHeldout()) {
      expect(knnClassifier.classify(copy, p.segment)).toEqual(knnClassifier.classify(model, p.segment));
    }
  });

  it('model has no samples: examples have exactly the keys id, label, v; no NaN or Infinity; no Float32Array anywhere (Req 8.2, 8.3)', () => {
    const model = knnClassifier.train(trainingSet(CLASS_NAMES, MIN_EXAMPLES_PER_LABEL).map(({ id, label, segment }) => ({ id, label, segment })));
    for (const e of model.examples) {
      expect(Object.keys(e).sort()).toEqual(['id', 'label', 'v']);
      expect(Array.isArray(e.v)).toBe(true);
      expect(e.v).toHaveLength(FEATURE_LENGTH);
    }
    const seen: unknown[] = [];
    const walk = (x: unknown): void => {
      seen.push(x);
      if (x !== null && typeof x === 'object') {
        expect(ArrayBuffer.isView(x)).toBe(false);
        for (const [k, child] of Object.entries(x)) {
          expect(k).not.toBe('samples');
          walk(child);
        }
      }
    };
    walk(model);
    for (const x of seen) {
      if (typeof x === 'number') expect(Number.isFinite(x)).toBe(true);
    }
    expect(JSON.stringify(model)).not.toContain('null');
  });

  // Standardization

  it('a dimension that is constant in training does not make a slightly different example unknown (std equals 0.01, standardized offset 0.5) (Req 3.4, 3.2)', () => {
    const list = [0, 1, 2, 3, 4].map((x, i) => ({ id: `a/${i}#0`, label: 'a', v: [x, 1] }));
    const model = trainVectors(list, TEST_SAMPLE_RATE_HZ);
    expect(model.std[1]).toBe(STD_FLOOR_ABSOLUTE);
    const r = classifyVector(model, [2, 1 + STD_FLOOR_ABSOLUTE / 2]);
    const m = requireMatch(r);
    expect(m.nearest.distance).toBeCloseTo(0.5, 9);
    expect(Number.isFinite(m.confidence)).toBe(true);
  });

  it('std floor: range 10 with raw std 0.2 gives 0.5; range 0.1 with raw std 0.001 gives 0.01; range 10 with raw std 3 stays 3 (Req 3.2)', () => {
    // a: n values, two at the extremes, the rest in the middle: raw variance = 2 x (range/2)^2 / n.
    const withExtremes = (low: number, high: number, n: number): number[] => {
      const mid = (low + high) / 2;
      return [low, high, ...new Array<number>(n - 2).fill(mid)];
    };
    const build = (values: number[]) =>
      trainVectors(values.map((x, i) => ({ id: `a/${String(i).padStart(5, '0')}#0`, label: 'a', v: [x] })), TEST_SAMPLE_RATE_HZ);

    const a = withExtremes(0, 10, 1250);
    expect(popStd(a)).toBeCloseTo(0.2, 9);
    expect(build(a).std[0]).toBeCloseTo(0.5, 12);

    const b = withExtremes(0, 0.1, 5000);
    expect(popStd(b)).toBeCloseTo(0.001, 9);
    expect(build(b).std[0]).toBe(STD_FLOOR_ABSOLUTE);

    const c = [0, 10, ...new Array<number>(1248).fill(0).map((_, i) => (i % 2 === 0 ? 2 : 8))];
    const rawC = popStd(c);
    expect(rawC).toBeGreaterThan(2.9);
    expect(rawC).toBeLessThan(3.1);
    expect(build(c).std[0]).toBeCloseTo(rawC, 12);
  });

  it('mean and std use the population formula (dimension values 1, 2, 3, 4, 5 give raw std sqrt(2)) (Req 3.1)', () => {
    const model = trainVectors(oneDim([['a', [1, 2, 3, 4, 5]]]), TEST_SAMPLE_RATE_HZ);
    expect(model.mean[0]).toBe(3);
    expect(model.std[0]).toBeCloseTo(Math.SQRT2, 12);
  });

  it('classify returns the id of the nearest training example, and nearest equals the brute-force nearest from model.examples (Req 5.7, 1.4)', () => {
    const train = trainingSet(CLASS_NAMES, TRAIN_PER_CLASS);
    const model = knnClassifier.train(train.map(({ id, label, segment }) => ({ id, label, segment })));
    const own = knnClassifier.classify(model, train[3].segment);
    expect(own.nearest.id).toBe(train[3].id);
    expect(own.nearest.distance).toBe(0);

    for (const p of allHeldout().slice(0, 12)) {
      const r = knnClassifier.classify(model, p.segment);
      const z = p.v.map((x, j) => (x - model.mean[j]) / model.std[j]);
      let best = { id: '', label: '', distance: Infinity };
      for (const e of model.examples) {
        let s = 0;
        for (let j = 0; j < z.length; j++) {
          const dz = z[j] - (e.v[j] - model.mean[j]) / model.std[j];
          s += dz * dz;
        }
        const distance = Math.sqrt(s);
        if (distance < best.distance) best = { id: e.id, label: e.label, distance };
      }
      expect(r.nearest.id).toBe(best.id);
      expect(r.nearest.label).toBe(best.label);
      expect(r.nearest.distance).toBeCloseTo(best.distance, 9);
    }
  });

  // Thresholds

  it('threshold equals 1.5 x the 95th percentile (type 7) of the LOO distances: 0, 1, 2, 3, 10 gives raw 8.7 (Req 4.1, 4.2, 4.3)', () => {
    const model = trainVectors(oneDim([['a', [0, 1, 2, 3, 10]]]), TEST_SAMPLE_RATE_HZ);
    expect(model.std[0]).toBeCloseTo(Math.sqrt(12.56), 12);
    // LOO raw distances 1, 1, 1, 1, 7. Percentile: 1 + 0.8 x (7 - 1) = 5.8.
    expect(model.thresholds.a * model.std[0]).toBeCloseTo(5.8 * DISTANCE_THRESHOLD_FACTOR, 9);
    expect(model.thresholds.a * model.std[0]).toBeCloseTo(8.7, 9);
  });

  it('LOO ignores other labels: a close example of another label does not shrink the threshold (Req 4.1)', () => {
    const model = trainVectors(
      oneDim([['a', [0, 1, 2, 3, 10]], ['b', [0.01, 1.01, 2.01, 3.01, 10.01]]]),
      TEST_SAMPLE_RATE_HZ,
    );
    expect(model.thresholds.a * model.std[0]).toBeCloseTo(8.7, 9);
    expect(model.thresholds.b * model.std[0]).toBeCloseTo(8.7, 9);
  });

  it('identical examples give threshold 0, no throw; a query equal to them is a match with confidence 1; a different query is unknown (Req 4.5, 5.6)', () => {
    const model = trainVectors(oneDim([['a', [3, 3, 3, 3, 3]]]), TEST_SAMPLE_RATE_HZ);
    expect(model.thresholds.a).toBe(0);
    const same = requireMatch(classifyVector(model, [3]));
    expect(same.confidence).toBe(1);
    expect(classifyVector(model, [3.001]).kind).toBe('unknown');
  });

  // Vote, tie, unknown, confidence

  it('majority 2-1 beats the nearest example of the minority label, and nearest still names the minority example (Req 5.2, 5.7)', () => {
    const model = trainVectors(
      oneDim([['a', [2, 4, 6, 8, 10]], ['b', [0, -10, -11, -12, -13]]]),
      TEST_SAMPLE_RATE_HZ,
    );
    const r = requireMatch(classifyVector(model, [0.5]));
    expect(r.label).toBe('a');
    expect(r.nearest.label).toBe('b');
    expect(r.nearest.id).toBe('b/000#0');
  });

  it('a vector identical to a stored example takes the label of that example even when two neighbours of another label outvote it (Req 5.10)', () => {
    // a/000 sits at 0 with two b examples at distance 1. Five a examples, 5 b examples, one of them next to it.
    const model = handModel([fiveAt('a', 0, [20, 21, 22, 23]), fiveAt('b', 1, [-1, 40, 41, 42])], { a: 30, b: 30 });
    const r = requireMatch(classifyVector(model, [0]));
    expect(r.label).toBe('a');
    expect(r.confidence).toBe(1);
    expect(requireMatch(classifyVector(model, [0.1])).label).toBe('b');
  });

  it('a vote winner beyond its own threshold gives way to the next label within its own threshold (Req 5.11)', () => {
    // The P1 situation: ring examples at 6 and 8 outvote a high example at 7. ring's threshold (3) rejects
    // the query at 0, high's own threshold (10) accepts it, so the result is high, with high's distance.
    const model = handModel([['ring', [6, 8, 50, 51, 52]], ['high', [7, 60, 61, 62, 63]]], { ring: 3, high: 10 });
    const r = requireMatch(classifyVector(model, [0]));
    expect(r.label).toBe('high');
    expect(r.confidence).toBeCloseTo(0.3, 12);
    expect(r.nearest.id).toBe('ring/000#0');
    // When no label among the k nearest passes its own threshold, the result is unknown.
    const strict = handModel([['ring', [6, 8, 50, 51, 52]], ['high', [7, 60, 61, 62, 63]]], { ring: 3, high: 5 });
    expect(classifyVector(strict, [0]).kind).toBe('unknown');
  });
  it('1-1-1 tie goes to the label of the nearest example (Req 5.3)', () => {
    const model = trainVectors(
      oneDim([
        ['a', [3, 20, 21, 22, 23]],
        ['b', [-2, -20, -21, -22, -23]],
        ['c', [1, 30, 31, 32, 33]],
      ]),
      TEST_SAMPLE_RATE_HZ,
    );
    const r = requireMatch(classifyVector(model, [0]));
    expect(r.label).toBe('c');
    expect(r.nearest.id).toBe('c/000#0');
  });

  it('equal distances order by id (two examples of different labels at the same distance) (Req 5.4)', () => {
    // b is listed first in the input; a/000#0 has the smaller id and the same vector as b/000#0.
    const model = trainVectors(
      oneDim([
        ['b', [1, 20, 21, 22, 23]],
        ['c', [3, 30, 31, 32, 33]],
        ['a', [1, -20, -21, -22, -23]],
      ]),
      TEST_SAMPLE_RATE_HZ,
    );
    const r = requireMatch(classifyVector(model, [0]));
    expect(r.nearest.id).toBe('a/000#0');
    expect(r.label).toBe('a');
  });

  it('unknown just above the threshold, match with confidence 0 at exactly the threshold, each side uses the winner\'s threshold (Req 5.5, 5.6)', () => {
    const near = [1, 2, 3, 4];
    const far = [101, 102, 103, 104];
    const model = handModel([fiveAt('a', 0, near), fiveAt('b', 100, far)], { a: 3, b: 10 });

    // Nearest example of a is at 4, so a query at 7 is exactly 3 away.
    const atEdge = requireMatch(classifyVector(model, [7]));
    expect(atEdge.label).toBe('a');
    expect(atEdge.confidence).toBe(0);
    expect(classifyVector(model, [7 + EPS]).kind).toBe('unknown');

    // 8 is within b's threshold (10) but beyond a's (3): a wins the vote, so the result is unknown.
    expect(classifyVector(model, [8]).kind).toBe('unknown');
    // 95 is beyond a's threshold from a, but b wins and its distance 5 is within 10.
    const b = requireMatch(classifyVector(model, [95]));
    expect(b.label).toBe('b');
    expect(b.confidence).toBeCloseTo(0.5, 12);
  });

  it('confidence is 1 at distance 0, 0.5 at half the threshold, and never below 0 (Req 5.6)', () => {
    const model = handModel([fiveAt('a', 0, [1, 2, 3, 4])], { a: 4 });
    expect(requireMatch(classifyVector(model, [0])).confidence).toBe(1);
    expect(requireMatch(classifyVector(model, [-2])).confidence).toBe(0.5);
    for (const q of [-4, -3.999, -1, 0, 6, 8]) {
      const r = classifyVector(model, [q]);
      if (r.kind === 'match') {
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it('background as winner is returned as a match with label background; far from everything is unknown (Req 5.8)', () => {
    const model = trainVectors(
      oneDim([['a', [0, 1, 2, 3, 4]], [BACKGROUND, [50, 51, 52, 53, 54]]]),
      TEST_SAMPLE_RATE_HZ,
    );
    const r = requireMatch(classifyVector(model, [54.5]));
    expect(r.label).toBe(BACKGROUND);
    expect(classifyVector(model, [1000]).kind).toBe('unknown');
  });

  // Model fields

  it('model.sampleRate is the sample rate of the first example in the input order, and the model is otherwise unchanged by the order (Req 7.3, 1.2)', () => {
    const base = trainingSet(['low', 'mid'], MIN_EXAMPLES_PER_LABEL).map(({ id, label, segment }) => ({ id, label, segment }));
    const odd = {
      id: 'low/odd#0',
      label: 'low',
      segment: impactSegment('low', TRAIN_SEED_BASE + POOL_SEEDS_PER_CLASS, TRAIN_GAIN_DB, OTHER_SAMPLE_RATE_HZ),
    };
    const forward = [...base, odd];
    const m1 = knnClassifier.train(forward);
    const m2 = knnClassifier.train([...forward].reverse());
    expect(m1.sampleRate).toBe(TEST_SAMPLE_RATE_HZ);
    expect(m2.sampleRate).toBe(OTHER_SAMPLE_RATE_HZ);
    expect({ ...m1, sampleRate: 0 }).toEqual({ ...m2, sampleRate: 0 });
  });

  it('statistics exclude background: adding 200 background examples leaves mean, std and the real labels\' thresholds unchanged; with only background labels, statistics use all examples (Req 3.5, 3.6, 6.1)', () => {
    const real = vectorsOf(trainingSet(CLASS_NAMES, TRAIN_PER_CLASS));
    const without = trainVectors(real, TEST_SAMPLE_RATE_HZ);
    const withBg = trainVectors([...real, ...vectorsOf(backgroundTrain)], TEST_SAMPLE_RATE_HZ);
    expect(withBg.mean).toEqual(without.mean);
    expect(withBg.std).toEqual(without.std);
    for (const c of CLASS_NAMES) expect(withBg.thresholds[c]).toBe(without.thresholds[c]);
    expect(withBg.thresholds[BACKGROUND]).toBeGreaterThan(0);
    expect(withBg.examples).toHaveLength(real.length + backgroundTrain.length);

    const onlyBg = trainVectors(oneDim([[BACKGROUND, [1, 2, 3, 4, 5]]]), TEST_SAMPLE_RATE_HZ);
    expect(onlyBg.mean[0]).toBe(3);
    expect(onlyBg.std[0]).toBeCloseTo(Math.SQRT2, 12);
  });

  it('a segment at another sample rate than the model\'s is classified without error (Req 5.9)', () => {
    const model = knnClassifier.train(trainingSet(CLASS_NAMES, TRAIN_PER_CLASS).map(({ id, label, segment }) => ({ id, label, segment })));
    for (const rate of [OTHER_SAMPLE_RATE_HZ, LOW_SAMPLE_RATE_HZ]) {
      const r = knnClassifier.classify(model, impactSegment('mid', HELDOUT_SEED_BASE, TRAIN_GAIN_DB, rate));
      expect(Number.isFinite(r.nearest.distance)).toBe(true);
    }
  });

  it('duplicate ids throw RangeError; vectors of different length or with NaN throw RangeError; a query vector of the wrong length throws RangeError (Req 2.5, 2.6)', () => {
    const ok = oneDim([['a', [0, 1, 2, 3, 4]]]);
    const dup = ok.map((e, i) => (i === 4 ? { ...e, id: ok[0].id } : e));
    expect(() => trainVectors(dup, TEST_SAMPLE_RATE_HZ)).toThrow(RangeError);
    expect(() => trainVectors(dup, TEST_SAMPLE_RATE_HZ)).toThrow(ok[0].id);

    const ragged = ok.map((e, i) => (i === 2 ? { ...e, v: [1, 2] } : e));
    expect(() => trainVectors(ragged, TEST_SAMPLE_RATE_HZ)).toThrow(RangeError);
    for (const bad of [NaN, Infinity, -Infinity]) {
      const nonFinite = ok.map((e, i) => (i === 1 ? { ...e, v: [bad] } : e));
      expect(() => trainVectors(nonFinite, TEST_SAMPLE_RATE_HZ)).toThrow(RangeError);
    }

    const model = trainVectors(ok, TEST_SAMPLE_RATE_HZ);
    expect(() => classifyVector(model, [1, 2])).toThrow(RangeError);
  });

  // Review item 11: dense background examples

  it('10 examples per label plus 200 background examples still classify held-out examples of the real labels at >= 95 % (Req 6.3)', () => {
    const real = vectorsOf(trainingSet(CLASS_NAMES, TRAIN_PER_CLASS));
    const model = trainVectors([...real, ...vectorsOf(backgroundTrain)], TEST_SAMPLE_RATE_HZ);
    const accuracy = fraction(allHeldout(), model);
    expect(accuracy).toBeGreaterThanOrEqual(ACCURACY_MIN);
  });

  it('the background model is not more than 5 points worse than the model without background; held-out background windows are not classified as a real label in at least 90 % (Req 6.4, 6.5)', () => {
    const real = vectorsOf(trainingSet(CLASS_NAMES, TRAIN_PER_CLASS));
    const plain = trainVectors(real, TEST_SAMPLE_RATE_HZ);
    const dense = trainVectors([...real, ...vectorsOf(backgroundTrain)], TEST_SAMPLE_RATE_HZ);
    const plainAccuracy = fraction(allHeldout(), plain);
    const denseAccuracy = fraction(allHeldout(), dense);
    let notReal = 0;
    for (const p of backgroundHeldout) {
      const r = classifyVector(dense, p.v);
      if (r.kind === 'unknown' || r.label === BACKGROUND) notReal++;
    }
    const rejected = notReal / backgroundHeldout.length;
    expect(plainAccuracy).toBeGreaterThanOrEqual(ACCURACY_MIN);
    expect(denseAccuracy).toBeGreaterThanOrEqual(plainAccuracy - BACKGROUND_COST_MAX);
    expect(rejected).toBeGreaterThanOrEqual(BACKGROUND_REJECT_MIN);
  });

  // Speed and layer rule

  it('trainVectors for 240 examples of 32 dimensions takes under 500 ms (Req 11.4)', () => {
    const rand = rng(TRAIN_SEED_BASE);
    const list = Array.from({ length: TIMING_EXAMPLES }, (_, i) => ({
      id: `l${i % TIMING_LABELS}/${String(i).padStart(4, '0')}#0`,
      label: `l${i % TIMING_LABELS}`,
      v: Array.from({ length: FEATURE_LENGTH }, () => rand()),
    }));
    const start = performance.now();
    trainVectors(list, TEST_SAMPLE_RATE_HZ);
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(TRAIN_TIME_MAX_MS);
  });

  it('the source of core/classify/knn.ts has no forbidden import, Math.random, fetch, Date or performance (Req 11.1, 8.4)', () => {
    const source = readFileSync(new URL('../core/classify/knn.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const specifiers = [...code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const s of specifiers) expect(s.startsWith('.')).toBe(true);
    const forbidden = [
      /Math\.random/,
      /\bfetch\b/,
      /XMLHttpRequest/,
      /WebSocket/,
      /\bDate\b/,
      /\bperformance\b/,
      /\bdocument\b/,
      /\bwindow\b/,
      /AudioContext/,
      /\brequire\s*\(/,
      /\bprocess\b/,
    ];
    for (const re of forbidden) expect(code).not.toMatch(re);
  });
});

// Property tests (P6, P7, P8). Run count comes from test/setup.ts (PBT_RUNS).

const classSubset = fc.shuffledSubarray(CLASS_NAMES, { minLength: 2, maxLength: 4 });

// A full-length shuffle of every (class, seed) slot of the pool, then filtered by the chosen classes and counts.
const POOL_SLOTS = CLASS_NAMES.length * HELDOUT_PER_CLASS;
const slotOrder = fc.shuffledSubarray(
  Array.from({ length: POOL_SLOTS }, (_, i) => i),
  { minLength: POOL_SLOTS, maxLength: POOL_SLOTS },
);
const perClassCounts = fc.array(fc.integer({ min: MIN_EXAMPLES_PER_LABEL, max: HELDOUT_PER_CLASS }), {
  minLength: CLASS_NAMES.length,
  maxLength: CLASS_NAMES.length,
});

function pickShuffled(classes: ClassName[], counts: number[], order: number[]): Pooled[] {
  const picked: Pooled[] = [];
  for (const slot of order) {
    const cls = CLASS_NAMES[Math.floor(slot / HELDOUT_PER_CLASS)];
    const seedIndex = slot % HELDOUT_PER_CLASS;
    if (classes.includes(cls) && seedIndex < counts[CLASS_NAMES.indexOf(cls)]) picked.push(trainPool[cls][seedIndex]);
  }
  return picked;
}

describe('property tests', () => {
  // P6 (Req 9.1): every training example classifies as its own label, id, and distance 0.
  test.prop([classSubset, perClassCounts, slotOrder])(
    'P6 self-consistency: every training example classifies as its own label (Req 9.1)',
    (classes, counts, order) => {
      const list = pickShuffled(classes, counts, order);
      const model = trainVectors(vectorsOf(list), TEST_SAMPLE_RATE_HZ);
      for (const p of list) {
        const r = classifyVector(model, p.v);
        expect(r.kind).toBe('match');
        if (r.kind === 'match') expect(r.label).toBe(p.label);
        expect(r.nearest.id).toBe(p.id);
        expect(r.nearest.distance).toBe(0);
      }
    },
    Math.max(TIMEOUT_FLOOR_MS, PBT_RUNS * P_MS_PER_RUN),
  );

  // P7 (Req 10.1): a synth tone is unknown to a model of impact classes only.
  test.prop(
    [
      classSubset,
      fc.integer({ min: 100, max: 800 }),
      fc.integer({ min: 300, max: 1500 }),
      fc.integer({ min: -20, max: 0 }),
      fc.constantFrom(0, 30),
    ],
  )(
    'P7 a synth tone is unknown to an impact-only model (Req 10.1)',
    (classes, f0Hz, durationMs, gainDb, vibratoCents) => {
      const train = trainingSet(classes, TRAIN_PER_CLASS);
      const model = knnClassifier.train(train.map(({ id, label, segment }) => ({ id, label, segment })));
      const tone = toSegment(synthTone({ f0Hz, durationMs, gainDb, vibratoCents }, TEST_SAMPLE_RATE_HZ), TEST_SAMPLE_RATE_HZ);
      const r = knnClassifier.classify(model, tone);
      expect(r.kind).toBe('unknown');
      expect(Number.isFinite(r.nearest.distance)).toBe(true);
    },
    Math.max(TIMEOUT_FLOOR_MS, PBT_RUNS * P7_MS_PER_RUN),
  );

  // P8 (Req 7.2, 7.4): the order of the training examples changes neither the model nor any result.
  test.prop([classSubset, perClassCounts, slotOrder, slotOrder])(
    'P8 shuffling training examples does not change the model or any classification (Req 7.2, 7.4)',
    (classes, counts, orderA, orderB) => {
      const modelA = trainVectors(vectorsOf(pickShuffled(classes, counts, orderA)), TEST_SAMPLE_RATE_HZ);
      const modelB = trainVectors(vectorsOf(pickShuffled(classes, counts, orderB)), TEST_SAMPLE_RATE_HZ);
      expect(modelB).toEqual(modelA);
      for (const p of allHeldout()) {
        expect(classifyVector(modelB, p.v)).toEqual(classifyVector(modelA, p.v));
      }
    },
    Math.max(TIMEOUT_FLOOR_MS, PBT_RUNS * P_MS_PER_RUN),
  );
});


describe('trainVectors minimum count option (Task 8, Req 16.4)', () => {
  function fourPerLabel(): { id: string; label: string; v: number[] }[] {
    const out: { id: string; label: string; v: number[] }[] = [];
    for (const [label, base] of [['aa', 0], ['bb', 10]] as const) {
      for (let i = 0; i < 4; i++) out.push({ id: `${label}/f#${i}`, label, v: Array.from({ length: FEATURE_LENGTH }, (_, j) => base + i * 0.1 + j * 0.01) });
    }
    return out;
  }

  it('throws with 4 examples per label by default and trains with minExamplesPerLabel 4', () => {
    expect(() => trainVectors(fourPerLabel(), TEST_SAMPLE_RATE_HZ)).toThrow(TooFewExamplesError);
    const model = trainVectors(fourPerLabel(), TEST_SAMPLE_RATE_HZ, { minExamplesPerLabel: 4 });
    expect(model.examples).toHaveLength(8);
  });
});
