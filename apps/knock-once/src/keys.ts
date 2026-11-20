// Key event -> action, with the ignore rules (design.md "Keys", requirement 12.3). Pure: the DOM listener maps the event to
// a KeyInput. The flow decides whether the action is allowed in the current state; the key map only names it.

export type KeyAction = 'yes' | 'no' | 'summon' | 'teach' | 'mute';
export interface KeyInput { key: string; ctrl: boolean; alt: boolean; meta: boolean; targetKind: 'text' | 'other' }
export interface KeyState { shortcutsOn: boolean; dialogOpen: boolean }

const LETTER_ACTIONS: Readonly<Record<string, KeyAction>> = { y: 'yes', n: 'no', s: 'summon', t: 'teach', m: 'mute' };

// Only the five letters are taken. Every other key (Tab, Enter, Space, arrows, Esc) stays the browser's.
export function actionForKey(k: KeyInput, state: KeyState): KeyAction | null {
  if (!state.shortcutsOn || state.dialogOpen) return null;
  if (k.ctrl || k.alt || k.meta) return null;
  if (k.targetKind === 'text') return null;
  const key = k.key.toLowerCase();
  return Object.prototype.hasOwnProperty.call(LETTER_ACTIONS, key) ? LETTER_ACTIONS[key] : null;
}
