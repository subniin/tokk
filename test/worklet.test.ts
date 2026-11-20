import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { WORKLET_PROCESSOR_NAME, WORKLET_SOURCE } from '../web/worklet-source';

// Test-only values.
const RENDER_BLOCK_FRAMES = 128;      // frames in one render block of the Web Audio API
const SAMPLE_RATE_HZ = 48000;
const CHUNK_FRAMES_CASES = [960, 441, 128, 100, 300, 1];
const BLOCKS_PER_CASE = 40;

interface FakePort {
  onmessage: ((e: { data: unknown }) => void) | null;
  posted: { message: { type: string; samples: Float32Array }; transfer: unknown[] }[];
  postMessage(message: { type: string; samples: Float32Array }, transfer: unknown[]): void;
}

function fakePort(): FakePort {
  const port: FakePort = {
    onmessage: null,
    posted: [],
    postMessage(message, transfer) { port.posted.push({ message, transfer }); },
  };
  return port;
}

interface Processor {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

function load(chunkFrames: number) {
  const control = fakePort();
  const data = fakePort();
  const registered: Record<string, new (options: unknown) => Processor> = {};
  const context = vm.createContext({
    sampleRate: SAMPLE_RATE_HZ,
    AudioWorkletProcessor: class { port = control; },
    registerProcessor: (name: string, cls: new (options: unknown) => Processor) => { registered[name] = cls; },
  });
  vm.runInContext(WORKLET_SOURCE, context);
  const Cls = registered[WORKLET_PROCESSOR_NAME];
  const processor = new Cls({ processorOptions: { chunkFrames } });
  const connect = () => control.onmessage?.({ data: { type: 'connect', port: data } });
  const send = (type: string) => control.onmessage?.({ data: { type } });
  return { processor, control, data, connect, send, registered };
}

function ramp(start: number, frames = RENDER_BLOCK_FRAMES): Float32Array {
  return Float32Array.from({ length: frames }, (_, i) => (start + i) / 100000);
}

function run(p: Processor, from: number, blocks: number): number {
  let at = from;
  for (let b = 0; b < blocks; b++) {
    expect(p.process([[ramp(at)]], [[]])).toBe(true);
    at += RENDER_BLOCK_FRAMES;
  }
  return at;
}

describe('worklet source', () => {
  it('registers one processor under the exported name and has no computing in it', () => {
    const { registered } = load(960);
    expect(Object.keys(registered)).toEqual([WORKLET_PROCESSOR_NAME]);
    expect(WORKLET_SOURCE).not.toMatch(/Math\.(sqrt|sin|cos|log|exp|pow|abs)|FFT|\bYIN\b/i);
  });

  it.each(CHUNK_FRAMES_CASES)('posts chunks of exactly %i frames that concatenate to the input, with the buffer transferred', (chunkFrames) => {
    const { processor, data, connect } = load(chunkFrames);
    connect();
    const end = run(processor, 0, BLOCKS_PER_CASE);
    const expectedChunks = Math.floor(end / chunkFrames);
    expect(data.posted.length).toBe(expectedChunks);
    const all: number[] = [];
    for (const { message, transfer } of data.posted) {
      expect(message.type).toBe('chunk');
      expect(message.samples.length).toBe(chunkFrames);
      expect(transfer).toEqual([message.samples.buffer]);
      all.push(...message.samples);
    }
    const input = [...Array.from({ length: BLOCKS_PER_CASE }, (_, b) => ramp(b * RENDER_BLOCK_FRAMES))].flatMap((x) => [...x]);
    expect(all).toEqual(input.slice(0, expectedChunks * chunkFrames));
  });

  it('posts nothing before connect, and starts fresh when it connects', () => {
    const { processor, data, connect } = load(300);
    run(processor, 0, 10);
    expect(data.posted.length).toBe(0);
    connect();
    run(processor, 0, 10);
    expect(data.posted.length).toBe(Math.floor((10 * RENDER_BLOCK_FRAMES) / 300));
  });

  it('drops blocks and the partial chunk while paused, and starts a new chunk after resume', () => {
    const chunkFrames = 300;
    const { processor, data, connect, send } = load(chunkFrames);
    connect();
    run(processor, 0, 2);             // 256 frames: a partial chunk
    send('pause');
    run(processor, 1000, 20);
    expect(data.posted.length).toBe(0);
    send('resume');
    const start = 50000;
    run(processor, start, 3);          // 384 frames: one chunk, starting with the first block after resume
    expect(data.posted.length).toBe(1);
    expect([...data.posted[0].message.samples]).toEqual(
      [...ramp(start), ...ramp(start + RENDER_BLOCK_FRAMES), ...ramp(start + 2 * RENDER_BLOCK_FRAMES)].slice(0, chunkFrames),
    );
  });

  it('counts a missing input as a silent block of the same length', () => {
    const chunkFrames = RENDER_BLOCK_FRAMES * 2;
    const { processor, data, connect } = load(chunkFrames);
    connect();
    expect(processor.process([[]], [[]])).toBe(true);
    expect(processor.process([], [[]])).toBe(true);
    expect(data.posted.length).toBe(1);
    expect(data.posted[0].message.samples.length).toBe(chunkFrames);
    expect([...data.posted[0].message.samples].every((x) => x === 0)).toBe(true);
  });

  it('returns true so the node stays alive, also before connect and while paused', () => {
    const { processor, send } = load(960);
    expect(processor.process([[ramp(0)]], [[]])).toBe(true);
    send('pause');
    expect(processor.process([[ramp(0)]], [[]])).toBe(true);
  });

  it('is usable as a classic script and holds no sample rate or chunk length', () => {
    expect(WORKLET_SOURCE).not.toMatch(/\bimport\b|\bexport\b/);
    expect(WORKLET_SOURCE).not.toMatch(/\b(960|441|480|20|48000|44100)\b/);
  });
});
