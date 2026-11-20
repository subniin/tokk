// The texts of the teach dialog in the voice of the séance, the cancel text and the theme of the dialog (design.md
// "Teaching and the séance theme"). Pure. The other keys of the dialog keep the library's defaults.
import { THEME_ACCENT, THEME_BG, THEME_FG, THEME_FONT, THEME_RADIUS_PX } from './constants';

export const TEACH_TEXT = {
  title: 'The spirits are listening',
  quiet: 'Hold your breath. Let the room fall silent for one moment.',
  record: 'Knock on the table so the spirits can hear you. Knock {count} times, one slow knock at a time.',
  training: 'The spirits are learning your knock...',
  save: 'Seal the knock',
  saved: 'The spirits know your knock. Press Close to enter the room.',
} as const;

export const CANCEL_TEXT = 'The spirits did not hear your knock. Press Teach again to try once more.';

// The five custom properties that theme the dialog, set on :root.
export const THEME_PROPERTIES: Readonly<Record<string, string>> = {
  '--tokk-bg': THEME_BG,
  '--tokk-fg': THEME_FG,
  '--tokk-accent': THEME_ACCENT,
  '--tokk-font': THEME_FONT,
  '--tokk-radius': `${THEME_RADIUS_PX}px`,
};
