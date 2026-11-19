// Hum pitch tracker (YIN) and the median pitch of a recording (Task 6, design 5.4).
// Pure TypeScript: no I/O, DOM, Web Audio, clock or randomness.
//
// Pipeline: input -> 2nd-order low-pass -> linear interpolation to 8 kHz -> YIN over a 40 ms window every 10 ms hop.
// A hop is voiced when it is loud enough, has little energy above 1 kHz, is periodic between 80 and 400 Hz and its
// pitch is stable against the previous hop. A run of voiced hops makes a hum.

import {
  HUM_END_UNVOICED_MS,
  HUM_START_VOICED_MS,
  PITCH_ANALYSIS_RATE_HZ,
  PITCH_FILTER_Q,
  PITCH_HIGH_BAND_MIN_HZ,
  PITCH_HIGH_ENERGY_RATIO_MAX,
  PITCH_HOP_MS,
  PITCH_LOWPASS_HZ,
  PITCH_MAX_HZ,
  PITCH_MAX_STEP_SEMITONES,
  PITCH_MIN_HZ,
  PITCH_MIN_LEVEL_DBFS,
  SAMPLE_RATE_MAX_HZ,
  SAMPLE_RATE_MIN_HZ,
  SILENCE_LEVEL_DBFS,
  YIN_THRESHOLD,
  YIN_WINDOW_MS,
} from '../constants';
import type { ContinuousTracker, PitchEvent } from './tracker';

const MS_PER_SECOND = 1000;
const SEMITONES_PER_OCTAVE = 12;
const DB_POWER_DIVISOR = 10;
const TWO_PI = 2 * Math.PI;
const MIDDLE = 2;

// Derived counts. Nothing here is a number written by hand.
const HOPS_PER_WINDOW = Math.round(YIN_WINDOW_MS / PITCH_HOP_MS);
const START_HOPS = Math.ceil(HUM_START_VOICED_MS / PITCH_HOP_MS);
const END_HOPS = Math.ceil(HUM_END_UNVOICED_MS / PITCH_HOP_MS);
const OUT_PER_HOP = Math.round((PITCH_ANALYSIS_RATE_HZ * PITCH_HOP_MS) / MS_PER_SECOND);
const WINDOW_OUT = HOPS_PER_WINDOW * OUT_PER_HOP;
const MIN_LAG = Math.floor(PITCH_ANALYSIS_RATE_HZ / PITCH_MAX_HZ);
const MAX_LAG = Math.ceil(PITCH_ANALYSIS_RATE_HZ / PITCH_MIN_HZ);
const LAGS = MAX_LAG + 1; // one lag beyond the longest, for interpolation
const INTEGRATION = WINDOW_OUT - LAGS;

function checkSampleRate(sampleRate: number): void {
  if (!(Number.isFinite(sampleRate) && sampleRate >= SAMPLE_RATE_MIN_HZ && sampleRate <= SAMPLE_RATE_MAX_HZ)) {
    throw new RangeError(
      `sampleRate must be between ${SAMPLE_RATE_MIN_HZ} and ${SAMPLE_RATE_MAX_HZ} Hz, got ${sampleRate}.`,
    );
  }
}

// RBJ 2nd-order filter, direct form I. `high` selects the high-pass.
class Biquad {
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(cutoffHz: number, sampleRate: number, high: boolean) {
    const w0 = (TWO_PI * cutoffHz) / sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * PITCH_FILTER_Q);
    const a0 = 1 + alpha;
    const edge = high ? 1 + cos : 1 - cos;
    this.b0 = edge / MIDDLE / a0;
    this.b1 = (high ? -edge : edge) / a0;
    this.b2 = this.b0;
    this.a1 = (-MIDDLE * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

type Range = { start: number; end: number | null };

// Shared analysis. PitchTracker is the public face; medianPitchHz reads `humPitches`.
class Analyzer {
  protected readonly sampleRate: number;
  private readonly low: Biquad;
  private readonly high: Biquad;

  // Resampler and hop grid.
  private inCount = 0;
  private prevLow = 0;
  private outIndex = 0;
  private outWhole = 0;
  private outRem = 0;
  private hop = 0;
  private nextHopEnd: number;
  private lastHopEnd = 0;
  private readonly ring = new Float64Array(WINDOW_OUT);
  private ringCount = 0;

  // Energy blocks, one per hop of the window, in sample order.
  private totalSum = 0;
  private highSum = 0;
  private readonly blockTotal = new Float64Array(HOPS_PER_WINDOW);
  private readonly blockHigh = new Float64Array(HOPS_PER_WINDOW);
  private readonly blockSamples = new Float64Array(HOPS_PER_WINDOW);

  private readonly window = new Float64Array(WINDOW_OUT);
  private readonly diff = new Float64Array(LAGS + 1);
  private readonly norm = new Float64Array(LAGS + 1);

  // Hum state.
  private prevCandidateHz: number | null = null;
  private voicedCount = 0;
  private runHops: number[] = [];
  private runPitches: number[] = [];
  private unvoicedCount = 0;
  private active = false;
  private lastVoicedHz = 0;
  private lastHopTime = 0;
  private hopsAnalysed = 0;
  protected readonly ranges: Range[] = [];
  readonly humPitches: number[] = [];

  constructor(sampleRate: number) {
    checkSampleRate(sampleRate);
    this.sampleRate = sampleRate;
    this.low = new Biquad(PITCH_LOWPASS_HZ, sampleRate, false);
    this.high = new Biquad(PITCH_HIGH_BAND_MIN_HZ, sampleRate, true);
    this.nextHopEnd = this.hopEnd(1);
  }

  private hopEnd(h: number): number {
    return Math.round((h * this.sampleRate * PITCH_HOP_MS) / MS_PER_SECOND);
  }

  private hopTime(h: number): number {
    return this.hopEnd(h) / this.sampleRate;
  }

  consume(chunk: Float32Array): PitchEvent[] {
    const events: PitchEvent[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const x = chunk[i];
      const lp = this.low.step(x);
      const hp = this.high.step(x);
      this.totalSum += x * x;
      this.highSum += hp * hp;

      // Output sample j sits at input position j x sampleRate / PITCH_ANALYSIS_RATE_HZ, from integers only.
      // It needs the input samples `whole` and `whole + 1`, so it is made when `whole + 1` arrives.
      while (this.inCount > 0 && this.outWhole + 1 === this.inCount) {
        const frac = this.outRem / PITCH_ANALYSIS_RATE_HZ;
        this.ring[this.ringCount % WINDOW_OUT] = this.prevLow * (1 - frac) + lp * frac;
        this.ringCount++;
        this.outIndex++;
        const num = this.outIndex * this.sampleRate;
        this.outRem = num % PITCH_ANALYSIS_RATE_HZ;
        this.outWhole = (num - this.outRem) / PITCH_ANALYSIS_RATE_HZ;
      }
      this.prevLow = lp;
      this.inCount++;

      if (this.inCount === this.nextHopEnd) {
        const event = this.finishHop();
        if (event.length > 0) events.push(...event);
      }
    }
    return events;
  }

  private finishHop(): PitchEvent[] {
    this.hop++;
    const slot = (this.hop - 1) % HOPS_PER_WINDOW;
    this.blockTotal[slot] = this.totalSum;
    this.blockHigh[slot] = this.highSum;
    this.blockSamples[slot] = this.inCount - this.lastHopEnd;
    this.totalSum = 0;
    this.highSum = 0;
    this.lastHopEnd = this.inCount;
    this.nextHopEnd = this.hopEnd(this.hop + 1);
    if (this.hop < HOPS_PER_WINDOW) return [];
    this.hopsAnalysed = this.hop;
    this.lastHopTime = this.hopTime(this.hop);
    const f0 = this.analyse();
    return this.advance(f0);
  }

  // Returns f0 of a voiced hop, or null. Updates the previous-candidate reference.
  private analyse(): number | null {
    let total = 0;
    let high = 0;
    let n = 0;
    for (let k = 0; k < HOPS_PER_WINDOW; k++) {
      total += this.blockTotal[k];
      high += this.blockHigh[k];
      n += this.blockSamples[k];
    }
    const levelDb = total === 0 ? SILENCE_LEVEL_DBFS : DB_POWER_DIVISOR * Math.log10(total / n);
    let candidate: number | null = null;
    if (levelDb >= PITCH_MIN_LEVEL_DBFS && high / total < PITCH_HIGH_ENERGY_RATIO_MAX) {
      candidate = this.yin();
    }
    const previous = this.prevCandidateHz;
    this.prevCandidateHz = candidate;
    if (candidate === null) return null;
    if (previous !== null) {
      const step = Math.abs(SEMITONES_PER_OCTAVE * Math.log2(candidate / previous));
      if (step > PITCH_MAX_STEP_SEMITONES) return null;
    }
    return candidate;
  }

  // f0 in Hz of the current 8 kHz window, or null.
  private yin(): number | null {
    const w = this.window;
    const start = this.ringCount - WINDOW_OUT;
    for (let k = 0; k < WINDOW_OUT; k++) w[k] = this.ring[(start + k) % WINDOW_OUT];
    const d = this.diff;
    for (let tau = 1; tau <= LAGS; tau++) {
      let sum = 0;
      for (let k = 0; k < INTEGRATION; k++) {
        const e = w[k] - w[k + tau];
        sum += e * e;
      }
      d[tau] = sum;
    }
    const c = this.norm;
    let running = 0;
    for (let tau = 1; tau <= LAGS; tau++) {
      running += d[tau];
      if (running === 0) return null;
      c[tau] = (d[tau] * tau) / running;
    }
    let tau = MIN_LAG;
    while (tau <= MAX_LAG && !(c[tau] < YIN_THRESHOLD)) tau++;
    if (tau > MAX_LAG) return null;
    while (tau < MAX_LAG && c[tau + 1] < c[tau]) tau++;
    const s0 = c[tau - 1];
    const s1 = c[tau];
    const s2 = c[tau + 1];
    const denominator = s0 - MIDDLE * s1 + s2;
    let refined = tau;
    if (denominator > 0) refined += Math.max(-1, Math.min(1, (s0 - s2) / (MIDDLE * denominator)));
    // The integer lag is inside the search range, so interpolation may only overshoot the edge by a fraction of a lag.
    return Math.max(PITCH_MIN_HZ, Math.min(PITCH_MAX_HZ, PITCH_ANALYSIS_RATE_HZ / refined));
  }

  // The hum state machine (Requirement 5) and the range list (Requirement 6).
  private advance(f0: number | null): PitchEvent[] {
    const t = this.lastHopTime;
    const out: PitchEvent[] = [];
    if (!this.active) {
      if (f0 === null) {
        this.voicedCount = 0;
        this.runHops = [];
        this.runPitches = [];
        return out;
      }
      this.voicedCount++;
      this.runHops.push(this.hop);
      this.runPitches.push(f0);
      if (this.voicedCount >= START_HOPS) {
        this.active = true;
        this.unvoicedCount = 0;
        this.lastVoicedHz = f0;
        this.humPitches.push(...this.runPitches);
        this.ranges.push({ start: this.hopTime(Math.max(0, this.runHops[0] - HOPS_PER_WINDOW)), end: null });
        this.runHops = [];
        this.runPitches = [];
        out.push({ kind: 'continuous', name: 'pitch', phase: 'start', t, value: f0 });
      }
      return out;
    }
    if (f0 !== null) {
      this.unvoicedCount = 0;
      this.lastVoicedHz = f0;
      this.humPitches.push(f0);
      out.push({ kind: 'continuous', name: 'pitch', phase: 'update', t, value: f0 });
      return out;
    }
    this.unvoicedCount++;
    if (this.unvoicedCount >= END_HOPS) {
      this.active = false;
      this.voicedCount = 0;
      this.unvoicedCount = 0;
      this.ranges[this.ranges.length - 1].end = t;
      out.push({ kind: 'continuous', name: 'pitch', phase: 'end', t, value: this.lastVoicedHz });
    }
    return out;
  }

  finish(): PitchEvent[] {
    const out: PitchEvent[] = [];
    if (this.active) {
      const t = this.hopsAnalysed > 0 ? this.lastHopTime : 0;
      this.ranges[this.ranges.length - 1].end = t;
      out.push({ kind: 'continuous', name: 'pitch', phase: 'end', t, value: this.lastVoicedHz });
      this.active = false;
    }
    this.voicedCount = 0;
    this.unvoicedCount = 0;
    this.runHops = [];
    this.runPitches = [];
    this.prevCandidateHz = null;
    return out;
  }
}

export class PitchTracker extends Analyzer implements ContinuousTracker {
  push(chunk: Float32Array): PitchEvent[] {
    return chunk.length === 0 ? [] : this.consume(chunk);
  }

  flush(): PitchEvent[] {
    return this.finish();
  }

  voicedRanges(): Range[] {
    return this.ranges.map((r) => ({ start: r.start, end: r.end }));
  }
}

// Median f0 of the voiced hops that lie inside a hum, or null when the recording has no hum.
export function medianPitchHz(samples: Float32Array, sampleRate: number): number | null {
  const analyzer = new Analyzer(sampleRate);
  analyzer.consume(samples);
  const v = [...analyzer.humPitches].sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / MIDDLE);
  return v.length % MIDDLE === 1 ? v[mid] : (v[mid - 1] + v[mid]) / MIDDLE;
}
