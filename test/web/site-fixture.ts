// Task 35 run B: the fixture of the demo box browser tests on the new site. Two WAV files for Chrome's fake microphone (it
// plays the file once from the moment the stream opens), a JSON of the stream time of every part, and the text of a stored
// model for a returning visitor.
//
// - site-first.wav: the first visit. Five claps for the teach dialog, speech-like noise for the room dialog (10 s are
//   recorded), then `clap clap` once the box is listening.
// - site-play.wav: a returning visitor with the stored model. `clap clap`, then `clap clap clap`.
//
// The claps are STAND-INS made by core/synth (the class `mid`, the same recipe as the slide deck fixture), not recordings.
// They show the wiring of the box. They do not show how well Tokk recognises a real clap.
// Nothing here is committed (the folder is git-ignored) and nothing here sends anything anywhere.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyModel } from '../../core/classify/knn';
import { SYNTH_FIXTURE_LEAD_NOISE_DBFS } from '../../core/constants';
import { createEngine } from '../../core/engine';
import { place } from '../../core/synth';
import { retrainLabel } from '../../core/teach';
import type { Recording } from '../../core/teach';
import type { MatchEvent, SoundModel } from '../../core/types';
import { readWavFile, writeWavFile } from '../../node/files';
import { makeSignal } from '../helpers/engine-fixture';
import type { Hit } from '../helpers/engine-fixture';
import { CLAP_CLASS, CLAP_GAIN_DB, CLAP_PATTERN_GAP_MS, CLAP_SAMPLE_RATE_HZ } from '../helpers/slides-claps';
import { speechLikeNoise } from './hands-free-fixture';
import { checkTeachSegments, WEB_TEST_IMPACT_SPACING_MS, WEB_TEST_TEACH_LEAD_MS } from './fixture';
import { storedEntry } from './shoo-fixture';
import { FIXTURE_SITE_FIRST_WAV_PATH, FIXTURE_SITE_PLAY_WAV_PATH, FIXTURE_SITE_STORED_PATH, FIXTURE_SITE_TIMES_PATH } from './paths';

const MS_PER_SECOND = 1000;
const PATTERNS = ['clap clap', 'clap clap clap'];

// Test-only values. Times are stream times in ms from the moment the microphone opens.
export const SITE_TEACH_COUNT = 5;                    // the box asks for 5 claps
export const SITE_ROOM_NOISE_AT_MS = 13000;           // after the claps, Done, Save and the quiet second of the room dialog
export const SITE_ROOM_NOISE_MS = 14000;              // longer than the 10000 ms the dialog records
export const SITE_FIRST_CLAPS_AT_MS = 34000;          // the dialog is saved and closed and the new engine has calibrated by now
export const SITE_PLAY_TWO_AT_MS = 6000;
export const SITE_PLAY_THREE_AT_MS = 11000;
export const SITE_TAIL_MS = 6000;
const SITE_LAST_RESULT_MS = 4000;                      // a pattern waits this long at most to know that no third clap follows
const MODEL_TEACH_COPIES = 10;
const MODEL_ROOM_NOISE_MS = 13000;
const MODEL_ROOM_NOISE_AT_MS = 1000;
const CUT_AFTER_MS = 1500;
const SPEECH_RMS_DBFS = -35;
const SEED_FIRST = 35400;
const SEED_PLAY = 35500;
const SEED_MODEL = 35600;
const SEED_SPEECH = 35700;
const MATCH_WINDOW_MS = 1500;
const PRESENCE_WINDOW_MS = 40;
const PRESENCE_MIN_DB = 12;
const DB_POWER_DIVISOR = 10;

export interface SiteTimes {
  sampleRate: number;
  first: { durationMs: number; teachStartsMs: number[]; teachEndMs: number; clapsMs: number[] };
  play: { durationMs: number; twoMs: number[]; threeMs: number[] };
}

const toSamples = (ms: number): number => Math.round((ms * CLAP_SAMPLE_RATE_HZ) / MS_PER_SECOND);
const onGrid = (ms: number): number => (toSamples(ms) * MS_PER_SECOND) / CLAP_SAMPLE_RATE_HZ;
const slice = (x: Float32Array, fromMs: number, toMs: number): Float32Array => x.slice(toSamples(Math.max(0, fromMs)), toSamples(toMs));
const rmsDb = (x: Float32Array): number => {
  let s = 0;
  for (const v of x) s += v * v;
  return DB_POWER_DIVISOR * Math.log10(s / Math.max(1, x.length) + Number.MIN_VALUE);
};
const group = (atMs: number, n: number): number[] => Array.from({ length: n }, (_, i) => onGrid(atMs + i * CLAP_PATTERN_GAP_MS));
const clapAt = (atMs: number): Hit => ({ atMs, cls: CLAP_CLASS, gainDb: CLAP_GAIN_DB });

export function siteTimes(): SiteTimes {
  const teachStartsMs = Array.from({ length: SITE_TEACH_COUNT }, (_, i) => onGrid(WEB_TEST_TEACH_LEAD_MS + i * WEB_TEST_IMPACT_SPACING_MS));
  const clapsMs = group(SITE_FIRST_CLAPS_AT_MS, 2);
  const twoMs = group(SITE_PLAY_TWO_AT_MS, 2);
  const threeMs = group(SITE_PLAY_THREE_AT_MS, 3);
  return {
    sampleRate: CLAP_SAMPLE_RATE_HZ,
    first: { durationMs: onGrid(clapsMs[1] + SITE_LAST_RESULT_MS + SITE_TAIL_MS), teachStartsMs, teachEndMs: onGrid(teachStartsMs[SITE_TEACH_COUNT - 1] + CUT_AFTER_MS), clapsMs },
    play: { durationMs: onGrid(threeMs[2] + SITE_LAST_RESULT_MS + SITE_TAIL_MS), twoMs, threeMs },
  };
}

const signal = (durationMs: number, hits: Hit[], seed: number): Float32Array =>
  makeSignal({ sampleRate: CLAP_SAMPLE_RATE_HZ, totalMs: durationMs, hits, seed, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS });

export function firstSignal(t: SiteTimes): Float32Array {
  const out = signal(t.first.durationMs, [...t.first.teachStartsMs, ...t.first.clapsMs].map(clapAt), SEED_FIRST);
  const speech = place([{ atMs: SITE_ROOM_NOISE_AT_MS, samples: speechLikeNoise(SITE_ROOM_NOISE_MS, SEED_SPEECH, SPEECH_RMS_DBFS, t.sampleRate) }], t.first.durationMs, t.sampleRate);
  for (let i = 0; i < out.length; i++) out[i] += speech[i];
  return out;
}

export function playSignal(t: SiteTimes): Float32Array {
  return signal(t.play.durationMs, [...t.play.twoMs, ...t.play.threeMs].map(clapAt), SEED_PLAY);
}

// The stored model of a returning visitor, made the way the dialogs make it: retrainLabel for the clap, then the background.
export function siteModel(t: SiteTimes): SoundModel {
  const sr = t.sampleRate;
  const rec = (label: string, samples: Float32Array): Recording => ({ label, file: `${label}.wav`, samples, sampleRate: sr });
  const starts = Array.from({ length: MODEL_TEACH_COPIES }, (_, i) => onGrid(WEB_TEST_TEACH_LEAD_MS + i * WEB_TEST_IMPACT_SPACING_MS));
  const clap = signal(starts[starts.length - 1] + CUT_AFTER_MS, starts.map(clapAt), SEED_MODEL);
  const model = retrainLabel(emptyModel(sr), 'clap', [rec('clap', clap)]).model;
  const room = place([{ atMs: MODEL_ROOM_NOISE_AT_MS, samples: speechLikeNoise(MODEL_ROOM_NOISE_MS, SEED_SPEECH + 1, SPEECH_RMS_DBFS, sr) }], MODEL_ROOM_NOISE_MS + CUT_AFTER_MS, sr);
  return retrainLabel(model, 'background', [rec('background', room)]).model;
}

// Runs a stream through the engine with both patterns. Times are stream times in ms.
function runPatterns(samples: Float32Array, t: SiteTimes, model: SoundModel, fromMs = 0): { pattern: string; atMs: number }[] {
  const found: { pattern: string; atMs: number }[] = [];
  const on = Object.fromEntries(PATTERNS.map((p) => [p, (m: MatchEvent) => found.push({ pattern: p, atMs: fromMs + m.t * MS_PER_SECOND })]));
  const engine = createEngine({ sounds: model, sampleRate: t.sampleRate, modes: { live: on }, mode: 'live' });
  engine.push(samples.slice(toSamples(fromMs)));
  engine.flush();
  return found;
}

// Throws with the name of the part that fails.
export function checkSiteFixture(first: Float32Array, play: Float32Array, t: SiteTimes, model: SoundModel): void {
  // 1. The teaching part holds exactly five segments, as the dialog counts them.
  checkTeachSegments(slice(first, 0, t.first.teachEndMs + CUT_AFTER_MS), SITE_TEACH_COUNT);
  // 2. The stored model hears the play stream: clap clap, then clap clap clap, nothing else.
  const heard = runPatterns(play, t, model);
  const near = (h: { atMs: number } | undefined, atMs: number): boolean => h !== undefined && Math.abs(h.atMs - atMs) < MATCH_WINDOW_MS;
  if (heard.length !== 2 || heard[0].pattern !== 'clap clap' || !near(heard[0], t.play.twoMs[1]) || heard[1].pattern !== 'clap clap clap' || !near(heard[1], t.play.threeMs[2])) {
    throw new Error(`Site fixture, play stream: expected clap clap, clap clap clap but the Node engine gave ${heard.map((h) => `${h.pattern}@${h.atMs.toFixed(0)}`).join(', ') || 'nothing'}.`);
  }
  // 3. The same model on the final part of the first stream: the claps after the room sound.
  const last = runPatterns(first, t, model, t.first.clapsMs[0] - CUT_AFTER_MS);
  if (last.length !== 1 || last[0].pattern !== 'clap clap' || !near(last[0], t.first.clapsMs[1])) {
    throw new Error(`Site fixture, first stream: expected clap clap at the end but the Node engine gave ${last.map((h) => `${h.pattern}@${h.atMs.toFixed(0)}`).join(', ') || 'nothing'}.`);
  }
}

// The times of the JSON match the written files: every clap is heard where the JSON says.
export function checkSiteTimes(first: Float32Array, play: Float32Array, t: SiteTimes): void {
  const starts: [Float32Array, string, number][] = [
    ...t.first.teachStartsMs.map((ms, i): [Float32Array, string, number] => [first, `teaching clap ${i + 1}`, ms]),
    ...t.first.clapsMs.map((ms, i): [Float32Array, string, number] => [first, `first clap ${i + 1}`, ms]),
    ...t.play.twoMs.map((ms, i): [Float32Array, string, number] => [play, `play two ${i + 1}`, ms]),
    ...t.play.threeMs.map((ms, i): [Float32Array, string, number] => [play, `play three ${i + 1}`, ms]),
  ];
  for (const [x, name, atMs] of starts) {
    const after = rmsDb(slice(x, atMs, atMs + PRESENCE_WINDOW_MS));
    const before = rmsDb(slice(x, atMs - PRESENCE_WINDOW_MS, atMs));
    if (after - before < PRESENCE_MIN_DB) throw new Error(`The part "${name}" is not heard at ${atMs} ms in the written file (${after.toFixed(1)} dB after, ${before.toFixed(1)} dB before).`);
  }
}

export async function generateSiteFixture(): Promise<SiteTimes> {
  const t = siteTimes();
  const first = firstSignal(t);
  const play = playSignal(t);
  const model = siteModel(t);
  checkSiteFixture(first, play, t, model);
  await mkdir(dirname(FIXTURE_SITE_FIRST_WAV_PATH), { recursive: true });
  await writeWavFile(FIXTURE_SITE_FIRST_WAV_PATH, first, t.sampleRate);
  await writeWavFile(FIXTURE_SITE_PLAY_WAV_PATH, play, t.sampleRate);
  await writeFile(FIXTURE_SITE_TIMES_PATH, JSON.stringify(t));
  await writeFile(FIXTURE_SITE_STORED_PATH, storedEntry(model));
  const backFirst = await readWavFile(FIXTURE_SITE_FIRST_WAV_PATH);
  const backPlay = await readWavFile(FIXTURE_SITE_PLAY_WAV_PATH);
  checkSiteTimes(backFirst.samples, backPlay.samples, t);
  return t;
}
