import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '../../core/engine';
import { WEB_CHUNK_MS, WEB_RESUME_TIMEOUT_MS } from '../../web/constants';
import { openMic } from '../../web/mic';
import { buildModel } from '../helpers/engine-fixture';

// Test-only values.
const CONTEXT_RATE_HZ = 48000;
const LOW_RATE_HZ = 8000;
const MODEL_RATE_HZ = 48000;
const MS_PER_SECOND = 1000;
const GESTURE_SENTENCE = 'call listen() from a user gesture such as a click';

type Log = string[];

interface Setup {
  log: Log;
  tracks: { stop: ReturnType<typeof vi.fn> }[];
  contexts: FakeContext[];
  getUserMedia: ReturnType<typeof vi.fn>;
  worklets: { context: unknown; name: string; options: any; node: any }[];
  blobUrls: { created: string[]; revoked: string[] };
  channels: { port1: any; port2: any }[];
}

class FakeContext {
  state: 'suspended' | 'running' | 'closed';
  sampleRate: number;
  audioWorklet: { addModule: (url: string) => Promise<void> } | undefined;
  closed = false;
  resumeCalls = 0;
  source = { connect: vi.fn(), disconnect: vi.fn() };
  constructor(public setup: Setup, public config: ContextConfig) {
    this.state = config.state;
    this.sampleRate = config.sampleRate;
    this.audioWorklet = config.noWorklet ? undefined : {
      addModule: async (url: string) => {
        setup.log.push(`addModule ${url}`);
        if (config.addModuleError) throw config.addModuleError;
      },
    };
    setup.log.push('new AudioContext');
    setup.contexts.push(this);
  }
  createMediaStreamSource() { return this.source; }
  async resume() {
    this.resumeCalls++;
    this.setup.log.push('resume');
    await this.config.resume(this);
  }
  async close() {
    this.closed = true;
    this.state = 'closed';
    this.setup.log.push('close context');
  }
}

interface ContextConfig {
  state: 'suspended' | 'running';
  sampleRate: number;
  noWorklet?: boolean;
  addModuleError?: Error;
  resume: (c: FakeContext) => Promise<void>;
}

const resumeOk = async (c: FakeContext) => { c.state = 'running'; };

function install(overrides: Partial<ContextConfig> = {}, gum?: () => Promise<unknown>, withDevices = true): Setup {
  const config: ContextConfig = { state: 'running', sampleRate: CONTEXT_RATE_HZ, resume: resumeOk, ...overrides };
  const setup: Setup = {
    log: [], tracks: [], contexts: [], worklets: [],
    blobUrls: { created: [], revoked: [] }, channels: [], getUserMedia: vi.fn(),
  };
  const makeStream = () => {
    const track = { stop: vi.fn(() => setup.log.push('stop track')) };
    setup.tracks.push(track);
    return { getTracks: () => [track] };
  };
  setup.getUserMedia = vi.fn(async (constraints: unknown) => {
    setup.log.push('getUserMedia');
    if (gum) return gum();
    void constraints;
    return makeStream();
  });
  vi.stubGlobal('navigator', withDevices ? { mediaDevices: { getUserMedia: setup.getUserMedia } } : {});
  vi.stubGlobal('AudioContext', class extends FakeContext { constructor() { super(setup, config); } });
  vi.stubGlobal('AudioWorkletNode', class {
    port = { postMessage: vi.fn() };
    connect = vi.fn();
    disconnect = vi.fn();
    constructor(context: unknown, name: string, options: any) {
      setup.worklets.push({ context, name, options, node: this });
    }
  });
  vi.stubGlobal('MessageChannel', class {
    port1 = { close: vi.fn(), postMessage: vi.fn() };
    port2 = { close: vi.fn(), postMessage: vi.fn() };
    constructor() { setup.channels.push(this); }
  });
  vi.stubGlobal('Blob', class { constructor(public parts: unknown[], public options: { type: string }) {} });
  vi.stubGlobal('URL', {
    createObjectURL: (b: { options: { type: string } }) => {
      const url = `blob:fake-${setup.blobUrls.created.length}`;
      setup.blobUrls.created.push(`${url} ${b.options.type}`);
      return url;
    },
    revokeObjectURL: (u: string) => { setup.blobUrls.revoked.push(u); setup.log.push('revoke'); },
  });
  return setup;
}

function engineRateMessage(rateHz: number): string {
  try {
    createEngine({ sounds: buildModel(['low', 'mid'], MODEL_RATE_HZ), sampleRate: rateHz });
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected createEngine to throw');
}

async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a rejection');
}

function domError(name: string): Error {
  const e = new Error(`${name} from the browser`);
  e.name = name;
  return e;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('openMic', () => {
  it('rejects with the HTTPS message when navigator.mediaDevices is missing, and creates no context', async () => {
    const s = install({}, undefined, false);
    const err = await rejection(openMic());
    expect(err.message).toMatch(/HTTPS/);
    expect(err.message).toMatch(/localhost/);
    expect(s.contexts.length).toBe(0);
  });

  it('rejects when the context has no audioWorklet, and closes the context', async () => {
    const s = install({ noWorklet: true });
    const err = await rejection(openMic());
    expect(err.message).toMatch(/does not support/);
    expect(s.contexts[0].closed).toBe(true);
  });

  it('rejects a sample rate of 8000 Hz with the engine text before the microphone, and closes the context', async () => {
    const s = install({ sampleRate: LOW_RATE_HZ });
    const err = await rejection(openMic());
    expect(err).toBeInstanceOf(RangeError);
    expect(err.message).toBe(engineRateMessage(LOW_RATE_HZ));
    expect(s.getUserMedia).not.toHaveBeenCalled();
    expect(s.contexts[0].closed).toBe(true);
  });

  it('creates the context before it calls getUserMedia, in the same synchronous turn', async () => {
    const s = install();
    const p = openMic();
    expect(s.log[0]).toBe('new AudioContext');
    await p;
    expect(s.log.indexOf('new AudioContext')).toBeLessThan(s.log.indexOf('getUserMedia'));
  });

  it('passes exactly the constraints of the web-audio rules and no video', async () => {
    const s = install();
    await openMic();
    expect(s.getUserMedia).toHaveBeenCalledTimes(1);
    expect(s.getUserMedia.mock.calls[0][0]).toEqual({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
  });

  it.each([
    ['NotAllowedError', /permission was denied.*site settings/is],
    ['SecurityError', /permission was denied/i],
    ['NotFoundError', /no microphone/i],
    ['OverconstrainedError', /no microphone/i],
    ['NotReadableError', /in use|cannot be read/i],
    ['AbortError', /could not be opened/i],
  ])('turns %s into a guiding error that keeps the original in cause', async (name, pattern) => {
    const original = domError(name);
    const s = install({}, async () => { throw original; });
    const err = await rejection(openMic());
    expect(err.message).toMatch(pattern);
    expect(err.cause).toBe(original);
    expect(s.contexts[0].closed).toBe(true);
  });

  it('uses a stream passed in without calling getUserMedia, and builds the worklet path', async () => {
    const s = install();
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const mic = await openMic(stream);
    expect(s.getUserMedia).not.toHaveBeenCalled();
    expect(mic.stream).toBe(stream);
    expect(mic.sampleRate).toBe(CONTEXT_RATE_HZ);
    expect(s.worklets.length).toBe(1);
    const { options, node } = s.worklets[0];
    expect(options.numberOfInputs).toBe(1);
    expect(options.numberOfOutputs).toBe(0);
    expect(options.processorOptions).toEqual({ chunkFrames: Math.round((WEB_CHUNK_MS * CONTEXT_RATE_HZ) / MS_PER_SECOND) });
    expect(s.contexts[0].source.connect).toHaveBeenCalledWith(node);
    expect(s.blobUrls.created.length).toBe(1);
    expect(s.blobUrls.created[0]).toMatch(/text\/javascript$/);
    expect(s.blobUrls.revoked).toEqual(['blob:fake-0']);
    await mic.close();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('sends one port to the worklet node with connect (transferred) and returns the other for the Worker', async () => {
    const s = install();
    const mic = await openMic();
    const [channel] = s.channels;
    const post = s.worklets[0].node.port.postMessage;
    expect(post).toHaveBeenCalledWith({ type: 'connect', port: channel.port1 }, [channel.port1]);
    expect(mic.workerPort).toBe(channel.port2);
  });

  it('needs no resume when the context is running', async () => {
    const s = install({ state: 'running' });
    await openMic();
    expect(s.contexts[0].resumeCalls).toBe(0);
  });

  it('resumes a suspended context and waits for it', async () => {
    const s = install({ state: 'suspended' });
    await openMic();
    expect(s.contexts[0].state).toBe('running');
    expect(s.contexts[0].resumeCalls).toBeGreaterThanOrEqual(1);
  });

  it('rejects at once when resume() settles and the context is still suspended', async () => {
    const s = install({ state: 'suspended', resume: async () => {} });
    const err = await rejection(openMic());
    expect(err.message).toContain(GESTURE_SENTENCE);
    expect(s.contexts[0].closed).toBe(true);
  });

  it('rejects when resume() rejects', async () => {
    const s = install({ state: 'suspended', resume: async () => { throw domError('InvalidStateError'); } });
    const err = await rejection(openMic());
    expect(err.message).toContain(GESTURE_SENTENCE);
    expect(s.contexts[0].closed).toBe(true);
  });

  it('rejects after WEB_RESUME_TIMEOUT_MS when resume() never settles', async () => {
    const s = install({ state: 'suspended', resume: () => new Promise<void>(() => {}) });
    let settled = false;
    const p = rejection(openMic()).then((e) => { settled = true; return e; });
    await vi.advanceTimersByTimeAsync(WEB_RESUME_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await p;
    expect(err.message).toContain(GESTURE_SENTENCE);
    expect(s.contexts[0].closed).toBe(true);
  });

  it('stops the tracks, closes the context and revokes the Blob URL when the worklet module fails', async () => {
    const s = install({ addModuleError: new Error('module failed') });
    const err = await rejection(openMic());
    expect(err.message).toMatch(/module failed|worklet/i);
    expect(s.tracks.length).toBe(1);
    expect(s.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(s.contexts[0].closed).toBe(true);
    expect(s.blobUrls.revoked).toEqual(['blob:fake-0']);
  });

  it('close() stops every track, disconnects, closes the port and the context, and is safe twice', async () => {
    const s = install();
    const mic = await openMic();
    await mic.close();
    await mic.close();
    expect(s.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(s.contexts[0].closed).toBe(true);
    expect(s.contexts[0].source.disconnect).toHaveBeenCalled();
    expect(s.worklets[0].node.disconnect).toHaveBeenCalled();
    expect(s.channels[0].port2.close).toHaveBeenCalled();
  });

  it('pause() and resume() send control messages on the node port', async () => {
    const s = install();
    const mic = await openMic();
    mic.pause();
    mic.resume();
    const calls = s.worklets[0].node.port.postMessage.mock.calls.map((c: unknown[]) => (c[0] as { type: string }).type);
    expect(calls).toEqual(['connect', 'pause', 'resume']);
  });
});
