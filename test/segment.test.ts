import { describe, it, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { Segmenter } from '../core/segment';
import { rng, synthImpact, synthNoise, synthTone, place, SYNTH_CLASSES } from '../core/synth';
import { resample } from './helpers/resample';
import type { Segment } from '../core/types';

// Test-only values. The engine never reads these, so they stay out of core/constants.ts.
const P4_TOLERANCE_S = 0.005;   // allowed difference in t between sample rates (Req 12.1)
const P4_SLACK_S = 0.0001;      // covers the 5.011 ms hop at 44100 Hz (Req 12.1)
const ADAPTATION_S = 1.0;       // calibration period. No onset is accepted before it ends (Req 10.1)
const LEAD_MS = 1000;           // every test sound starts at or after the calibration period
const CHUNK_MIN = 1;            // chunk size range for P3 (Req 11.1)
const CHUNK_MAX = 4096;
const MS_PER_SECOND = 1000;
const REONSET_TEST_GAINS_DB = [-20, -6, 0];   // impact peak levels for the re-onset examples
const REONSET_TEST_SEEDS = 40;                // seeds per class, gain and rate

// Property test timeouts grow with PBT_RUNS. P4 costs about 0.6 s per run (windowed-sinc resampling).
const PBT_RUNS = Number(process.env.PBT_RUNS ?? '100');
const P3_MS_PER_RUN = 50;
const P4_MS_PER_RUN = 2000;
const TIMEOUT_FLOOR_MS = 120_000;   // the design's 120 s, kept as the minimum

const RATES = [16000, 44100, 48000] as const;

// Helpers

function hopOf(sr: number): number {
  return Math.round((5 * sr) / MS_PER_SECOND);
}

function samplesOf(ms: number, sr: number): number {
  return Math.round((ms * sr) / MS_PER_SECOND);
}

function silence(ms: number, sr: number): Float32Array {
  return new Float32Array(samplesOf(ms, sr));
}

// Alternating +a/-a with a constant level in dBFS. Its RMS over any window is exactly a.
function constantN(db: number, n: number): Float32Array {
  const a = Math.pow(10, db / 20);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = i % 2 === 0 ? a : -a;
  return out;
}

function constantDb(db: number, ms: number, sr: number): Float32Array {
  return constantN(db, samplesOf(ms, sr));
}

// Alternating signal whose power level in dB rises by dbPerHop per hop, from startDb to endDb,
// then holds endDb for holdMs. Once the 10 ms window is inside the ramp, each hop rises by dbPerHop.
function rampDb(startDb: number, endDb: number, dbPerHop: number, holdMs: number, sr: number): Float32Array {
  const hop = hopOf(sr);
  const slope = dbPerHop / hop;                       // dB per sample
  const rampLen = Math.ceil(Math.abs(endDb - startDb) / Math.abs(slope));
  const n = rampLen + samplesOf(holdMs, sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const db = i < rampLen ? startDb + slope * i * Math.sign(endDb - startDb) : endDb;
    const a = Math.pow(10, db / 20);
    out[i] = i % 2 === 0 ? a : -a;
  }
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// Feeds the whole input with one push, then flushes. Returns every segment.
function runAll(sr: number, x: Float32Array): Segment[] {
  const s = new Segmenter(sr);
  return [...s.push(x), ...s.flush()];
}

// Feeds the input in pieces of the given sizes (cycled), then flushes.
function runChunked(sr: number, x: Float32Array, sizes: number[]): { segs: Segment[]; floor: number } {
  const s = new Segmenter(sr);
  const segs: Segment[] = [];
  let pos = 0;
  let k = 0;
  while (pos < x.length) {
    const size = Math.min(sizes[k % sizes.length], x.length - pos);
    segs.push(...s.push(x.slice(pos, pos + size)));
    pos += size;
    k++;
  }
  segs.push(...s.flush());
  return { segs, floor: s.noiseFloorDb() };
}

function impactOf(name: keyof typeof SYNTH_CLASSES, gainDb: number, sr: number, seed: number): Float32Array {
  return synthImpact({ ...SYNTH_CLASSES[name], gainDb }, sr, rng(seed));
}

// Constructor and interface (Req 1)

describe('Segmenter interface (Req 1)', () => {
  it('throws RangeError naming sampleRate for bad rates', () => {
    for (const bad of [0, -1, NaN, Infinity, 50]) {
      expect(() => new Segmenter(bad)).toThrow(RangeError);
      expect(() => new Segmenter(bad)).toThrow(/sampleRate/);
    }
  });

  it('push of an empty chunk returns [] and changes no state', () => {
    const s = new Segmenter(44100);
    s.push(concat(silence(LEAD_MS + 100, 44100), constantDb(-30, 100, 44100)));
    const floor = s.noiseFloorDb();
    const open = s.openSegmentStart();
    expect(s.push(new Float32Array(0))).toEqual([]);
    expect(s.noiseFloorDb()).toBe(floor);
    expect(s.openSegmentStart()).toBe(open);
  });

  it('does not keep a reference to a pushed chunk', () => {
    const sr = 44100;
    const sig = concat(silence(LEAD_MS + 200, sr), constantDb(-30, 100, sr), silence(300, sr));
    const half = Math.floor(sig.length / 2);

    const reference = new Segmenter(sr);
    reference.push(sig.slice(0, half));
    const expected = [...reference.push(sig.slice(half)), ...reference.flush()];

    const s = new Segmenter(sr);
    const first = sig.slice(0, half);
    s.push(first);
    first.fill(0);                       // caller changes the chunk after push
    const got = [...s.push(sig.slice(half)), ...s.flush()];

    expect(expected.length).toBe(1);
    expect(got).toEqual(expected);
  });

  it('sets t, durationMs and samples from the start sample and length', () => {
    for (const sr of RATES) {
      const sig = concat(silence(LEAD_MS + 200, sr), constantDb(-30, 150, sr), silence(300, sr));
      const segs = runAll(sr, sig);
      expect(segs.length).toBe(1);
      const seg = segs[0];
      expect(seg.sampleRate).toBe(sr);
      const start = Math.round(seg.t * sr);
      expect(Math.abs(seg.t * sr - start)).toBeLessThan(1e-6);
      expect(seg.samples).toBeInstanceOf(Float32Array);
      expect(seg.samples).toEqual(sig.slice(start, start + seg.samples.length));
      expect(seg.durationMs).toBeCloseTo((seg.samples.length * MS_PER_SECOND) / sr, 9);
    }
  });
});

// Level and noise floor (Req 3, 4)

describe('level and noise floor (Req 3, 4)', () => {
  it('starts at -70 dBFS before any data', () => {
    expect(new Segmenter(44100).noiseFloorDb()).toBe(-70);
    expect(new Segmenter(44100).openSegmentStart()).toBeNull();
  });

  it('gives the exact level of alternating input (floor falls to it at once)', () => {
    for (const sr of [44100, 48000]) {
      const s = new Segmenter(sr);
      s.push(constantDb(-85, 5, sr));          // exactly one hop
      expect(s.noiseFloorDb()).toBeCloseTo(-85, 3);
    }
  });

  it('clamps the level and floor at -90 dBFS', () => {
    const s = new Segmenter(44100);
    s.push(constantDb(-95, 200, 44100));
    expect(s.noiseFloorDb()).toBe(-90);
  });

  it('rises at the warm-up constant (100 ms) during the calibration period', () => {
    for (const sr of RATES) {
      const hop = hopOf(sr);
      const warmHops = Math.floor(samplesOf(LEAD_MS, sr) / hop);   // hops that end inside the warm-up
      const s = new Segmenter(sr);
      s.push(constantN(-65, warmHops * hop));
      const elapsed = (warmHops * hop) / sr;
      expect(Math.abs(s.noiseFloorDb() - (-65 - 5 * Math.exp(-elapsed / 0.1)))).toBeLessThan(0.01);
    }
  });

  it('rises at the 1 s constant after the calibration period', () => {
    for (const sr of RATES) {
      const hop = hopOf(sr);
      const warmHops = Math.floor(samplesOf(LEAD_MS, sr) / hop);
      const hops = 200;
      const s = new Segmenter(sr);
      s.push(constantN(-65, (warmHops + hops) * hop));
      const d1 = 5 * Math.exp(-(warmHops * hop) / sr / 0.1);      // gap left at the end of the warm-up
      const elapsed = (hops * hop) / sr;
      expect(Math.abs(s.noiseFloorDb() - (-65 - d1 * Math.exp(-elapsed)))).toBeLessThan(0.01);
    }
  });

  it('falls to a lower level at once', () => {
    const sr = 44100;
    const s = new Segmenter(sr);
    s.push(constantDb(-65, 500, sr));
    // 30 ms is six hops. The 10 ms window is then fully inside the -85 dBFS input, so the floor falls.
    s.push(constantDb(-85, 30, sr));
    expect(s.noiseFloorDb()).toBeCloseTo(-85, 3);
  });

  it('is frozen while a segment is open', () => {
    const sr = 44100;
    const s = new Segmenter(sr);
    s.push(silence(LEAD_MS, sr));
    const floor = s.noiseFloorDb();
    const segs = s.push(constantDb(-30, 500, sr));
    expect(segs).toEqual([]);
    expect(s.openSegmentStart()).not.toBeNull();
    expect(s.noiseFloorDb()).toBe(floor);
  });
});

// Onset thresholds (Req 5). The 10 ms window smears a step over two hops, so these cases use
// steady levels or ramps with a known per-hop rise, not single steps with a dB margin.

describe('onset thresholds (Req 5)', () => {
  it('-61 dBFS steady never opens a segment (absolute -60 dBFS rule)', () => {
    const sr = 44100;
    const segs = runAll(sr, concat(silence(LEAD_MS + 100, sr), constantDb(-61, 1000, sr)));
    expect(segs).toEqual([]);
  });

  it('-50 dBFS steady after silence opens one segment', () => {
    const sr = 44100;
    const segs = runAll(sr, concat(silence(LEAD_MS + 100, sr), constantDb(-50, 1000, sr)));
    expect(segs.length).toBe(1);
  });

  it('a 5 dB per hop rise never opens a segment (rise rule, Req 5.4)', () => {
    const sr = 44100;
    const x = concat(silence(LEAD_MS, sr), constantDb(-70, 300, sr), rampDb(-70, -40, 5, 500, sr));
    expect(runAll(sr, x)).toEqual([]);
  });

  it('a 9 dB per hop rise opens a segment (rise rule)', () => {
    const sr = 44100;
    const x = concat(silence(LEAD_MS, sr), constantDb(-70, 300, sr), rampDb(-70, -52, 9, 300, sr));
    expect(runAll(sr, x).length).toBeGreaterThanOrEqual(1);
  });

  it('a rise that stays below floor + 12 dB does not open a segment', () => {
    const sr = 44100;
    // Floor settles near -62 after 5 s, so floor + 12 is about -50. The ramp stops at -55.
    const x = concat(silence(LEAD_MS, sr), constantDb(-62, 5000, sr), rampDb(-62, -55, 7, 500, sr));
    expect(runAll(sr, x)).toEqual([]);
  });

  it('a rise that passes floor + 12 dB opens a segment', () => {
    const sr = 44100;
    const x = concat(silence(LEAD_MS, sr), constantDb(-62, 5000, sr), rampDb(-62, -40, 7, 300, sr));
    expect(runAll(sr, x).length).toBeGreaterThanOrEqual(1);
  });

  it('no onset is accepted during the calibration period', () => {
    const sr = 44100;
    // A -30 dBFS burst that ends before 1 s must not open a segment.
    const x = concat(silence(300, sr), constantDb(-30, 200, sr), silence(LEAD_MS - 500, sr));
    expect(runAll(sr, x)).toEqual([]);
  });
});

// Start, end and re-onset (Req 6, 7)

describe('start, offset and re-onset (Req 6, 7)', () => {
  it('starts 5 ms before the onset hop and ends 30 to 55 ms after the burst', () => {
    for (const sr of [44100, 48000]) {
      const burstStart = samplesOf(LEAD_MS + 200, sr);
      const burstEnd = samplesOf(LEAD_MS + 300, sr);
      const x = concat(silence(LEAD_MS + 200, sr), constantDb(-30, 100, sr), silence(300, sr));
      const segs = runAll(sr, x);
      expect(segs.length).toBe(1);
      const burstStartS = burstStart / sr;
      const burstEndS = burstEnd / sr;
      // Onset hop starts within one hop before the burst. Its segment starts 5 ms before that.
      expect(segs[0].t).toBeGreaterThanOrEqual(burstStartS - 0.010 - 1e-9);
      expect(segs[0].t).toBeLessThanOrEqual(burstStartS - 0.005 + 1e-9);
      const endS = segs[0].t + segs[0].samples.length / sr;
      expect(endS - burstEndS).toBeGreaterThanOrEqual(0.030 - 1e-9);
      expect(endS - burstEndS).toBeLessThanOrEqual(0.055 + 1e-9);
    }
  });

  it('a steady 3 s tone gives one 1500 ms segment at 16, 44.1 and 48 kHz', () => {
    for (const sr of RATES) {
      const tone = synthTone({ f0Hz: 440, durationMs: 3000, gainDb: -20 }, sr);
      const s = new Segmenter(sr);
      const pushed = s.push(concat(silence(LEAD_MS, sr), tone));
      const flushed = s.flush();
      expect(pushed.length).toBe(1);
      expect(flushed).toEqual([]);
      expect(pushed[0].samples.length).toBe(samplesOf(1500, sr));
      expect(pushed[0].durationMs).toBeCloseTo(1500, 9);
      expect(pushed[0].t).toBeGreaterThanOrEqual(LEAD_MS / MS_PER_SECOND - 0.010 - 1e-9);
      expect(pushed[0].t).toBeLessThanOrEqual(LEAD_MS / MS_PER_SECOND);
    }
  });

  it('a burst 70 ms after a first burst merges into one segment', () => {
    const sr = 44100;
    // Second burst is louder (-10 dBFS) and starts 70 ms after the first. Its onset hop is
    // less than 80 ms after the first onset hop, so no re-onset.
    const x = concat(
      silence(LEAD_MS + 200, sr),
      constantDb(-30, 70, sr),
      constantDb(-10, 300, sr),
      silence(300, sr),
    );
    expect(runAll(sr, x).length).toBe(1);
  });

  it('a burst 100 ms after the first cuts it and opens a new segment', () => {
    const sr = 44100;
    const x = concat(
      silence(LEAD_MS + 200, sr),
      constantDb(-30, 100, sr),
      constantDb(-10, 300, sr),
      silence(300, sr),
    );
    const segs = runAll(sr, x);
    expect(segs.length).toBe(2);
    // The first segment closes exactly where the second starts.
    expect(segs[0].t + segs[0].samples.length / sr).toBeCloseTo(segs[1].t, 9);
  });
});

// openSegmentStart and flush (Req 8)

describe('openSegmentStart and flush (Req 8)', () => {
  it('reports the start of an open segment, then null after it closes', () => {
    const sr = 44100;
    const s = new Segmenter(sr);
    s.push(concat(silence(LEAD_MS + 200, sr), constantDb(-30, 100, sr)));
    const open = s.openSegmentStart();
    expect(open).not.toBeNull();
    const segs = s.push(silence(300, sr));
    expect(segs.length).toBe(1);
    expect(segs[0].t).toBeCloseTo(open as number, 12);
    expect(s.openSegmentStart()).toBeNull();
  });

  it('flush returns an open segment capped at 1500 ms, then [] on the second call', () => {
    const sr = 44100;
    const s = new Segmenter(sr);
    s.push(concat(silence(LEAD_MS, sr), constantDb(-30, 300, sr)));
    expect(s.openSegmentStart()).not.toBeNull();
    const first = s.flush();
    expect(first.length).toBe(1);
    expect(first[0].durationMs).toBeLessThanOrEqual(1500);
    expect(s.openSegmentStart()).toBeNull();
    expect(s.flush()).toEqual([]);
  });

  it('keeps the noise floor across flush and later pushes', () => {
    const sr = 44100;
    const s = new Segmenter(sr);
    s.push(concat(silence(LEAD_MS, sr), constantDb(-30, 300, sr)));
    const floor = s.noiseFloorDb();
    s.flush();
    expect(s.noiseFloorDb()).toBe(floor);
    s.push(silence(100, sr));
    expect(s.noiseFloorDb()).toBe(-90);
  });
});

// Fixed inputs (Req 9)

describe('fixed inputs (Req 9)', () => {
  it('empty and all-zero input give no segments and do not throw', () => {
    for (const sr of RATES) {
      expect(runAll(sr, new Float32Array(0))).toEqual([]);
      expect(runAll(sr, silence(1000, sr))).toEqual([]);
    }
  });

  it('three mid impacts 300 ms apart at 48 kHz give three segments within 10 ms', () => {
    const sr = 48000;
    const at = [LEAD_MS + 200, LEAD_MS + 500, LEAD_MS + 800];
    const clips = at.map((ms, i) => ({ atMs: ms, samples: impactOf('mid', -6, sr, 10 + i) }));
    const x = place(clips, LEAD_MS + 1200, sr);
    const segs = runAll(sr, x);
    expect(segs.length).toBe(3);
    segs.forEach((seg, i) => {
      expect(Math.abs(seg.t - at[i] / MS_PER_SECOND)).toBeLessThanOrEqual(0.010);
    });
  });

  it('two impacts 100 ms apart give two segments for mid and high at 16, 44.1 and 48 kHz (Review Focus 5)', () => {
    for (const sr of RATES) {
      for (const cls of ['mid', 'high'] as const) {
        for (const gainDb of REONSET_TEST_GAINS_DB) {
          for (let seed = 1; seed <= REONSET_TEST_SEEDS; seed++) {
            const x = place(
              [
                { atMs: LEAD_MS + 200, samples: impactOf(cls, gainDb, sr, seed) },
                { atMs: LEAD_MS + 300, samples: impactOf(cls, gainDb, sr, seed + 1000) },
              ],
              LEAD_MS + 800,
              sr,
            );
            const segs = runAll(sr, x);
            expect(segs.length, `${cls} ${gainDb} dB seed ${seed} at ${sr} Hz`).toBe(2);
          }
        }
      }
    }
  });

  it('no isolated impact of any class splits, at 16, 44.1 and 48 kHz', () => {
    for (const sr of RATES) {
      for (const cls of ['low', 'mid', 'high', 'ring'] as const) {
        for (const gainDb of REONSET_TEST_GAINS_DB) {
          for (let seed = 1; seed <= REONSET_TEST_SEEDS; seed++) {
            const x = place([{ atMs: LEAD_MS + 200, samples: impactOf(cls, gainDb, sr, seed) }], LEAD_MS + 1000, sr);
            const segs = runAll(sr, x);
            expect(segs.length, `${cls} ${gainDb} dB seed ${seed} at ${sr} Hz`).toBe(1);
          }
        }
      }
    }
  });

  it('a 0 dBFS hard-clipped ring with its 200 ms decay gives exactly one segment (Review Focus 4)', () => {
    const sr = 48000;
    const raw = synthImpact({ ...SYNTH_CLASSES.ring, gainDb: 6 }, sr, rng(7));
    const clipped = raw.map((v) => Math.max(-1, Math.min(1, v)));
    const x = place([{ atMs: LEAD_MS + 200, samples: clipped }], LEAD_MS + 1000, sr);
    expect(runAll(sr, x).length).toBe(1);
  });

  it('white noise at -30 dBFS opens no segment after the calibration period', () => {
    const sr = 44100;
    const x = synthNoise('white', 3000, -30, sr, rng(3));
    const segs = runAll(sr, x);
    expect(segs.filter((g) => g.t >= ADAPTATION_S)).toEqual([]);
  });

  it('digital silence then -70 dBFS dither gives no segment, and the floor stays >= -90', () => {
    const sr = 44100;
    const hop = hopOf(sr);
    const dither = synthNoise('white', 2000, -70, sr, rng(5));
    const x = concat(silence(LEAD_MS, sr), dither);
    const s = new Segmenter(sr);
    const segs: Segment[] = [];
    for (let pos = 0; pos < x.length; pos += hop) {
      segs.push(...s.push(x.slice(pos, pos + hop)));
      expect(s.noiseFloorDb()).toBeGreaterThanOrEqual(-90);
    }
    segs.push(...s.flush());
    expect(segs).toEqual([]);
  });
});

// Property tests (P2, P3, P4). Run count comes from test/setup.ts (PBT_RUNS).

describe('property tests', () => {
  // P2 (Req 10): noise-only input, over the whole input, gives no segment.
  test.prop(
    [
      fc.constantFrom('white', 'pink') as fc.Arbitrary<'white' | 'pink'>,
      fc.integer({ min: -60, max: -20 }),
      fc.constantFrom(16000, 44100, 48000),
      fc.integer({ min: 1, max: 1_000_000 }),
    ],
    { verbose: false },
  )('P2 noise-only input gives no segment (Req 10.1)', (kind, levelDb, sr, seed) => {
    const x = synthNoise(kind, 4000, levelDb, sr, rng(seed));
    const segs = runAll(sr, x);
    expect(segs).toEqual([]);
  });

  // P3 (Req 11): chunking does not change the result.
  const P3_SIGNAL = (() => {
    const sr = 44100;
    const noise = synthNoise('white', LEAD_MS + 3200, -80, sr, rng(99));
    const clips = [
      { atMs: LEAD_MS + 200, samples: impactOf('mid', -6, sr, 21) },
      { atMs: LEAD_MS + 800, samples: impactOf('low', -6, sr, 22) },
      { atMs: LEAD_MS + 900, samples: impactOf('high', -6, sr, 23) },
      { atMs: LEAD_MS + 1300, samples: synthTone({ f0Hz: 330, durationMs: 1700, gainDb: -10 }, sr) },
    ];
    const events = place(clips, LEAD_MS + 3200, sr);
    const out = new Float32Array(events.length);
    for (let i = 0; i < out.length; i++) out[i] = events[i] + noise[i];
    const whole = runAll(sr, out);
    const ref = new Segmenter(sr);
    ref.push(out);
    ref.flush();
    return { sr, x: out, whole, wholeFloor: ref.noiseFloorDb() };
  })();

  test.prop(
    [fc.array(fc.integer({ min: CHUNK_MIN, max: CHUNK_MAX }), { minLength: 1 })],
    { verbose: false },
  )('P3 chunked input gives the same segments, samples and floor (Req 11.1)', (sizes) => {
    const { sr, x, whole, wholeFloor } = P3_SIGNAL;
    const chunked = runChunked(sr, x, sizes);
    expect(chunked.segs.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) {
      expect(chunked.segs[i].t).toBe(whole[i].t);
      expect(chunked.segs[i].durationMs).toBe(whole[i].durationMs);
      expect(chunked.segs[i].sampleRate).toBe(whole[i].sampleRate);
      expect(chunked.segs[i].samples).toEqual(whole[i].samples);
    }
    expect(chunked.floor).toBe(wholeFloor);
  }, Math.max(TIMEOUT_FLOOR_MS, PBT_RUNS * P3_MS_PER_RUN));

  // P4 (Req 12): the same sound at 16, 44.1 and 48 kHz gives the same segments.
  test.prop(
    [
      fc.integer({ min: 1, max: 2 }),
      fc.constantFrom('low', 'mid', 'high', 'ring') as fc.Arbitrary<'low' | 'mid' | 'high' | 'ring'>,
      fc.constantFrom('low', 'mid', 'high', 'ring') as fc.Arbitrary<'low' | 'mid' | 'high' | 'ring'>,
      fc.integer({ min: -20, max: 0 }),
      fc.integer({ min: -20, max: 0 }),
      fc.integer({ min: 500, max: 800 }),
      fc.option(fc.integer({ min: -90, max: -70 }), { nil: null }),
      fc.integer({ min: 1, max: 1_000_000 }),
    ],
    { verbose: false },
  )(
    'P4 same sound at 16, 44.1 and 48 kHz gives same segments within 5 ms (Req 12.1)',
    (count, classA, classB, gainA, gainB, gapMs, noiseDb, seed) => {
      const hi = 96000;
      const r = rng(seed);
      const clips = [{ atMs: LEAD_MS + 200, samples: impactOf(classA, gainA, hi, seed) }];
      if (count === 2) clips.push({ atMs: LEAD_MS + 200 + gapMs, samples: impactOf(classB, gainB, hi, seed + 1) });
      if (noiseDb !== null) clips.push({ atMs: 0, samples: synthNoise('white', LEAD_MS + 2000, noiseDb, hi, r) });
      const x96 = place(clips, LEAD_MS + 2000, hi);

      const results = RATES.map((sr) => runAll(sr, resample(x96, hi, sr)));
      const counts = results.map((segs) => segs.length);
      expect(counts[1]).toBe(counts[0]);
      expect(counts[2]).toBe(counts[0]);
      for (let i = 0; i < counts[0]; i++) {
        const ts = results.map((segs) => segs[i].t);
        for (const a of ts) {
          for (const b of ts) {
            expect(Math.abs(a - b)).toBeLessThanOrEqual(P4_TOLERANCE_S + P4_SLACK_S);
          }
        }
      }
    },
    Math.max(TIMEOUT_FLOOR_MS, PBT_RUNS * P4_MS_PER_RUN),
  );
});
