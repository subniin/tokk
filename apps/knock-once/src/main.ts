// Knock Once for Yes: a séance game answered by knocking on a table. This file holds the Tokk wiring (between the markers)
// and the glue between the pure modules and the page. Nothing here sends audio anywhere or stores anything: the library
// stores the taught model (feature vectors) under STORAGE_KEY, and the envelope is only drawn.
import storyJson from '../story.json';
import { createEffectsAudio } from './audio';
import type { EffectsAudio } from './audio';
import { actionOf, MODE_QUESTION_PATTERNS, MODE_START_PATTERNS } from './bindings';
import type { Answer, ModeName, PatternAction } from './bindings';
import { startEctoplasm } from './canvas';
import {
  answered, effectCaption, effectFailed, effectsSwitched, effectsUnavailable, heardKnock, heardUnknown, micUnavailable, newGame,
  spiritAsks, spiritEnds, summoned, taught, teachCancelled, teachFailed,
} from './captions';
import type { EffectName, Via } from './captions';
import { KNOCK_LABEL, STORAGE_KEY, TEACH_KNOCK_EXAMPLES } from './constants';
import type { EnvelopeLike } from './ectoplasm';
import { createEffectRunner, planFor } from './effects';
import { advance, allows, transition } from './flow';
import type { FlowEvent, FlowState } from './flow';
import { actionForKey } from './keys';
import { validateStory } from './story';
import type { Story } from './story';
import { CANCEL_TEXT, TEACH_TEXT } from './teach-texts';
import {
  addCaption, applyTheme, byId, isDialogOpen, keyInput, renderControls, setEffectHook, setText, showEnding, showQuestion, showTeaching,
  showWaiting, whenDialogClosed,
} from './ui';

// What the wiring calls on the glue, and what the glue calls on the wiring. The glue never sees the object listen() returns.
interface Glue {
  act(action: PatternAction, via: Via): void;
  heard(kind: string, label: string): void;
  envelope(env: EnvelopeLike): void;
}
interface Port {
  setMode(mode: ModeName): void;
  pause(): void;
  resume(): void;
  teach(): Promise<unknown>;
  taught(): boolean;
}

// tokk:start
import { listen } from 'tokk';

let ears: Awaited<ReturnType<typeof listen>> | null = null;

async function startListening(app: Glue): Promise<void> {
  const handlers = (patterns: readonly string[]) => Object.fromEntries(patterns.map((p) => [p, () => app.act(actionOf(p), { by: 'knock' })]));
  ears = await listen({
    storageKey: STORAGE_KEY,
    modes: { start: handlers(MODE_START_PATTERNS), question: handlers(MODE_QUESTION_PATTERNS) },
    mode: 'start',
    onEvent: (e) => app.heard(e.kind, e.kind === 'sound' ? e.label : ''),
    onEnvelope: (env) => app.envelope(env),
  });
}
const port: Port = {
  setMode: (mode) => ears?.setMode(mode),
  pause: () => ears?.pause(),
  resume: () => ears?.resume(),
  teach: async () => ears?.teach(KNOCK_LABEL, { ui: true, examples: TEACH_KNOCK_EXAMPLES, text: TEACH_TEXT }),
  taught: () => ears?.labels.includes(KNOCK_LABEL) ?? false,
};
// tokk:end

const STATE_ENTRANCE = 'The room is waiting. Choose how to enter.';
const STATE_KEYBOARD = 'Microphone not in use (keyboard and buttons)';
const STATE_NOT_READY = 'Not ready: the knock sound is not taught yet.';
const STATE_LISTENING = 'Listening for knocks.';
const STATE_PAUSED = 'Listening is paused while a sound effect plays.';
const STATE_TEACHING = 'Teaching the knock.';

const app = {
  state: 'entrance' as FlowState,
  node: '',              // the story node on screen, or the one being moved to
  mic: false,            // listen() resolved
  ready: false,          // knock is taught
  muted: false,
  shortcutsOn: true,
  audio: null as EffectsAudio | null,
  audioTried: false,
};
const runner = createEffectRunner();
const ecto = startEctoplasm(byId<HTMLCanvasElement>('ecto'));
const checked = validateStory(storyJson);
const story: Story | null = checked.ok ? checked.story : null;

function stateLine(): string {
  if (app.state === 'entrance') return STATE_ENTRANCE;
  if (app.state === 'teaching') return STATE_TEACHING;
  if (!app.mic) return STATE_KEYBOARD;
  if (!app.ready) return STATE_NOT_READY;
  return app.state === 'between' && !app.muted && app.audio !== null ? STATE_PAUSED : STATE_LISTENING;
}
function refresh(): void {
  renderControls({ state: app.state, muted: app.muted, shortcutsOn: app.shortcutsOn, effectRunning: app.state === 'between' });
  setText('state', stateLine());
}
function move(event: FlowEvent): void {
  const next = transition(app.state, event);
  if (next !== null) app.state = next;
  refresh();
}

// The audio context is made once, inside a click or key handler of the player.
function ensureAudio(): void {
  if (app.audioTried) return;
  app.audioTried = true;
  app.audio = createEffectsAudio();
  if (app.audio === null) {
    app.muted = true;
    addCaption(effectsUnavailable());
  }
}

async function startMicrophone(): Promise<boolean> {
  if (app.mic) return true;
  try {
    await startListening(glue);
    app.mic = true;
    app.ready = port.taught();
    return true;
  } catch (e) {
    const caption = micUnavailable(e instanceof Error ? e.message : String(e));
    setText('notice', caption.text);
    addCaption(caption);
    return false;
  }
}

// The one teaching step. The flow stays in `teaching` until the dialog has left the page (also its saved screen).
async function runTeaching(): Promise<void> {
  if (isDialogOpen() || runner.busy) return;
  move('needsTeaching');
  if (app.state !== 'teaching') return;
  setText('notice', '');
  showTeaching();
  try {
    await port.teach();
    addCaption(taught());
  } catch (e) {
    const cancelled = e instanceof DOMException && e.name === 'AbortError';
    const caption = cancelled ? teachCancelled() : teachFailed(e instanceof Error ? e.message : String(e));
    setText('notice', cancelled ? CANCEL_TEXT : caption.text);
    addCaption(caption);
  }
  await whenDialogClosed();
  app.ready = port.taught();
  move('taught');
  port.setMode('start');
  showWaiting();
  refresh();
}

async function enterWithMicrophone(): Promise<void> {
  ensureAudio();
  if (!(await startMicrophone())) {
    enterWithKeyboard();
    return;
  }
  if (!app.ready) {
    await runTeaching();
    return;
  }
  move('begin');
  showWaiting();
}

function enterWithKeyboard(): void {
  ensureAudio();
  move('begin');
  showWaiting();
}

async function teachAgain(): Promise<void> {
  if (!allows(app.state, 'teach') || runner.busy || isDialogOpen()) return;
  ensureAudio();
  if (!(await startMicrophone())) return;
  await runTeaching();
}

// Shows the node and captions the spirit's line.
function showNode(s: Story, id: string): void {
  const n = s.nodes[id];
  if (n.type === 'ending') {
    showEnding(id, n.title, n.text);
    addCaption(spiritEnds(n.title, n.text));
  } else {
    showQuestion(id, n.text);
    addCaption(spiritAsks(n.text));
  }
}

// Every effect between two screens goes through runBetween: lock, caption, pause, play, wait, show, setMode, resume, unlock.
function between(s: Story, effect: EffectName, event: FlowEvent, target: string): void {
  const ending = s.nodes[target].type === 'ending';
  const muted = app.muted || app.audio === null;
  void runner.runBetween(planFor(effect, muted), {
    lock: () => move(event),
    caption: (name) => addCaption(effectCaption(name)),
    pause: () => { port.pause(); refresh(); },
    play: (name) => {
      setEffectHook(name);
      (app.audio as EffectsAudio).play(name);
    },
    wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    failed: () => addCaption(effectFailed()),
    show: () => { app.node = target; showNode(s, target); },
    setMode: () => port.setMode(ending ? 'start' : 'question'),
    resume: () => { setEffectHook(''); port.resume(); },
    unlock: () => move(ending ? 'reachedEnding' : 'shown'),
  });
}

// A summon or an answer, from a knock pattern, a key or a button: one code path for the story.
function act(action: PatternAction, via: Via): void {
  if (story === null || isDialogOpen()) return;
  if (action === 'summon') {
    if (!allows(app.state, 'summon') || runner.busy) return;
    addCaption(summoned(via));
    if (app.state === 'ending') addCaption(newGame());
    between(story, 'summon', 'summon', story.start);
    return;
  }
  if (!allows(app.state, 'answer') || runner.busy) return;
  const answer: Answer = action;
  addCaption(answered(answer, via));
  const target = advance(story, app.node, answer);
  between(story, story.nodes[target].type === 'ending' ? 'ending' : 'between', 'answer', target);
}

function toggleMute(): void {
  if (!allows(app.state, 'mute')) return;
  if (app.audio === null) {
    addCaption(effectsUnavailable());
    return;
  }
  app.muted = !app.muted;
  addCaption(effectsSwitched(!app.muted));
  refresh();
}

const glue: Glue = {
  act,
  heard(kind, label) {
    if (kind === 'sound' && label === KNOCK_LABEL) addCaption(heardKnock());
    else if (kind === 'unknown') addCaption(heardUnknown());
  },
  envelope: (env) => ecto.onEnvelope(env),
};

function onKey(ev: KeyboardEvent): void {
  if (ev.repeat || app.state === 'entrance') return;
  const action = actionForKey(keyInput(ev), { shortcutsOn: app.shortcutsOn, dialogOpen: isDialogOpen() });
  if (action === null) return;
  ev.preventDefault();
  if (action === 'teach') void teachAgain();
  else if (action === 'mute') toggleMute();
  else act(action, { by: 'key', key: ev.key });
}

function init(): void {
  applyTheme();
  refresh();
  if (story === null) {
    setText('notice', `The story cannot start: ${checked.ok ? '' : checked.problems.join(' ')}`);
    for (const id of ['enter-mic', 'enter-keyboard']) byId<HTMLButtonElement>(id).disabled = true;
    return;
  }
  byId('enter-mic').addEventListener('click', () => { void enterWithMicrophone(); });
  byId('enter-keyboard').addEventListener('click', enterWithKeyboard);
  byId('summon').addEventListener('click', () => act('summon', { by: 'button' }));
  byId('yes').addEventListener('click', () => act('yes', { by: 'button' }));
  byId('no').addEventListener('click', () => act('no', { by: 'button' }));
  byId('teach').addEventListener('click', () => { void teachAgain(); });
  byId('mute').addEventListener('click', toggleMute);
  byId('shortcuts').addEventListener('click', () => {
    app.shortcutsOn = !app.shortcutsOn;
    refresh();
  });
  document.addEventListener('keydown', onKey);
}

init();
