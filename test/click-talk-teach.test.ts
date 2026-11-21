// Task 34 (requirement 13): the English copy of click-talk.md section 5 and the library's check of the teach lines.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveTeachText } from '../web/teach-ui/text';
import { BACKGROUND_LINE, MODE_TEXT, TEACH_LINE, WELCOME_TEXT } from '../apps/click-talk/src/teach-texts';
import { BACKGROUND_TEACH_MS } from '../apps/click-talk/src/constants';
import { TALK_SOUNDS } from './helpers/click-talk-sounds';
import { REPO_ROOT } from './web/paths';

describe('the copy', () => {
  it('the welcome text', () => {
    expect(WELCOME_TEXT).toEqual({
      title: 'Click Talk',
      lead: 'Talk with two small mouth sounds. A tongue click moves, a lip pop chooses, and the laptop says the words.',
      setup: 'Set it up with the person who will use it. It takes about two minutes.',
      privacy: 'Sounds and settings stay on this device. Click Talk is not a medical device.',
      button: 'Set up',
    });
  });

  it('the mode text', () => {
    expect(MODE_TEXT).toEqual({
      question: 'How many sounds can they make?',
      two: { title: 'Two sounds (recommended)', body: 'Tongue click to move, lip pop to choose.' },
      one: { title: 'One sound', body: 'The frame moves by itself. Tongue click to choose.' },
    });
  });

  it('the teach lines', () => {
    expect(TEACH_LINE).toEqual({
      click: 'Ask them to click their tongue 10 times, with a short pause between clicks.',
      pop: 'Now 10 lip pops.',
    });
    expect(BACKGROUND_LINE).toBe(
      'Last, 30 seconds of the room: talk for a while, then type for a while. Click Talk learns what to ignore.',
    );
  });

  it('the background is 30 seconds, and the line says so', () => {
    expect(BACKGROUND_TEACH_MS).toBe(30_000);
    expect(BACKGROUND_LINE).toContain('30 seconds');
  });

  it('every sound has a teach line and no text is empty', () => {
    expect(Object.keys(TEACH_LINE).sort()).toEqual([...TALK_SOUNDS].sort());
    const all = [...Object.values(WELCOME_TEXT), ...Object.values(TEACH_LINE), BACKGROUND_LINE, MODE_TEXT.question,
      ...Object.values(MODE_TEXT.one), ...Object.values(MODE_TEXT.two)];
    for (const t of all) expect(t.length).toBeGreaterThan(0);
  });

  it('the teach lines and the background line pass the library check as dialog texts', () => {
    for (const s of TALK_SOUNDS) expect(resolveTeachText({ record: TEACH_LINE[s] }).record).toBe(TEACH_LINE[s]);
    expect(resolveTeachText({ recordBackground: BACKGROUND_LINE }).recordBackground).toBe(BACKGROUND_LINE);
  });

  it('no external address, no markup', () => {
    const all = [...Object.values(WELCOME_TEXT), ...Object.values(TEACH_LINE), BACKGROUND_LINE, MODE_TEXT.question,
      ...Object.values(MODE_TEXT.one), ...Object.values(MODE_TEXT.two)];
    for (const t of all) expect(t).not.toMatch(/https?:|<|>/);
  });
});

// The planning doc is not part of the repository. When it is next to the code, the copy must match it word for word.
describe('click-talk.md (when present)', () => {
  const doc = join(REPO_ROOT, 'docs', '_planning', 'tokk', 'apps', 'click-talk.md');
  const present = existsSync(doc);
  const text = present ? readFileSync(doc, 'utf8') : '';

  it.skipIf(!present)('holds every line of the copy', () => {
    const lines = [
      WELCOME_TEXT.lead, WELCOME_TEXT.setup, WELCOME_TEXT.privacy, WELCOME_TEXT.button, MODE_TEXT.question,
      MODE_TEXT.two.title, MODE_TEXT.two.body, MODE_TEXT.one.title, MODE_TEXT.one.body,
      TEACH_LINE.click, TEACH_LINE.pop, BACKGROUND_LINE,
    ];
    for (const l of lines) expect(text, l).toContain(`\`${l}\``);
  });
});
