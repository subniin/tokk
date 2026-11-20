// Generates the browser test fixtures in Node: a model made with teachFromRecordings from a synthetic teaching
// set at 48 kHz, and a test WAV with one impact of each class. Nothing here is committed (the output folder is
// git-ignored) and nothing here needs a network. The audio is synthetic, not recorded.

import { mkdir, writeFile } from 'node:fs/promises';
import {
  NOISE_FLOOR_WARMUP_MS,
  SYNTH_FIXTURE_LEAD_MARGIN_MS,
  SYNTH_FIXTURE_LEAD_NOISE_DBFS,
  SYNTH_FIXTURE_TAIL_MS,
} from '../../core/constants';
import { runSamples } from '../../core/engine';
import { SYNTH_CLASSES } from '../../core/synth';
import { teachFromRecordings } from '../../core/teach';
import type { Recording } from '../../core/teach';
import type { SoundModel } from '../../core/types';
import { readWavFile, writeWavFile } from '../../node/files';
import { LEAD_MS, TRAIN_GAIN_DB, TRAIN_PER_CLASS, TRAIN_SPACING_MS, TRAIL_MS, makeSignal } from '../helpers/engine-fixture';
import type { ImpactName } from '../helpers/engine-fixture';
import { FIXTURE_LABELS_PATH, FIXTURE_MODEL_PATH, FIXTURE_WAV_PATH, GENERATED_DIR } from './paths';

// Test-only values.
export const WEB_TEST_SAMPLE_RATE_HZ = 48000;
// The browser needs time to start capturing (context, stream, worklet module, Worker). The first part of the file
// can be lost before the first chunk reaches the Worker. Measured loss: 0 to 10 ms (design.md "Measured values").
// 500 ms keeps a margin of about 50 times that for a slower machine.
export const WEB_TEST_CAPTURE_START_ALLOWANCE_MS = 500;
export const WEB_TEST_IMPACT_SPACING_MS = 800;      // start to start, more than the 700 ms spacing of teaching
export const WEB_TEST_GAIN_DB = TRAIN_GAIN_DB;
export const WEB_TEST_LABELS: ImpactName[] = ['low', 'mid', 'high', 'ring'];
export const WEB_TEST_LEAD_MS = NOISE_FLOOR_WARMUP_MS + SYNTH_FIXTURE_LEAD_MARGIN_MS + WEB_TEST_CAPTURE_START_ALLOWANCE_MS;
const TEACH_SEED_BASE = 31000;
const TEST_SEED = 47000;
const SEED_STEP = 1000;

const longestImpactMs = (): number => Math.max(...WEB_TEST_LABELS.map((c) => SYNTH_CLASSES[c].durationMs));

export interface FixtureInfo {
  labels: string[];
  sampleRate: number;
  durationMs: number;
}

function teachingSet(): Recording[] {
  return WEB_TEST_LABELS.map((cls, ci) => {
    const hits = Array.from({ length: TRAIN_PER_CLASS }, (_, i) => ({ atMs: LEAD_MS + i * TRAIN_SPACING_MS, cls, gainDb: TRAIN_GAIN_DB }));
    const samples = makeSignal({
      sampleRate: WEB_TEST_SAMPLE_RATE_HZ,
      totalMs: LEAD_MS + TRAIN_PER_CLASS * TRAIN_SPACING_MS + TRAIL_MS,
      hits,
      seed: TEACH_SEED_BASE + ci * SEED_STEP,
      noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS,
    });
    return { label: cls, file: `${cls}-01.wav`, samples, sampleRate: WEB_TEST_SAMPLE_RATE_HZ };
  });
}

function testSignal(): { samples: Float32Array; durationMs: number } {
  const durationMs = WEB_TEST_LEAD_MS + (WEB_TEST_LABELS.length - 1) * WEB_TEST_IMPACT_SPACING_MS
    + SYNTH_FIXTURE_TAIL_MS + longestImpactMs();
  const hits = WEB_TEST_LABELS.map((cls, i) => ({ atMs: WEB_TEST_LEAD_MS + i * WEB_TEST_IMPACT_SPACING_MS, cls, gainDb: WEB_TEST_GAIN_DB }));
  const samples = makeSignal({
    sampleRate: WEB_TEST_SAMPLE_RATE_HZ, totalMs: durationMs, hits, seed: TEST_SEED, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS,
  });
  return { samples, durationMs };
}

// The check of requirement 9.3: the Node engine must recognise the generated file with the generated model.
export function checkFixture(model: SoundModel, samples: Float32Array, sampleRate: number): void {
  const result = runSamples(samples, sampleRate, model, WEB_TEST_LABELS);
  const got = result.matches.map((m) => m.pattern);
  if (JSON.stringify(got) !== JSON.stringify(WEB_TEST_LABELS)) {
    throw new Error(
      `The generated fixture is not recognised in Node: expected ${WEB_TEST_LABELS.join(', ')} but got ${got.join(', ') || 'nothing'}. `
      + `Unknown sounds: ${result.unknowns.length}. The browser tests cannot pass until this is fixed.`,
    );
  }
}

export async function generateFixtures(): Promise<FixtureInfo> {
  const { model } = teachFromRecordings(teachingSet());
  const { samples, durationMs } = testSignal();
  await mkdir(GENERATED_DIR, { recursive: true });
  await writeWavFile(FIXTURE_WAV_PATH, samples, WEB_TEST_SAMPLE_RATE_HZ);
  await writeFile(FIXTURE_MODEL_PATH, JSON.stringify(model));
  const info: FixtureInfo = { labels: [...WEB_TEST_LABELS], sampleRate: WEB_TEST_SAMPLE_RATE_HZ, durationMs };
  await writeFile(FIXTURE_LABELS_PATH, JSON.stringify(info));
  const written = await readWavFile(FIXTURE_WAV_PATH);
  checkFixture(model, written.samples, written.sampleRate);
  return info;
}
