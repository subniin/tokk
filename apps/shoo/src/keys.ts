// Key event -> action. Pure: the DOM listener maps the event to a KeyInput. The game decides whether the action is allowed
// in the current phase; the key map only names it.
import type { SoundId } from './monsters';

export type KeyAction = { type: 'sound'; sound: SoundId } | { type: 'togglePause' };
export interface KeyInput { key: string; ctrl: boolean; alt: boolean; meta: boolean; targetKind: 'text' | 'other' }
export interface KeyState { keysMode: boolean }   // true when the keys stand in for the microphone

const SOUND_KEYS: Readonly<Record<string, SoundId>> = { 1: 'click', 2: 'clap', 3: 'knock', 4: 'pop' };

// 1 to 4 are sounds in keys mode only. Escape toggles pause. Every other key stays the browser's.
export function actionForKey(k: KeyInput, state: KeyState): KeyAction | null {
  if (k.ctrl || k.alt || k.meta) return null;
  if (k.targetKind === 'text') return null;
  if (k.key === 'Escape') return { type: 'togglePause' };
  if (state.keysMode && Object.prototype.hasOwnProperty.call(SOUND_KEYS, k.key)) return { type: 'sound', sound: SOUND_KEYS[k.key] };
  return null;
}
