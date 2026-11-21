// Task 34 (requirements 1, 2, 7 to 10): the phrases, the settings text and the Frequent board. Pure.
import { describe, expect, it } from 'vitest';
import {
  CATEGORIES, EMPTY_FREQUENT_TEXT, PHRASE_COUNT_MESSAGE, frequentPhrases, validPhraseCount, withFrequent,
} from '../apps/click-talk/src/phrases';
import {
  DEFAULT_SETTINGS, SETTINGS_KEY, countSaid, editPhrases, loadSettings, saveSettings,
} from '../apps/click-talk/src/settings';
import type { Settings } from '../apps/click-talk/src/settings';

describe('the default phrases (click-talk.md section 5)', () => {
  it('six categories in the fixed order', () => {
    expect(CATEGORIES.map((c) => c.title)).toEqual(['Needs', 'Body', 'People', 'Talk', 'Frequent', 'Help']);
    expect(CATEGORIES.map((c) => c.id)).toEqual(['needs', 'body', 'people', 'talk', 'frequent', 'help']);
  });

  it('the exact phrases', () => {
    expect(CATEGORIES[0].phrases).toEqual([
      'I\'m thirsty.', 'I\'m hungry.', 'I need the toilet.', 'I\'m too hot.', 'I\'m too cold.', 'Please move me.',
      'Turn the light off.', 'Turn the light on.',
    ]);
    expect(CATEGORIES[1].phrases).toEqual([
      'I\'m in pain.', 'My head hurts.', 'My back hurts.', 'I feel sick.', 'I feel dizzy.', 'I\'m tired.',
      'I can\'t breathe well.', 'I\'m OK.',
    ]);
    expect(CATEGORIES[2].phrases).toEqual([
      'Please call my family.', 'I want to see the nurse.', 'Who is there?', 'Please stay with me.', 'I want to be alone.',
      'Thank you.',
    ]);
    expect(CATEGORIES[3].phrases).toEqual([
      'Yes.', 'No.', 'I don\'t know.', 'Please wait.', 'Say that again, please.', 'I love you.', 'Good morning.', 'Good night.',
    ]);
  });

  it('Frequent and Help have no stored phrases', () => {
    expect(CATEGORIES[4].phrases).toEqual([]);
    expect(CATEGORIES[5].phrases).toEqual([]);
  });

  it('the other categories hold 6 or 8 phrases, so the board has no empty cell', () => {
    for (const c of CATEGORIES.slice(0, 4)) expect(validPhraseCount(c.phrases.length), c.id).toBe(true);
    expect(CATEGORIES.slice(0, 4).map((c) => c.phrases.length)).toEqual([8, 8, 6, 8]);
  });

  it('validPhraseCount is true only for 6 and 8', () => {
    for (let n = -1; n <= 12; n++) expect(validPhraseCount(n), String(n)).toBe(n === 6 || n === 8);
    expect(validPhraseCount(6.5)).toBe(false);
    expect(validPhraseCount(Number.NaN)).toBe(false);
  });

  it('the caregiver message', () => {
    expect(PHRASE_COUNT_MESSAGE).toBe('Each category holds 6 or 8 phrases. Add one more or remove one.');
    expect(EMPTY_FREQUENT_TEXT).toBe('Phrases you use often will show here.');
  });
});

describe('loadSettings', () => {
  it('the key', () => {
    expect(SETTINGS_KEY).toBe('click-talk:settings');
  });

  it('null gives the defaults', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ mode: 'two', scanMs: 1500, onlineVoices: false, rate: 1, voiceURI: null, counts: {} });
    expect(DEFAULT_SETTINGS.phrases).toEqual(CATEGORIES);
  });

  it('missing keys take the defaults, present keys are kept', () => {
    expect(loadSettings('{}')).toEqual(DEFAULT_SETTINGS);
    const s = loadSettings('{"mode":"one","rate":1.5}');
    expect(s).toEqual({ ...DEFAULT_SETTINGS, mode: 'one', rate: 1.5 });
  });

  it('broken JSON gives the defaults and throws nothing and warns nothing', () => {
    const warn = console.warn;
    const error = console.error;
    const calls: unknown[] = [];
    console.warn = (...a: unknown[]) => { calls.push(a); };
    console.error = (...a: unknown[]) => { calls.push(a); };
    try {
      for (const text of ['{', 'not json', '', '[1,2', '"x"', '42', 'null', '[]', 'true']) {
        expect(() => loadSettings(text), text).not.toThrow();
        expect(loadSettings(text), text).toEqual(DEFAULT_SETTINGS);
      }
    } finally {
      console.warn = warn;
      console.error = error;
    }
    expect(calls).toEqual([]);
  });

  it('values of the wrong type or range take the defaults', () => {
    const bad = loadSettings(JSON.stringify({
      mode: 'three', scanMs: -5, voiceURI: 7, rate: 'fast', onlineVoices: 'yes', phrases: 'x', counts: [1],
    }));
    expect(bad).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings('{"scanMs":0}').scanMs).toBe(DEFAULT_SETTINGS.scanMs);
    expect(loadSettings('{"rate":0}').rate).toBe(DEFAULT_SETTINGS.rate);
    expect(loadSettings('{"voiceURI":"x://voice"}').voiceURI).toBe('x://voice');
  });

  it('a category with 7 phrases keeps the last valid list (the default)', () => {
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const text = JSON.stringify({ phrases: [{ id: 'body', title: 'Body', phrases: seven }] });
    const s = loadSettings(text);
    expect(s.phrases.find((c) => c.id === 'body')?.phrases).toEqual(CATEGORIES[1].phrases);
  });

  it('a valid edit of 6 or 8 phrases is kept, the other categories stay as they are', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    const s = loadSettings(JSON.stringify({ phrases: [{ id: 'talk', title: 'Talk', phrases: six }] }));
    expect(s.phrases[3].phrases).toEqual(six);
    expect(s.phrases.map((c) => c.id)).toEqual(CATEGORIES.map((c) => c.id));
    expect(s.phrases[0]).toEqual(CATEGORIES[0]);
  });

  it('empty or non-string phrases are not a valid list', () => {
    const withBlank = ['a', 'b', 'c', 'd', 'e', ' '];
    const withNumber = ['a', 'b', 'c', 'd', 'e', 5];
    for (const list of [withBlank, withNumber]) {
      const s = loadSettings(JSON.stringify({ phrases: [{ id: 'talk', phrases: list }] }));
      expect(s.phrases[3].phrases).toEqual(CATEGORIES[3].phrases);
    }
  });

  it('the titles, the ids and the order cannot be changed by the stored text', () => {
    const s = loadSettings(JSON.stringify({ phrases: [
      { id: 'help', title: 'X', phrases: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { id: 'extra', title: 'Extra', phrases: ['a', 'b', 'c', 'd', 'e', 'f'] },
    ] }));
    expect(s.phrases.map((c) => c.title)).toEqual(['Needs', 'Body', 'People', 'Talk', 'Frequent', 'Help']);
    expect(s.phrases[5].phrases).toEqual([]);
  });

  it('counts keep whole non-negative numbers only', () => {
    const s = loadSettings(JSON.stringify({ counts: { 'Yes.': 3, 'No.': -1, 'Bad': 'x', 'Half': 1.5, '__proto__': 4 } }));
    expect(s.counts).toEqual({ 'Yes.': 3 });
    expect(Object.getPrototypeOf(s.counts)).toBe(Object.prototype);
  });
});

describe('saveSettings', () => {
  it('round trips', () => {
    const s: Settings = {
      ...DEFAULT_SETTINGS, mode: 'one', scanMs: 2500, voiceURI: 'urn:voice', rate: 0.8, onlineVoices: true,
      counts: { 'Yes.': 4, 'I\'m OK.': 2 },
      phrases: CATEGORIES.map((c) => (c.id === 'talk' ? { ...c, phrases: c.phrases.slice(0, 6) } : c)),
    };
    expect(loadSettings(saveSettings(s))).toEqual(s);
    expect(loadSettings(saveSettings(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
  });

  it('holds settings and counts only: text, numbers and flags', () => {
    const text = saveSettings({ ...DEFAULT_SETTINGS, counts: { 'Yes.': 1 } });
    expect(Object.keys(JSON.parse(text) as object).sort()).toEqual(
      ['counts', 'mode', 'onlineVoices', 'phrases', 'rate', 'scanMs', 'voiceURI'],
    );
    expect(text).not.toContain('RIFF');
  });
});

describe('editing the phrases (the caregiver)', () => {
  it('a list of 6 or 8 is stored', () => {
    const eight = Array.from({ length: 8 }, (_, i) => `Phrase ${i}`);
    const r = editPhrases(DEFAULT_SETTINGS, 'people', eight);
    expect(r.error).toBeNull();
    expect(r.settings.phrases[2].phrases).toEqual(eight);
  });

  it('a list of 7 gives the message and keeps the last valid list', () => {
    const seven = Array.from({ length: 7 }, (_, i) => `Phrase ${i}`);
    const r = editPhrases(DEFAULT_SETTINGS, 'people', seven);
    expect(r.error).toBe(PHRASE_COUNT_MESSAGE);
    expect(r.settings.phrases[2].phrases).toEqual(CATEGORIES[2].phrases);
  });

  it('Frequent and Help take no list, and an unknown id changes nothing', () => {
    const six = Array.from({ length: 6 }, (_, i) => `Phrase ${i}`);
    for (const id of ['frequent', 'help', 'nope']) {
      const r = editPhrases(DEFAULT_SETTINGS, id, six);
      expect(r.settings, id).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('does not change its input', () => {
    const before = JSON.stringify(DEFAULT_SETTINGS);
    editPhrases(DEFAULT_SETTINGS, 'talk', ['a']);
    expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(before);
  });
});

describe('Frequent', () => {
  it('nothing said yet gives no phrases, and the board shows the empty text', () => {
    expect(frequentPhrases({}, null)).toEqual([]);
  });

  it('the last said comes first, then the most used, up to 8 in all', () => {
    const counts = { 'Yes.': 5, 'No.': 9, 'Thank you.': 2, 'I\'m OK.': 7 };
    expect(frequentPhrases(counts, 'Thank you.')).toEqual(['Thank you.', 'No.', 'I\'m OK.', 'Yes.']);
  });

  it('a last said that is also the most used is listed once', () => {
    expect(frequentPhrases({ 'Yes.': 5, 'No.': 1 }, 'Yes.')).toEqual(['Yes.', 'No.']);
  });

  it('without a last said the most used come first', () => {
    expect(frequentPhrases({ 'Yes.': 1, 'No.': 3 }, null)).toEqual(['No.', 'Yes.']);
  });

  it('ties go in alphabetical order, so the board is stable', () => {
    expect(frequentPhrases({ B: 2, A: 2, C: 2 }, null)).toEqual(['A', 'B', 'C']);
  });

  it('never more than 8', () => {
    const counts = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`P${String(i).padStart(2, '0')}`, i + 1]));
    const list = frequentPhrases(counts, 'P00');
    expect(list).toHaveLength(8);
    expect(list[0]).toBe('P00');
    expect(list.slice(1)).toEqual(['P19', 'P18', 'P17', 'P16', 'P15', 'P14', 'P13']);
  });

  it('countSaid adds one and does not change its input', () => {
    const before = { 'Yes.': 1 };
    const after = countSaid(before, 'Yes.');
    expect(after).toEqual({ 'Yes.': 2 });
    expect(before).toEqual({ 'Yes.': 1 });
    expect(countSaid(after, 'No.')).toEqual({ 'Yes.': 2, 'No.': 1 });
  });

  it('withFrequent fills only the Frequent category', () => {
    const cats = withFrequent(CATEGORIES, { 'Yes.': 2 }, 'Yes.');
    expect(cats[4].phrases).toEqual(['Yes.']);
    expect(cats.filter((_, i) => i !== 4)).toEqual(CATEGORIES.filter((_, i) => i !== 4));
    expect(CATEGORIES[4].phrases).toEqual([]);
  });

  it('the order and content of the other categories never change, whatever the counts', () => {
    const many = Object.fromEntries(CATEGORIES.flatMap((c) => c.phrases).map((p, i) => [p, (i * 7) % 11]));
    const a = withFrequent(CATEGORIES, {}, null);
    const b = withFrequent(CATEGORIES, many, 'No.');
    const c = withFrequent(CATEGORIES, { 'Yes.': 99 }, null);
    for (const cats of [a, b, c]) {
      expect(cats.map((x) => x.id)).toEqual(CATEGORIES.map((x) => x.id));
      expect(cats.filter((_, i) => i !== 4)).toEqual(CATEGORIES.filter((_, i) => i !== 4));
    }
    const s = loadSettings(saveSettings({ ...DEFAULT_SETTINGS, counts: many }));
    expect(s.phrases.filter((_, i) => i !== 4)).toEqual(CATEGORIES.filter((_, i) => i !== 4));
  });
});
