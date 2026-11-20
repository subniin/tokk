// Task 22, U5: the key map (requirements 9.4 and 9.5).
import { describe, expect, it } from 'vitest';
import { actionForKey } from '../apps/hands-free/src/keys';
import type { KeyInput, KeyState } from '../apps/hands-free/src/keys';

// Test-only values.
const ON: KeyState = { shortcutsOn: true, dialogOpen: false };
const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({ key: k, ctrl: false, alt: false, meta: false, targetKind: 'other', ...extra });
const MAP: [string, string][] = [['k', 'activate'], ['b', 'back'], ['l', 'toggle'], ['p', 'pause'], ['t', 'teach']];
const BROWSER_KEYS = ['Tab', 'Enter', ' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Shift'];

describe('keys (U5)', () => {
  it('each letter gives its action, in either case', () => {
    for (const [k, action] of MAP) {
      expect(actionForKey(key(k), ON), k).toBe(action);
      expect(actionForKey(key(k.toUpperCase()), ON), k.toUpperCase()).toBe(action);
    }
  });

  it('no other letter, digit or symbol is taken', () => {
    for (const k of 'acdefghijmnoqrsuvwxyz0123456789,.?/-='.split('')) expect(actionForKey(key(k), ON), k).toBeNull();
  });

  it('the browser keys are never taken', () => {
    for (const k of BROWSER_KEYS) expect(actionForKey(key(k), ON), k).toBeNull();
  });

  it('Ctrl, Alt and Meta turn every letter off', () => {
    for (const [k] of MAP) {
      expect(actionForKey(key(k, { ctrl: true }), ON)).toBeNull();
      expect(actionForKey(key(k, { alt: true }), ON)).toBeNull();
      expect(actionForKey(key(k, { meta: true }), ON)).toBeNull();
    }
  });

  it('a text field, a select or an editable element keeps its letters', () => {
    for (const [k] of MAP) expect(actionForKey(key(k, { targetKind: 'text' }), ON)).toBeNull();
  });

  it('a letter on a range input or a button is still taken', () => {
    for (const [k, action] of MAP) expect(actionForKey(key(k, { targetKind: 'other' }), ON), k).toBe(action);
  });

  it('an open teach dialog turns the letters off', () => {
    for (const [k] of MAP) expect(actionForKey(key(k), { shortcutsOn: true, dialogOpen: true })).toBeNull();
  });

  it('switching the shortcuts off turns every letter off', () => {
    for (const [k] of MAP) expect(actionForKey(key(k), { shortcutsOn: false, dialogOpen: false })).toBeNull();
  });
});
