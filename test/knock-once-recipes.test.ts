// Task 23, U6 (requirement 11.1, 11.2): the effect recipes are short, quiet, faded and below the Nyquist frequency.
import { describe, expect, it } from 'vitest';
import { SAMPLE_RATE_MIN_HZ } from '../core/constants';
import { peakSumDbfs, RECIPES } from '../apps/knock-once/src/effect-recipes';
import {
  EFFECT_BETWEEN_MS, EFFECT_ENDING_MS, EFFECT_FADE_IN_MS, EFFECT_FADE_OUT_MS, EFFECT_PEAK_DBFS, EFFECT_SUMMON_MS, EFFECT_TAIL_MS,
  EFFECT_TOTAL_MAX_MS,
} from '../apps/knock-once/src/constants';

const LIMITS_MS = { summon: EFFECT_SUMMON_MS, between: EFFECT_BETWEEN_MS, ending: EFFECT_ENDING_MS };
const NYQUIST_HZ = SAMPLE_RATE_MIN_HZ / 2;
const DB_AMPLITUDE_DIVISOR = 20;

describe('the effect recipes (U6)', () => {
  it('three recipes, each within its duration, and the total with the tail at most EFFECT_TOTAL_MAX_MS', () => {
    expect(Object.keys(RECIPES).sort()).toEqual(['between', 'ending', 'summon']);
    for (const [name, r] of Object.entries(RECIPES)) {
      expect(r.name).toBe(name);
      expect(r.durationMs, name).toBeGreaterThan(0);
      expect(r.durationMs, name).toBeLessThanOrEqual(LIMITS_MS[name as keyof typeof LIMITS_MS]);
      expect(r.durationMs + EFFECT_TAIL_MS, name).toBeLessThanOrEqual(EFFECT_TOTAL_MAX_MS);
      expect(r.voices.length, name).toBeGreaterThan(0);
    }
  });

  it('every voice lies inside its effect, fades in and out over at least the least fades, and stays below Nyquist', () => {
    for (const r of Object.values(RECIPES)) {
      for (const v of r.voices) {
        expect(v.startMs).toBeGreaterThanOrEqual(0);
        expect(v.lengthMs).toBeGreaterThan(0);
        expect(v.startMs + v.lengthMs, r.name).toBeLessThanOrEqual(r.durationMs);
        expect(v.fadeInMs).toBeGreaterThanOrEqual(EFFECT_FADE_IN_MS);
        expect(v.fadeOutMs).toBeGreaterThanOrEqual(EFFECT_FADE_OUT_MS);
        expect(v.fadeInMs + v.fadeOutMs).toBeLessThanOrEqual(v.lengthMs);
        for (const hz of [v.fromHz, v.toHz]) {
          expect(hz).toBeGreaterThan(0);
          expect(hz).toBeLessThan(NYQUIST_HZ);
        }
        expect(v.gainDb).toBeLessThan(0);
        if (v.kind === 'noise') expect(['bandpass', 'lowpass']).toContain(v.filter);
      }
    }
  });

  it('the worst-case peak (the sum of the voice amplitudes) is at most EFFECT_PEAK_DBFS', () => {
    for (const r of Object.values(RECIPES)) {
      const sum = r.voices.reduce((s, v) => s + Math.pow(10, v.gainDb / DB_AMPLITUDE_DIVISOR), 0);
      expect(peakSumDbfs(r)).toBeCloseTo(DB_AMPLITUDE_DIVISOR * Math.log10(sum), 6);
      expect(peakSumDbfs(r), r.name).toBeLessThanOrEqual(EFFECT_PEAK_DBFS);
      console.log(`U6: ${r.name} peak sum ${peakSumDbfs(r).toFixed(1)} dBFS`);
    }
  });
});
