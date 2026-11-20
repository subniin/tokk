// Teaching rules (Task 12): turns recordings into a SoundModel and a self-check report, and replaces
// the examples of one label (retrainLabel). Pure TypeScript: no file system, DOM, network, clock or
// randomness. A Recording holds samples in the caller's memory only. The model and the report hold
// feature vectors and numbers only, never a sample.

import { classifyVector, knnClassifier, trainVectors, TooFewExamplesError } from './classify/knn';
import {
  BACKGROUND,
  BACKGROUND_MAX_EXAMPLES,
  BACKGROUND_WINDOW_MS,
  BACKGROUND_WINDOW_OVERLAP_PERCENT,
  CONFUSED_PAIR_MIN_RATE,
  HUM_LABEL,
  LOO_MIN_EXAMPLES_PER_LABEL,
  MIN_EXAMPLES_PER_LABEL,
  NOISE_FLOOR_WARMUP_MS,
} from './constants';
import { medianPitchHz } from './continuous/pitch';
import { extractFeatures } from './features';
import { Segmenter } from './segment';
import type { Segment, SoundModel } from './types';

const MS_PER_SECOND = 1000;
const PERCENT = 100;

export type Recording = { label: string; file: string; samples: Float32Array; sampleRate: number };

export type TeachWarning = {
  file: string;
  code: 'shorter-than-calibration' | 'sound-in-calibration' | 'no-sound-found' | 'no-pitch-found' | 'sample-rate-mismatch';
  message: string;
};

export type TeachReport = {
  labels: { label: string; examples: number; looAccuracy: number }[];
  confusedPairs: { a: string; b: string; rate: number }[];
  warnings: TeachWarning[];
};

interface Example { id: string; label: string; segment: Segment }
interface Candidate { start: number; isWindow: boolean; example: Example }

// Plain code-unit comparison, independent of the locale.
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function segmentsOf(samples: Float32Array, sampleRate: number): Segment[] {
  const s = new Segmenter(sampleRate);
  return [...s.push(samples), ...s.flush()];
}

function startSample(seg: Segment): number {
  return Math.round(seg.t * seg.sampleRate);
}

function endSample(seg: Segment): number {
  return startSample(seg) + seg.samples.length;
}

// Fixed windows over the whole file from sample 0. All-zero windows are skipped.
function backgroundWindows(file: string, samples: Float32Array, sampleRate: number): Candidate[] {
  const length = Math.round((BACKGROUND_WINDOW_MS * sampleRate) / MS_PER_SECOND);
  const step = Math.round((length * (PERCENT - BACKGROUND_WINDOW_OVERLAP_PERCENT)) / PERCENT);
  const out: Candidate[] = [];
  if (length < 1 || step < 1) return out;
  for (let w = 0, start = 0; start + length <= samples.length; w++, start += step) {
    const slice = samples.slice(start, start + length);
    if (slice.every((x) => x === 0)) continue;
    out.push({
      start,
      isWindow: true,
      example: {
        id: `${BACKGROUND}/${file}#w${w}`,
        label: BACKGROUND,
        segment: { t: start / sampleRate, durationMs: (length * MS_PER_SECOND) / sampleRate, samples: slice, sampleRate },
      },
    });
  }
  return out;
}

// Warnings for sound lost in the calibration period. Uses a second run over the samples preceded by
// one calibration period of zeros, for warnings only.
function calibrationWarnings(rel: string, samples: Float32Array, sampleRate: number, real: Segment[]): TeachWarning[] {
  const pad = Math.round((NOISE_FLOOR_WARMUP_MS * sampleRate) / MS_PER_SECOND);
  const out: TeachWarning[] = [];
  if (samples.length < pad) {
    const lengthMs = (samples.length * MS_PER_SECOND) / sampleRate;
    out.push({
      file: rel,
      code: 'shorter-than-calibration',
      message: `${rel} is ${lengthMs.toFixed(0)} ms long, shorter than the ${NOISE_FLOOR_WARMUP_MS} ms calibration period, so no sound in it can be found.`,
    });
  }
  const padded = new Float32Array(pad + samples.length);
  padded.set(samples, pad);
  let firstLost: number | null = null;
  for (const seg of segmentsOf(padded, sampleRate)) {
    const s = startSample(seg) - pad;
    if (s >= pad) continue;
    const found = real.some((r) => startSample(r) <= s && s < endSample(r));
    if (!found && (firstLost === null || s < firstLost)) firstLost = s;
  }
  if (firstLost !== null) {
    const atMs = (Math.max(0, firstLost) * MS_PER_SECOND) / sampleRate;
    out.push({
      file: rel,
      code: 'sound-in-calibration',
      message: `${rel} has a sound at ${atMs.toFixed(0)} ms, inside the first ${NOISE_FLOOR_WARMUP_MS} ms calibration period, so it was not used. Leave ${NOISE_FLOOR_WARMUP_MS} ms of quiet before the first sound.`,
    });
  }
  if (real.length === 0) {
    out.push({ file: rel, code: 'no-sound-found', message: `${rel} gave no sound to learn from.` });
  }
  return out;
}

// Keeps exactly `max` candidates at evenly spaced indices.
function capEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, j) => items[Math.floor((j * items.length) / max)]);
}

export function looReport(model: SoundModel, labels: string[]): Pick<TeachReport, 'labels' | 'confusedPairs'> {
  const all = model.examples;
  const total = new Map<string, number>();
  const correct = new Map<string, number>();
  const confused = new Map<string, Map<string, number>>();
  for (const e of all) total.set(e.label, (total.get(e.label) ?? 0) + 1);
  for (let i = 0; i < all.length; i++) {
    const held = all[i];
    const rest = all.filter((_, k) => k !== i);
    const m = trainVectors(rest, model.sampleRate, { minExamplesPerLabel: LOO_MIN_EXAMPLES_PER_LABEL });
    const r = classifyVector(m, held.v);
    if (r.kind !== 'match') continue;
    if (r.label === held.label) {
      correct.set(held.label, (correct.get(held.label) ?? 0) + 1);
    } else {
      const row = confused.get(held.label) ?? new Map<string, number>();
      row.set(r.label, (row.get(r.label) ?? 0) + 1);
      confused.set(held.label, row);
    }
  }
  const pairs: TeachReport['confusedPairs'] = [];
  for (const [a, row] of confused) {
    for (const [b, n] of row) {
      const rate = n / (total.get(a) as number);
      if (rate >= CONFUSED_PAIR_MIN_RATE) pairs.push({ a, b, rate });
    }
  }
  pairs.sort((x, y) => y.rate - x.rate || compareStrings(x.a, y.a) || compareStrings(x.b, y.b));
  return {
    labels: labels.map((label) => ({
      label,
      examples: total.get(label) ?? 0,
      looAccuracy: (correct.get(label) ?? 0) / (total.get(label) as number),
    })),
    confusedPairs: pairs,
  };
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// A copy sorted by label, then file. Rejects two recordings with the same label and file.
function sortedRecordings(recs: Recording[]): Recording[] {
  const sorted = [...recs].sort((a, b) => compareStrings(a.label, b.label) || compareStrings(a.file, b.file));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].label === sorted[i - 1].label && sorted[i].file === sorted[i - 1].file) {
      throw new RangeError(`Two recordings have the same label and file: ${sorted[i].label}/${sorted[i].file}`);
    }
  }
  return sorted;
}

// Examples of one label other than hum from its recordings (sorted by file), with the calibration
// warnings. Background adds fixed windows and is capped over the whole label.
function labelExamples(label: string, recs: Recording[], warnings: TeachWarning[]): Example[] {
  const out: Example[] = [];
  for (const rec of recs) {
    const rel = `${label}/${rec.file}`;
    const real = segmentsOf(rec.samples, rec.sampleRate);
    const segs: Candidate[] = real.map((segment, n) => ({
      start: startSample(segment),
      isWindow: false,
      example: { id: `${rel}#${n}`, label, segment },
    }));
    if (label === BACKGROUND) {
      const merged = [...segs, ...backgroundWindows(rec.file, rec.samples, rec.sampleRate)];
      merged.sort((a, b) => a.start - b.start || Number(a.isWindow) - Number(b.isWindow));
      out.push(...merged.map((c) => c.example));
    } else {
      out.push(...segs.map((c) => c.example));
      warnings.push(...calibrationWarnings(rel, rec.samples, rec.sampleRate, real));
    }
  }
  return label === BACKGROUND ? capEvenly(out, BACKGROUND_MAX_EXAMPLES) : out;
}

// Median pitch of each hum recording. A recording without a hum gives a warning. Only numbers leave.
function humPitches(recs: Recording[], warnings: TeachWarning[]): number[] {
  const found: number[] = [];
  for (const rec of recs) {
    const rel = `${HUM_LABEL}/${rec.file}`;
    const hz = medianPitchHz(rec.samples, rec.sampleRate);
    if (hz === null) {
      warnings.push({ file: rel, code: 'no-pitch-found', message: `${rel} has no steady hum to learn the pitch from. Record a steady hum of at least 2 s.` });
    } else {
      found.push(hz);
    }
  }
  return found;
}

function sortWarnings(warnings: TeachWarning[]): TeachWarning[] {
  return warnings.sort((a, b) => compareStrings(a.file, b.file) || compareStrings(a.code, b.code));
}

// emptyFolders: names of label folders that exist and hold no recording. Only the folder reader uses it.
export function teachFromRecordings(
  recs: Recording[],
  options?: { emptyFolders?: string[] },
): { model: SoundModel; report: TeachReport } {
  const sorted = sortedRecordings(recs);
  const byLabel = new Map<string, Recording[]>();
  for (const rec of sorted) byLabel.set(rec.label, [...(byLabel.get(rec.label) ?? []), rec]);
  const emptyFolders = options?.emptyFolders ?? [];
  const labelSet = new Set([...byLabel.keys(), ...emptyFolders]);
  labelSet.delete(HUM_LABEL);
  const labels = [...labelSet].sort(compareStrings);

  const warnings: TeachWarning[] = [];
  const examples: Example[] = [];
  const counts: Record<string, number> = {};
  for (const label of labels) {
    const kept = labelExamples(label, byLabel.get(label) ?? [], warnings);
    counts[label] = kept.length;
    examples.push(...kept);
  }

  if (labels.length === 0 || labels.some((l) => counts[l] < MIN_EXAMPLES_PER_LABEL)) {
    throw new TooFewExamplesError(counts);
  }

  const model = knnClassifier.train(examples);
  const humRecs = byLabel.get(HUM_LABEL) ?? [];
  const pitches = humPitches(humRecs, warnings);
  if (humRecs.length === 0 && emptyFolders.includes(HUM_LABEL)) {
    warnings.push({ file: HUM_LABEL, code: 'no-pitch-found', message: `The ${HUM_LABEL} folder has no .wav file. Add a steady hum of at least 2 s.` });
  }
  if (pitches.length > 0) model.pitch = { baselineHz: median(pitches) };
  sortWarnings(warnings);
  return { model, report: { ...looReport(model, labels), warnings } };
}

// Replaces the examples of `label` with the segments of `recs` and retrains the whole model. The
// vectors of every other label are copied from `model`. Neither `model` nor `recs` is modified.
export function retrainLabel(
  model: SoundModel,
  label: string,
  recs: Recording[],
  options?: { keep?: string[] },
): { model: SoundModel; report: TeachReport } {
  for (const rec of recs) {
    if (rec.label !== label) throw new RangeError(`Recording ${rec.label}/${rec.file} does not have the label ${label}.`);
  }
  const sorted = sortedRecordings(recs);
  const warnings: TeachWarning[] = [];
  for (const rec of sorted) {
    if (rec.sampleRate !== model.sampleRate) {
      const rel = `${label}/${rec.file}`;
      warnings.push({
        file: rel,
        code: 'sample-rate-mismatch',
        message: `${rel} has a sample rate of ${rec.sampleRate} Hz, but the model was taught at ${model.sampleRate} Hz.`,
      });
    }
  }

  const isHum = label === HUM_LABEL;
  const pitches = isHum ? humPitches(sorted, warnings) : [];
  let fresh: { id: string; label: string; v: number[] }[] = [];
  if (!isHum) {
    let chosen = labelExamples(label, sorted, warnings);
    if (options?.keep !== undefined) {
      const keep = new Set(options.keep);
      chosen = chosen.filter((e) => keep.has(e.id));
    }
    fresh = chosen.map((e) => ({ id: e.id, label: e.label, v: extractFeatures(e.segment) }));
  }

  const kept = model.examples
    .filter((e) => isHum || e.label !== label)
    .map((e) => ({ id: e.id, label: e.label, v: [...e.v] }));
  const all = [...kept, ...fresh];
  if (!isHum) {
    const counts: Record<string, number> = { [label]: 0 };
    for (const e of all) counts[e.label] = (counts[e.label] ?? 0) + 1;
    if (Object.values(counts).some((n) => n < MIN_EXAMPLES_PER_LABEL)) throw new TooFewExamplesError(counts);
  }

  const next = trainVectors(all, model.sampleRate);
  if (model.pitch !== undefined) next.pitch = { ...model.pitch };
  if (isHum && pitches.length > 0) next.pitch = { baselineHz: median(pitches) };
  const labels = [...new Set(next.examples.map((e) => e.label))].sort(compareStrings);
  sortWarnings(warnings);
  return { model: next, report: { ...looReport(next, labels), warnings } };
}
