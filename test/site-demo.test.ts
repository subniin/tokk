// Task 35 (run B): the recording of the demo box, read as files. The engine hears the same matches in Node that the page shows.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSamples } from '../core/engine';
import { checkModel } from '../web/model';
import { readWavFile } from '../node/files';
import { DEMO_MODEL_URL, DEMO_PATTERNS, DEMO_RECORDING_URL } from '../site-src/src/constants';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const MEDIA_DIR = join(REPO_ROOT, 'site-src');
const DURATION_MIN_S = 10;
const DURATION_MAX_S = 12;
const MATCH_TOLERANCE_S = 0.2;
const WAV_MAX_BYTES = 1_000_000;
// Where the groups of claps sit in the recording: the time of the last clap of each pattern.
const EXPECTED: [string, number][] = [['clap clap', 2.65], ['clap clap clap', 5.7], ['clap clap', 8.45]];

describe('the demo recording (Task 35)', async () => {
  const wav = await readWavFile(join(MEDIA_DIR, DEMO_RECORDING_URL));
  const model = JSON.parse(readFileSync(join(MEDIA_DIR, DEMO_MODEL_URL), 'utf8')) as unknown;

  it('is a short file of the site and its model holds feature vectors only', () => {
    const seconds = wav.samples.length / wav.sampleRate;
    expect(seconds).toBeGreaterThanOrEqual(DURATION_MIN_S);
    expect(seconds).toBeLessThanOrEqual(DURATION_MAX_S);
    expect(statSync(join(MEDIA_DIR, DEMO_RECORDING_URL)).size).toBeLessThan(WAV_MAX_BYTES);
    expect(checkModel(model).ok).toBe(true);
    const examples = (model as { examples: Record<string, unknown>[] }).examples;
    expect([...new Set(examples.map((e) => e.label))].sort()).toEqual(['background', 'clap']);
    for (const e of examples) expect(Object.keys(e).sort()).toEqual(['id', 'label', 'v']);
  });

  it('gives clap clap, clap clap clap and clap clap in order, at the times of the claps', () => {
    const result = runSamples(wav.samples, wav.sampleRate, model as Parameters<typeof runSamples>[2], [...DEMO_PATTERNS]);
    expect(result.matches.map((m) => m.pattern)).toEqual(EXPECTED.map(([p]) => p));
    result.matches.forEach((m, i) => expect(Math.abs(m.t - EXPECTED[i][1])).toBeLessThan(MATCH_TOLERANCE_S));
    expect(result.events.filter((e) => e.kind === 'sound').map((e) => (e as { label: string }).label)).toEqual(Array(7).fill('clap'));
    expect(result.unknowns).toEqual([]);
  });
});
