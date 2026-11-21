// Task 33 (requirement 2): the five waves and the kinds that appear first.
import { describe, expect, it } from 'vitest';
import { WAVES, newKinds, spawnIntervalMs } from '../apps/shoo/src/waves';

describe('the waves', () => {
  it('five waves with the start values', () => {
    expect(WAVES).toHaveLength(5);
    expect(WAVES.map((w) => w.count)).toEqual([6, 10, 14, 18, 14]);
    expect(WAVES.map((w) => w.speed)).toEqual([0.07, 0.08, 0.09, 0.1, 0.1]);
  });

  it('newKinds: the kind that appears first in a wave', () => {
    expect(newKinds(1)).toEqual(['bat']);
    expect(newKinds(2)).toEqual(['ghost']);
    expect(newKinds(3)).toEqual(['skeleton']);
    expect(newKinds(4)).toEqual(['pumpkin']);
    expect(newKinds(5)).toEqual(['warden']);
    expect(newKinds(0)).toEqual([]);
    expect(newKinds(6)).toEqual([]);
  });

  it('wave 5 has exactly one warden, every other wave none', () => {
    expect(WAVES[4].kinds.filter((k) => k === 'warden')).toHaveLength(1);
    for (const w of WAVES.slice(0, 4)) expect(w.kinds).not.toContain('warden');
  });

  it('every wave keeps the kinds of the earlier waves', () => {
    for (let i = 1; i < WAVES.length; i++) {
      for (const k of WAVES[i - 1].kinds) expect(WAVES[i].kinds, `wave ${i + 1}`).toContain(k);
      expect(WAVES[i].kinds.length).toBe(WAVES[i - 1].kinds.length + 1);
    }
  });

  it('the spawn interval goes from 2200 ms in wave 1 to 1400 ms in wave 5, never up', () => {
    expect(spawnIntervalMs(1)).toBe(2200);
    expect(spawnIntervalMs(5)).toBe(1400);
    for (let w = 2; w <= 5; w++) expect(spawnIntervalMs(w)).toBeLessThanOrEqual(spawnIntervalMs(w - 1));
  });
});
