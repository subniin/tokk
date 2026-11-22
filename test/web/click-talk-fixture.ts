// Task 34 run B: the fixture of the Click Talk browser tests. Three WAV files for Chrome's fake microphone (it plays the file
// once from the moment the stream opens, at 48 kHz, the rate of the other web fixtures), a JSON of the stream time of every
// part, and the text of a stored model for a returning user. Also the fake speechSynthesis the tests install in the page.
//
// - click-talk-first.wav: the first run. Ten clicks for the click dialog, ten pops for the pop dialog, speech-like noise for
//   the room sound (the dialog records 10 s of it, the shortest length teach() allows, because the page runs with ?room=short),
//   then one click and one pop for the board.
// - click-talk-play.wav: a returning user in two-sound mode. click, pop, click, pop (a phrase is spoken), a click while
//   it is spoken, two pops then silence, three pops (help), a click while the alarm sounds.
// - click-talk-one.wav: a returning user in one-sound mode. A click, three clicks (help), two clicks then silence.
//
// The sounds are STAND-INS made by core/synth (the impact classes of apps/click-talk/sounds), not recordings. They show the
// wiring and the rules. They do not show how well Tokk recognises a real tongue click or lip pop.
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
import { makeSignal } from '../helpers/engine-fixture';
import type { Hit } from '../helpers/engine-fixture';
import { TALK_BEAT_MS, TALK_CLASS } from '../helpers/click-talk-sounds';
import type { TalkSound } from '../helpers/click-talk-sounds';
import { speechLikeNoise } from './speech-noise';
import { checkTeachSegments, WEB_TEST_GAIN_DB, WEB_TEST_IMPACT_SPACING_MS, WEB_TEST_SAMPLE_RATE_HZ, WEB_TEST_TEACH_COPIES, WEB_TEST_TEACH_LEAD_MS } from './fixture';
import { FIXTURE_TALK_FIRST_WAV_PATH, FIXTURE_TALK_ONE_WAV_PATH, FIXTURE_TALK_PLAY_WAV_PATH, FIXTURE_TALK_STORED_PATH, FIXTURE_TALK_TIMES_PATH } from './paths';
import { storedEntry } from './shoo-fixture';

const MS_PER_SECOND = 1000;
const SEED_FIRST = 34100;
const SEED_PLAY = 34200;
const SEED_ONE = 34300;
const SEED_MODEL = 34400;
const SEED_SPEECH = 34500;
const SEED_STEP = 100;
const SPEECH_RMS_DBFS = -35;
const CUT_AFTER_MS = 1500;                 // a model recording ends this long after its last sound
const MODEL_ROOM_NOISE_MS = 13000;
const TAIL_MS = 6000;
const MATCH_WINDOW_MS = 1500;

// Test-only values. Times are stream times in ms from the moment the microphone opens.
export const TALK_FIRST = {
  clickAtMs: 3000,                         // the click dialog is open and quiet by then (its quiet second fits in the lead)
  popAtMs: 16000,                          // the pop dialog opens about 1 s after the last click, long before this
  roomNoiseAtMs: 27000,                    // the room dialog opens about 1 s after the last pop (23.2 s), its quiet second is over
  roomNoiseMs: 13000,                      // longer than the 10000 ms the dialog records
  roomSettleMs: 1500,                      // after the room sound of the stream, before the dialog is saved
  boardClickAtMs: 46000,
  boardPopAtMs: 49000,
};
export const TALK_PLAY = {
  clickMs: [3000, 9000],
  popMs: [6000, 12000],
  duringSpeechClickMs: 13500,              // heard only if listening were not paused while the phrase is spoken
  twoPopsAtMs: 19000,                      // two pops, TALK_BEAT_MS apart, then silence
  threePopsAtMs: 24000,                    // pop pop pop
  duringAlarmClickMs: 28000,               // heard only if listening were not paused while the alarm sounds
};
export const TALK_ONE = {
  clickAtMs: 2500,
  threeClicksAtMs: 11000,                  // click click click
  twoClicksAtMs: 14000,                    // click click, then silence
};

export interface TalkTimes {
  sampleRate: number;
  first: { durationMs: number; clickStartsMs: number[]; popStartsMs: number[]; roomNoiseEndMs: number; boardClickMs: number; boardPopMs: number };
  play: { durationMs: number };
  one: { durationMs: number };
}

const toSamples = (ms: number): number => Math.round((ms * WEB_TEST_SAMPLE_RATE_HZ) / MS_PER_SECOND);
const onGrid = (ms: number): number => (toSamples(ms) * MS_PER_SECOND) / WEB_TEST_SAMPLE_RATE_HZ;
const slice = (x: Float32Array, fromMs: number, toMs: number): Float32Array => x.slice(toSamples(Math.max(0, fromMs)), toSamples(toMs));
const spaced = (startMs: number, count: number, stepMs: number): number[] => Array.from({ length: count }, (_, i) => onGrid(startMs + i * stepMs));

export function talkTimes(): TalkTimes {
  const clickStartsMs = spaced(TALK_FIRST.clickAtMs, WEB_TEST_TEACH_COPIES, WEB_TEST_IMPACT_SPACING_MS);
  const popStartsMs = spaced(TALK_FIRST.popAtMs, WEB_TEST_TEACH_COPIES, WEB_TEST_IMPACT_SPACING_MS);
  return {
    sampleRate: WEB_TEST_SAMPLE_RATE_HZ,
    first: {
      durationMs: onGrid(TALK_FIRST.boardPopAtMs + TAIL_MS),
      clickStartsMs,
      popStartsMs,
      roomNoiseEndMs: TALK_FIRST.roomNoiseAtMs + TALK_FIRST.roomNoiseMs,
      boardClickMs: onGrid(TALK_FIRST.boardClickAtMs),
      boardPopMs: onGrid(TALK_FIRST.boardPopAtMs),
    },
    play: { durationMs: onGrid(TALK_PLAY.duringAlarmClickMs + TAIL_MS) },
    one: { durationMs: onGrid(TALK_ONE.twoClicksAtMs + TALK_BEAT_MS + TAIL_MS) },
  };
}

interface Placed { sound: TalkSound; atMs: number }
const burst = (sound: TalkSound, atMs: number, count: number): Placed[] => Array.from({ length: count }, (_, i) => ({ sound, atMs: onGrid(atMs + i * TALK_BEAT_MS) }));
const at = (sound: TalkSound, atMs: number): Placed => ({ sound, atMs: onGrid(atMs) });

export function firstPlaced(t: TalkTimes): Placed[] {
  return [
    ...t.first.clickStartsMs.map((atMs) => ({ sound: 'click' as const, atMs })),
    ...t.first.popStartsMs.map((atMs) => ({ sound: 'pop' as const, atMs })),
    { sound: 'click', atMs: t.first.boardClickMs },
    { sound: 'pop', atMs: t.first.boardPopMs },
  ];
}
export const playPlaced = (): Placed[] => [
  at('click', TALK_PLAY.clickMs[0]), at('pop', TALK_PLAY.popMs[0]), at('click', TALK_PLAY.clickMs[1]), at('pop', TALK_PLAY.popMs[1]),
  at('click', TALK_PLAY.duringSpeechClickMs),
  ...burst('pop', TALK_PLAY.twoPopsAtMs, 2),
  ...burst('pop', TALK_PLAY.threePopsAtMs, 3),
  at('click', TALK_PLAY.duringAlarmClickMs),
];
export const onePlaced = (): Placed[] => [
  at('click', TALK_ONE.clickAtMs),
  ...burst('click', TALK_ONE.threeClicksAtMs, 3),
  ...burst('click', TALK_ONE.twoClicksAtMs, 2),
];

function signal(durationMs: number, placed: Placed[], seed: number): Float32Array {
  const hits: Hit[] = placed.map((p) => ({ atMs: p.atMs, cls: TALK_CLASS[p.sound], gainDb: WEB_TEST_GAIN_DB }));
  return makeSignal({ sampleRate: WEB_TEST_SAMPLE_RATE_HZ, totalMs: durationMs, hits, seed, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS });
}

export function firstSignal(t: TalkTimes): Float32Array {
  const out = signal(t.first.durationMs, firstPlaced(t), SEED_FIRST);
  const speech = place([{ atMs: TALK_FIRST.roomNoiseAtMs, samples: speechLikeNoise(TALK_FIRST.roomNoiseMs, SEED_SPEECH, SPEECH_RMS_DBFS, t.sampleRate) }], t.first.durationMs, t.sampleRate);
  for (let i = 0; i < out.length; i++) out[i] += speech[i];
  return out;
}

// The stored model of a returning user, made the way the dialogs make it: retrainLabel for each sound, then background.
export function talkModel(t: TalkTimes): SoundModel {
  const sr = t.sampleRate;
  const rec = (label: string, samples: Float32Array): Recording => ({ label, file: `${label}.wav`, samples, sampleRate: sr });
  let model = emptyModel(sr);
  (['click', 'pop'] as const).forEach((sound, k) => {
    const starts = spaced(WEB_TEST_TEACH_LEAD_MS, WEB_TEST_TEACH_COPIES, WEB_TEST_IMPACT_SPACING_MS);
    const total = starts[starts.length - 1] + CUT_AFTER_MS;
    const samples = signal(total, starts.map((atMs) => ({ sound, atMs })), SEED_MODEL + k * SEED_STEP);
    model = retrainLabel(model, sound, [rec(sound, samples)]).model;
  });
  const room = place([{ atMs: TALK_FIRST.roomNoiseAtMs / 9, samples: speechLikeNoise(MODEL_ROOM_NOISE_MS, SEED_SPEECH + 1, SPEECH_RMS_DBFS, sr) }], MODEL_ROOM_NOISE_MS + CUT_AFTER_MS, sr);
  return retrainLabel(model, 'background', [rec('background', room)]).model;
}

// What the Node engine hears in a stream, in order: sound names and the time of each.
function heardIn(samples: Float32Array, t: TalkTimes, model: SoundModel): { what: string; atMs: number }[] {
  const found: { what: string; atMs: number }[] = [];
  const engine = createEngine({
    sounds: model, sampleRate: t.sampleRate,
    onEvent: (e: EngineEvent) => { found.push({ what: e.kind === 'sound' ? e.label : 'unknown', atMs: e.t * MS_PER_SECOND }); },
  });
  engine.push(samples);
  engine.flush();
  return found.sort((a, b) => a.atMs - b.atMs);
}

// Throws with the name of the part that fails.
function checkHeard(name: string, samples: Float32Array, placed: Placed[], t: TalkTimes, model: SoundModel): void {
  const expected = [...placed].sort((a, b) => a.atMs - b.atMs).map((p) => ({ what: p.sound, atMs: p.atMs }));
  const heard = heardIn(samples, t, model);
  const ok = heard.length === expected.length && heard.every((h, i) => h.what === expected[i].what && Math.abs(h.atMs - expected[i].atMs) < MATCH_WINDOW_MS);
  if (!ok) {
    throw new Error(`Click Talk fixture, ${name}: expected ${expected.map((e) => `${e.what}@${e.atMs.toFixed(0)}`).join(', ')} but the Node engine gave ${heard.map((h) => `${h.what}@${h.atMs.toFixed(0)}`).join(', ') || 'nothing'}.`);
  }
}

export function checkTalkFixture(first: Float32Array, play: Float32Array, one: Float32Array, t: TalkTimes, model: SoundModel): void {
  // 1. The two dialogs count exactly ten segments in their teaching parts.
  checkTeachSegments(slice(first, TALK_FIRST.clickAtMs - 2000, t.first.clickStartsMs[WEB_TEST_TEACH_COPIES - 1] + CUT_AFTER_MS), WEB_TEST_TEACH_COPIES);
  checkTeachSegments(slice(first, TALK_FIRST.popAtMs - 2000, t.first.popStartsMs[WEB_TEST_TEACH_COPIES - 1] + CUT_AFTER_MS), WEB_TEST_TEACH_COPIES);
  // 2. The stored model hears every sound of the play and one-sound streams where the plan puts it.
  checkHeard('play stream', play, playPlaced(), t, model);
  checkHeard('one-sound stream', one, onePlaced(), t, model);
}

export async function generateTalkFixture(): Promise<TalkTimes> {
  const t = talkTimes();
  const first = firstSignal(t);
  const play = signal(t.play.durationMs, playPlaced(), SEED_PLAY);
  const one = signal(t.one.durationMs, onePlaced(), SEED_ONE);
  const model = talkModel(t);
  checkTalkFixture(first, play, one, t, model);
  await mkdir(dirname(FIXTURE_TALK_FIRST_WAV_PATH), { recursive: true });
  await writeWavFile(FIXTURE_TALK_FIRST_WAV_PATH, first, t.sampleRate);
  await writeWavFile(FIXTURE_TALK_PLAY_WAV_PATH, play, t.sampleRate);
  await writeWavFile(FIXTURE_TALK_ONE_WAV_PATH, one, t.sampleRate);
  await writeFile(FIXTURE_TALK_TIMES_PATH, JSON.stringify(t));
  await writeFile(FIXTURE_TALK_STORED_PATH, storedEntry(model));
  // The files read back give the same sounds.
  const back = await readWavFile(FIXTURE_TALK_PLAY_WAV_PATH);
  checkHeard('play stream, read back', back.samples, playPlaced(), t, model);
  return t;
}

// ---- The page side (installed with addInitScript) ----
export interface FakeSpeechConfig { voices: boolean; durationMs: number }
export interface SpeechWindow { __said?: string[]; __saidWith?: string[]; __cancelled?: number }

// A fake speechSynthesis and SpeechSynthesisUtterance: records what is said and with which voice, ends each speech after
// durationMs, and lists one local and one online voice, or none. Real voice objects cannot be made by a page, so the
// utterance class is a plain one too.
export const FAKE_SPEECH_SCRIPT = (cfg: FakeSpeechConfig): void => {
  const w = window as unknown as SpeechWindow & Record<string, unknown>;
  w.__said = [];
  w.__saidWith = [];
  w.__cancelled = 0;
  class Utterance {
    text: string;
    voice: { name: string } | null = null;
    lang = '';
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) { this.text = text; }
  }
  w.SpeechSynthesisUtterance = Utterance;
  const voices = cfg.voices
    ? [
      { voiceURI: 'test-online', name: 'Test Online', lang: 'en-GB', localService: false, default: false },
      { voiceURI: 'test-local', name: 'Test Local', lang: 'en-US', localService: true, default: true },
    ]
    : [];
  let current: Utterance | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const synth = {
    getVoices: () => voices,
    speak(u: Utterance) {
      w.__said?.push(u.text);
      w.__saidWith?.push(u.voice?.name ?? '');
      current = u;
      timer = setTimeout(() => { current = null; u.onend?.(); }, cfg.durationMs);
    },
    cancel() {
      if (current === null) return;
      clearTimeout(timer);
      const u = current;
      current = null;
      w.__cancelled = (w.__cancelled ?? 0) + 1;
      u.onerror?.();
    },
    addEventListener() { /* the voices are there from the start */ },
    removeEventListener() { /* see above */ },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
};
