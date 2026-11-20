// Messages between the page and the Worker, and the pure function that the Worker runs for each of them.
// No DOM type, no Node module, no clock, no randomness, no network. Audio only moves between the page's own threads.

import { createEngine } from '../core/engine';
import type { Engine, EngineEvent, Handlers } from '../core/engine';
import { MIN_EXAMPLES_PER_LABEL } from '../core/constants';
import { buildClips } from './clips';
import { teachFromRecordings, retrainLabel } from '../core/teach';
import type { Recording, TeachReport } from '../core/teach';
import type { ClassifyResult, MatchEvent, SoundModel } from '../core/types';
import { WEB_ENVELOPE_RESOLUTION_MS, WEB_TEACH_FILE_NAME, WEB_TEACH_MAX_RECORDING_MS } from './constants';
import { kindOfLabel } from './record-kind';
import type { RecordKind } from './record-kind';
import { createRecorder } from './recorder';
import type { Recorder, RecordOut } from './recorder';

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
  | { type: 'init'; sounds: SoundModel | null; sampleRate: number; patterns: Record<string, string[]>; mode: string; recordOnly?: boolean }
  | { type: 'chunk'; samples: Float32Array }
  | { type: 'setMode'; name: string }
  | { type: 'flush' }
  | { type: 'replaceSounds'; sounds: SoundModel }
  | { type: 'connect'; port: MessagePortLike }
  | { type: 'record-start'; label: string; kind: RecordKind }
  | { type: 'record-stop'; deleted: string[]; clips?: boolean }
  | { type: 'record-end'; sounds: SoundModel }
  | { type: 'record-cancel' }
  | { type: 'teach-recordings'; requestId: number; recordings: Recording[]; emptyFolders: string[] };

export type WorkerToMain =
  | { type: 'match'; pattern: string; event: MatchEvent }
  | { type: 'segment'; t: number; durationMs: number; result: ClassifyResult }   // every classified segment, before its event
  | { type: 'event'; e: EngineEvent }
  | { type: 'envelope'; t0: number; min: Float32Array; max: Float32Array }
  | RecordOut
  | { type: 'record-trained'; model: SoundModel; report: TeachReport }
  | { type: 'record-failed'; message: string }
  | { type: 'record-clips'; label: string; sampleRate: number; clips: { id: string; samples: Float32Array }[] }
  | { type: 'teach-result'; requestId: number; model: SoundModel; report: TeachReport }
  | { type: 'teach-failed'; requestId: number; message: string; counts: Record<string, number> | null }
  | { type: 'error'; message: string };

export interface WorkerState {
  engine: Engine | null;
  sounds: SoundModel | null;   // the current model: set by init, replaceSounds and record-end
  recorder: Recorder | null;  // not null while a teaching recording is open
  sampleRate: number;
  recordOnly: boolean;       // set by a record-only init: no engine, only recording and teach-recordings
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
    engine: null, sounds: null, recorder: null, sampleRate: 0, recordOnly: false, patterns: {}, mode: '', binSamples: 1,
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

// Starts the envelope again, together with a new engine, so the overlay's time axis stays consistent.
function resetEnvelope(state: WorkerState): void {
  state.binsDone = 0;
  state.partialCount = 0;
  state.partialMin = Infinity;
  state.partialMax = -Infinity;
}

function trainingFailure(label: string, e: unknown): string {
  if (e instanceof Error && e.name === 'TooFewExamplesError') {
    return `Tokk needs at least ${MIN_EXAMPLES_PER_LABEL} examples of "${label}" to learn it. Record again and make the sound more times. (${e.message})`;
  }
  return `Tokk could not learn "${label}" from this recording: ${errorMessage(e)} Record again.`;
}

// Closes the recording (flush, retrain with the kept ids) and answers with the model, or with the reason it failed.
function stopRecording(state: WorkerState, deleted: string[], clips: boolean): void {
  const recorder = state.recorder as Recorder;
  const { out, samples, ids, segments } = recorder.finish();
  state.out.push(...out);
  if (clips) {   // the page trains on its own folder (teach-recordings), so nothing is trained here
    const gone = new Set(deleted);
    state.out.push({
      type: 'record-clips', label: recorder.label, sampleRate: state.sampleRate,
      clips: buildClips({ label: recorder.label, kind: recorder.kind, samples, sampleRate: state.sampleRate, segments, keptIds: ids.filter((id) => !gone.has(id)) }),
    });
    return;
  }
  const recording: Recording = { label: recorder.label, file: WEB_TEACH_FILE_NAME, samples, sampleRate: state.sampleRate };
  const gone = new Set(deleted);
  const keep = recorder.kind === 'sound' ? ids.filter((id) => !gone.has(id)) : undefined;
  try {
    const { model, report } = retrainLabel(state.sounds as SoundModel, recorder.label, [recording], keep === undefined ? undefined : { keep });
    state.out.push({ type: 'record-trained', model, report });
  } catch (e) {
    state.out.push({ type: 'record-failed', message: trainingFailure(recorder.label, e) });
  }
}

// Trains a whole folder at once, as sounds:rebuild does. Works in any state.
function teachRecordings(state: WorkerState, m: { requestId: number; recordings: Recording[]; emptyFolders: string[] }): void {
  if (!Array.isArray(m.recordings) || !Array.isArray(m.emptyFolders)) throw new Error('teach-recordings needs recordings and emptyFolders.');
  try {
    const { model, report } = teachFromRecordings(m.recordings, { emptyFolders: m.emptyFolders });
    state.out.push({ type: 'teach-result', requestId: m.requestId, model, report });
  } catch (e) {
    if (e instanceof Error && e.name === 'TooFewExamplesError') {
      const counts = (e as Error & { counts: Record<string, number> }).counts;
      state.out.push({ type: 'teach-failed', requestId: m.requestId, counts, message: `Tokk needs at least ${MIN_EXAMPLES_PER_LABEL} examples of every sound to learn it. (${e.message})` });
    } else {
      state.out.push({ type: 'teach-failed', requestId: m.requestId, counts: null, message: `Tokk could not learn from these recordings: ${errorMessage(e)}` });
    }
  }
}

function handle(state: WorkerState, msg: unknown): void {
  if (typeof msg !== 'object' || msg === null || typeof (msg as { type?: unknown }).type !== 'string') {
    throw new Error('The Worker got a message without a type.');
  }
  const m = msg as Record<string, unknown> & { type: string };
  switch (m.type) {
    case 'init': {
      state.engine = null;
      state.recorder = null;
      state.recordOnly = m.recordOnly === true;
      state.sampleRate = m.sampleRate as number;
      state.patterns = m.patterns as Record<string, string[]>;
      state.mode = m.mode as string;
      state.binSamples = msToSamples(WEB_ENVELOPE_RESOLUTION_MS, state.sampleRate);
      resetEnvelope(state);
      state.sounds = m.sounds as SoundModel | null;
      if (state.recordOnly) return;   // no engine: patterns never run in this Worker
      if (state.sounds === null) throw new Error('init needs a model, unless it is record-only.');
      state.engine = buildEngine(state, state.sounds);
      return;
    }
    case 'chunk': {
      if (state.recordOnly) {
        if (!(m.samples instanceof Float32Array)) throw new Error('A chunk needs samples as a Float32Array.');
        if (state.recorder !== null) state.out.push(...state.recorder.push(m.samples));   // outside a recording the chunk is dropped
        return;
      }
      if (state.engine === null) throw new Error('Send init before the first chunk.');
      if (!(m.samples instanceof Float32Array)) throw new Error('A chunk needs samples as a Float32Array.');
      if (state.recorder !== null) {   // a recording is open: the chunk goes to the recorder only, not to the engine or the envelope
        state.out.push(...state.recorder.push(m.samples));
        return;
      }
      state.engine.push(m.samples);
      const env = envelopeOf(state, m.samples);
      if (env !== null) state.out.push(env);
      return;
    }
    case 'setMode': {
      if (state.recordOnly) throw new Error('setMode is not available in a record-only Worker.');
      if (state.engine === null) throw new Error('Send init before setMode.');
      state.engine.setMode(m.name as string);
      state.mode = m.name as string;
      return;
    }
    case 'flush': {
      if (state.recordOnly) throw new Error('flush is not available in a record-only Worker.');
      if (state.engine === null) throw new Error('Send init before flush.');
      if (state.recorder !== null) return;   // the end of a WAV source while a recording is open: the engine is not used
      state.engine.flush();
      return;
    }
    case 'replaceSounds': {
      if (state.recordOnly) throw new Error('replaceSounds is not available in a record-only Worker.');
      if (state.engine === null) throw new Error('Send init before replaceSounds.');
      // The core engine takes its model once, so a new engine is built. Its clock and its calibration restart.
      state.sounds = m.sounds as SoundModel;
      state.engine = buildEngine(state, state.sounds);
      return;
    }
    case 'record-start': {
      if (state.engine === null && !state.recordOnly) throw new Error('Send init before record-start.');
      if (state.sounds === null && !state.recordOnly) throw new Error('Send init before record-start.');
      if (state.recorder !== null) throw new Error('A recording is already open. Send record-end or record-cancel first.');
      if (typeof m.label !== 'string' || m.label === '') throw new Error('record-start needs a label.');
      // The kind comes from the label. A `kind` that disagrees is ignored.
      state.recorder = createRecorder({
        label: m.label, kind: kindOfLabel(m.label), sampleRate: state.sampleRate, maxSamples: msToSamples(WEB_TEACH_MAX_RECORDING_MS, state.sampleRate),
      });
      return;
    }
    case 'record-stop': {
      if (state.recorder === null) throw new Error('No recording is open. Send record-start first.');
      if (!Array.isArray(m.deleted)) throw new Error('record-stop needs the list of deleted ids.');
      stopRecording(state, m.deleted as string[], m.clips === true);
      return;
    }
    case 'record-end': {
      if (state.recorder === null) throw new Error('No recording is open. Send record-start first.');
      if (typeof m.sounds !== 'object' || m.sounds === null) throw new Error('record-end needs the model to use.');
      state.recorder = null;
      state.sounds = m.sounds as SoundModel;
      if (state.recordOnly) return;
      resetEnvelope(state);
      state.engine = buildEngine(state, state.sounds);
      return;
    }
    case 'record-cancel': {
      if (state.recorder === null) throw new Error('No recording is open. Send record-start first.');
      state.recorder = null;
      if (state.recordOnly) return;
      resetEnvelope(state);
      state.engine = buildEngine(state, state.sounds as SoundModel);
      return;
    }
    case 'teach-recordings': {
      teachRecordings(state, m as unknown as { requestId: number; recordings: Recording[]; emptyFolders: string[] });
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
  if (msg.type === 'record-clips') return msg.clips.map((c) => c.samples.buffer as ArrayBuffer);
  return msg.type === 'envelope' || msg.type === 'record-segment' ? [msg.min.buffer as ArrayBuffer, msg.max.buffer as ArrayBuffer] : [];
}
