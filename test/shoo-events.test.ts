// Task 33 (requirements 14 and 15): expectEvents on recordings made from the synthesized sounds of Shoo!.
// The sounds are a stand-in made by core/synth, not a hand. Nothing here says how well Tokk hears a real click, clap,
// knock or pop. The recordings are written to a temporary folder and removed after the tests.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODEL_VERSION } from '../core/constants';
import type { SoundModel } from '../core/types';
import { expectEvents, readWavFile, teachFromDir, writeWavFile } from '../node';
import { checkModel } from '../web/model';
import { BOSS_PATTERN } from '../apps/shoo/src/monsters';
import {
  SHOO_SAMPLE_RATE_HZ, SHOO_SOUNDS, bossRecording, sequenceRecording, teachingRecording, twoKnocksRecording,
} from './helpers/shoo-sounds';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const APP_DIR = join(REPO_ROOT, 'apps', 'shoo');
const SOUNDS_DIR = join(APP_DIR, 'sounds');
const MODEL_PATH = join(APP_DIR, 'sounds.json');
const FORBIDDEN_MODEL_KEYS = ['samples', 'wav', 'audio', 'pcm', 'waveform', 'data', 'buffer'];
const PATTERNS = [BOSS_PATTERN];

let dir = '';
const path = (name: string): string => join(dir, name);

function readModel(): SoundModel {
  const checked = checkModel(JSON.parse(readFileSync(MODEL_PATH, 'utf8')));
  if (!checked.ok) throw new Error(`apps/shoo/sounds.json is not a valid model: ${checked.problem}`);
  return checked.model;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shoo-events-'));
  await writeWavFile(path('four.wav'), sequenceRecording(SHOO_SOUNDS), SHOO_SAMPLE_RATE_HZ);
  await writeWavFile(path('boss.wav'), bossRecording(), SHOO_SAMPLE_RATE_HZ);
  await writeWavFile(path('two-knocks.wav'), twoKnocksRecording(), SHOO_SAMPLE_RATE_HZ);
});

afterAll(async () => {
  if (dir !== '') await rm(dir, { recursive: true, force: true });
});

describe('the sounds of Shoo! (a stand-in for a hand)', () => {
  it('sounds.json is a valid model of the four sounds with ten examples each, and holds no audio', () => {
    const raw = readFileSync(MODEL_PATH, 'utf8');
    const model = JSON.parse(raw) as { version: number; sampleRate: number; examples: { label: string }[] };
    expect(checkModel(model).ok).toBe(true);
    expect(model.version).toBe(MODEL_VERSION);
    expect(model.sampleRate).toBe(SHOO_SAMPLE_RATE_HZ);
    expect(new Set(model.examples.map((e) => e.label))).toEqual(new Set(SHOO_SOUNDS));
    for (const s of SHOO_SOUNDS) expect(model.examples.filter((e) => e.label === s), s).toHaveLength(10);
    const keys: string[] = [];
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (typeof x === 'object' && x !== null) for (const [k, v] of Object.entries(x)) { keys.push(k.toLowerCase()); walk(v); }
    };
    walk(model);
    expect(keys.filter((k) => FORBIDDEN_MODEL_KEYS.includes(k))).toEqual([]);
    expect(raw).not.toContain('RIFF');
  });

  it('the teaching files are the recipe of the helper, and sounds.json is what the folders teach', async () => {
    for (const s of SHOO_SOUNDS) {
      const files = readdirSync(join(SOUNDS_DIR, s)).filter((f) => f.endsWith('.wav'));
      expect(files, s).toHaveLength(1);
      const wav = await readWavFile(join(SOUNDS_DIR, s, files[0]));
      expect(wav.sampleRate, s).toBe(SHOO_SAMPLE_RATE_HZ);
      expect(wav.samples.length, s).toBe(teachingRecording(s).length);
    }
    const taught = await teachFromDir(SOUNDS_DIR);
    expect(taught.report.warnings).toEqual([]);
    expect(taught.model).toEqual(JSON.parse(readFileSync(MODEL_PATH, 'utf8')));
    expect(existsSync(MODEL_PATH)).toBe(true);
  });
});

describe('shoo events', () => {
  it('the four sounds in order give their labels in order', async () => {
    await expectEvents(path('four.wav'), [...SHOO_SOUNDS], { sounds: readModel() });
  });

  it('the boss rhythm with the boss pattern gives the pattern once', async () => {
    await expectEvents(path('boss.wav'), ['knock', 'knock', 'knock'], { sounds: readModel(), patterns: PATTERNS, matches: [BOSS_PATTERN] });
  });

  it('two knocks give the sounds and no pattern', async () => {
    await expectEvents(path('two-knocks.wav'), ['knock', 'knock'], { sounds: readModel(), patterns: PATTERNS, matches: [] });
  });

  it('a wrong expectation fails (the check is real)', async () => {
    await expect(expectEvents(path('two-knocks.wav'), ['knock', 'knock'], { sounds: readModel(), patterns: PATTERNS, matches: [BOSS_PATTERN] })).rejects.toThrow(/matches/);
  });
});
