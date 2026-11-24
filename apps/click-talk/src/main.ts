// Click Talk: a two-sound communication board. This file holds the Tokk wiring (between the markers) and the glue between the
// rules (board.ts, patterns.ts, settings.ts), the screen (view.ts, caregiver.ts) and the effects (speech.ts, alarm.ts).
// Nothing here sends audio anywhere: the library stores the taught model (feature vectors) under MODEL_STORAGE_KEY, and the
// settings (text, numbers and counts, never audio) are stored under SETTINGS_KEY.
import { createAlarm } from './alarm';
import { INITIAL_BOARD, reduce } from './board';
import type { BoardInput, BoardState } from './board';
import { renderCaregiver, resetCaregiver } from './caregiver';
import {
  ALARM_TEST_MS, BURST_GAP_MAX_MS, BURST_TIMER_MARGIN_MS, HELP_ARM_MS, MODEL_STORAGE_KEY, MS_PER_SECOND, SPEAK_SHOW_MS, TEACH_EXAMPLES,
} from './constants';
import { actionForKey } from './keys';
import { inputForPattern, patternsFor, settleBurst } from './patterns';
import type { Mode } from './patterns';
import { withFrequent } from './phrases';
import { countSaid, loadSettings, saveSettings, SETTINGS_KEY } from './settings';
import type { Settings } from './settings';
import { cancelSpeech, loadVoices, NO_VOICE_TEXT, speak } from './speech';
import type { VoiceLike } from './speech';
import styleText from './style.css' with { type: 'text' };
import { BACKGROUND_LINE, TEACH_LINE, TEACH_TITLE } from './teach-texts';
import { backgroundMsFor } from './test-params';
import {
  byId, hideSpeaking, initStatic, isDialogOpen, keyBelongsToControl, keyInput, renderBoard, renderSounds, setListening, setSpeakNote, showIdle,
  showHeard, showHelp, showMic, showScreen, showSpeaking, whenDialogClosed,
} from './view';
import type { ListeningState, ScreenName } from './view';

// What the wiring calls on the glue.
interface Glue {
  pattern(mode: Mode, pattern: string): void;
  sound(label: string, tS: number): void;
  audioTo(tS: number): void;
  failed(): void;
  debug(): boolean;
}

// tokk:start
import { listen } from 'tokk';
import type { Ears } from 'tokk';

let ears: Ears | null = null;

// The handlers of one mode: every pattern of the mode goes to the board through the glue.
const handlers = (mode: Mode, app: Glue): Record<string, () => void> => Object.fromEntries(patternsFor(mode).map((p) => [p, () => app.pattern(mode, p)]));

// Starts listening with the microphone, or without one for 'keys'. It stops the Ears before it, if there is one.
async function connect(source: 'mic' | 'keys', mode: Mode, app: Glue): Promise<void> {
  await ears?.stop();
  ears = null;
  ears = await listen({
    storageKey: MODEL_STORAGE_KEY,
    modes: { two: handlers('two', app), one: handlers('one', app) },
    mode,
    ...(source === 'keys' ? { source: 'keys' as const } : {}),
    onEvent: (e) => { if (e.kind === 'sound') app.sound(e.label, e.t); },
    onEnvelope: (env) => app.audioTo(env.t0 + (env.min.length * env.binMs) / MS_PER_SECOND),
    onError: () => app.failed(),
    debug: app.debug(),
  });
}
const port = {
  setMode: (mode: Mode) => ears?.setMode(mode),
  pause: () => ears?.pause(),
  resume: () => ears?.resume(),
  inject: (sound: 'click' | 'pop') => ears?.inject(sound),
  setDebug: (on: boolean) => ears?.setDebug(on),
  taught: (sound: string) => ears?.labels.includes(sound) ?? false,
  roomTaught: () => ears?.sounds.examples.some((e) => e.label === 'background') ?? false,
  teach: (sound: 'click' | 'pop') => (ears as Ears).teach(sound, { ui: true, examples: TEACH_EXAMPLES, text: { title: TEACH_TITLE[sound], record: TEACH_LINE[sound] } }),
  teachRoom: (ms: number) => (ears as Ears).teach('background', { ui: true, backgroundMs: ms, text: { title: TEACH_TITLE.background, recordBackground: BACKGROUND_LINE } }),
};
// tokk:end

type Timer = ReturnType<typeof setTimeout>;

const app = {
  settings: loadSettings(null) as Settings,
  board: INITIAL_BOARD as BoardState,
  lastSaid: null as string | null,
  screen: 'welcome' as ScreenName,
  keysMode: false,
  nowS: 0,                    // the latest audio time the page has seen, in s (a sample count over the sample rate)
  scanTimer: undefined as Timer | undefined,
  speakToken: 0,              // a new speech or help makes the running speech stale
  noVoiceShown: false,        // "No offline voice" is shown once
  helpAtMs: 0,
  voices: [] as VoiceLike[],
  debug: new URLSearchParams(window.location.search).get('debug') === '1',   // the Under the hood toggle: not stored
  waiting: false,             // a returning user with no click or key yet: Chrome keeps the audio suspended, so nothing is heard
};
const burst = { times: [] as number[], timer: undefined as Timer | undefined };
const alarm = createAlarm();
const backgroundMs = backgroundMsFor(window.location.search);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

const categories = () => withFrequent(app.settings.phrases, app.settings.counts, app.lastSaid);
const busy = (): boolean => app.board.level === 'speaking' || app.board.level === 'help';
const micModal = (): boolean => !byId('mic').hidden && !byId('mic').classList.contains('mid');

function persist(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, saveSettings(app.settings));
  } catch {
    // Storage is blocked: the settings last for this visit only.
  }
}

function syncData(): void {
  const d = byId('app').dataset;
  d.mode = app.settings.mode;
  d.source = app.keysMode ? 'keys' : 'mic';
}

function refresh(): void {
  renderBoard(app.board, categories(), { mode: app.settings.mode, keysMode: app.keysMode, lastSaid: app.lastSaid });
  syncData();
}

function show(name: ScreenName): void {
  app.screen = name;
  showScreen(name);
  showIdle(app.waiting && name === 'board');
}

// The status line: while the page waits for its first click or key, 'on' reads 'Not listening yet'.
function listening(state: ListeningState): void {
  setListening(app.waiting && state === 'on' ? 'idle' : state);
}

// The first pointerdown or keydown ends the wait. Returns true when it did, so the caller can ignore that key.
function endWaiting(): boolean {
  if (!app.waiting) return false;
  app.waiting = false;
  showIdle(false);
  if (byId('live').dataset.state === 'idle') setListening('on');
  return true;
}

// ---- Listening on and off: the microphone does not hear what the app plays ----
function pauseEars(): void {
  port.pause();
  listening('paused');
}
function resumeEars(): void {
  port.resume();
  listening(app.keysMode ? 'off' : 'on');
}

// ---- One sound mode: the frame moves by itself ----
function armScan(): void {
  clearTimeout(app.scanTimer);
  const level = app.board.level;
  if (app.settings.mode !== 'one' || app.screen !== 'board' || micModal() || (level !== 'categories' && level !== 'phrases')) return;
  app.scanTimer = setTimeout(() => dispatch({ type: 'tick' }), app.settings.scanMs);
}

// ---- Two sounds then silence: exactly one choose (design.md) ----
function clearBurst(): void {
  clearTimeout(burst.timer);
  burst.times = [];
}
function armBurst(): void {
  clearTimeout(burst.timer);
  burst.timer = setTimeout(settle, BURST_GAP_MAX_MS + BURST_TIMER_MARGIN_MS);
}
function settle(): void {
  const result = settleBurst(burst.times, app.nowS);
  if (result === 'wait') {
    armBurst();
    return;
  }
  burst.times = [];
  if (result === 'choose') dispatch({ type: 'choose' });
}

// ---- The board ----
function dispatch(input: BoardInput): void {
  if (app.screen !== 'board') return;
  const before = app.board;
  app.board = reduce(before, input, categories());
  if (app.board.level !== before.level) {
    if (app.board.level === 'speaking') void runSpeak(app.board.said as string, categories()[app.board.category].id);
    else if (app.board.level === 'help') startHelp();
    else if (before.level === 'help') endHelp();
  }
  refresh();
  armScan();
}

async function runSpeak(phrase: string, categoryId: string): Promise<void> {
  const token = ++app.speakToken;
  clearBurst();
  pauseEars();
  app.settings = { ...app.settings, counts: countSaid(app.settings.counts, phrase) };
  app.lastSaid = phrase;
  persist();
  showSpeaking(phrase, categoryId);
  const shown = sleep(SPEAK_SHOW_MS);
  const voiced = await speak(phrase, app.settings);
  if (token !== app.speakToken) return;
  if (!voiced && !app.noVoiceShown) {
    app.noVoiceShown = true;
    setSpeakNote(NO_VOICE_TEXT);
  }
  await shown;
  if (token !== app.speakToken) return;
  hideSpeaking();
  resumeEars();
  dispatch({ type: 'spoken' });
}

function startHelp(): void {
  app.speakToken += 1;
  cancelSpeech();
  hideSpeaking();
  clearBurst();
  pauseEars();
  alarm.start();
  app.helpAtMs = performance.now();
  showHelp(true);
}
function endHelp(): void {
  alarm.stop();
  showHelp(false);
  resumeEars();
}
function stopHelp(): void {
  if (app.board.level !== 'help' || performance.now() - app.helpAtMs < HELP_ARM_MS) return;
  dispatch({ type: 'stopHelp' });
}

function openBoard(): void {
  app.board = INITIAL_BOARD;
  show('board');
  renderSounds(app.settings.mode, app.keysMode);
  listening(app.keysMode ? 'off' : 'on');
  refresh();
  armScan();
}

// ---- The glue the wiring calls ----
const glue: Glue = {
  pattern: (mode, pattern) => {
    if (mode !== app.settings.mode) return;
    const input = inputForPattern(mode, pattern);
    if (input !== null) dispatch(input);
  },
  sound: (label, tS) => {
    if (label === 'click' || label === 'pop') showHeard(label);
    app.nowS = Math.max(app.nowS, tS);
    if (label !== (app.settings.mode === 'two' ? 'pop' : 'click') || app.screen !== 'board' || busy()) return;
    burst.times.push(tS);
    armBurst();
  },
  audioTo: (tS) => { app.nowS = Math.max(app.nowS, tS); },
  debug: () => app.debug,
  failed: () => {
    // The Ears is finished. Keys keep working on a new Ears without a microphone, and the card offers to reconnect.
    app.keysMode = true;
    renderSounds(app.settings.mode, true);
    listening(busy() ? 'paused' : 'off');
    syncData();
    refresh();
    void connect('keys', app.settings.mode, glue).then(() => { if (busy()) port.pause(); }).catch(() => undefined);
    showMic('lost', app.screen === 'board');
  },
};

// ---- Teaching ----
// Teaches what the model lacks: click, pop (two sounds), then the room. With `force` it teaches the sounds again.
async function teachMissing(force: boolean): Promise<void> {
  const sounds: ('click' | 'pop')[] = app.settings.mode === 'two' ? ['click', 'pop'] : ['click'];
  try {
    for (const sound of sounds) {
      if (!force && port.taught(sound)) continue;
      await port.teach(sound);
      await whenDialogClosed();
    }
    if (!force && !port.roomTaught()) {
      await port.teachRoom(backgroundMs);
      await whenDialogClosed();
    }
  } catch {
    // Cancelled or failed: the board opens anyway, and Settings can teach the sounds again. Keys still work.
  }
}

// ---- The microphone ----
// Starts listening with the microphone, teaches what is missing, and opens the board. A refusal shows the card.
async function begin(): Promise<void> {
  try {
    await connect('mic', app.settings.mode, glue);
  } catch {
    showMic('denied', false);
    return;
  }
  app.keysMode = false;
  showMic(null, false);
  await teachMissing(false);
  openBoard();
}

async function useKeys(): Promise<void> {
  if (!app.keysMode) {
    try {
      await connect('keys', app.settings.mode, glue);
    } catch (e) {
      console.error('Click Talk: keys mode could not start.', e);
      return;
    }
    app.keysMode = true;
  }
  showMic(null, false);
  if (app.screen === 'board' || app.screen === 'settings') {
    renderSounds(app.settings.mode, true);
    listening('off');
    refresh();
    armScan();
  } else {
    openBoard();
  }
}

async function reconnect(): Promise<void> {
  try {
    await connect('mic', app.settings.mode, glue);
  } catch {
    await connect('keys', app.settings.mode, glue).catch(() => undefined);
    showMic('lost', app.screen === 'board');
    return;
  }
  app.keysMode = false;
  showMic(null, false);
  renderSounds(app.settings.mode, false);
  listening(busy() ? 'paused' : 'on');
  if (busy()) port.pause();
  refresh();
}

// ---- The caregiver screen ----
function applySettings(next: Settings): void {
  const modeChanged = next.mode !== app.settings.mode;
  app.settings = next;
  persist();
  if (!modeChanged) return;
  port.setMode(next.mode);
  renderSounds(next.mode, app.keysMode);
  syncData();
  if (!app.keysMode) void teachMissing(false);
}

function openSettings(): void {
  if (app.screen !== 'board' || busy()) return;
  clearTimeout(app.scanTimer);
  clearBurst();
  resetCaregiver();
  renderCaregiver(caregiverApi);
  show('settings');
}

function closeSettings(): void {
  resetCaregiver();
  openBoard();
}

const caregiverApi = {
  settings: () => app.settings,
  change: applySettings,
  voices: () => app.voices,
  canTeach: () => !app.keysMode,
  teachAgain: () => { void teachMissing(true).then(() => renderCaregiver(caregiverApi)); },
  testAlarm: () => {
    if (alarm.running()) return;
    pauseEars();
    alarm.start();
    void sleep(ALARM_TEST_MS).then(() => {
      if (app.board.level === 'help') return;
      alarm.stop();
      resumeEars();
    });
  },
  back: closeSettings,
};

// ---- Keys ----
function onKey(ev: KeyboardEvent): void {
  alarm.prime();
  if (endWaiting()) return;                // the key that starts the listening does nothing else
  if (ev.repeat) return;
  const state = { mode: app.settings.mode, level: app.board.level };
  if (state.level === 'help') {
    if (actionForKey(keyInput(ev), state)?.type === 'stopHelp') {
      ev.preventDefault();
      stopHelp();
    }
    return;
  }
  if (app.screen !== 'board' || micModal() || isDialogOpen() || keyBelongsToControl(ev)) return;
  const action = actionForKey(keyInput(ev), state);
  if (action === null || action.type !== 'sound') return;
  ev.preventDefault();
  port.inject(action.sound);
}

function init(): void {
  const style = document.createElement('style');
  style.textContent = styleText;
  document.head.append(style);
  initStatic();
  const refreshVoices = (): void => { void loadVoices().then((v) => { app.voices = v; }); };
  refreshVoices();
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.addEventListener('voiceschanged', refreshVoices);

  let stored: string | null = null;
  let model: string | null = null;
  try {
    stored = localStorage.getItem(SETTINGS_KEY);
    model = localStorage.getItem(MODEL_STORAGE_KEY);
  } catch {
    // Storage is blocked: every visit is a first run.
  }
  app.settings = loadSettings(stored);

  byId('welcome-start').addEventListener('click', () => { show('mode'); });
  for (const mode of ['two', 'one'] as const) {
    byId(`mode-${mode}`).addEventListener('click', () => {
      app.settings = { ...app.settings, mode };
      persist();
      syncData();
      void begin();
    });
  }
  byId('settings-open').addEventListener('click', openSettings);
  const hood = byId('under-the-hood');
  hood.setAttribute('aria-pressed', String(app.debug));
  hood.addEventListener('click', () => {
    app.debug = !app.debug;
    port.setDebug(app.debug);
    hood.setAttribute('aria-pressed', String(app.debug));
    hood.blur();   // Space and Enter are the main inputs: the next one must reach the board, not this button
  });
  byId('mic-retry').addEventListener('click', () => { void (byId('mic').dataset.kind === 'lost' ? reconnect() : begin()); });
  byId('mic-keys').addEventListener('click', () => { void useKeys(); });
  byId('help').addEventListener('click', stopHelp);
  document.addEventListener('pointerdown', () => { alarm.prime(); endWaiting(); });
  document.addEventListener('keydown', onKey);

  // A returning user (a stored model and stored settings) goes straight to the board.
  if (stored !== null && model !== null) {
    app.waiting = navigator.userActivation?.hasBeenActive === false;
    openBoard();
    void begin();
  } else {
    syncData();
    show('welcome');
  }
}

init();
