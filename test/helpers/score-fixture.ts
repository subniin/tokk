// Test helper: builds a fixture folder (x.wav + x.json) in a temporary directory.
// Every normal sound starts at or after LEAD_MS. Writes only below the OS temp directory.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWavFile } from '../../node/files';
import { LEAD_MS, makeSignal, type Hit } from './engine-fixture';

export { LEAD_MS };

// Test-only values.
export const FIXTURE_SAMPLE_RATE_HZ = 44100;
const FIXTURE_NOISE_RMS_DB = -60;
const MS_PER_SECOND = 1000;
const WAV_24_BITS = 24;
const WAV_24_BYTES_PER_SAMPLE = 3;

export interface LabelEvent { label: string; t: number }

export interface RecordingSpec {
  name: string;                       // stem, without extension
  totalMs: number;
  hits: Hit[];
  seed: number;
  sampleRate?: number;
  events?: LabelEvent[];              // default: one event per hit, named after the class, at atMs
  labelFile?: Record<string, unknown> | string | false;   // fields merged into the label file; a string is written as is; false writes no label file
  wav?: boolean;                      // false writes no recording
}

let dirs: string[] = [];

export async function tempDir(prefix = 'tokk-score-'): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

export async function removeTempDirs(): Promise<void> {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs = [];
}

export function eventsOf(hits: Hit[]): LabelEvent[] {
  return hits.map((h) => ({ label: h.cls, t: h.atMs / MS_PER_SECOND }));
}

export async function writeFixture(dir: string, recs: RecordingSpec[]): Promise<void> {
  for (const r of recs) {
    const sampleRate = r.sampleRate ?? FIXTURE_SAMPLE_RATE_HZ;
    if (r.wav !== false) {
      const samples = makeSignal({ sampleRate, totalMs: r.totalMs, hits: r.hits, seed: r.seed, noiseRmsDb: FIXTURE_NOISE_RMS_DB });
      await writeWavFile(join(dir, `${r.name}.wav`), samples, sampleRate);
    }
    if (r.labelFile === false) continue;
    const text = typeof r.labelFile === 'string'
      ? r.labelFile
      : JSON.stringify({ device: 'test', room: 'test', sampleRate, events: r.events ?? eventsOf(r.hits), ...r.labelFile });
    await writeFile(join(dir, `${r.name}.json`), text);
  }
}

// Minimal 24-bit PCM WAV, which readWav rejects.
export function wav24Bytes(sampleRate: number, frames: number): Uint8Array {
  const dataBytes = frames * WAV_24_BYTES_PER_SAMPLE;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string): void => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  ascii(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * WAV_24_BYTES_PER_SAMPLE, true);
  v.setUint16(32, WAV_24_BYTES_PER_SAMPLE, true); v.setUint16(34, WAV_24_BITS, true);
  ascii(36, 'data'); v.setUint32(40, dataBytes, true);
  return out;
}
