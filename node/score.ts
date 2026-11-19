// scoreDir: runs labelled recordings (x.wav + x.json) through the engine and compares the sounds found
// with the labels. Reads local files only. Writes nothing, uses no network, and the report holds counts only.

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import {
  MATCH_TOLERANCE_MS,
  NOISE_FLOOR_WARMUP_MS,
  REGRESSION_MIN_TRUTHS,
  REGRESSION_RECALL_DROP,
  REGRESSION_TP_DROP_COUNT,
  SCORE_EPSILON,
} from '../core/constants';
import { runSamples } from '../core/engine';
import type { SoundModel } from '../core/types';
import { readWavFile } from './files';

const MS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 3600;
const WAV_EXTENSION = '.wav';
const JSON_EXTENSION = '.json';
const NONE = 'none';

export type ScoreWarningCode = 'no-labels' | 'no-recording' | 'sample-rate-mismatch' | 'in-calibration';
export interface ScoreWarning { file: string; code: ScoreWarningCode; message: string }

export interface LabelScore {
  label: string;
  truths: number;
  tp: number;
  fp: number;
  fn: number;
  inCalibration: number;
  precision: number;
  recall: number;
}

export interface ScoreReport {
  perLabel: LabelScore[];
  falsePositivesPerHour: number;
  totalSeconds: number;
  inCalibration: number;
  confusion: Record<string, Record<string, number>>;
  warnings: ScoreWarning[];
}

export interface LabelComparison {
  label: string;
  recallDelta: number;
  precisionDelta: number;
  tpDelta: number;
  baselineTruths: number;
  regression: boolean;
}

export interface TimedLabel { label: string; t: number }

export interface Matching {
  pairs: [truthIndex: number, predictionIndex: number][];
  unmatchedTruths: number[];
  unmatchedPredictions: number[];
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Greedy nearest-first one-to-one matching within MATCH_TOLERANCE_MS. Both lists are for one file in time order.
// By default only equal labels can pair. With `differentLabels` only unequal labels can pair.
export function matchEvents(truths: TimedLabel[], predictions: TimedLabel[], differentLabels = false): Matching {
  const candidates: { i: number; j: number; dt: number }[] = [];
  truths.forEach((tr, i) => {
    predictions.forEach((pr, j) => {
      if ((tr.label === pr.label) === differentLabels) return;
      const dt = Math.abs(pr.t - tr.t);
      if (dt * MS_PER_SECOND <= MATCH_TOLERANCE_MS + SCORE_EPSILON) candidates.push({ i, j, dt });
    });
  });
  candidates.sort((a, b) => a.dt - b.dt || a.i - b.i || a.j - b.j);
  const takenT = new Set<number>();
  const takenP = new Set<number>();
  const pairs: [number, number][] = [];
  for (const c of candidates) {
    if (takenT.has(c.i) || takenP.has(c.j)) continue;
    takenT.add(c.i);
    takenP.add(c.j);
    pairs.push([c.i, c.j]);
  }
  return {
    pairs,
    unmatchedTruths: truths.map((_, i) => i).filter((i) => !takenT.has(i)),
    unmatchedPredictions: predictions.map((_, j) => j).filter((j) => !takenP.has(j)),
  };
}

function fail(file: string, what: string, cause?: unknown): Error {
  return new Error(`${file}: ${what}`, cause === undefined ? undefined : { cause });
}

function parseLabels(file: string, text: string): { events: TimedLabel[]; sampleRate: number | undefined } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw fail(file, `not valid JSON (${(e as Error).message})`, e);
  }
  if (typeof data !== 'object' || data === null || !Array.isArray((data as { events?: unknown }).events)) {
    throw fail(file, 'expected an object with an "events" array');
  }
  const o = data as { events: unknown[]; sampleRate?: unknown };
  const events = o.events.map((e, i) => {
    const ev = e as { label?: unknown; t?: unknown } | null;
    if (typeof ev !== 'object' || ev === null || typeof ev.label !== 'string') {
      throw fail(file, `events[${i}] needs a string "label"`);
    }
    if (typeof ev.t !== 'number' || !Number.isFinite(ev.t) || ev.t < 0) {
      throw fail(file, `events[${i}] needs "t" as a finite number of seconds, 0 or more`);
    }
    return { label: ev.label, t: ev.t };
  });
  events.sort((a, b) => a.t - b.t);
  return { events, sampleRate: typeof o.sampleRate === 'number' ? o.sampleRate : undefined };
}

interface Counts { tp: number; fp: number; fn: number; inCalibration: number }

function ratio(num: number, den: number): number {
  return den === 0 ? 1 : num / den;
}

export async function scoreDir(dir: string, sounds: SoundModel): Promise<ScoreReport> {
  const entries = await readdir(dir, { withFileTypes: true });
  const stems = new Map<string, { wav?: string; json?: string }>();
  for (const e of entries) {
    if (!e.isFile()) continue;
    const lower = e.name.toLowerCase();
    const ext = lower.endsWith(WAV_EXTENSION) ? WAV_EXTENSION : lower.endsWith(JSON_EXTENSION) ? JSON_EXTENSION : '';
    if (ext === '') continue;
    const stem = e.name.slice(0, e.name.length - ext.length);
    const slot = stems.get(stem) ?? {};
    if (ext === WAV_EXTENSION) slot.wav = e.name;
    else slot.json = e.name;
    stems.set(stem, slot);
  }

  const warnings: ScoreWarning[] = [];
  const counts = new Map<string, Counts>();
  const confusion = new Map<string, Map<string, number>>();
  const count = (label: string): Counts => {
    let c = counts.get(label);
    if (!c) { c = { tp: 0, fp: 0, fn: 0, inCalibration: 0 }; counts.set(label, c); }
    return c;
  };
  const addConfusion = (truth: string, predicted: string): void => {
    const row = confusion.get(truth) ?? new Map<string, number>();
    row.set(predicted, (row.get(predicted) ?? 0) + 1);
    confusion.set(truth, row);
  };

  let totalSeconds = 0;
  let inCalibrationTotal = 0;
  const warmupS = NOISE_FLOOR_WARMUP_MS / MS_PER_SECOND;

  for (const stem of [...stems.keys()].sort(byCodeUnit)) {
    const { wav, json } = stems.get(stem)!;
    if (wav !== undefined && json === undefined) {
      warnings.push({ file: wav, code: 'no-labels', message: `${wav} has no label file ${stem}.json and was skipped.` });
      continue;
    }
    if (json !== undefined && wav === undefined) {
      warnings.push({ file: json, code: 'no-recording', message: `${json} has no recording ${stem}.wav and was ignored.` });
      continue;
    }
    const wavName = wav!;
    const jsonName = json!;

    const labels = parseLabels(jsonName, await readFile(join(dir, jsonName), 'utf8'));
    let audio;
    try {
      audio = await readWavFile(join(dir, wavName));
    } catch (e) {
      throw fail(wavName, (e as Error).message, e);
    }
    const sampleRate = audio.sampleRate;
    if (labels.sampleRate !== undefined && labels.sampleRate !== sampleRate) {
      warnings.push({
        file: jsonName,
        code: 'sample-rate-mismatch',
        message: `${jsonName} says ${labels.sampleRate} Hz but ${wavName} is ${sampleRate} Hz. Using ${sampleRate} Hz.`,
      });
    }
    totalSeconds += audio.samples.length / sampleRate;

    const early = labels.events.filter((e) => e.t < warmupS - SCORE_EPSILON);
    const truths = labels.events.filter((e) => e.t >= warmupS - SCORE_EPSILON);
    for (const e of labels.events) count(e.label);
    for (const e of early) count(e.label).inCalibration++;
    inCalibrationTotal += early.length;
    if (early.length > 0) {
      warnings.push({
        file: jsonName,
        code: 'in-calibration',
        message: `${jsonName}: ${early.length} labelled event(s) before ${warmupS} s, the first at ${early[0].t} s. The recording needs ${warmupS} s of lead before the first sound.`,
      });
    }

    const predictions: TimedLabel[] = runSamples(audio.samples, sampleRate, sounds).events
      .flatMap((e) => (e.kind === 'sound' ? [{ label: e.label, t: e.t }] : []))
      .sort((a, b) => a.t - b.t);

    const same = matchEvents(truths, predictions);
    for (const [i] of same.pairs) { count(truths[i].label).tp++; addConfusion(truths[i].label, truths[i].label); }
    for (const j of same.unmatchedPredictions) count(predictions[j].label).fp++;
    for (const i of same.unmatchedTruths) count(truths[i].label).fn++;

    const leftTruths = same.unmatchedTruths.map((i) => truths[i]);
    const leftPreds = same.unmatchedPredictions.map((j) => predictions[j]);
    const cross = matchEvents(leftTruths, leftPreds, true);
    for (const [i, j] of cross.pairs) addConfusion(leftTruths[i].label, leftPreds[j].label);
    for (const j of cross.unmatchedPredictions) addConfusion(NONE, leftPreds[j].label);
  }

  const perLabel: LabelScore[] = [...counts.keys()].sort(byCodeUnit).map((label) => {
    const c = counts.get(label)!;
    return {
      label,
      truths: c.tp + c.fn,
      tp: c.tp,
      fp: c.fp,
      fn: c.fn,
      inCalibration: c.inCalibration,
      precision: ratio(c.tp, c.tp + c.fp),
      recall: ratio(c.tp, c.tp + c.fn),
    };
  });
  const fpTotal = perLabel.reduce((s, l) => s + l.fp, 0);
  const confusionOut: Record<string, Record<string, number>> = {};
  for (const truth of [...confusion.keys()].sort(byCodeUnit)) {
    const row = confusion.get(truth)!;
    confusionOut[truth] = Object.fromEntries([...row.keys()].sort(byCodeUnit).map((k) => [k, row.get(k)!]));
  }
  warnings.sort((a, b) => byCodeUnit(a.file, b.file) || byCodeUnit(a.code, b.code));

  return {
    perLabel,
    falsePositivesPerHour: totalSeconds === 0 ? 0 : (fpTotal / totalSeconds) * SECONDS_PER_HOUR,
    totalSeconds,
    inCalibration: inCalibrationTotal,
    confusion: confusionOut,
    warnings,
  };
}

// Compares a report with a stored baseline. Only recall decides a regression (design 8.2).
export function compareToBaseline(report: ScoreReport, baseline: ScoreReport): LabelComparison[] {
  const now = new Map(report.perLabel.map((l) => [l.label, l]));
  const was = new Map(baseline.perLabel.map((l) => [l.label, l]));
  const labels = [...new Set([...now.keys(), ...was.keys()])].sort(byCodeUnit);
  return labels.map((label) => {
    const b = was.get(label);
    const r = now.get(label);
    const baselineTruths = b ? b.tp + b.fn : 0;
    if (!b) {
      // New label: nothing to compare with.
      return { label, recallDelta: r!.recall, precisionDelta: r!.precision, tpDelta: r!.tp, baselineTruths: 0, regression: false };
    }
    if (!r) {
      // Lost label: read as tp 0 and, when the baseline had truths, recall 0.
      const lost = baselineTruths > 0;
      return {
        label,
        recallDelta: (lost ? 0 : 1) - b.recall,
        precisionDelta: (b.tp + b.fp === 0 ? 1 : 0) - b.precision,
        tpDelta: -b.tp,
        baselineTruths,
        regression: lost,
      };
    }
    const recallDelta = r.recall - b.recall;
    const tpDelta = r.tp - b.tp;
    const regression = baselineTruths >= REGRESSION_MIN_TRUTHS
      ? recallDelta < -REGRESSION_RECALL_DROP - SCORE_EPSILON
      : tpDelta <= -REGRESSION_TP_DROP_COUNT;
    return { label, recallDelta, precisionDelta: r.precision - b.precision, tpDelta, baselineTruths, regression };
  });
}
