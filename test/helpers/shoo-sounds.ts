// Task 33: the stand-ins for the four sounds of Shoo!, used by the one-time writer of apps/shoo/sounds and by the Node tests.
//
// Each sound is an impact class of core/synth over a quiet white-noise bed, so the four sounds differ in pitch and decay.
// They are SYNTHETIC. They show the game wiring and the pattern logic. They say nothing about how well Tokk hears a real
// tongue click, clap, knock or lip pop.

import {
  NOISE_FLOOR_WARMUP_MS, RECOMMENDED_EXAMPLES_PER_LABEL, SYNTH_FIXTURE_LEAD_MARGIN_MS, SYNTH_FIXTURE_LEAD_NOISE_DBFS,
  SYNTH_FIXTURE_SAMPLE_RATE_HZ, SYNTH_FIXTURE_TAIL_MS,
} from '../../core/constants';
import { SYNTH_CLASSES } from '../../core/synth';
import type { SoundId } from '../../apps/shoo/src/monsters';
import { makeSignal, TRAIN_GAIN_DB, TRAIN_SPACING_MS } from './engine-fixture';
import type { Hit, ImpactName } from './engine-fixture';

// The recipe. Every value has its unit in the name.
export const SHOO_SOUNDS: readonly SoundId[] = ['click', 'clap', 'knock', 'pop'];
export const SHOO_CLASS: Record<SoundId, ImpactName> = { click: 'high', clap: 'mid', knock: 'low', pop: 'ring' };
export const SHOO_GAIN_DB = TRAIN_GAIN_DB;
export const SHOO_SAMPLE_RATE_HZ = SYNTH_FIXTURE_SAMPLE_RATE_HZ;
export const SHOO_TEACH_COUNT = RECOMMENDED_EXAMPLES_PER_LABEL;
export const SHOO_TEACH_SPACING_MS = TRAIN_SPACING_MS + 100;   // start to start, in a teaching file
export const SHOO_SEQUENCE_SPACING_MS = 900;                   // start to start, in a recording of different sounds
export const SHOO_BEAT_MS = 250;                               // start to start of two consecutive sounds, below GAP_CONSECUTIVE_MAX_MS
export const SHOO_REST_MS = 600;                               // start to start across a rest `_`, from 350 to 1000 ms
export const SHOO_LEAD_MS = NOISE_FLOOR_WARMUP_MS + SYNTH_FIXTURE_LEAD_MARGIN_MS;   // quiet bed before the first sound
export const SHOO_NOISE_DBFS = SYNTH_FIXTURE_LEAD_NOISE_DBFS;
const SHOO_SEED_BASE = 33000;
const SEED_STEP = 100;

const seedOf = (sound: SoundId): number => SHOO_SEED_BASE + SHOO_SOUNDS.indexOf(sound) * SEED_STEP;

function tailMs(sounds: readonly SoundId[]): number {
  return SYNTH_FIXTURE_TAIL_MS + Math.max(...sounds.map((s) => SYNTH_CLASSES[SHOO_CLASS[s]].durationMs));
}

// One signal from (sound, start in ms) pairs.
export function buildSounds(placed: readonly { sound: SoundId; atMs: number }[], seed: number): Float32Array {
  const last = Math.max(SHOO_LEAD_MS, ...placed.map((p) => p.atMs));
  const hits: Hit[] = placed.map((p) => ({ atMs: p.atMs, cls: SHOO_CLASS[p.sound], gainDb: SHOO_GAIN_DB }));
  return makeSignal({
    sampleRate: SHOO_SAMPLE_RATE_HZ, totalMs: last + tailMs(placed.map((p) => p.sound)), hits, seed, noiseRmsDb: SHOO_NOISE_DBFS,
  });
}

// The teaching file of one sound: SHOO_TEACH_COUNT copies after the lead.
export function teachingRecording(sound: SoundId): Float32Array {
  const placed = Array.from({ length: SHOO_TEACH_COUNT }, (_, i) => ({ sound, atMs: SHOO_LEAD_MS + i * SHOO_TEACH_SPACING_MS }));
  return buildSounds(placed, seedOf(sound));
}

// The sounds one after the other, SHOO_SEQUENCE_SPACING_MS apart.
export function sequenceRecording(sounds: readonly SoundId[]): Float32Array {
  return buildSounds(sounds.map((sound, i) => ({ sound, atMs: SHOO_LEAD_MS + i * SHOO_SEQUENCE_SPACING_MS })), SHOO_SEED_BASE + SEED_STEP * SHOO_SOUNDS.length);
}

// knock knock _ knock: two knocks one beat apart, a rest, one knock.
export function bossRecording(): Float32Array {
  const placed = [0, SHOO_BEAT_MS, SHOO_BEAT_MS + SHOO_REST_MS].map((offsetMs) => ({ sound: 'knock' as const, atMs: SHOO_LEAD_MS + offsetMs }));
  return buildSounds(placed, SHOO_SEED_BASE + SEED_STEP * (SHOO_SOUNDS.length + 1));
}

// Two knocks one beat apart and nothing else.
export function twoKnocksRecording(): Float32Array {
  const placed = [0, SHOO_BEAT_MS].map((offsetMs) => ({ sound: 'knock' as const, atMs: SHOO_LEAD_MS + offsetMs }));
  return buildSounds(placed, SHOO_SEED_BASE + SEED_STEP * (SHOO_SOUNDS.length + 2));
}
