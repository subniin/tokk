// The words of the app: the "Heard:" and "Did:" lines (requirement 7.2), the state texts, the progress and the teach
// texts. Pure functions of their arguments. Every mark (a check, an arrow) is paired with a word.
import { HUM_SPEED_DIGITS, TEACH_BACKGROUND_MIN_S, TEACH_HUM_MIN_S, TEACH_STEP_COUNT } from './constants';

export type HumWord = 'rise' | 'fall';
export type ListeningState = 'on' | 'off' | 'keyboard' | 'notReady';

export const STEP_NAMES: readonly string[] = ['click', 'hum', 'background'];
const IGNORED = ' (ignored: listening is off)';

export const CANCELLED_TEXT = 'Teaching was cancelled. Press Teach again to continue.';

// The texts of the three teach dialogs (TeachOptions.text). The other keys keep the library's defaults.
export const TEACH_TEXTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  click: {
    title: `Step 1 of ${TEACH_STEP_COUNT}: your click`,
    quiet: 'Stay quiet for a second, so the app can hear the room.',
    record: 'Make a tongue click {count} times, with a short pause between clicks.',
    saved: `Saved. Step 2 of ${TEACH_STEP_COUNT} comes next.`,
  },
  hum: {
    title: `Step 2 of ${TEACH_STEP_COUNT}: your hum`,
    recordHum: `Hum one steady note at a comfortable pitch. Keep going for at least ${TEACH_HUM_MIN_S} seconds, then press Done.`,
    saved: `Saved. Step 3 of ${TEACH_STEP_COUNT} comes next.`,
  },
  background: {
    title: `Step 3 of ${TEACH_STEP_COUNT}: the room`,
    recordBackground: `Speak normally for about ${TEACH_BACKGROUND_MIN_S} seconds, as if you were talking to someone nearby. This teaches the app what to ignore. Then press Done.`,
    saved: 'Saved. Press Close to start using the page.',
  },
};

// A sound is written with its label and a check. While listening is off it is marked as ignored.
export function heardSound(label: string, listening: boolean): string {
  return `Heard: ${label} ✓${listening ? '' : IGNORED}`;
}
export function heardUnknown(listening: boolean): string {
  return `Heard: unknown sound ?${listening ? '' : IGNORED}`;
}
export function heardHum(direction: HumWord, speed: number): string {
  return `Heard: hum ${direction === 'rise' ? '↑' : '↓'} speed ${speed.toFixed(HUM_SPEED_DIGITS)}`;
}
export function heardHumEnded(): string {
  return 'Heard: hum ended';
}

export function didOpened(title: string): string { return `Did: opened "${title}"`; }
export function didBack(): string { return 'Did: went back to the list'; }
export function didAlreadyAtList(): string { return 'Did: already at the list'; }
export function didListening(on: boolean): string { return `Did: listening is now ${on ? 'on' : 'off'}`; }
export function didScrolled(direction: 'up' | 'down'): string { return `Did: scrolled ${direction}`; }
export function didNothingNoTarget(): string { return 'Did: nothing (no link was highlighted at that moment)'; }
export function didNothingNoTiming(): string { return 'Did: nothing (the timing was not ready)'; }
export function didNothingListeningOff(): string { return 'Did: nothing (listening is off)'; }
export function didNeedsMicrophone(): string { return 'Did: nothing (listening needs the microphone)'; }

// "Did: opened "x"" with the key at the end: `Did: opened "x" (key K)`.
export function withKey(text: string, key: string): string {
  return `${text} (key ${key.toUpperCase()})`;
}

export function stateText(state: ListeningState): { title: string; line: string } {
  switch (state) {
    case 'on': return { title: 'Listening is ON', line: 'Make three quick clicks to turn listening off.' };
    case 'off': return { title: 'Listening is OFF', line: 'Make three quick clicks to turn listening on.' };
    case 'keyboard': return { title: 'Microphone not in use (keyboard only)', line: 'Use the keys listed below, or press Teach again to start the microphone.' };
    case 'notReady': return { title: 'Not ready: the click sound is not taught yet.', line: 'Press Teach again to teach your sounds.' };
  }
}

export function progressLine(index: number): string {
  return `Teaching: step ${index + 1} of ${TEACH_STEP_COUNT}, ${STEP_NAMES[index]}`;
}

// The three steps with a word for each: done, now or next.
export function progressItems(index: number): { name: string; mark: 'done' | 'now' | 'next' }[] {
  return STEP_NAMES.map((name, i) => ({ name, mark: i < index ? 'done' : i === index ? 'now' : 'next' }));
}
