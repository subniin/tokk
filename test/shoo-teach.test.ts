// Task 33 (requirement 13): the English copy of shoo.md section 5, and the library's check of the teach lines.
import { describe, expect, it } from 'vitest';
import { resolveTeachText } from '../web/teach-ui/text';
import { MONSTERS } from '../apps/shoo/src/monsters';
import type { Kind, SoundId } from '../apps/shoo/src/monsters';
import { INTRO_TEXT, READY_TEXT, ROOM_TEXT, TEACH_LINE, waveLabel } from '../apps/shoo/src/teach-texts';
import { SHOO_SOUNDS } from './helpers/shoo-sounds';

const KINDS = Object.keys(MONSTERS) as Kind[];

describe('the copy', () => {
  it('the intro line of every kind', () => {
    expect(INTRO_TEXT).toEqual({
      bat: 'A bat! Bats flee from a tongue click.',
      ghost: 'A ghost! Ghosts scatter at a clap.',
      skeleton: 'A skeleton! Knock on the table to rattle its bones. It takes two knocks.',
      pumpkin: 'A pumpkin! Pop your lips to burst it.',
      warden: 'The Grave Warden! Only the old rhythm stops it: knock knock, pause, knock. Three times.',
    });
  });

  it('the teach line of every sound', () => {
    expect(TEACH_LINE).toEqual({
      click: 'Click your tongue 10 times.',
      clap: 'Clap 10 times.',
      knock: 'Knock 10 times, an arm\'s length from the laptop.',
      pop: 'Pop your lips 10 times.',
    });
  });

  it('the room text and the other lines', () => {
    expect(ROOM_TEXT).toEqual({
      title: 'First, let the house hear the night.',
      body: 'For 30 seconds, talk for a while, then type for a while. The house learns what is not a monster sound.',
      button: 'Start (30 s)',
    });
    expect(READY_TEXT).toBe('Get ready.');
    expect([1, 2, 3, 4, 5].map(waveLabel)).toEqual(['Wave 1', 'Wave 2', 'Wave 3', 'Wave 4', 'Wave 5']);
  });

  it('every sound has a teach text, every kind an intro, and no text is empty', () => {
    for (const s of SHOO_SOUNDS) expect(TEACH_LINE[s as SoundId].length, s).toBeGreaterThan(0);
    expect(Object.keys(TEACH_LINE).sort()).toEqual([...SHOO_SOUNDS].sort());
    expect(Object.keys(INTRO_TEXT).sort()).toEqual([...KINDS].sort());
    for (const k of KINDS) expect(INTRO_TEXT[k].length, k).toBeGreaterThan(0);
  });

  it('the intro of each kind with a weak sound names how to make it', () => {
    expect(INTRO_TEXT.bat).toContain('tongue click');
    expect(INTRO_TEXT.ghost).toContain('clap');
    expect(INTRO_TEXT.skeleton).toContain('two knocks');
    expect(INTRO_TEXT.pumpkin).toContain('Pop your lips');
  });

  it('the teach lines and the room body pass the library check as dialog texts', () => {
    for (const s of SHOO_SOUNDS) {
      const resolved = resolveTeachText({ record: TEACH_LINE[s as SoundId] });
      expect(resolved.record).toBe(TEACH_LINE[s as SoundId]);
    }
    expect(resolveTeachText({ title: ROOM_TEXT.title, recordBackground: ROOM_TEXT.body }).recordBackground).toBe(ROOM_TEXT.body);
  });

  it('no external address, no markup', () => {
    const all = [...Object.values(INTRO_TEXT), ...Object.values(TEACH_LINE), ...Object.values(ROOM_TEXT), READY_TEXT];
    for (const t of all) expect(t).not.toMatch(/https?:|<|>/);
  });
});
