// Key event -> action. Pure: the DOM listener maps the event to a KeyInput. The board decides whether the action is
// allowed at its level; the key map only names it.
import type { Level } from './board';
import type { Mode } from './patterns';

export type KeyAction = { type: 'sound'; sound: 'click' | 'pop' } | { type: 'stopHelp' };
export interface KeyInput { key: string; ctrl: boolean; alt: boolean; meta: boolean; targetKind: 'text' | 'other' }
export interface KeyState { mode: Mode; level: Level }

const MODIFIER_KEYS: readonly string[] = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'];

// Two sounds: Space = click, Enter = pop. One sound: Enter = click. In help any key stops the alarm.
// Every other key stays the browser's.
export function actionForKey(k: KeyInput, state: KeyState): KeyAction | null {
  if (state.level === 'help') return MODIFIER_KEYS.includes(k.key) ? null : { type: 'stopHelp' };
  if (k.ctrl || k.alt || k.meta) return null;
  if (k.targetKind === 'text') return null;
  if (state.mode === 'two') {
    if (k.key === ' ') return { type: 'sound', sound: 'click' };
    if (k.key === 'Enter') return { type: 'sound', sound: 'pop' };
    return null;
  }
  return k.key === 'Enter' ? { type: 'sound', sound: 'click' } : null;
}
