// The three effects as data: voices in ms, Hz and dB (design.md "The recipes", requirement 11.1, 11.2). Pure.
// audio.ts renders them with Web Audio. Every voice fades in and out, nothing loops, nothing is speech.
import type { EffectName } from './captions';
import { EFFECT_BETWEEN_MS, EFFECT_ENDING_MS, EFFECT_FADE_IN_MS, EFFECT_FADE_OUT_MS, EFFECT_SUMMON_MS } from './constants';

export interface Voice {
  kind: 'sine' | 'noise';
  filter?: 'bandpass' | 'lowpass';   // noise only: the frequencies are the filter's
  startMs: number;
  lengthMs: number;
  fromHz: number;
  toHz: number;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
}
export interface Recipe { name: EffectName; durationMs: number; voices: readonly Voice[] }

const DB_AMPLITUDE_DIVISOR = 20;
const fades = { fadeInMs: EFFECT_FADE_IN_MS, fadeOutMs: EFFECT_FADE_OUT_MS };
const slowFades = { fadeInMs: 4 * EFFECT_FADE_IN_MS, fadeOutMs: 2 * EFFECT_FADE_OUT_MS };   // a softer edge for the long voices

export const RECIPES: Readonly<Record<EffectName, Recipe>> = {
  // A low drone rising from 55 Hz to 82 Hz, and a faint band of air in its middle.
  summon: {
    name: 'summon',
    durationMs: EFFECT_SUMMON_MS,
    voices: [
      { kind: 'sine', startMs: 0, lengthMs: EFFECT_SUMMON_MS, fromHz: 55, toHz: 82, gainDb: -22, ...slowFades },
      { kind: 'noise', filter: 'bandpass', startMs: 400, lengthMs: 1100, fromHz: 900, toHz: 900, gainDb: -36, ...slowFades },
    ],
  },
  // A short breath of low-passed noise that opens up, with a soft tone inside it.
  between: {
    name: 'between',
    durationMs: EFFECT_BETWEEN_MS,
    voices: [
      { kind: 'noise', filter: 'lowpass', startMs: 0, lengthMs: 700, fromHz: 300, toHz: 1200, gainDb: -32, ...fades },
      { kind: 'sine', startMs: 200, lengthMs: 600, fromHz: 220, toHz: 220, gainDb: -34, ...fades },
    ],
  },
  // A slow tone that falls an octave, over a low rumble.
  ending: {
    name: 'ending',
    durationMs: EFFECT_ENDING_MS,
    voices: [
      { kind: 'sine', startMs: 0, lengthMs: EFFECT_ENDING_MS, fromHz: 196, toHz: 98, gainDb: -24, ...slowFades },
      { kind: 'noise', filter: 'lowpass', startMs: 0, lengthMs: EFFECT_ENDING_MS, fromHz: 200, toHz: 200, gainDb: -38, ...slowFades },
    ],
  },
};

// The worst-case peak of an effect: the sum of the linear peaks of its voices, in dBFS.
export function peakSumDbfs(recipe: Recipe): number {
  const sum = recipe.voices.reduce((s, v) => s + Math.pow(10, v.gainDb / DB_AMPLITUDE_DIVISOR), 0);
  return DB_AMPLITUDE_DIVISOR * Math.log10(sum);
}
