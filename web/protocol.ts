// Messages between the page and the Worker, and the pure function that the Worker runs for each of them.
// No DOM type, no Node module, no clock, no randomness, no network. Audio only moves between the page's own threads.

import { createEngine } from '../core/engine';
import type { Engine, EngineEvent, Handlers } from '../core/engine';
import type { ClassifyResult, MatchEvent, SoundModel } from '../core/types';
import { WEB_ENVELOPE_RESOLUTION_MS } from './constants';

const MS_PER_SECOND = 1000;

// The one shared conversion from milliseconds to a sample count (core has only private copies).
export function msToSamples(ms: number, sampleRate: number): number {
  return Math.max(1, Math.round((ms * sampleRate) / MS_PER_SECOND));
}

// A small structural type for a message port, so this file needs no DOM types.
export interface MessagePortLike {
  postMessage(message: unknown, transfer?: unknown[]): void;
  onmessage?: ((event: { data: unknown }) => void) | null;
}

export type MainToWorker =
  | { type: 'init'; sounds: SoundModel; sampleRate: number; patterns: Record<string, string[]>; mode: string }
  | { type: 'chunk'; samples: Float32Array }
  | { type: 'setMode'; name: string }
  | { type: 'flush' }
  | { type: 'replaceSounds'; sounds: SoundModel }
  | { type: 'connect'; port: MessagePortLike };

export type WorkerToMain =
  | { type: 'match'; pattern: string; event: MatchEvent }
  | { type: 'segment'; t: number; durationMs: number; result: ClassifyResult }   // every classified segment, before its event
  | { type: 'event'; e: EngineEvent }
  | { type: 'envelope'; t0: number; min: Float32Array; max: Float32Array }
  | { type: 'error'; message: string };

export interface WorkerState {
  engine: Engine | null;
  sampleRate: number;
  patterns: Record<string, string[]>;
  mode: string;
  binSamples: number;
  binsDone: number;          // completed bins so far, over the whole session
  partialCount: number;      // samples in the bin that is not complete yet
  partialMin: number;
  partialMax: number;
  out: WorkerToMain[];       // filled by the engine callbacks during one call, emptied before the call returns
}

export function createWorkerState(): WorkerState {
  return {
    engine: null, sampleRate: 0, patterns: {}, mode: '', binSamples: 1,
    binsDone: 0, partialCount: 0, partialMin: Infinity, partialMax: -Infinity, out: [],
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function buildEngine(state: WorkerState, sounds: SoundModel): Engine {
  const modes: Record<string, Handlers> = {};
  for (const [name, list] of Object.entries(state.patterns)) {
    modes[name] = Object.fromEntries(list.map((pattern) => [
      pattern,
      (event: MatchEvent) => { state.out.push({ type: 'match', pattern, event }); },
    ]));
  }
  return createEngine({
    sounds,
    sampleRate: state.sampleRate,
    modes,
    mode: state.mode,
    onSegment: (r) => { state.out.push({ type: 'segment', t: r.t, durationMs: r.durationMs, result: r.result }); },
    onEvent: (e) => { state.out.push({ type: 'event', e }); },
  });
}

// Adds the samples to the envelope bins and returns one message for the bins this chunk completed.
function envelopeOf(state: WorkerState, samples: Float32Array): WorkerToMain | null {
  const mins: number[] = [];
  const maxs: number[] = [];
  const t0 = (state.binsDone * state.binSamples) / state.sampleRate;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    if (x < state.partialMin) state.partialMin = x;
    if (x > state.partialMax) state.partialMax = x;
    state.partialCount++;
    if (state.partialCount === state.binSamples) {
      mins.push(state.partialMin);
      maxs.push(state.partialMax);
      state.partialCount = 0;
      state.partialMin = Infinity;
      state.partialMax = -Infinity;
    }
  }
  if (mins.length === 0) return null;
  state.binsDone += mins.length;
  return { type: 'envelope', t0, min: Float32Array.from(mins), max: Float32Array.from(maxs) };
}

function handle(state: WorkerState, msg: unknown): void {
  if (typeof msg !== 'object' || msg === null || typeof (msg as { type?: unknown }).type !== 'string') {
    throw new Error('The Worker got a message without a type.');
  }
  const m = msg as Record<string, unknown> & { type: string };
  switch (m.type) {
    case 'init': {
      state.engine = null;
      state.sampleRate = m.sampleRate as number;
      state.patterns = m.patterns as Record<string, string[]>;
      state.mode = m.mode as string;
      state.binSamples = msToSamples(WEB_ENVELOPE_RESOLUTION_MS, state.sampleRate);
      state.binsDone = 0;
      state.partialCount = 0;
      state.partialMin = Infinity;
      state.partialMax = -Infinity;
      state.engine = buildEngine(state, m.sounds as SoundModel);
      return;
    }
    case 'chunk': {
      if (state.engine === null) throw new Error('Send init before the first chunk.');
      if (!(m.samples instanceof Float32Array)) throw new Error('A chunk needs samples as a Float32Array.');
      state.engine.push(m.samples);
      const env = envelopeOf(state, m.samples);
      if (env !== null) state.out.push(env);
      return;
    }
    case 'setMode': {
      if (state.engine === null) throw new Error('Send init before setMode.');
      state.engine.setMode(m.name as string);
      state.mode = m.name as string;
      return;
    }
    case 'flush': {
      if (state.engine === null) throw new Error('Send init before flush.');
      state.engine.flush();
      return;
    }
    case 'replaceSounds': {
      if (state.engine === null) throw new Error('Send init before replaceSounds.');
      // The core engine takes its model once, so a new engine is built. Its clock and its calibration restart.
      state.engine = buildEngine(state, m.sounds as SoundModel);
      return;
    }
    case 'connect':
      return;   // a transport message: worker.ts attaches the port
    default:
      throw new Error(`Unknown message type "${m.type}".`);
  }
}

// Returns the outgoing messages. It changes only `state`.
export function handleWorkerMessage(state: WorkerState, msg: unknown): WorkerToMain[] {
  state.out = [];
  try {
    handle(state, msg);
    const out = state.out;
    return out;
  } catch (e) {
    return [{ type: 'error', message: errorMessage(e) }];
  } finally {
    state.out = [];
  }
}

// The buffers that worker.ts transfers with a message.
export function transferListOf(msg: WorkerToMain): ArrayBuffer[] {
  return msg.type === 'envelope' ? [msg.min.buffer as ArrayBuffer, msg.max.buffer as ArrayBuffer] : [];
}
