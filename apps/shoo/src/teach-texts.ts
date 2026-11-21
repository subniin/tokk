// The English copy of the intro, the teach dialog and the room sound (shoo.md section 5). Pure.
import type { Kind, SoundId } from './monsters';

export const INTRO_TEXT: Record<Kind, string> = {
  bat: 'A bat! Bats flee from a tongue click.',
  ghost: 'A ghost! Ghosts scatter at a clap.',
  skeleton: 'A skeleton! Knock on the table to rattle its bones. It takes two knocks.',
  pumpkin: 'A pumpkin! Pop your lips to burst it.',
  warden: 'The Grave Warden! Only the old rhythm stops it: knock knock, pause, knock. Three times.',
};

// The `record` text of the teach dialog of each sound. The count is part of the sentence, so there is no {count}.
export const TEACH_LINE: Record<SoundId, string> = {
  click: 'Click your tongue 10 times.',
  clap: 'Clap 10 times.',
  knock: 'Knock 10 times, an arm\'s length from the laptop.',
  pop: 'Pop your lips 10 times.',
};

// The first run: 30 seconds of the room, talking, then typing. `body` is the `recordBackground` text of the dialog.
export const ROOM_TEXT = {
  title: 'First, let the house hear the night.',
  body: 'For 30 seconds, talk for a while, then type for a while. The house learns what is not a monster sound.',
  button: 'Start (30 s)',
} as const;

// Shown for a few seconds when every sound of the wave is already taught.
export const READY_TEXT = 'Get ready.';

export function waveLabel(wave: number): string {
  return `Wave ${wave}`;
}
