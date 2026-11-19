import { describe, it, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { readFileSync } from 'node:fs';
import { Matcher, parsePattern } from '../core/grammar';
import * as constants from '../core/constants';
import {
  BACKGROUND,
  GAP_CONSECUTIVE_MAX_MS,
  GAP_REST_MAX_MS,
  HUM_DEADZONE_SEMITONES,
  HUM_SPEED_MAX_SEMITONES,
} from '../core/constants';
import type { MatchEvent, SoundEvent } from '../core/types';

// Test-only values.
const TEST_SAMPLE_RATE_HZ = 48000;
const MS_PER_SECOND = 1000;
const SEMITONES_PER_OCTAVE = 12;
const BASELINE_HZ = 220;
const JITTER_MAX_MS = 30;
const CONSECUTIVE_NOMINAL_MIN_MS = 30;
const CONSECUTIVE_NOMINAL_MAX_MS = 319;
const REST_NOMINAL_MIN_MS = 380;
const REST_NOMINAL_MAX_MS = 969;
const BREAK_NOMINAL_MIN_MS = 1040;
const BREAK_NOMINAL_MAX_MS = 3000;
const BREAK_ANY_MAX_MS = 3000;
const SPEED_TIME_BOUND_MS = 500;
const SPEED_TEST_PATTERN_COUNT = 50;
const SPEED_TEST_EVENT_COUNT = 10_000;
const SPEED_TEST_STEP_MS = 100;
const SPEED_TEST_LABEL_COUNT = 10;
const PROP_MAX_PATTERNS = 4;
const PROP_MAX_PATTERN_LENGTH = 4;
const PROP_MAX_EVENTS = 30;
const PBT_RUNS = Number(process.env.PBT_RUNS ?? '100');
const PROP_TIMEOUT_FLOOR_MS = 20_000;
const PROP_TIMEOUT_MS_PER_RUN = 100;
const PROP_TIMEOUT_MS = Math.max(PROP_TIMEOUT_FLOOR_MS, PBT_RUNS * PROP_TIMEOUT_MS_PER_RUN);
const TIME_EPSILON_S = 1e-9;
const SOURCE_PATH = new URL('../core/grammar.ts', import.meta.url);

// Cumulative ms -> sample count -> seconds, as the engine computes t.
function eventTimeS(cumulativeMs: number): number {
  const samples = cumulativeMs * (TEST_SAMPLE_RATE_HZ / MS_PER_SECOND);
  return samples / TEST_SAMPLE_RATE_HZ;
}
function sound(label: string, cumulativeMs: number, durationMs = 50): SoundEvent {
  return { kind: 'sound', label, t: eventTimeS(cumulativeMs), durationMs, confidence: 1 };
}
function pitch(phase: 'start' | 'update' | 'end', cumulativeMs: number, valueHz: number): SoundEvent {
  return { kind: 'continuous', name: 'pitch', t: eventTimeS(cumulativeMs), value: valueHz, phase };
}
function hzAbove(baselineHz: number, semitones: number): number {
  return baselineHz * 2 ** (semitones / SEMITONES_PER_OCTAVE);
}
function run(m: Matcher, events: SoundEvent[]): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (const e of events) out.push(...m.push(e));
  out.push(...m.advance(Infinity));
  return out;
}
const S = eventTimeS;

describe('parsePattern', () => {
  it('returns tokens for valid patterns (Req 2.1, 2.5)', () => {
    expect(parsePattern('knock')).toEqual([{ type: 'sound', label: 'knock' }]);
    expect(parsePattern('knock _ knock')).toEqual([
      { type: 'sound', label: 'knock' },
      { type: 'rest' },
      { type: 'sound', label: 'knock' },
    ]);
    expect(parsePattern('  knock \t knock ')).toEqual(parsePattern('knock knock'));
    expect(parsePattern('hum.rise')).toEqual([{ type: 'sound', label: 'hum.rise' }]);
    expect(parsePattern('Knock')).toEqual([{ type: 'sound', label: 'Knock' }]);
  });

  it('rejects invalid patterns with a RangeError that quotes the pattern (Req 2.2 to 2.4)', () => {
    const bad = ['', '   ', '_', '_ knock', 'knock _', 'knock _ _ knock', 'hum.rise knock',
      'knock hum.fall', 'hum.rise hum.fall', 'hum.rise _', 'hum.up'];
    for (const src of bad) {
      let err: unknown;
      try { parsePattern(src); } catch (e) { err = e; }
      expect(err, `pattern "${src}"`).toBeInstanceOf(RangeError);
      expect((err as Error).message).toContain(`"${src}"`);
    }
    expect(parsePattern('hum')).toEqual([{ type: 'sound', label: 'hum' }]);
    expect(parsePattern('humming')).toEqual([{ type: 'sound', label: 'humming' }]);
  });
});

describe('Matcher sound sequences', () => {
  it('1 fires "knock" at once with the t of the knock (Req 5.6, 7.1)', () => {
    const m = new Matcher(['knock']);
    expect(m.push(sound('knock', 0))).toEqual([{ pattern: 'knock', t: 0 }]);
  });

  it('2 waits for a longer pattern, gives up at 350 ms (Req 5.6, 6.2, 6.3)', () => {
    const early = new Matcher(['knock', 'knock knock']);
    expect(early.push(sound('knock', 0))).toEqual([]);
    expect(early.advance(S(GAP_CONSECUTIVE_MAX_MS - 1))).toEqual([]);
    const late = new Matcher(['knock', 'knock knock']);
    late.push(sound('knock', 0));
    expect(late.advance(S(GAP_CONSECUTIVE_MAX_MS))).toEqual([{ pattern: 'knock', t: 0 }]);
    const two = new Matcher(['knock', 'knock knock']);
    expect(two.push(sound('knock', 0))).toEqual([]);
    expect(two.push(sound('knock', 200))).toEqual([{ pattern: 'knock knock', t: S(200) }]);
    expect(two.advance(Infinity)).toEqual([]);
  });

  it('3 matches "knock knock _ knock" with gaps 200 and 600 (Req 4.2, 5.2, 7.1)', () => {
    const m = new Matcher(['knock knock _ knock']);
    const out = run(m, [sound('knock', 0), sound('knock', 200), sound('knock', 800)]);
    expect(out).toEqual([{ pattern: 'knock knock _ knock', t: S(800) }]);
  });

  it('4 does not match with a last gap of 1200 (Req 4.2, 5.4)', () => {
    const m = new Matcher(['knock knock _ knock']);
    const out = run(m, [sound('knock', 0), sound('knock', 200), sound('knock', 1400)]);
    expect(out).toEqual([]);
  });

  it('7 gap borders at 349, 350, 1000 and 1001 ms (Req 4.2, 4.4)', () => {
    const gaps = (pattern: string, gapMs: number) =>
      run(new Matcher([pattern]), [sound('a', 0), sound('a', gapMs)]).length;
    expect(gaps('a a', GAP_CONSECUTIVE_MAX_MS - 1)).toBe(1);
    expect(gaps('a a', GAP_CONSECUTIVE_MAX_MS)).toBe(0);
    expect(gaps('a _ a', GAP_CONSECUTIVE_MAX_MS - 1)).toBe(0);
    expect(gaps('a _ a', GAP_CONSECUTIVE_MAX_MS)).toBe(1);
    expect(gaps('a _ a', GAP_REST_MAX_MS)).toBe(1);
    expect(gaps('a _ a', GAP_REST_MAX_MS + 1)).toBe(0);
  });

  it('8 measures the gap from the previous t, not its end (Req 4.3)', () => {
    const m = new Matcher(['a a']);
    const out = run(m, [sound('a', 0, 400), sound('a', 300, 400)]);
    expect(out).toEqual([{ pattern: 'a a', t: S(300) }]);
  });

  it('9 waiting time depends on the next token (Req 6.2, 6.3)', () => {
    const shortWait = new Matcher(['a', 'a b']);
    shortWait.push(sound('a', 0));
    expect(shortWait.advance(S(GAP_CONSECUTIVE_MAX_MS - 1))).toEqual([]);
    expect(shortWait.advance(S(GAP_CONSECUTIVE_MAX_MS))).toEqual([{ pattern: 'a', t: 0 }]);

    const restWait = new Matcher(['a', 'a _ b']);
    restWait.push(sound('a', 0));
    expect(restWait.advance(S(GAP_CONSECUTIVE_MAX_MS + 50))).toEqual([]);
    expect(restWait.advance(S(GAP_REST_MAX_MS))).toEqual([]);
    expect(restWait.advance(S(GAP_REST_MAX_MS + 1))).toEqual([{ pattern: 'a', t: 0 }]);

    const both = new Matcher(['a', 'a b', 'a _ c']);
    both.push(sound('a', 0));
    expect(both.advance(S(GAP_CONSECUTIVE_MAX_MS + 50))).toEqual([]);
    expect(both.advance(S(GAP_REST_MAX_MS))).toEqual([]);
    expect(both.advance(S(GAP_REST_MAX_MS + 1))).toEqual([{ pattern: 'a', t: 0 }]);

    const lone = new Matcher(['a _ b']);
    lone.push(sound('a', 0));
    expect(lone.advance(S(GAP_REST_MAX_MS + 1))).toEqual([]);
    expect(lone.advance(Infinity)).toEqual([]);
  });

  it('10 a clap after a knock fires "knock" before restarting (Req 5.4, 5.8)', () => {
    const m = new Matcher(['knock', 'knock knock']);
    m.push(sound('knock', 0));
    expect(m.push(sound('clap', 200))).toEqual([{ pattern: 'knock', t: 0 }]);
    const withClap = new Matcher(['knock', 'knock knock', 'clap']);
    withClap.push(sound('knock', 0));
    expect(withClap.push(sound('clap', 200))).toEqual([
      { pattern: 'knock', t: 0 },
      { pattern: 'clap', t: S(200) },
    ]);
  });

  it('11 a break fires the exact pattern of the sequence (Req 5.4, 7.1)', () => {
    const m = new Matcher(['a', 'a a', 'a a a']);
    expect(m.push(sound('a', 0))).toEqual([]);
    expect(m.push(sound('a', 200))).toEqual([]);
    expect(m.push(sound('b', 400))).toEqual([{ pattern: 'a a', t: S(200) }]);
  });

  it('12 does not backtrack (Req 5.4)', () => {
    const m = new Matcher(['a a b']);
    const out = run(m, [sound('a', 0), sound('a', 100), sound('a', 200), sound('b', 300)]);
    expect(out).toEqual([]);
  });

  it('13 match t is the last sound t in all three ways to fire (Req 7.1)', () => {
    const immediate = new Matcher(['a a']);
    immediate.push(sound('a', 0));
    expect(immediate.push(sound('a', 100))).toEqual([{ pattern: 'a a', t: S(100) }]);

    const viaAdvance = new Matcher(['a', 'a a']);
    viaAdvance.push(sound('a', 100));
    expect(viaAdvance.advance(S(5000))).toEqual([{ pattern: 'a', t: S(100) }]);

    const viaBreak = new Matcher(['a', 'a a']);
    viaBreak.push(sound('a', 100));
    expect(viaBreak.push(sound('b', 5000))).toEqual([{ pattern: 'a', t: S(100) }]);
  });

  it('31 a label in no pattern breaks the pending sequence and is dropped (Req 8.7)', () => {
    const m = new Matcher(['a a']);
    const out = run(m, [sound('a', 0), sound('x', 100), sound('a', 200)]);
    expect(out).toEqual([]);
  });

  it('19 ignores background sounds (Req 8.1)', () => {
    const m = new Matcher(['a a']);
    expect(m.push(sound('a', 0))).toEqual([]);
    expect(m.push(sound(BACKGROUND, 100))).toEqual([]);
    expect(m.push(sound('a', 200))).toEqual([{ pattern: 'a a', t: S(200) }]);
  });

  it('30 advance never moves time back and is idempotent (Req 6.5, 6.7, 8.4)', () => {
    const m = new Matcher(['a', 'a b']);
    expect(m.advance(10)).toEqual([]);
    expect(m.push(sound('a', 500))).toEqual([]);
    // advance(0.6 s) behaves as advance(10 s): the candidate is dead.
    expect(m.advance(0.6)).toEqual([{ pattern: 'a', t: S(500) }]);
    expect(m.advance(0.6)).toEqual([]);
    expect(m.advance(Infinity)).toEqual([]);
    const empty = new Matcher(['a']);
    expect(empty.advance(Infinity)).toEqual([]);
  });
});

describe('Matcher construction and setPatterns', () => {
  it('14 rejects duplicate patterns, naming both (Req 3.5)', () => {
    expect(() => new Matcher(['a b', 'a  b'])).toThrow(RangeError);
    try {
      new Matcher(['a b', 'a  b']);
    } catch (e) {
      expect((e as Error).message).toContain('"a b"');
      expect((e as Error).message).toContain('"a  b"');
    }
    const m = new Matcher(['x']);
    expect(() => m.setPatterns(['a b', 'a  b'])).toThrow(RangeError);
  });

  it('15 accepts an empty pattern list (Req 3.6)', () => {
    const m = new Matcher([]);
    expect(run(m, [sound('a', 0), sound('a', 100)])).toEqual([]);
  });

  it('16 setPatterns drops the pending sequence without firing (Req 3.8, 10.2)', () => {
    const m = new Matcher(['a', 'a b']);
    m.push(sound('a', 0));
    expect(m.setPatterns(['a a'])).toBeUndefined();
    expect(m.push(sound('a', 100))).toEqual([]);
    expect(m.advance(Infinity)).toEqual([]);
  });

  it('17 setPatterns with an invalid pattern keeps the old state (Req 3.7)', () => {
    const m = new Matcher(['a a']);
    m.push(sound('a', 0));
    expect(() => m.setPatterns(['a', '_'])).toThrow(RangeError);
    expect(m.push(sound('a', 100))).toEqual([{ pattern: 'a a', t: S(100) }]);
  });

  it('18 a mode switch removes the wait (Req 10.1)', () => {
    const m = new Matcher(['knock', 'knock knock _ knock']);
    m.setPatterns(['knock']);
    expect(m.push(sound('knock', 0))).toEqual([{ pattern: 'knock', t: 0 }]);
  });

  it('28 checks baselineHz (Req 3.3, 3.4, 3.7)', () => {
    expect(() => new Matcher(['hum.rise'])).toThrow(RangeError);
    expect(() => new Matcher(['hum.rise'])).toThrow(/baselineHz/);
    expect(() => new Matcher(['a'])).not.toThrow();
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(() => new Matcher(['a'], bad)).toThrow(RangeError);
    }
    const m = new Matcher(['a']);
    expect(() => m.setPatterns(['hum.rise'])).toThrow(RangeError);
    expect(m.push(sound('a', 0))).toEqual([{ pattern: 'a', t: 0 }]);
  });

  it('32 reports pattern strings as given and no speed key on sound matches (Req 1.4, 3.2)', () => {
    const m = new Matcher(['knock  knock']);
    const out = run(m, [sound('knock', 0), sound('knock', 100)]);
    expect(out).toEqual([{ pattern: 'knock  knock', t: S(100) }]);
    expect('speed' in out[0]).toBe(false);
  });
});

describe('Matcher continuous events and hum', () => {
  const offBy = (semitones: number) => hzAbove(BASELINE_HZ, semitones);

  it('20 ignores continuous start and end (Req 8.2, 9.1)', () => {
    const m = new Matcher(['knock knock', 'hum.rise'], BASELINE_HZ);
    expect(m.push(sound('knock', 0))).toEqual([]);
    expect(m.push(pitch('start', 50, offBy(12)))).toEqual([]);
    expect(m.push(pitch('end', 100, offBy(12)))).toEqual([]);
    expect(m.push(sound('knock', 200))).toEqual([{ pattern: 'knock knock', t: S(200) }]);
  });

  it('21 hum updates do not touch the sound sequence (Req 8.3)', () => {
    const m = new Matcher(['knock knock', 'hum.rise'], BASELINE_HZ);
    m.push(sound('knock', 0));
    const hum = m.push(pitch('update', 100, offBy(4)));
    expect(hum.map((x) => x.pattern)).toEqual(['hum.rise']);
    expect(m.push(sound('knock', 200))).toEqual([{ pattern: 'knock knock', t: S(200) }]);
  });

  it('22 hum.rise fires 4 semitones above with speed 2 (Req 9.1, 9.2, 7.2)', () => {
    const m = new Matcher(['hum.rise'], BASELINE_HZ);
    const out = m.push(pitch('update', 120, offBy(HUM_DEADZONE_SEMITONES + 2)));
    expect(out).toHaveLength(1);
    expect(out[0].pattern).toBe('hum.rise');
    expect(out[0].t).toBe(S(120));
    expect(out[0].speed).toBeCloseTo(2, 9);
  });

  it('23 fires nothing inside the dead zone (Req 9.3)', () => {
    const m = new Matcher(['hum.rise', 'hum.fall'], BASELINE_HZ);
    expect(m.push(pitch('update', 0, offBy(HUM_DEADZONE_SEMITONES - 0.5)))).toEqual([]);
    expect(m.push(pitch('update', 10, offBy(-(HUM_DEADZONE_SEMITONES - 0.5))))).toEqual([]);
    const out = m.push(pitch('update', 20, offBy(HUM_DEADZONE_SEMITONES + 0.01)));
    expect(out).toHaveLength(1);
    expect(out[0].speed).toBeGreaterThan(0);
    expect(out[0].speed).toBeLessThan(0.1);
  });

  it('24 hum.fall fires 5 semitones below with speed 3 (Req 9.2)', () => {
    const m = new Matcher(['hum.fall'], BASELINE_HZ);
    const out = m.push(pitch('update', 0, offBy(-(HUM_DEADZONE_SEMITONES + 3))));
    expect(out[0].pattern).toBe('hum.fall');
    expect(out[0].speed).toBeCloseTo(3, 9);
  });

  it('25 caps the speed (Req 9.2)', () => {
    const m = new Matcher(['hum.rise', 'hum.fall'], BASELINE_HZ);
    const cap = HUM_SPEED_MAX_SEMITONES;
    const far = HUM_DEADZONE_SEMITONES + cap + 14;
    expect(m.push(pitch('update', 0, offBy(far)))[0].speed).toBe(cap);
    expect(m.push(pitch('update', 10, offBy(-far)))[0].speed).toBe(cap);
    expect(m.push(pitch('update', 20, offBy(7.5)))[0].speed).toBeCloseTo(5.5, 9);
    expect(m.push(pitch('update', 30, offBy(8.5)))[0].speed).toBe(cap);
  });

  it('26 fires on every update outside the dead zone (Req 9.4)', () => {
    const m = new Matcher(['hum.rise'], BASELINE_HZ);
    const out = [0, 10, 20].flatMap((ms) => m.push(pitch('update', ms, offBy(5))));
    expect(out.map((x) => x.t)).toEqual([S(0), S(10), S(20)]);
  });

  it('27 only the registered direction fires (Req 9.5, 9.6)', () => {
    const rise = new Matcher(['hum.rise'], BASELINE_HZ);
    expect(rise.push(pitch('update', 0, offBy(-5)))).toEqual([]);
    const both = new Matcher(['hum.rise', 'hum.fall'], BASELINE_HZ);
    expect(both.push(pitch('update', 0, offBy(5)))).toHaveLength(1);
  });

  it('29 invalid input throws RangeError and leaves the state (Req 8.5)', () => {
    const m = new Matcher(['a a', 'hum.rise'], BASELINE_HZ);
    m.push(sound('a', 500));
    expect(() => m.push(sound('a', NaN))).toThrow(RangeError);
    expect(() => m.push(sound('a', 100))).toThrow(RangeError);
    expect(() => m.push(pitch('update', 0, 0))).toThrow(RangeError);
    expect(() => m.push(pitch('update', 0, NaN))).toThrow(RangeError);
    expect(() => m.push(pitch('update', NaN, offBy(5)))).toThrow(RangeError);
    expect(() => m.advance(NaN)).toThrow(RangeError);
    expect(m.push(sound('a', 700))).toEqual([{ pattern: 'a a', t: S(700) }]);
  });
});

describe('Matcher limits and source', () => {
  it('33 runs 50 patterns and 10 000 events quickly (Req 12.5)', () => {
    const patterns: string[] = [];
    for (let i = 0; i < SPEED_TEST_PATTERN_COUNT; i++) {
      const l = (n: number) => `l${n % SPEED_TEST_LABEL_COUNT}`;
      patterns.push(`${l(i)} ${l(Math.floor(i / SPEED_TEST_LABEL_COUNT))} ${l(i * 7)}`);
    }
    const m = new Matcher(patterns);
    const start = performance.now();
    let matches = 0;
    for (let i = 0; i < SPEED_TEST_EVENT_COUNT; i++) {
      const label = `l${(i * 31) % SPEED_TEST_LABEL_COUNT}`;
      matches += m.push(sound(label, i * SPEED_TEST_STEP_MS)).length;
    }
    matches += m.advance(Infinity).length;
    expect(performance.now() - start).toBeLessThan(SPEED_TIME_BOUND_MS);
    expect(matches).toBeGreaterThanOrEqual(0);
  });

  it('34 source has no forbidden import, API or literal threshold (Req 12.1, 12.2)', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    const code = src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((x) => x[1]);
    for (const spec of imports) expect(spec).toMatch(/^\.\/(types|constants)$/);
    expect(code).not.toMatch(/Math\.random|fetch|\bDate\b|performance|document|window|AudioContext/);
    const lines = code.split('\n').filter((l) => !/^\s*const MS_PER_SECOND = 1000;/.test(l));
    for (const l of lines) expect(l).not.toMatch(/\b(350|1000)\b/);
  });

  it('35 exports GAP_TOLERANCE_MS below 0.001 (Req 12.2)', () => {
    const tol = (constants as Record<string, unknown>).GAP_TOLERANCE_MS;
    expect(typeof tol).toBe('number');
    expect(tol as number).toBeGreaterThan(0);
    expect(tol as number).toBeLessThan(0.001);
  });
});

// Generators for the properties.
const labelArb = fc.constantFrom('a', 'b', 'c');
const patternArb = fc
  .record({
    labels: fc.array(labelArb, { minLength: 1, maxLength: PROP_MAX_PATTERN_LENGTH }),
    rests: fc.array(fc.boolean(), { minLength: PROP_MAX_PATTERN_LENGTH, maxLength: PROP_MAX_PATTERN_LENGTH }),
  })
  .map(({ labels, rests }) =>
    labels.map((label, i) => (i > 0 && rests[i - 1] ? `_ ${label}` : label)).join(' '),
  );
const patternsArb = fc
  .array(patternArb, { minLength: 1, maxLength: PROP_MAX_PATTERNS })
  .map((ps) => [...new Set(ps)]);
const eventLabelArb = fc.constantFrom('a', 'b', 'c', 'x');
const gapClassArb = fc.constantFrom('consecutive', 'rest', 'break');

type Spec = { label: string; gapMs: number };
function buildEvents(specs: Spec[]): SoundEvent[] {
  let cum = 0;
  return specs.map((s) => {
    cum += s.gapMs;
    return sound(s.label, cum);
  });
}

describe('P5 properties', () => {
  // P5a (Req 11.1, 11.2): identical calls give identical matches.
  const anyGapArb = fc.oneof(
    fc.integer({ min: 1, max: GAP_CONSECUTIVE_MAX_MS - 1 }),
    fc.integer({ min: GAP_CONSECUTIVE_MAX_MS, max: GAP_REST_MAX_MS }),
    fc.integer({ min: GAP_REST_MAX_MS + 1, max: BREAK_ANY_MAX_MS }),
  );
  const anySpecsArb = fc.array(fc.record({ label: eventLabelArb, gapMs: anyGapArb }), { maxLength: PROP_MAX_EVENTS });

  test.prop([patternsArb, anySpecsArb])(
    'P5 identical event sequences give identical matches (Req 11.1, 11.2)',
    (patterns, specs) => {
      const events = buildEvents(specs);
      const first = run(new Matcher(patterns), events);
      const second = run(new Matcher(patterns), events);
      expect(second).toEqual(first);
      const reused = new Matcher(patterns);
      run(reused, events);
      reused.setPatterns(patterns);
      expect(run(reused, events)).toEqual(first);
    },
    PROP_TIMEOUT_MS,
  );

  // P5b (Req 11.4): jitter inside the ranges does not change the matches.
  const classedArb = fc.record({
    label: eventLabelArb,
    cls: gapClassArb,
    nominal: fc.integer({ min: 0, max: 1_000_000 }),
    jitter: fc.integer({ min: -JITTER_MAX_MS, max: JITTER_MAX_MS }),
  });
  const rangeOf = (cls: string): [number, number] =>
    cls === 'consecutive'
      ? [CONSECUTIVE_NOMINAL_MIN_MS, CONSECUTIVE_NOMINAL_MAX_MS]
      : cls === 'rest'
        ? [REST_NOMINAL_MIN_MS, REST_NOMINAL_MAX_MS]
        : [BREAK_NOMINAL_MIN_MS, BREAK_NOMINAL_MAX_MS];

  test.prop([patternsArb, fc.array(classedArb, { maxLength: PROP_MAX_EVENTS })])(
    'P5 jitter of 30 ms inside ranges does not change matches (Req 11.4)',
    (patterns, items) => {
      const nominal: Spec[] = [];
      const jittered: Spec[] = [];
      for (const it of items) {
        const [lo, hi] = rangeOf(it.cls);
        const gap = lo + (it.nominal % (hi - lo + 1));
        nominal.push({ label: it.label, gapMs: gap });
        jittered.push({ label: it.label, gapMs: gap + it.jitter });
      }
      const a = run(new Matcher(patterns), buildEvents(nominal));
      const b = run(new Matcher(patterns), buildEvents(jittered));
      expect(b.map((x) => x.pattern)).toEqual(a.map((x) => x.pattern));
      const bound = (items.length * JITTER_MAX_MS) / MS_PER_SECOND + TIME_EPSILON_S;
      for (let i = 0; i < a.length; i++) expect(Math.abs(b[i].t - a[i].t)).toBeLessThanOrEqual(bound);
    },
    PROP_TIMEOUT_MS,
  );

  // P5c (Req 11.3, 6.8): the placement of advance calls does not change matches.
  const advSpecsArb = fc.array(
    fc.record({
      label: eventLabelArb,
      gapMs: anyGapArb,
      advPercent: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
    }),
    { maxLength: PROP_MAX_EVENTS },
  );

  test.prop([patternsArb, advSpecsArb])(
    'P5 the placement of advance calls does not change matches (Req 11.3, 6.8)',
    (patterns, specs) => {
      const plain = new Matcher(patterns);
      const withAdvance = new Matcher(patterns);
      const outPlain: MatchEvent[] = [];
      const outAdv: MatchEvent[] = [];
      let cum = 0;
      for (const s of specs) {
        const prev = cum;
        cum += s.gapMs;
        if (s.advPercent !== undefined) {
          const at = prev + Math.floor((s.gapMs * s.advPercent) / 100);
          outAdv.push(...withAdvance.advance(eventTimeS(at)));
        }
        outPlain.push(...plain.push(sound(s.label, cum)));
        outAdv.push(...withAdvance.push(sound(s.label, cum)));
      }
      outPlain.push(...plain.advance(Infinity));
      outAdv.push(...withAdvance.advance(Infinity));
      expect(outAdv).toEqual(outPlain);
    },
    PROP_TIMEOUT_MS,
  );
});

