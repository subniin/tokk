// Task 34 (requirements 14 and 15): expectEvents on recordings made from the synthesized sounds of Click Talk, and the
// pure rule that turns two pops into one choose. The sounds are a stand-in made by core/synth, not a mouth. Nothing here
// says how well Tokk hears a real tongue click or lip pop. The recordings are written to a temporary folder and removed.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GAP_CONSECUTIVE_MAX_MS, MODEL_VERSION } from '../core/constants';
import type { SoundModel } from '../core/types';
import { expectEvents, readWavFile, teachFromDir, writeWavFile } from '../node';
import { checkModel } from '../web/model';
import { BURST_GAP_MAX_MS } from '../apps/click-talk/src/constants';
import { PATTERNS, inputForPattern, patternsFor, settleBurst } from '../apps/click-talk/src/patterns';
import {
  TALK_BEAT_MS, TALK_SAMPLE_RATE_HZ, TALK_SOUNDS, burstRecording, teachingRecording,
} from './helpers/click-talk-sounds';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const APP_DIR = join(REPO_ROOT, 'apps', 'click-talk');
const SOUNDS_DIR = join(APP_DIR, 'sounds');
const MODEL_PATH = join(APP_DIR, 'sounds.json');
const FORBIDDEN_MODEL_KEYS = ['samples', 'wav', 'audio', 'pcm', 'waveform', 'data', 'buffer'];
const TWO = patternsFor('two');
const ONE = patternsFor('one');
const MS_PER_SECOND = 1000;

let dir = '';
const path = (name: string): string => join(dir, name);

function readModel(): SoundModel {
  const checked = checkModel(JSON.parse(readFileSync(MODEL_PATH, 'utf8')));
  if (!checked.ok) throw new Error(`apps/click-talk/sounds.json is not a valid model: ${checked.problem}`);
  return checked.model;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'click-talk-events-'));
  for (const [sound, count] of [['pop', 1], ['pop', 2], ['pop', 3], ['click', 1], ['click', 2], ['click', 3]] as const) {
    await writeWavFile(path(`${sound}-${count}.wav`), burstRecording(sound, count), TALK_SAMPLE_RATE_HZ);
  }
});

afterAll(async () => {
  if (dir !== '') await rm(dir, { recursive: true, force: true });
});

describe('the sounds of Click Talk (a stand-in for a mouth)', () => {
  it('sounds.json is a valid model of click and pop with ten examples each, and holds no audio', () => {
    const raw = readFileSync(MODEL_PATH, 'utf8');
    const model = JSON.parse(raw) as { version: number; sampleRate: number; examples: { label: string }[] };
    expect(checkModel(model).ok).toBe(true);
    expect(model.version).toBe(MODEL_VERSION);
    expect(model.sampleRate).toBe(TALK_SAMPLE_RATE_HZ);
    expect(new Set(model.examples.map((e) => e.label))).toEqual(new Set(TALK_SOUNDS));
    for (const s of TALK_SOUNDS) expect(model.examples.filter((e) => e.label === s), s).toHaveLength(10);
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
    for (const s of TALK_SOUNDS) {
      const files = readdirSync(join(SOUNDS_DIR, s)).filter((f) => f.endsWith('.wav'));
      expect(files, s).toHaveLength(1);
      const wav = await readWavFile(join(SOUNDS_DIR, s, files[0]));
      expect(wav.sampleRate, s).toBe(TALK_SAMPLE_RATE_HZ);
      expect(wav.samples.length, s).toBe(teachingRecording(s).length);
    }
    const taught = await teachFromDir(SOUNDS_DIR);
    expect(taught.report.warnings).toEqual([]);
    expect(taught.model).toEqual(JSON.parse(readFileSync(MODEL_PATH, 'utf8')));
    expect(existsSync(MODEL_PATH)).toBe(true);
  });
});

describe('the pattern data', () => {
  it('maps patterns to board inputs', () => {
    expect(PATTERNS).toEqual({
      two: { click: 'next', pop: 'choose', 'pop pop pop': 'help' },
      one: { click: 'choose', 'click click click': 'help' },
    });
    expect(TWO).toEqual(['click', 'pop', 'pop pop pop']);
    expect(ONE).toEqual(['click', 'click click click']);
    expect(inputForPattern('two', 'pop')).toEqual({ type: 'choose' });
    expect(inputForPattern('two', 'pop pop pop')).toEqual({ type: 'help' });
    expect(inputForPattern('one', 'click')).toEqual({ type: 'choose' });
    expect(inputForPattern('one', 'pop')).toBeNull();
    expect(inputForPattern('two', 'toString')).toBeNull();
  });
});

describe('click talk events, two-sound pattern set', () => {
  it('one pop gives the pattern pop', async () => {
    await expectEvents(path('pop-1.wav'), ['pop'], { sounds: readModel(), patterns: TWO, matches: ['pop'] });
  });

  it('three pops give only pop pop pop', async () => {
    await expectEvents(path('pop-3.wav'), ['pop', 'pop', 'pop'], { sounds: readModel(), patterns: TWO, matches: ['pop pop pop'] });
  });

  it('one click gives the pattern click', async () => {
    await expectEvents(path('click-1.wav'), ['click'], { sounds: readModel(), patterns: TWO, matches: ['click'] });
  });

  // The grammar holds a first pop back because pop pop pop could follow. When two pops come and then silence, no pattern
  // is exactly two pops, so the grammar gives NO match and both pops are lost. design.md: run B turns this into one
  // choose with settleBurst (tested below).
  it('two pops then silence give no pattern from the grammar', async () => {
    await expectEvents(path('pop-2.wav'), ['pop', 'pop'], { sounds: readModel(), patterns: TWO, matches: [] });
  });

  it('a wrong expectation fails (the check is real)', async () => {
    await expect(expectEvents(path('pop-3.wav'), ['pop', 'pop', 'pop'], { sounds: readModel(), patterns: TWO, matches: ['pop'] }))
      .rejects.toThrow(/matches/);
  });
});

describe('click talk events, one-sound pattern set', () => {
  it('one click gives the pattern click', async () => {
    await expectEvents(path('click-1.wav'), ['click'], { sounds: readModel(), patterns: ONE, matches: ['click'] });
  });

  it('three clicks give only click click click', async () => {
    await expectEvents(path('click-3.wav'), ['click', 'click', 'click'], { sounds: readModel(), patterns: ONE, matches: ['click click click'] });
  });

  it('two clicks then silence give no pattern from the grammar', async () => {
    await expectEvents(path('click-2.wav'), ['click', 'click'], { sounds: readModel(), patterns: ONE, matches: [] });
  });
});

describe('settleBurst: two pops then silence is one choose', () => {
  const t = (...ms: number[]): number[] => ms.map((m) => m / MS_PER_SECOND);
  const AFTER_S = (BURST_GAP_MAX_MS + 1) / MS_PER_SECOND;

  it('uses the same limit as the grammar', () => {
    expect(BURST_GAP_MAX_MS).toBe(GAP_CONSECUTIVE_MAX_MS);
    expect(TALK_BEAT_MS).toBeLessThan(BURST_GAP_MAX_MS);
  });

  it('no sound is nothing to settle', () => {
    expect(settleBurst([], 5)).toBe('none');
  });

  it('one pop is left to the grammar (it gives pop)', () => {
    const times = t(1000);
    expect(settleBurst(times, times[0] + AFTER_S)).toBe('none');
  });

  it('two pops one beat apart then silence give exactly one choose', () => {
    const times = t(1000, 1000 + TALK_BEAT_MS);
    expect(settleBurst(times, times[1] + AFTER_S)).toBe('choose');
    expect(settleBurst(times, times[1] + AFTER_S * 10)).toBe('choose');
  });

  it('the second pop is still waiting for a possible third until the gap has passed', () => {
    const times = t(1000, 1250);
    expect(settleBurst(times, times[1])).toBe('wait');
    expect(settleBurst(times, times[1] + (BURST_GAP_MAX_MS - 1) / MS_PER_SECOND)).toBe('wait');
    expect(settleBurst(times, times[1] + BURST_GAP_MAX_MS / MS_PER_SECOND)).toBe('choose');
  });

  it('three pops are the help pattern, not a choose', () => {
    const times = t(1000, 1250, 1500);
    expect(settleBurst(times, times[2] + AFTER_S)).toBe('none');
  });

  it('four pops give none', () => {
    expect(settleBurst(t(1000, 1250, 1500, 1750), 5)).toBe('none');
  });

  it('only the last burst counts: a pop, a pause, then two pops', () => {
    const times = t(1000, 3000, 3250);
    expect(settleBurst(times, times[2] + AFTER_S)).toBe('choose');
  });

  it('two pops far apart are two single pops, not a choose', () => {
    const times = t(1000, 2000);
    expect(settleBurst(times, times[1] + AFTER_S)).toBe('none');
  });

  it('a gap of exactly the limit starts a new burst', () => {
    const times = t(1000, 1000 + BURST_GAP_MAX_MS);
    expect(settleBurst(times, times[1] + AFTER_S)).toBe('none');
  });

  it('does not change its input', () => {
    const times = t(1000, 1250);
    settleBurst(times, 9);
    expect(times).toEqual(t(1000, 1250));
  });
});
