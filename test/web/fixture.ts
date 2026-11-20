// Generates the browser test fixtures in Node: a model made with teachFromRecordings from a synthetic teaching
// set at 48 kHz, and a test WAV with one impact of each class. Nothing here is committed (the output folder is
// git-ignored) and nothing here needs a network. The audio is synthetic, not recorded.

import { mkdir, writeFile } from 'node:fs/promises';
import {
  NOISE_FLOOR_WARMUP_MS,
  SYNTH_FIXTURE_LEAD_MARGIN_MS,
  SYNTH_FIXTURE_LEAD_NOISE_DBFS,
  SYNTH_FIXTURE_SOUNDS_SPACING_MS,
  SYNTH_FIXTURE_TAIL_MS,
} from '../../core/constants';
import { runSamples } from '../../core/engine';
import { Segmenter } from '../../core/segment';
import { SYNTH_CLASSES } from '../../core/synth';
import { teachFromRecordings } from '../../core/teach';
import type { Recording } from '../../core/teach';
import type { SoundModel } from '../../core/types';
import { readWavFile, writeWavFile } from '../../node/files';
import { LEAD_MS, TRAIN_GAIN_DB, TRAIN_PER_CLASS, TRAIN_SPACING_MS, TRAIL_MS, makeSignal } from '../helpers/engine-fixture';
import type { ImpactName } from '../helpers/engine-fixture';
import {
  FIXTURE_LABELS_PATH, FIXTURE_MISMATCH_MODEL_PATH, FIXTURE_MODEL_PATH, FIXTURE_PHASE_WAV_PATH, FIXTURE_TAP_WAV_PATH, FIXTURE_TEACH_BASE_MODEL_PATH,
  FIXTURE_TEACH_FEW_WAV_PATH, FIXTURE_TEACH_INFO_PATH, FIXTURE_TEACH_PITCH_MODEL_PATH, FIXTURE_TEACH_WAV_PATH, FIXTURE_WAV_PATH, GENERATED_DIR,
} from './paths';

// Test-only values.
export const WEB_TEST_SAMPLE_RATE_HZ = 48000;
export const WEB_TEST_MISMATCH_SAMPLE_RATE_HZ = 44100;   // second model, taught at a rate that differs from the WAV
// The browser needs time to start capturing (context, stream, worklet module, Worker). The first part of the file
// can be lost before the first chunk reaches the Worker. Measured loss: 0 to 10 ms (design.md "Measured values").
// 500 ms keeps a margin of about 50 times that for a slower machine.
export const WEB_TEST_CAPTURE_START_ALLOWANCE_MS = 500;
export const WEB_TEST_IMPACT_SPACING_MS = 800;      // start to start, more than the 700 ms spacing of teaching
export const WEB_TEST_GAIN_DB = TRAIN_GAIN_DB;
export const WEB_TEST_LABELS: ImpactName[] = ['low', 'mid', 'high', 'ring'];
export const WEB_TEST_LEAD_MS = NOISE_FLOOR_WARMUP_MS + SYNTH_FIXTURE_LEAD_MARGIN_MS + WEB_TEST_CAPTURE_START_ALLOWANCE_MS;
export const WEB_TEST_TEACH_LEAD_MS = 3000;        // noise bed before the first taught sound: the dialog's quiet second fits in it
export const WEB_TEST_TEACH_COPIES = 10;
export const WEB_TEST_TEACH_FEW_COPIES = 4;         // below MIN_EXAMPLES_PER_LABEL
export const WEB_TEST_TAP_COPIES = 5;
export const WEB_TEST_TAP_LABEL = 'tap';
export const WEB_TEST_TAP_CLASS: ImpactName = 'high';   // a class the base model low + mid does not have
export const WEB_TEST_PHASE_BEFORE_COPIES = 3;        // sounds while the dialog is open
export const WEB_TEST_PHASE_AFTER_COPIES = 5;         // sounds after Cancel and a new calibration
export const WEB_TEST_PHASE_AFTER_AT_MS = 7000;       // start of the second group, long after Cancel plus calibration
export const WEB_TEST_PITCH_BASELINE_HZ = 150;       // a pitch baseline, so that a hum pattern is accepted by the engine
const PHASE_SEED = 54000;
const TEACH_SEED = 52000;
const TAP_SEED = 53000;
const TEACH_SEED_BASE = 31000;
const TEST_SEED = 47000;
const SEED_STEP = 1000;

const longestImpactMs = (): number => Math.max(...WEB_TEST_LABELS.map((c) => SYNTH_CLASSES[c].durationMs));

export interface FixtureInfo {
  labels: string[];
  sampleRate: number;
  durationMs: number;
}

function teachingSet(sampleRate: number): Recording[] {
  return WEB_TEST_LABELS.map((cls, ci) => {
    const hits = Array.from({ length: TRAIN_PER_CLASS }, (_, i) => ({ atMs: LEAD_MS + i * TRAIN_SPACING_MS, cls, gainDb: TRAIN_GAIN_DB }));
    const samples = makeSignal({
      sampleRate,
      totalMs: LEAD_MS + TRAIN_PER_CLASS * TRAIN_SPACING_MS + TRAIL_MS,
      hits,
      seed: TEACH_SEED_BASE + ci * SEED_STEP,
      noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS,
    });
    return { label: cls, file: `${cls}-01.wav`, samples, sampleRate };
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
  const { model } = teachFromRecordings(teachingSet(WEB_TEST_SAMPLE_RATE_HZ));
  const { model: mismatchModel } = teachFromRecordings(teachingSet(WEB_TEST_MISMATCH_SAMPLE_RATE_HZ));
  const { samples, durationMs } = testSignal();
  await mkdir(GENERATED_DIR, { recursive: true });
  await writeWavFile(FIXTURE_WAV_PATH, samples, WEB_TEST_SAMPLE_RATE_HZ);
  await writeFile(FIXTURE_MODEL_PATH, JSON.stringify(model));
  await writeFile(FIXTURE_MISMATCH_MODEL_PATH, JSON.stringify(mismatchModel));
  const info: FixtureInfo = { labels: [...WEB_TEST_LABELS], sampleRate: WEB_TEST_SAMPLE_RATE_HZ, durationMs };
  await writeFile(FIXTURE_LABELS_PATH, JSON.stringify(info));
  const written = await readWavFile(FIXTURE_WAV_PATH);
  checkFixture(model, written.samples, written.sampleRate);
  return info;
}

export interface TeachFixtureInfo { phaseDurationMs: number; teachDurationMs: number; teachFewDurationMs: number; tapDurationMs: number; sampleRate: number }

function teachSignal(copies: number, seed: number): { samples: Float32Array; durationMs: number } {
  const durationMs = WEB_TEST_TEACH_LEAD_MS + copies * SYNTH_FIXTURE_SOUNDS_SPACING_MS + SYNTH_FIXTURE_TAIL_MS;
  const hits = Array.from({ length: copies }, (_, i) => ({ atMs: WEB_TEST_TEACH_LEAD_MS + i * SYNTH_FIXTURE_SOUNDS_SPACING_MS, cls: WEB_TEST_TAP_CLASS, gainDb: WEB_TEST_GAIN_DB }));
  return { samples: makeSignal({ sampleRate: WEB_TEST_SAMPLE_RATE_HZ, totalMs: durationMs, hits, seed, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS }), durationMs };
}

function tapSignal(): { samples: Float32Array; durationMs: number } {
  const durationMs = WEB_TEST_LEAD_MS + WEB_TEST_TAP_COPIES * WEB_TEST_IMPACT_SPACING_MS + SYNTH_FIXTURE_TAIL_MS;
  const hits = Array.from({ length: WEB_TEST_TAP_COPIES }, (_, i) => ({ atMs: WEB_TEST_LEAD_MS + i * WEB_TEST_IMPACT_SPACING_MS, cls: WEB_TEST_TAP_CLASS, gainDb: WEB_TEST_GAIN_DB }));
  return { samples: makeSignal({ sampleRate: WEB_TEST_SAMPLE_RATE_HZ, totalMs: durationMs, hits, seed: TAP_SEED, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS }), durationMs };
}

// The Node Segmenter must find exactly `copies` segments in a teaching file. If it does not, the browser tests
// cannot count their examples, and the cause (a merge or a split of the synthetic impacts) must be looked at first.
export function checkTeachSegments(samples: Float32Array, copies: number): void {
  const s = new Segmenter(WEB_TEST_SAMPLE_RATE_HZ);
  const found = [...s.push(samples), ...s.flush()];
  if (found.length !== copies) {
    throw new Error(
      `The teaching file has ${copies} impacts, but the Segmenter found ${found.length} segments, at ${found.map((x) => x.t.toFixed(3)).join(', ')} s.`,
    );
  }
}

function phaseSignal(): { samples: Float32Array; durationMs: number } {
  const durationMs = WEB_TEST_PHASE_AFTER_AT_MS + WEB_TEST_PHASE_AFTER_COPIES * WEB_TEST_IMPACT_SPACING_MS + SYNTH_FIXTURE_TAIL_MS;
  const starts = [
    ...Array.from({ length: WEB_TEST_PHASE_BEFORE_COPIES }, (_, i) => WEB_TEST_LEAD_MS + i * WEB_TEST_IMPACT_SPACING_MS),
    ...Array.from({ length: WEB_TEST_PHASE_AFTER_COPIES }, (_, i) => WEB_TEST_PHASE_AFTER_AT_MS + i * WEB_TEST_IMPACT_SPACING_MS),
  ];
  const hits = starts.map((atMs) => ({ atMs, cls: WEB_TEST_TAP_CLASS, gainDb: WEB_TEST_GAIN_DB }));
  return { samples: makeSignal({ sampleRate: WEB_TEST_SAMPLE_RATE_HZ, totalMs: durationMs, hits, seed: PHASE_SEED, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS }), durationMs };
}

export async function generateTeachFixtures(): Promise<TeachFixtureInfo> {
  const base = teachingSet(WEB_TEST_SAMPLE_RATE_HZ).filter((r) => r.label === 'low' || r.label === 'mid');
  const { model } = teachFromRecordings(base);
  const teach = teachSignal(WEB_TEST_TEACH_COPIES, TEACH_SEED);
  const few = teachSignal(WEB_TEST_TEACH_FEW_COPIES, TEACH_SEED);
  const tap = tapSignal();
  const phase = phaseSignal();
  checkTeachSegments(teach.samples, WEB_TEST_TEACH_COPIES);
  await writeFile(FIXTURE_TEACH_BASE_MODEL_PATH, JSON.stringify(model));
  await writeFile(FIXTURE_TEACH_PITCH_MODEL_PATH, JSON.stringify({ ...model, pitch: { baselineHz: WEB_TEST_PITCH_BASELINE_HZ } }));
  await writeWavFile(FIXTURE_TEACH_WAV_PATH, teach.samples, WEB_TEST_SAMPLE_RATE_HZ);
  await writeWavFile(FIXTURE_TEACH_FEW_WAV_PATH, few.samples, WEB_TEST_SAMPLE_RATE_HZ);
  await writeWavFile(FIXTURE_PHASE_WAV_PATH, phase.samples, WEB_TEST_SAMPLE_RATE_HZ);
  await writeWavFile(FIXTURE_TAP_WAV_PATH, tap.samples, WEB_TEST_SAMPLE_RATE_HZ);
  const info: TeachFixtureInfo = { phaseDurationMs: phase.durationMs, teachDurationMs: teach.durationMs, teachFewDurationMs: few.durationMs, tapDurationMs: tap.durationMs, sampleRate: WEB_TEST_SAMPLE_RATE_HZ };
  await writeFile(FIXTURE_TEACH_INFO_PATH, JSON.stringify(info));
  return info;
}