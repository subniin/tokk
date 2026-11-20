// Hands-Free reader: a small reading site that a person browses with mouth sounds. This file holds the Tokk wiring
// (between the markers) and the glue between the pure modules and the page. Nothing here sends audio anywhere.
import { MODE_OFF_PATTERNS, MODE_ON_PATTERNS } from './bindings';
import type { ModeName } from './bindings';
import { RECOGNITION_UPDATE_MS, SCAN_STEP_MS_DEFAULT, STORAGE_KEY } from './constants';
import { createHumScroll } from './hum-scroll';
import type { HumDirection } from './hum-scroll';
import { actionForKey } from './keys';
import { formatHash, parentOf, parseHash } from './nav';
import type { View } from './nav';
import { ARTICLES } from './articles';
import { createScan } from './scan';
import { allSteps, missingSteps } from './steps';
import type { ModelLike, TeachStep } from './steps';
import {
  CANCELLED_TEXT, didAlreadyAtList, didBack, didListening, didNeedsMicrophone, didNothingNoTarget, didNothingNoTiming, didOpened,
  didScrolled, heardHum, heardHumEnded, heardSound, heardUnknown, STEP_NAMES, withKey,
} from './text';
import type { ListeningState } from './text';
import { byId, isDialogOpen, keyInput, renderProgress, renderState, setHidden, setText } from './ui';
import { renderView } from './views';

// What the engine tells the page: the part of an engine event that the page reads.
interface HeardEvent { kind: string; label?: string; phase?: string }
// What the wiring calls on the glue. The glue never sees the object that listen() returns.
interface Glue {
  activate(pageMs: () => number): void;
  back(): void;
  toggle(): void;
  hum(direction: HumDirection, t: number, speed: number): void;
  heard(e: HeardEvent): void;
}

// tokk:start
import { listen } from 'tokk';
import type { MatchEvent } from 'tokk';

let ears: Awaited<ReturnType<typeof listen>> | null = null;

async function startListening(app: Glue): Promise<void> {
  const table: Record<string, (m: MatchEvent) => void> = {
    click: (m) => app.activate(() => (ears as NonNullable<typeof ears>).toPageTime(m.t)),
    'click click': () => app.back(),
    'click click click': () => app.toggle(),
    'hum.rise': (m) => app.hum('up', m.t, m.speed ?? 0),
    'hum.fall': (m) => app.hum('down', m.t, m.speed ?? 0),
  };
  const pick = (patterns: readonly string[]): Record<string, (m: MatchEvent) => void> => Object.fromEntries(patterns.map((p) => [p, table[p]]));
  ears = await listen({ storageKey: STORAGE_KEY, modes: { on: pick(MODE_ON_PATTERNS), off: pick(MODE_OFF_PATTERNS) }, mode: 'on', onEvent: (e) => app.heard(e) });
}
const taughtModel = (): ModelLike => ({ labels: ears?.labels ?? [], examples: ears?.sounds.examples ?? [] });
const setListeningMode = (mode: ModeName): void => ears?.setMode(mode);
const teachOne = async (step: TeachStep): Promise<unknown> => ears?.teach(step.label, { ui: true, examples: step.examples, text: step.text });
// tokk:end

const app = {
  started: false,       // a start button was pressed
  mic: false,           // listen() resolved
  shown: false,         // the content is shown
  ready: false,         // the click sound is taught
  listening: true,      // the mode is `on`
  paused: false,        // the user paused the scan
  teaching: false,      // the teaching sequence runs
  shortcutsOn: true,
};

const ARTICLE_IDS = ARTICLES.map((a) => a.id);
const MIC_UNAVAILABLE_TEXT = 'The microphone is not available. You can still use the keyboard and the mouse.';
const hum = createHumScroll();
let lastHumTextMs = Number.NEGATIVE_INFINITY;

const scan = createScan((target) => {
  setText('highlighted', target === null ? 'Highlighted: nothing' : `Highlighted: ${target.textContent?.trim() ?? ''}`);
});

const currentView = (): View => parseHash(location.hash, ARTICLE_IDS).view;
const say = (text: string, key?: string): void => setText('did', key === undefined ? text : withKey(text, key));

function listeningState(): ListeningState {
  if (!app.mic) return 'keyboard';
  if (!app.ready) return 'notReady';
  return app.listening ? 'on' : 'off';
}

// The one place that decides what is drawn and what runs (requirement 4.5, 6.5).
function refresh(): void {
  const active = app.shown && (!app.mic || app.listening);
  scan.update({ visible: active, running: active && !app.paused && !app.teaching });
  setHidden('state', !app.shown);
  renderState(listeningState());
  setText('toggle', app.listening ? 'Turn listening off' : 'Turn listening on');
  setText('pause', app.paused ? 'Resume scan' : 'Pause scan');
  setText('shortcuts', `Keyboard shortcuts: ${app.shortcutsOn ? 'on' : 'off'}`);
}

// Renders the view of the hash: title, focus on the heading, top of the page, a new scan (requirement 8.4).
function render(): void {
  const { view, notFound } = parseHash(location.hash, ARTICLE_IDS);
  const { heading, title } = renderView(byId('content'), view, notFound);
  document.title = `${title} - Hands-Free reader`;
  window.scrollTo({ top: 0, behavior: 'instant' });
  heading.focus({ preventScroll: true });
  scan.collect();
}

function showContent(): void {
  app.shown = true;
  setHidden('content', false);
  render();
  refresh();
}

function showControls(): void {
  app.started = true;
  setHidden('intro', true);
  setHidden('controls', false);
  setHidden('recognition', false);
}

function describe(target: HTMLElement): string {
  if (target.dataset.title !== undefined) return didOpened(target.dataset.title);
  return target.getAttribute('href') === formatHash({ kind: 'list' }) ? didBack() : didOpened(target.textContent?.trim() ?? '');
}

// `click` and the key K: activate the target that was highlighted at the page time of the sound (requirement 5.1).
function activate(pageMs: () => number, key?: string): void {
  let ms: number;
  try {
    ms = pageMs();
  } catch {
    say(didNothingNoTiming(), key);
    return;
  }
  byId('did').dataset.lookupPageMs = ms.toFixed(1);
  const target = scan.lookup(ms);
  if (target === null || !target.isConnected) {
    say(didNothingNoTarget(), key);
    return;
  }
  const text = describe(target);
  target.click();
  say(text, key);
}

function back(key?: string): void {
  const view = currentView();
  if (view.kind === 'list') {
    say(didAlreadyAtList(), key);
    return;
  }
  location.hash = formatHash(parentOf(view));
  say(didBack(), key);
}

function toggle(key?: string): void {
  if (!app.mic) {
    say(didNeedsMicrophone(), key);
    return;
  }
  app.listening = !app.listening;
  setListeningMode(app.listening ? 'on' : 'off');
  refresh();
  say(didListening(app.listening), key);
}

function togglePause(): void {
  app.paused = !app.paused;
  refresh();
}

const glue: Glue = {
  activate: (pageMs) => activate(pageMs),
  back: () => back(),
  toggle: () => toggle(),
  hum(direction, t, speed) {
    window.scrollBy({ top: hum.update({ t, speed, direction }), behavior: 'instant' });
    const now = performance.now();
    if (now - lastHumTextMs < RECOGNITION_UPDATE_MS) return;
    lastHumTextMs = now;
    setText('heard', heardHum(direction === 'up' ? 'rise' : 'fall', speed));
    say(didScrolled(direction));
  },
  heard(e) {
    if (e.kind === 'sound') setText('heard', heardSound(e.label ?? '', app.listening));
    else if (e.kind === 'unknown') setText('heard', heardUnknown(app.listening));
    else if (e.kind === 'continuous' && e.phase === 'end') {
      hum.end();
      lastHumTextMs = Number.NEGATIVE_INFINITY;
      setText('heard', heardHumEnded());
    }
  },
};

// Starts the microphone. A failure is shown as text and the page goes on as keyboard only (requirement 2.4).
async function startMicrophone(): Promise<boolean> {
  if (app.mic) return true;
  try {
    await startListening(glue);
    app.mic = true;
    return true;
  } catch (e) {
    setText('notice', `${e instanceof Error ? e.message : String(e)} ${MIC_UNAVAILABLE_TEXT}`);
    return false;
  }
}

// The teaching: one awaited call per step, in order. A step that is not saved ends the sequence (requirement 3).
async function runTeaching(steps: TeachStep[]): Promise<void> {
  if (app.teaching || isDialogOpen()) return;
  app.teaching = true;
  setText('notice', '');
  refresh();
  try {
    for (const step of steps) {
      renderProgress(STEP_NAMES.indexOf(step.label));
      await teachOne(step);
    }
  } catch (e) {
    const cancelled = e instanceof DOMException && e.name === 'AbortError';
    setText('notice', cancelled ? CANCELLED_TEXT : `${e instanceof Error ? e.message : String(e)} Press Teach again to try again.`);
  } finally {
    app.teaching = false;
    renderProgress(null);
  }
  app.ready = missingSteps(taughtModel()).every((s) => s.label !== 'click');
  app.listening = true;
  setListeningMode('on');
  showContent();
}

async function startWithMicrophone(): Promise<void> {
  showControls();
  if (!(await startMicrophone())) {
    showContent();
    return;
  }
  const missing = missingSteps(taughtModel());
  if (missing.length > 0) {
    await runTeaching(missing);
    return;
  }
  app.ready = true;
  showContent();
}

async function teachAgain(): Promise<void> {
  if (!app.started || app.teaching || isDialogOpen()) return;
  if (!(await startMicrophone())) return;
  await runTeaching(allSteps());
}

function onKey(ev: KeyboardEvent): void {
  if (ev.repeat || !app.started) return;
  const action = actionForKey(keyInput(ev), { shortcutsOn: app.shortcutsOn, dialogOpen: isDialogOpen() });
  if (action === null) return;
  ev.preventDefault();
  const key = ev.key;
  if (action === 'activate') activate(() => performance.now(), key);
  else if (action === 'back') back(key);
  else if (action === 'toggle') toggle(key);
  else if (action === 'pause') togglePause();
  else void teachAgain();
}

function init(): void {
  byId('start-mic').addEventListener('click', () => { void startWithMicrophone(); });
  byId('start-keyboard').addEventListener('click', () => {
    showControls();
    showContent();
  });
  byId('teach').addEventListener('click', () => { void teachAgain(); });
  byId('pause').addEventListener('click', togglePause);
  byId('toggle').addEventListener('click', () => toggle());
  byId('shortcuts').addEventListener('click', () => {
    app.shortcutsOn = !app.shortcutsOn;
    refresh();
  });
  const step = byId<HTMLInputElement>('step');
  step.value = String(SCAN_STEP_MS_DEFAULT);
  step.addEventListener('input', () => {
    const ms = Number(step.value);
    scan.setStepMs(ms);
    setText('step-value', `${(ms / 1000).toFixed(1)} s`);
  });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => {
    if (app.shown) {
      render();
      refresh();
    }
  });
}

init();
