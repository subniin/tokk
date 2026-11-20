// Task 22: the fixture of the Hands-Free browser tests. One WAV for Chrome's fake microphone and a JSON of the stream
// time of every part. Chrome plays the file once from the moment the stream opens, and the test drives the first-run
// teaching (three dialogs) against it, so the quiet gaps between the parts are longer than the slowest handling.
//
// The sounds are STAND-INS made by core/synth, not recordings: an impact of the class `high` for the tongue click, a
// harmonic tone with vibrato for the hum, and pink noise with a syllable-rate envelope for the speech-like background.
// They show the logic and the wiring of the app. They do not show how well Tokk recognises a real mouth.
// Nothing here is committed (the folder is git-ignored) and nothing here sends anything anywhere.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyModel } from '../../core/classify/knn';
import { SYNTH_FIXTURE_LEAD_NOISE_DBFS } from '../../core/constants';
import { medianPitchHz } from '../../core/continuous/pitch';
import { createEngine } from '../../core/engine';
import type { Handlers } from '../../core/engine';
import { place, rng, synthNoise, synthTone } from '../../core/synth';
import { retrainLabel } from '../../core/teach';
import type { Recording } from '../../core/teach';
import type { MatchEvent, SoundModel } from '../../core/types';
import { readWavFile, writeWavFile } from '../../node/files';
import { makeSignal } from '../helpers/engine-fixture';
import type { Hit } from '../helpers/engine-fixture';
import {
  checkTeachSegments, WEB_TEST_GAIN_DB, WEB_TEST_HUM_BASELINE_HZ, WEB_TEST_IMPACT_SPACING_MS, WEB_TEST_SAMPLE_RATE_HZ, WEB_TEST_TEACH_COPIES,
  WEB_TEST_TEACH_LEAD_MS,
} from './fixture';
import { FIXTURE_HANDS_FREE_TIMES_PATH, FIXTURE_HANDS_FREE_WAV_PATH } from './paths';

// The patterns of the app, written out so that the generator does not depend on the app (test U2 proves that bindings.ts
// holds the same lists).
const PATTERNS_ON = ['click', 'click click', 'click click click', 'hum.rise', 'hum.fall'];
const PATTERNS_OFF = ['click click click'];

// Test-only values. The gaps are the first values of design.md "The fixture and the timeline"; step 6.2 of the tasks
// measures the handling times and sets them with a factor of 2 or more.
const MS_PER_SECOND = 1000;
export const HANDS_FREE_GAP_A_MS = 12000;            // after the last teaching click: Done, training, Save, the hum dialog opens
export const HANDS_FREE_GAP_B_MS = 12000;            // after the teaching hum: the same, the background dialog opens
export const HANDS_FREE_GAP_C_MS = 14000;            // after the background: Done, training, Save, the new engine's calibration, the keyboard step, the arrangement
export const HANDS_FREE_HUM_TEACH_MS = 4000;         // longer than the dialog's 2000 ms minimum
export const HANDS_FREE_BACKGROUND_TEACH_MS = 13000; // longer than the dialog's 10000 ms minimum
export const HANDS_FREE_TEST_GAP_MS = 8000;          // quiet before each group of test sounds
export const HANDS_FREE_STEADY_HUM_MS = 2000;
export const HANDS_FREE_STEADY_TO_FALL_QUIET_MS = 3000;
export const HANDS_FREE_FALL_HUM_MS = 3000;
export const HANDS_FREE_PROBE_MS = 3000;             // the speech-like probe sound
export const HANDS_FREE_TAIL_MS = 6000;
export const HANDS_FREE_CLICK_GAP_MS = 250;          // inside a pattern: less than the 350 ms of a consecutive gap
export const HANDS_FREE_HUM_VIBRATO_CENTS = 50;
export const HANDS_FREE_HUM_GAIN_DB = -12;
export const HANDS_FREE_FALL_SEMITONES = 6;
export const HANDS_FREE_SPEECH_RMS_DBFS = -35;
export const HANDS_FREE_SYLLABLE_RATE_HZ = 4;
export const HANDS_FREE_SPEECH_DEPTH_MIN = 0.6;      // 60 to 100 per cent deep
export const HANDS_FREE_SPEECH_DEPTH_MAX = 1;
export const HANDS_FREE_SPEECH_PAUSE_EVERY_MS = 1000;
export const HANDS_FREE_SPEECH_PAUSE_MIN_MS = 100;
export const HANDS_FREE_SPEECH_PAUSE_MAX_MS = 300;
export const HANDS_FREE_SPEECH_PAUSE_EDGE_MS = 10;
const SEMITONES_PER_OCTAVE = 12;
const CLICK_SEED = 61000;
const SPEECH_TEACH_SEED = 62000;
const SPEECH_PROBE_SEED = 63000;
const CLICK_LENGTH_MS = 75;                          // the `high` impact class is 75 ms long
const PRESENCE_WINDOW_MS = 60;                       // a part must be heard in the window after its start
const PRESENCE_MIN_DB = 12;                          // louder than the window before it by this much
const SETTLE_BEFORE_DIALOG_MS = 1000;                // the dialog's quiet second before a hum or background part
const CUT_AFTER_MS = 1500;                           // a Node recording ends this long after its part (the test presses Done in the gap)
const NODE_CHECK_LEAD_MS = 2000;                     // the Node run of the test part starts this long after the background part ended
const MATCH_WINDOW_MS = 2500;                        // a match of a click pattern arrives within this time after its last click
const DB_AMPLITUDE_DIVISOR = 20;
const DB_POWER_DIVISOR = 10;
const PITCH_TOLERANCE = 0.05;                        // fraction of the baseline

export interface PartTimes { startMs: number; endMs: number }
export interface HandsFreeTimes {
  sampleRate: number;
  durationMs: number;
  clickTeach: { startsMs: number[]; endMs: number };
  humTeach: PartTimes;
  backgroundTeach: PartTimes;
  s1: { atMs: number[] };
  s2Steady: PartTimes;
  s2Falling: PartTimes;
  s3: { atMs: number[] };
  s4: PartTimes;
  s5: { atMs: number[] };
  s6: { atMs: number[] };
  s7: { atMs: number[] };
}

// A time in ms that is a whole number of samples: the sample count divided by the sample rate.
const toSamples = (ms: number): number => Math.round((ms * WEB_TEST_SAMPLE_RATE_HZ) / MS_PER_SECOND);
const onGrid = (ms: number): number => (toSamples(ms) * MS_PER_SECOND) / WEB_TEST_SAMPLE_RATE_HZ;
const rmsDb = (x: Float32Array): number => {
  let s = 0;
  for (const v of x) s += v * v;
  return DB_POWER_DIVISOR * Math.log10(s / Math.max(1, x.length) + Number.MIN_VALUE);
};
const slice = (x: Float32Array, fromMs: number, toMs: number): Float32Array => x.slice(toSamples(Math.max(0, fromMs)), toSamples(toMs));

// Speech-like noise: pink noise, a raised-cosine envelope at the syllable rate (60 to 100 per cent deep, full at the start)
// and a short pause about every second, from a seeded generator, scaled to the requested RMS level.
export function speechLikeNoise(durationMs: number, seed: number, rmsDbfs: number, sampleRate: number): Float32Array {
  const rand = rng(seed);
  const noise = synthNoise('pink', durationMs, rmsDbfs, sampleRate, rng(seed + 1));
  const depth = HANDS_FREE_SPEECH_DEPTH_MIN + rand() * (HANDS_FREE_SPEECH_DEPTH_MAX - HANDS_FREE_SPEECH_DEPTH_MIN);
  const pauses: { startS: number; endS: number }[] = [];
  for (let at = HANDS_FREE_SPEECH_PAUSE_EVERY_MS * (0.5 + rand()); at < durationMs; at += HANDS_FREE_SPEECH_PAUSE_EVERY_MS * (0.8 + 0.4 * rand())) {
    const length = HANDS_FREE_SPEECH_PAUSE_MIN_MS + rand() * (HANDS_FREE_SPEECH_PAUSE_MAX_MS - HANDS_FREE_SPEECH_PAUSE_MIN_MS);
    pauses.push({ startS: at / MS_PER_SECOND, endS: (at + length) / MS_PER_SECOND });
  }
  const edgeS = HANDS_FREE_SPEECH_PAUSE_EDGE_MS / MS_PER_SECOND;
  const out = new Float32Array(noise.length);
  for (let i = 0; i < noise.length; i++) {
    const t = i / sampleRate;
    const syllable = 1 - depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * HANDS_FREE_SYLLABLE_RATE_HZ * t));
    let gate = 1;
    for (const p of pauses) {
      if (t >= p.startS - edgeS && t <= p.endS + edgeS) {
        const fade = Math.min(1, Math.min(t - (p.startS - edgeS), p.endS + edgeS - t) / edgeS);
        gate = Math.min(gate, 1 - fade);
      }
    }
    out[i] = noise[i] * syllable * gate;
  }
  const gain = Math.pow(10, (rmsDbfs - rmsDb(out)) / DB_AMPLITUDE_DIVISOR);
  return out.map((v) => v * gain);
}

// The timeline: every time is built from the named constants and lies on the sample grid.
export function handsFreeTimes(): HandsFreeTimes {
  const clickStarts = Array.from({ length: WEB_TEST_TEACH_COPIES }, (_, i) => onGrid(WEB_TEST_TEACH_LEAD_MS + i * WEB_TEST_IMPACT_SPACING_MS));
  const lastClick = clickStarts[clickStarts.length - 1];
  const humStart = onGrid(lastClick + HANDS_FREE_GAP_A_MS);
  const humEnd = onGrid(humStart + HANDS_FREE_HUM_TEACH_MS);
  const bgStart = onGrid(humEnd + HANDS_FREE_GAP_B_MS);
  const bgEnd = onGrid(bgStart + HANDS_FREE_BACKGROUND_TEACH_MS);
  const s1 = onGrid(bgEnd + HANDS_FREE_GAP_C_MS);
  const steadyStart = onGrid(s1 + HANDS_FREE_TEST_GAP_MS);
  const steadyEnd = onGrid(steadyStart + HANDS_FREE_STEADY_HUM_MS);
  const fallStart = onGrid(steadyEnd + HANDS_FREE_STEADY_TO_FALL_QUIET_MS);
  const fallEnd = onGrid(fallStart + HANDS_FREE_FALL_HUM_MS);
  const s3 = onGrid(fallEnd + HANDS_FREE_TEST_GAP_MS);
  const s4 = onGrid(s3 + HANDS_FREE_TEST_GAP_MS);
  const s5 = onGrid(s4 + HANDS_FREE_TEST_GAP_MS);
  const s6 = onGrid(s5 + HANDS_FREE_TEST_GAP_MS);
  const s7 = onGrid(s6 + HANDS_FREE_TEST_GAP_MS);
  const group = (at: number, n: number): number[] => Array.from({ length: n }, (_, i) => onGrid(at + i * HANDS_FREE_CLICK_GAP_MS));
  const s7Clicks = group(s7, 3);
  return {
    sampleRate: WEB_TEST_SAMPLE_RATE_HZ,
    durationMs: onGrid(s7Clicks[2] + CLICK_LENGTH_MS + HANDS_FREE_TAIL_MS),
    clickTeach: { startsMs: clickStarts, endMs: onGrid(lastClick + CLICK_LENGTH_MS) },
    humTeach: { startMs: humStart, endMs: humEnd },
    backgroundTeach: { startMs: bgStart, endMs: bgEnd },
    s1: { atMs: group(s1, 1) },
    s2Steady: { startMs: steadyStart, endMs: steadyEnd },
    s2Falling: { startMs: fallStart, endMs: fallEnd },
    s3: { atMs: group(s3, 2) },
    s4: { startMs: s4, endMs: onGrid(s4 + HANDS_FREE_PROBE_MS) },
    s5: { atMs: group(s5, 3) },
    s6: { atMs: group(s6, 1) },
    s7: { atMs: s7Clicks },
  };
}

const fallTargetHz = (): number => WEB_TEST_HUM_BASELINE_HZ * Math.pow(2, -HANDS_FREE_FALL_SEMITONES / SEMITONES_PER_OCTAVE);

export function handsFreeSignal(times: HandsFreeTimes): Float32Array {
  const sr = times.sampleRate;
  const clickAt = [...times.clickTeach.startsMs, ...times.s1.atMs, ...times.s3.atMs, ...times.s5.atMs, ...times.s6.atMs, ...times.s7.atMs];
  const hits: Hit[] = clickAt.map((atMs) => ({ atMs, cls: 'high', gainDb: WEB_TEST_GAIN_DB }));
  const out = makeSignal({ sampleRate: sr, totalMs: times.durationMs, hits, seed: CLICK_SEED, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS });
  const hum = (durationMs: number, glideToHz?: number): Float32Array => synthTone(
    { f0Hz: WEB_TEST_HUM_BASELINE_HZ, durationMs, gainDb: HANDS_FREE_HUM_GAIN_DB, vibratoCents: HANDS_FREE_HUM_VIBRATO_CENTS, ...(glideToHz === undefined ? {} : { glideToHz }) }, sr,
  );
  const length = (p: PartTimes): number => p.endMs - p.startMs;
  const parts = place([
    { atMs: times.humTeach.startMs, samples: hum(length(times.humTeach)) },
    { atMs: times.backgroundTeach.startMs, samples: speechLikeNoise(length(times.backgroundTeach), SPEECH_TEACH_SEED, HANDS_FREE_SPEECH_RMS_DBFS, sr) },
    { atMs: times.s2Steady.startMs, samples: hum(length(times.s2Steady)) },
    { atMs: times.s2Falling.startMs, samples: hum(length(times.s2Falling), fallTargetHz()) },
    { atMs: times.s4.startMs, samples: speechLikeNoise(length(times.s4), SPEECH_PROBE_SEED, HANDS_FREE_SPEECH_RMS_DBFS, sr) },
  ], times.durationMs, sr);
  for (let i = 0; i < out.length; i++) out[i] += parts[i];
  return out;
}

// The model of the first run, made the way the dialogs make it: retrainLabel for click, hum and background, in that order.
export function handsFreeModel(samples: Float32Array, times: HandsFreeTimes): SoundModel {
  const sr = times.sampleRate;
  const rec = (label: string, fromMs: number, toMs: number): Recording => ({ label, file: 'hands-free.wav', samples: slice(samples, fromMs, toMs), sampleRate: sr });
  const click = retrainLabel(emptyModel(sr), 'click', [rec('click', 0, times.clickTeach.endMs + CUT_AFTER_MS)]).model;
  const hum = retrainLabel(click, 'hum', [rec('hum', times.humTeach.startMs - SETTLE_BEFORE_DIALOG_MS, times.humTeach.endMs + CUT_AFTER_MS)]).model;
  const bg = times.backgroundTeach;
  return retrainLabel(hum, 'background', [rec('background', bg.startMs - SETTLE_BEFORE_DIALOG_MS, bg.endMs + CUT_AFTER_MS)]).model;
}

interface Heard { pattern: string; atMs: number; speed?: number }

// Runs the test part (from fromMs on) through the engine with the app's patterns in one mode. Times are stream times.
function runApp(samples: Float32Array, times: HandsFreeTimes, model: SoundModel, fromMs: number, mode: 'on' | 'off'): Heard[] {
  const found: Heard[] = [];
  const handlersFor = (patterns: string[]): Handlers => Object.fromEntries(
    patterns.map((p) => [p, (m: MatchEvent) => found.push({ pattern: p, atMs: fromMs + m.t * MS_PER_SECOND, speed: m.speed })]),
  );
  const engine = createEngine({ sounds: model, sampleRate: times.sampleRate, modes: { on: handlersFor(PATTERNS_ON), off: handlersFor(PATTERNS_OFF) }, mode });
  engine.push(samples.slice(toSamples(fromMs)));
  engine.flush();
  return found;
}

// Which group of test sounds a match belongs to, by its stream time. A hum match is dated by the update it fires on.
function groupsOf(times: HandsFreeTimes): { name: string; fromMs: number; toMs: number }[] {
  const after = (atMs: number[], name: string): { name: string; fromMs: number; toMs: number } => ({ name, fromMs: atMs[0] - CLICK_LENGTH_MS, toMs: atMs[atMs.length - 1] + MATCH_WINDOW_MS });
  return [
    after(times.s1.atMs, 's1'),
    { name: 's2-steady', fromMs: times.s2Steady.startMs, toMs: times.s2Steady.endMs + MATCH_WINDOW_MS / 4 },
    { name: 's2-falling', fromMs: times.s2Falling.startMs, toMs: times.s2Falling.endMs + MATCH_WINDOW_MS / 4 },
    after(times.s3.atMs, 's3'),
    { name: 's4', fromMs: times.s4.startMs, toMs: times.s4.endMs + MATCH_WINDOW_MS / 4 },
    after(times.s5.atMs, 's5'),
    after(times.s6.atMs, 's6'),
    after(times.s7.atMs, 's7'),
  ];
}

function summary(found: Heard[], times: HandsFreeTimes): string[] {
  const groups = groupsOf(times);
  const labels = found.map((h) => `${h.pattern}@${groups.find((g) => h.atMs >= g.fromMs && h.atMs <= g.toMs)?.name ?? `outside(${h.atMs.toFixed(0)} ms)`}`);
  return [...new Set(labels)].sort();   // a hum fires once per update: one entry per group; sorted, so the order is not part of the check
}

// The three checks of design.md "Node check of the fixture". Throws with the name of the part that fails.
export function checkHandsFreeFixture(samples: Float32Array, times: HandsFreeTimes): void {
  // 1. The click teaching part holds exactly ten segments, as the dialog counts them.
  checkTeachSegments(slice(samples, 0, times.clickTeach.endMs + CUT_AFTER_MS), WEB_TEST_TEACH_COPIES);
  const humPart = slice(samples, times.humTeach.startMs, times.humTeach.endMs);
  const hz = medianPitchHz(humPart, times.sampleRate);
  if (hz === null || Math.abs(hz - WEB_TEST_HUM_BASELINE_HZ) > WEB_TEST_HUM_BASELINE_HZ * PITCH_TOLERANCE) {
    throw new Error(`The teaching hum gives the pitch ${String(hz)} Hz in Node, expected ${WEB_TEST_HUM_BASELINE_HZ} Hz.`);
  }

  // 2. A model made the way the dialogs make it recognises the test part with the patterns of the app.
  const model = handsFreeModel(samples, times);
  if (model.pitch === undefined) throw new Error('The model of the first run has no hum pitch.');
  const fromMs = times.backgroundTeach.endMs + NODE_CHECK_LEAD_MS;
  const on = summary(runApp(samples, times, model, fromMs, 'on'), times);
  const expectedOn = ['click@s1', 'hum.fall@s2-falling', 'click click@s3', 'click click click@s5', 'click@s6', 'click click click@s7'].sort();
  if (JSON.stringify(on) !== JSON.stringify(expectedOn)) {
    throw new Error(`Hands-Free fixture, mode on: expected ${expectedOn.join(', ')} but the Node engine gave ${on.join(', ') || 'nothing'} (steady hum, speech probe).`);
  }
  const off = summary(runApp(samples, times, model, fromMs, 'off'), times);
  const expectedOff = ['click click click@s5', 'click click click@s7'].sort();
  if (JSON.stringify(off) !== JSON.stringify(expectedOff)) {
    throw new Error(`Hands-Free fixture, mode off: expected ${expectedOff.join(', ')} but the Node engine gave ${off.join(', ') || 'nothing'}.`);
  }
}

// 3. The times of the JSON match the written file: its length, and every part is heard where the JSON says.
export function checkHandsFreeTimes(written: Float32Array, writtenRate: number, times: HandsFreeTimes): void {
  const expectedSamples = toSamples(times.durationMs);
  if (writtenRate !== times.sampleRate || Math.abs(written.length - expectedSamples) > 1) {
    throw new Error(`The written file has ${written.length} samples at ${writtenRate} Hz, the times say ${expectedSamples} samples at ${times.sampleRate} Hz.`);
  }
  const starts: [string, number][] = [
    ...times.clickTeach.startsMs.map((t, i): [string, number] => [`teaching click ${i + 1}`, t]),
    ['teaching hum', times.humTeach.startMs], ['teaching background', times.backgroundTeach.startMs],
    ['s1 click', times.s1.atMs[0]], ['s2 steady hum', times.s2Steady.startMs], ['s2 falling hum', times.s2Falling.startMs],
    ...times.s3.atMs.map((t, i): [string, number] => [`s3 click ${i + 1}`, t]), ['s4 speech probe', times.s4.startMs],
    ...times.s5.atMs.map((t, i): [string, number] => [`s5 click ${i + 1}`, t]), ['s6 click', times.s6.atMs[0]],
    ...times.s7.atMs.map((t, i): [string, number] => [`s7 click ${i + 1}`, t]),
  ];
  for (const [name, atMs] of starts) {
    const after = rmsDb(slice(written, atMs, atMs + PRESENCE_WINDOW_MS));
    const before = rmsDb(slice(written, atMs - PRESENCE_WINDOW_MS, atMs));
    if (after - before < PRESENCE_MIN_DB) {
      throw new Error(`The part "${name}" is not heard at ${atMs} ms in the written file (${after.toFixed(1)} dB after, ${before.toFixed(1)} dB before).`);
    }
  }
}

// Writes the WAV and the JSON of times, reads the WAV back, and runs the checks. Called by the global setup.
export async function generateHandsFreeFixture(): Promise<HandsFreeTimes> {
  const times = handsFreeTimes();
  const samples = handsFreeSignal(times);
  checkHandsFreeFixture(samples, times);
  await mkdir(dirname(FIXTURE_HANDS_FREE_WAV_PATH), { recursive: true });
  await writeWavFile(FIXTURE_HANDS_FREE_WAV_PATH, samples, times.sampleRate);
  await writeFile(FIXTURE_HANDS_FREE_TIMES_PATH, JSON.stringify(times));
  const back = await readWavFile(FIXTURE_HANDS_FREE_WAV_PATH);
  checkHandsFreeTimes(back.samples, back.sampleRate, times);
  return times;
}