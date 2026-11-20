// Task 23, U4 (requirement 10): every caption text character by character, its kind, and the rolling list.
import { describe, expect, it } from 'vitest';
import {
  answered, effectCaption, effectFailed, effectsSwitched, effectsUnavailable, heardKnock, heardUnknown, micUnavailable, newGame,
  pushCaption, spiritAsks, spiritEnds, summoned, taught, teachCancelled, teachFailed,
} from '../apps/knock-once/src/captions';
import type { Caption } from '../apps/knock-once/src/captions';
import { CAPTION_KEEP } from '../apps/knock-once/src/constants';
import { CANCEL_TEXT } from '../apps/knock-once/src/teach-texts';

describe('caption texts (U4)', () => {
  it('heard sounds', () => {
    expect(heardKnock()).toEqual({ kind: 'heard', text: 'Heard: knock ✓' });
    expect(heardUnknown()).toEqual({ kind: 'heard', text: 'Heard: unknown sound ?' });
  });

  it('the summoning by a knock, a key and the button, and a new game', () => {
    expect(summoned({ by: 'knock' })).toEqual({ kind: 'action', text: 'The circle is open: knock, knock, pause, knock.' });
    expect(summoned({ by: 'key', key: 's' })).toEqual({ kind: 'action', text: 'The circle is open (key S).' });
    expect(summoned({ by: 'button' })).toEqual({ kind: 'action', text: 'The circle is open (button).' });
    expect(newGame()).toEqual({ kind: 'action', text: 'A new séance begins.' });
  });

  it('answers by knocks, keys and buttons', () => {
    expect(answered('yes', { by: 'knock' })).toEqual({ kind: 'action', text: 'You answered: yes (one knock)' });
    expect(answered('no', { by: 'knock' })).toEqual({ kind: 'action', text: 'You answered: no (two knocks)' });
    expect(answered('yes', { by: 'key', key: 'y' })).toEqual({ kind: 'action', text: 'You answered: yes (key Y)' });
    expect(answered('no', { by: 'key', key: 'N' })).toEqual({ kind: 'action', text: 'You answered: no (key N)' });
    expect(answered('yes', { by: 'button' })).toEqual({ kind: 'action', text: 'You answered: yes (button)' });
    expect(answered('no', { by: 'button' })).toEqual({ kind: 'action', text: 'You answered: no (button)' });
  });

  it('the spirit lines', () => {
    expect(spiritAsks('Is the room cold?')).toEqual({ kind: 'spirit', text: 'The spirit asks: Is the room cold?' });
    expect(spiritEnds('The lamp stays lit', 'All is calm.')).toEqual({ kind: 'spirit', text: 'The spirit says: The lamp stays lit. All is calm.' });
  });

  it('the effects, in square brackets', () => {
    expect(effectCaption('summon')).toEqual({ kind: 'effect', text: '[a low hum rises from the table]' });
    expect(effectCaption('between')).toEqual({ kind: 'effect', text: '[a cold breath passes over the candle]' });
    expect(effectCaption('ending')).toEqual({ kind: 'effect', text: '[the sound sinks into the floor]' });
  });

  it('the system lines', () => {
    expect(taught()).toEqual({ kind: 'system', text: 'The spirits know your knock.' });
    expect(teachCancelled()).toEqual({ kind: 'system', text: CANCEL_TEXT });
    expect(teachFailed('boom.')).toEqual({ kind: 'system', text: 'Teaching did not finish: boom. Press Teach again to try once more.' });
    expect(micUnavailable('Permission denied.')).toEqual({ kind: 'system', text: 'Permission denied. The microphone is not available. You can still play with the keyboard and the buttons.' });
    expect(effectFailed()).toEqual({ kind: 'system', text: 'The sound effect could not play. The game goes on.' });
    expect(effectsSwitched(false)).toEqual({ kind: 'system', text: 'Sound effects are off.' });
    expect(effectsSwitched(true)).toEqual({ kind: 'system', text: 'Sound effects are on.' });
    expect(effectsUnavailable()).toEqual({ kind: 'system', text: 'Sound effects are not available in this browser, so they are off.' });
  });

  it('every mark is paired with a word', () => {
    for (const c of [heardKnock(), heardUnknown()]) expect(c.text).toMatch(/(knock ✓|unknown sound \?)$/);
  });
});

describe('the rolling list (U4)', () => {
  it('keeps the newest CAPTION_KEEP lines in order, and does not change the old list', () => {
    let list: Caption[] = [];
    for (let i = 0; i < CAPTION_KEEP + 5; i++) list = pushCaption(list, { kind: 'heard', text: `line ${i}` });
    expect(list).toHaveLength(CAPTION_KEEP);
    expect(list[0].text).toBe('line 5');
    expect(list[list.length - 1].text).toBe(`line ${CAPTION_KEEP + 4}`);
    const before = [...list];
    const next = pushCaption(list, heardKnock());
    expect(list).toEqual(before);
    expect(next[next.length - 1]).toEqual(heardKnock());
    expect(pushCaption([], heardKnock(), 1)).toEqual([heardKnock()]);
  });
});
