// Task 33 (requirement 1): the monster table and the boss pattern.
import { describe, expect, it } from 'vitest';
import { BOSS_PATTERN, MONSTERS } from '../apps/shoo/src/monsters';

describe('the monster table', () => {
  it('weak sound and hit points of every kind', () => {
    expect(MONSTERS).toEqual({
      bat: { weak: 'click', hp: 1 },
      ghost: { weak: 'clap', hp: 1 },
      skeleton: { weak: 'knock', hp: 2 },
      pumpkin: { weak: 'pop', hp: 1 },
      warden: { weak: 'rhythm', hp: 3 },
    });
  });

  it('the boss pattern', () => {
    expect(BOSS_PATTERN).toBe('knock knock _ knock');
  });
});
