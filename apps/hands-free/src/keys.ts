// Key event -> action, with the ignore rules (requirement 9.4, 9.5). Pure: the DOM listener maps the event to a KeyInput.

export type KeyAction = 'activate' | 'back' | 'toggle' | 'pause' | 'teach';
export interface KeyInput { key: string; ctrl: boolean; alt: boolean; meta: boolean; targetKind: 'text' | 'other' }
export interface KeyState { shortcutsOn: boolean; dialogOpen: boolean }

const LETTER_ACTIONS: Readonly<Record<string, KeyAction>> = { k: 'activate', b: 'back', l: 'toggle', p: 'pause', t: 'teach' };

// Only the five letters are taken. Every other key (Tab, Enter, Space, arrows, Home, End, Page keys, Esc) stays the browser's.
export function actionForKey(k: KeyInput, state: KeyState): KeyAction | null {
  if (!state.shortcutsOn || state.dialogOpen) return null;
  if (k.ctrl || k.alt || k.meta) return null;
  if (k.targetKind === 'text') return null;
  return Object.prototype.hasOwnProperty.call(LETTER_ACTIONS, k.key.toLowerCase()) ? LETTER_ACTIONS[k.key.toLowerCase()] : null;
}
