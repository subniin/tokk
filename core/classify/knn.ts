// k-nearest-neighbour classifier with unknown rejection (design: Task 5).
// Pure TypeScript: no I/O, DOM, Web Audio, network, clock or randomness. It stores feature vectors only.

import {
  BACKGROUND,
  DISTANCE_THRESHOLD_FACTOR,
  KNN_K,
  MIN_EXAMPLES_PER_LABEL,
  STD_FLOOR_ABSOLUTE,
  STD_FLOOR_RANGE_FRACTION,
  THRESHOLD_PERCENTILE,
} from '../constants';
import { extractFeatures } from '../features';
import type { Classifier, ClassifyResult, Nearest, Segment, SoundModel } from '../types';

export { BACKGROUND } from '../constants';

const PERCENT_DIVISOR = 100;

interface VectorExample {
  id: string;
  label: string;
  v: number[];
}

export class TooFewExamplesError extends Error {
  readonly counts: Record<string, number>;

  constructor(counts: Record<string, number>) {
    const parts = Object.keys(counts)
      .sort(compareStrings)
      .map((label) => `${label} ${counts[label]}${counts[label] < MIN_EXAMPLES_PER_LABEL ? ' (too few)' : ''}`);
    super(`Too few examples (minimum ${MIN_EXAMPLES_PER_LABEL}): ${parts.join(', ')}`);
    this.name = 'TooFewExamplesError';
    this.counts = counts;
  }
}

// Plain code-unit comparison, independent of the locale.
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function countLabels(examples: VectorExample[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const e of examples) counts.set(e.label, (counts.get(e.label) ?? 0) + 1);
  return Object.fromEntries(counts);
}

// Percentile with linear interpolation between order statistics (type 7). `sorted` is ascending and not empty.
function percentile(sorted: number[], percent: number): number {
  const r = (percent / PERCENT_DIVISOR) * (sorted.length - 1);
  const lo = Math.floor(r);
  const hi = Math.ceil(r);
  return sorted[lo] + (r - lo) * (sorted[hi] - sorted[lo]);
}

function distance(a: number[], b: number[]): number {
  let sum = 0;
  for (let j = 0; j < a.length; j++) {
    const d = a[j] - b[j];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function standardize(v: number[], mean: number[], std: number[]): number[] {
  const z = new Array<number>(v.length);
  for (let j = 0; j < v.length; j++) z[j] = (v[j] - mean[j]) / std[j];
  return z;
}

export function trainVectors(examples: VectorExample[], sampleRate: number): SoundModel {
  // 1. Counts first, so the error never depends on the vector contents.
  const counts = countLabels(examples);
  const labels = Object.keys(counts);
  if (labels.length === 0 || labels.some((l) => counts[l] < MIN_EXAMPLES_PER_LABEL)) {
    throw new TooFewExamplesError(counts);
  }

  // 2. Sort by id so that every following sum runs in the same order for any input order.
  const sorted = [...examples].sort((a, b) => compareStrings(a.id, b.id));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].id === sorted[i - 1].id) throw new RangeError(`Duplicate example id: ${sorted[i].id}`);
  }
  const dims = sorted[0].v.length;
  for (const e of sorted) {
    if (e.v.length !== dims) {
      throw new RangeError(`Example ${e.id} has ${e.v.length} values, expected ${dims}.`);
    }
    for (const x of e.v) {
      if (!Number.isFinite(x)) throw new RangeError(`Example ${e.id} has a value that is not finite.`);
    }
  }

  // 3. Statistics set: examples that are not background (all of them if there are no others).
  const real = sorted.filter((e) => e.label !== BACKGROUND);
  const stats = real.length > 0 ? real : sorted;
  const n = stats.length;
  const mean = new Array<number>(dims).fill(0);
  const std = new Array<number>(dims).fill(0);
  for (let j = 0; j < dims; j++) {
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const e of stats) {
      sum += e.v[j];
      min = Math.min(min, e.v[j]);
      max = Math.max(max, e.v[j]);
    }
    mean[j] = sum / n;
    let squares = 0;
    for (const e of stats) squares += (e.v[j] - mean[j]) * (e.v[j] - mean[j]);
    const rawStd = Math.sqrt(squares / n);
    const floor = Math.max(STD_FLOOR_RANGE_FRACTION * (max - min), STD_FLOOR_ABSOLUTE);
    std[j] = Math.max(rawStd, floor);
  }

  // 4. Leave-one-out nearest same-label distance, each same-label pair computed once.
  const z = sorted.map((e) => standardize(e.v, mean, std));
  const nearestSame = new Array<number>(sorted.length).fill(Infinity);
  for (let i = 0; i < sorted.length; i++) {
    for (let k = i + 1; k < sorted.length; k++) {
      if (sorted[i].label !== sorted[k].label) continue;
      const d = distance(z[i], z[k]);
      if (d < nearestSame[i]) nearestSame[i] = d;
      if (d < nearestSame[k]) nearestSame[k] = d;
    }
  }

  // 5. One threshold per label.
  const thresholds = new Map<string, number>();
  for (const label of labels.sort(compareStrings)) {
    const loo: number[] = [];
    for (let i = 0; i < sorted.length; i++) if (sorted[i].label === label) loo.push(nearestSame[i]);
    loo.sort((a, b) => a - b);
    thresholds.set(label, percentile(loo, THRESHOLD_PERCENTILE) * DISTANCE_THRESHOLD_FACTOR);
  }

  return {
    version: 1,
    k: KNN_K,
    sampleRate,
    mean,
    std,
    examples: sorted.map((e) => ({ id: e.id, label: e.label, v: [...e.v] })),
    thresholds: Object.fromEntries(thresholds),
  };
}

function confidenceOf(d: number, threshold: number): number {
  return threshold > 0 ? Math.max(0, 1 - d / threshold) : 1;
}

export function classifyVector(model: SoundModel, v: number[]): ClassifyResult {
  if (v.length !== model.mean.length) {
    throw new RangeError(`Feature vector has ${v.length} values, the model expects ${model.mean.length}.`);
  }
  const z = standardize(v, model.mean, model.std);
  const ranked = model.examples.map((e) => ({
    id: e.id,
    label: e.label,
    distance: distance(z, standardize(e.v, model.mean, model.std)),
  }));
  ranked.sort((a, b) => a.distance - b.distance || compareStrings(a.id, b.id));

  const take = Math.min(model.k, ranked.length);
  const votes = new Map<string, number>();
  for (let i = 0; i < take; i++) votes.set(ranked[i].label, (votes.get(ranked[i].label) ?? 0) + 1);
  const mostVotes = Math.max(...votes.values());
  // The first of the nearest examples whose label has the most votes decides a tie.
  // A vector identical to a stored example takes that example's label, whatever its neighbours vote.
  const exact = ranked[0].distance === 0;
  const winner = exact ? ranked[0].label : ranked.find((r) => votes.get(r.label) === mostVotes)!.label;

  const nearest: Nearest = { id: ranked[0].id, label: ranked[0].label, distance: ranked[0].distance };
  const d = ranked.find((r) => r.label === winner)!.distance;
  const threshold = model.thresholds[winner];
  if (d > threshold) return { kind: 'unknown', nearest };
  return { kind: 'match', label: winner, confidence: confidenceOf(d, threshold), nearest };
}

export const knnClassifier: Classifier = {
  train(examples: { id: string; label: string; segment: Segment }[]): SoundModel {
    const sampleRate = examples.length > 0 ? examples[0].segment.sampleRate : 0;
    return trainVectors(
      examples.map((e) => ({ id: e.id, label: e.label, v: extractFeatures(e.segment) })),
      sampleRate,
    );
  },
  classify(model: SoundModel, segment: Segment): ClassifyResult {
    return classifyVector(model, extractFeatures(segment));
  },
};
