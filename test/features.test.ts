import { describe, it, expect } from 'vitest';
import { fft } from '../core/dsp/fft';
import { fftSizeFor, melFilterbank, mfccFromPower, windowLengthFor } from '../core/dsp/mfcc';
import { extractFeatures, FEATURE_LENGTH as FEATURE_LENGTH_FROM_FEATURES } from '../core/features';
import { FEATURE_LENGTH, MFCC_COUNT, MEL_FILTER_COUNT } from '../core/constants';
import { rng, synthImpact, synthNoise, synthTone, SYNTH_CLASSES } from '../core/synth';
import { resample } from './helpers/resample';
import type { Segment } from '../core/types';

// Test-only values. The engine never reads these, so they stay out of core/constants.ts.
const RANGE_FRACTION = 0.05;   // allowed difference, as a fraction of the dimension range
const RANGE_FLOOR = 0.01;      // minimum dimension range, so near-constant dimensions do not give an impossible tolerance

// Index layout of the feature vector (Requirement 4.2).
const MFCC_MEAN_START = 0;
const MFCC_STD_START = 12;
const CENTROID = 24;
const DECAY = 25;
const ATTACK = 26;
const ZCR = 27;
const BAND_START = 28;

const CLASS_NAMES = ['low', 'mid', 'high', 'ring'] as const;
type ClassName = (typeof CLASS_NAMES)[number];

// Helpers

function sine(freqHz: number, sampleRate: number, seconds: number, amp = 1): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  return out;
}

function segmentOf(samples: Float32Array, sampleRate: number): Segment {
  return { t: 0, durationMs: (samples.length * 1000) / sampleRate, samples, sampleRate };
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function impactOf(name: ClassName, gainDb: number, sampleRate: number, seed: number): Float32Array {
  return synthImpact({ ...SYNTH_CLASSES[name], gainDb }, sampleRate, rng(seed));
}

function featuresOf(samples: Float32Array, sampleRate: number): number[] {
  return extractFeatures(segmentOf(samples, sampleRate));
}

function dimensionRanges(vectors: number[][]): number[] {
  return Array.from({ length: FEATURE_LENGTH }, (_, d) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of vectors) {
      lo = Math.min(lo, v[d]);
      hi = Math.max(hi, v[d]);
    }
    return Math.max(hi - lo, RANGE_FLOOR);
  });
}

// Checks that each named pair of vectors differs by at most RANGE_FRACTION of the dimension range,
// where the range is taken over all vectors in all pairs.
function expectPairsWithinRange(
  label: string,
  pairs: { name: string; a: number[]; b: number[] }[],
): void {
  const ranges = dimensionRanges(pairs.flatMap((p) => [p.a, p.b]));
  for (const { name, a, b } of pairs) {
    for (let d = 0; d < FEATURE_LENGTH; d++) {
      const diff = Math.abs(a[d] - b[d]);
      const limit = RANGE_FRACTION * ranges[d];
      expect(
        diff,
        `${label}, class ${name}, dimension ${d}: difference ${diff} exceeds limit ${limit}`,
      ).toBeLessThanOrEqual(limit);
    }
  }
}

function expectRangeError(fn: () => unknown, parameterName: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(RangeError);
  expect((caught as Error).message).toContain(parameterName);
}

function directDft(re: Float64Array, im: Float64Array): { re: number[]; im: number[] } {
  const n = re.length;
  const outRe: number[] = [];
  const outIm: number[] = [];
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let i = 0; i < n; i++) {
      const a = (-2 * Math.PI * k * i) / n;
      sr += re[i] * Math.cos(a) - im[i] * Math.sin(a);
      si += re[i] * Math.sin(a) + im[i] * Math.cos(a);
    }
    outRe.push(sr);
    outIm.push(si);
  }
  return { re: outRe, im: outIm };
}

describe('constants', () => {
  it('FEATURE_LENGTH is 32 and features re-exports it', () => {
    expect(FEATURE_LENGTH).toBe(32);
    expect(FEATURE_LENGTH_FROM_FEATURES).toBe(FEATURE_LENGTH);
  });

  it('MFCC count and filter count give 12 kept coefficients', () => {
    expect(MFCC_COUNT - 1).toBe(12);
    expect(MEL_FILTER_COUNT).toBe(26);
  });
});

describe('fft', () => {
  it('a 1 kHz sine at 48000 Hz peaks at the bin nearest 1 kHz', () => {
    const n = 1024;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 1000 * i) / 48000);
    fft(re, im);
    let best = 0;
    for (let k = 1; k <= n / 2; k++) {
      if (Math.hypot(re[k], im[k]) > Math.hypot(re[best], im[best])) best = k;
    }
    expect(best).toBe(Math.round((1000 * n) / 48000));
  });

  it('matches a direct DFT on 64 random samples within 1e-9', () => {
    const rand = rng(2024);
    const n = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = 2 * rand() - 1;
      im[i] = 2 * rand() - 1;
    }
    const expected = directDft(re, im);
    fft(re, im);
    for (let k = 0; k < n; k++) {
      expect(Math.abs(re[k] - expected.re[k])).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(im[k] - expected.im[k])).toBeLessThanOrEqual(1e-9);
    }
  });

  it('an impulse gives a flat spectrum', () => {
    const n = 16;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    re[0] = 1;
    fft(re, im);
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(1, 12);
      expect(im[k]).toBeCloseTo(0, 12);
    }
  });

  it('length 1 is a no-op', () => {
    const re = Float64Array.from([3]);
    const im = Float64Array.from([4]);
    fft(re, im);
    expect(re[0]).toBe(3);
    expect(im[0]).toBe(4);
  });

  it('throws RangeError for length 0, length 3 and mismatched arrays', () => {
    expectRangeError(() => fft(new Float64Array(0), new Float64Array(0)), 'length');
    expectRangeError(() => fft(new Float64Array(3), new Float64Array(3)), 'length');
    expectRangeError(() => fft(new Float64Array(4), new Float64Array(8)), 'length');
  });
});

describe('fftSizeFor and melFilterbank', () => {
  it('gives 1024, 2048, 2048 and 4096 at 16000, 44100, 48000 and 96000 Hz', () => {
    expect(fftSizeFor(16000)).toBe(1024);
    expect(fftSizeFor(44100)).toBe(2048);
    expect(fftSizeFor(48000)).toBe(2048);
    expect(fftSizeFor(96000)).toBe(4096);
  });

  it('gives a 20 ms window: 320, 882, 960 and 1920 samples at 16000, 44100, 48000 and 96000 Hz', () => {
    expect(windowLengthFor(16000)).toBe(320);
    expect(windowLengthFor(44100)).toBe(882);
    expect(windowLengthFor(48000)).toBe(960);
    expect(windowLengthFor(96000)).toBe(1920);
  });

  it('has 26 rows of fftSize/2 + 1 weights, with no weight above min(8000, 0.45 x rate)', () => {
    for (const rate of [16000, 48000]) {
      const n = fftSizeFor(rate);
      const bank = melFilterbank(n, rate);
      expect(bank.length).toBe(26);
      const cap = Math.min(8000, 0.45 * rate);
      for (const row of bank) {
        expect(row.length).toBe(n / 2 + 1);
        for (let k = 0; k < row.length; k++) {
          const freq = (k * rate) / n;
          if (freq > cap) expect(row[k], `rate ${rate}, bin ${k} at ${freq} Hz`).toBe(0);
        }
      }
    }
  });

  it('mfccFromPower returns MFCC_COUNT - 1 finite values, also for silence', () => {
    const rate = 48000;
    const n = fftSizeFor(rate);
    const bank = melFilterbank(n, rate);
    const coeffs = mfccFromPower(new Float64Array(n / 2 + 1), bank);
    expect(coeffs.length).toBe(MFCC_COUNT - 1);
    expect(Array.from(coeffs).every(Number.isFinite)).toBe(true);
  });
});

describe('extractFeatures shape and safety', () => {
  it('returns 32 finite values for 0 samples, 1 sample, 5 ms of noise and 1 s of zeros', () => {
    const cases: Float32Array[] = [
      new Float32Array(0),
      Float32Array.from([0.5]),
      synthNoise('white', 5, -20, 48000, rng(1)),
      new Float32Array(48000),
    ];
    for (const samples of cases) {
      const v = featuresOf(samples, 48000);
      expect(v.length).toBe(FEATURE_LENGTH);
      expect(v.every(Number.isFinite), `length ${samples.length}`).toBe(true);
    }
  });

  it('does not modify the input samples', () => {
    const samples = synthNoise('white', 100, -12, 48000, rng(8));
    const before = Float32Array.from(samples);
    featuresOf(samples, 48000);
    expect(samples).toEqual(before);
  });

  it('is identical for identical input', () => {
    const samples = impactOf('mid', -6, 48000, 3);
    expect(featuresOf(samples, 48000)).toEqual(featuresOf(samples, 48000));
  });

  it('throws RangeError naming sampleRate for 0, negative, NaN and Infinity', () => {
    const samples = new Float32Array(160);
    for (const rate of [0, -16000, NaN, Infinity]) {
      expectRangeError(() => featuresOf(samples, rate), 'sampleRate');
    }
  });
});

describe('feature directions and class separation', () => {
  it('the high class has a larger centroid feature than low', () => {
    const low = featuresOf(impactOf('low', -6, 48000, 1), 48000);
    const high = featuresOf(impactOf('high', -6, 48000, 1), 48000);
    expect(high[CENTROID]).toBeGreaterThan(low[CENTROID]);
  });

  it('the ring class has a larger decay feature than high', () => {
    const high = featuresOf(impactOf('high', -6, 48000, 1), 48000);
    const ring = featuresOf(impactOf('ring', -6, 48000, 1), 48000);
    expect(ring[DECAY]).toBeGreaterThan(high[DECAY]);
  });

  it('the four classes give vectors that differ by more than 5% of range in some dimension, pairwise', () => {
    const vectors = CLASS_NAMES.map((name) => featuresOf(impactOf(name, -6, 48000, 1), 48000));
    const ranges = dimensionRanges(vectors);
    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        const separated = ranges.some((r, d) => Math.abs(vectors[i][d] - vectors[j][d]) > RANGE_FRACTION * r);
        expect(separated, `classes ${CLASS_NAMES[i]} and ${CLASS_NAMES[j]}`).toBe(true);
      }
    }
  });
});

describe('zero crossings, attack, decay and bands', () => {
  it('a 1 kHz sine gives a ZCR feature of 2 at 16000, 48000 and 96000 Hz', () => {
    for (const rate of [16000, 48000, 96000]) {
      const v = featuresOf(sine(1000, rate, 1, 0.5), rate);
      expect(v[ZCR], `rate ${rate}`).toBeCloseTo(2, 2);
    }
  });

  it('attack is about 50 ms later when the impact follows 50 ms of near-silence', () => {
    const rate = 48000;
    const head = synthNoise('white', 50, -90, rate, rng(4));
    const impact = impactOf('mid', -6, rate, 3);
    const attackStart = featuresOf(impact, rate)[ATTACK];
    const attackDelayed = featuresOf(concat(head, impact), rate)[ATTACK];
    // Feature units: 100 ms per 1.0, so 50 ms is 0.5.
    expect(attackDelayed - attackStart).toBeGreaterThan(0.4);
    expect(attackDelayed - attackStart).toBeLessThan(0.6);
  });

  it('a steady tone gives decay + attack equal to its length (no 20 dB drop)', () => {
    const rate = 16000;
    const v = featuresOf(synthTone({ f0Hz: 440, durationMs: 500, gainDb: -6 }, rate), rate);
    expect(v[DECAY] + v[ATTACK]).toBeCloseTo(5, 6);
  });

  it('band ratios add up to 1 for each class and to 0 for silence', () => {
    for (const name of CLASS_NAMES) {
      const v = featuresOf(impactOf(name, -6, 48000, 1), 48000);
      const sum = v.slice(BAND_START, BAND_START + 4).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1), `class ${name}`).toBeLessThanOrEqual(1e-9);
    }
    const silent = featuresOf(new Float32Array(4800), 48000);
    expect(silent.slice(BAND_START, BAND_START + 4)).toEqual([0, 0, 0, 0]);
  });
});

describe('resampler helper', () => {
  it('keeps a 1 kHz sine frequency and amplitude within 2% at 44100 and 48000 Hz', () => {
    const amp = 0.8;
    const src = sine(1000, 96000, 0.3, amp);
    for (const rate of [44100, 48000]) {
      const out = resample(src, 96000, rate);
      // Use the middle of the output to stay away from the edges.
      const from = Math.round(0.05 * rate);
      const to = Math.round(0.25 * rate);
      const mid = out.subarray(from, to);
      let crossings = 0;
      for (let i = 1; i < mid.length; i++) {
        if ((mid[i - 1] < 0) !== (mid[i] < 0)) crossings++;
      }
      const seconds = mid.length / rate;
      const freq = crossings / (2 * seconds);
      expect(Math.abs(freq - 1000) / 1000, `frequency at ${rate}`).toBeLessThanOrEqual(0.02);
      let sumSq = 0;
      for (let i = 0; i < mid.length; i++) sumSq += mid[i] * mid[i];
      const peak = Math.SQRT2 * Math.sqrt(sumSq / mid.length);
      expect(Math.abs(peak - amp) / amp, `amplitude at ${rate}`).toBeLessThanOrEqual(0.02);
    }
  });
});

describe('level and sample-rate independence', () => {
  it('the four classes at -20 dB and 0 dB differ by at most 5% of range in every dimension', () => {
    const pairs = CLASS_NAMES.map((name) => ({
      name,
      a: featuresOf(impactOf(name, -20, 48000, 5), 48000),
      b: featuresOf(impactOf(name, 0, 48000, 5), 48000),
    }));
    expectPairsWithinRange('level -20 dB vs 0 dB', pairs);
  });

  it('the four classes at 44100 and 48000 Hz, from one 96000 Hz synthesis, differ by at most 5% of range', () => {
    const pairs = CLASS_NAMES.map((name, i) => {
      const at96 = impactOf(name, -6, 96000, i + 1);
      return {
        name,
        a: featuresOf(resample(at96, 96000, 44100), 44100),
        b: featuresOf(resample(at96, 96000, 48000), 48000),
      };
    });
    expectPairsWithinRange('rate 44100 Hz vs 48000 Hz', pairs);
  });
});
