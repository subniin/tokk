// Test helper for the MCP tests: a temporary parent folder holding the root (`tokk`) and a sibling (`tokk-evil`),
// a taught-sounds folder, and recordings. Writes only below the OS temp directory.

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWavFile } from '../../node/files';
import { TRAIN_PER_CLASS, TRAIN_SPACING_MS, TRAIL_MS, LEAD_MS, buildModel, makeSignal, type Hit, type ImpactName } from './engine-fixture';
import { FIXTURE_SAMPLE_RATE_HZ } from './score-fixture';
import type { SoundModel } from '../../core/types';

export { LEAD_MS, FIXTURE_SAMPLE_RATE_HZ };

// Test-only values.
export const MS_PER_SECOND = 1000;
const TRAIN_GAIN_DB = -6;
const SEED_STEP = 100;

export interface Sandbox { parent: string; root: string; evil: string }

let parents: string[] = [];

export async function makeSandbox(): Promise<Sandbox> {
  const parent = await mkdtemp(join(tmpdir(), 'tokk-mcp-'));
  parents.push(parent);
  const root = join(parent, 'tokk');
  const evil = join(parent, 'tokk-evil');
  await mkdir(root);
  await mkdir(evil);
  return { parent, root, evil };
}

export async function removeSandboxes(): Promise<void> {
  for (const p of parents) await rm(p, { recursive: true, force: true });
  parents = [];
}

export async function listTree(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries.map((e) => e.replaceAll('\\', '/')).sort();
}

export async function putSignal(path: string, samples: Float32Array, sampleRate = FIXTURE_SAMPLE_RATE_HZ): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeWavFile(path, samples, sampleRate);
}

// dir/<class>/a.wav with TRAIN_PER_CLASS impacts of the class each, for every class.
export async function writeTaughtFolder(dir: string, classes: ImpactName[]): Promise<void> {
  let seed = 0;
  for (const cls of classes) {
    seed += SEED_STEP;
    const hits: Hit[] = Array.from({ length: TRAIN_PER_CLASS }, (_, i) => ({ atMs: LEAD_MS + i * TRAIN_SPACING_MS, cls, gainDb: TRAIN_GAIN_DB }));
    const samples = makeSignal({ sampleRate: FIXTURE_SAMPLE_RATE_HZ, totalMs: LEAD_MS + TRAIN_PER_CLASS * TRAIN_SPACING_MS + TRAIL_MS, hits, seed });
    await putSignal(join(dir, cls, 'a.wav'), samples);
  }
}

// A recording with the given hits, starting at or after LEAD_MS.
export async function writeRecording(path: string, hits: Hit[], seed: number): Promise<void> {
  const last = hits.reduce((m, h) => Math.max(m, h.atMs), 0);
  const samples = makeSignal({ sampleRate: FIXTURE_SAMPLE_RATE_HZ, totalMs: last + TRAIL_MS + LEAD_MS, hits, seed });
  await putSignal(path, samples);
}

export async function writeModel(path: string, classes: ImpactName[]): Promise<SoundModel> {
  const model = buildModel(classes, FIXTURE_SAMPLE_RATE_HZ);
  await writeFile(path, JSON.stringify(model));
  return model;
}
