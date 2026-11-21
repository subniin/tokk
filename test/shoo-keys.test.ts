// Task 33 (requirement 12): the key map.
import { describe, expect, it } from 'vitest';
import { actionForKey } from '../apps/shoo/src/keys';
import type { KeyInput, KeyState } from '../apps/shoo/src/keys';

const key = (k: string, over: Partial<KeyInput> = {}): KeyInput => ({ key: k, ctrl: false, alt: false, meta: false, targetKind: 'other', ...over });
const KEYS_ON: KeyState = { keysMode: true };
const KEYS_OFF: KeyState = { keysMode: false };

describe('the key map', () => {
  it('1 to 4 give click, clap, knock, pop in keys mode', () => {
    expect(actionForKey(key('1'), KEYS_ON)).toEqual({ type: 'sound', sound: 'click' });
    expect(actionForKey(key('2'), KEYS_ON)).toEqual({ type: 'sound', sound: 'clap' });
    expect(actionForKey(key('3'), KEYS_ON)).toEqual({ type: 'sound', sound: 'knock' });
    expect(actionForKey(key('4'), KEYS_ON)).toEqual({ type: 'sound', sound: 'pop' });
  });

  it('Escape toggles pause, in keys mode or not', () => {
    expect(actionForKey(key('Escape'), KEYS_ON)).toEqual({ type: 'togglePause' });
    expect(actionForKey(key('Escape'), KEYS_OFF)).toEqual({ type: 'togglePause' });
  });

  it('the digits do nothing while the microphone is the input', () => {
    for (const k of ['1', '2', '3', '4']) expect(actionForKey(key(k), KEYS_OFF), k).toBeNull();
  });

  it('other keys stay the browser\'s', () => {
    for (const k of ['0', '5', '9', 'a', 'Enter', ' ', 'Tab', 'ArrowUp', '11', '1 ']) expect(actionForKey(key(k), KEYS_ON), k).toBeNull();
  });

  it('modifiers and text fields are ignored', () => {
    for (const over of [{ ctrl: true }, { alt: true }, { meta: true }, { targetKind: 'text' as const }]) {
      expect(actionForKey(key('1', over), KEYS_ON), JSON.stringify(over)).toBeNull();
      expect(actionForKey(key('Escape', over), KEYS_ON), JSON.stringify(over)).toBeNull();
    }
  });
});
