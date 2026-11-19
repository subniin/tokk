// File helpers for Node. The only place in the project that touches the file system.
import { readFile, writeFile } from 'fs/promises';
import { readWav, writeWav, type WavData } from '../core/wav';

export async function readWavFile(path: string): Promise<WavData> {
  const bytes = await readFile(path);
  return readWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

export async function writeWavFile(path: string, samples: Float32Array, sampleRate: number): Promise<void> {
  await writeFile(path, writeWav(samples, sampleRate));
}
