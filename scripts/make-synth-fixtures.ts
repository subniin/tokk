// npm run synth:fixtures
// Writes the deterministic synthetic sound set below fixtures/audio/synth/: sounds/<label>/*.wav for teaching and
// quick/*.wav with a same-name .json label file for scoring. All randomness comes from the seeded rng of core/synth.
// The audio is generated, not recorded. Local files only.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKGROUND,
  NOISE_FLOOR_WARMUP_MS,
  RECOMMENDED_EXAMPLES_PER_LABEL,
  SYNTH_FIXTURE_BACKGROUND_LEVELS_DBFS,
  SYNTH_FIXTURE_BACKGROUND_MS,
  SYNTH_FIXTURE_GAIN_DB,
  SYNTH_FIXTURE_GAIN_JITTER_DB,
  SYNTH_FIXTURE_LEAD_MARGIN_MS,
  SYNTH_FIXTURE_LEAD_NOISE_DBFS,
  SYNTH_FIXTURE_QUICK_SEED_OFFSET,
  SYNTH_FIXTURE_QUICK_SPACING_MS,
  SYNTH_FIXTURE_SAMPLE_RATE_HZ,
  SYNTH_FIXTURE_SEED,
  SYNTH_FIXTURE_SOUNDS_SPACING_MS,
  SYNTH_FIXTURE_TAIL_MS,
} from '../core/constants';
import { place, rng, synthImpact, synthNoise, SYNTH_CLASSES } from '../core/synth';
import { writeWavFile } from '../node/files';

const MS_PER_SECOND = 1000;
const CLASSES = ['low', 'mid', 'high', 'ring'] as const;
type ImpactClass = (typeof CLASSES)[number];
const BACKGROUND_KINDS = ['white', 'pink'] as const;
const LEAD_MS = NOISE_FLOOR_WARMUP_MS + SYNTH_FIXTURE_LEAD_MARGIN_MS;

// Fixed shuffled orders of the quick recordings: two impacts of every class each.
const QUICK_ORDERS: ImpactClass[][] = [
  ['mid', 'high', 'low', 'ring', 'ring', 'low', 'high', 'mid'],
  ['ring', 'low', 'mid', 'high', 'high', 'mid', 'ring', 'low'],
];

interface PlacedEvent { label: ImpactClass; index: number }

const pad2 = (n: number): string => String(n).padStart(2, '0');

// The same conversion as place() in core/synth.ts.
const startIndex = (atMs: number): number => Math.round((atMs * SYNTH_FIXTURE_SAMPLE_RATE_HZ) / MS_PER_SECOND);

function totalMsFor(count: number, spacingMs: number): number {
  return LEAD_MS + (count - 1) * spacingMs + SYNTH_FIXTURE_TAIL_MS + maxImpactMs();
}

function maxImpactMs(): number {
  return Math.max(...CLASSES.map((c) => SYNTH_CLASSES[c].durationMs));
}

// Noise bed plus impacts. Returns the samples and the sample index of every impact.
function recording(order: ImpactClass[], spacingMs: number, seed: number): { samples: Float32Array; events: PlacedEvent[] } {
  const rand = rng(seed);
  const totalMs = totalMsFor(order.length, spacingMs);
  const clips = [{ atMs: 0, samples: synthNoise('white', totalMs, SYNTH_FIXTURE_LEAD_NOISE_DBFS, SYNTH_FIXTURE_SAMPLE_RATE_HZ, rand) }];
  const events: PlacedEvent[] = [];
  order.forEach((label, i) => {
    const atMs = LEAD_MS + i * spacingMs;
    const gainDb = SYNTH_FIXTURE_GAIN_DB + (2 * rand() - 1) * SYNTH_FIXTURE_GAIN_JITTER_DB;
    clips.push({ atMs, samples: synthImpact({ ...SYNTH_CLASSES[label], gainDb }, SYNTH_FIXTURE_SAMPLE_RATE_HZ, rand) });
    events.push({ label, index: startIndex(atMs) });
  });
  return { samples: place(clips, totalMs, SYNTH_FIXTURE_SAMPLE_RATE_HZ), events };
}

// Steady noise after the lead, over the quiet noise bed.
function backgroundRecording(kind: 'white' | 'pink', levelDbfs: number, seed: number): Float32Array {
  const rand = rng(seed);
  const totalMs = LEAD_MS + SYNTH_FIXTURE_BACKGROUND_MS;
  const bed = synthNoise('white', totalMs, SYNTH_FIXTURE_LEAD_NOISE_DBFS, SYNTH_FIXTURE_SAMPLE_RATE_HZ, rand);
  const steady = synthNoise(kind, SYNTH_FIXTURE_BACKGROUND_MS, levelDbfs, SYNTH_FIXTURE_SAMPLE_RATE_HZ, rand);
  return place([{ atMs: 0, samples: bed }, { atMs: LEAD_MS, samples: steady }], totalMs, SYNTH_FIXTURE_SAMPLE_RATE_HZ);
}

export async function makeSynthFixtures(outDir: string): Promise<void> {
  let fileIndex = 0;
  for (const label of CLASSES) {
    const dir = join(outDir, 'sounds', label);
    await mkdir(dir, { recursive: true });
    const order = Array.from({ length: RECOMMENDED_EXAMPLES_PER_LABEL }, () => label);
    const { samples } = recording(order, SYNTH_FIXTURE_SOUNDS_SPACING_MS, SYNTH_FIXTURE_SEED + fileIndex++);
    await writeWavFile(join(dir, `${label}-01.wav`), samples, SYNTH_FIXTURE_SAMPLE_RATE_HZ);
  }

  const bgDir = join(outDir, 'sounds', BACKGROUND);
  await mkdir(bgDir, { recursive: true });
  for (const [k, kind] of BACKGROUND_KINDS.entries()) {
    const samples = backgroundRecording(kind, SYNTH_FIXTURE_BACKGROUND_LEVELS_DBFS[k], SYNTH_FIXTURE_SEED + fileIndex++);
    await writeWavFile(join(bgDir, `${kind}-01.wav`), samples, SYNTH_FIXTURE_SAMPLE_RATE_HZ);
  }

  const quickDir = join(outDir, 'quick');
  await mkdir(quickDir, { recursive: true });
  for (const [q, order] of QUICK_ORDERS.entries()) {
    const name = `quick-${pad2(q + 1)}`;
    const { samples, events } = recording(order, SYNTH_FIXTURE_QUICK_SPACING_MS, SYNTH_FIXTURE_SEED + SYNTH_FIXTURE_QUICK_SEED_OFFSET + q);
    await writeWavFile(join(quickDir, `${name}.wav`), samples, SYNTH_FIXTURE_SAMPLE_RATE_HZ);
    const labelFile = {
      events: events.map((e) => ({ label: e.label, t: e.index / SYNTH_FIXTURE_SAMPLE_RATE_HZ })),
      device: 'synthetic',
      room: 'none',
      sampleRate: SYNTH_FIXTURE_SAMPLE_RATE_HZ,
    };
    await writeFile(join(quickDir, `${name}.json`), `${JSON.stringify(labelFile, null, 2)}\n`);
  }
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === here) {
  const out = resolve(dirname(here), '..', 'fixtures', 'audio', 'synth');
  makeSynthFixtures(out).then(
    () => console.log(`wrote ${out}`),
    (e) => {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    },
  );
}
