import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BACKGROUND, HUM_LABEL, MIN_EXAMPLES_PER_LABEL, MODEL_VERSION, NOISE_FLOOR_WARMUP_MS, RECOMMENDED_EXAMPLES_PER_LABEL } from '../core/constants';
import type { TeachReport } from '../core/teach';
import type { SoundModel } from '../core/types';
import { WEB_TEACH_BACKGROUND_RECORD_MS, WEB_TEACH_HUM_RECORD_MS, WEB_TEACH_PROGRESS_REDUCED_MOTION_MS } from '../web/constants';
import { countLine, exampleLine, percentText, replaceLine, reportLines, savedLine, stepText } from '../web/teach-ui/format';
import { countdownSeconds, doneState, initialState, keptCount, quietProgress, reduce, saveState, shouldUpdateProgress, validateLabel } from '../web/teach-ui/state';
import type { TeachAction, TeachState } from '../web/teach-ui/state';

// Test-only values.
const SAMPLE_RATE_HZ = 48000;
const MS_PER_SECOND = 1000;
const HALF_SECOND_SAMPLES = SAMPLE_RATE_HZ / 2;
const QUIET_SAMPLES = Math.round((NOISE_FLOOR_WARMUP_MS * SAMPLE_RATE_HZ) / MS_PER_SECOND);
const SEGMENT_DURATION_MS = 120;
const SEGMENT_SPACING_SAMPLES = 28800;       // 600 ms at 48000 Hz
const THUMB_BINS = 4;
const LABEL_MAX_LENGTH = 32;
const PBT_ACTIONS_MAX = 40;
const NOW_MS = 5000;

const t = (samples: number): number => samples / SAMPLE_RATE_HZ;
const TARGET = RECOMMENDED_EXAMPLES_PER_LABEL;

function model(): SoundModel {
  return {
    version: MODEL_VERSION, k: 3, sampleRate: SAMPLE_RATE_HZ, mean: [0], std: [1],
    examples: [{ id: 'a/x#0', label: 'a', v: [0] }], thresholds: { a: 1 },
  };
}

function report(over: Partial<TeachReport> = {}): TeachReport {
  return { labels: [{ label: 'tap', examples: 10, looAccuracy: 1 }], confusedPairs: [], warnings: [], ...over };
}

function segment(i: number): TeachAction {
  return {
    type: 'segment', id: `tap/teach.wav#${i}`, t: t(QUIET_SAMPLES + i * SEGMENT_SPACING_SAMPLES), durationMs: SEGMENT_DURATION_MS,
    min: new Float32Array(THUMB_BINS), max: new Float32Array(THUMB_BINS),
  };
}

function run(s: TeachState, ...actions: TeachAction[]): TeachState {
  return actions.reduce(reduce, s);
}

function recording(label = 'tap', count = 0): TeachState {
  let s = run(initialState({ label, target: TARGET }), { type: 'progress', t: t(QUIET_SAMPLES) });
  for (let i = 0; i < count; i++) s = reduce(s, segment(i));
  return s;
}

describe('teach state: phases', () => {
  it('a sound goes quiet, recording, review, saved', () => {
    let s = initialState({ label: 'tap', target: TARGET });
    expect(s.phase).toBe('quiet');
    s = reduce(s, { type: 'progress', t: t(HALF_SECOND_SAMPLES) });
    expect(s.phase).toBe('quiet');
    expect(quietProgress(s)).toBeCloseTo(0.5, 5);
    s = reduce(s, { type: 'progress', t: t(QUIET_SAMPLES) });
    expect(s.phase).toBe('recording');
    expect(quietProgress(s)).toBe(1);
    for (let i = 0; i < MIN_EXAMPLES_PER_LABEL; i++) s = reduce(s, segment(i));
    s = reduce(s, { type: 'done' });
    expect(s.finishing).toBe(true);
    s = reduce(s, { type: 'trained', model: model(), report: report() });
    expect(s.phase).toBe('review');
    s = reduce(s, { type: 'save' });
    expect(s.phase).toBe('saved');
    s = reduce(s, { type: 'stored', ok: false });
    expect(s.saveStored).toBe(false);
  });

  it('quiet progress never goes above 1', () => {
    const s = run(initialState({ label: 'tap', target: TARGET }), { type: 'progress', t: t(QUIET_SAMPLES * 3) });
    expect(quietProgress(s)).toBe(1);
  });

  it('hum and background start in recording', () => {
    expect(initialState({ label: HUM_LABEL, target: TARGET }).phase).toBe('recording');
    expect(initialState({ label: BACKGROUND, target: TARGET }).phase).toBe('recording');
    expect(initialState({ label: HUM_LABEL, target: TARGET }).kind).toBe('hum');
    expect(initialState({ label: BACKGROUND, target: TARGET }).kind).toBe('background');
  });

  it('cancel works from every phase except saved', () => {
    const quiet = initialState({ label: 'tap', target: TARGET });
    let rec = recording('tap', MIN_EXAMPLES_PER_LABEL);
    const finishing = reduce(rec, { type: 'done' });
    const review = reduce(finishing, { type: 'trained', model: model(), report: report() });
    const saved = reduce(review, { type: 'save' });
    for (const s of [quiet, rec, finishing, review]) expect(reduce(s, { type: 'cancel' }).phase).toBe('cancelled');
    expect(reduce(saved, { type: 'cancel' })).toBe(saved);
    rec = reduce(rec, { type: 'cancel' });
    expect(reduce(rec, { type: 'cancel' })).toBe(rec);
  });

  it('record again returns to the first phase with an empty list', () => {
    let s = recording('tap', MIN_EXAMPLES_PER_LABEL);
    s = run(s, { type: 'done' }, { type: 'failed', message: 'x' });
    expect(s.phase).toBe('review');
    expect(s.report).toBeNull();
    s = reduce(s, { type: 'again' });
    expect(s.phase).toBe('quiet');
    expect(s.examples).toEqual([]);
    expect(s.elapsedMs).toBe(0);
    const hum = run(initialState({ label: HUM_LABEL, target: TARGET }), { type: 'progress', t: 3 }, { type: 'done' }, { type: 'failed', message: 'x' }, { type: 'again' });
    expect(hum.phase).toBe('recording');
  });

  it('a limit message is remembered', () => {
    const s = reduce(recording('tap', 1), { type: 'limit' });
    expect(s.limitReached).toBe(true);
  });
});

describe('teach state: examples', () => {
  it('numbers examples from 1 and keeps the numbers after a delete', () => {
    let s = recording('tap', 3);
    expect(s.examples.map((e) => e.number)).toEqual([1, 2, 3]);
    s = reduce(s, { type: 'delete', id: 'tap/teach.wav#1' });
    expect(keptCount(s)).toBe(2);
    expect(s.examples.map((e) => [e.number, e.deleted])).toEqual([[1, false], [2, true], [3, false]]);
    s = reduce(s, segment(3));
    expect(s.examples[3].number).toBe(4);
  });

  it('a segment in the quiet phase is added and moves to recording', () => {
    const s = reduce(initialState({ label: 'tap', target: TARGET }), segment(0));
    expect(s.phase).toBe('recording');
    expect(s.examples).toHaveLength(1);
  });

  it('ignores a duplicate id, an unknown delete and a second delete', () => {
    const s = recording('tap', 2);
    expect(reduce(s, segment(1))).toBe(s);
    expect(reduce(s, { type: 'delete', id: 'nope' })).toBe(s);
    const d = reduce(s, { type: 'delete', id: 'tap/teach.wav#0' });
    expect(reduce(d, { type: 'delete', id: 'tap/teach.wav#0' })).toBe(d);
  });

  it('hum and background take no segments', () => {
    const s = initialState({ label: HUM_LABEL, target: TARGET });
    expect(reduce(s, segment(0))).toBe(s);
  });
});

describe('teach state: Done and Save gates', () => {
  it('Done is disabled below the minimum with the numbers in the reason', () => {
    const s = recording('tap', MIN_EXAMPLES_PER_LABEL - 2);
    const g = doneState(s);
    expect(g.enabled).toBe(false);
    expect(g.reason).toBe(`Keep at least ${MIN_EXAMPLES_PER_LABEL} examples. You have ${MIN_EXAMPLES_PER_LABEL - 2}.`);
    expect(reduce(s, { type: 'done' })).toBe(s);
  });

  it('Done is enabled at the minimum and counts only kept examples', () => {
    let s = recording('tap', MIN_EXAMPLES_PER_LABEL);
    expect(doneState(s).enabled).toBe(true);
    s = reduce(s, { type: 'delete', id: 'tap/teach.wav#0' });
    expect(doneState(s).enabled).toBe(false);
    expect(doneState(s).reason).toContain(`You have ${MIN_EXAMPLES_PER_LABEL - 1}`);
  });

  it('Done says why in quiet and while training', () => {
    const quiet = initialState({ label: 'tap', target: TARGET });
    expect(doneState(quiet)).toEqual({ enabled: false, reason: expect.stringMatching(/quiet/i) });
    const finishing = reduce(recording('tap', MIN_EXAMPLES_PER_LABEL), { type: 'done' });
    expect(doneState(finishing).enabled).toBe(false);
    expect(doneState(finishing).reason).toMatch(/trained/);
    expect(reduce(finishing, { type: 'done' })).toBe(finishing);
  });

  it('hum and background need their recording time', () => {
    for (const [label, ms] of [[HUM_LABEL, WEB_TEACH_HUM_RECORD_MS], [BACKGROUND, WEB_TEACH_BACKGROUND_RECORD_MS]] as const) {
      const start = initialState({ label, target: TARGET });
      expect(doneState(start).enabled).toBe(false);
      expect(doneState(start).reason).toMatch(/1 more second|\d+ more seconds/);
      const almost = reduce(start, { type: 'progress', t: t(Math.round(((ms - 1) * SAMPLE_RATE_HZ) / MS_PER_SECOND)) });
      expect(doneState(almost).enabled).toBe(false);
      expect(doneState(almost).reason).toContain('1 more second');
      const enough = reduce(start, { type: 'progress', t: ms / MS_PER_SECOND });
      expect(doneState(enough).enabled).toBe(true);
    }
  });

  it('the hum reason rounds up to whole seconds and never below 1', () => {
    const start = initialState({ label: HUM_LABEL, target: TARGET });
    expect(doneState(start).reason).toContain(`${WEB_TEACH_HUM_RECORD_MS / MS_PER_SECOND} more seconds`);
  });

  it('Save needs a report, and for hum a pitch', () => {
    const failed = run(recording('tap', MIN_EXAMPLES_PER_LABEL), { type: 'done' }, { type: 'failed', message: 'Too few.' });
    expect(failed.error).toBe('Too few.');
    expect(saveState(failed).enabled).toBe(false);
    expect(saveState(failed).reason.length).toBeGreaterThan(0);
    expect(reduce(failed, { type: 'save' })).toBe(failed);

    const noPitch = report({ warnings: [{ file: 'hum/teach.wav', code: 'no-pitch-found', message: 'no hum' }] });
    const hum = run(initialState({ label: HUM_LABEL, target: TARGET }), { type: 'progress', t: WEB_TEACH_HUM_RECORD_MS / MS_PER_SECOND }, { type: 'done' }, { type: 'trained', model: model(), report: noPitch });
    expect(saveState(hum).enabled).toBe(false);
    expect(saveState(hum).reason).toMatch(/hum/i);
    const good = run(recording('tap', MIN_EXAMPLES_PER_LABEL), { type: 'done' }, { type: 'trained', model: model(), report: report() });
    expect(saveState(good)).toEqual({ enabled: true, reason: '' });
  });
});

describe('teach state: invalid actions and property', () => {
  it('actions that do not apply return the same object', () => {
    const quiet = initialState({ label: 'tap', target: TARGET });
    expect(reduce(quiet, { type: 'save' })).toBe(quiet);
    expect(reduce(quiet, { type: 'again' })).toBe(quiet);
    expect(reduce(quiet, { type: 'trained', model: model(), report: report() })).toBe(quiet);
    expect(reduce(quiet, { type: 'failed', message: 'x' })).toBe(quiet);
    expect(reduce(quiet, { type: 'stored', ok: true })).toBe(quiet);
    expect(reduce(quiet, { type: 'delete', id: 'x' })).toBe(quiet);
  });

  const actionArb: fc.Arbitrary<TeachAction> = fc.oneof(
    fc.double({ min: 0, max: 20, noNaN: true }).map((x): TeachAction => ({ type: 'progress', t: x })),
    fc.nat(12).map((i): TeachAction => segment(i)),
    fc.nat(12).map((i): TeachAction => ({ type: 'delete', id: `tap/teach.wav#${i}` })),
    fc.constant<TeachAction>({ type: 'done' }),
    fc.constant<TeachAction>({ type: 'trained', model: model(), report: report() }),
    fc.constant<TeachAction>({ type: 'failed', message: 'x' }),
    fc.constant<TeachAction>({ type: 'limit' }),
    fc.constant<TeachAction>({ type: 'save' }),
    fc.constant<TeachAction>({ type: 'again' }),
    fc.constant<TeachAction>({ type: 'cancel' }),
    fc.boolean().map((ok): TeachAction => ({ type: 'stored', ok })),
  );

  it('random action sequences keep a valid phase, a non-negative count and the identity rule', () => {
    const phases = ['quiet', 'recording', 'review', 'saved', 'cancelled'];
    fc.assert(fc.property(fc.constantFrom('tap', HUM_LABEL, BACKGROUND), fc.array(actionArb, { maxLength: PBT_ACTIONS_MAX }), (label, actions) => {
      let s = initialState({ label, target: TARGET });
      for (const a of actions) {
        const next = reduce(s, a);
        expect(phases).toContain(next.phase);
        expect(keptCount(next)).toBeGreaterThanOrEqual(0);
        if (next !== s) expect(s.phase === 'cancelled').toBe(false);   // nothing leaves cancelled
        s = next;
      }
      expect(s.examples.every((e, i) => e.number === i + 1)).toBe(true);
    }));
  });
});

describe('validateLabel', () => {
  it.each(['tap', 'a', 'clap-2', 'background', 'hum', 'a'.repeat(LABEL_MAX_LENGTH)])('accepts %s', (label) => {
    expect(validateLabel(label)).toBeNull();
  });
  it.each(['', 'Tap', '1tap', '-a', 'a b', 'a_b', 'a'.repeat(LABEL_MAX_LENGTH + 1), 'tap!'])('rejects "%s" with the rule', (label) => {
    const message = validateLabel(label);
    expect(message).not.toBeNull();
    expect(message).toContain('^[a-z][a-z0-9-]{0,31}$');
  });
});

describe('progress update rule', () => {
  it('updates always without reduced motion', () => {
    expect(shouldUpdateProgress({ reducedMotion: false, nowMs: NOW_MS, lastUpdateMs: NOW_MS })).toBe(true);
  });
  it('limits reduced motion to one update per interval', () => {
    expect(shouldUpdateProgress({ reducedMotion: true, nowMs: NOW_MS, lastUpdateMs: null })).toBe(true);
    expect(shouldUpdateProgress({ reducedMotion: true, nowMs: NOW_MS, lastUpdateMs: NOW_MS - WEB_TEACH_PROGRESS_REDUCED_MOTION_MS + 1 })).toBe(false);
    expect(shouldUpdateProgress({ reducedMotion: true, nowMs: NOW_MS, lastUpdateMs: NOW_MS - WEB_TEACH_PROGRESS_REDUCED_MOTION_MS })).toBe(true);
  });
});

describe('teach text', () => {
  const full = report({
    labels: [{ label: 'tap', examples: 10, looAccuracy: 1 }, { label: 'clap', examples: 12, looAccuracy: 0.8333 }],
    confusedPairs: [{ a: 'tap', b: 'clap', rate: 0.2 }],
    warnings: [{ file: 'tap/teach.wav', code: 'sample-rate-mismatch', message: 'tap/teach.wav has a sample rate of 44100 Hz.' }],
  });

  it('writes the step texts', () => {
    const quiet = initialState({ label: 'tap', target: TARGET });
    expect(stepText(quiet)).toBe('Stay quiet for 1 second');
    expect(stepText(recording('tap', 0))).toBe(`Make the sound ${TARGET} times`);
    expect(stepText(initialState({ label: HUM_LABEL, target: TARGET }))).toMatch(/hum/i);
    expect(stepText(initialState({ label: BACKGROUND, target: TARGET }))).toMatch(/noise/i);
    const training = reduce(recording('tap', MIN_EXAMPLES_PER_LABEL), { type: 'done' });
    expect(stepText(training)).toBe('Training...');
    expect(countLine(reduce(recording('tap', 3), { type: 'delete', id: 'tap/teach.wav#0' }))).toBe(`3 of ${TARGET} heard, 2 kept`);
    expect(exampleLine(recording('tap', 1).examples[0])).toBe('Example 1: starts at 1.00 s, lasts 0.12 s');
  });

  it('writes one line per label with whole percents', () => {
    const lines = reportLines(full, null);
    expect(lines).toContain('tap: 100% of 10 examples were recognised when left out one by one');
    expect(lines).toContain('clap: 83% of 12 examples were recognised when left out one by one');
    expect(lines).toContain('tap is sometimes heard as clap (20% of tap examples)');
    expect(lines).toContain('tap/teach.wav has a sample rate of 44100 Hz.');
  });

  it('says so when no pair is confused', () => {
    expect(reportLines(report(), null).some((l) => /no .*confus/i.test(l))).toBe(true);
  });

  it('shows the pitch baseline as a whole number of Hz', () => {
    const m: SoundModel = { ...model(), pitch: { baselineHz: 123.6 } };
    expect(reportLines(report(), m)).toContain('Hum pitch: 124 Hz');
    expect(reportLines(report(), model()).some((l) => l.startsWith('Hum pitch'))).toBe(false);
  });

  it('says that existing examples are replaced', () => {
    const m: SoundModel = { ...model(), examples: [{ id: 'a/x#0', label: 'a', v: [0] }, { id: 'a/x#1', label: 'a', v: [0] }] };
    expect(replaceLine({ label: 'a', kind: 'sound', model: m })).toBe('The 2 existing examples of "a" will be replaced.');
    expect(replaceLine({ label: 'zzz', kind: 'sound', model: m })).toBeNull();
    expect(replaceLine({ label: HUM_LABEL, kind: 'hum', model: { ...m, pitch: { baselineHz: 100 } } })).toMatch(/pitch/);
  });

  it('writes the saved lines', () => {
    expect(savedLine(true)).toBe('Saved.');
    expect(savedLine(false)).toBe('Saved for this session only. The browser did not allow storing it.');
  });

  it('never writes NaN, undefined or Infinity for any number', () => {
    const odd = fc.oneof(fc.double(), fc.constantFrom(NaN, Infinity, -Infinity, -1, 0, 5, 1e308));
    fc.assert(fc.property(odd, odd, odd, fc.boolean(), (a, b, c, stored) => {
      const rep = report({
        labels: [{ label: 'x', examples: a, looAccuracy: b }],
        confusedPairs: [{ a: 'x', b: 'y', rate: c }],
      });
      const m: SoundModel = { ...model(), pitch: { baselineHz: a } };
      const ex = { ...recording('tap', 1).examples[0], t: a, durationMs: b };
      const s: TeachState = { ...recording('tap', 1), examples: [ex], elapsedMs: c, target: a };
      const texts = [...reportLines(rep, m), percentText(a), stepText(s), countLine(s), exampleLine(ex), savedLine(stored), doneState(s).reason, saveState(s).reason];
      for (const text of texts) expect(text).not.toMatch(/NaN|undefined|Infinity/);
    }));
  });
});

// Task 32b: backgroundMs ends a background recording by itself.
describe('teach state with backgroundMs', () => {
  const FIXED_MS = 30000;
  const fixed = (): TeachState => initialState({ label: BACKGROUND, target: TARGET, backgroundMs: FIXED_MS });
  const at = (s: TeachState, ms: number): TeachState => reduce(s, { type: 'progress', t: ms / MS_PER_SECOND });

  it('keeps Done off before the time is over, even after the 10 s minimum', () => {
    for (const ms of [0, 1000, WEB_TEACH_BACKGROUND_RECORD_MS, FIXED_MS - 1]) {
      const s = at(fixed(), ms);
      expect(doneState(s).enabled).toBe(false);
      expect(reduce(s, { type: 'done' }).finishing).toBe(false);
    }
  });

  it('finishes at backgroundMs and not before', () => {
    const s = at(fixed(), FIXED_MS);
    expect(doneState(s).enabled).toBe(true);
    expect(reduce(s, { type: 'done' }).finishing).toBe(true);
  });

  it('counts the remaining seconds down, rounded up, and never below 0', () => {
    expect(countdownSeconds(fixed())).toBe(30);
    expect(countdownSeconds(at(fixed(), 1))).toBe(30);
    expect(countdownSeconds(at(fixed(), 1000))).toBe(29);
    expect(countdownSeconds(at(fixed(), 29001))).toBe(1);
    expect(countdownSeconds(at(fixed(), FIXED_MS))).toBe(0);
    expect(countdownSeconds(at(fixed(), FIXED_MS + 500))).toBe(0);
  });

  it('is unchanged without backgroundMs, and ignored for other labels', () => {
    const plain = initialState({ label: BACKGROUND, target: TARGET });
    expect(countdownSeconds(plain)).toBeNull();
    expect(doneState(at(plain, WEB_TEACH_BACKGROUND_RECORD_MS)).enabled).toBe(true);
    expect(doneState(at(plain, WEB_TEACH_BACKGROUND_RECORD_MS - 1)).enabled).toBe(false);
    for (const label of ['tap', HUM_LABEL]) {
      const s = initialState({ label, target: TARGET, backgroundMs: FIXED_MS });
      expect(countdownSeconds(s)).toBeNull();
      expect(s).toEqual(initialState({ label, target: TARGET }));
    }
  });
});