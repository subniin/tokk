// Task 23: the fixture of the Knock Once for Yes browser tests. One WAV for Chrome's fake microphone and a JSON of the
// stream time of every part. Chrome plays the file once from the moment the stream opens, and the test drives the first-run
// teaching dialog and the game against it, so the quiet gaps between the parts are longer than the slowest handling.
//
// The knock is a STAND-IN made by core/synth, not a recording: an impact of the class `mid` (a short, dull, band-limited
// thump with a fast decay), each copy with its own seed, the second knock of a quick pair 3 dB quieter. It shows the logic
// and the wiring of the app (modes, answers, the paused microphone, captions, the story). It does not show how well Tokk
// recognises a real knock on a real table (design.md "Why this stand-in is fair").
// Nothing here is committed (the folder is git-ignored) and nothing here sends anything anywhere.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyModel } from '../../core/classify/knn';
import { SYNTH_CLASSES } from '../../core/synth';
import { SYNTH_FIXTURE_LEAD_NOISE_DBFS } from '../../core/constants';
import { createEngine } from '../../core/engine';
import type { Handlers } from '../../core/engine';
import { retrainLabel } from '../../core/teach';
import type { MatchEvent, SoundModel } from '../../core/types';
import { readWavFile, writeWavFile } from '../../node/files';
import { makeSignal } from '../helpers/engine-fixture';
import type { Hit, ImpactName } from '../helpers/engine-fixture';
import { checkTeachSegments, WEB_TEST_GAIN_DB, WEB_TEST_IMPACT_SPACING_MS, WEB_TEST_SAMPLE_RATE_HZ, WEB_TEST_TEACH_COPIES, WEB_TEST_TEACH_LEAD_MS } from './fixture';
import { FIXTURE_KNOCK_ONCE_TIMES_PATH, FIXTURE_KNOCK_ONCE_WAV_PATH } from './paths';

// The patterns of the app, written out so that the generator does not depend on the app (U2 proves that bindings.ts holds
// the same lists).
const PATTERNS_START = ['knock knock _ knock'];
const PATTERNS_QUESTION = ['knock', 'knock knock'];
const LABEL = 'knock';

// Test-only values. The gaps are the first values of design.md "The fixture and the timeline"; step 10.1 measures the
// handling times and records them.
const MS_PER_SECOND = 1000;
export const KNOCK_CLASS: ImpactName = 'mid';
export const KNOCK_ONCE_GAP_A_MS = 12000;            // after the last teaching knock: Done, training, Save, Close, the new engine's calibration
export const KNOCK_ONCE_GAP_B_MS = 8000;             // after the lone knock: its single-knock sequence times out
export const KNOCK_ONCE_GAP_C_MS = 8000;             // after the third summon knock: the match, the effect, the first question, resume
export const KNOCK_ONCE_GAP_D_MS = 8000;             // after the decoy: the effect, the next question, resume
export const KNOCK_ONCE_TAIL_MS = 6000;              // the last captions and the screenshot
export const KNOCK_GAP_CONSECUTIVE_MS = 250;         // inside a pattern: less than the 350 ms of a consecutive gap
export const KNOCK_GAP_REST_MS = 600;                // a rest: 350 to 1000 ms
export const KNOCK_DECOY_AFTER_YES_MS = 900;         // inside the paused window of the effect after yes
export const KNOCK_PAIR_SECOND_GAIN_DB = -3;         // the second knock of a quick pair is quieter
const KNOCK_SEED = 71000;
const KNOCK_LENGTH_MS = SYNTH_CLASSES[KNOCK_CLASS].durationMs;
const PRESENCE_WINDOW_MS = 40;                       // a knock must be heard in the window after its start
const PRESENCE_MIN_DB = 12;                          // louder than the window before it by this much
const CUT_AFTER_MS = 1500;                           // the Node recording of the dialog ends this long after the last knock
const MATCH_WINDOW_MS = 1500;                        // a match arrives within this time after the knock it belongs to
const ONSET_ALLOWANCE_MS = 20;                       // an onset is dated a few ms before the knock starts (ONSET_LEAD_MS)
const NODE_START_FROM_MS = 2000;                     // the Node run of the game starts this long after the last teaching knock
const DB_POWER_DIVISOR = 10;

export interface KnockOnceTimes {
  sampleRate: number;
  durationMs: number;
  teach: { startsMs: number[]; endMs: number };
  lone: number;
  summon: number[];
  yes: number;
  decoy: number;
  no: number[];
}

const toSamples = (ms: number): number => Math.round((ms * WEB_TEST_SAMPLE_RATE_HZ) / MS_PER_SECOND);
const onGrid = (ms: number): number => (toSamples(ms) * MS_PER_SECOND) / WEB_TEST_SAMPLE_RATE_HZ;
const rmsDb = (x: Float32Array): number => {
  let s = 0;
  for (const v of x) s += v * v;
  return DB_POWER_DIVISOR * Math.log10(s / Math.max(1, x.length) + Number.MIN_VALUE);
};
const slice = (x: Float32Array, fromMs: number, toMs: number): Float32Array => x.slice(toSamples(Math.max(0, fromMs)), toSamples(toMs));

// The timeline: every time is built from the named constants and lies on the sample grid.
export function knockOnceTimes(): KnockOnceTimes {
  const teach = Array.from({ length: WEB_TEST_TEACH_COPIES }, (_, i) => onGrid(WEB_TEST_TEACH_LEAD_MS + i * WEB_TEST_IMPACT_SPACING_MS));
  const lastTeach = teach[teach.length - 1];
  const lone = onGrid(lastTeach + KNOCK_ONCE_GAP_A_MS);
  const s0 = onGrid(lone + KNOCK_ONCE_GAP_B_MS);
  const summon = [s0, onGrid(s0 + KNOCK_GAP_CONSECUTIVE_MS), onGrid(s0 + KNOCK_GAP_CONSECUTIVE_MS + KNOCK_GAP_REST_MS)];
  const yes = onGrid(summon[2] + KNOCK_ONCE_GAP_C_MS);
  const decoy = onGrid(yes + KNOCK_DECOY_AFTER_YES_MS);
  const n0 = onGrid(decoy + KNOCK_ONCE_GAP_D_MS);
  const no = [n0, onGrid(n0 + KNOCK_GAP_CONSECUTIVE_MS)];
  return {
    sampleRate: WEB_TEST_SAMPLE_RATE_HZ,
    durationMs: onGrid(no[1] + KNOCK_LENGTH_MS + KNOCK_ONCE_TAIL_MS),
    teach: { startsMs: teach, endMs: onGrid(lastTeach + KNOCK_LENGTH_MS) },
    lone, summon, yes, decoy, no,
  };
}

export function knockOnceSignal(times: KnockOnceTimes): Float32Array {
  const plain = [...times.teach.startsMs, times.lone, ...times.summon, times.yes, times.decoy, times.no[0]];
  const hits: Hit[] = [
    ...plain.map((atMs) => ({ atMs, cls: KNOCK_CLASS, gainDb: WEB_TEST_GAIN_DB })),
    { atMs: times.no[1], cls: KNOCK_CLASS, gainDb: WEB_TEST_GAIN_DB + KNOCK_PAIR_SECOND_GAIN_DB },
  ].sort((a, b) => a.atMs - b.atMs);
  return makeSignal({ sampleRate: times.sampleRate, totalMs: times.durationMs, hits, seed: KNOCK_SEED, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS });
}

// The model of the first run, made the way the dialog makes it: retrainLabel for knock from the teaching part.
export function knockOnceModel(samples: Float32Array, times: KnockOnceTimes): SoundModel {
  const rec = { label: LABEL, file: 'knock-once.wav', samples: slice(samples, 0, times.teach.endMs + CUT_AFTER_MS), sampleRate: times.sampleRate };
  return retrainLabel(emptyModel(times.sampleRate), LABEL, [rec]).model;
}

interface Heard { pattern: string; atMs: number }

// Runs the stream from fromMs on through the engine with the given modes. Times are stream times.
function runModes(samples: Float32Array, times: KnockOnceTimes, model: SoundModel, fromMs: number, modes: Record<string, string[]>, mode: string): Heard[] {
  const found: Heard[] = [];
  const handlersFor = (patterns: string[]): Handlers => Object.fromEntries(
    patterns.map((p) => [p, (m: MatchEvent) => found.push({ pattern: p, atMs: fromMs + m.t * MS_PER_SECOND })]),
  );
  const engine = createEngine({
    sounds: model, sampleRate: times.sampleRate, mode,
    modes: Object.fromEntries(Object.entries(modes).map(([name, patterns]) => [name, handlersFor(patterns)])),
  });
  engine.push(samples.slice(toSamples(fromMs)));
  engine.flush();
  return found;
}

// Which part a match belongs to, by its stream time (m.t is the start of the last knock of the pattern).
function partOf(times: KnockOnceTimes, atMs: number): string {
  const parts: [string, number][] = [
    ['lone', times.lone], ...times.summon.map((t, i): [string, number] => [`summon${i + 1}`, t]), ['yes', times.yes], ['decoy', times.decoy],
    ...times.no.map((t, i): [string, number] => [`no${i + 1}`, t]),
  ];
  const before = parts.filter(([, t]) => t <= atMs + ONSET_ALLOWANCE_MS && atMs - t <= MATCH_WINDOW_MS);
  const hit = before.sort((a, b) => b[1] - a[1])[0];   // the latest knock at or before the match time
  return hit?.[0] ?? `outside(${atMs.toFixed(0)} ms)`;
}
const summary = (found: Heard[], times: KnockOnceTimes): string[] => found.map((h) => `${h.pattern}@${partOf(times, h.atMs)}`);

// The three checks of design.md "Node check of the fixture". Throws with the name of the part that fails.
export function checkKnockOnceFixture(samples: Float32Array, times: KnockOnceTimes): void {
  // 1. The teaching part holds exactly ten segments, as the dialog counts them.
  checkTeachSegments(slice(samples, 0, times.teach.endMs + CUT_AFTER_MS), WEB_TEST_TEACH_COPIES);

  // 2. The model of the dialog and the app's modes recognise the game. In question mode the decoy is heard too: an engine
  // that is not paused would answer with it, so its absence in the browser proves the pause.
  const model = knockOnceModel(samples, times);
  const appModes = { start: PATTERNS_START, question: PATTERNS_QUESTION };
  const startFrom = times.teach.startsMs[times.teach.startsMs.length - 1] + NODE_START_FROM_MS;
  const start = summary(runModes(slice(samples, 0, times.yes - MATCH_WINDOW_MS), times, model, 0, appModes, 'start').filter((h) => h.atMs >= startFrom), times);
  const expectedStart = ['knock knock _ knock@summon3'];
  if (JSON.stringify(start) !== JSON.stringify(expectedStart)) {
    throw new Error(`Knock Once fixture, mode start: expected ${expectedStart.join(', ')} but the Node engine gave ${start.join(', ') || 'nothing'} (the lone knock must give nothing).`);
  }
  const questionFrom = times.summon[2] + MATCH_WINDOW_MS;
  const question = summary(runModes(samples, times, model, questionFrom, appModes, 'question'), times);
  const expectedQuestion = ['knock@yes', 'knock@decoy', 'knock knock@no2'];
  if (JSON.stringify(question) !== JSON.stringify(expectedQuestion)) {
    throw new Error(`Knock Once fixture, mode question: expected ${expectedQuestion.join(', ')} but the Node engine gave ${question.join(', ') || 'nothing'} (the decoy must be heard by an engine that is not paused).`);
  }
  const allInOne = summary(runModes(samples, times, model, questionFrom, { all: [...PATTERNS_START, ...PATTERNS_QUESTION] }, 'all'), times);
  if (JSON.stringify(allInOne) !== JSON.stringify(expectedQuestion)) {
    throw new Error(`Knock Once fixture, all three patterns in one mode: expected ${expectedQuestion.join(', ')} but got ${allInOne.join(', ') || 'nothing'}.`);
  }
}

// 3. The times of the JSON match the written file: its length, and every knock is heard where the JSON says.
export function checkKnockOnceTimes(written: Float32Array, writtenRate: number, times: KnockOnceTimes): void {
  const expectedSamples = toSamples(times.durationMs);
  if (writtenRate !== times.sampleRate || Math.abs(written.length - expectedSamples) > 1) {
    throw new Error(`The written file has ${written.length} samples at ${writtenRate} Hz, the times say ${expectedSamples} samples at ${times.sampleRate} Hz.`);
  }
  const starts: [string, number][] = [
    ...times.teach.startsMs.map((t, i): [string, number] => [`teaching knock ${i + 1}`, t]), ['lone knock', times.lone],
    ...times.summon.map((t, i): [string, number] => [`summon knock ${i + 1}`, t]), ['yes knock', times.yes], ['decoy knock', times.decoy],
    ...times.no.map((t, i): [string, number] => [`no knock ${i + 1}`, t]),
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
export async function generateKnockOnceFixture(): Promise<KnockOnceTimes> {
  const times = knockOnceTimes();
  const samples = knockOnceSignal(times);
  checkKnockOnceFixture(samples, times);
  await mkdir(dirname(FIXTURE_KNOCK_ONCE_WAV_PATH), { recursive: true });
  await writeWavFile(FIXTURE_KNOCK_ONCE_WAV_PATH, samples, times.sampleRate);
  await writeFile(FIXTURE_KNOCK_ONCE_TIMES_PATH, JSON.stringify(times));
  const back = await readWavFile(FIXTURE_KNOCK_ONCE_WAV_PATH);
  checkKnockOnceTimes(back.samples, back.sampleRate, times);
  return times;
}
