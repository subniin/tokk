// Task 32: listen({ onError }), source 'keys' and ears.inject, with a fake Worker and a fake microphone track.
// The fake Worker runs the real Worker protocol, so a keys-mode inject goes through the real engine.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokkError } from '../web/errors';
import type { MatchEvent } from '../core/types';
import { createWorkerState, handleWorkerMessage } from '../web/protocol';
import type { WorkerToMain } from '../web/protocol';
import { buildModel } from './helpers/engine-fixture';

// Test-only values.
const RATE_HZ = 16000;
const KEYS_MESSAGE = 'No microphone in keys mode. Teach sounds with the microphone, then use keys as a fallback.';
const RUN_MS = 1500;
const CHUNK_MS = 20;

interface FakeWorker {
  posted: { type: string; label?: string }[];
  onmessage: ((e: { data: WorkerToMain }) => void) | null;
  onerror: ((e: { message: string }) => void) | null;
  postMessage(msg: { type: string; label?: string }): void;
}

const fakes = vi.hoisted(() => ({
  workers: [] as unknown[],
  mics: [] as unknown[],
  openMic: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('../web/worker-factory', () => ({
  createTokkWorker: () => {
    const state = createWorkerState();
    const worker: FakeWorker = {
      posted: [],
      onmessage: null,
      onerror: null,
      postMessage(msg) {
        this.posted.push(msg);
        for (const out of handleWorkerMessage(state, msg)) this.onmessage?.({ data: out });
      },
    };
    fakes.workers.push(worker);
    return { worker, dispose: fakes.dispose };
  },
}));

vi.mock('../web/mic', () => ({ openMic: fakes.openMic }));

const { listen } = await import('../web/listen');

class FakeContext extends EventTarget {
  state = 'running';
  resume = vi.fn(async () => { this.state = 'running'; });
}

function installMic(): { track: EventTarget & { readyState: string }; context: FakeContext; close: ReturnType<typeof vi.fn> } {
  const track = Object.assign(new EventTarget(), { readyState: 'live' });
  const context = new FakeContext();
  const close = vi.fn(async () => undefined);
  fakes.openMic.mockImplementation(async () => ({
    stream: { getAudioTracks: () => [track], getTracks: () => [track] },
    context,
    sampleRate: RATE_HZ,
    workerPort: {},
    pause: vi.fn(),
    resume: vi.fn(),
    close,
  }));
  return { track, context, close };
}

const sounds = buildModel(['mid'], RATE_HZ, { mid: 'knock' });
const lastWorker = (): FakeWorker => fakes.workers[fakes.workers.length - 1] as FakeWorker;
const fromWorker = (msg: WorkerToMain): void => lastWorker().onmessage?.({ data: msg });
const matchMessage = (pattern: string): WorkerToMain => ({ type: 'match', pattern, event: { pattern, t: 1 } satisfies MatchEvent });

let getUserMedia: ReturnType<typeof vi.fn>;
let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fakes.workers.length = 0;
  fakes.openMic.mockReset();
  fakes.dispose.mockReset();
  getUserMedia = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  errorLog.mockRestore();
});

describe('onError (Task 32)', () => {
  it("a track 'ended' calls onError once with kind mic-ended, and no handler runs after it", async () => {
    const mic = installMic();
    const handler = vi.fn();
    const onError = vi.fn();
    const ears = await listen({ sounds, on: { knock: handler }, onError });
    fromWorker(matchMessage('knock'));
    expect(handler).toHaveBeenCalledTimes(1);

    mic.track.dispatchEvent(new Event('ended'));
    mic.track.dispatchEvent(new Event('ended'));
    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0][0] as TokkError;
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe('mic-ended');
    expect(error.message).toMatch(/call listen\(\) again/);

    fromWorker(matchMessage('knock'));
    expect(handler).toHaveBeenCalledTimes(1);
    await ears.stop();
    expect(mic.close).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a Worker onerror gives kind worker', async () => {
    installMic();
    const onError = vi.fn();
    await listen({ sounds, on: { knock: vi.fn() }, onError });
    lastWorker().onerror?.({ message: 'boom' });
    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0][0] as TokkError;
    expect(error.kind).toBe('worker');
    expect(error.message).toContain('boom');
  });

  it('a closed AudioContext gives kind audio-closed', async () => {
    const mic = installMic();
    const onError = vi.fn();
    await listen({ sounds, on: { knock: vi.fn() }, onError });
    mic.context.state = 'closed';
    mic.context.dispatchEvent(new Event('statechange'));
    expect((onError.mock.calls[0][0] as TokkError).kind).toBe('audio-closed');
  });

  it('a suspended AudioContext is not an error: the next pointerdown or keydown calls resume()', async () => {
    const mic = installMic();
    const target = new EventTarget();
    vi.stubGlobal('document', target);
    const onError = vi.fn();
    const ears = await listen({ sounds, on: { knock: vi.fn() }, onError });
    mic.context.state = 'suspended';
    mic.context.dispatchEvent(new Event('statechange'));
    expect(onError).not.toHaveBeenCalled();
    target.dispatchEvent(new Event('pointerdown'));
    expect(mic.context.resume).toHaveBeenCalledTimes(1);
    mic.context.state = 'suspended';
    target.dispatchEvent(new Event('keydown'));
    expect(mic.context.resume).toHaveBeenCalledTimes(2);
    await ears.stop();
    target.dispatchEvent(new Event('keydown'));
    expect(mic.context.resume).toHaveBeenCalledTimes(2);
  });

  it('an exception inside onError is logged and never rethrown', async () => {
    const mic = installMic();
    const onError = vi.fn(() => { throw new Error('app bug'); });
    await listen({ sounds, on: { knock: vi.fn() }, onError });
    expect(() => mic.track.dispatchEvent(new Event('ended'))).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalled();
  });

  it('without onError a track that ends changes nothing', async () => {
    const mic = installMic();
    const handler = vi.fn();
    await listen({ sounds, on: { knock: handler } });
    mic.track.dispatchEvent(new Event('ended'));
    fromWorker(matchMessage('knock'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mic.close).not.toHaveBeenCalled();
  });
});

describe("source 'keys' and ears.inject (Task 32)", () => {
  it('never opens a microphone, and two injects fire "knock knock"', async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    const ears = await listen({ sounds, source: 'keys', on: { 'knock knock': handler } });
    expect(fakes.openMic).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();

    vi.advanceTimersByTime(RUN_MS);
    const chunks = lastWorker().posted.filter((m) => m.type === 'chunk').length;
    expect(chunks).toBeGreaterThanOrEqual(Math.floor(RUN_MS / CHUNK_MS) - 1);

    ears.inject('knock');
    ears.inject('knock');
    expect(lastWorker().posted.filter((m) => m.type === 'inject').map((m) => m.label)).toEqual(['knock', 'knock']);
    expect(handler).toHaveBeenCalledTimes(1);
    await ears.stop();
    vi.advanceTimersByTime(RUN_MS);
    expect(lastWorker().posted.filter((m) => m.type === 'chunk').length).toBe(chunks);
  });

  it('teach() rejects with the keys-mode message', async () => {
    vi.useFakeTimers();
    const ears = await listen({ sounds, source: 'keys', on: { knock: vi.fn() } });
    await expect(ears.teach('knock', { ui: true })).rejects.toThrow(KEYS_MESSAGE);
    await ears.stop();
  });

  it('inject while paused does nothing, and works again after resume()', async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    const ears = await listen({ sounds, source: 'keys', on: { 'knock knock': handler } });
    ears.pause();
    ears.inject('knock');
    ears.inject('knock');
    vi.advanceTimersByTime(RUN_MS);
    expect(lastWorker().posted.some((m) => m.type === 'inject')).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    ears.resume();
    ears.inject('knock');
    ears.inject('knock');
    expect(handler).toHaveBeenCalledTimes(1);
    await ears.stop();
  });

  it('inject rejects an empty label and background with a RangeError', async () => {
    vi.useFakeTimers();
    const ears = await listen({ sounds, source: 'keys', on: { knock: vi.fn() } });
    expect(() => ears.inject('')).toThrow(RangeError);
    expect(() => ears.inject('background')).toThrow(RangeError);
    await ears.stop();
  });

  it('the Worker protocol takes inject as a message', () => {
    const state = createWorkerState();
    handleWorkerMessage(state, { type: 'init', sounds, sampleRate: RATE_HZ, patterns: { default: ['knock'] }, mode: 'default' });
    handleWorkerMessage(state, { type: 'chunk', samples: new Float32Array(RATE_HZ) });
    const out = handleWorkerMessage(state, { type: 'inject', label: 'knock' });
    expect(out.map((m) => m.type)).toEqual(['event', 'match']);
    expect(handleWorkerMessage(state, { type: 'inject', label: '' })[0].type).toBe('error');
  });
});
