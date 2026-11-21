// Task 34: the stand-ins for the two sounds of Click Talk, used by the one-time writer of apps/click-talk/sounds and by the Node tests.
//
// Each sound is an impact class of core/synth over a quiet white-noise bed, so the two sounds differ in pitch and decay.
// They are SYNTHETIC. They show the pattern logic and the wiring. They say nothing about how well Tokk hears a real
// tongue click or lip pop.

import {
  NOISE_FLOOR_WARMUP_MS, RECOMMENDED_EXAMPLES_PER_LABEL, SYNTH_FIXTURE_LEAD_MARGIN_MS, SYNTH_FIXTURE_LEAD_NOISE_DBFS,
  SYNTH_FIXTURE_SAMPLE_RATE_HZ, SYNTH_FIXTURE_TAIL_MS,
} from '../../core/constants';
import { SYNTH_CLASSES } from '../../core/synth';
import { makeSignal, TRAIN_GAIN_DB, TRAIN_SPACING_MS } from './engine-fixture';
import type { Hit, ImpactName } from './engine-fixture';

export type TalkSound = 'click' | 'pop';

// The recipe. Every value has its unit in the name.
export const TALK_SOUNDS: readonly TalkSound[] = ['click', 'pop'];
export const TALK_CLASS: Record<TalkSound, ImpactName> = { click: 'high', pop: 'mid' };
export const TALK_GAIN_DB = TRAIN_GAIN_DB;
export const TALK_SAMPLE_RATE_HZ = SYNTH_FIXTURE_SAMPLE_RATE_HZ;
export const TALK_TEACH_COUNT = RECOMMENDED_EXAMPLES_PER_LABEL;
export const TALK_TEACH_SPACING_MS = TRAIN_SPACING_MS + 100;   // start to start, in a teaching file
export const TALK_BEAT_MS = 300;                               // start to start of two consecutive sounds, below GAP_CONSECUTIVE_MAX_MS
export const TALK_LEAD_MS = NOISE_FLOOR_WARMUP_MS + SYNTH_FIXTURE_LEAD_MARGIN_MS;   // quiet bed before the first sound
export const TALK_NOISE_DBFS = SYNTH_FIXTURE_LEAD_NOISE_DBFS;
const TALK_SEED_BASE = 34000;
const SEED_STEP = 100;

const seedOf = (sound: TalkSound): number => TALK_SEED_BASE + TALK_SOUNDS.indexOf(sound) * SEED_STEP;

function tailMs(sounds: readonly TalkSound[]): number {
  return SYNTH_FIXTURE_TAIL_MS + Math.max(...sounds.map((s) => SYNTH_CLASSES[TALK_CLASS[s]].durationMs));
}

// One signal from (sound, start in ms) pairs.
export function buildSounds(placed: readonly { sound: TalkSound; atMs: number }[], seed: number): Float32Array {
  const last = Math.max(TALK_LEAD_MS, ...placed.map((p) => p.atMs));
  const hits: Hit[] = placed.map((p) => ({ atMs: p.atMs, cls: TALK_CLASS[p.sound], gainDb: TALK_GAIN_DB }));
  return makeSignal({
    sampleRate: TALK_SAMPLE_RATE_HZ, totalMs: last + tailMs(placed.map((p) => p.sound)), hits, seed, noiseRmsDb: TALK_NOISE_DBFS,
  });
}

// The teaching file of one sound: TALK_TEACH_COUNT copies after the lead.
export function teachingRecording(sound: TalkSound): Float32Array {
  const placed = Array.from({ length: TALK_TEACH_COUNT }, (_, i) => ({ sound, atMs: TALK_LEAD_MS + i * TALK_TEACH_SPACING_MS }));
  return buildSounds(placed, seedOf(sound));
}

// `count` copies of one sound, TALK_BEAT_MS apart (count 1 is a single sound).
export function burstRecording(sound: TalkSound, count: number): Float32Array {
  const placed = Array.from({ length: count }, (_, i) => ({ sound, atMs: TALK_LEAD_MS + i * TALK_BEAT_MS }));
  return buildSounds(placed, TALK_SEED_BASE + SEED_STEP * (TALK_SOUNDS.length + count));
}
