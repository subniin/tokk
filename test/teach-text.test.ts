import { describe, expect, it } from 'vitest';
import { BACKGROUND, HUM_LABEL, MIN_EXAMPLES_PER_LABEL, NOISE_FLOOR_WARMUP_MS } from '../core/constants';
import { emptyModel } from '../core/classify/knn';
import type { SoundModel } from '../core/types';
import { WEB_TEACH_RADIUS_PX } from '../web/constants';
import { labelsOf } from '../web/model';
import { OVERLAY_COLOURS as C } from '../web/overlay/theme';
import { countLine, savedLine, stepText } from '../web/teach-ui/format';
import { doneState, initialState, reduce } from '../web/teach-ui/state';
import type { TeachAction, TeachState } from '../web/teach-ui/state';
import { TEACH_DIALOG_STYLE } from '../web/teach-ui/style';
import { fillText, resolveTeachText, TEACH_TEXT_DEFAULTS, TEACH_TEXT_PLACEHOLDERS } from '../web/teach-ui/text';
import type { TeachTextKey } from '../web/teach-ui/text';

// Test-only values (Task 20, U12 to U14).
const RATE_HZ = 48000;
const MS_PER_SECOND = 1000;
const TARGET = 10;
const KEPT = 3;
const HUM_HZ = 150;

// Frozen in step 1.6 from the STYLE constant of web/teach-ui/teach-dialog.ts before Task 20, with the constants substituted.
const GOLDEN_STYLE = "\n:host { all: initial; display: block; position: fixed; z-index: 2147483647;\n  font-family: system-ui, sans-serif; font-size: clamp(16px, 1.0417vw, 20px); line-height: 1.4; font-weight: 400;\n  color: #e8ecf1; text-align: left; }\n* { box-sizing: border-box; transition: none; animation: none; }\ndialog { width: min(clamp(480px, 31.25vw, 600px), calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 16px;\n  background: #14181f; color: #e8ecf1; border: 1px solid #9aa4b0; border-radius: 4px; }\ndialog::backdrop { background: rgba(0, 0, 0, 0.6); }\nh2 { margin: 0 0 8px; font-size: 1.25em; font-weight: 700; }\np { margin: 8px 0; }\nul, ol { margin: 8px 0; padding-left: 20px; }\nol.examples { list-style: none; padding: 0; max-height: 240px; overflow-y: auto; }\nli.example { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; border-top: 1px solid #232a35; }\nli.example .text { flex: 1 1 160px; }\ncanvas { display: block; width: 120px; height: 32px; background: #0d1117; }\nprogress { width: 100%; accent-color: #8fb8e8; }\n.footer { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }\n.reason { margin: 8px 0 0; }\n.error { margin: 8px 0; padding: 4px 8px; background: #4a3a00; color: #ffe9a8; }\nbutton { font: inherit; color: #e8ecf1; background: #232a35; border: 1px solid #e8ecf1; border-radius: 4px;\n  padding: 4px 12px; min-height: 32px; cursor: pointer; }\nbutton[aria-disabled=\"true\"] { border-style: dashed; cursor: not-allowed; }\nbutton:focus-visible, h2:focus-visible { outline: 2px solid #ffd166; outline-offset: 2px; }\n[hidden] { display: none; }\n";

const THEME_PROPERTIES = ['--tokk-accent', '--tokk-bg', '--tokk-fg', '--tokk-font', '--tokk-radius'];
const ALL_KEYS: TeachTextKey[] = [
  'title', 'quiet', 'record', 'recordHum', 'recordBackground', 'training', 'count', 'needMore', 'review', 'failed',
  'done', 'save', 'again', 'cancel', 'close', 'saved', 'savedSessionOnly',
];

function segment(i: number): TeachAction {
  return { type: 'segment', id: `tap/teach.wav#${i}`, t: i, durationMs: 50, min: new Float32Array(1), max: new Float32Array(1) };
}

function recording(label: string, count = 0): TeachState {
  let s = reduce(initialState({ label, target: TARGET }), { type: 'progress', t: NOISE_FLOOR_WARMUP_MS / MS_PER_SECOND });
  for (let i = 0; i < count; i++) s = reduce(s, segment(i));
  return s;
}

describe('labelsOf (U12)', () => {
  const ex = (label: string, i: number) => ({ id: `${label}/x#${i}`, label, v: [0] });

  it('gives an empty list for an empty model', () => {
    expect(labelsOf(emptyModel(RATE_HZ))).toEqual([]);
  });

  it('sorts by code unit, leaves out background and lists each label once', () => {
    const m: SoundModel = { ...emptyModel(RATE_HZ), examples: [ex('tap', 0), ex(BACKGROUND, 0), ex('Zed', 0), ex('clap', 0), ex('tap', 1)] };
    expect(labelsOf(m)).toEqual(['Zed', 'clap', 'tap']);
  });

  it('lists hum when the model has a pitch, also without examples', () => {
    expect(labelsOf({ ...emptyModel(RATE_HZ), pitch: { baselineHz: HUM_HZ } })).toEqual([HUM_LABEL]);
    const m: SoundModel = { ...emptyModel(RATE_HZ), examples: [ex('knock', 0), ex('click', 0)], pitch: { baselineHz: HUM_HZ } };
    expect(labelsOf(m)).toEqual(['click', HUM_LABEL, 'knock']);
  });

  it('gives a new array on every call', () => {
    const m = emptyModel(RATE_HZ);
    const a = labelsOf(m);
    a.push('x');
    expect(labelsOf(m)).toEqual([]);
    expect(labelsOf(m)).not.toBe(labelsOf(m));
  });
});

describe('resolveTeachText (U13)', () => {
  it('without input gives the defaults, which equal the texts of the format and state functions', () => {
    expect(resolveTeachText(undefined)).toEqual(TEACH_TEXT_DEFAULTS);
    expect(Object.keys(TEACH_TEXT_DEFAULTS).sort()).toEqual([...ALL_KEYS].sort());
    expect(Object.keys(TEACH_TEXT_PLACEHOLDERS).sort()).toEqual([...ALL_KEYS].sort());
    const d = TEACH_TEXT_DEFAULTS;
    expect(fillText(d.title, { label: 'tap' })).toBe('Teach "tap"');
    expect(d.quiet).toBe(stepText(initialState({ label: 'tap', target: TARGET })));
    expect(d.quiet).toBe('Stay quiet for 1 second');
    expect(stepText(recording('tap'))).toBe('Make the sound 10 times');
    expect(d.record).toBe('Make the sound {count} times');
    expect(d.recordHum).toBe(stepText(recording(HUM_LABEL)));
    expect(d.recordBackground).toBe(stepText(recording(BACKGROUND)));
    expect(d.training).toBe('Training...');
    const s = recording('tap', KEPT);
    expect(fillText(d.count, { heard: KEPT, target: TARGET, kept: KEPT })).toBe(countLine(s));
    expect(fillText(d.needMore, { min: MIN_EXAMPLES_PER_LABEL, kept: KEPT })).toBe(doneState(s).reason);
    expect(d.review).toBe('Check the result, then save it.');
    expect(d.failed).toBe('Training failed.');
    expect([d.done, d.save, d.again, d.cancel, d.close]).toEqual(['Done', 'Save', 'Record again', 'Cancel (Esc)', 'Close']);
    expect(d.saved).toBe(savedLine(true));
    expect(d.saved).toBe(savedLine(null));
    expect(d.savedSessionOnly).toBe(savedLine(false));
  });

  it('the default record text says time for one example', () => {
    const one = reduce(initialState({ label: 'tap', target: 1 }), { type: 'progress', t: NOISE_FLOOR_WARMUP_MS / MS_PER_SECOND });
    expect(stepText(one)).toBe('Make the sound 1 time');
    expect(stepText(one, TEACH_TEXT_DEFAULTS)).toBe('Make the sound 1 time');
  });

  it('each key replaces its own place and the others keep the default', () => {
    for (const key of ALL_KEYS) {
      const r = resolveTeachText({ [key]: `Custom ${key}` });
      for (const other of ALL_KEYS) expect(r[other]).toBe(other === key ? `Custom ${key}` : TEACH_TEXT_DEFAULTS[other]);
    }
  });

  it('the format and state functions use the resolved texts', () => {
    const t = resolveTeachText({
      quiet: 'Shh.', record: 'Knock {count} times!', recordHum: 'Hum!', recordBackground: 'Room!', training: 'Thinking',
      count: '{heard}/{target} ({kept})', needMore: 'Need {min}, got {kept}', saved: 'Kept.', savedSessionOnly: 'Kept for now.',
    });
    expect(stepText(initialState({ label: 'tap', target: TARGET }), t)).toBe('Shh.');
    expect(stepText(recording('tap'), t)).toBe('Knock 10 times!');
    expect(stepText(recording(HUM_LABEL), t)).toBe('Hum!');
    expect(stepText(recording(BACKGROUND), t)).toBe('Room!');
    expect(stepText({ ...recording('tap'), finishing: true }, t)).toBe('Thinking');
    const s = recording('tap', KEPT);
    expect(countLine(s, t)).toBe(`${KEPT}/${TARGET} (${KEPT})`);
    expect(doneState(s, t).reason).toBe(`Need ${MIN_EXAMPLES_PER_LABEL}, got ${KEPT}`);
    expect(doneState(recording(HUM_LABEL), t).reason).toBe(doneState(recording(HUM_LABEL)).reason);
    expect(savedLine(true, t)).toBe('Kept.');
    expect(savedLine(false, t)).toBe('Kept for now.');
  });

  it('fills placeholders with plain text and leaves markup as text', () => {
    expect(fillText('Teach {label} <b>now</b>', { label: 'knock' })).toBe('Teach knock <b>now</b>');
    expect(fillText('{count} and {count}', { count: 2 })).toBe('2 and 2');
    expect(resolveTeachText({ title: '<b>{label}</b>' }).title).toBe('<b>{label}</b>');
  });

  it('rejects bad input with a RangeError that names the problem', () => {
    const cases: [unknown, RegExp][] = [
      [null, /plain object/],
      [[], /plain object/],
      ['title', /plain object/],
      [42, /plain object/],
      [new Map(), /plain object/],
      [{ heading: 'x' }, /heading.*title/s],
      [{ title: 5 }, /title/],
      [{ title: '' }, /title.*empty/s],
      [{ title: '   ' }, /title.*empty/s],
      [{ quiet: 'Wait {count}' }, /quiet.*\{count\}/s],
      [{ record: 'Make it {label}' }, /record.*\{count\}/s],
      [{ title: 'Teach { label' }, /title.*\{label\}/s],
      [{ title: 'Teach {label' }, /title/],
      [{ count: '{heard} {nope}' }, /count.*\{heard\}/s],
    ];
    for (const [input, pattern] of cases) {
      let error: unknown = null;
      try { resolveTeachText(input); } catch (e) { error = e; }
      expect(error, JSON.stringify(input) ?? String(input)).toBeInstanceOf(RangeError);
      expect((error as Error).message, JSON.stringify(input) ?? String(input)).toMatch(pattern);
    }
  });

  it('accepts an object with a null prototype and an empty object', () => {
    const o = Object.assign(Object.create(null) as Record<string, string>, { save: 'Keep it' });
    expect(resolveTeachText(o).save).toBe('Keep it');
    expect(resolveTeachText({})).toEqual(TEACH_TEXT_DEFAULTS);
  });
});

describe('dialog style (U14)', () => {
  const withoutVars = (s: string): string => s.replace(/var\(--tokk-[a-z]+, ([^()]*)\)/g, '$1');

  it('with every var() replaced by its fallback equals the style before Task 20', () => {
    expect(TEACH_DIALOG_STYLE).toContain('var(');
    expect(withoutVars(TEACH_DIALOG_STYLE)).toBe(GOLDEN_STYLE);
  });

  it('uses exactly the five custom properties, with the fallbacks of the overlay colours', () => {
    const names = [...new Set([...TEACH_DIALOG_STYLE.matchAll(/--tokk-[a-z]+/g)].map((m) => m[0]))].sort();
    expect(names).toEqual(THEME_PROPERTIES);
    for (const v of [
      `var(--tokk-bg, ${C.panelBackground})`, `var(--tokk-bg, ${C.headerBackground})`, `var(--tokk-fg, ${C.text})`,
      `var(--tokk-accent, ${C.waveform})`, 'var(--tokk-font, system-ui, sans-serif)', `var(--tokk-radius, ${WEB_TEACH_RADIUS_PX}px)`,
    ]) {
      expect(TEACH_DIALOG_STYLE).toContain(v);
    }
  });

  it('keeps the focus outline, the warnings, the canvas and the backdrop out of the theme', () => {
    for (const fixed of [C.focusOutline, C.warningBackground, C.warningText, C.canvasBackground]) {
      expect(TEACH_DIALOG_STYLE).toContain(fixed);
      expect(TEACH_DIALOG_STYLE).not.toMatch(new RegExp(`var\\(--tokk-[a-z]+, ${fixed}\\)`));
    }
    expect(TEACH_DIALOG_STYLE).toContain('outline: 2px solid #ffd166');
    expect(TEACH_DIALOG_STYLE).toContain('dialog::backdrop { background: rgba(0, 0, 0, 0.6); }');
    expect(TEACH_DIALOG_STYLE).toContain('all: initial');
  });
});
