// Task 32b: TeachOptions.backgroundMs is checked before a dialog opens. Same fake Worker and microphone as listen-errors.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerState, handleWorkerMessage } from '../web/protocol';
import { WEB_TEACH_BACKGROUND_RECORD_MS, WEB_TEACH_MAX_RECORDING_MS } from '../web/constants';
import { buildModel } from './helpers/engine-fixture';

// Test-only values.
const RATE_HZ = 16000;
const TOO_SHORT_MS = 5000;
const TOO_LONG_MS = 200000;

const fakes = vi.hoisted(() => ({ openMic: vi.fn() }));

vi.mock('../web/worker-factory', () => ({
  createTokkWorker: () => {
    const state = createWorkerState();
    const worker = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onerror: null,
      postMessage(msg: Parameters<typeof handleWorkerMessage>[1]) {
        for (const out of handleWorkerMessage(state, msg)) this.onmessage?.({ data: out });
      },
    };
    return { worker, dispose: vi.fn() };
  },
}));
vi.mock('../web/mic', () => ({ openMic: fakes.openMic }));

const { listen } = await import('../web/listen');
const sounds = buildModel(['mid'], RATE_HZ, { mid: 'knock' });

beforeEach(() => {
  const track = Object.assign(new EventTarget(), { readyState: 'live' });
  fakes.openMic.mockImplementation(async () => ({
    stream: { getAudioTracks: () => [track], getTracks: () => [track] },
    context: Object.assign(new EventTarget(), { state: 'running', resume: vi.fn() }),
    sampleRate: RATE_HZ, workerPort: {}, pause: vi.fn(), resume: vi.fn(), close: vi.fn(async () => undefined),
  }));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('teach backgroundMs range', () => {
  it.each([TOO_SHORT_MS, TOO_LONG_MS, Number.NaN, Number.POSITIVE_INFINITY, WEB_TEACH_BACKGROUND_RECORD_MS - 1, WEB_TEACH_MAX_RECORDING_MS + 1])(
    'rejects %s with a RangeError that names the range', async (value) => {
      const ears = await listen({ sounds, on: { knock: vi.fn() } });
      const failure = await ears.teach('background', { ui: true, backgroundMs: value }).then(() => null, (e: unknown) => e);
      expect(failure).toBeInstanceOf(RangeError);
      expect((failure as RangeError).message).toContain(String(WEB_TEACH_BACKGROUND_RECORD_MS));
      expect((failure as RangeError).message).toContain(String(WEB_TEACH_MAX_RECORDING_MS));
      await ears.stop();
    });
});
