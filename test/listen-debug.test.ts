// Task 38: ears.setDebug(on), with a fake Worker, a fake overlay and no microphone (source 'keys').
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokkError } from '../web/errors';
import { createWorkerState, handleWorkerMessage } from '../web/protocol';
import type { WorkerToMain } from '../web/protocol';
import { buildModel } from './helpers/engine-fixture';

const RATE_HZ = 16000;

interface FakeWorker {
  onmessage: ((e: { data: WorkerToMain }) => void) | null;
  onerror: ((e: { message: string }) => void) | null;
  postMessage(msg: { type: string }): void;
}

const fakes = vi.hoisted(() => ({
  workers: [] as unknown[],
  overlays: [] as { onEnvelope: unknown; onEvent: unknown; onMatch: unknown; setState: unknown; destroy: unknown }[],
  mountOverlay: vi.fn(),
}));

vi.mock('../web/worker-factory', () => ({
  createTokkWorker: () => {
    const state = createWorkerState();
    const worker: FakeWorker = {
      onmessage: null,
      onerror: null,
      postMessage(msg) {
        for (const out of handleWorkerMessage(state, msg as never)) this.onmessage?.({ data: out });
      },
    };
    fakes.workers.push(worker);
    return { worker, dispose: vi.fn() };
  },
}));
vi.mock('../web/overlay/overlay', () => ({ mountOverlay: fakes.mountOverlay }));

const { listen } = await import('../web/listen');

const sounds = buildModel(['mid'], RATE_HZ, { mid: 'knock' });
const lastWorker = (): FakeWorker => fakes.workers[fakes.workers.length - 1] as FakeWorker;
const fromWorker = (msg: WorkerToMain): void => lastWorker().onmessage?.({ data: msg });
const envelope = (): WorkerToMain => ({ type: 'envelope', t0: 0, min: new Float32Array(2), max: new Float32Array(2) });
const match = (): WorkerToMain => ({ type: 'match', pattern: 'knock', event: { pattern: 'knock', t: 1 } as never });

interface Fake { onInjected: ReturnType<typeof vi.fn>; onEnvelope: ReturnType<typeof vi.fn>; onEvent: ReturnType<typeof vi.fn>; onMatch: ReturnType<typeof vi.fn>; setState: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
const overlays = (): Fake[] => fakes.overlays as unknown as Fake[];

const keysOptions = { sounds, source: 'keys', on: { knock: vi.fn() } };

beforeEach(() => {
  fakes.workers.length = 0;
  fakes.overlays.length = 0;
  fakes.mountOverlay.mockReset();
  fakes.mountOverlay.mockImplementation(() => {
    const o = { onInjected: vi.fn(), onEnvelope: vi.fn(), onEvent: vi.fn(), onMatch: vi.fn(), setState: vi.fn(), destroy: vi.fn() };
    fakes.overlays.push(o);
    return o;
  });
});

afterEach(() => { vi.useRealTimers(); });

describe('ears.setDebug (Task 38)', () => {
  it('mounts nothing without debug, mounts on setDebug(true) and removes on setDebug(false)', async () => {
    const ears = await listen(keysOptions);
    expect(fakes.mountOverlay).not.toHaveBeenCalled();
    ears.setDebug(true);
    expect(fakes.mountOverlay).toHaveBeenCalledTimes(1);
    expect(fakes.mountOverlay.mock.calls[0][0].sampleRate).toBe(RATE_HZ);
    ears.setDebug(false);
    expect(overlays()[0].destroy).toHaveBeenCalledTimes(1);
    await ears.stop();
  });

  it('the overlay gets envelopes, segment reports and matches after setDebug(true), and nothing after setDebug(false)', async () => {
    const ears = await listen(keysOptions);
    ears.setDebug(true);
    fromWorker(envelope());
    fromWorker(match());
    fromWorker({ type: 'segment', t: 1, durationMs: 10, result: { label: 'mid', confidence: 1 } as never });
    const [o] = overlays();
    expect(o.onEnvelope).toHaveBeenCalledTimes(1);
    expect(o.onMatch).toHaveBeenCalledTimes(1);
    expect(o.onMatch.mock.calls[0][0]).toBe('knock');
    expect(o.onEvent).toHaveBeenCalledTimes(1);
    ears.setDebug(false);
    fromWorker(envelope());
    expect(o.onEnvelope).toHaveBeenCalledTimes(1);
    await ears.stop();
  });

  it('the same value twice does nothing, with debug: true at the start too', async () => {
    const ears = await listen({ ...keysOptions, debug: true });
    expect(fakes.mountOverlay).toHaveBeenCalledTimes(1);
    ears.setDebug(true);
    expect(fakes.mountOverlay).toHaveBeenCalledTimes(1);
    ears.setDebug(false);
    ears.setDebug(false);
    expect(overlays()[0].destroy).toHaveBeenCalledTimes(1);
    ears.setDebug(true);
    expect(fakes.mountOverlay).toHaveBeenCalledTimes(2);
    await ears.stop();
  });

  it('a sound from ears.inject() (duration 0) reaches the overlay as an injected row, a classified one does not', async () => {
    const ears = await listen({ ...keysOptions, debug: true });
    const [o] = overlays();
    fromWorker({ type: 'event', e: { kind: 'sound', label: 'mid', t: 2, durationMs: 0, confidence: 1 } as never });
    fromWorker({ type: 'event', e: { kind: 'sound', label: 'mid', t: 3, durationMs: 80, confidence: 0.9 } as never });
    expect(o.onInjected).toHaveBeenCalledTimes(1);
    expect(o.onInjected).toHaveBeenCalledWith('mid', 2);
    await ears.stop();
  });

  it('a mounted overlay gets the paused state when the Ears is paused', async () => {
    const ears = await listen(keysOptions);
    ears.pause();
    ears.setDebug(true);
    expect(overlays()[0].setState).toHaveBeenLastCalledWith('paused');
    ears.resume();
    expect(overlays()[0].setState).toHaveBeenLastCalledWith('listening');
    await ears.stop();
  });

  it('after stop() setDebug does nothing, and stop() removes the overlay', async () => {
    const ears = await listen({ ...keysOptions, debug: true });
    const [o] = overlays();
    await ears.stop();
    expect(o.destroy).toHaveBeenCalledTimes(1);
    ears.setDebug(true);
    ears.setDebug(false);
    expect(fakes.mountOverlay).toHaveBeenCalledTimes(1);
    expect(o.destroy).toHaveBeenCalledTimes(1);
  });

  it('after a failure setDebug does nothing', async () => {
    const errors: TokkError[] = [];
    const ears = await listen({ ...keysOptions, onError: (e) => errors.push(e) });
    lastWorker().onerror?.({ message: 'boom' });
    expect(errors).toHaveLength(1);
    ears.setDebug(true);
    expect(fakes.mountOverlay).not.toHaveBeenCalled();
    await ears.stop();
  });

  it('a Save or an import after setDebug(false) does not mount the overlay again', async () => {
    const ears = await listen({ ...keysOptions, debug: true });
    ears.setDebug(false);
    ears.importSounds(ears.exportSounds());
    expect(fakes.mountOverlay).toHaveBeenCalledTimes(1);
    ears.setDebug(true);
    ears.importSounds(ears.exportSounds());
    expect(fakes.mountOverlay).toHaveBeenCalledTimes(3);
    expect(overlays()[1].destroy).toHaveBeenCalledTimes(1);
    await ears.stop();
  });
});
