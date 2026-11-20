// Task 26: the stand-in for a hand clap, used by the one-time writer of the WAV files of cases/slides, by the Node
// tests and (stage 2c) by the browser fixture.
//
// The clap is SYNTHETIC: an impact of the class `mid` of core/synth (a band-limited burst centred near 1200 Hz that
// decays within tens of milliseconds) over a quiet white-noise bed, each clap with its own seed. It shows the pattern
// logic and the wiring. It says nothing about how well Tokk recognises a real clap (design.md "Why the stand-in is fair").

import {
  NOISE_FLOOR_WARMUP_MS, SYNTH_FIXTURE_LEAD_MARGIN_MS, SYNTH_FIXTURE_LEAD_NOISE_DBFS, SYNTH_FIXTURE_TAIL_MS,
} from '../../core/constants';
import { SYNTH_CLASSES } from '../../core/synth';
import { WEB_TEST_GAIN_DB, WEB_TEST_IMPACT_SPACING_MS, WEB_TEST_SAMPLE_RATE_HZ } from '../web/fixture';
import { makeSignal } from './engine-fixture';
import type { Hit, ImpactName } from './engine-fixture';

// The recipe. Every value has its unit in the name.
export const CLAP_CLASS: ImpactName = 'mid';
export const CLAP_GAIN_DB = WEB_TEST_GAIN_DB;
export const CLAP_SAMPLE_RATE_HZ = WEB_TEST_SAMPLE_RATE_HZ;
export const CLAP_TEACH_SPACING_MS = WEB_TEST_IMPACT_SPACING_MS;   // start to start, in the teaching file
export const CLAP_PATTERN_GAP_MS = 250;                            // start to start inside a pattern; below GAP_CONSECUTIVE_MAX_MS
export const CLAP_LEAD_MS = NOISE_FLOOR_WARMUP_MS + SYNTH_FIXTURE_LEAD_MARGIN_MS;   // quiet bed before the first clap
export const CLAP_TAIL_MS = SYNTH_FIXTURE_TAIL_MS + SYNTH_CLASSES[CLAP_CLASS].durationMs;
export const CLAP_NOISE_DBFS = SYNTH_FIXTURE_LEAD_NOISE_DBFS;
export const CLAP_NOISE_ONLY_MS = 4000;                            // length of the noise-only recording
export const CLAP_SEED_TEACH = 26000;
export const CLAP_SEED_TWO = 26100;
export const CLAP_SEED_THREE = 26200;
export const CLAP_SEED_ONE = 26300;
export const CLAP_SEED_NOISE = 26400;
export const CLAP_COUNT_TEACH = 10;
export const CLAP_COUNT_ONE = 1;
export const CLAP_COUNT_TWO = 2;
export const CLAP_COUNT_THREE = 3;

const SEEDS: Record<number, number> = {
  [CLAP_COUNT_ONE]: CLAP_SEED_ONE, [CLAP_COUNT_TWO]: CLAP_SEED_TWO, [CLAP_COUNT_THREE]: CLAP_SEED_THREE,
};

// One signal from a list of clap start times in ms (each placed by the rule of core/synth `place`).
export function buildClaps(startsMs: number[], seed: number): Float32Array {
  const last = startsMs.length > 0 ? Math.max(...startsMs) : CLAP_LEAD_MS;
  const hits: Hit[] = startsMs.map((atMs) => ({ atMs, cls: CLAP_CLASS, gainDb: CLAP_GAIN_DB }));
  return makeSignal({
    sampleRate: CLAP_SAMPLE_RATE_HZ, totalMs: last + CLAP_TAIL_MS, hits, seed, noiseRmsDb: CLAP_NOISE_DBFS,
  });
}

// The teaching file: ten claps spaced CLAP_TEACH_SPACING_MS apart after the lead.
export function teachingClaps(): Float32Array {
  return buildClaps(Array.from({ length: CLAP_COUNT_TEACH }, (_, i) => CLAP_LEAD_MS + i * CLAP_TEACH_SPACING_MS), CLAP_SEED_TEACH);
}

// A recording of `count` claps (1, 2 or 3) CLAP_PATTERN_GAP_MS apart after the lead.
export function clapRecording(count: number): Float32Array {
  const seed = SEEDS[count];
  if (seed === undefined) throw new Error(`clapRecording: no recipe for ${count} claps`);
  return buildClaps(Array.from({ length: count }, (_, i) => CLAP_LEAD_MS + i * CLAP_PATTERN_GAP_MS), seed);
}

// The same bed with no clap at all.
export function noiseOnlyRecording(): Float32Array {
  return makeSignal({
    sampleRate: CLAP_SAMPLE_RATE_HZ, totalMs: CLAP_LEAD_MS + CLAP_NOISE_ONLY_MS, hits: [], seed: CLAP_SEED_NOISE, noiseRmsDb: CLAP_NOISE_DBFS,
  });
}
