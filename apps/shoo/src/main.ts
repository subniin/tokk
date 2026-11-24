// Shoo!: a five-minute sound defense game. Monsters walk down a path, each runs from one sound. This file holds the Tokk
// wiring (between the markers) and the glue between the rules (game.ts), the screen (view.ts) and the effects (audio.ts).
// Nothing here sends audio anywhere: the library stores the taught model (feature vectors) under STORAGE_KEY, and the game
// progress is not stored at all.
import { createShooAudio } from './audio';
import type { EffectName, ShooAudio } from './audio';
import {
  BETWEEN_MS, MAX_FRAME_MS, READY_MS, STORAGE_KEY, TEACH_EXAMPLES_PER_SOUND, WAVE_LABEL_MS,
} from './constants';
import { initialState, modeFor, reduce, reduceWithHit } from './game';
import type { GameInput, GameState } from './game';
import { actionForKey } from './keys';
import { BOSS_PATTERN, MONSTERS } from './monsters';
import type { SoundId } from './monsters';
import styleText from './style.css' with { type: 'text' };
import { INTRO_TEXT, READY_TEXT, ROOM_TEXT, TEACH_LINE, waveLabel } from './teach-texts';
import { backgroundMsFor, parseTestParams } from './test-params';
import {
  byId, caption, isDialogOpen, keyInput, render, resetField, setCleared, setControls, setDawn, setIntro, setLost, setRoom,
  setSfxLabel, setTeachAvailable, showBanner, showHit, showHud, showMic, showScreen, whenDialogClosed,
} from './view';
import { newKinds } from './waves';

// What the wiring calls on the glue.
interface Glue {
  sound(label: string): void;
  boss(): void;
  failed(): void;
  debug(): boolean;
}

// tokk:start
import { listen } from 'tokk';
import type { Ears, EngineEvent } from 'tokk';

let ears: Ears | null = null;

// Starts listening with the microphone, or without one for 'keys'. It stops the Ears before it, if there is one.
async function connect(source: 'mic' | 'keys', mode: string, app: Glue): Promise<void> {
  await ears?.stop();
  ears = null;
  ears = await listen({
    storageKey: STORAGE_KEY,
    modes: { battle: {}, boss: { [BOSS_PATTERN]: () => app.boss() } },
    mode,
    ...(source === 'keys' ? { source: 'keys' as const } : {}),
    onEvent: (e: EngineEvent) => { if (e.kind === 'sound' || e.kind === 'unknown') app.sound(e.kind === 'sound' ? e.label : 'unknown'); },
    onError: () => app.failed(),
    debug: app.debug(),
  });
}
const port = {
  setMode: (mode: string) => ears?.setMode(mode),
  pause: () => ears?.pause(),
  resume: () => ears?.resume(),
  inject: (sound: SoundId) => ears?.inject(sound),
  setDebug: (on: boolean) => ears?.setDebug(on),
  taught: (sound: string) => ears?.labels.includes(sound) ?? false,
  roomTaught: () => ears?.sounds.examples.some((e) => e.label === 'background') ?? false,
  teach: (sound: SoundId) => (ears as Ears).teach(sound, { ui: true, examples: TEACH_EXAMPLES_PER_SOUND, text: { record: TEACH_LINE[sound] } }),
  teachRoom: (ms: number) => (ears as Ears).teach('background', { ui: true, backgroundMs: ms, text: { title: ROOM_TEXT.title, recordBackground: ROOM_TEXT.body } }),
};
// tokk:end

const params = parseTestParams(window.location.search);
const randomSeed = (): number => Math.floor(Math.random() * 0xffffffff);

const app = {
  state: initialState(randomSeed()),
  keysMode: false,
  started: false,        // a game has begun (the title is gone)
  sfx: true,
  audio: null as ShooAudio | null,
  audioTried: false,
  token: 0,              // a new game or a restart makes the running flows stale
  mode: 'battle',
  lastFrameMs: 0,
  debug: new URLSearchParams(window.location.search).get('debug') === '1',   // the Under the hood toggle: not stored
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms / params.speed); });

function listeningText(): string {
  if (app.keysMode) return 'Keys only';
  return app.state.phase === 'paused' ? 'Listening paused' : 'Listening';
}

function refresh(): void {
  const s = app.state;
  render(s, { maxLives: params.lives, listening: listeningText(), keysMode: app.keysMode });
  const playing = s.phase === 'battle' || s.phase === 'paused';
  setControls({ pause: playing, settings: playing, pauseLabel: 'Pause' });
  const stage = byId('stage').dataset;
  stage.phase = s.phase;
  stage.wave = String(s.wave);
  stage.shooed = String(s.shooed);
  stage.mode = app.mode;
  stage.source = app.keysMode ? 'keys' : 'mic';
}

// Every input of the game goes through here: the rules, the screen, the engine mode and the phase flows.
function dispatch(input: GameInput): void {
  const before = app.state;
  const result = reduceWithHit(before, input);
  app.state = result.state;
  if (app.state.lives < before.lives) caption('[a candle goes out]');
  refresh();
  if (result.hit !== null) {
    showHit(result.hit, result.hit.type === 'hit' ? before.monsters.find((m) => m.id === (result.hit as { id: number }).id) : undefined);
  }
  const mode = modeFor(app.state);
  if (mode !== app.mode) {
    app.mode = mode;
    port.setMode(mode);
    byId('stage').dataset.mode = mode;
  }
  if (before.phase === app.state.phase) return;
  if (app.state.phase === 'between') void runBetween(app.token);
  else if (app.state.phase === 'lost') void runEnd('lost');
  else if (app.state.phase === 'won') void runEnd('dawn');
}

const glue: Glue = {
  sound: (label) => dispatch({ type: 'sound', label }),
  boss: () => dispatch({ type: 'pattern', pattern: BOSS_PATTERN }),
  debug: () => app.debug,
  failed: () => {
    // The Ears is finished. Keys keep working on a new Ears without a microphone, and the card offers to reconnect.
    app.keysMode = true;
    refresh();
    void connect('keys', app.mode, glue).then(() => { if (app.state.phase === 'paused') port.pause(); }).catch(() => undefined);
    showMic('lost', app.started);
  },
};

// ---- Sound effects: the microphone does not hear them ----
async function playEffect(name: EffectName): Promise<void> {
  if (!app.sfx || app.audio === null) return;
  port.pause();
  try {
    await app.audio.play(name);
  } finally {
    port.resume();
  }
}

function ensureAudio(): void {
  if (app.audioTried) return;
  app.audioTried = true;
  app.audio = createShooAudio();
  if (app.audio === null) app.sfx = false;
  setSfxLabel(app.sfx);
}

// ---- The flow of one game ----
function showRoom(): void {
  setRoom(ROOM_TEXT.title, ROOM_TEXT.body, ROOM_TEXT.button);
  showScreen('room');
}

function beginGame(): void {
  app.token += 1;
  app.started = true;
  const fresh = reduce(app.state, { type: 'restart', seed: randomSeed() });
  app.state = { ...fresh, wave: params.wave, lives: params.lives };
  app.mode = modeFor(app.state);
  port.setMode(app.mode);
  resetField();
  showBanner(null);
  showHud(true);
  showScreen(null);
  refresh();
  if (!app.keysMode && !port.roomTaught()) {
    showRoom();
    return;
  }
  dispatch({ type: 'roomDone' });
  void runIntro(app.token);
}

async function onRoomStart(): Promise<void> {
  const token = app.token;
  showScreen(null);
  try {
    await port.teachRoom(backgroundMsFor(params.speed));
    await whenDialogClosed();
  } catch {
    if (token === app.token) showRoom();   // the dialog was cancelled or could not open: ask again
    return;
  }
  if (token !== app.token) return;
  dispatch({ type: 'roomDone' });
  void runIntro(token);
}

// The new monster, shown large with its line. Its sound is taught if the model lacks it, otherwise "Get ready.".
async function runIntro(token: number): Promise<void> {
  const wave = app.state.wave;
  const kind = newKinds(wave)[0] ?? 'bat';
  const weak = MONSTERS[kind].weak;
  const needsTeaching = !app.keysMode && weak !== 'rhythm' && !port.taught(weak);
  setIntro(kind, INTRO_TEXT[kind], needsTeaching ? TEACH_LINE[weak as SoundId] : READY_TEXT);
  showScreen('intro');
  if (needsTeaching) {
    try {
      await port.teach(weak as SoundId);
      await whenDialogClosed();
    } catch {
      // Cancelled: the game goes on, and Settings can teach the sound again. Keys still work.
    }
  } else {
    await sleep(READY_MS);
  }
  if (token !== app.token) return;
  showScreen(null);
  showBanner(waveLabel(wave));
  await sleep(WAVE_LABEL_MS);
  if (token !== app.token) return;
  showBanner(null);
  dispatch({ type: 'introDone' });
}

async function runBetween(token: number): Promise<void> {
  setCleared(app.state.wave, app.state.shooed);
  showScreen('cleared');
  await Promise.all([playEffect('cleared'), sleep(BETWEEN_MS)]);
  if (token !== app.token || app.state.phase !== 'between') return;
  dispatch({ type: 'nextWave' });
  void runIntro(token);
}

async function runEnd(kind: 'lost' | 'dawn'): Promise<void> {
  const token = app.token;
  showHud(false);
  if (kind === 'lost') setLost(app.state.shooed);
  else setDawn(app.state.shooed);
  showScreen(kind);
  await playEffect(kind);
  if (token !== app.token) return;
}

// ---- Pause and settings ----
function pauseGame(): void {
  if (app.state.phase !== 'battle') return;
  dispatch({ type: 'pause' });
  port.pause();
  showScreen('paused');
}
function resumeGame(): void {
  if (app.state.phase !== 'paused') return;
  showScreen(null);
  port.resume();
  dispatch({ type: 'resume' });
}
const settingsOpen = (): boolean => !byId('settings-card').hidden;
function openSettings(): void {
  if (app.state.phase === 'battle') pauseGame();
  if (app.state.phase !== 'paused') return;
  setTeachAvailable(!app.keysMode);
  setSfxLabel(app.sfx);
  showScreen('settings-card');
}
function closeSettings(): void {
  showScreen(app.state.phase === 'paused' ? 'paused' : null);
}
async function teachAgain(sound: SoundId): Promise<void> {
  if (app.keysMode) return;
  showScreen(null);
  port.resume();
  try {
    await port.teach(sound);
    await whenDialogClosed();
  } catch {
    // Cancelled or failed: back to the settings.
  }
  port.pause();
  showScreen('settings-card');
}

// ---- The microphone card ----
async function startMicrophone(): Promise<void> {
  ensureAudio();
  try {
    await connect('mic', app.mode, glue);
  } catch {
    showMic('denied', false);
    return;
  }
  app.keysMode = false;
  showMic(null, false);
  beginGame();
}

async function playWithKeys(): Promise<void> {
  ensureAudio();
  showMic(null, false);
  if (app.started) return;   // in the middle of a game the keys Ears is already running
  try {
    await connect('keys', app.mode, glue);
  } catch (e) {
    console.error('Shoo!: keys mode could not start.', e);
    return;
  }
  app.keysMode = true;
  beginGame();
}

async function reconnect(): Promise<void> {
  if (!app.started) {
    await startMicrophone();
    return;
  }
  try {
    await connect('mic', app.mode, glue);
  } catch {
    await connect('keys', app.mode, glue).catch(() => undefined);
    showMic('denied', true);
    return;
  }
  app.keysMode = false;
  showMic(null, true);
  if (app.state.phase === 'paused') port.pause();
  refresh();
}

// ---- Keys ----
function onKey(ev: KeyboardEvent): void {
  if (ev.repeat || isDialogOpen()) return;
  // 1 to 4 are sounds in both modes: the same patterns as the microphone, through ears.inject().
  const action = actionForKey(keyInput(ev), { keysMode: true });
  if (action === null) return;
  ev.preventDefault();
  if (action.type === 'sound') {
    port.inject(action.sound);
  } else if (settingsOpen()) {
    closeSettings();
  } else if (app.state.phase === 'paused') {
    resumeGame();
  } else {
    pauseGame();
  }
}

// ---- The game clock ----
function frame(nowMs: number): void {
  if (app.state.phase === 'battle') {
    const dtMs = Math.min(nowMs - app.lastFrameMs, MAX_FRAME_MS) * params.speed;
    if (dtMs > 0) dispatch({ type: 'tick', dtMs });
  }
  app.lastFrameMs = nowMs;
  requestAnimationFrame(frame);
}

function init(): void {
  const style = document.createElement('style');
  style.textContent = styleText;
  document.head.append(style);
  setSfxLabel(app.sfx);
  setTeachAvailable(true);
  refresh();
  byId('start-mic').addEventListener('click', () => { void startMicrophone(); });
  byId('start-keys').addEventListener('click', () => { void playWithKeys(); });
  byId('room-start').addEventListener('click', () => { void onRoomStart(); });
  byId('mic-retry').addEventListener('click', () => { void reconnect(); });
  byId('mic-keys').addEventListener('click', () => { void playWithKeys(); });
  const hood = byId('under-the-hood');
  hood.setAttribute('aria-pressed', String(app.debug));
  hood.addEventListener('click', () => {
    app.debug = !app.debug;
    port.setDebug(app.debug);
    hood.setAttribute('aria-pressed', String(app.debug));
  });
  byId('pause').addEventListener('click', pauseGame);
  byId('resume').addEventListener('click', resumeGame);
  byId('settings').addEventListener('click', openSettings);
  byId('settings-close').addEventListener('click', closeSettings);
  byId('sfx').addEventListener('click', () => {
    ensureAudio();
    app.sfx = app.audio !== null && !app.sfx;
    setSfxLabel(app.sfx);
  });
  document.querySelectorAll<HTMLElement>('[data-teach]').forEach((b) => b.addEventListener('click', () => { void teachAgain(b.dataset.teach as SoundId); }));
  byId('lost-again').addEventListener('click', beginGame);
  byId('dawn-again').addEventListener('click', beginGame);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(frame);
}

init();
