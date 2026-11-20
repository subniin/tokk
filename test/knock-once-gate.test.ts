// Task 23, U2 (requirement 6): mode gating against the real engine, and the latency numbers of requirement 6.2.
// The knock is a synthetic stand-in, an impact of the class `mid` of core/synth, taught with retrainLabel as the dialog does.
// The stream is pushed in chunks of PUSH_STEP_MS. A match's delay is the stream time at the handler minus m.t (the start of
// the last knock of the pattern). The wait of the grammar alone is the stream time at the handler minus the stream time at
// which the engine reported that last knock as a sound event.
import { beforeAll, describe, expect, it } from 'vitest';
import { emptyModel } from '../core/classify/knn';
import { GAP_CONSECUTIVE_MAX_MS, GAP_REST_MAX_MS } from '../core/constants';
import { createEngine } from '../core/engine';
import type { Handlers } from '../core/engine';
import { retrainLabel } from '../core/teach';
import type { MatchEvent, SoundModel } from '../core/types';
import {
  actionOf, BINDINGS, MODE_NAMES, MODE_QUESTION_PATTERNS, MODE_START_PATTERNS, PATTERN_NO, PATTERN_SUMMON, PATTERN_YES,
} from '../apps/knock-once/src/bindings';
import { KNOCK_LABEL } from '../apps/knock-once/src/constants';
import { LEAD_MS, makeSignal, TRAIL_MS } from './helpers/engine-fixture';
import type { ImpactName } from './helpers/engine-fixture';

// Test-only values.
const SR_HZ = 48000;
const KNOCK_CLASS: ImpactName = 'mid';   // not low: see design.md "Measured values", the class of the stand-in
const KNOCK_GAIN_DB = -6;
const NOISE_DBFS = -75;
const TEACH_COUNT = 10;
const TEACH_SPACING_MS = 800;
const KNOCK_GAP_CONSECUTIVE_MS = 250;   // less than GAP_CONSECUTIVE_MAX_MS
const KNOCK_GAP_REST_MS = 600;          // a rest: 350 to 1000 ms
const KNOCK_GAP_EVEN_MS = 600;          // three evenly spaced knocks: rest, rest
const PUSH_STEP_MS = 20;
const TAIL_AFTER_MS = 2500;             // quiet after the last knock, longer than any wait
const TEACH_SEED = 7100;
const TEST_SEED = 7300;
const MS_PER_SECOND = 1000;
const STREAM_MARGIN_MS = 1;             // a rounding allowance for the time on the sample grid

let model: SoundModel;

beforeAll(() => {
  const hits = Array.from({ length: TEACH_COUNT }, (_, i) => ({ atMs: LEAD_MS + i * TEACH_SPACING_MS, cls: KNOCK_CLASS, gainDb: KNOCK_GAIN_DB }));
  const samples = makeSignal({ sampleRate: SR_HZ, totalMs: LEAD_MS + TEACH_COUNT * TEACH_SPACING_MS + TRAIL_MS, hits, seed: TEACH_SEED, noiseRmsDb: NOISE_DBFS });
  model = retrainLabel(emptyModel(SR_HZ), KNOCK_LABEL, [{ label: KNOCK_LABEL, file: 'knock.wav', samples, sampleRate: SR_HZ }]).model;
});

// Knocks at the given offsets after the lead, with quiet after them.
function knocks(offsetsMs: number[], seed = TEST_SEED): Float32Array {
  const hits = offsetsMs.map((o, i) => ({ atMs: LEAD_MS + o, cls: KNOCK_CLASS, gainDb: KNOCK_GAIN_DB - (i > 0 ? 3 : 0) }));
  return makeSignal({ sampleRate: SR_HZ, totalMs: LEAD_MS + offsetsMs[offsetsMs.length - 1] + TAIL_AFTER_MS, hits, seed, noiseRmsDb: NOISE_DBFS });
}
const ONE = [0];
const TWO = [0, KNOCK_GAP_CONSECUTIVE_MS];
const SUMMON = [0, KNOCK_GAP_CONSECUTIVE_MS, KNOCK_GAP_CONSECUTIVE_MS + KNOCK_GAP_REST_MS];
const EVEN_THREE = [0, KNOCK_GAP_EVEN_MS, 2 * KNOCK_GAP_EVEN_MS];

interface Heard { pattern: string; delayMs: number; waitMs: number }

// Runs the stream through the engine with the given modes. Times are stream times: samples pushed / sample rate.
function run(samples: Float32Array, modes: Record<string, readonly string[]>, mode: string): { heard: Heard[]; sounds: number } {
  const heard: Heard[] = [];
  let pushed = 0;
  let lastSoundAtS = Number.NaN;
  let sounds = 0;
  const handlersFor = (patterns: readonly string[]): Handlers => Object.fromEntries(patterns.map((p) => [p, (m: MatchEvent) => {
    const nowS = pushed / SR_HZ;
    heard.push({ pattern: p, delayMs: (nowS - m.t) * MS_PER_SECOND, waitMs: (nowS - lastSoundAtS) * MS_PER_SECOND });
  }]));
  const engine = createEngine({
    sounds: model,
    sampleRate: SR_HZ,
    modes: Object.fromEntries(Object.entries(modes).map(([name, patterns]) => [name, handlersFor(patterns)])),
    mode,
    onEvent: (e) => {
      if (e.kind === 'sound' && e.label === KNOCK_LABEL) {
        sounds++;
        lastSoundAtS = pushed / SR_HZ;
      }
    },
  });
  const step = Math.round((PUSH_STEP_MS * SR_HZ) / MS_PER_SECOND);
  for (let i = 0; i < samples.length; i += step) {
    const chunk = samples.subarray(i, Math.min(i + step, samples.length));
    pushed += chunk.length;
    engine.push(chunk);
  }
  engine.flush();
  return { heard, sounds };
}

const APP_MODES = (): Record<string, readonly string[]> => ({ start: MODE_START_PATTERNS, question: MODE_QUESTION_PATTERNS });
const ALL_IN_ONE = (): Record<string, readonly string[]> => ({ all: [...MODE_START_PATTERNS, ...MODE_QUESTION_PATTERNS] });
const patterns = (h: Heard[]): string[] => h.map((x) => x.pattern);

describe('the bindings (U2)', () => {
  it('two modes, three patterns, one action each, and no pattern in both modes', () => {
    expect(PATTERN_SUMMON).toBe('knock knock _ knock');
    expect(PATTERN_YES).toBe('knock');
    expect(PATTERN_NO).toBe('knock knock');
    expect([...MODE_NAMES]).toEqual(['start', 'question']);
    expect([...MODE_START_PATTERNS]).toEqual([PATTERN_SUMMON]);
    expect([...MODE_QUESTION_PATTERNS]).toEqual([PATTERN_YES, PATTERN_NO]);
    expect(BINDINGS.map((b) => [b.name, b.pattern, b.mode])).toEqual([
      ['summon', PATTERN_SUMMON, 'start'], ['yes', PATTERN_YES, 'question'], ['no', PATTERN_NO, 'question'],
    ]);
    expect(actionOf(PATTERN_SUMMON)).toBe('summon');
    expect(actionOf(PATTERN_YES)).toBe('yes');
    expect(actionOf(PATTERN_NO)).toBe('no');
    expect(() => actionOf('glass')).toThrow();
  });
});

describe('mode gating against the real engine (U2)', () => {
  it('every knock of the test streams is heard as a knock', () => {
    expect(run(knocks(SUMMON), APP_MODES(), 'start').sounds).toBe(3);
    expect(run(knocks(TWO), APP_MODES(), 'question').sounds).toBe(2);
  });

  it('start: the summon sequence summons once', () => {
    expect(patterns(run(knocks(SUMMON), APP_MODES(), 'start').heard)).toEqual([PATTERN_SUMMON]);
  });

  it('start: one knock, two knocks and three evenly spaced knocks fire nothing', () => {
    expect(run(knocks(ONE), APP_MODES(), 'start').heard).toEqual([]);
    expect(run(knocks(TWO), APP_MODES(), 'start').heard).toEqual([]);
    expect(run(knocks(EVEN_THREE), APP_MODES(), 'start').heard).toEqual([]);
  });

  it('question: one knock is yes and two quick knocks are no, once each', () => {
    expect(patterns(run(knocks(ONE), APP_MODES(), 'question').heard)).toEqual([PATTERN_YES]);
    expect(patterns(run(knocks(TWO), APP_MODES(), 'question').heard)).toEqual([PATTERN_NO]);
  });

  it('question: the summon sequence is read as what its knocks mean there, no then yes', () => {
    expect(patterns(run(knocks(SUMMON), APP_MODES(), 'question').heard)).toEqual([PATTERN_NO, PATTERN_YES]);
  });
});

describe('the latency of requirement 6.2 (U2)', () => {
  it('with two modes, yes waits at least 350 ms and no fires at the event of its second knock', () => {
    const yes = run(knocks(ONE), APP_MODES(), 'question').heard[0];
    const no = run(knocks(TWO), APP_MODES(), 'question').heard[0];
    const summon = run(knocks(SUMMON), APP_MODES(), 'start').heard[0];
    console.log(`U2 two modes: yes ${yes.delayMs.toFixed(0)} ms after m.t (grammar wait ${yes.waitMs.toFixed(0)} ms), `
      + `no ${no.delayMs.toFixed(0)} ms (grammar wait ${no.waitMs.toFixed(0)} ms), summon ${summon.delayMs.toFixed(0)} ms (grammar wait ${summon.waitMs.toFixed(0)} ms)`);
    expect(yes.delayMs).toBeGreaterThanOrEqual(GAP_CONSECUTIVE_MAX_MS - STREAM_MARGIN_MS);
    expect(no.waitMs).toBeLessThanOrEqual(PUSH_STEP_MS);
    expect(summon.waitMs).toBeLessThanOrEqual(PUSH_STEP_MS);
  });

  it('with all three patterns in one mode, yes waits at least 350 ms and no waits for the rest of up to 1000 ms', () => {
    const yes = run(knocks(ONE), ALL_IN_ONE(), 'all').heard;
    const no = run(knocks(TWO), ALL_IN_ONE(), 'all').heard;
    expect(patterns(yes)).toEqual([PATTERN_YES]);
    expect(patterns(no)).toEqual([PATTERN_NO]);
    const twoModesNo = run(knocks(TWO), APP_MODES(), 'question').heard[0];
    console.log(`U2 one mode: yes ${yes[0].delayMs.toFixed(0)} ms after m.t, no ${no[0].delayMs.toFixed(0)} ms after m.t (grammar wait ${no[0].waitMs.toFixed(0)} ms)`);
    expect(yes[0].delayMs).toBeGreaterThanOrEqual(GAP_CONSECUTIVE_MAX_MS - STREAM_MARGIN_MS);
    expect(no[0].delayMs).toBeGreaterThan(GAP_CONSECUTIVE_MAX_MS);
    expect(no[0].delayMs).toBeLessThanOrEqual(GAP_REST_MAX_MS + PUSH_STEP_MS + STREAM_MARGIN_MS);
    expect(no[0].waitMs).toBeGreaterThan(PUSH_STEP_MS);
    expect(twoModesNo.delayMs, 'two modes make the no faster').toBeLessThan(no[0].delayMs);
  });
});
