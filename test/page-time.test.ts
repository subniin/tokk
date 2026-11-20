import { describe, expect, it } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { WEB_CHUNK_MS, WEB_ENVELOPE_RESOLUTION_MS, WEB_TO_PAGE_TIME_WINDOW_MS } from '../web/constants';
import { createPageTime } from '../web/page-time';
import { msToSamples } from '../web/protocol';

// Test-only values (Task 20, U10 and U11).
const RATE_HZ = 48000;
const MS_PER_SECOND = 1000;
const OFFSET_MS = 12_345.5;            // true page time of sound time 0
const CHUNK_SAMPLES = msToSamples(WEB_CHUNK_MS, RATE_HZ);
const BIN_SAMPLES = msToSamples(WEB_ENVELOPE_RESOLUTION_MS, RATE_HZ);
const DELAY_SMALL_MS = 3;
const DELAY_LARGE_MS = 40;
const PAUSE_MS = 5000;
const EPSILON_MS = 1e-6;
const PROP_DELAY_MAX_MS = 60;
const PROP_PAUSE_MAX_MS = 20_000;
const PROP_CHUNKS_MAX = 300;
const PROP_STRETCHES_MAX = 4;

// A source of envelope messages: sound times are cumulative sample counts divided by the rate.
function source(offsetMs: number) {
  let samples = 0;
  let offset = offsetMs;
  return {
    get endT(): number { return samples / RATE_HZ; },
    get offsetMs(): number { return offset; },
    // Advances by one chunk and returns the message fields with the arrival after `delayMs`.
    next(delayMs: number) {
      const t0 = (Math.floor(samples / BIN_SAMPLES) * BIN_SAMPLES) / RATE_HZ;
      samples += CHUNK_SAMPLES;
      const endT = (Math.floor(samples / BIN_SAMPLES) * BIN_SAMPLES) / RATE_HZ;
      return { arrivalMs: endT * MS_PER_SECOND + offset + delayMs, t0, endT };
    },
    pauseFor(ms: number): void { offset += ms; },
    truth(t: number): number { return t * MS_PER_SECOND + offset; },
  };
}

describe('page time (U10)', () => {
  it('one message gives the exact offset', () => {
    const p = createPageTime();
    const s = source(OFFSET_MS);
    const m = s.next(0);
    p.envelope(m.arrivalMs, m.t0, m.endT);
    expect(p.toPageTime(0)).toBeCloseTo(OFFSET_MS, 9);
    expect(p.toPageTime(m.endT)).toBeCloseTo(s.truth(m.endT), 9);
  });

  it('the smallest delay of several wins', () => {
    const p = createPageTime();
    const s = source(OFFSET_MS);
    for (const d of [DELAY_LARGE_MS, DELAY_SMALL_MS, DELAY_LARGE_MS, DELAY_LARGE_MS]) {
      const m = s.next(d);
      p.envelope(m.arrivalMs, m.t0, m.endT);
    }
    expect(p.toPageTime(1)).toBeCloseTo(s.truth(1) + DELAY_SMALL_MS, 9);
  });

  it('a value older than the window leaves', () => {
    const p = createPageTime();
    const s = source(OFFSET_MS);
    const first = s.next(0);
    p.envelope(first.arrivalMs, first.t0, first.endT);
    let last = first;
    while (last.arrivalMs - first.arrivalMs <= WEB_TO_PAGE_TIME_WINDOW_MS) {
      last = s.next(DELAY_LARGE_MS);
      p.envelope(last.arrivalMs, last.t0, last.endT);
    }
    expect(p.toPageTime(1)).toBeCloseTo(s.truth(1) + DELAY_LARGE_MS, 9);
  });

  it('a time before a pause maps with the old stretch and a time after the resume with the new one', () => {
    const p = createPageTime();
    const s = source(OFFSET_MS);
    for (let i = 0; i < 10; i++) {
      const m = s.next(0);
      p.envelope(m.arrivalMs, m.t0, m.endT);
    }
    const before = s.endT / 2;
    const truthBefore = s.truth(before);
    p.pause();
    s.pauseFor(PAUSE_MS);
    const resumeAtMs = s.truth(s.endT);
    p.resume(resumeAtMs);
    // Provisional: the resume time stands for the end of the previous stretch.
    expect(p.toPageTime(s.endT)).toBeCloseTo(resumeAtMs, 9);
    for (let i = 0; i < 10; i++) {
      const m = s.next(DELAY_SMALL_MS);
      p.envelope(m.arrivalMs, m.t0, m.endT);
    }
    const after = s.endT - 0.01;
    expect(p.toPageTime(after)).toBeCloseTo(s.truth(after) + DELAY_SMALL_MS, 9);
    expect(p.toPageTime(before)).toBeCloseTo(truthBefore, 9);
  });

  it('the first message of a stretch replaces the provisional estimate', () => {
    const p = createPageTime();
    const s = source(OFFSET_MS);
    const m0 = s.next(0);
    p.envelope(m0.arrivalMs, m0.t0, m0.endT);
    p.pause();
    s.pauseFor(PAUSE_MS);
    p.resume(s.truth(s.endT) - DELAY_LARGE_MS);   // a provisional value that is too early
    const m = s.next(DELAY_SMALL_MS);
    p.envelope(m.arrivalMs, m.t0, m.endT);
    expect(p.toPageTime(m.endT)).toBeCloseTo(s.truth(m.endT) + DELAY_SMALL_MS, 9);
  });

  it('resume() without any audio gives a provisional mapping', () => {
    const p = createPageTime();
    p.pause();
    p.resume(OFFSET_MS);
    expect(p.toPageTime(0)).toBeCloseTo(OFFSET_MS, 9);
  });

  it('a rebuild drops the stretches and ignores old-axis messages until a message with t0 0', () => {
    const p = createPageTime();
    const s = source(OFFSET_MS);
    let m = s.next(0);
    for (let i = 0; i < 20; i++) {
      m = s.next(0);
      p.envelope(m.arrivalMs, m.t0, m.endT);
    }
    p.rebuild();
    expect(() => p.toPageTime(0)).toThrow(Error);
    expect(() => p.toPageTime(0)).toThrow(/no audio/i);
    const late = s.next(0);   // in flight from the old engine
    p.envelope(late.arrivalMs, late.t0, late.endT);
    expect(() => p.toPageTime(0)).toThrow(/no audio/i);
    const fresh = source(late.arrivalMs);
    const f = fresh.next(0);
    expect(f.t0).toBe(0);
    p.envelope(f.arrivalMs, f.t0, f.endT);
    expect(p.toPageTime(f.endT)).toBeCloseTo(fresh.truth(f.endT), 9);
  });

  it('throws an Error with no mapping, and a RangeError for a time that is not finite', () => {
    const p = createPageTime();
    expect(() => p.toPageTime(0)).toThrow(/no audio/i);
    const s = source(OFFSET_MS);
    const m = s.next(0);
    p.envelope(m.arrivalMs, m.t0, m.endT);
    for (const bad of [NaN, Infinity, -Infinity]) expect(() => p.toPageTime(bad)).toThrow(RangeError);
  });

  it('a time earlier than the first stretch uses the first stretch', () => {
    const p = createPageTime();
    const s = source(OFFSET_MS);
    const m = s.next(0);
    p.envelope(m.arrivalMs, m.t0, m.endT);
    expect(p.toPageTime(0)).toBeCloseTo(OFFSET_MS, 9);
  });
});

describe('page time property (U11)', () => {
  const stretchArb = fc.record({
    delaysMs: fc.array(fc.double({ min: 0, max: PROP_DELAY_MAX_MS, noNaN: true }), { minLength: 1, maxLength: PROP_CHUNKS_MAX }),
    pauseMs: fc.double({ min: 0, max: PROP_PAUSE_MAX_MS, noNaN: true }),
  });

  test.prop([fc.array(stretchArb, { minLength: 1, maxLength: PROP_STRETCHES_MAX })])(
    'mapped times are never early, late by at most the smallest delay in the window, and exact with a zero delay',
    (stretches) => {
      const p = createPageTime();
      const s = source(OFFSET_MS);
      const checks: { t: number; truth: number; minDelayMs: number; maxDelayMs: number }[] = [];
      for (let k = 0; k < stretches.length; k++) {
        const st = stretches[k];
        if (k > 0) {
          p.pause();
          s.pauseFor(st.pauseMs);
          p.resume(s.truth(s.endT));
        }
        const startT = s.endT;
        const sent: { arrivalMs: number; delayMs: number }[] = [];
        st.delaysMs.forEach((d, i) => {
          const m = s.next(i === st.delaysMs.length - 1 && k % 2 === 0 ? 0 : d);   // every other stretch ends with a zero delay
          p.envelope(m.arrivalMs, m.t0, m.endT);
          sent.push({ arrivalMs: m.arrivalMs, delayMs: m.arrivalMs - s.truth(m.endT) });
        });
        const lastArrival = sent[sent.length - 1].arrivalMs;
        const inWindow = sent.filter((x) => x.arrivalMs >= lastArrival - WEB_TO_PAGE_TIME_WINDOW_MS);
        const t = (startT + s.endT) / 2;
        checks.push({
          t, truth: s.truth(t),
          minDelayMs: Math.min(...inWindow.map((x) => x.delayMs)),
          maxDelayMs: Math.max(...sent.map((x) => x.delayMs)),
        });
      }
      for (const c of checks) {
        const late = p.toPageTime(c.t) - c.truth;
        expect(late).toBeGreaterThanOrEqual(-EPSILON_MS);
        expect(late).toBeLessThanOrEqual(c.maxDelayMs + EPSILON_MS);
        expect(Math.abs(late - c.minDelayMs)).toBeLessThan(EPSILON_MS);
      }
    },
  );
});
