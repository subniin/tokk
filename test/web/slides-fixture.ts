// Task 26: the fixture of the slide deck browser tests (E1 to E4, E6). One WAV for Chrome's fake microphone and a JSON of
// the stream time of every part. Chrome plays the file once from the moment the stream opens, and the test drives the
// first-run teaching dialog and the deck against it, so the quiet gaps between the parts are longer than the slowest handling.
//
// The claps are the SYNTHETIC stand-ins of test/helpers/slides-claps.ts (an impact of the class `mid` of core/synth over a
// quiet noise bed). They show the logic and the wiring of the case. They do not show how well Tokk recognises a real clap.
// Nothing here is committed (the folder is git-ignored) and nothing here sends anything anywhere.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyModel } from '../../core/classify/knn';
import { createEngine } from '../../core/engine';
import type { Handlers } from '../../core/engine';
import { retrainLabel } from '../../core/teach';
import type { MatchEvent, SoundModel } from '../../core/types';
import { readWavFile, writeWavFile } from '../../node/files';
import { makeSignal } from '../helpers/engine-fixture';
import type { Hit } from '../helpers/engine-fixture';
import {
  CLAP_CLASS, CLAP_GAIN_DB, CLAP_NOISE_DBFS, CLAP_PATTERN_GAP_MS, CLAP_SAMPLE_RATE_HZ, CLAP_TAIL_MS, CLAP_TEACH_SPACING_MS,
} from '../helpers/slides-claps';
import { checkTeachSegments, WEB_TEST_TEACH_COPIES, WEB_TEST_TEACH_LEAD_MS } from './fixture';
import { FIXTURE_SLIDES_TIMES_PATH, FIXTURE_SLIDES_WAV_PATH } from './paths';

// The patterns of the case, written out so that the generator does not depend on the page (U10 and E1 prove the page).
const PATTERNS = ['clap clap', 'clap clap clap'];
const LABEL = 'clap';
const MS_PER_SECOND = 1000;

// Test-only values. The gaps are the first values of design.md "The fixture and the timeline"; step 12.2 of the tasks
// measures the handling times and records them.
export const SLIDES_GAP_A_MS = 14000;       // after the last teaching clap: Done, training, Save, Close, the new engine's calibration, the caption "Listening"
export const SLIDES_GAP_B_MS = 8000;        // after S0: the pending wait of a prefix pattern plus handling
export const SLIDES_GAP_C_MS = 8000;        // after S1: the same
export const SLIDES_TAIL_MS = 6000;         // the keyboard check and the screenshot need no sound
const CLAP_SEED = 26500;
const CLAP_LENGTH_MS = CLAP_TAIL_MS;        // generous: the tail that the recipe adds after a clap
const PRESENCE_WINDOW_MS = 40;              // a clap must be heard in the window after its start
const PRESENCE_MIN_DB = 12;                 // louder than the window before it by this much
const CUT_AFTER_MS = 1500;                  // the Node recording of the dialog ends this long after the last teaching clap
const MATCH_WINDOW_MS = 1500;               // a match arrives within this time after the last clap of its group
const ONSET_ALLOWANCE_MS = 20;              // an onset is dated a few ms before the clap starts
const NODE_START_FROM_MS = 2000;            // the Node run starts this long after the last teaching clap
const DB_POWER_DIVISOR = 10;

export interface SlidesTimes {
  sampleRate: number;
  durationMs: number;
  teach: { startsMs: number[]; endMs: number };
  s0: number[];       // one clap
  s1: number[];       // two claps
  s2: number[];       // three claps
}

const toSamples = (ms: number): number => Math.round((ms * CLAP_SAMPLE_RATE_HZ) / MS_PER_SECOND);
const onGrid = (ms: number): number => (toSamples(ms) * MS_PER_SECOND) / CLAP_SAMPLE_RATE_HZ;
const rmsDb = (x: Float32Array): number => {
  let s = 0;
  for (const v of x) s += v * v;
  return DB_POWER_DIVISOR * Math.log10(s / Math.max(1, x.length) + Number.MIN_VALUE);
};
const slice = (x: Float32Array, fromMs: number, toMs: number): Float32Array => x.slice(toSamples(Math.max(0, fromMs)), toSamples(toMs));
const group = (at: number, n: number): number[] => Array.from({ length: n }, (_, i) => onGrid(at + i * CLAP_PATTERN_GAP_MS));

// The timeline: every time is built from the named constants and lies on the sample grid.
export function slidesTimes(): SlidesTimes {
  const teach = Array.from({ length: WEB_TEST_TEACH_COPIES }, (_, i) => onGrid(WEB_TEST_TEACH_LEAD_MS + i * CLAP_TEACH_SPACING_MS));
  const lastTeach = teach[teach.length - 1];
  const s0 = group(onGrid(lastTeach + SLIDES_GAP_A_MS), 1);
  const s1 = group(onGrid(s0[0] + SLIDES_GAP_B_MS), 2);
  const s2 = group(onGrid(s1[1] + SLIDES_GAP_C_MS), 3);
  return {
    sampleRate: CLAP_SAMPLE_RATE_HZ,
    durationMs: onGrid(s2[2] + CLAP_LENGTH_MS + SLIDES_TAIL_MS),
    teach: { startsMs: teach, endMs: onGrid(lastTeach + CLAP_LENGTH_MS) },
    s0, s1, s2,
  };
}

export function slidesSignal(times: SlidesTimes): Float32Array {
  const all = [...times.teach.startsMs, ...times.s0, ...times.s1, ...times.s2];
  const hits: Hit[] = all.map((atMs) => ({ atMs, cls: CLAP_CLASS, gainDb: CLAP_GAIN_DB }));
  return makeSignal({ sampleRate: times.sampleRate, totalMs: times.durationMs, hits, seed: CLAP_SEED, noiseRmsDb: CLAP_NOISE_DBFS });
}

// The model of the first run, made the way the dialog makes it: retrainLabel for clap from the teaching part.
export function slidesModel(samples: Float32Array, times: SlidesTimes): SoundModel {
  const rec = { label: LABEL, file: 'slides.wav', samples: slice(samples, 0, times.teach.endMs + CUT_AFTER_MS), sampleRate: times.sampleRate };
  return retrainLabel(emptyModel(times.sampleRate), LABEL, [rec]).model;
}

interface Heard { pattern: string; atMs: number }

// Runs the stream from fromMs on through the engine with both patterns in one mode. Times are stream times.
function runBoth(samples: Float32Array, times: SlidesTimes, model: SoundModel, fromMs: number): Heard[] {
  const found: Heard[] = [];
  const on: Handlers = Object.fromEntries(PATTERNS.map((p) => [p, (m: MatchEvent) => found.push({ pattern: p, atMs: fromMs + m.t * MS_PER_SECOND })]));
  const engine = createEngine({ sounds: model, sampleRate: times.sampleRate, modes: { on }, mode: 'on' });
  engine.push(samples.slice(toSamples(fromMs)));
  engine.flush();
  return found;
}

// Which group a match belongs to, by its stream time (m.t is the start of the last clap of the pattern).
function partOf(times: SlidesTimes, atMs: number): string {
  const groups: [string, number[]][] = [['s0', times.s0], ['s1', times.s1], ['s2', times.s2]];
  for (const [name, at] of groups) {
    if (atMs >= at[0] - ONSET_ALLOWANCE_MS && atMs <= at[at.length - 1] + MATCH_WINDOW_MS) return name;
  }
  return `outside(${atMs.toFixed(0)} ms)`;
}

// The checks of design.md "Node check of the fixture". Throws with the name of the part that fails.
export function checkSlidesFixture(samples: Float32Array, times: SlidesTimes): void {
  // 1. The teaching part holds exactly ten segments, as the dialog counts them.
  checkTeachSegments(slice(samples, 0, times.teach.endMs + CUT_AFTER_MS), WEB_TEST_TEACH_COPIES);

  // 2. A model made the way the dialog makes it, with both patterns in one mode: nothing for S0, `clap clap` for S1,
  // `clap clap clap` alone for S2.
  const model = slidesModel(samples, times);
  const from = times.teach.startsMs[times.teach.startsMs.length - 1] + NODE_START_FROM_MS;
  const heard = runBoth(samples, times, model, from).map((h) => `${h.pattern}@${partOf(times, h.atMs)}`);
  const expected = ['clap clap@s1', 'clap clap clap@s2'];
  if (JSON.stringify(heard) !== JSON.stringify(expected)) {
    throw new Error(`Slides fixture: expected ${expected.join(', ')} but the Node engine gave ${heard.join(', ') || 'nothing'} (one clap must give nothing, three claps must not fire "clap clap").`);
  }
}

// 3. The times of the JSON match the written file: its length, and every clap is heard where the JSON says.
export function checkSlidesTimes(written: Float32Array, writtenRate: number, times: SlidesTimes): void {
  const expectedSamples = toSamples(times.durationMs);
  if (writtenRate !== times.sampleRate || Math.abs(written.length - expectedSamples) > 1) {
    throw new Error(`The written file has ${written.length} samples at ${writtenRate} Hz, the times say ${expectedSamples} samples at ${times.sampleRate} Hz.`);
  }
  const starts: [string, number][] = [
    ...times.teach.startsMs.map((t, i): [string, number] => [`teaching clap ${i + 1}`, t]),
    ...times.s0.map((t, i): [string, number] => [`s0 clap ${i + 1}`, t]),
    ...times.s1.map((t, i): [string, number] => [`s1 clap ${i + 1}`, t]),
    ...times.s2.map((t, i): [string, number] => [`s2 clap ${i + 1}`, t]),
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
export async function generateSlidesFixture(): Promise<SlidesTimes> {
  const times = slidesTimes();
  const samples = slidesSignal(times);
  checkSlidesFixture(samples, times);
  await mkdir(dirname(FIXTURE_SLIDES_WAV_PATH), { recursive: true });
  await writeWavFile(FIXTURE_SLIDES_WAV_PATH, samples, times.sampleRate);
  await writeFile(FIXTURE_SLIDES_TIMES_PATH, JSON.stringify(times));
  const back = await readWavFile(FIXTURE_SLIDES_WAV_PATH);
  checkSlidesTimes(back.samples, back.sampleRate, times);
  return times;
}
