// teachFromDir: turns dir/<label>/*.wav into a SoundModel and a self-check report (Task 8).
// Reads local files only. Writes nothing and uses no network. The model holds feature vectors only.

import { readdir } from 'fs/promises';
import { join } from 'path';
import { classifyVector, knnClassifier, trainVectors, TooFewExamplesError } from '../core/classify/knn';
import {
  BACKGROUND,
  BACKGROUND_MAX_EXAMPLES,
  BACKGROUND_WINDOW_MS,
  BACKGROUND_WINDOW_OVERLAP_PERCENT,
  CONFUSED_PAIR_MIN_RATE,
  LOO_MIN_EXAMPLES_PER_LABEL,
  MIN_EXAMPLES_PER_LABEL,
  NOISE_FLOOR_WARMUP_MS,
} from '../core/constants';
import { Segmenter } from '../core/segment';
import type { Segment, SoundModel } from '../core/types';
import { readWavFile } from './files';

const MS_PER_SECOND = 1000;
const PERCENT = 100;
const WAV_EXTENSION = '.wav';
const HUM_FOLDER = 'hum';

export type TeachWarning = {
  file: string;
  code: 'shorter-than-calibration' | 'sound-in-calibration' | 'no-sound-found' | 'hum-folder-ignored';
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

async function readLabelled(dir: string, rel: string): Promise<{ samples: Float32Array; sampleRate: number }> {
  try {
    return await readWavFile(join(dir, rel));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${rel}: ${message}`, { cause: error });
  }
}

// Fixed windows over the whole file from sample 0 (Requirement 9.1 to 9.4). All-zero windows are skipped.
function backgroundWindows(file: string, samples: Float32Array, sampleRate: number): Candidate[] {
  const window = Math.round((BACKGROUND_WINDOW_MS * sampleRate) / MS_PER_SECOND);
  const step = Math.round((window * (PERCENT - BACKGROUND_WINDOW_OVERLAP_PERCENT)) / PERCENT);
  const out: Candidate[] = [];
  if (window < 1 || step < 1) return out;
  for (let w = 0, start = 0; start + window <= samples.length; w++, start += step) {
    const slice = samples.slice(start, start + window);
    if (slice.every((x) => x === 0)) continue;
    out.push({
      start,
      isWindow: true,
      example: {
        id: `${BACKGROUND}/${file}#w${w}`,
        label: BACKGROUND,
        segment: { t: start / sampleRate, durationMs: (window * MS_PER_SECOND) / sampleRate, samples: slice, sampleRate },
      },
    });
  }
  return out;
}

// Warnings for sound lost in the calibration period (Requirement 11). Uses a second run over the
// samples preceded by one calibration period of zeros, for warnings only.
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

// Keeps exactly `max` candidates at evenly spaced indices (Requirement 9.5).
function capEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, j) => items[Math.floor((j * items.length) / max)]);
}

function looReport(model: SoundModel, labels: string[]): Pick<TeachReport, 'labels' | 'confusedPairs'> {
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

export async function teachFromDir(dir: string): Promise<{ model: SoundModel; report: TeachReport }> {
  // Outside the wrap, so a missing directory rejects with the file system error unchanged.
  const entries = await readdir(dir, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort(compareStrings);

  const warnings: TeachWarning[] = [];
  const examples: Example[] = [];
  const counts: Record<string, number> = {};
  const labels: string[] = [];

  for (const label of folders) {
    if (label === HUM_FOLDER) {
      warnings.push({
        file: HUM_FOLDER,
        code: 'hum-folder-ignored',
        message: 'The hum folder was ignored: hum teaching is not available yet.',
      });
      continue;
    }
    labels.push(label);
    const files = (await readdir(join(dir, label), { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(WAV_EXTENSION))
      .map((e) => e.name)
      .sort(compareStrings);

    const labelExamples: Example[] = [];
    for (const file of files) {
      const rel = `${label}/${file}`;
      const { samples, sampleRate } = await readLabelled(dir, rel);
      const real = segmentsOf(samples, sampleRate);
      const segs: Candidate[] = real.map((segment, n) => ({
        start: startSample(segment),
        isWindow: false,
        example: { id: `${rel}#${n}`, label, segment },
      }));
      if (label === BACKGROUND) {
        const merged = [...segs, ...backgroundWindows(file, samples, sampleRate)];
        merged.sort((a, b) => a.start - b.start || Number(a.isWindow) - Number(b.isWindow));
        labelExamples.push(...merged.map((c) => c.example));
      } else {
        labelExamples.push(...segs.map((c) => c.example));
        warnings.push(...calibrationWarnings(rel, samples, sampleRate, real));
      }
    }
    const kept = label === BACKGROUND ? capEvenly(labelExamples, BACKGROUND_MAX_EXAMPLES) : labelExamples;
    counts[label] = kept.length;
    examples.push(...kept);
  }

  if (labels.length === 0 || labels.some((l) => counts[l] < MIN_EXAMPLES_PER_LABEL)) {
    throw new TooFewExamplesError(counts);
  }

  const model = knnClassifier.train(examples);
  warnings.sort((a, b) => compareStrings(a.file, b.file) || compareStrings(a.code, b.code));
  return { model, report: { ...looReport(model, labels), warnings } };
}
