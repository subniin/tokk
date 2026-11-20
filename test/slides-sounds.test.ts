// Task 26, stage 2a: the synthetic clap examples (U6) and the grammar gate (U7, requirement 8.6).
// The claps are a stand-in made by core/synth, not a hand. Nothing here says how well Tokk hears a real clap.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_VERSION } from '../core/constants';
import { createEngine } from '../core/engine';
import type { Handlers } from '../core/engine';
import type { MatchEvent, SoundModel } from '../core/types';
import { readWavFile, teachFromDir } from '../node';
import { checkModel } from '../web/model';
import {
  CLAP_COUNT_TEACH, CLAP_COUNT_THREE, CLAP_COUNT_TWO, CLAP_SAMPLE_RATE_HZ, clapRecording, noiseOnlyRecording,
} from './helpers/slides-claps';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const SLIDES_DIR = join(REPO_ROOT, 'cases', 'slides');
const SOUNDS_DIR = join(SLIDES_DIR, 'sounds');
const MODEL_PATH = join(SLIDES_DIR, 'sounds.json');
const RECORDINGS_DIR = join(SLIDES_DIR, 'recordings');
const TWO_PATH = join(RECORDINGS_DIR, 'clap-x2.wav');
const THREE_PATH = join(RECORDINGS_DIR, 'clap-x3.wav');
const LABEL = 'clap';
const PATTERN_NEXT = 'clap clap';
const PATTERN_PREV = 'clap clap clap';
const FORBIDDEN_MODEL_KEYS = ['samples', 'wav', 'audio', 'pcm', 'waveform', 'data', 'buffer'];
const PUSH_STEP_MS = 20;
const MS_PER_SECOND = 1000;

function readModel(): SoundModel {
  const checked = checkModel(JSON.parse(readFileSync(MODEL_PATH, 'utf8')));
  if (!checked.ok) throw new Error(`cases/slides/sounds.json is not a valid model: ${checked.problem}`);
  return checked.model;
}

// The real engine with both patterns in one mode, fed in small chunks like a live stream, then flushed.
function fired(samples: Float32Array, sampleRate: number, model: SoundModel): string[] {
  const out: string[] = [];
  const handlers: Handlers = Object.fromEntries([PATTERN_NEXT, PATTERN_PREV].map((p) => [p, (_m: MatchEvent) => { out.push(p); }]));
  const engine = createEngine({ sounds: model, sampleRate, on: handlers });
  const step = Math.round((PUSH_STEP_MS * sampleRate) / MS_PER_SECOND);
  for (let i = 0; i < samples.length; i += step) engine.push(samples.subarray(i, i + step));
  engine.flush();
  return out;
}

describe('slides sounds (Task 26, stage 2a)', () => {
  it('U6: sounds.json is a valid model with 10 clap examples and no audio', () => {
    for (const dir of [SOUNDS_DIR, join(SOUNDS_DIR, LABEL), RECORDINGS_DIR]) expect(existsSync(dir), dir).toBe(true);
    const raw = readFileSync(MODEL_PATH, 'utf8');
    const model = JSON.parse(raw) as { version: number; sampleRate: number; examples: { label: string }[] };
    expect(checkModel(model).ok).toBe(true);
    expect(model.version).toBe(MODEL_VERSION);
    expect(model.sampleRate).toBe(CLAP_SAMPLE_RATE_HZ);
    expect(model.examples.filter((e) => e.label === LABEL)).toHaveLength(CLAP_COUNT_TEACH);
    expect(new Set(model.examples.map((e) => e.label))).toEqual(new Set([LABEL]));
    const keys: string[] = [];
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (typeof x === 'object' && x !== null) for (const [k, v] of Object.entries(x)) { keys.push(k.toLowerCase()); walk(v); }
    };
    walk(model);
    expect(keys.filter((k) => FORBIDDEN_MODEL_KEYS.includes(k))).toEqual([]);
    expect(raw).not.toContain('RIFF');
    expect(keys).not.toContain('riff');
  });

  it('U6: the WAV files decode at the rate of the recipe', async () => {
    const teach = readdirSync(join(SOUNDS_DIR, LABEL)).filter((f) => f.endsWith('.wav'));
    expect(teach.length).toBeGreaterThan(0);
    for (const p of [join(SOUNDS_DIR, LABEL, teach[0]), TWO_PATH, THREE_PATH]) {
      const wav = await readWavFile(p);
      expect(wav.sampleRate, p).toBe(CLAP_SAMPLE_RATE_HZ);
      expect(wav.samples.length, p).toBeGreaterThan(0);
    }
  });

  it('U6: the committed model is what the folder teaches (10 examples, no warning)', async () => {
    const { model, report } = await teachFromDir(SOUNDS_DIR);
    expect(model.examples.filter((e) => e.label === LABEL)).toHaveLength(CLAP_COUNT_TEACH);
    expect(report.warnings.map((w) => w.code)).not.toContain('sound-in-calibration');
  });

  it('U7: two claps fire only "clap clap", three fire only "clap clap clap", one fires nothing', async () => {
    const model = readModel();
    const two = await readWavFile(TWO_PATH);
    const three = await readWavFile(THREE_PATH);
    expect(fired(two.samples, two.sampleRate, model)).toEqual([PATTERN_NEXT]);
    expect(fired(three.samples, three.sampleRate, model)).toEqual([PATTERN_PREV]);
    expect(fired(clapRecording(1), CLAP_SAMPLE_RATE_HZ, model)).toEqual([]);
  });

  it('U7: the in-memory recipe agrees with the files, and noise alone fires nothing', async () => {
    const model = readModel();
    expect(fired(clapRecording(CLAP_COUNT_TWO), CLAP_SAMPLE_RATE_HZ, model)).toEqual([PATTERN_NEXT]);
    expect(fired(clapRecording(CLAP_COUNT_THREE), CLAP_SAMPLE_RATE_HZ, model)).toEqual([PATTERN_PREV]);
    expect(fired(noiseOnlyRecording(), CLAP_SAMPLE_RATE_HZ, model)).toEqual([]);
  });
});
