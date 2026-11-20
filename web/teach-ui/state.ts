// Pure state machine of the teach dialog. No DOM type, no clock, no randomness, no storage.

import { MIN_EXAMPLES_PER_LABEL, NOISE_FLOOR_WARMUP_MS } from '../../core/constants';
import type { TeachReport } from '../../core/teach';
import type { SoundModel } from '../../core/types';
import { WEB_TEACH_BACKGROUND_RECORD_MS, WEB_TEACH_HUM_RECORD_MS, WEB_TEACH_PROGRESS_REDUCED_MOTION_MS } from '../constants';
import { kindOfLabel } from '../record-kind';
import type { RecordKind } from '../record-kind';

const MS_PER_SECOND = 1000;
const LABEL_RULE = /^[a-z][a-z0-9-]{0,31}$/;
const LABEL_RULE_TEXT = '^[a-z][a-z0-9-]{0,31}$';

export type Phase = 'quiet' | 'recording' | 'review' | 'saved' | 'cancelled';

export interface TeachExample {
  number: number;          // index plus 1, stable: deleting does not renumber
  id: string;
  t: number;               // start in s
  durationMs: number;
  min: Float32Array;
  max: Float32Array;
  deleted: boolean;
}

export interface TeachState {
  phase: Phase;
  kind: RecordKind;
  label: string;
  target: number;          // the number of examples asked for
  examples: TeachExample[];
  elapsedMs: number;       // from the last record-progress: t times 1000
  finishing: boolean;      // Done was pressed and the model is being trained
  limitReached: boolean;
  report: TeachReport | null;
  model: SoundModel | null;
  error: string | null;
  saveStored: boolean | null;   // unknown until the storage write is reported
}

export type TeachAction =
  | { type: 'progress'; t: number }
  | { type: 'segment'; id: string; t: number; durationMs: number; min: Float32Array; max: Float32Array }
  | { type: 'delete'; id: string }
  | { type: 'done' }
  | { type: 'trained'; model: SoundModel; report: TeachReport }
  | { type: 'failed'; message: string }
  | { type: 'limit' }
  | { type: 'save' }
  | { type: 'again' }
  | { type: 'cancel' }
  | { type: 'stored'; ok: boolean };

export interface Gate { enabled: boolean; reason: string }

export function initialState(o: { label: string; target: number }): TeachState {
  const kind = kindOfLabel(o.label);
  return {
    phase: kind === 'sound' ? 'quiet' : 'recording', kind, label: o.label, target: o.target, examples: [], elapsedMs: 0,
    finishing: false, limitReached: false, report: null, model: null, error: null, saveStored: null,
  };
}

export function keptCount(s: TeachState): number {
  return s.examples.filter((e) => !e.deleted).length;
}

// The quiet step as a fraction of NOISE_FLOOR_WARMUP_MS, at most 1.
export function quietProgress(s: TeachState): number {
  return Math.max(0, Math.min(1, s.elapsedMs / NOISE_FLOOR_WARMUP_MS));
}

function requiredMs(kind: RecordKind): number {
  return kind === 'hum' ? WEB_TEACH_HUM_RECORD_MS : WEB_TEACH_BACKGROUND_RECORD_MS;
}

function secondsLeftText(leftMs: number): string {
  const seconds = Math.max(1, Math.ceil(leftMs / MS_PER_SECOND));
  return `${seconds} more ${seconds === 1 ? 'second' : 'seconds'}`;
}

// Whether the Done button works, and if not, what to do.
export function doneState(s: TeachState): Gate {
  if (s.phase === 'quiet') return { enabled: false, reason: 'The quiet second is not over yet. Wait until it is done.' };
  if (s.phase !== 'recording') return { enabled: false, reason: '' };
  if (s.finishing) return { enabled: false, reason: 'The model is being trained. Wait a moment.' };
  if (s.kind === 'sound') {
    const kept = keptCount(s);
    return kept >= MIN_EXAMPLES_PER_LABEL
      ? { enabled: true, reason: '' }
      : { enabled: false, reason: `Keep at least ${MIN_EXAMPLES_PER_LABEL} examples. You have ${kept}.` };
  }
  const need = requiredMs(s.kind);
  if (s.elapsedMs >= need) return { enabled: true, reason: '' };
  const left = secondsLeftText(need - s.elapsedMs);
  return {
    enabled: false,
    reason: s.kind === 'hum' ? `Keep humming for ${left}.` : `Let the room make its usual noise for ${left}.`,
  };
}

// Whether the Save button works, and if not, why.
export function saveState(s: TeachState): Gate {
  if (s.phase !== 'review') return { enabled: false, reason: '' };
  if (s.report === null) return { enabled: false, reason: 'Training failed, so there is nothing to save. Record again or cancel.' };
  if (s.kind === 'hum' && s.report.warnings.some((w) => w.code === 'no-pitch-found')) {
    return { enabled: false, reason: 'No steady hum was found, so there is no pitch to save. Record again and hum steadily.' };
  }
  return { enabled: true, reason: '' };
}

export function reduce(s: TeachState, a: TeachAction): TeachState {
  switch (a.type) {
    case 'progress': {
      if ((s.phase !== 'quiet' && s.phase !== 'recording') || s.finishing) return s;
      const elapsedMs = a.t * MS_PER_SECOND;
      if (!Number.isFinite(elapsedMs) || elapsedMs === s.elapsedMs) return s;
      const phase = s.phase === 'quiet' && elapsedMs >= NOISE_FLOOR_WARMUP_MS ? 'recording' : s.phase;
      return { ...s, elapsedMs, phase };
    }
    case 'segment': {
      if (s.kind !== 'sound' || (s.phase !== 'quiet' && s.phase !== 'recording') || s.finishing) return s;
      if (s.examples.some((e) => e.id === a.id)) return s;
      const example: TeachExample = {
        number: s.examples.length + 1, id: a.id, t: a.t, durationMs: a.durationMs, min: a.min, max: a.max, deleted: false,
      };
      return { ...s, phase: 'recording', examples: [...s.examples, example] };
    }
    case 'delete': {
      if (s.phase !== 'recording' || s.finishing) return s;
      const target = s.examples.find((e) => e.id === a.id);
      if (target === undefined || target.deleted) return s;
      return { ...s, examples: s.examples.map((e) => (e === target ? { ...e, deleted: true } : e)) };
    }
    case 'done':
      return doneState(s).enabled ? { ...s, finishing: true } : s;
    case 'trained':
      return s.phase === 'recording' && s.finishing
        ? { ...s, phase: 'review', finishing: false, model: a.model, report: a.report, error: null }
        : s;
    case 'failed':
      return s.phase === 'recording' && s.finishing
        ? { ...s, phase: 'review', finishing: false, model: null, report: null, error: a.message }
        : s;
    case 'limit':
      return (s.phase === 'quiet' || s.phase === 'recording') && !s.limitReached ? { ...s, limitReached: true } : s;
    case 'save':
      return saveState(s).enabled ? { ...s, phase: 'saved' } : s;
    case 'again':
      return s.phase === 'review' ? initialState({ label: s.label, target: s.target }) : s;
    case 'cancel':
      return s.phase === 'saved' || s.phase === 'cancelled' ? s : { ...s, phase: 'cancelled' };
    case 'stored':
      return s.phase === 'saved' ? { ...s, saveStored: a.ok } : s;
  }
}

// The rule of Task 17 as well: a lower-case letter, then lower-case letters, digits or hyphens, 32 characters at most.
export function validateLabel(label: string): string | null {
  return LABEL_RULE.test(label)
    ? null
    : `The label "${label}" is not allowed. Use a lower-case letter first, then lower-case letters, digits or hyphens, at most 32 characters (${LABEL_RULE_TEXT}).`;
}

// With reduced motion the progress display changes at most once per interval. The caller owns the clock.
export function shouldUpdateProgress(o: { reducedMotion: boolean; nowMs: number; lastUpdateMs: number | null }): boolean {
  if (!o.reducedMotion || o.lastUpdateMs === null) return true;
  return o.nowMs - o.lastUpdateMs >= WEB_TEACH_PROGRESS_REDUCED_MOTION_MS;
}
