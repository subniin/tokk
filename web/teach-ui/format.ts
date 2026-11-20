// Pure text of the teach dialog. English only. No function here returns NaN, undefined or Infinity as text.

import { NOISE_FLOOR_WARMUP_MS } from '../../core/constants';
import type { TeachReport } from '../../core/teach';
import type { SoundModel } from '../../core/types';
import { WEB_TEACH_MAX_RECORDING_MS, WEB_TEACH_TIME_DECIMALS } from '../constants';
import type { TeachExample, TeachState } from './state';
import { keptCount } from './state';

const PERCENT = 100;
const MS_PER_SECOND = 1000;
const QUIET_SECONDS = NOISE_FLOOR_WARMUP_MS / MS_PER_SECOND;
const SECONDS_PER_MINUTE = 60;

function whole(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function seconds(n: number): string {
  return (Number.isFinite(n) ? Math.max(0, n) : 0).toFixed(WEB_TEACH_TIME_DECIMALS);
}

// A rate from 0 to 1 as a whole percent. Anything that is not a finite number counts as 0.
export function percentText(rate: number): string {
  const p = Number.isFinite(rate) ? Math.min(PERCENT, Math.max(0, Math.round(rate * PERCENT))) : 0;
  return `${p}%`;
}

// The instruction of the current step.
export function stepText(s: TeachState): string {
  if (s.finishing) return 'Training...';
  if (s.phase === 'quiet') return `Stay quiet for ${QUIET_SECONDS} second`;
  if (s.kind === 'hum') return 'Hum one steady note, then press Done.';
  if (s.kind === 'background') return 'Let the room make its usual noise, then press Done.';
  const n = whole(s.target);
  return `Make the sound ${n} ${n === 1 ? 'time' : 'times'}`;
}

export function countLine(s: TeachState): string {
  return `${s.examples.length} of ${whole(s.target)} heard, ${keptCount(s)} kept`;
}

export function exampleLine(e: TeachExample): string {
  return `Example ${whole(e.number)}: starts at ${seconds(e.t)} s, lasts ${seconds(e.durationMs / MS_PER_SECOND)} s`;
}

// A line that tells the user that existing data of the label is replaced, or null when there is none.
export function replaceLine(o: { label: string; kind: string; model: SoundModel }): string | null {
  if (o.kind === 'hum') {
    return o.model.pitch === undefined ? null : 'The existing hum pitch will be replaced.';
  }
  const n = o.model.examples.filter((e) => e.label === o.label).length;
  if (n === 0) return null;
  return `The ${n} existing ${n === 1 ? 'example' : 'examples'} of "${o.label}" will be replaced.`;
}

// One line per label, one sentence per confused pair, every warning, and the hum pitch.
export function reportLines(report: TeachReport, model: SoundModel | null): string[] {
  const lines: string[] = [];
  for (const l of report.labels) {
    lines.push(`${l.label}: ${percentText(l.looAccuracy)} of ${whole(l.examples)} examples were recognised when left out one by one`);
  }
  if (report.confusedPairs.length === 0) {
    lines.push('No two sounds are confused with each other.');
  } else {
    for (const p of report.confusedPairs) {
      lines.push(`${p.a} is sometimes heard as ${p.b} (${percentText(p.rate)} of ${p.a} examples)`);
    }
  }
  for (const w of report.warnings) lines.push(w.message);
  const hz = model?.pitch?.baselineHz;
  if (hz !== undefined && Number.isFinite(hz)) lines.push(`Hum pitch: ${whole(hz)} Hz`);
  return lines;
}

export function savedLine(stored: boolean | null): string {
  return stored === false ? 'Saved for this session only. The browser did not allow storing it.' : 'Saved.';
}

// Shown when the recorder stopped collecting at the longest recording.
export function limitLine(): string {
  const minutes = WEB_TEACH_MAX_RECORDING_MS / MS_PER_SECOND / SECONDS_PER_MINUTE;
  return `The longest recording (${minutes} minutes) was reached, so nothing more is collected. Press Done or Cancel.`;
}
