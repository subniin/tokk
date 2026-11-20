// Task 26 (test U9): the caption texts of cases/slides, character by character (requirement 10.1).
// The module is pure: no DOM type and no 'tokk' import, so it runs in Node.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { captionText } from '../cases/slides/src/caption';
import { REPO_ROOT } from './web/paths';

const OFF = 'Sound control is off. Press Start sound control.';
const TEACHING = 'Teach your clap in the dialog.';
const LISTENING = 'Listening. Clap twice for the next slide, three times for the previous slide.';
const HEARD_NEXT = 'Heard: clap clap. Next slide.';
const HEARD_PREVIOUS = 'Heard: clap clap clap. Previous slide.';
const KEYBOARD = 'The keyboard still works.';

describe('captionText (Task 26, U9)', () => {
  it('U9: the three states before a pattern are the exact texts', () => {
    expect(captionText({ kind: 'off' })).toBe(OFF);
    expect(captionText({ kind: 'teaching' })).toBe(TEACHING);
    expect(captionText({ kind: 'listening' })).toBe(LISTENING);
  });

  it('U9: a recognised pattern shows its name and its action', () => {
    expect(captionText({ kind: 'heard', pattern: 'clap clap', action: 'next' })).toBe(HEARD_NEXT);
    expect(captionText({ kind: 'heard', pattern: 'clap clap clap', action: 'previous' })).toBe(HEARD_PREVIOUS);
  });

  it('U9: an unknown pattern gives no "Heard" text', () => {
    for (const pattern of ['', 'clap', 'knock knock', 'clap clap clap clap']) {
      const text = captionText({ kind: 'heard', pattern, action: 'next' });
      expect(text, pattern).not.toContain('Heard');
      expect(text, pattern).toBe(LISTENING);
    }
  });

  it('U9: a microphone error shows the message of the library and says that the keyboard works', () => {
    expect(captionText({ kind: 'error', message: 'Microphone permission was denied.' })).toBe(`Microphone permission was denied. ${KEYBOARD}`);
    // A message without a final full stop gets one, so the two sentences read well.
    expect(captionText({ kind: 'error', message: 'No microphone found' })).toBe(`No microphone found. ${KEYBOARD}`);
    expect(captionText({ kind: 'error', message: 'Could it start?' })).toBe(`Could it start? ${KEYBOARD}`);
    // An empty message still says something.
    expect(captionText({ kind: 'error', message: '' })).toBe(`Sound control could not start. ${KEYBOARD}`);
  });

  it('U9: every text is a non-empty sentence of plain text, and the texts differ', () => {
    const texts = [
      captionText({ kind: 'off' }), captionText({ kind: 'teaching' }), captionText({ kind: 'listening' }),
      captionText({ kind: 'heard', pattern: 'clap clap', action: 'next' }), captionText({ kind: 'heard', pattern: 'clap clap clap', action: 'previous' }),
      captionText({ kind: 'error', message: 'x' }),
    ];
    expect(new Set(texts).size).toBe(texts.length);
    for (const t of texts) { expect(t.length).toBeGreaterThan(0); expect(t).not.toMatch(/[<>]/); expect(t.endsWith('.') || t.endsWith('?')).toBe(true); }
  });

  it('U9: caption.ts uses no DOM name and imports nothing from tokk', () => {
    const source = readFileSync(join(REPO_ROOT, 'cases', 'slides', 'src', 'caption.ts'), 'utf8');
    const code = source.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/\b(document|window|HTMLElement|Element|navigator|console)\b/);
    expect(code).not.toMatch(/from\s*['"]tokk/);
  });
});
