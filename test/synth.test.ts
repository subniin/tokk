import { describe, it, expect } from 'vitest';
import { rng, synthImpact, synthTone, synthNoise, place, SYNTH_CLASSES } from '../core/synth';
import {
  SYNTH_FADE_OUT_MS,
  SYNTH_MAX_DURATION_MS,
  SYNTH_BANDWIDTH_FRACTION,
  SYNTH_DURATION_DECAY_MULTIPLE,
} from '../core/constants';

// Helpers. Direct DFT is used because no FFT exists before Task 3.

function take(next: () => number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(next());
  return out;
}

function peakAbs(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

function toDb(v: number): number {
  return 20 * Math.log10(v);
}

function powerToDb(p: number): number {
  return 10 * Math.log10(p);
}

function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
}

function meanAbs(x: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += Math.abs(x[i]);
  return s / (to - from);
}

// Largest RMS over any window of w consecutive samples.
function maxWindowRms(x: Float32Array, w: number): number {
  let s = 0;
  for (let i = 0; i < w; i++) s += x[i] * x[i];
  let best = s;
  for (let i = w; i < x.length; i++) {
    s += x[i] * x[i] - x[i - w] * x[i - w];
    best = Math.max(best, s);
  }
  return Math.sqrt(best / w);
}

// Amplitude of one sinusoid at frequency f, from a direct DFT over [from, to).
function dftAmp(x: Float32Array, fs: number, f: number, from = 0, to = x.length): number {
  const n = to - from;
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * f * i) / fs;
    re += x[from + i] * Math.cos(a);
    im += x[from + i] * Math.sin(a);
  }
  return (2 * Math.hypot(re, im)) / n;
}

// Power summed over DFT bins (1 Hz spacing, so the clip must be exactly fs samples long),
// grouped into octave bands. Each band sums the power of every 10 Hz bin it contains.
function octaveBandPowers(signals: Float32Array[], fs: number, edgesHz: number[], stepHz: number): number[] {
  const n = signals[0].length;
  expect(n).toBe(fs);
  const cosT = new Float64Array(n);
  const sinT = new Float64Array(n);
  for (let m = 0; m < n; m++) {
    const a = (2 * Math.PI * m) / n;
    cosT[m] = Math.cos(a);
    sinT[m] = Math.sin(a);
  }
  const bands = new Array<number>(edgesHz.length - 1).fill(0);
  for (let f = edgesHz[0]; f < edgesHz[edgesHz.length - 1]; f += stepHz) {
    const k = (f * n) / fs;
    let power = 0;
    for (const x of signals) {
      let re = 0;
      let im = 0;
      let m = 0;
      for (let i = 0; i < n; i++) {
        re += x[i] * cosT[m];
        im += x[i] * sinT[m];
        m += k;
        if (m >= n) m -= n;
      }
      power += re * re + im * im;
    }
    const b = edgesHz.findIndex((edge, idx) => idx < edgesHz.length - 1 && f >= edge && f < edgesHz[idx + 1]);
    bands[b] += power;
  }
  return bands;
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

describe('rng', () => {
  it('gives the same sequence for the same seed', () => {
    expect(take(rng(12345), 100)).toEqual(take(rng(12345), 100));
  });

  it('gives different first values for seeds 1 and 2', () => {
    expect(take(rng(1), 8)).not.toEqual(take(rng(2), 8));
  });

  it('returns values in [0, 1)', () => {
    const values = take(rng(99), 10000);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('matches the recorded mulberry32 values for seed 1', () => {
    expect(take(rng(1), 8)).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
      0.9683778982143849, 0.281103502959013, 0.6128388606011868, 0.7207431411370635,
    ]);
  });
});

describe('determinism', () => {
  it('synthImpact gives identical arrays for equal parameters and seeds', () => {
    const p = { ...SYNTH_CLASSES.mid, gainDb: -6 };
    expect(synthImpact(p, 48000, rng(3))).toEqual(synthImpact(p, 48000, rng(3)));
  });

  it('synthImpact differs for different seeds', () => {
    const p = { ...SYNTH_CLASSES.mid, gainDb: -6 };
    expect(synthImpact(p, 48000, rng(1))).not.toEqual(synthImpact(p, 48000, rng(2)));
  });

  it('white synthNoise gives identical arrays for equal seeds', () => {
    expect(synthNoise('white', 200, -20, 16000, rng(5))).toEqual(synthNoise('white', 200, -20, 16000, rng(5)));
  });

  it('pink synthNoise gives identical arrays for equal seeds', () => {
    expect(synthNoise('pink', 200, -20, 16000, rng(5))).toEqual(synthNoise('pink', 200, -20, 16000, rng(5)));
  });

  it('synthTone gives identical arrays for equal parameters', () => {
    const p = { f0Hz: 440, durationMs: 200, gainDb: -6, vibratoCents: 30, glideToHz: 660 };
    expect(synthTone(p, 16000)).toEqual(synthTone(p, 16000));
  });
});

describe('synthImpact level', () => {
  it('peak level matches gainDb within 1 dB at -20, 0 and +6 dB', () => {
    for (const gainDb of [-20, 0, 6]) {
      const x = synthImpact({ ...SYNTH_CLASSES.mid, gainDb }, 48000, rng(7));
      expect(Math.abs(toDb(peakAbs(x)) - gainDb)).toBeLessThanOrEqual(1);
    }
  });

  it('level at 3 x decayMs is at least 20 dB below peak for low, mid and high', () => {
    const fs = 48000;
    const w = Math.round((2 * fs) / 1000); // 2 ms window
    for (const name of ['low', 'mid', 'high'] as const) {
      const c = SYNTH_CLASSES[name];
      const t3 = Math.round((SYNTH_DURATION_DECAY_MULTIPLE * c.decayMs * fs) / 1000);
      // The class duration ends at 3 x decayMs, so the fade-out would sit on the measured point.
      // This check uses a duration that ends 10 ms later, so the envelope is measured before the fade.
      const x = synthImpact(
        { ...c, durationMs: SYNTH_DURATION_DECAY_MULTIPLE * c.decayMs + SYNTH_FADE_OUT_MS, gainDb: -6 },
        fs,
        rng(21),
      );
      const levelAt = rms(x, t3 - w, t3);
      const peakLevel = maxWindowRms(x, w);
      expect(toDb(levelAt / peakLevel)).toBeLessThanOrEqual(-20);
    }
  });
});

describe('synthTone spectrum and level', () => {
  it('strongest spectral peak is at f0 within 5 Hz, with harmonics near 1/2, 1/3, 1/4', () => {
    const fs = 16000;
    const f0 = 500;
    const x = synthTone({ f0Hz: f0, durationMs: 1000, gainDb: 0 }, fs);
    // The first 500 ms hold no fade-out and contain whole cycles of 500 Hz, 1000 Hz and so on.
    const win = Math.round((500 * fs) / 1000);
    let bestF = 0;
    let bestA = -1;
    for (let f = 50; f <= 4000; f += 5) {
      const a = dftAmp(x, fs, f, 0, win);
      if (a > bestA) {
        bestA = a;
        bestF = f;
      }
    }
    expect(Math.abs(bestF - f0)).toBeLessThanOrEqual(5);

    const a1 = dftAmp(x, fs, f0, 0, win);
    expect(dftAmp(x, fs, 2 * f0, 0, win) / a1).toBeCloseTo(1 / 2, 2);
    expect(dftAmp(x, fs, 3 * f0, 0, win) / a1).toBeCloseTo(1 / 3, 2);
    expect(dftAmp(x, fs, 4 * f0, 0, win) / a1).toBeCloseTo(1 / 4, 2);
  });

  it('peak matches gainDb within 1 dB', () => {
    const x = synthTone({ f0Hz: 440, durationMs: 300, gainDb: -12 }, 16000);
    expect(Math.abs(toDb(peakAbs(x)) - -12)).toBeLessThanOrEqual(1);
  });

  it('glide and vibrato return the right length with no NaN', () => {
    const fs = 16000;
    const glide = synthTone({ f0Hz: 300, glideToHz: 900, durationMs: 500, gainDb: -6 }, fs);
    expect(glide.length).toBe(Math.round((500 * fs) / 1000));
    expect(glide.some((v) => Number.isNaN(v))).toBe(false);
    expect(Math.abs(toDb(peakAbs(glide)) - -6)).toBeLessThanOrEqual(1);

    const vib = synthTone({ f0Hz: 440, vibratoCents: 50, durationMs: 300, gainDb: -6 }, fs);
    expect(vib.length).toBe(Math.round((300 * fs) / 1000));
    expect(vib.some((v) => Number.isNaN(v))).toBe(false);
    expect(Math.abs(toDb(peakAbs(vib)) - -6)).toBeLessThanOrEqual(1);
  });
});

describe('fade-out', () => {
  it('the last 10 ms of a 400 ms ring impact fade to 0', () => {
    const fs = 48000;
    const x = synthImpact({ ...SYNTH_CLASSES.ring, gainDb: -6 }, fs, rng(9));
    expect(x.length).toBe(Math.round((SYNTH_MAX_DURATION_MS * fs) / 1000));
    expect(Math.abs(x[x.length - 1])).toBe(0);
    const fade = Math.round((SYNTH_FADE_OUT_MS * fs) / 1000);
    const oneMs = Math.round(fs / 1000);
    const last = meanAbs(x, x.length - oneMs, x.length);
    const beforeFade = meanAbs(x, x.length - fade - oneMs, x.length - fade);
    expect(last).toBeLessThan(0.5 * beforeFade);
  });

  it('the last 10 ms of a tone fade to 0', () => {
    const fs = 16000;
    const x = synthTone({ f0Hz: 440, durationMs: 400, gainDb: -6 }, fs);
    expect(Math.abs(x[x.length - 1])).toBe(0);
    const fade = Math.round((SYNTH_FADE_OUT_MS * fs) / 1000);
    const oneMs = Math.round(fs / 1000);
    expect(meanAbs(x, x.length - oneMs, x.length)).toBeLessThan(
      0.5 * meanAbs(x, x.length - fade - oneMs, x.length - fade),
    );
  });
});

describe('synthNoise level and colour', () => {
  it('RMS matches gainDb within 0.5 dB for white and pink', () => {
    const w = synthNoise('white', 1000, -20, 48000, rng(4));
    const p = synthNoise('pink', 1000, -30, 48000, rng(4));
    expect(Math.abs(toDb(rms(w)) - -20)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(toDb(rms(p)) - -30)).toBeLessThanOrEqual(0.5);
  });

  it('pink noise has flat power per octave within 2 dB from 100 Hz to 6.4 kHz', () => {
    const fs = 48000;
    const signals = [];
    for (let seed = 1; seed <= 8; seed++) signals.push(synthNoise('pink', 1000, 0, fs, rng(seed)));
    const powers = octaveBandPowers(signals, fs, [100, 200, 400, 800, 1600, 3200, 6400], 10);
    const dB = powers.map(powerToDb);
    const mean = dB.reduce((a, b) => a + b, 0) / dB.length;
    for (const v of dB) expect(Math.abs(v - mean)).toBeLessThanOrEqual(2);
  });

  it('white noise power rises about 3 dB per octave', () => {
    const fs = 48000;
    const signals = [];
    for (let seed = 1; seed <= 8; seed++) signals.push(synthNoise('white', 1000, 0, fs, rng(seed)));
    const dB = octaveBandPowers(signals, fs, [100, 200, 400, 800, 1600, 3200, 6400], 10).map(powerToDb);
    // Least-squares slope of band level (dB) against octave index.
    const xs = dB.map((_, i) => i);
    const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const yMean = dB.reduce((a, b) => a + b, 0) / dB.length;
    let num = 0;
    let den = 0;
    xs.forEach((x, i) => {
      num += (x - xMean) * (dB[i] - yMean);
      den += (x - xMean) ** 2;
    });
    expect(Math.abs(num / den - 3)).toBeLessThanOrEqual(0.5);
  });
});

describe('sample counts', () => {
  it('equal round(durationMs x rate / 1000) at 16000, 44100, 48000 and 96000 Hz', () => {
    const durationMs = 123.456;
    for (const rate of [16000, 44100, 48000, 96000]) {
      const expected = Math.round((durationMs * rate) / 1000);
      const p = { centerHz: 300, bandwidthHz: 150, decayMs: 120, durationMs, gainDb: -6 };
      expect(synthImpact(p, rate, rng(1)).length).toBe(expected);
      expect(synthTone({ f0Hz: 200, durationMs, gainDb: -6 }, rate).length).toBe(expected);
      expect(synthNoise('white', durationMs, -20, rate, rng(1)).length).toBe(expected);
      expect(synthNoise('pink', durationMs, -20, rate, rng(1)).length).toBe(expected);
    }
  });
});

describe('place', () => {
  it('puts a clip at atMs', () => {
    const out = place([{ atMs: 10, samples: Float32Array.from([1, 2, 3]) }], 100, 1000);
    expect(out.length).toBe(100);
    expect(out.findIndex((v) => v !== 0)).toBe(10);
    expect(out[10]).toBe(1);
    expect(out[12]).toBe(3);
    expect(out[13]).toBe(0);
  });

  it('adds overlapping clips without clipping or scaling', () => {
    const out = place(
      [
        { atMs: 0, samples: Float32Array.from([0.75, 0.75]) },
        { atMs: 1, samples: Float32Array.from([0.5, 0.5]) },
      ],
      10,
      1000,
    );
    expect(out[0]).toBeCloseTo(0.75, 6);
    expect(out[1]).toBeCloseTo(1.25, 6);
    expect(out[2]).toBeCloseTo(0.5, 6);
  });

  it('cuts a clip that runs past the end without throwing', () => {
    const out = place([{ atMs: 8, samples: Float32Array.from([1, 2, 3, 4]) }], 10, 1000);
    expect(out.length).toBe(10);
    expect(out[8]).toBe(1);
    expect(out[9]).toBe(2);
  });

  it('adds nothing for a clip that starts at or past the end', () => {
    const out = place([{ atMs: 50, samples: Float32Array.from([1, 1]) }], 10, 1000);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('throws RangeError for negative atMs', () => {
    expectRangeError(() => place([{ atMs: -1, samples: Float32Array.from([1]) }], 10, 1000), 'atMs');
  });
});

describe('SYNTH_CLASSES', () => {
  it('has low, mid, high and ring with the design values', () => {
    expect(Object.keys(SYNTH_CLASSES).sort()).toEqual(['high', 'low', 'mid', 'ring']);
    expect(SYNTH_CLASSES.low).toMatchObject({ centerHz: 300, decayMs: 120 });
    expect(SYNTH_CLASSES.mid).toMatchObject({ centerHz: 1200, decayMs: 60 });
    expect(SYNTH_CLASSES.high).toMatchObject({ centerHz: 3500, decayMs: 25 });
    expect(SYNTH_CLASSES.ring).toMatchObject({ centerHz: 2000, decayMs: 200 });
  });

  it('has bandwidth at 50% of centre and durationMs = min(3 x decayMs, 400)', () => {
    for (const c of Object.values(SYNTH_CLASSES)) {
      expect(c.bandwidthHz).toBe(c.centerHz * SYNTH_BANDWIDTH_FRACTION);
      expect(c.durationMs).toBe(Math.min(SYNTH_DURATION_DECAY_MULTIPLE * c.decayMs, SYNTH_MAX_DURATION_MS));
    }
    expect(SYNTH_CLASSES.low.durationMs).toBe(360);
    expect(SYNTH_CLASSES.mid.durationMs).toBe(180);
    expect(SYNTH_CLASSES.high.durationMs).toBe(75);
    expect(SYNTH_CLASSES.ring.durationMs).toBe(400);
  });

  it('can be used as synthImpact parameters after adding gainDb', () => {
    const x = synthImpact({ ...SYNTH_CLASSES.high, gainDb: -3 }, 48000, rng(2));
    expect(x.length).toBe(Math.round((SYNTH_CLASSES.high.durationMs * 48000) / 1000));
  });
});

describe('parameter checks', () => {
  const impact = { centerHz: 300, bandwidthHz: 150, decayMs: 120, durationMs: 360, gainDb: -6 };

  it('synthImpact names the bad parameter', () => {
    expectRangeError(() => synthImpact({ ...impact, durationMs: 0 }, 48000, rng(1)), 'durationMs');
    expectRangeError(() => synthImpact({ ...impact, decayMs: -1 }, 48000, rng(1)), 'decayMs');
    expectRangeError(() => synthImpact({ ...impact, bandwidthHz: NaN }, 48000, rng(1)), 'bandwidthHz');
    expectRangeError(() => synthImpact({ ...impact, centerHz: 24000 }, 48000, rng(1)), 'centerHz');
    expectRangeError(() => synthImpact(impact, 0, rng(1)), 'sampleRate');
    expectRangeError(() => synthImpact(impact, Infinity, rng(1)), 'sampleRate');
  });

  it('synthTone names the bad parameter', () => {
    expectRangeError(() => synthTone({ f0Hz: 9000, durationMs: 100, gainDb: -6 }, 16000), 'f0Hz');
    expectRangeError(() => synthTone({ f0Hz: 200, durationMs: -5, gainDb: -6 }, 16000), 'durationMs');
  });

  it('synthNoise names the bad parameter', () => {
    expectRangeError(() => synthNoise('white', 0, -20, 16000, rng(1)), 'durationMs');
  });
});
