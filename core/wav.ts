// WAV reading and writing on bytes only. No file system, DOM, or Web Audio.
// Supported: 16-bit PCM. Reads mono directly and downmixes multi-channel by averaging per frame.

const INT16_SCALE = 32768;
const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const FMT_MIN_BYTES = 16;
const PCM_FORMAT = 1;
const BITS_PER_SAMPLE = 16;

export interface WavData {
  sampleRate: number;
  samples: Float32Array;
}

function readAscii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

export function readWav(bytes: Uint8Array): WavData {
  if (bytes.length < RIFF_HEADER_BYTES || readAscii(bytes, 0) !== 'RIFF' || readAscii(bytes, 8) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file: missing RIFF or WAVE header.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | undefined;
  let data: { offset: number; size: number } | undefined;

  let offset = RIFF_HEADER_BYTES;
  while (offset + CHUNK_HEADER_BYTES <= bytes.length) {
    const id = readAscii(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const bodyStart = offset + CHUNK_HEADER_BYTES;
    if (bodyStart + size > bytes.length) {
      throw new Error(`Truncated WAV: chunk "${id}" declares ${size} bytes but the file ends earlier.`);
    }

    if (id === 'fmt ') {
      if (size < FMT_MIN_BYTES) {
        throw new Error(`Malformed WAV: fmt chunk is ${size} bytes, expected at least ${FMT_MIN_BYTES}.`);
      }
      fmt = {
        audioFormat: view.getUint16(bodyStart, true),
        channels: view.getUint16(bodyStart + 2, true),
        sampleRate: view.getUint32(bodyStart + 4, true),
        bitsPerSample: view.getUint16(bodyStart + 14, true),
      };
    } else if (id === 'data') {
      data = { offset: bodyStart, size };
    }

    // Chunks are word-aligned: an odd size is followed by one pad byte.
    offset = bodyStart + size + (size % 2);
  }

  if (!fmt) {
    throw new Error('Missing fmt chunk in WAV file.');
  }
  if (!data) {
    throw new Error('Missing data chunk in WAV file.');
  }
  if (fmt.audioFormat !== PCM_FORMAT || fmt.bitsPerSample !== BITS_PER_SAMPLE) {
    throw new Error(
      `Unsupported WAV format: audioFormat=${fmt.audioFormat}, bitsPerSample=${fmt.bitsPerSample}. Only 16-bit PCM is supported.`,
    );
  }
  if (fmt.channels < 1) {
    throw new Error('Malformed WAV: fmt chunk declares zero channels.');
  }

  const channels = fmt.channels;
  const frameBytes = channels * (BITS_PER_SAMPLE / 8);
  const frames = Math.floor(data.size / frameBytes);
  const samples = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const pos = data.offset + f * frameBytes + c * 2;
      sum += view.getInt16(pos, true);
    }
    samples[f] = sum / channels / INT16_SCALE;
  }

  return { sampleRate: fmt.sampleRate, samples };
}

export function writeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error(`Invalid sample rate: ${sampleRate}. Expected a positive integer.`);
  }

  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, FMT_MIN_BYTES, true);
  view.setUint16(20, PCM_FORMAT, true);
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const scaled = Math.round(samples[i] * INT16_SCALE);
    const clamped = Math.min(32767, Math.max(-32768, scaled));
    view.setInt16(44 + i * 2, clamped, true);
  }

  return out;
}
