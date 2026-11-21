// Task 33: the fixture of the Shoo! browser tests. Two WAV files for Chrome's fake microphone (it plays the file once from
// the moment the stream opens, at 48 kHz, the rate of the other web fixtures), a JSON of the stream time of every part, and
// the text of a stored model for a returning player.
//
// - shoo-first.wav: the first run. Speech-like noise for the room sound (the dialog records 10 s of it, the shortest length
//   teach() allows, because the page runs with ?speed=1.5), ten clicks for the click dialog, then two clicks in the fight.
// - shoo-play.wav: a returning player with the stored model. One click in wave 1, then the rhythm `knock knock _ knock`
//   three times for the warden of wave 5 (started with ?wave=5).
//
// The sounds are STAND-INS made by core/synth (the same four impact classes as apps/shoo/sounds), not recordings. They show
// the wiring and the rules of the game. They do not show how well Tokk recognises a real tongue click, clap, knock or lip pop.
// Nothing here is committed (the folder is git-ignored) and nothing here sends anything anywhere.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyModel } from '../../core/classify/knn';
import { SYNTH_FIXTURE_LEAD_NOISE_DBFS } from '../../core/constants';
import { createEngine } from '../../core/engine';
import type { EngineEvent } from '../../core/engine';
import { place } from '../../core/synth';
import { retrainLabel } from '../../core/teach';
import type { Recording } from '../../core/teach';
import type { SoundModel } from '../../core/types';
import { readWavFile, writeWavFile } from '../../node/files';
import { BOSS_PATTERN } from '../../apps/shoo/src/monsters';
import type { SoundId } from '../../apps/shoo/src/monsters';
import { WEB_STORAGE_VERSION } from '../../web/constants';
import { firstRunBase } from '../../web/teach-ui/storage';
import { makeSignal } from '../helpers/engine-fixture';
import type { Hit, ImpactName } from '../helpers/engine-fixture';
import { SHOO_CLASS } from '../helpers/shoo-sounds';
import { speechLikeNoise } from './hands-free-fixture';
import { checkTeachSegments, WEB_TEST_GAIN_DB, WEB_TEST_IMPACT_SPACING_MS, WEB_TEST_SAMPLE_RATE_HZ, WEB_TEST_TEACH_COPIES, WEB_TEST_TEACH_LEAD_MS } from './fixture';
import { FIXTURE_SHOO_FIRST_WAV_PATH, FIXTURE_SHOO_PLAY_WAV_PATH, FIXTURE_SHOO_STORED_PATH, FIXTURE_SHOO_TIMES_PATH } from './paths';

const MS_PER_SECOND = 1000;
const STORAGE_KEY = 'tokk:shoo';
const SOUNDS: SoundId[] = ['click', 'clap', 'knock', 'pop'];

// Test-only values. Times are stream times in ms from the moment the microphone opens.
export const SHOO_ROOM_NOISE_AT_MS = 3000;           // after the dialog's quiet second
export const SHOO_ROOM_NOISE_MS = 13000;             // longer than the 10000 ms the dialog records
export const SHOO_FIRST_TEACH_AT_MS = 24000;         // the click dialog is open and quiet by now (room dialog, Save, Close, the new dialog)
export const SHOO_FIRST_FIGHT_CLICKS_MS = [40000, 43000];   // the fight starts at about 33 s and a bat lives about 9 s at ?speed=1.5
export const SHOO_PLAY_CLICK_AT_MS = 8000;           // wave 1 is in battle from about 4.5 s
export const SHOO_PLAY_RHYTHMS_AT_MS = [11000, 16000, 21000];   // the warden of wave 5 walks for about 20 s from 4.5 s
export const SHOO_BEAT_MS = 250;                     // inside a pattern: less than the 350 ms of a consecutive gap
export const SHOO_REST_MS = 600;                     // a rest: 350 to 1000 ms
export const SHOO_TAIL_MS = 6000;
const KNOCK_LENGTH_AFTER_MS = 800;
const CUT_AFTER_MS = 1500;                           // a model recording ends this long after its last sound
const MODEL_ROOM_NOISE_MS = 13000;
const SPEECH_RMS_DBFS = -35;
const SEED_FIRST = 33100;
const SEED_PLAY = 33200;
const SEED_MODEL = 33300;
const SEED_SPEECH = 33400;
const SEED_STEP = 100;
const PRESENCE_WINDOW_MS = 40;
const PRESENCE_MIN_DB = 12;
const DB_POWER_DIVISOR = 10;
const MATCH_WINDOW_MS = 1500;

export interface ShooTimes {
  sampleRate: number;
  first: { durationMs: number; teachStartsMs: number[]; teachEndMs: number; fightClicksMs: number[] };
  play: { durationMs: number; clickMs: number; rhythmsMs: number[] };
}

const toSamples = (ms: number): number => Math.round((ms * WEB_TEST_SAMPLE_RATE_HZ) / MS_PER_SECOND);
const onGrid = (ms: number): number => (toSamples(ms) * MS_PER_SECOND) / WEB_TEST_SAMPLE_RATE_HZ;
const slice = (x: Float32Array, fromMs: number, toMs: number): Float32Array => x.slice(toSamples(Math.max(0, fromMs)), toSamples(toMs));
const rmsDb = (x: Float32Array): number => {
  let s = 0;
  for (const v of x) s += v * v;
  return DB_POWER_DIVISOR * Math.log10(s / Math.max(1, x.length) + Number.MIN_VALUE);
};

export function shooTimes(): ShooTimes {
  const teachStartsMs = Array.from({ length: WEB_TEST_TEACH_COPIES }, (_, i) => onGrid(SHOO_FIRST_TEACH_AT_MS + i * WEB_TEST_IMPACT_SPACING_MS));
  const lastClick = SHOO_FIRST_FIGHT_CLICKS_MS[SHOO_FIRST_FIGHT_CLICKS_MS.length - 1];
  const rhythmsMs = SHOO_PLAY_RHYTHMS_AT_MS.map(onGrid);
  const lastRhythm = rhythmsMs[rhythmsMs.length - 1];
  return {
    sampleRate: WEB_TEST_SAMPLE_RATE_HZ,
    first: {
      durationMs: onGrid(lastClick + SHOO_TAIL_MS),
      teachStartsMs,
      teachEndMs: onGrid(teachStartsMs[teachStartsMs.length - 1] + KNOCK_LENGTH_AFTER_MS),
      fightClicksMs: SHOO_FIRST_FIGHT_CLICKS_MS.map(onGrid),
    },
    play: { durationMs: onGrid(lastRhythm + SHOO_BEAT_MS + SHOO_REST_MS + KNOCK_LENGTH_AFTER_MS + SHOO_TAIL_MS), clickMs: onGrid(SHOO_PLAY_CLICK_AT_MS), rhythmsMs },
  };
}

const rhythmAt = (startMs: number): number[] => [startMs, startMs + SHOO_BEAT_MS, startMs + SHOO_BEAT_MS + SHOO_REST_MS].map(onGrid);

function signal(durationMs: number, hits: Hit[], seed: number): Float32Array {
  return makeSignal({ sampleRate: WEB_TEST_SAMPLE_RATE_HZ, totalMs: durationMs, hits, seed, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS });
}
const hit = (atMs: number, sound: SoundId): Hit => ({ atMs, cls: SHOO_CLASS[sound] as ImpactName, gainDb: WEB_TEST_GAIN_DB });

export function firstSignal(t: ShooTimes): Float32Array {
  const hits = [...t.first.teachStartsMs, ...t.first.fightClicksMs].map((atMs) => hit(atMs, 'click'));
  const out = signal(t.first.durationMs, hits, SEED_FIRST);
  const speech = place([{ atMs: SHOO_ROOM_NOISE_AT_MS, samples: speechLikeNoise(SHOO_ROOM_NOISE_MS, SEED_SPEECH, SPEECH_RMS_DBFS, t.sampleRate) }], t.first.durationMs, t.sampleRate);
  for (let i = 0; i < out.length; i++) out[i] += speech[i];
  return out;
}

export function playSignal(t: ShooTimes): Float32Array {
  const knocks = t.play.rhythmsMs.flatMap(rhythmAt);
  return signal(t.play.durationMs, [hit(t.play.clickMs, 'click'), ...knocks.map((atMs) => hit(atMs, 'knock'))], SEED_PLAY);
}

// The stored model of a returning player, made the way the dialogs make it: retrainLabel for each sound, then background.
export function shooModel(t: ShooTimes): SoundModel {
  const sr = t.sampleRate;
  const rec = (label: string, samples: Float32Array): Recording => ({ label, file: `${label}.wav`, samples, sampleRate: sr });
  let model = emptyModel(sr);
  SOUNDS.forEach((sound, k) => {
    const starts = Array.from({ length: WEB_TEST_TEACH_COPIES }, (_, i) => onGrid(WEB_TEST_TEACH_LEAD_MS + i * WEB_TEST_IMPACT_SPACING_MS));
    const total = starts[starts.length - 1] + CUT_AFTER_MS;
    const samples = signal(total, starts.map((atMs) => hit(atMs, sound)), SEED_MODEL + k * SEED_STEP);
    model = retrainLabel(model, sound, [rec(sound, samples)]).model;
  });
  const room = place([{ atMs: SHOO_ROOM_NOISE_AT_MS / 3, samples: speechLikeNoise(MODEL_ROOM_NOISE_MS, SEED_SPEECH + 1, SPEECH_RMS_DBFS, sr) }], MODEL_ROOM_NOISE_MS + CUT_AFTER_MS, sr);
  return retrainLabel(model, 'background', [rec('background', room)]).model;
}

export const storedEntry = (model: SoundModel): string => JSON.stringify({ version: WEB_STORAGE_VERSION, base: firstRunBase(), model });

interface Heard { what: string; atMs: number }

// Runs the play stream through the engine with the modes of the app. Times are stream times.
function runPlay(samples: Float32Array, t: ShooTimes, model: SoundModel): Heard[] {
  const found: Heard[] = [];
  const engine = createEngine({
    sounds: model, sampleRate: t.sampleRate, mode: 'boss',
    modes: { battle: {}, boss: { [BOSS_PATTERN]: (m) => found.push({ what: BOSS_PATTERN, atMs: m.t * MS_PER_SECOND }) } },
    onEvent: (e: EngineEvent) => { if (e.kind === 'sound') found.push({ what: e.label, atMs: e.t * MS_PER_SECOND }); else if (e.kind === 'unknown') found.push({ what: 'unknown', atMs: e.t * MS_PER_SECOND }); },
  });
  engine.push(samples);
  engine.flush();
  return found.sort((a, b) => a.atMs - b.atMs);
}

// Throws with the name of the part that fails.
export function checkShooFixture(first: Float32Array, play: Float32Array, t: ShooTimes, model: SoundModel): void {
  // 1. The click dialog counts exactly ten segments in the teaching part.
  checkTeachSegments(slice(first, SHOO_FIRST_TEACH_AT_MS - 2000, t.first.teachEndMs + CUT_AFTER_MS), WEB_TEST_TEACH_COPIES);
  // 2. The stored model and the modes of the app hear the play stream: one click, then nine knocks and three rhythms.
  const heard = runPlay(play, t, model);
  const expected = [
    ...[t.play.clickMs].map((atMs) => ({ what: 'click', atMs })),
    ...t.play.rhythmsMs.flatMap((start) => [0, 1, 2].map((i) => ({ what: 'knock', atMs: rhythmAt(start)[i] }))),
  ];
  const sounds = heard.filter((h) => h.what !== BOSS_PATTERN);
  const near = (a: Heard, b: Heard): boolean => a.what === b.what && Math.abs(a.atMs - b.atMs) < MATCH_WINDOW_MS;
  if (sounds.length !== expected.length || !sounds.every((h, i) => near(h, expected[i]))) {
    throw new Error(`Shoo fixture, play stream: expected ${expected.map((e) => e.what).join(', ')} but the Node engine gave ${sounds.map((h) => `${h.what}@${h.atMs.toFixed(0)}`).join(', ') || 'nothing'}.`);
  }
  const rhythms = heard.filter((h) => h.what === BOSS_PATTERN);
  if (rhythms.length !== t.play.rhythmsMs.length) {
    throw new Error(`Shoo fixture, play stream: expected ${t.play.rhythmsMs.length} matches of "${BOSS_PATTERN}" but got ${rhythms.length}.`);
  }
}

// The times of the JSON match the written files: every sound is heard where the JSON says.
export function checkShooTimes(first: Float32Array, play: Float32Array, t: ShooTimes): void {
  const starts: [Float32Array, string, number][] = [
    ...t.first.teachStartsMs.map((ms, i): [Float32Array, string, number] => [first, `teaching click ${i + 1}`, ms]),
    ...t.first.fightClicksMs.map((ms, i): [Float32Array, string, number] => [first, `fight click ${i + 1}`, ms]),
    [play, 'play click', t.play.clickMs],
    ...t.play.rhythmsMs.flatMap((ms, r) => rhythmAt(ms).map((at, i): [Float32Array, string, number] => [play, `rhythm ${r + 1} knock ${i + 1}`, at])),
  ];
  for (const [x, name, atMs] of starts) {
    const after = rmsDb(slice(x, atMs, atMs + PRESENCE_WINDOW_MS));
    const before = rmsDb(slice(x, atMs - PRESENCE_WINDOW_MS, atMs));
    if (after - before < PRESENCE_MIN_DB) throw new Error(`The part "${name}" is not heard at ${atMs} ms in the written file (${after.toFixed(1)} dB after, ${before.toFixed(1)} dB before).`);
  }
}

export async function generateShooFixture(): Promise<ShooTimes> {
  const t = shooTimes();
  const first = firstSignal(t);
  const play = playSignal(t);
  const model = shooModel(t);
  checkShooFixture(first, play, t, model);
  await mkdir(dirname(FIXTURE_SHOO_FIRST_WAV_PATH), { recursive: true });
  await writeWavFile(FIXTURE_SHOO_FIRST_WAV_PATH, first, t.sampleRate);
  await writeWavFile(FIXTURE_SHOO_PLAY_WAV_PATH, play, t.sampleRate);
  await writeFile(FIXTURE_SHOO_TIMES_PATH, JSON.stringify(t));
  await writeFile(FIXTURE_SHOO_STORED_PATH, storedEntry(model));
  const backFirst = await readWavFile(FIXTURE_SHOO_FIRST_WAV_PATH);
  const backPlay = await readWavFile(FIXTURE_SHOO_PLAY_WAV_PATH);
  checkShooTimes(backFirst.samples, backPlay.samples, t);
  return t;
}
