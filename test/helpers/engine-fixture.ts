// Test helpers for the engine and teach tests. Models are trained through a real Segmenter run.

import { Segmenter } from '../../core/segment';
import { knnClassifier } from '../../core/classify/knn';
import { place, rng, synthImpact, synthNoise, SYNTH_CLASSES } from '../../core/synth';
import { LEVEL_WINDOW_MS } from '../../core/constants';
import type { Segment, SoundModel } from '../../core/types';

export type ImpactName = keyof typeof SYNTH_CLASSES;

// Test-only values.
export const LEAD_MS = 1200;            // first sound starts after the calibration period
export const TRAIN_SPACING_MS = 700;    // more than SEGMENT_MAX_MS of an impact, so training hits never touch
export const TRAIL_MS = 1000;
export const TRAIN_GAIN_DB = -6;
export const TRAIN_PER_CLASS = 10;
const MS_PER_SECOND = 1000;
const DB_POWER_DIVISOR = 10;
const DB_AMPLITUDE_DIVISOR = 20;

export interface Hit { atMs: number; cls: ImpactName; gainDb: number }

const HIT_SEED_STEP = 7919;

// Seed of the clip of hit i in makeSignal, so that a test can measure each clip.
export function hitSeed(seed: number, i: number): number {
  return seed + i * HIT_SEED_STEP;
}

export function impactClip(cls: ImpactName, gainDb: number, sampleRate: number, seed: number): Float32Array {
  return synthImpact({ ...SYNTH_CLASSES[cls], gainDb }, sampleRate, rng(seed));
}

// Impacts on a silent timeline, optional white noise at an RMS level in dBFS, optional clamping.
export function makeSignal(o: {
  sampleRate: number; totalMs: number; hits: Hit[]; seed: number; noiseRmsDb?: number;
}): Float32Array {
  const clips = o.hits.map((h, i) => ({ atMs: h.atMs, samples: impactClip(h.cls, h.gainDb, o.sampleRate, hitSeed(o.seed, i)) }));
  const out = place(clips, o.totalMs, o.sampleRate);
  if (o.noiseRmsDb !== undefined) {
    const noise = synthNoise('white', o.totalMs, o.noiseRmsDb, o.sampleRate, rng(o.seed + 104729));
    for (let i = 0; i < out.length; i++) out[i] += noise[i];
  }
  return out;
}

export function clip(samples: Float32Array): Float32Array {
  return samples.map((x) => Math.max(-1, Math.min(1, x)));
}

// Loudest LEVEL_WINDOW_MS RMS level of a clip in dBFS, stepping by one sample.
export function loudestWindowDb(samples: Float32Array, sampleRate: number): number {
  const w = Math.round((LEVEL_WINDOW_MS * sampleRate) / MS_PER_SECOND);
  let sum = 0;
  let best = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
    if (i >= w) sum -= samples[i - w] * samples[i - w];
    if (i >= w - 1) best = Math.max(best, sum);
  }
  return DB_POWER_DIVISOR * Math.log10(best / w);
}

export function rmsDbOf(samples: Float32Array): number {
  let s = 0;
  for (const x of samples) s += x * x;
  return DB_POWER_DIVISOR * Math.log10(s / samples.length);
}

export function amplitudeToDb(a: number): number {
  return DB_AMPLITUDE_DIVISOR * Math.log10(a);
}

const modelCache = new Map<string, SoundModel>();

// Trains through the real path: Segmenter over TRAIN_PER_CLASS placed impacts per class, then knnClassifier.train.
// `rename` maps a class to another label (for example ring -> background).
export function buildModel(classes: ImpactName[], sampleRate: number, rename: Partial<Record<ImpactName, string>> = {}): SoundModel {
  const key = `${sampleRate}|${classes.join(',')}|${JSON.stringify(rename)}`;
  const cached = modelCache.get(key);
  if (cached) return cached;
  const examples: { id: string; label: string; segment: Segment }[] = [];
  classes.forEach((cls, ci) => {
    const hits: Hit[] = Array.from({ length: TRAIN_PER_CLASS }, (_, i) => ({ atMs: LEAD_MS + i * TRAIN_SPACING_MS, cls, gainDb: TRAIN_GAIN_DB }));
    const signal = makeSignal({ sampleRate, totalMs: LEAD_MS + TRAIN_PER_CLASS * TRAIN_SPACING_MS + TRAIL_MS, hits, seed: 1000 * (ci + 1) });
    const seg = new Segmenter(sampleRate);
    const segments = [...seg.push(signal), ...seg.flush()];
    if (segments.length !== TRAIN_PER_CLASS) throw new Error(`fixture: ${cls} gave ${segments.length} segments`);
    const label = rename[cls] ?? cls;
    segments.forEach((segment, i) => examples.push({ id: `${label}/${cls}.wav#${i}`, label, segment }));
  });
  const model = knnClassifier.train(examples);
  modelCache.set(key, model);
  return model;
}

// Room-noise training (P1, P1b): each example is its own recording of LEAD_MS of white noise, one impact
// at TRAIN_GAIN_DB and TRAIL_MS of noise. The SNR of each example is drawn from [snrMinDb, snrMaxDb] and
// measured as the loudest LEVEL_WINDOW_MS RMS window of the clean impact minus the noise RMS. Seeds start
// at NOISY_TRAIN_SEED_BASE, far from the seeds the tests draw (at most about 1.1e6).
const NOISY_TRAIN_SEED_BASE = 2_000_000;
const NOISY_TRAIN_SEED_STEP = 1009;
const IMPACT_SPAN_MS = 500;

export function buildNoisyModel(classes: ImpactName[], sampleRate: number, snrMinDb: number, snrMaxDb: number): SoundModel {
  const key = `noisy|${sampleRate}|${classes.join(',')}|${snrMinDb}|${snrMaxDb}`;
  const cached = modelCache.get(key);
  if (cached) return cached;
  const draw = rng(NOISY_TRAIN_SEED_BASE + sampleRate);
  const examples: { id: string; label: string; segment: Segment }[] = [];
  classes.forEach((cls, ci) => {
    for (let i = 0; i < TRAIN_PER_CLASS; i++) {
      const seed = NOISY_TRAIN_SEED_BASE + (ci * TRAIN_PER_CLASS + i + 1) * NOISY_TRAIN_SEED_STEP;
      const snrDb = snrMinDb + draw() * (snrMaxDb - snrMinDb);
      const noiseDb = loudestWindowDb(impactClip(cls, TRAIN_GAIN_DB, sampleRate, seed), sampleRate) - snrDb;
      const x = clip(makeSignal({
        sampleRate, totalMs: LEAD_MS + IMPACT_SPAN_MS + TRAIL_MS, seed, noiseRmsDb: noiseDb,
        hits: [{ atMs: LEAD_MS, cls, gainDb: TRAIN_GAIN_DB }],
      }));
      const seg = new Segmenter(sampleRate);
      [...seg.push(x), ...seg.flush()].forEach((segment, n) =>
        examples.push({ id: `${cls}/${i}.wav#${n}`, label: cls, segment }));
    }
  });
  const model = knnClassifier.train(examples);
  modelCache.set(key, model);
  return model;
}