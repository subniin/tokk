// Task 22, U2: listening off. Against the real engine, the `on` patterns of the app give click, click click, click click
// click and the two hum patterns, and the `off` patterns give click click click and nothing else for the same sounds.
import { describe, expect, it } from 'vitest';
import { createEngine } from '../core/engine';
import type { Handlers } from '../core/engine';
import { place, synthTone } from '../core/synth';
import type { MatchEvent, SoundModel } from '../core/types';
import { actionOf, BINDINGS, MODE_OFF_PATTERNS, MODE_ON_PATTERNS } from '../apps/hands-free/src/bindings';
import { buildModel, LEAD_MS, makeSignal, TRAIL_MS } from './helpers/engine-fixture';

// Test-only values.
const SR_HZ = 48000;
const CLICK_GAP_MS = 250;           // less than GAP_CONSECUTIVE_MAX_MS (350)
const CLICK_GAIN_DB = -6;
const HUM_BASELINE_HZ = 150;
const HUM_FALL_HZ = 106;            // six semitones below the baseline
const HUM_RISE_HZ = 212;            // six semitones above the baseline
const HUM_GAIN_DB = -12;
const HUM_MS = 2000;
const SEED = 4242;

const model = (): SoundModel => ({ ...buildModel(['high'], SR_HZ, { high: 'click' }), pitch: { baselineHz: HUM_BASELINE_HZ } });

function clicks(n: number): Float32Array {
  const hits = Array.from({ length: n }, (_, i) => ({ atMs: LEAD_MS + i * CLICK_GAP_MS, cls: 'high' as const, gainDb: CLICK_GAIN_DB }));
  return makeSignal({ sampleRate: SR_HZ, totalMs: LEAD_MS + n * CLICK_GAP_MS + TRAIL_MS, hits, seed: SEED });
}

function hum(fromHz: number, toHz: number | undefined): Float32Array {
  const tone = synthTone({ f0Hz: fromHz, durationMs: HUM_MS, gainDb: HUM_GAIN_DB, ...(toHz === undefined ? {} : { glideToHz: toHz }) }, SR_HZ);
  return place([{ atMs: LEAD_MS, samples: tone }], LEAD_MS + HUM_MS + TRAIL_MS, SR_HZ);
}

function run(samples: Float32Array, mode: 'on' | 'off'): MatchEvent[] {
  const matches: MatchEvent[] = [];
  const handlersFor = (patterns: readonly string[]): Handlers => Object.fromEntries(patterns.map((p) => [p, (m: MatchEvent) => matches.push(m)]));
  const engine = createEngine({
    sounds: model(),
    sampleRate: SR_HZ,
    modes: { on: handlersFor(MODE_ON_PATTERNS), off: handlersFor(MODE_OFF_PATTERNS) },
    mode,
  });
  engine.push(samples);
  engine.flush();
  return matches;
}

const patternsOf = (matches: MatchEvent[]): string[] => [...new Set(matches.map((m) => m.pattern))];

describe('listening off (U2)', () => {
  it('the table has five patterns, and off holds exactly click click click', () => {
    expect([...MODE_ON_PATTERNS].sort()).toEqual(['click', 'click click', 'click click click', 'hum.fall', 'hum.rise']);
    expect([...MODE_OFF_PATTERNS]).toEqual(['click click click']);
    expect(BINDINGS.map((b) => actionOf(b.pattern)).sort()).toEqual(['activate', 'back', 'scrollDown', 'scrollUp', 'toggle']);
    expect(actionOf('click')).toBe('activate');
    expect(actionOf('click click')).toBe('back');
    expect(actionOf('click click click')).toBe('toggle');
    expect(actionOf('hum.rise')).toBe('scrollUp');
    expect(actionOf('hum.fall')).toBe('scrollDown');
    expect(() => actionOf('whistle')).toThrow();
  });

  it('on: one click, two clicks and three clicks each give their own pattern once', () => {
    expect(patternsOf(run(clicks(1), 'on'))).toEqual(['click']);
    expect(run(clicks(1), 'on')).toHaveLength(1);
    expect(patternsOf(run(clicks(2), 'on'))).toEqual(['click click']);
    expect(run(clicks(2), 'on')).toHaveLength(1);
    expect(patternsOf(run(clicks(3), 'on'))).toEqual(['click click click']);
    expect(run(clicks(3), 'on')).toHaveLength(1);
  });

  it('on: a falling hum gives hum.fall with a speed, a rising hum hum.rise, a steady hum nothing', () => {
    const fall = run(hum(HUM_BASELINE_HZ, HUM_FALL_HZ), 'on');
    expect(fall.length).toBeGreaterThan(0);
    expect(patternsOf(fall)).toEqual(['hum.fall']);
    expect(fall.every((m) => (m.speed ?? 0) > 0)).toBe(true);
    const rise = run(hum(HUM_BASELINE_HZ, HUM_RISE_HZ), 'on');
    expect(rise.length).toBeGreaterThan(0);
    expect(patternsOf(rise)).toEqual(['hum.rise']);
    expect(run(hum(HUM_BASELINE_HZ, undefined), 'on')).toEqual([]);
  });

  it('off: three clicks give click click click, and nothing else is heard of one click, two clicks or a hum', () => {
    expect(patternsOf(run(clicks(3), 'off'))).toEqual(['click click click']);
    expect(run(clicks(3), 'off')).toHaveLength(1);
    expect(run(clicks(1), 'off')).toEqual([]);
    expect(run(clicks(2), 'off')).toEqual([]);
    expect(run(hum(HUM_BASELINE_HZ, HUM_FALL_HZ), 'off')).toEqual([]);
    expect(run(hum(HUM_BASELINE_HZ, HUM_RISE_HZ), 'off')).toEqual([]);
    expect(run(hum(HUM_BASELINE_HZ, undefined), 'off')).toEqual([]);
  });

  it('a click that waits for no longer pattern is not held back in off, and not fired as click', () => {
    // Four clicks in a row: off has no pattern for fewer than three, so only the third makes a match.
    const matches = run(clicks(4), 'off');
    expect(patternsOf(matches)).toEqual(['click click click']);
  });
});
