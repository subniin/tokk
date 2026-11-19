import {
  BACKGROUND,
  GAP_CONSECUTIVE_MAX_MS,
  GAP_REST_MAX_MS,
  GAP_TOLERANCE_MS,
  HUM_DEADZONE_SEMITONES,
  HUM_SPEED_MAX_SEMITONES,
} from './constants';
import type { MatchEvent, SoundEvent } from './types';

// Conversion factors, not thresholds.
const MS_PER_SECOND = 1000;
const SEMITONES_PER_OCTAVE = 12;

const REST_TOKEN = '_';
const HUM_PREFIX = 'hum.';
const HUM_RISE = 'hum.rise';
const HUM_FALL = 'hum.fall';

export type PatternToken = { type: 'sound'; label: string } | { type: 'rest' };

type GapKind = 'consecutive' | 'rest';
interface Step { label: string; gap: GapKind | null }
interface SoundPattern { src: string; steps: Step[] }
interface PendingSound { label: string; t: number }
interface Compiled {
  sound: SoundPattern[];
  hum: { rise?: string; fall?: string };
}

function bad(src: string, reason: string): RangeError {
  return new RangeError(`Invalid pattern "${src}": ${reason}`);
}

export function parsePattern(src: string): PatternToken[] {
  const words = src.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) throw bad(src, 'the pattern is empty');
  if (words[0] === REST_TOKEN) throw bad(src, 'a pattern cannot start with a rest');
  if (words[words.length - 1] === REST_TOKEN) throw bad(src, 'a pattern cannot end with a rest');
  for (let i = 1; i < words.length; i++) {
    if (words[i] === REST_TOKEN && words[i - 1] === REST_TOKEN) throw bad(src, 'two rests in a row');
  }
  for (const w of words) {
    if (w.startsWith(HUM_PREFIX) && w !== HUM_RISE && w !== HUM_FALL) {
      throw bad(src, `unknown hum token "${w}" (use ${HUM_RISE} or ${HUM_FALL})`);
    }
  }
  if (words.some((w) => w.startsWith(HUM_PREFIX)) && words.length > 1) {
    throw bad(src, 'a hum token cannot be combined with other tokens');
  }
  return words.map((w): PatternToken => (w === REST_TOKEN ? { type: 'rest' } : { type: 'sound', label: w }));
}

function compile(patterns: string[], baselineHz: number | undefined): Compiled {
  const seen = new Map<string, string>();
  const out: Compiled = { sound: [], hum: {} };
  for (const src of patterns) {
    const tokens = parsePattern(src);
    const key = tokens.map((tk) => (tk.type === 'rest' ? REST_TOKEN : tk.label)).join(' ');
    const prior = seen.get(key);
    if (prior !== undefined) throw new RangeError(`Duplicate patterns "${prior}" and "${src}"`);
    seen.set(key, src);
    const first = tokens[0];
    if (first.type === 'sound' && first.label.startsWith(HUM_PREFIX)) {
      if (baselineHz === undefined) {
        throw new RangeError(`Hum pattern "${src}" needs baselineHz, but none was given`);
      }
      if (first.label === HUM_RISE) out.hum.rise = src;
      else out.hum.fall = src;
      continue;
    }
    const steps: Step[] = [];
    let afterRest = false;
    for (const tk of tokens) {
      if (tk.type === 'rest') {
        afterRest = true;
        continue;
      }
      const gap: GapKind | null = steps.length === 0 ? null : afterRest ? 'rest' : 'consecutive';
      steps.push({ label: tk.label, gap });
      afterRest = false;
    }
    out.sound.push({ src, steps });
  }
  return out;
}

function checkBaseline(baselineHz: number | undefined): void {
  if (baselineHz !== undefined && !(Number.isFinite(baselineHz) && baselineHz > 0)) {
    throw new RangeError(`baselineHz must be a finite number above 0, got ${baselineHz}`);
  }
}

function gapMs(a: PendingSound, b: PendingSound): number {
  return (b.t - a.t) * MS_PER_SECOND;
}

function gapOk(kind: GapKind | null, g: number): boolean {
  if (kind === 'consecutive') return g < GAP_CONSECUTIVE_MAX_MS - GAP_TOLERANCE_MS;
  if (kind === 'rest') {
    return g >= GAP_CONSECUTIVE_MAX_MS - GAP_TOLERANCE_MS && g <= GAP_REST_MAX_MS + GAP_TOLERANCE_MS;
  }
  return false;
}

function validPrefix(seq: PendingSound[], p: SoundPattern): boolean {
  if (seq.length > p.steps.length) return false;
  for (let i = 0; i < seq.length; i++) {
    if (seq[i].label !== p.steps[i].label) return false;
    if (i >= 1 && !gapOk(p.steps[i].gap, gapMs(seq[i - 1], seq[i]))) return false;
  }
  return true;
}

export class Matcher {
  private soundPatterns: SoundPattern[] = [];
  private hum: Compiled['hum'] = {};
  private pending: PendingSound[] = [];
  private now = -Infinity;
  private readonly baselineHz: number | undefined;

  constructor(patterns: string[], baselineHz?: number) {
    checkBaseline(baselineHz);
    this.baselineHz = baselineHz;
    this.apply(compile(patterns, baselineHz));
  }

  setPatterns(patterns: string[]): void {
    const compiled = compile(patterns, this.baselineHz);
    this.apply(compiled);
    this.pending = [];
  }

  push(e: SoundEvent): MatchEvent[] {
    if (e.kind === 'continuous') return this.pushContinuous(e);
    if (e.label === BACKGROUND) return [];
    if (!Number.isFinite(e.t)) throw new RangeError(`Sound time t must be finite, got ${e.t}`);
    const last = this.pending[this.pending.length - 1];
    if (last !== undefined && e.t < last.t) {
      throw new RangeError(`Sound at t=${e.t} is earlier than the pending sound at t=${last.t}`);
    }
    this.now = Math.max(this.now, e.t);
    const s: PendingSound = { label: e.label, t: e.t };
    const out: MatchEvent[] = [];
    const seq = [...this.pending, s];
    if (this.pending.length > 0 && this.anyValidPrefix(seq)) {
      this.pending = seq;
    } else {
      if (this.pending.length > 0) out.push(...this.fire(this.pending));
      this.pending = this.anyValidPrefix([s]) ? [s] : [];
    }
    if (this.pending.length > 0) out.push(...this.settle());
    return out;
  }

  advance(t: number): MatchEvent[] {
    if (Number.isNaN(t)) throw new RangeError('advance(t): t must not be NaN');
    this.now = Math.max(this.now, t);
    if (this.pending.length === 0) return [];
    const last = this.pending[this.pending.length - 1];
    const elapsedMs = (this.now - last.t) * MS_PER_SECOND;
    const anyAlive = this.candidates(this.pending).some((p) => {
      const kind = p.steps[this.pending.length].gap;
      return kind === 'consecutive'
        ? elapsedMs < GAP_CONSECUTIVE_MAX_MS - GAP_TOLERANCE_MS
        : elapsedMs <= GAP_REST_MAX_MS + GAP_TOLERANCE_MS;
    });
    if (anyAlive) return [];
    const out = this.fire(this.pending);
    this.pending = [];
    return out;
  }

  private apply(c: Compiled): void {
    this.soundPatterns = c.sound;
    this.hum = c.hum;
  }

  private pushContinuous(e: Extract<SoundEvent, { kind: 'continuous' }>): MatchEvent[] {
    if (e.phase !== 'update') return [];
    if (!Number.isFinite(e.t)) throw new RangeError(`Pitch time t must be finite, got ${e.t}`);
    if (!(Number.isFinite(e.value) && e.value > 0)) {
      throw new RangeError(`Pitch value must be a finite number above 0, got ${e.value}`);
    }
    if (this.baselineHz === undefined) return [];
    const s = SEMITONES_PER_OCTAVE * Math.log2(e.value / this.baselineHz);
    if (s > HUM_DEADZONE_SEMITONES && this.hum.rise !== undefined) {
      return [{ pattern: this.hum.rise, t: e.t, speed: Math.min(s - HUM_DEADZONE_SEMITONES, HUM_SPEED_MAX_SEMITONES) }];
    }
    if (s < -HUM_DEADZONE_SEMITONES && this.hum.fall !== undefined) {
      return [{ pattern: this.hum.fall, t: e.t, speed: Math.min(-s - HUM_DEADZONE_SEMITONES, HUM_SPEED_MAX_SEMITONES) }];
    }
    return [];
  }

  private anyValidPrefix(seq: PendingSound[]): boolean {
    return this.soundPatterns.some((p) => validPrefix(seq, p));
  }

  private exact(seq: PendingSound[]): SoundPattern | undefined {
    return this.soundPatterns.find((p) => p.steps.length === seq.length && validPrefix(seq, p));
  }

  private candidates(seq: PendingSound[]): SoundPattern[] {
    return this.soundPatterns.filter((p) => p.steps.length > seq.length && validPrefix(seq, p));
  }

  private fire(seq: PendingSound[]): MatchEvent[] {
    const p = this.exact(seq);
    return p === undefined ? [] : [{ pattern: p.src, t: seq[seq.length - 1].t }];
  }

  // Fire at once when the sequence matches exactly and nothing longer can extend it.
  private settle(): MatchEvent[] {
    if (this.exact(this.pending) !== undefined && this.candidates(this.pending).length === 0) {
      const out = this.fire(this.pending);
      this.pending = [];
      return out;
    }
    return [];
  }
}
