// Task 33 run B: the test-only parameters of the page (?speed=, ?wave=, ?lives=). Pure parsing; a bad value gives the default.
import { describe, expect, it } from 'vitest';
import { BACKGROUND_TEACH_MS, BACKGROUND_TEACH_TEST_MS, START_LIVES, TEST_LIVES_MAX, TEST_SPEED_MAX } from '../apps/shoo/src/constants';
import { backgroundMsFor, parseTestParams } from '../apps/shoo/src/test-params';

describe('parseTestParams', () => {
  it('has the plain game as the default', () => {
    expect(parseTestParams('')).toEqual({ speed: 1, wave: 1, lives: START_LIVES });
    expect(parseTestParams('?x=1')).toEqual({ speed: 1, wave: 1, lives: START_LIVES });
  });

  it('reads the three values', () => {
    expect(parseTestParams('?speed=4&wave=5&lives=9')).toEqual({ speed: 4, wave: 5, lives: 9 });
    expect(parseTestParams('?speed=1.5')).toMatchObject({ speed: 1.5 });
  });

  it('falls back on text, out of range and non-whole values', () => {
    expect(parseTestParams('?speed=abc&wave=x&lives=')).toEqual({ speed: 1, wave: 1, lives: START_LIVES });
    expect(parseTestParams(`?speed=${TEST_SPEED_MAX + 1}`).speed).toBe(1);
    expect(parseTestParams('?speed=0.5').speed).toBe(1);
    expect(parseTestParams('?speed=-3').speed).toBe(1);
    expect(parseTestParams('?wave=6').wave).toBe(1);
    expect(parseTestParams('?wave=0').wave).toBe(1);
    expect(parseTestParams('?wave=2.5').wave).toBe(1);
    expect(parseTestParams(`?lives=${TEST_LIVES_MAX + 1}`).lives).toBe(START_LIVES);
    expect(parseTestParams('?lives=0').lives).toBe(START_LIVES);
  });
});

describe('backgroundMsFor', () => {
  it('is 30 s for the plain game and the shortest allowed length when the test speed is above 1', () => {
    expect(backgroundMsFor(1)).toBe(BACKGROUND_TEACH_MS);
    expect(backgroundMsFor(2)).toBe(BACKGROUND_TEACH_TEST_MS);
    expect(BACKGROUND_TEACH_TEST_MS).toBe(10_000);
    expect(BACKGROUND_TEACH_MS).toBe(30_000);
  });
});
