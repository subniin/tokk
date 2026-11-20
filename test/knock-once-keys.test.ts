// Task 23, U8 (requirement 12.1, 12.3): the key map and the ignore rules.
import { describe, expect, it } from 'vitest';
import { actionForKey } from '../apps/knock-once/src/keys';
import type { KeyInput } from '../apps/knock-once/src/keys';

const key = (k: string, over: Partial<KeyInput> = {}): KeyInput => ({ key: k, ctrl: false, alt: false, meta: false, targetKind: 'other', ...over });
const ON = { shortcutsOn: true, dialogOpen: false };

describe('the key map (U8)', () => {
  it('each letter to its action, in either case', () => {
    expect(actionForKey(key('y'), ON)).toBe('yes');
    expect(actionForKey(key('N'), ON)).toBe('no');
    expect(actionForKey(key('s'), ON)).toBe('summon');
    expect(actionForKey(key('T'), ON)).toBe('teach');
    expect(actionForKey(key('m'), ON)).toBe('mute');
  });

  it('the browser keys are not taken', () => {
    for (const k of ['Tab', 'Enter', ' ', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'k', 'l', 'Y ']) {
      expect(actionForKey(key(k), ON), k).toBeNull();
    }
  });

  it('modifiers, text targets, an open dialog and shortcuts off are ignored', () => {
    expect(actionForKey(key('y', { ctrl: true }), ON)).toBeNull();
    expect(actionForKey(key('y', { alt: true }), ON)).toBeNull();
    expect(actionForKey(key('y', { meta: true }), ON)).toBeNull();
    expect(actionForKey(key('y', { targetKind: 'text' }), ON)).toBeNull();
    expect(actionForKey(key('y'), { shortcutsOn: true, dialogOpen: true })).toBeNull();
    expect(actionForKey(key('y'), { shortcutsOn: false, dialogOpen: false })).toBeNull();
    expect(actionForKey(key('m'), { shortcutsOn: false, dialogOpen: false })).toBeNull();
  });
});
