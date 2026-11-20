// Task 22, U6: the recognition formats of requirement 7.2, character by character, and the state texts.
import { describe, expect, it } from 'vitest';
import {
  CANCELLED_TEXT, didAlreadyAtList, didBack, didListening, didNeedsMicrophone, didNothingListeningOff, didNothingNoTarget, didNothingNoTiming,
  didOpened, didScrolled, heardHum, heardHumEnded, heardSound, heardUnknown, progressItems, progressLine, stateText, withKey,
} from '../apps/hands-free/src/text';

describe('recognition texts (U6)', () => {
  it('a sound', () => {
    expect(heardSound('click', true)).toBe('Heard: click ✓');
  });

  it('a sound while listening is off is marked as ignored', () => {
    expect(heardSound('click', false)).toBe('Heard: click ✓ (ignored: listening is off)');
  });

  it('an unknown sound', () => {
    expect(heardUnknown(true)).toBe('Heard: unknown sound ?');
    expect(heardUnknown(false)).toBe('Heard: unknown sound ? (ignored: listening is off)');
  });

  it('a hum, with the speed to one decimal', () => {
    expect(heardHum('rise', 3)).toBe('Heard: hum ↑ speed 3.0');
    expect(heardHum('fall', 1.5)).toBe('Heard: hum ↓ speed 1.5');
    expect(heardHum('rise', 0.04)).toBe('Heard: hum ↑ speed 0.0');
    expect(heardHum('fall', 5.96)).toBe('Heard: hum ↓ speed 6.0');
  });

  it('the end of a hum', () => {
    expect(heardHumEnded()).toBe('Heard: hum ended');
  });

  it('what the app did', () => {
    expect(didOpened('Why bread rises')).toBe('Did: opened "Why bread rises"');
    expect(didBack()).toBe('Did: went back to the list');
    expect(didAlreadyAtList()).toBe('Did: already at the list');
    expect(didListening(false)).toBe('Did: listening is now off');
    expect(didListening(true)).toBe('Did: listening is now on');
    expect(didScrolled('up')).toBe('Did: scrolled up');
    expect(didScrolled('down')).toBe('Did: scrolled down');
  });

  it('nothing to activate', () => {
    expect(didNothingNoTarget()).toBe('Did: nothing (no link was highlighted at that moment)');
    expect(didNothingNoTiming()).toBe('Did: nothing (the timing was not ready)');
  });

  it('nothing happens while listening is off', () => {
    expect(didNothingListeningOff()).toBe('Did: nothing (listening is off)');
  });

  it('a key press adds the key at the end', () => {
    expect(withKey(didBack(), 'B')).toBe('Did: went back to the list (key B)');
    expect(withKey(didOpened('Where puddles go'), 'k')).toBe('Did: opened "Where puddles go" (key K)');
    expect(didNeedsMicrophone()).toBe('Did: nothing (listening needs the microphone)');
  });

  it('every mark is paired with a word in the same text', () => {
    for (const text of [heardSound('click', true), heardUnknown(true), heardHum('rise', 1), heardHum('fall', 1)]) {
      expect(text).toMatch(/click ✓|unknown sound \?|hum [↑↓] speed/);
    }
  });

  it('the state texts say the state in words', () => {
    expect(stateText('on')).toEqual({ title: 'Listening is ON', line: 'Make three quick clicks to turn listening off.' });
    expect(stateText('off')).toEqual({ title: 'Listening is OFF', line: 'Make three quick clicks to turn listening on.' });
    expect(stateText('keyboard').title).toBe('Microphone not in use (keyboard only)');
    expect(stateText('notReady').title).toBe('Not ready: the click sound is not taught yet.');
  });

  it('the cancel text is the one of requirement 3.6', () => {
    expect(CANCELLED_TEXT).toBe('Teaching was cancelled. Press Teach again to continue.');
  });

  it('the progress names the three steps and marks the done and the current one with words', () => {
    expect(progressLine(0)).toBe('Teaching: step 1 of 3, click');
    expect(progressLine(1)).toBe('Teaching: step 2 of 3, hum');
    expect(progressLine(2)).toBe('Teaching: step 3 of 3, background');
    expect(progressItems(1)).toEqual([
      { name: 'click', mark: 'done' }, { name: 'hum', mark: 'now' }, { name: 'background', mark: 'next' },
    ]);
    expect(progressItems(0).map((i) => i.mark)).toEqual(['now', 'next', 'next']);
    expect(progressItems(2).map((i) => i.mark)).toEqual(['done', 'done', 'now']);
  });
});
