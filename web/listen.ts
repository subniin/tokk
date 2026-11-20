// listen(): microphone or WAV file -> Worker (engine) -> handlers on the main thread.
// Nothing is sent over the network except the GET of a WAV URL given as `source`. No sample is stored.

import { createEngine } from '../core/engine';
import type { Handlers } from '../core/engine';
import { SAMPLE_RATE_MIN_HZ } from '../core/constants';
import type { SoundModel } from '../core/types';
import { readWav } from '../core/wav';
import { WEB_CHUNK_MS } from './constants';
import { openMic } from './mic';
import type { MicHandle } from './mic';
import { msToSamples } from './protocol';
import type { MainToWorker, MessagePortLike, WorkerToMain } from './protocol';
import { createTokkWorker } from './worker-factory';
import type { WorkerHandle } from './worker-factory';

const MS_PER_SECOND = 1000;

export interface ListenOptions {
  sounds: SoundModel;
  on?: Handlers;
  modes?: Record<string, Handlers>;
  mode?: string;
  debug?: boolean;                      // accepted and ignored until the overlay exists
  source?: string | MediaStream;        // a WAV URL, a MediaStream, or none for the microphone
}

export interface Ears {
  setMode(name: string): void;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  readonly sounds: SoundModel;
}

type EngineOptionsLike = Pick<ListenOptions, 'sounds' | 'on' | 'modes' | 'mode'>;

// Builds an engine and drops it, to get the error that createEngine gives for these options.
function throwawayEngine(o: EngineOptionsLike, sampleRate: number) {
  return createEngine({ sounds: o.sounds, sampleRate, on: o.on, modes: o.modes, mode: o.mode });
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

export async function listen(options: ListenOptions): Promise<Ears> {
  const opts: ListenOptions = { ...options };
  const { sounds } = opts;
  const handlerSets: Record<string, Handlers> = opts.modes ?? { default: opts.on ?? {} };
  let currentMode = opts.modes ? (opts.mode as string) : 'default';
  const patterns: Record<string, string[]> = Object.fromEntries(Object.entries(handlerSets).map(([m, h]) => [m, Object.keys(h)]));

  throwawayEngine(opts, SAMPLE_RATE_MIN_HZ);   // rejects before any microphone, fetch or Worker is used

  const wav = typeof opts.source === 'string' ? await fetchWav(opts.source) : null;
  if (wav) throwawayEngine(opts, wav.sampleRate);

  let closed = false;
  let startupError: string | null = null;
  let settled = false;
  let mic: MicHandle | null = null;
  let worker: WorkerHandle | null = null;
  let pacer: ReturnType<typeof createPacer> | null = null;
  let stopping: Promise<void> | null = null;

  // Every Worker message passes through here.
  const route = (msg: WorkerToMain): void => {
    if (closed) return;
    switch (msg.type) {
      case 'match': {
        const handler = handlerSets[currentMode]?.[msg.pattern];
        if (handler) {
          try { handler(msg.event); } catch (e) { rethrowLater(e); }
        }
        return;
      }
      case 'error':
        console.error(`tokk: ${msg.message}`);
        return;
      default:
        return;   // `event` and `envelope` are used by the overlay (Task 15)
    }
  };

  const post = (msg: MainToWorker, transfer: Transferable[] = []): void => {
    (worker as WorkerHandle).worker.postMessage(msg, transfer);
  };

  const teardown = async (): Promise<void> => {
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
    post({ type: 'init', sounds, sampleRate, patterns, mode: currentMode });
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

  let paused = false;
  return {
    sounds,
    setMode(name: string): void {
      throwawayEngine({ sounds, modes: Object.fromEntries(Object.keys(handlerSets).map((m) => [m, {}])), mode: Object.keys(handlerSets)[0] }, SAMPLE_RATE_MIN_HZ).setMode(name);
      if (closed) return;
      currentMode = name;
      post({ type: 'setMode', name });
    },
    pause(): void {
      if (closed || paused) return;
      paused = true;
      mic?.pause();
      pacer?.pause();
    },
    resume(): void {
      if (closed || !paused) return;
      paused = false;
      mic?.resume();
      pacer?.start();
    },
    stop(): Promise<void> {
      if (stopping === null) {
        closed = true;
        stopping = teardown();
      }
      return stopping;
    },
  };
}
