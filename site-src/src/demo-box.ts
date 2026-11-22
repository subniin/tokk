// The behaviour of the demo box (Task 35, run B): teach a clap, record the room, react to `clap clap`, or play a recording
// through the same engine. Tokk is used only between the markers. Nothing here sends audio anywhere: the microphone goes to
// the Worker in the page, the recording is a file of the site that the page reads with a GET, and the stored model holds
// feature vectors only.
import {
  DEMO_COUNT_TEXT, DEMO_HEARD_MAX, DEMO_MODEL_URL, DEMO_PATTERNS, DEMO_RECORDING_URL, DEMO_ROOM_MS, DEMO_ROOM_QUIET_MS,
  DEMO_COUNTDOWN_TICK_MS, DEMO_STORAGE_KEY, DEMO_TEACH_EXAMPLES, MS_PER_SECOND,
} from './constants';
import type { DemoState } from './demo';

// tokk:start
import { listen, loadSounds, readWav, runSamples } from 'tokk';
import type { Ears, EngineEvent, MatchEvent } from 'tokk';

// One thing the engine heard: a sound at its time in s, or a pattern match at the time of its last sound.
export interface Heard { kind: 'sound' | 'match'; label: string; t: number }

let ears: Ears | null = null;

async function connect(onHeard: (h: Heard) => void, onLost: () => void): Promise<Ears> {
  const live = Object.fromEntries(DEMO_PATTERNS.map((p) => [p, (m: MatchEvent) => onHeard({ kind: 'match', label: p, t: m.t })]));
  ears = await listen({
    storageKey: DEMO_STORAGE_KEY,
    modes: { live },
    mode: 'live',
    onEvent: (e: EngineEvent) => { if (e.kind === 'sound') onHeard({ kind: 'sound', label: e.label, t: e.t }); },
    onError: onLost,
  });
  return ears;
}
const clapTaught = (e: Ears): boolean => e.labels.includes('clap');
const roomTaught = (e: Ears): boolean => e.sounds.examples.some((x) => x.label === 'background');
const teachClap = (e: Ears) => e.teach('clap', { ui: true, examples: DEMO_TEACH_EXAMPLES });
const teachRoom = (e: Ears) => e.teach('background', { ui: true, backgroundMs: DEMO_ROOM_MS });
async function disconnect(): Promise<void> {
  const old = ears;
  ears = null;
  await old?.stop();
}

// The same engine on the recording of the site: events and matches with their times in the recording, in order.
async function analyseRecording(): Promise<Heard[]> {
  const model = await loadSounds(DEMO_MODEL_URL);
  const res = await fetch(DEMO_RECORDING_URL);
  if (!res.ok) throw new Error(`The recording answered HTTP ${res.status}.`);
  const { samples, sampleRate } = readWav(new Uint8Array(await res.arrayBuffer()));
  const run = runSamples(samples, sampleRate, model, [...DEMO_PATTERNS]);
  const all: Heard[] = [
    ...run.events.flatMap((e): Heard[] => (e.kind === 'sound' ? [{ kind: 'sound', label: e.label, t: e.t }] : [])),
    ...run.matches.map((m): Heard => ({ kind: 'match', label: m.pattern, t: m.t })),
  ];
  return all.sort((a, b) => a.t - b.t || (a.kind === b.kind ? 0 : a.kind === 'sound' ? -1 : 1));
}
// tokk:end

const byId = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

export function initDemoBox(setState: (state: DemoState) => void): void {
  const big = byId('demo-big') as HTMLElement;
  const events = byId('demo-events') as HTMLElement;
  const count = byId('demo-count') as HTMLElement;
  const dots = byId('demo-dots') as HTMLElement;
  const left = byId('demo-left') as HTMLElement;
  const timer = byId('demo-timer') as HTMLElement;
  const demoBox = byId('demo');
  if (!demoBox) return;
  // The <audio> element is made here, so the page has no media element before a visitor asks for the recording.
  const audio = document.createElement('audio');
  audio.id = 'demo-audio';
  audio.preload = 'none';
  demoBox.append(audio);
  if ([big, events, count, dots, left, timer].some((e) => !e)) return;   // not the landing page
  let state: DemoState = 'idle';
  let token = 0;                       // every new action makes the running ones stale
  let shown: Heard[] = [];
  let frame = 0;
  let countdown: ReturnType<typeof setInterval> | undefined;
  const go = (next: DemoState): void => { state = next; setState(next); };

  const renderHeard = (): void => {
    const label = events.querySelector('b');
    events.replaceChildren(...(label ? [label] : []), ...shown.map((h) => {
      const span = document.createElement('span');
      span.textContent = h.kind === 'match' ? h.label : `${h.label} ${h.t.toFixed(2)} s`;
      if (h.kind === 'match') span.className = 'm';
      return span;
    }));
  };
  const clearLive = (): void => { shown = []; big.textContent = ''; renderHeard(); };
  const showHeard = (h: Heard): void => {
    shown = [...shown, h].slice(-DEMO_HEARD_MAX);
    renderHeard();
    if (h.kind === 'match') {
      big.textContent = h.label;
      big.classList.remove('pop');
      void big.offsetWidth;            // restarts the one-shot animation (it exists only without reduced motion)
      big.classList.add('pop');
    }
  };

  const stopCountdown = (): void => { if (countdown !== undefined) clearInterval(countdown); countdown = undefined; };
  // The dialog gives no progress, so the box counts the room sound by its own clock, after the quiet second of the dialog.
  const startCountdown = (): void => {
    const startedAtMs = performance.now() + DEMO_ROOM_QUIET_MS;
    const draw = (): void => {
      const doneMs = Math.min(DEMO_ROOM_MS, Math.max(0, performance.now() - startedAtMs));
      const secondsLeft = Math.max(1, Math.ceil((DEMO_ROOM_MS - doneMs) / MS_PER_SECOND));
      left.textContent = `${secondsLeft} s left`;
      timer.style.width = `${Math.round((doneMs / DEMO_ROOM_MS) * 100)}%`;
    };
    stopCountdown();
    draw();
    countdown = setInterval(draw, DEMO_COUNTDOWN_TICK_MS);
  };

  const stopPlayback = (): void => {
    cancelAnimationFrame(frame);
    audio.onended = null;
    audio.pause();
  };
  const fail = (): void => { stopCountdown(); stopPlayback(); go('fail'); };
  const idle = (): void => { stopCountdown(); stopPlayback(); go('idle'); };

  async function turnOnMicrophone(): Promise<void> {
    const mine = ++token;
    stopPlayback();
    await disconnect();
    clearLive();
    let e: Ears;
    try {
      e = await connect(
        (h) => { if (token === mine && state === 'live') showHeard(h); },
        () => { if (token === mine) { void disconnect(); fail(); } },
      );
    } catch {
      if (token === mine) fail();
      return;
    }
    if (token !== mine) { await disconnect(); return; }
    try {
      if (!clapTaught(e)) {
        dots.querySelectorAll('i').forEach((d) => d.classList.remove('on'));
        count.textContent = DEMO_COUNT_TEXT;
        go('teach');
        await teachClap(e);
        if (token !== mine) return;
      }
      if (!roomTaught(e)) {
        go('room');
        startCountdown();
        await teachRoom(e);
        stopCountdown();
        if (token !== mine) return;
      }
      go('live');
    } catch (err) {
      stopCountdown();
      if (token !== mine) return;
      await disconnect();
      if (isAbort(err)) idle(); else fail();
    }
  }

  async function hearRecording(): Promise<void> {
    const mine = ++token;
    stopPlayback();
    stopCountdown();
    await disconnect();                // the microphone must not hear the speakers
    if (token !== mine) return;
    clearLive();
    let timeline: Heard[];
    try {
      timeline = await analyseRecording();
    } catch {
      if (token === mine) idle();
      return;
    }
    if (token !== mine) return;
    let next = 0;
    const flush = (upToS: number): void => {
      while (next < timeline.length && timeline[next].t <= upToS) showHeard(timeline[next++]);
    };
    const tick = (): void => {
      if (token !== mine) return;
      flush(audio.currentTime);
      frame = requestAnimationFrame(tick);
    };
    audio.src = DEMO_RECORDING_URL;
    audio.currentTime = 0;
    audio.onended = () => { if (token === mine) { flush(Infinity); idle(); } };
    go('rec');
    try {
      await audio.play();
    } catch {
      if (token === mine) idle();
      return;
    }
    if (token === mine) frame = requestAnimationFrame(tick);
  }

  for (const id of ['demo-start', 'demo-retry']) byId(id)?.addEventListener('click', () => { void turnOnMicrophone(); });
  for (const id of ['demo-recording', 'demo-fail-recording', 'demo-live-recording']) byId(id)?.addEventListener('click', () => { void hearRecording(); });
}
