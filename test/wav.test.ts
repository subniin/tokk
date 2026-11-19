import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readWav, writeWav } from '../core/wav';

// Helpers that build RIFF/WAVE bytes by hand, so the reader is tested against the file layout.

function ascii(id: string): Uint8Array {
  return Uint8Array.from(id, (c) => c.charCodeAt(0));
}

function chunk(id: string, body: Uint8Array): Uint8Array {
  const pad = body.length % 2;
  const out = new Uint8Array(8 + body.length + pad);
  out.set(ascii(id), 0);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

function fmtChunk(opts: { format?: number; channels?: number; sampleRate?: number; bits?: number }): Uint8Array {
  const format = opts.format ?? 1;
  const channels = opts.channels ?? 1;
  const sampleRate = opts.sampleRate ?? 48000;
  const bits = opts.bits ?? 16;
  const blockAlign = (channels * bits) / 8;
  const body = new Uint8Array(16);
  const dv = new DataView(body.buffer);
  dv.setUint16(0, format, true);
  dv.setUint16(2, channels, true);
  dv.setUint32(4, sampleRate, true);
  dv.setUint32(8, sampleRate * blockAlign, true);
  dv.setUint16(12, blockAlign, true);
  dv.setUint16(14, bits, true);
  return chunk('fmt ', body);
}

function int16Body(values: number[]): Uint8Array {
  const body = new Uint8Array(values.length * 2);
  const dv = new DataView(body.buffer);
  values.forEach((v, i) => dv.setInt16(i * 2, v, true));
  return body;
}

function riff(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(12 + total);
  out.set(ascii('RIFF'), 0);
  new DataView(out.buffer).setUint32(4, 4 + total, true);
  out.set(ascii('WAVE'), 8);
  let offset = 12;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function monoWav(values: number[], sampleRate = 48000): Uint8Array {
  return riff(fmtChunk({ sampleRate }), chunk('data', int16Body(values)));
}

describe('readWav / writeWav round trip (3.1)', () => {
  it('returns the sample rate and scaled samples for a hand-built 16-bit mono file', () => {
    const bytes = monoWav([0, 16384, -16384, 32735], 48000); // 32735 / 32768 is about 0.999
    const { sampleRate, samples } = readWav(bytes);
    expect(sampleRate).toBe(48000);
    expect(samples).toBeInstanceOf(Float32Array);
    expect(samples.length).toBe(4);
    expect(samples[0]).toBeCloseTo(0, 3);
    expect(samples[1]).toBeCloseTo(0.5, 3);
    expect(samples[2]).toBeCloseTo(-0.5, 3);
    expect(samples[3]).toBeCloseTo(0.999, 3);
  });

  it('round-trips 48000 Hz samples through writeWav and readWav', () => {
    const input = Float32Array.from([0, 0.5, -0.5, 0.999]);
    const bytes = writeWav(input, 48000);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const out = readWav(bytes);
    expect(out.sampleRate).toBe(48000);
    expect(out.samples.length).toBe(input.length);
    input.forEach((v, i) => expect(out.samples[i]).toBeCloseTo(v, 3));
  });

  it('round-trips arbitrary 16-bit values within 3 decimal places', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -32768, max: 32767 }), { maxLength: 200 }),
        fc.constantFrom(8000, 16000, 44100, 48000),
        (ints, sampleRate) => {
          const input = Float32Array.from(ints, (i) => i / 32768);
          const out = readWav(writeWav(input, sampleRate));
          expect(out.sampleRate).toBe(sampleRate);
          expect(out.samples.length).toBe(input.length);
          input.forEach((v, i) => expect(out.samples[i]).toBeCloseTo(v, 3));
        },
      ),
    );
  });
});

describe('stereo downmix (3.2)', () => {
  it('averages L and R per frame: L=0.5, R=0.1 gives 0.3', () => {
    const interleaved = int16Body([16384, 3277]); // one stereo frame
    const bytes = riff(fmtChunk({ channels: 2 }), chunk('data', interleaved));
    const { samples } = readWav(bytes);
    expect(samples.length).toBe(1);
    expect(samples[0]).toBeCloseTo(0.3, 3);
  });

  it('returns one sample per frame for several frames', () => {
    const interleaved = int16Body([16384, 0, 0, 16384, -16384, -16384]);
    const bytes = riff(fmtChunk({ channels: 2 }), chunk('data', interleaved));
    const { samples } = readWav(bytes);
    expect(samples.length).toBe(3);
    expect(samples[0]).toBeCloseTo(0.25, 3);
    expect(samples[1]).toBeCloseTo(0.25, 3);
    expect(samples[2]).toBeCloseTo(-0.5, 3);
  });
});

describe('unknown chunks (3.3)', () => {
  it('skips a LIST chunk before data', () => {
    const list = chunk('LIST', ascii('INFOISFT'));
    const bytes = riff(fmtChunk({}), list, chunk('data', int16Body([16384, -16384])));
    const { sampleRate, samples } = readWav(bytes);
    expect(sampleRate).toBe(48000);
    expect(samples[0]).toBeCloseTo(0.5, 3);
    expect(samples[1]).toBeCloseTo(-0.5, 3);
  });

  it('skips an odd-sized chunk and its pad byte', () => {
    const oddList = chunk('LIST', ascii('ABCDE')); // 5 bytes, padded to 6
    expect(oddList.length).toBe(8 + 5 + 1);
    const bytes = riff(fmtChunk({}), oddList, chunk('data', int16Body([16384])));
    const { samples } = readWav(bytes);
    expect(samples.length).toBe(1);
    expect(samples[0]).toBeCloseTo(0.5, 3);
  });
});

describe('unsupported formats (3.4, 3.5)', () => {
  it('rejects 24-bit PCM with a 16-bit PCM message', () => {
    const body = new Uint8Array(6);
    const bytes = riff(fmtChunk({ bits: 24 }), chunk('data', body));
    expect(() => readWav(bytes)).toThrow(/16-bit PCM/);
  });

  it('rejects 32-bit float with a 16-bit PCM message', () => {
    const body = new Uint8Array(8);
    const bytes = riff(fmtChunk({ format: 3, bits: 32 }), chunk('data', body));
    expect(() => readWav(bytes)).toThrow(/16-bit PCM/);
  });

  it('rejects 8-bit PCM with a 16-bit PCM message', () => {
    const body = new Uint8Array([128, 200, 50, 0]);
    const bytes = riff(fmtChunk({ bits: 8 }), chunk('data', body));
    expect(() => readWav(bytes)).toThrow(/16-bit PCM/);
  });
});

describe('empty audio (3.6)', () => {
  it('returns an empty Float32Array and the sample rate for a zero-byte data chunk', () => {
    const bytes = riff(fmtChunk({ sampleRate: 44100 }), chunk('data', new Uint8Array(0)));
    const { sampleRate, samples } = readWav(bytes);
    expect(sampleRate).toBe(44100);
    expect(samples).toBeInstanceOf(Float32Array);
    expect(samples.length).toBe(0);
  });
});

describe('invalid containers (3.7)', () => {
  it('rejects bytes that are not RIFF/WAVE with an Error', () => {
    const bytes = new Uint8Array(44).fill(7);
    expect(() => readWav(bytes)).toThrow(Error);
    expect(() => readWav(bytes)).toThrow(/RIFF|WAVE/);
  });

  it('rejects a file with no data chunk and names the missing chunk', () => {
    const bytes = riff(fmtChunk({}));
    expect(() => readWav(bytes)).toThrow(Error);
    expect(() => readWav(bytes)).toThrow(/data/);
  });

  it('rejects a file with no fmt chunk and names the missing chunk', () => {
    const bytes = riff(chunk('data', int16Body([0, 0])));
    expect(() => readWav(bytes)).toThrow(Error);
    expect(() => readWav(bytes)).toThrow(/fmt/);
  });
});
