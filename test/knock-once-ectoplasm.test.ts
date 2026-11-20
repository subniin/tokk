// Task 23, U7 (requirement 9): the envelope history, the level of a window, the idle settle and the ribbons.
import { describe, expect, it } from 'vitest';
import { createHistory, fold, levelOf, ribbonPoints, settleFactor, shownLevel, stillRibbonPoints } from '../apps/knock-once/src/ectoplasm';
import type { EnvelopeLike } from '../apps/knock-once/src/ectoplasm';
import {
  COLOR_ECTO, COLOR_ROOM, ECTO_HISTORY_MS, ECTO_IDLE_LEVEL, ECTO_IDLE_MS, ECTO_LAYER_COUNT, ECTO_LEVEL_WINDOW_MS, ECTO_SETTLE_MS,
} from '../apps/knock-once/src/constants';
import { contrastRatio } from './helpers/contrast';

const BIN_MS = 10;
const BINS_PER_ENVELOPE = 2;
const GRAPHIC_CONTRAST_MIN = 3;
const SIZES_PX: [number, number][] = [[320, 120], [640, 180], [960, 180], [1, 1]];

const env = (levels: number[], t0 = 0): EnvelopeLike => ({
  t0, binMs: BIN_MS, min: Float32Array.from(levels.map((l) => -l / 2)), max: Float32Array.from(levels),
});

describe('the history (U7)', () => {
  it('its length is derived from ECTO_HISTORY_MS and the bin length', () => {
    expect(createHistory(BIN_MS).capacity).toBe(ECTO_HISTORY_MS / BIN_MS);
    expect(createHistory(20).capacity).toBe(ECTO_HISTORY_MS / 20);
    expect(createHistory(BIN_MS).levels).toEqual([]);
  });

  it('fold keeps the newest bins, as the larger of |min| and |max| clamped to 1, and modifies no array', () => {
    let h = createHistory(BIN_MS);
    const e = { t0: 0, binMs: BIN_MS, min: Float32Array.from([-0.5, -0.1, -3]), max: Float32Array.from([0.2, 0.3, 0.1]) };
    const minCopy = Float32Array.from(e.min);
    const maxCopy = Float32Array.from(e.max);
    const before = h;
    h = fold(h, e);
    expect(e.min).toEqual(minCopy);
    expect(e.max).toEqual(maxCopy);
    expect(before.levels).toEqual([]);
    expect(h.levels.map((x) => Math.round(x * 100) / 100)).toEqual([0.5, 0.3, 1]);
    for (let i = 0; i < h.capacity; i++) h = fold(h, env([0.01, 0.01]));
    expect(h.levels).toHaveLength(h.capacity);
    expect(Math.max(...h.levels)).toBeCloseTo(0.01, 6);
  });

  it('levelOf gives the largest value of the newest bins of the window', () => {
    let h = createHistory(BIN_MS);
    h = fold(h, env([0.9]));
    for (let i = 0; i < ECTO_LEVEL_WINDOW_MS / BIN_MS / BINS_PER_ENVELOPE - 1; i++) h = fold(h, env([0.1, 0.1]));
    expect(levelOf(h, ECTO_LEVEL_WINDOW_MS)).toBeCloseTo(0.9, 6);
    h = fold(h, env([0.1, 0.1]));
    expect(levelOf(h, ECTO_LEVEL_WINDOW_MS)).toBeCloseTo(0.1, 6);
    expect(levelOf(createHistory(BIN_MS), ECTO_LEVEL_WINDOW_MS)).toBe(0);
  });

  it('the idle settle: live until ECTO_IDLE_MS, then easing to the idle level, never frozen on a knock', () => {
    expect(settleFactor(0)).toBe(0);
    expect(settleFactor(ECTO_IDLE_MS)).toBe(0);
    const mid = settleFactor(ECTO_IDLE_MS + ECTO_SETTLE_MS / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(settleFactor(ECTO_IDLE_MS + ECTO_SETTLE_MS)).toBe(1);
    expect(settleFactor(Number.POSITIVE_INFINITY)).toBe(1);
    expect(shownLevel(0.8, 0)).toBeCloseTo(0.8, 6);
    expect(shownLevel(0.8, 1)).toBeCloseTo(ECTO_IDLE_LEVEL, 6);
    expect(shownLevel(0.8, 0.5)).toBeLessThan(0.8);
  });
});

describe('the ribbons (U7)', () => {
  it('every point lies inside the canvas, for a range of sizes, phases, layers and levels', () => {
    let loud = createHistory(BIN_MS);
    for (let i = 0; i < loud.capacity; i++) loud = fold(loud, env([1]));
    for (const [w, hgt] of SIZES_PX) {
      for (let layer = 0; layer < ECTO_LAYER_COUNT; layer++) {
        for (const phase of [0, 1234, 1e7]) {
          for (const settle of [0, 0.5, 1]) {
            const pts = ribbonPoints(loud, w, hgt, phase, layer, settle);
            expect(pts.length).toBeGreaterThanOrEqual(2);
            for (const p of [...pts, ...stillRibbonPoints(w, hgt, layer)]) {
              expect(p.x).toBeGreaterThanOrEqual(0);
              expect(p.x).toBeLessThanOrEqual(w);
              expect(p.y).toBeGreaterThanOrEqual(0);
              expect(p.y).toBeLessThanOrEqual(hgt);
            }
          }
        }
      }
    }
  });

  it('a loud history swings wider than a quiet one, and the drift moves the ribbon', () => {
    let loud = createHistory(BIN_MS);
    let quiet = createHistory(BIN_MS);
    for (let i = 0; i < loud.capacity; i++) { loud = fold(loud, env([0.25])); quiet = fold(quiet, env([0.001])); }
    const swing = (pts: { y: number }[]): number => Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    expect(swing(ribbonPoints(loud, 640, 180, 0, 0, 0))).toBeGreaterThan(swing(ribbonPoints(quiet, 640, 180, 0, 0, 0)));
    expect(ribbonPoints(quiet, 640, 180, 0, 0, 1)).not.toEqual(ribbonPoints(quiet, 640, 180, 2000, 0, 1));
  });

  it('the still ribbon is the same on every call and does not depend on an envelope', () => {
    expect(stillRibbonPoints(640, 180, 1)).toEqual(stillRibbonPoints(640, 180, 1));
    expect(stillRibbonPoints(640, 180, 0)).not.toEqual(stillRibbonPoints(640, 180, 1));
  });

  it('the ribbon colour has 3 to 1 contrast against the room', () => {
    expect(contrastRatio(COLOR_ECTO, COLOR_ROOM)).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST_MIN);
  });
});
