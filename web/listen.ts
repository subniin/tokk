// listen(): microphone or WAV file -> Worker (engine) -> handlers on the main thread.
// Nothing is sent over the network except the GET of a WAV URL given as `source`. No sample is stored.

import { emptyModel } from '../core/classify/knn';
import { createEngine } from '../core/engine';
import type { EngineEvent, Handlers } from '../core/engine';
import { MIN_EXAMPLES_PER_LABEL, RECOMMENDED_EXAMPLES_PER_LABEL, SAMPLE_RATE_MIN_HZ } from '../core/constants';
import type { TeachReport } from '../core/teach';
import type { SoundModel } from '../core/types';
import { readWav } from '../core/wav';
import { WEB_CHUNK_MS, WEB_ENVELOPE_RESOLUTION_MS, WEB_STORAGE_KEY_DEFAULT } from './constants';
import { openMic } from './mic';
import type { MicHandle } from './mic';
import { checkModel, labelsOf } from './model';
import { msToSamples } from './protocol';
import type { MainToWorker, MessagePortLike, WorkerToMain } from './protocol';
import { mountOverlay } from './overlay/overlay';
import type { OverlayHandle } from './overlay/overlay';
import { createPageTime } from './page-time';
import { fingerprint, firstRunBase, loadStoredModel, saveStoredModel } from './teach-ui/storage';
import { validateLabel } from './teach-ui/state';
import { mountTeachDialog } from './teach-ui/teach-dialog';
import type { RecordMessage, TeachController, TeachDialogHandle } from './teach-ui/teach-dialog';
import { resolveTeachText } from './teach-ui/text';
import type { ResolvedTeachText, TeachText } from './teach-ui/text';
import { createTokkWorker } from './worker-factory';
import type { WorkerHandle } from './worker-factory';

const MS_PER_SECOND = 1000;

// A summary of the waveform: the smallest and the largest sample of each bin of binMs (10 ms), two numbers per bin.
// t0 is the sound time in s of the first bin (a cumulative sample count divided by the sample rate). The arrays are the
// ones the debug overlay reads too: do not modify them.
export interface Envelope {
  t0: number;
  binMs: number;
  min: Float32Array;
  max: Float32Array;
}

export interface ListenOptions {
  // The sound model (sounds.json). Leave it out for a first run: listening starts with an empty model at the rate of the
  // input, and no sound pattern matches until a label is taught with ears.teach().
  sounds?: SoundModel;
  on?: Handlers;
  modes?: Record<string, Handlers>;
  mode?: string;
  debug?: boolean;                      // true mounts the debug overlay (a panel with the waveform and the last results)
  source?: string | MediaStream;        // a WAV URL, a MediaStream, or none for the microphone
  storageKey?: string;                  // localStorage key of the taught model, default 'tokk:sounds'
  // Every event the engine makes: each sound, each continuous pitch event of a hum, and each unknown sound with its
  // nearest example (nearest is on unknown events only). A segment classified as background makes no event.
  onEvent?: (e: EngineEvent) => void;
  // The envelope of the input, about every 20 ms. It is a summary (two numbers per 10 ms), Tokk sends it nowhere, and
  // the app's own code must not send it or store it either (privacy rule). An error in this callback is logged.
  onEnvelope?: (env: Envelope) => void;
}

export interface TeachOptions {
  ui?: true;                            // this version teaches through the dialog only
  examples?: number;                    // how many sounds the dialog asks for, default 10, at least 5
  // Texts of the dialog in the app's voice, for this dialog only. Keys: title {label}, quiet, record {count}, recordHum,
  // recordBackground, training, count {heard} {target} {kept}, needMore {min} {kept}, review, failed, done, save,
  // again, cancel, close, saved, savedSessionOnly. A {name} is replaced by its value; the text is shown as plain text.
  // The Delete buttons, the accessible names, the example lines, the report and the other reasons keep their texts.
  text?: TeachText;
}

export interface Ears {
  setMode(name: string): void;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  readonly sounds: SoundModel;          // the current model: it changes after a Save in the teach dialog or an import
  // The taught labels of the current model, sorted, without background (read ears.sounds.examples for that), plus
  // hum when a hum pitch was taught. An empty array on a first run. A new array on every read.
  readonly labels: string[];
  // Maps a sound time t in s (MatchEvent.t) of the current engine to a page time in ms on the clock of performance.now().
  // The page time is when the sound reached the page, not when it was made: it is later by the delay of the input device
  // and the audio graph (unknown to the page), by up to one envelope bin (10 ms), and by the part of the message jitter
  // that the smallest-delay rule does not remove. It works across pause() and resume(). A rebuild of the engine (Save or
  // Cancel of a teach dialog, importSounds) restarts the sound clock, so a time from before it cannot be mapped: call
  // toPageTime inside the handler or soon after it. Throws an Error before any audio has arrived, a RangeError for a t
  // that is not finite. After stop() it keeps the last mapping.
  toPageTime(t: number): number;
  teach(label: string, options?: TeachOptions): Promise<TeachReport>;
  exportSounds(): string;               // the current model as JSON text (feature vectors only)
  importSounds(json: string): void;
}

type HandlerOptions = Pick<ListenOptions, 'on' | 'modes' | 'mode'>;

// Builds an engine and drops it, to get the error that createEngine gives for these handlers. A model can no longer make
// it fail (a hum pattern without a baseline is inert since Task 20), so it rejects a bad mode or pattern before a
// microphone, a WAV download or a Worker is used.
function throwawayEngine(o: HandlerOptions, sounds: SoundModel, sampleRate: number) {
  return createEngine({ sounds, sampleRate, on: o.on, modes: o.modes, mode: o.mode });
}

function failure(url: string, problem: string, cause?: unknown): Error {
  return new Error(`listen({ source: "${url}" }): ${problem}`, cause === undefined ? undefined : { cause });
}

async function fetchWav(url: string): Promise<{ samples: Float32Array; sampleRate: number }> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw failure(url, 'the request failed. Check the URL and your network connection.', e);
  }
  if (!res.ok) throw failure(url, `the server answered HTTP ${res.status}. Check that the file exists at this URL.`);
  try {
    return readWav(new Uint8Array(await res.arrayBuffer()));
  } catch (e) {
    throw failure(url, 'the file is not a 16-bit PCM WAV file.', e);
  }
}

// Sends the samples as chunks at real-time pace. A late timer sends every chunk that is due, in order.
// The clock paces only. Event times come from sample counts inside the engine.
function createPacer(samples: Float32Array, sampleRate: number, send: (chunk: Float32Array) => void, finish: () => void) {
  const chunkSamples = msToSamples(WEB_CHUNK_MS, sampleRate);
  let position = 0;               // samples sent
  let startedAtMs = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;

  const dueMsOf = (endSample: number): number => (endSample * MS_PER_SECOND) / sampleRate;

  const tick = (): void => {
    timer = undefined;
    const elapsedMs = performance.now() - startedAtMs;
    while (position < samples.length) {
      const end = Math.min(position + chunkSamples, samples.length);
      if (dueMsOf(end) > elapsedMs) break;
      send(samples.slice(position, end));
      position = end;
    }
    if (position >= samples.length) {
      done = true;
      finish();
      return;
    }
    const next = Math.min(position + chunkSamples, samples.length);
    timer = setTimeout(tick, Math.max(0, dueMsOf(next) - (performance.now() - startedAtMs)));
  };

  return {
    start(): void {
      if (done || timer !== undefined) return;
      startedAtMs = performance.now() - dueMsOf(position);   // continues where it stopped
      tick();
    },
    pause(): void {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
    stop(): void {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      done = true;
    },
  };
}

function rethrowLater(e: unknown): void {
  setTimeout(() => { throw e; }, 0);
}

// Starts listening and calls the handlers.
//
// First run: leave out `sounds` and listening starts with an empty model. No sound pattern matches until a label is
// taught with ears.teach(label, { ui: true }); ears.labels is [] until then. The empty model takes the sample rate of
// the input (microphone or WAV), so the first teach decides nothing about the rate. A hum.rise or hum.fall pattern is
// inert until a hum is taught. The taught model is stored as below, with a fixed base for a first run; a stored first-run
// model whose rate differs from the input's (another device) is ignored with a console warning and kept.
//
// Teaching: `ears.teach(label, { ui: true })` opens a dialog in the page. The new model is stored in localStorage under
// `storageKey` (default "tokk:sounds") as { version, base, model }: feature vectors only, never a recording. On the next
// start the stored model replaces `sounds`. `base` is a fingerprint of the `sounds` you pass here: when you ship a new
// sounds.json, the old personal model no longer matches, is ignored with a console warning, and users teach again.
// After Save, Cancel and `importSounds` the engine is rebuilt in the Worker, so patterns recognise again after the new
// engine's own calibration (1 s of the microphone running). While the dialog is open no handler is called.
export async function listen(options: ListenOptions): Promise<Ears> {
  const opts: ListenOptions = { ...options };
  const storageKey = opts.storageKey ?? WEB_STORAGE_KEY_DEFAULT;
  const given = opts.sounds;   // the model the developer shipped, or undefined for a first run
  const base = given === undefined ? firstRunBase() : fingerprint(given);
  let sounds: SoundModel = given ?? emptyModel(SAMPLE_RATE_MIN_HZ);   // replaced once the input rate is known
  const handlerSets: Record<string, Handlers> = opts.modes ?? { default: opts.on ?? {} };
  let currentMode = opts.modes ? (opts.mode as string) : 'default';
  const patterns: Record<string, string[]> = Object.fromEntries(Object.entries(handlerSets).map(([m, h]) => [m, Object.keys(h)]));

  // A stored model (taught earlier on this shipped model, or on a first run) wins when the handlers accept it.
  let stored = loadStoredModel(storageKey, base);
  if (stored !== null) {
    try {
      throwawayEngine(opts, stored, SAMPLE_RATE_MIN_HZ);
      if (given !== undefined) sounds = stored;
    } catch (e) {
      console.warn(`tokk: ignoring the stored model "${storageKey}": the handlers do not fit it (${e instanceof Error ? e.message : String(e)}).`);
      stored = null;
    }
  }
  const checkedModel = (sampleRate: number): SoundModel => stored ?? given ?? emptyModel(sampleRate);

  throwawayEngine(opts, checkedModel(SAMPLE_RATE_MIN_HZ), SAMPLE_RATE_MIN_HZ);   // rejects before any microphone, fetch or Worker is used

  const wav = typeof opts.source === 'string' ? await fetchWav(opts.source) : null;
  if (wav) throwawayEngine(opts, checkedModel(wav.sampleRate), wav.sampleRate);

  let closed = false;
  let startupError: string | null = null;
  let settled = false;
  let mic: MicHandle | null = null;
  let worker: WorkerHandle | null = null;
  let pacer: ReturnType<typeof createPacer> | null = null;
  let stopping: Promise<void> | null = null;
  let overlay: OverlayHandle | null = null;
  let contextRate = 0;                       // sample rate of the microphone or the WAV, set at start
  let paused = false;
  let teaching = false;                      // the dialog is recording: matches are dropped, pause and resume are ignored
  let dialogOpen = false;                    // a dialog exists, also on its saved screen
  let dialogHandle: TeachDialogHandle | null = null;
  let abortTeach: (() => void) | null = null;
  let recordListener: ((msg: RecordMessage) => void) | null = null;
  const pageTime = createPageTime();

  // A failure inside an overlay call is logged and never stops the handlers.
  const withOverlay = (call: (o: OverlayHandle) => void): void => {
    if (!overlay) return;
    try { call(overlay); } catch (e) { console.error('tokk: overlay error:', e); }
  };

  const tryMount = (sampleRate: number): OverlayHandle | null => {
    try {
      return mountOverlay({ sounds, sampleRate });
    } catch (e) {
      console.error('tokk: the debug overlay could not start:', e);
      return null;
    }
  };

  // Every Worker message passes through here.
  const route = (msg: WorkerToMain): void => {
    if (closed) return;
    switch (msg.type) {
      case 'segment':
        withOverlay((o) => o.onEvent({ t: msg.t, durationMs: msg.durationMs, result: msg.result }));
        return;
      case 'event':
        if (teaching || opts.onEvent === undefined) return;   // also a message that was already in flight when the dialog opened
        try { opts.onEvent(msg.e); } catch (e) { rethrowLater(e); }
        return;
      case 'envelope': {
        withOverlay((o) => o.onEnvelope(msg));
        const binSamples = msToSamples(WEB_ENVELOPE_RESOLUTION_MS, contextRate);
        const endBins = Math.round((msg.t0 * contextRate) / binSamples) + msg.min.length;
        pageTime.envelope(performance.now(), msg.t0, (endBins * binSamples) / contextRate);
        if (teaching || opts.onEnvelope === undefined) return;
        try {
          opts.onEnvelope({ t0: msg.t0, binMs: WEB_ENVELOPE_RESOLUTION_MS, min: msg.min, max: msg.max });
        } catch (e) {
          console.error('tokk: onEnvelope error:', e);   // it could repeat every 20 ms, so it is logged, not rethrown
        }
        return;
      }
      case 'match': {
        if (teaching) return;   // also a message that was already in flight when the dialog opened
        withOverlay((o) => o.onMatch(msg.pattern, msg.event));
        const handler = handlerSets[currentMode]?.[msg.pattern];
        if (handler) {
          try { handler(msg.event); } catch (e) { rethrowLater(e); }
        }
        return;
      }
      case 'record-progress':
      case 'record-segment':
      case 'record-limit':
      case 'record-trained':
      case 'record-failed':
        recordListener?.(msg);
        return;
      case 'error':
        console.error(`tokk: ${msg.message}`);
        return;
      default:
        return;
    }
  };

  const post = (msg: MainToWorker, transfer: Transferable[] = []): void => {
    (worker as WorkerHandle).worker.postMessage(msg, transfer);
  };

  const teardown = async (): Promise<void> => {
    overlay?.destroy();
    overlay = null;
    pacer?.stop();
    await mic?.close();
    worker?.dispose();
  };

  try {
    if (wav) {
      worker = createTokkWorker();
    } else {
      mic = await openMic(opts.source instanceof MediaStream ? opts.source : undefined);
      worker = createTokkWorker();
    }
    const w = worker.worker;
    w.onmessage = (e: MessageEvent<WorkerToMain>) => route(e.data);
    w.onerror = (e: ErrorEvent) => {
      const text = e.message || 'The Worker failed.';
      if (!settled) startupError = text;
      console.error(`tokk: Worker error: ${text}`);
    };

    const sampleRate = wav ? wav.sampleRate : (mic as MicHandle).sampleRate;
    contextRate = sampleRate;
    if (given === undefined) {
      // A first run: a stored first-run model is used only when it was taught at this rate.
      if (stored !== null && stored.sampleRate !== sampleRate) {
        console.warn(`tokk: ignoring the stored model "${storageKey}": it was taught at ${stored.sampleRate} Hz, but the input runs at ${sampleRate} Hz, so listening starts without sounds. The stored model is kept.`);
      }
      sounds = stored !== null && stored.sampleRate === sampleRate ? stored : emptyModel(sampleRate);
    }
    post({ type: 'init', sounds, sampleRate, patterns, mode: currentMode });
    if (opts.debug === true) overlay = tryMount(sampleRate);
    if (mic) {
      post({ type: 'connect', port: mic.workerPort as unknown as MessagePortLike }, [mic.workerPort]);
    } else if (wav) {
      pacer = createPacer(
        wav.samples,
        wav.sampleRate,
        (chunk) => post({ type: 'chunk', samples: chunk }, [chunk.buffer]),
        () => post({ type: 'flush' }),
      );
      pacer.start();
    }
    if (startupError !== null) throw new Error(`The Worker failed to start: ${startupError}`);
    settled = true;
  } catch (e) {
    closed = true;
    await teardown();
    throw e;
  }

  const controller: TeachController = {
    start: (label, kind) => post({ type: 'record-start', label, kind }),
    stop: (deleted) => post({ type: 'record-stop', deleted }),
    end: (model) => { pageTime.rebuild(); post({ type: 'record-end', sounds: model }); },
    cancel: () => { pageTime.rebuild(); post({ type: 'record-cancel' }); },
    subscribe: (handler) => {
      recordListener = handler;
      return () => { if (recordListener === handler) recordListener = null; };
    },
  };

  // Makes a model the current one: ears.sounds, localStorage (with the base) and the overlay (its colours come from the model).
  const adopt = (model: SoundModel): boolean => {
    sounds = model;
    const result = saveStoredModel(storageKey, base, model);
    if (opts.debug === true) {
      overlay?.destroy();
      overlay = tryMount(contextRate);
      withOverlay((o) => o.setState('listening'));
    }
    return result.ok;
  };

  const abortError = (): DOMException => new DOMException('The teach dialog was cancelled.', 'AbortError');

  const teach = (label: string, topts?: TeachOptions): Promise<TeachReport> => {
    const problem = validateLabel(label);
    if (problem !== null) return Promise.reject(new RangeError(`ears.teach(): ${problem}`));
    const examples = topts?.examples ?? RECOMMENDED_EXAMPLES_PER_LABEL;
    if (!Number.isInteger(examples) || examples < MIN_EXAMPLES_PER_LABEL) {
      return Promise.reject(new RangeError(`ears.teach(): examples must be a whole number of at least ${MIN_EXAMPLES_PER_LABEL}, got ${String(examples)}.`));
    }
    let texts: ResolvedTeachText;
    try {
      texts = resolveTeachText(topts?.text);
    } catch (e) {
      return Promise.reject(new RangeError(`ears.teach(): ${e instanceof Error ? e.message : String(e)}`));
    }
    if (topts?.ui !== true) {
      return Promise.reject(new Error('ears.teach() needs { ui: true } in this version. Call ears.teach("tap", { ui: true }).'));
    }
    if (closed) return Promise.reject(new Error('ears.teach(): listen() was stopped. Call listen() again first.'));
    if (paused) return Promise.reject(new Error('ears.teach(): listening is paused. Call ears.resume() first.'));
    if (dialogOpen) return Promise.reject(new Error('ears.teach(): a teach dialog is already open. Save or cancel it first.'));
    return new Promise<TeachReport>((resolve, reject) => {
      let saved = false;
      teaching = true;
      dialogOpen = true;
      withOverlay((o) => o.setState('teaching'));
      try {
        dialogHandle = mountTeachDialog({
          label,
          examples,
          model: sounds,
          text: texts,
          controller,
          onSave: (model, report) => {
            saved = true;
            teaching = false;
            const storedOk = adopt(model);
            resolve(report);
            return { stored: storedOk };
          },
          onCancel: () => {
            teaching = false;
            withOverlay((o) => o.setState('listening'));
            reject(abortError());
          },
          onClose: () => {
            teaching = false;
            dialogOpen = false;
            dialogHandle = null;
            abortTeach = null;
          },
        });
        abortTeach = () => {
          if (!saved) reject(abortError());
          dialogHandle?.destroy();
        };
      } catch (e) {
        teaching = false;
        dialogOpen = false;
        withOverlay((o) => o.setState('listening'));
        reject(e);
      }
    });
  };

  const importSounds = (json: string): void => {
    if (closed) throw new Error('ears.importSounds(): listen() was stopped. Call listen() again first.');
    if (dialogOpen) throw new Error('ears.importSounds(): a teach dialog is open. Save or cancel it first.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      throw new Error('ears.importSounds(): the text is not valid JSON. Pass the text that ears.exportSounds() or a sounds.json file gives.', { cause: e });
    }
    const checked = checkModel(parsed);
    if (!checked.ok) {
      throw new Error(checked.problem === 'shape'
        ? 'ears.importSounds(): the text is not a sound model. Pass the text that ears.exportSounds() or a sounds.json file gives.'
        : `ears.importSounds(): the model has version ${checked.version}, but this build supports another version. Teach the sounds again.`);
    }
    const next = checked.model;
    const handlers: HandlerOptions = opts.modes ? { modes: opts.modes, mode: currentMode } : { on: opts.on };
    try {
      throwawayEngine(handlers, next, SAMPLE_RATE_MIN_HZ);
      throwawayEngine(handlers, next, contextRate);
    } catch (e) {
      throw new Error(`ears.importSounds(): your handlers do not fit this model: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    pageTime.rebuild();
    post({ type: 'replaceSounds', sounds: next });
    adopt(next);
  };

  return {
    get sounds(): SoundModel { return sounds; },
    get labels(): string[] { return labelsOf(sounds); },
    toPageTime: (t: number): number => pageTime.toPageTime(t),
    teach,
    exportSounds: () => JSON.stringify(sounds),
    importSounds,
    setMode(name: string): void {
      throwawayEngine({ modes: Object.fromEntries(Object.keys(handlerSets).map((m) => [m, {}])), mode: Object.keys(handlerSets)[0] }, sounds, SAMPLE_RATE_MIN_HZ).setMode(name);
      if (closed) return;
      currentMode = name;
      post({ type: 'setMode', name });
    },
    pause(): void {
      if (closed || paused || teaching) return;
      paused = true;
      mic?.pause();
      pacer?.pause();
      pageTime.pause();
      withOverlay((o) => o.setState('paused'));
    },
    resume(): void {
      if (closed || !paused || teaching) return;
      paused = false;
      pageTime.resume(performance.now());
      mic?.resume();
      pacer?.start();
      withOverlay((o) => o.setState('listening'));
    },
    stop(): Promise<void> {
      if (stopping === null) {
        closed = true;
        abortTeach?.();
        stopping = teardown();
      }
      return stopping;
    },
  };
}
