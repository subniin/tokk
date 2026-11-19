import { describe, it, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { PitchTracker, medianPitchHz } from '../core/continuous/pitch';
import type { PitchEvent } from '../core/continuous/tracker';
import {
  HUM_END_UNVOICED_MS, HUM_START_VOICED_MS, PITCH_HOP_MS, PITCH_MAX_HZ, PITCH_MIN_HZ, YIN_WINDOW_MS,
} from '../core/constants';
import { place, rng, synthNoise, synthTone, SYNTH_CLASSES } from '../core/synth';
import { clip, hitSeed, impactClip, loudestWindowDb, makeSignal, type Hit, type ImpactName } from './helpers/engine-fixture';

// Test-only values.
const MS_PER_SECOND = 1000;
const HOPS_PER_SECOND = MS_PER_SECOND / PITCH_HOP_MS;
const RATES_HZ = [16000, 44100, 48000] as const;
const CLASS_NAMES = Object.keys(SYNTH_CLASSES) as ImpactName[];
const TONE_GAIN_DB = -12;
const LEAD_MS = 300;
const TRAIL_MS = 600;
const STEADY_F0_HZ = 150;
const STEADY_MS = 2000;
const F0_TOLERANCE_HZ = 3;
const MEDIAN_TOLERANCE_HZ = 1;
const VIBRATO_CENTS = 50;
const P9_GLIDE_MS = 1500;
const P9_F_MIN_HZ = 100;
const P9_F_MAX_HZ = 350;
const P9_MIN_DELTA_HZ = 30;
const P9_VIBRATO_MAX_CENTS = 30;
const P9_MIN_TRACKED_FRACTION = 0.3;
const SWEEP_GAIN_MIN_DB = -20;
const SWEEP_GAIN_MAX_DB = 6;
const SWEEP_SNR_DB = 20;
const SWEEP_RATE_HZ = 48000;
const SWEEP_SEEDS = [11, 4242];
const SWEEP_SPAN_MS = 500;
const PBT_RUNS = Number(process.env.PBT_RUNS ?? '100');
const PROP_MS_PER_RUN = 100;
const PROP_TIMEOUT_MS = Math.max(30_000, PBT_RUNS * PROP_MS_PER_RUN);
const GAP_MIN_MS = 150;
const GAP_MAX_MS = 600;
const MAX_IMPACTS = 5;
const SEED_MAX = 1_000_000;
const NOISE_LEVEL_MIN_DBFS = -60;
const NOISE_LEVEL_MAX_DBFS = -20;
const NOISE_MS = 3000;
const SPEED_BUDGET_MS = 3000;
const SPEED_AUDIO_S = 60;
const SPEED_CHUNK = 4096;
const MAX_CHUNK = 4096;
const SHORT_TONE_MS = HUM_START_VOICED_MS - 2 * PITCH_HOP_MS;
const OUT_OF_RANGE_LOW_HZ = 8000;
const OUT_OF_RANGE_HIGH_HZ = 96001;
const SPEED_HUM_MS = 2000;
const SPEED_PERIOD_MS = 5000;
const SPEED_NOISE_DBFS = -45;
const SPEED_IMPACT_OFFSET_MS = 2500;

function tone(f0Hz: number, durationMs: number, sr: number, extra: { vibratoCents?: number; glideToHz?: number } = {}): Float32Array {
  return synthTone({ f0Hz, durationMs, gainDb: TONE_GAIN_DB, ...extra }, sr);
}

function timeline(clips: { atMs: number; samples: Float32Array }[], totalMs: number, sr: number): Float32Array {
  return place(clips, totalMs, sr);
}

function humSignal(f0Hz: number, durationMs: number, sr: number, extra: { vibratoCents?: number; glideToHz?: number } = {}): Float32Array {
  return timeline([{ atMs: LEAD_MS, samples: tone(f0Hz, durationMs, sr, extra) }], LEAD_MS + durationMs + TRAIL_MS, sr);
}

interface Run { events: PitchEvent[]; rangesBeforeFlush: { start: number; end: number | null }[]; ranges: { start: number; end: number | null }[] }

function run(x: Float32Array, sr: number, chunkSizes: number[] = [x.length]): Run {
  const t = new PitchTracker(sr);
  const events: PitchEvent[] = [];
  let i = 0;
  let k = 0;
  while (i < x.length) {
    const n = chunkSizes[k++ % chunkSizes.length];
    events.push(...t.push(x.subarray(i, i + n)));
    i += n;
  }
  const rangesBeforeFlush = t.voicedRanges();
  events.push(...t.flush());
  return { events, rangesBeforeFlush, ranges: t.voicedRanges() };
}

const phases = (events: PitchEvent[]) => events.map((e) => e.phase);

describe('PitchTracker basics (Req 1, 3, 5, 6)', () => {
  it('gives one start, updates near the tone and one end for a 2 s 150 Hz hum', () => {
    const r = run(humSignal(STEADY_F0_HZ, STEADY_MS, 48000), 48000);
    expect(r.events.filter((e) => e.phase === 'start')).toHaveLength(1);
    expect(r.events.filter((e) => e.phase === 'end')).toHaveLength(1);
    expect(r.events[0].phase).toBe('start');
    expect(r.events[r.events.length - 1].phase).toBe('end');
    expect(r.events.filter((e) => e.phase === 'update').length).toBeGreaterThan(HOPS_PER_SECOND);
    for (const e of r.events) {
      expect(e.kind).toBe('continuous');
      expect(e.name).toBe('pitch');
      expect(Math.abs(e.value - STEADY_F0_HZ)).toBeLessThan(F0_TOLERANCE_HZ);
    }
    const times = r.events.map((e) => e.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('gives nothing for a tone shorter than the start count', () => {
    for (const sr of RATES_HZ) {
      const r = run(humSignal(STEADY_F0_HZ, SHORT_TONE_MS, sr), sr);
      expect(r.events).toEqual([]);
      expect(r.ranges).toEqual([]);
    }
  });

  it('gives nothing for digital silence and for an empty chunk', () => {
    const t = new PitchTracker(SWEEP_RATE_HZ);
    expect(t.push(new Float32Array(0))).toEqual([]);
    expect(t.push(new Float32Array(SWEEP_RATE_HZ))).toEqual([]);
    expect(t.flush()).toEqual([]);
    expect(t.voicedRanges()).toEqual([]);
  });

  it('gives nothing for white noise', () => {
    const x = synthNoise('white', NOISE_MS, -30, 44100, rng(5));
    expect(run(x, 44100).events).toEqual([]);
  });

  it.each(CLASS_NAMES)('gives nothing for a %s impact', (cls) => {
    const x = makeSignal({ sampleRate: 48000, totalMs: 1500, hits: [{ atMs: LEAD_MS, cls, gainDb: -6 }], seed: 3 });
    const r = run(x, 48000);
    expect(r.events).toEqual([]);
    expect(r.ranges).toEqual([]);
  });

  it('does not change or keep the pushed chunk', () => {
    const x = humSignal(STEADY_F0_HZ, STEADY_MS, 16000);
    const copy = Float32Array.from(x);
    const t = new PitchTracker(16000);
    t.push(x);
    expect(x).toEqual(copy);
  });

  it('back-dates the range start to the voicing onset and closes it at the end event', () => {
    for (const sr of RATES_HZ) {
      const r = run(humSignal(STEADY_F0_HZ, STEADY_MS, sr), sr);
      const start = r.events.find((e) => e.phase === 'start')!;
      const end = r.events.find((e) => e.phase === 'end')!;
      expect(r.ranges).toHaveLength(1);
      const back = (YIN_WINDOW_MS + HUM_START_VOICED_MS - PITCH_HOP_MS) / MS_PER_SECOND;
      expect(start.t - r.ranges[0].start).toBeCloseTo(back, 6);
      expect(r.ranges[0].start).toBeLessThanOrEqual(LEAD_MS / MS_PER_SECOND + PITCH_HOP_MS / MS_PER_SECOND);
      expect(r.ranges[0].end).toBe(end.t);
    }
  });

  it('puts the end event after the hang time of the last voiced hop', () => {
    const r = run(humSignal(STEADY_F0_HZ, STEADY_MS, 44100), 44100);
    const end = r.events.find((e) => e.phase === 'end')!;
    const lastVoiced = r.events[r.events.length - 2];
    expect(end.t - lastVoiced.t).toBeGreaterThanOrEqual(HUM_END_UNVOICED_MS / MS_PER_SECOND - 1e-9);
    expect(end.value).toBe(lastVoiced.value);
  });

  it('gives a start that follows the 150 Hz tone with vibrato of 50 cents', () => {
    const r = run(humSignal(STEADY_F0_HZ, STEADY_MS, 44100, { vibratoCents: VIBRATO_CENTS }), 44100);
    expect(phases(r.events)[0]).toBe('start');
    expect(phases(r.events).at(-1)).toBe('end');
    expect(phases(r.events).filter((p) => p === 'start')).toHaveLength(1);
  });

  it('flush closes an open hum, and push after flush continues the timeline', () => {
    const sr = 44100;
    const x = humSignal(STEADY_F0_HZ, STEADY_MS, sr);
    const cut = Math.round(((LEAD_MS + STEADY_MS / 2) * sr) / MS_PER_SECOND);
    const t = new PitchTracker(sr);
    const first = t.push(x.subarray(0, cut));
    expect(first[0].phase).toBe('start');
    const open = t.voicedRanges();
    expect(open).toHaveLength(1);
    expect(open[0].end).toBeNull();
    const closing = t.flush();
    expect(closing).toHaveLength(1);
    expect(closing[0].phase).toBe('end');
    expect(closing[0].t).toBe(first.at(-1)!.t);
    expect(closing[0].value).toBe(first.at(-1)!.value);
    expect(t.voicedRanges()[0].end).toBe(closing[0].t);
    const more = t.push(x.subarray(cut));
    t.flush();
    for (const e of more) expect(e.t).toBeGreaterThan(closing[0].t);
    expect(more[0].phase).toBe('start');
  });

  it('flush gives nothing when no hum is open', () => {
    const t = new PitchTracker(16000);
    t.push(new Float32Array(16000));
    expect(t.flush()).toEqual([]);
  });

  it('gives two ranges in order, the first closed and the second open before flush', () => {
    const sr = 48000;
    const second = LEAD_MS + STEADY_MS + MS_PER_SECOND;
    const x = timeline([
      { atMs: LEAD_MS, samples: tone(STEADY_F0_HZ, STEADY_MS, sr) },
      { atMs: second, samples: tone(220, STEADY_MS, sr) },
    ], second + STEADY_MS, sr);
    const r = run(x, sr);
    expect(phases(r.events).filter((p) => p === 'start')).toHaveLength(2);
    expect(r.rangesBeforeFlush).toHaveLength(2);
    expect(r.rangesBeforeFlush[0].end).not.toBeNull();
    expect(r.rangesBeforeFlush[0].end!).toBeLessThan(r.rangesBeforeFlush[1].start);
    expect(r.rangesBeforeFlush[1].end).toBeNull();
    expect(r.ranges[1].end).not.toBeNull();
  });

  it('returns a copy of the range list', () => {
    const sr = 16000;
    const t = new PitchTracker(sr);
    t.push(humSignal(STEADY_F0_HZ, STEADY_MS, sr));
    const a = t.voicedRanges();
    expect(a.length).toBeGreaterThan(0);
    const before = JSON.stringify(a);
    a[0].start = -1;
    a.push({ start: 0, end: 0 });
    expect(JSON.stringify(t.voicedRanges())).toBe(before);
  });

  it.each([OUT_OF_RANGE_LOW_HZ, OUT_OF_RANGE_HIGH_HZ, NaN, Infinity])('rejects sampleRate %s with a RangeError naming sampleRate', (sr) => {
    expect(() => new PitchTracker(sr)).toThrow(RangeError);
    expect(() => new PitchTracker(sr)).toThrow(/sampleRate/);
    expect(() => medianPitchHz(new Float32Array(10), sr)).toThrow(RangeError);
  });

  it.each([PITCH_MIN_HZ, PITCH_MAX_HZ])('follows a %s Hz tone within the allowed error', (f) => {
    for (const sr of RATES_HZ) {
      const r = run(humSignal(f, STEADY_MS, sr), sr);
      expect(phases(r.events)[0], `${f} Hz at ${sr} Hz`).toBe('start');
      for (const e of r.events) expect(Math.abs(e.value - f), `${f} Hz at ${sr} Hz`).toBeLessThan(F0_TOLERANCE_HZ);
    }
  });

  it('puts every event on the hop grid, at b(h) / sampleRate', () => {
    for (const sr of RATES_HZ) {
      const hopSamples = Math.round((sr * PITCH_HOP_MS) / MS_PER_SECOND);
      const r = run(humSignal(STEADY_F0_HZ, STEADY_MS, sr), sr);
      for (const e of r.events) {
        const samples = Math.round(e.t * sr);
        expect(samples % hopSamples).toBe(0);
        expect(e.t).toBe(samples / sr);
      }
    }
  });
});

describe('medianPitchHz (Req 8)', () => {
  it('gives a 220 Hz tone within 3 Hz', () => {
    for (const sr of RATES_HZ) {
      expect(Math.abs(medianPitchHz(humSignal(220, STEADY_MS, sr), sr)! - 220)).toBeLessThan(F0_TOLERANCE_HZ);
    }
  });

  it('gives null for silence, noise, an empty array and a short tone', () => {
    expect(medianPitchHz(new Float32Array(SWEEP_RATE_HZ), SWEEP_RATE_HZ)).toBeNull();
    expect(medianPitchHz(new Float32Array(0), SWEEP_RATE_HZ)).toBeNull();
    expect(medianPitchHz(synthNoise('white', NOISE_MS, -30, 44100, rng(8)), 44100)).toBeNull();
    expect(medianPitchHz(humSignal(STEADY_F0_HZ, SHORT_TONE_MS, 44100), 44100)).toBeNull();
  });

  it('is near the median of the reported values for a steady tone', () => {
    const sr = 44100;
    const x = humSignal(STEADY_F0_HZ, STEADY_MS, sr);
    const values = run(x, sr).events.filter((e) => e.phase !== 'end').map((e) => e.value).sort((a, b) => a - b);
    const mid = values.length >> 1;
    const reported = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    expect(Math.abs(medianPitchHz(x, sr)! - reported)).toBeLessThan(MEDIAN_TOLERANCE_HZ);
  });

  it('counts the hops before start: a rising glide has a median not above the reported one', () => {
    const sr = 48000;
    const x = humSignal(100, STEADY_MS, sr, { glideToHz: 300 });
    const values = run(x, sr).events.filter((e) => e.phase !== 'end').map((e) => e.value).sort((a, b) => a - b);
    const mid = values.length >> 1;
    const reported = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    expect(medianPitchHz(x, sr)!).toBeLessThanOrEqual(reported);
  });
});

describe('chunk invariance (Req 7.1)', () => {
  function mixed(sr: number): Float32Array {
    const second = LEAD_MS + 800 + 400 + 600;
    return timeline([
      { atMs: LEAD_MS, samples: tone(STEADY_F0_HZ, 800, sr) },
      { atMs: LEAD_MS + 800 + 400, samples: impactClip('mid', -6, sr, 9) },
      { atMs: second, samples: tone(220, 700, sr) },
    ], second + 700 + TRAIL_MS, sr);
  }

  it.each(RATES_HZ)('gives bit-equal events and ranges for every fixed chunk size at %s Hz', (sr) => {
    const x = mixed(sr);
    const whole = run(x, sr);
    expect(phases(whole.events)).toContain('start');
    const hop = Math.round((sr * PITCH_HOP_MS) / MS_PER_SECOND);
    for (const size of [1, hop, 441, MAX_CHUNK, 50000]) {
      const r = run(x, sr, [size]);
      expect(r.events, `chunk ${size}`).toEqual(whole.events);
      expect(r.rangesBeforeFlush, `chunk ${size}`).toEqual(whole.rangesBeforeFlush);
      expect(r.ranges, `chunk ${size}`).toEqual(whole.ranges);
    }
  });

  const fixed = mixed(16000);
  const fixedWhole = run(fixed, 16000);
  test.prop([fc.array(fc.integer({ min: 1, max: MAX_CHUNK }), { minLength: 1, maxLength: 40 })])(
    'P3 chunk invariance (pitch)', (sizes) => {
      const r = run(fixed, 16000, sizes);
      expect(r.events).toEqual(fixedWhole.events);
      expect(r.ranges).toEqual(fixedWhole.ranges);
    }, PROP_TIMEOUT_MS);
});

describe('speed (Req 7.2)', () => {
  it('processes 60 s of 48 kHz audio in under 3 s', () => {
    const sr = 48000;
    const totalMs = SPEED_AUDIO_S * MS_PER_SECOND;
    const clips: { atMs: number; samples: Float32Array }[] = [];
    const hum = tone(STEADY_F0_HZ, SPEED_HUM_MS, sr);
    const impact = impactClip('mid', -6, sr, 1);
    for (let at = 0; at + SPEED_HUM_MS < totalMs; at += SPEED_PERIOD_MS) {
      clips.push({ atMs: at, samples: hum });
      clips.push({ atMs: at + SPEED_IMPACT_OFFSET_MS, samples: impact });
    }
    const x = timeline(clips, totalMs, sr);
    const noise = synthNoise('white', totalMs, SPEED_NOISE_DBFS, sr, rng(2));
    for (let i = 0; i < x.length; i++) x[i] += noise[i];
    const t = new PitchTracker(sr);
    let elapsedMs = 0;
    let count = 0;
    for (let i = 0; i < x.length; i += SPEED_CHUNK) {
      const chunk = x.subarray(i, i + SPEED_CHUNK);
      const t0 = performance.now();
      count += t.push(chunk).length;
      elapsedMs += performance.now() - t0;
    }
    const t1 = performance.now();
    count += t.flush().length;
    elapsedMs += performance.now() - t1;
    console.log(`pitch speed: ${SPEED_AUDIO_S} s of ${sr} Hz audio in ${elapsedMs.toFixed(0)} ms (${count} events)`);
    expect(count).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(SPEED_BUDGET_MS);
  });
});

describe('impacts and noise are not hums (Req 9, review item 12)', () => {
  // The SNR holds for every impact: the noise is set from the quietest clean clip (Task 8 Req 15.3).
  function impactSignal(sr: number, cls: ImpactName, gainDb: number, seed: number, gaps: number[]): Float32Array {
    const atMs: number[] = [LEAD_MS];
    for (const g of gaps) atMs.push(atMs[atMs.length - 1] + g);
    const hits: Hit[] = atMs.map((a) => ({ atMs: a, cls, gainDb }));
    const quietestDb = Math.min(...atMs.map((_, k) => loudestWindowDb(impactClip(cls, gainDb, sr, hitSeed(seed, k)), sr)));
    return clip(makeSignal({ sampleRate: sr, totalMs: atMs[atMs.length - 1] + SWEEP_SPAN_MS + TRAIL_MS, hits, seed, noiseRmsDb: quietestDb - SWEEP_SNR_DB }));
  }

  it('gives no event and no range for four classes, 27 gains and 2 seeds at 48000 Hz', () => {
    const bad: string[] = [];
    let cases = 0;
    for (const cls of CLASS_NAMES) {
      for (let gain = SWEEP_GAIN_MIN_DB; gain <= SWEEP_GAIN_MAX_DB; gain++) {
        for (const seed of SWEEP_SEEDS) {
          cases++;
          const r = run(impactSignal(SWEEP_RATE_HZ, cls, gain, seed, []), SWEEP_RATE_HZ);
          if (r.events.length > 0 || r.ranges.length > 0) bad.push(`${cls} ${gain} dB seed ${seed}: ${phases(r.events).join(',')}`);
        }
      }
    }
    console.log(`review item 12 sweep: ${cases} cases, ${bad.length} with a hum${bad.length ? `\n  ${bad.slice(0, 20).join('\n  ')}` : ''}`);
    expect(cases).toBe(CLASS_NAMES.length * (SWEEP_GAIN_MAX_DB - SWEEP_GAIN_MIN_DB + 1) * SWEEP_SEEDS.length);
    expect(bad).toEqual([]);
  }, 120_000);

  test.prop([
    fc.constantFrom(...RATES_HZ),
    fc.constantFrom(...CLASS_NAMES),
    fc.integer({ min: SWEEP_GAIN_MIN_DB, max: SWEEP_GAIN_MAX_DB }),
    fc.integer({ min: 1, max: SEED_MAX }),
    fc.array(fc.integer({ min: GAP_MIN_MS, max: GAP_MAX_MS }), { minLength: 0, maxLength: MAX_IMPACTS - 1 }),
  ])('impacts in noise give no event and no range', (sr, cls, gainDb, seed, gaps) => {
    const r = run(impactSignal(sr, cls, gainDb, seed, gaps), sr);
    expect({ events: r.events.length, ranges: r.ranges.length }, `${cls} ${gainDb} dB, seed ${seed}, gaps ${gaps}, ${sr} Hz`).toEqual({ events: 0, ranges: 0 });
  }, PROP_TIMEOUT_MS);

  test.prop([
    fc.constantFrom('white', 'pink') as fc.Arbitrary<'white' | 'pink'>,
    fc.integer({ min: NOISE_LEVEL_MIN_DBFS, max: NOISE_LEVEL_MAX_DBFS }),
    fc.constantFrom(...RATES_HZ),
    fc.integer({ min: 1, max: SEED_MAX }),
  ])('white noise gives no pitch events', (kind, levelDb, sr, seed) => {
    const r = run(synthNoise(kind, NOISE_MS, levelDb, sr, rng(seed)), sr);
    expect(r.events, `${kind} ${levelDb} dBFS ${sr} Hz seed ${seed}`).toEqual([]);
  }, PROP_TIMEOUT_MS);
});

describe('P9 glide direction (Req 13)', () => {
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

  test.prop([
    fc.integer({ min: P9_F_MIN_HZ, max: P9_F_MAX_HZ }),
    fc.integer({ min: P9_F_MIN_HZ, max: P9_F_MAX_HZ }),
    fc.integer({ min: 0, max: P9_VIBRATO_MAX_CENTS }),
    fc.constantFrom(...RATES_HZ),
  ])(
    'P9 a glide is reported in its direction',
    (f0, f1, vibrato, sr) => {
      fc.pre(Math.abs(f1 - f0) >= P9_MIN_DELTA_HZ);
            const x = tone(f0, P9_GLIDE_MS, sr, { vibratoCents: vibrato, glideToHz: f1 });
      const r = run(x, sr);
      const values = r.events.filter((e) => e.phase !== 'end').map((e) => e.value);
      const quarter = Math.floor(values.length / 4);
      const first = values.length ? mean(values.slice(0, quarter)) : NaN;
      const last = values.length ? mean(values.slice(values.length - quarter)) : NaN;
      const diff = last - first;
      const ok = r.events.some((e) => e.phase === 'start') && quarter > 0
        && (f1 > f0 ? diff > 0 : diff < 0) && Math.abs(diff) >= P9_MIN_TRACKED_FRACTION * Math.abs(f1 - f0);
      expect(ok, `f0 ${f0}, f1 ${f1}, vibrato ${vibrato} cents, ${sr} Hz, first quarter mean ${first}, last quarter mean ${last}`).toBe(true);
    },
    PROP_TIMEOUT_MS,
  );
});

describe('E5 (needs real recordings)', () => {
  // Real recordings of hum and speech decide these. A synthetic test would only show that the signal was made to pass.
  it.todo('E5: speech recordings give at most one hum start per minute');
  it.todo('E5: hum recordings start within 0.5 s for at least 90 % of the hums');
});
