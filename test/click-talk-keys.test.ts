// Task 34 (requirement 12): the key map. Space is click, Enter is pop (click in one-sound mode), any key stops the alarm.
import { describe, expect, it } from 'vitest';
import { actionForKey } from '../apps/click-talk/src/keys';
import type { KeyInput, KeyState } from '../apps/click-talk/src/keys';

const key = (k: string, over: Partial<KeyInput> = {}): KeyInput => ({ key: k, ctrl: false, alt: false, meta: false, targetKind: 'other', ...over });
const TWO: KeyState = { mode: 'two', level: 'categories' };
const ONE: KeyState = { mode: 'one', level: 'categories' };
const click = { type: 'sound', sound: 'click' };
const pop = { type: 'sound', sound: 'pop' };

describe('two-sound mode', () => {
  it('Space is click and Enter is pop', () => {
    expect(actionForKey(key(' '), TWO)).toEqual(click);
    expect(actionForKey(key('Enter'), TWO)).toEqual(pop);
  });

  it('works the same on the phrase board', () => {
    const s: KeyState = { mode: 'two', level: 'phrases' };
    expect(actionForKey(key(' '), s)).toEqual(click);
    expect(actionForKey(key('Enter'), s)).toEqual(pop);
  });
});

describe('one-sound mode', () => {
  it('Enter and Space are click', () => {
    expect(actionForKey(key(' '), ONE)).toEqual(click);
    expect(actionForKey(key('Enter'), ONE)).toEqual(click);
    expect(actionForKey(key('Enter'), { mode: 'one', level: 'phrases' })).toEqual(click);
  });

});

describe('help', () => {
  it('any key stops the alarm, in both modes', () => {
    for (const mode of ['two', 'one'] as const) {
      for (const k of [' ', 'Enter', 'a', 'Escape', 'ArrowLeft', 'Tab', 'F5']) {
        expect(actionForKey(key(k), { mode, level: 'help' }), `${mode} ${k}`).toEqual({ type: 'stopHelp' });
      }
    }
  });

  it('a lone modifier key does not stop it by itself being held down for a shortcut', () => {
    // Shift, Control, Alt and Meta alone are not a press the person chose: the alarm goes on.
    for (const k of ['Shift', 'Control', 'Alt', 'Meta']) expect(actionForKey(key(k), { mode: 'two', level: 'help' }), k).toBeNull();
  });
});

describe('everything else stays the browser\'s', () => {
  it('other keys give nothing', () => {
    for (const k of ['a', 'Tab', 'ArrowUp', 'Escape', '1', 'Spacebar', 'enter']) {
      expect(actionForKey(key(k), TWO), k).toBeNull();
      expect(actionForKey(key(k), ONE), k).toBeNull();
    }
  });

  it('modifiers and text fields are ignored outside help', () => {
    for (const over of [{ ctrl: true }, { alt: true }, { meta: true }, { targetKind: 'text' as const }]) {
      expect(actionForKey(key(' ', over), TWO), JSON.stringify(over)).toBeNull();
      expect(actionForKey(key('Enter', over), TWO), JSON.stringify(over)).toBeNull();
      expect(actionForKey(key('Enter', over), ONE), JSON.stringify(over)).toBeNull();
    }
  });

  it('in help a text field does not hold the alarm on', () => {
    expect(actionForKey(key('a', { targetKind: 'text' }), { mode: 'two', level: 'help' })).toEqual({ type: 'stopHelp' });
  });

  it('while speaking the keys still map (the board ignores them, Review Focus 3)', () => {
    expect(actionForKey(key(' '), { mode: 'two', level: 'speaking' })).toEqual(click);
  });
});
