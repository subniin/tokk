// Text formatters for the three tools. Output is plain text, the same on every run for the same input.

import type { EngineEvent } from '../../core/engine';
import type { ScoreReport } from '../../node/score';
import type { TeachReport } from '../../node/teach';

const TIME_DECIMALS = 3;
const CONFIDENCE_DECIMALS = 2;
const ACCURACY_DECIMALS = 2;
const RATE_DECIMALS = 2;
const RATIO_DECIMALS = 3;
const PER_HOUR_DECIMALS = 1;
const SECONDS_DECIMALS = 1;
const UNKNOWN = 'unknown';
const NONE = 'none';
const NO_SOUNDS = 'no sounds found';

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function formatTeach(labels: number, examples: number, outRel: string, report: TeachReport): string {
  const lines = [`taught ${labels} sounds, ${examples} examples -> ${outRel}`];
  for (const l of report.labels) {
    lines.push(`${l.label}: ${l.examples} examples, LOO accuracy ${l.looAccuracy.toFixed(ACCURACY_DECIMALS)}`);
  }
  if (report.confusedPairs.length === 0) lines.push('confused: none');
  for (const p of report.confusedPairs) lines.push(`confused: ${p.a} -> ${p.b} ${p.rate.toFixed(RATE_DECIMALS)}`);
  for (const w of report.warnings) lines.push(`warning [${w.code}] ${w.file}: ${w.message}`);
  return lines.join('\n');
}

export function formatListen(events: EngineEvent[]): string {
  const ordered = events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.kind === 'sound' || e.kind === 'unknown')
    .sort((a, b) => a.e.t - b.e.t || a.i - b.i)
    .map(({ e }) => e);
  if (ordered.length === 0) return NO_SOUNDS;
  const counts = new Map<string, number>();
  let unknown = 0;
  const lines: string[] = [];
  for (const e of ordered) {
    if (e.kind === 'sound') {
      lines.push(`${e.label} @ ${e.t.toFixed(TIME_DECIMALS)}s conf ${e.confidence.toFixed(CONFIDENCE_DECIMALS)}`);
      counts.set(e.label, (counts.get(e.label) ?? 0) + 1);
    } else if (e.kind === 'unknown') {
      lines.push(`${UNKNOWN} @ ${e.t.toFixed(TIME_DECIMALS)}s nearest ${e.nearest.id}`);
      unknown++;
    }
  }
  const parts = [...counts.keys()].sort(byCodeUnit).map((l) => `${l} x${counts.get(l)}`);
  if (unknown > 0) parts.push(`${UNKNOWN} x${unknown}`);
  lines.push(parts.join(', '));
  return lines.join('\n');
}

// Pads every column to its widest cell. The last column is not padded.
function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  return rows.map((r) => r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]))).join(' '));
}

export function formatScore(r: ScoreReport): string {
  const rows = [['label', 'truths', 'tp', 'fp', 'fn', 'calib', 'precision', 'recall']];
  for (const l of r.perLabel) {
    rows.push([
      l.label, String(l.truths), String(l.tp), String(l.fp), String(l.fn), String(l.inCalibration),
      l.precision.toFixed(RATIO_DECIMALS), l.recall.toFixed(RATIO_DECIMALS),
    ]);
  }
  const lines = table(rows);

  const truths = Object.keys(r.confusion);
  if (truths.length === 0) {
    lines.push('', 'confusion: none');
  } else {
    const rank = (s: string): string => (s === NONE ? '\uffff' : s);
    const order = (a: string, b: string): number => byCodeUnit(rank(a), rank(b));
    const rowLabels = [...truths].sort(order);
    const columns = [...new Set(truths.flatMap((t) => Object.keys(r.confusion[t])))].sort(order);
    const matrix = [['truth', ...columns], ...rowLabels.map((t) => [t, ...columns.map((c) => String(r.confusion[t][c] ?? 0))])];
    lines.push('', 'confusion (truth rows, predicted columns):', ...table(matrix));
  }
  lines.push(
    '',
    `false positives per hour ${r.falsePositivesPerHour.toFixed(PER_HOUR_DECIMALS)}, total seconds ${r.totalSeconds.toFixed(SECONDS_DECIMALS)}, in calibration ${r.inCalibration}`,
  );
  for (const w of r.warnings) lines.push(`warning [${w.code}] ${w.file}: ${w.message}`);
  return lines.join('\n');
}