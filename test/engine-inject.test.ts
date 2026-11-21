// Task 32: Engine.inject feeds a sound event into the matcher and skips the classifier.
import { describe, expect, it } from 'vitest';
import { createEngine } from '../core/engine';
import type { Engine, EngineEvent } from '../core/engine';
import type { MatchEvent } from '../core/types';
import { buildModel, LEAD_MS, makeSignal } from './helpers/engine-fixture';

// Test-only values. The microphone knock is the short synthetic class 'mid': a segment is reported when it ends, and a
// gap longer than GAP_CONSECUTIVE_MAX_MS from its start would not make "knock knock" with an inject made at that moment.
const RATE_HZ = 16000;
const CHUNK_MS = 20;
const MS_PER_SECOND = 1000;
const WARMUP_MS = 1000;           // quiet before the first inject
const BEFORE_FIRE_MS = 300;       // shorter than GAP_CONSECUTIVE_MAX_MS: the longer pattern is still possible
const AFTER_FIRE_MS = 400;        // longer: nothing can extend the sound any more
const REST_MS = 600;              // a rest gap, between GAP_CONSECUTIVE_MAX_MS and GAP_REST_MAX_MS
const SETTLE_MS = 1500;
const KNOCK_GAIN_DB = -6;
const SEED = 77;
const SIGNAL_TAIL_MS = 1500;
const MAX_WAIT_MS = 3000;

const model = buildModel(['mid'], RATE_HZ, { mid: 'knock' });

interface Run { engine: Engine; matches: MatchEvent[]; events: EngineEvent[]; silence(ms: number): void }

function start(patterns: string[]): Run {
  const matches: MatchEvent[] = [];
  const events: EngineEvent[] = [];
  const engine = createEngine({
    sounds: model,
    sampleRate: RATE_HZ,
    on: Object.fromEntries(patterns.map((p) => [p, (m: MatchEvent) => matches.push(m)])),
    onEvent: (e) => events.push(e),
  });
  const chunk = Math.round((CHUNK_MS * RATE_HZ) / MS_PER_SECOND);
  const silence = (ms: number): void => {
    for (let i = 0; i < ms / CHUNK_MS; i++) engine.push(new Float32Array(chunk));
  };
  return { engine, matches, events, silence };
}

describe('Engine.inject (Task 32)', () => {
  it('one inject fires the short pattern once, after the longer pattern can no longer match', () => {
    const r = start(['knock', 'knock knock']);
    r.silence(WARMUP_MS);
    const direct = r.engine.inject('knock');
    expect(direct).toEqual([]);   // held back: "knock knock" could still follow
    r.silence(BEFORE_FIRE_MS);
    expect(r.matches).toEqual([]);
    r.silence(AFTER_FIRE_MS - BEFORE_FIRE_MS);
    expect(r.matches.map((m) => m.pattern)).toEqual(['knock']);
    r.silence(SETTLE_MS);
    expect(r.matches.length).toBe(1);
  });

  it('returns the matches it makes, calls the handler, and gives onEvent the same event', () => {
    const r = start(['knock knock']);
    r.silence(WARMUP_MS);
    r.engine.inject('knock');
    const out = r.engine.inject('knock');
    expect(out.map((m) => m.pattern)).toEqual(['knock knock']);
    expect(r.matches).toEqual(out);
    const sounds = r.events.filter((e) => e.kind === 'sound');
    expect(sounds.length).toBe(2);
    expect(sounds[0]).toEqual({ kind: 'sound', label: 'knock', t: WARMUP_MS / MS_PER_SECOND, durationMs: 0, confidence: 1 });
  });

  it('inject, a rest, inject fires "knock _ knock" once', () => {
    const r = start(['knock _ knock']);
    r.silence(WARMUP_MS);
    r.engine.inject('knock');
    r.silence(REST_MS);
    r.engine.inject('knock');
    r.silence(SETTLE_MS);
    expect(r.matches.map((m) => m.pattern)).toEqual(['knock _ knock']);
  });

  it('a knock from the microphone path plus one inject make "knock knock"', () => {
    const r = start(['knock knock']);
    const signal = makeSignal({
      sampleRate: RATE_HZ, totalMs: LEAD_MS + SIGNAL_TAIL_MS, seed: SEED,
      hits: [{ atMs: LEAD_MS, cls: 'mid', gainDb: KNOCK_GAIN_DB }],
    });
    const chunk = Math.round((CHUNK_MS * RATE_HZ) / MS_PER_SECOND);
    let at = 0;
    while (r.events.every((e) => e.kind !== 'sound') && at < signal.length) {   // until the engine has heard the knock
      r.engine.push(signal.slice(at, at + chunk));
      at += chunk;
    }
    expect(r.events.some((e) => e.kind === 'sound' && e.label === 'knock')).toBe(true);
    r.engine.inject('knock');
    r.silence(MAX_WAIT_MS);
    expect(r.matches.map((m) => m.pattern)).toEqual(['knock knock']);
  });

  it('rejects an empty label and "background" with a RangeError', () => {
    const r = start(['knock']);
    expect(() => r.engine.inject('')).toThrow(RangeError);
    expect(() => r.engine.inject('background')).toThrow(RangeError);
    expect(r.events).toEqual([]);
  });
});
