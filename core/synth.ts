// Deterministic synthesis of test sounds: impacts, tones, noise and placement on a timeline.
// Output depends only on the arguments and the random function passed in. No I/O, DOM, Web Audio, or unseeded randomness.

import {
  SYNTH_FADE_OUT_MS,
  SYNTH_MAX_DURATION_MS,
  SYNTH_BANDWIDTH_FRACTION,
  SYNTH_DURATION_DECAY_MULTIPLE,
  SYNTH_TONE_HARMONICS,
  SYNTH_VIBRATO_RATE_HZ,
} from './constants';

export interface ImpactParams {
  centerHz: number;
  bandwidthHz: number;
  decayMs: number;
  durationMs: number;
  gainDb: number;
}

export interface ToneParams {
  f0Hz: number;
  durationMs: number;
  gainDb: number;
  vibratoCents?: number;
  glideToHz?: number;
}

type ImpactClass = Omit<ImpactParams, 'gainDb'>;

const TWO_PI = 2 * Math.PI;
const CENTS_PER_OCTAVE = 1200;
const MS_PER_SECOND = 1000;
const RNG_INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 4294967296;

function checkPositive(name: string, value: number): void {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}.`);
  }
}

function checkFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, got ${value}.`);
  }
}

function checkBelowNyquist(name: string, hz: number, sampleRate: number): void {
  // Written as a negated comparison so that NaN also fails.
  if (!(hz < sampleRate / 2)) {
    throw new RangeError(`${name} must be below the Nyquist frequency (${sampleRate / 2} Hz), got ${hz}.`);
  }
}

function sampleCount(durationMs: number, sampleRate: number): number {
  return Math.round((durationMs * sampleRate) / MS_PER_SECOND);
}

// Linear fade to exactly 0 over the last SYNTH_FADE_OUT_MS. The final sample is multiplied by 0.
function applyFadeOut(x: Float64Array, sampleRate: number): void {
  const n = x.length;
  const fade = Math.min(n, sampleCount(SYNTH_FADE_OUT_MS, sampleRate));
  for (let k = 0; k < fade; k++) {
    x[n - fade + k] *= (fade - 1 - k) / fade;
  }
}

// Multiply so that max |x| equals 10^(gainDb/20). A silent signal is returned unchanged.
function scaleToPeak(x: Float64Array, gainDb: number): void {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak === 0) return;
  const gain = Math.pow(10, gainDb / 20) / peak;
  for (let i = 0; i < x.length; i++) x[i] *= gain;
}

// Multiply so that the RMS over the whole clip equals 10^(gainDb/20). A silent signal is returned unchanged.
function scaleToRms(x: Float64Array, gainDb: number): void {
  let sumSquares = 0;
  for (let i = 0; i < x.length; i++) sumSquares += x[i] * x[i];
  if (sumSquares === 0) return;
  const gain = Math.pow(10, gainDb / 20) / Math.sqrt(sumSquares / x.length);
  for (let i = 0; i < x.length; i++) x[i] *= gain;
}

// mulberry32. Returns a generator of numbers in [0, 1).
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + RNG_INCREMENT) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

// White noise through a 2nd-order band-pass (RBJ constant 0 dB peak gain), then an exp(-t / decayMs) envelope.
export function synthImpact(p: ImpactParams, sampleRate: number, rand: () => number): Float32Array {
  checkPositive('durationMs', p.durationMs);
  checkPositive('decayMs', p.decayMs);
  checkPositive('bandwidthHz', p.bandwidthHz);
  checkPositive('sampleRate', sampleRate);
  checkPositive('centerHz', p.centerHz);
  checkBelowNyquist('centerHz', p.centerHz, sampleRate);
  checkFinite('gainDb', p.gainDb);

  const n = sampleCount(p.durationMs, sampleRate);
  const q = p.centerHz / p.bandwidthHz;
  const w0 = (TWO_PI * p.centerHz) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - alpha) / a0;

  const out = new Float64Array(n);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    const x0 = 2 * rand() - 1;
    const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    const tMs = (i * MS_PER_SECOND) / sampleRate;
    out[i] = y0 * Math.exp(-tMs / p.decayMs);
  }

  applyFadeOut(out, sampleRate);
  scaleToPeak(out, p.gainDb);
  return Float32Array.from(out);
}

// Fundamental plus SYNTH_TONE_HARMONICS harmonics at amplitude 1/h. Phase is accumulated per sample,
// so vibrato and glide do not create phase jumps.
export function synthTone(p: ToneParams, sampleRate: number): Float32Array {
  checkPositive('durationMs', p.durationMs);
  checkPositive('sampleRate', sampleRate);
  checkBelowNyquist('f0Hz', p.f0Hz, sampleRate);
  checkFinite('gainDb', p.gainDb);
  if (p.vibratoCents !== undefined) checkFinite('vibratoCents', p.vibratoCents);
  if (p.glideToHz !== undefined) checkFinite('glideToHz', p.glideToHz);

  const n = sampleCount(p.durationMs, sampleRate);
  const nyquist = sampleRate / 2;
  const out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const glideFraction = n > 1 ? i / (n - 1) : 0;
    let f = p.glideToHz === undefined ? p.f0Hz : p.f0Hz + (p.glideToHz - p.f0Hz) * glideFraction;
    if (p.vibratoCents !== undefined) {
      f *= Math.pow(2, (p.vibratoCents * Math.sin(TWO_PI * SYNTH_VIBRATO_RATE_HZ * t)) / CENTS_PER_OCTAVE);
    }
    phase = (phase + (TWO_PI * f) / sampleRate) % TWO_PI;

    let sample = 0;
    for (let h = 1; h <= 1 + SYNTH_TONE_HARMONICS; h++) {
      if (h * f < nyquist) sample += Math.sin(h * phase) / h;
    }
    out[i] = sample;
  }

  applyFadeOut(out, sampleRate);
  scaleToPeak(out, p.gainDb);
  return Float32Array.from(out);
}

// White noise uses one uniform value per sample. Pink noise is Paul Kellet's refined filter on the same
// white input. The result is scaled to the requested RMS level.
export function synthNoise(
  kind: 'white' | 'pink',
  durationMs: number,
  gainDb: number,
  sampleRate: number,
  rand: () => number,
): Float32Array {
  if (kind !== 'white' && kind !== 'pink') {
    throw new RangeError(`kind must be 'white' or 'pink', got ${String(kind)}.`);
  }
  checkPositive('durationMs', durationMs);
  checkPositive('sampleRate', sampleRate);
  checkFinite('gainDb', gainDb);

  const n = sampleCount(durationMs, sampleRate);
  const out = new Float64Array(n);
  if (kind === 'white') {
    for (let i = 0; i < n; i++) out[i] = 2 * rand() - 1;
  } else {
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < n; i++) {
      const white = 2 * rand() - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
    }
  }
  scaleToRms(out, gainDb);
  return Float32Array.from(out);
}

// Sums clips onto a silent timeline. Clips are added without scaling. Parts past the end are cut.
export function place(
  clips: { atMs: number; samples: Float32Array }[],
  totalMs: number,
  sampleRate: number,
): Float32Array {
  checkFinite('totalMs', totalMs);
  if (totalMs < 0) throw new RangeError(`totalMs must not be negative, got ${totalMs}.`);
  checkPositive('sampleRate', sampleRate);

  const total = sampleCount(totalMs, sampleRate);
  const out = new Float32Array(total);
  for (const clip of clips) {
    if (!(clip.atMs >= 0)) {
      throw new RangeError(`atMs must not be negative, got ${clip.atMs}.`);
    }
    const start = Math.round((clip.atMs * sampleRate) / MS_PER_SECOND);
    const count = Math.min(clip.samples.length, total - start);
    for (let j = 0; j < count; j++) out[start + j] += clip.samples[j];
  }
  return out;
}

function impactClass(centerHz: number, decayMs: number): ImpactClass {
  return {
    centerHz,
    bandwidthHz: centerHz * SYNTH_BANDWIDTH_FRACTION,
    decayMs,
    durationMs: Math.min(decayMs * SYNTH_DURATION_DECAY_MULTIPLE, SYNTH_MAX_DURATION_MS),
  };
}

// Four distinct impact sounds for property tests. Add a gainDb to use one with synthImpact.
export const SYNTH_CLASSES: Record<'low' | 'mid' | 'high' | 'ring', ImpactClass> = {
  low: impactClass(300, 120),
  mid: impactClass(1200, 60),
  high: impactClass(3500, 25),
  ring: impactClass(2000, 200),
};
