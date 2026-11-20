import { describe, expect, it } from 'vitest';
import {
  BACKGROUND, HUM_LABEL, KNN_K, MIN_EXAMPLES_PER_LABEL, MODEL_VERSION, NOISE_FLOOR_WARMUP_MS, SYNTH_FIXTURE_LEAD_MARGIN_MS,
  SYNTH_FIXTURE_LEAD_NOISE_DBFS, SYNTH_FIXTURE_TAIL_MS,
} from '../core/constants';
import { classifyVector, emptyModel, trainVectors, TooFewExamplesError } from '../core/classify/knn';
import { createEngine } from '../core/engine';
import type { EngineEvent } from '../core/engine';
import type { SegmentReport } from '../core/engine';
import { place, rng, synthNoise, synthTone } from '../core/synth';
import { retrainLabel } from '../core/teach';
import type { Recording } from '../core/teach';
import type { MatchEvent, SoundModel } from '../core/types';
import { checkModel } from '../web/model';
import { makeSignal, TRAIN_GAIN_DB, TRAIN_SPACING_MS } from './helpers/engine-fixture';
import type { Hit, ImpactName } from './helpers/engine-fixture';

// Test-only values.
const RATE_HZ = 48000;
const OTHER_RATE_HZ = 16000;
const LEAD_MS = NOISE_FLOOR_WARMUP_MS + SYNTH_FIXTURE_LEAD_MARGIN_MS;
const IMPACTS = 8;
const FEW_IMPACTS = MIN_EXAMPLES_PER_LABEL - 1;
const SEED = 2020;
const HUM_HZ = 150;
const HUM_PITCH_TOLERANCE = 0.05;   // fraction of the hum pitch
const HUM_GAIN_DB = -12;
const HUM_LENGTH_MS = 3000;
const HUM_TAIL_MS = 1000;
const BACKGROUND_LENGTH_MS = 4000;
const BACKGROUND_NOISE_DBFS = -45;
const NOISE_LENGTH_MS = 3000;
const NOISE_DBFS = -20;
const FILE = 'teach.wav';

function impacts(cls: ImpactName, count: number, seed = SEED): Float32Array {
  const hits: Hit[] = Array.from({ length: count }, (_, i) => ({ atMs: LEAD_MS + i * TRAIN_SPACING_MS, cls, gainDb: TRAIN_GAIN_DB }));
  return makeSignal({
    sampleRate: RATE_HZ, totalMs: LEAD_MS + count * TRAIN_SPACING_MS + SYNTH_FIXTURE_TAIL_MS, hits, seed, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS,
  });
}

function humSignal(): Float32Array {
  const tone = synthTone({ f0Hz: HUM_HZ, durationMs: HUM_LENGTH_MS, gainDb: HUM_GAIN_DB }, RATE_HZ);
  return place([{ atMs: LEAD_MS, samples: tone }], LEAD_MS + HUM_LENGTH_MS + HUM_TAIL_MS, RATE_HZ);
}

const rec = (label: string, samples: Float32Array): Recording => ({ label, file: FILE, samples, sampleRate: RATE_HZ });

interface Run { segments: SegmentReport[]; events: EngineEvent[]; matches: MatchEvent[] }

function runEngine(sounds: SoundModel, samples: Float32Array, patterns: string[]): Run {
  const out: Run = { segments: [], events: [], matches: [] };
  const engine = createEngine({
    sounds, sampleRate: RATE_HZ,
    on: Object.fromEntries(patterns.map((p) => [p, (m: MatchEvent) => out.matches.push(m)])),
    onEvent: (e) => out.events.push(e),
    onSegment: (r) => out.segments.push(r),
  });
  engine.push(samples);
  engine.flush();
  return out;
}

describe('emptyModel (U1)', () => {
  it('has the version, k and rate, and no examples, statistics, thresholds or pitch', () => {
    const m = emptyModel(RATE_HZ);
    expect(m).toEqual({ version: MODEL_VERSION, k: KNN_K, sampleRate: RATE_HZ, mean: [], std: [], examples: [], thresholds: {} });
    expect('pitch' in m).toBe(false);
    expect(emptyModel(OTHER_RATE_HZ).sampleRate).toBe(OTHER_RATE_HZ);
  });

  it('gives a new object on every call', () => {
    const a = emptyModel(RATE_HZ);
    const b = emptyModel(RATE_HZ);
    expect(a).not.toBe(b);
    a.examples.push({ id: 'x', label: 'x', v: [1] });
    a.mean.push(1);
    a.thresholds.x = 1;
    expect(b).toEqual(emptyModel(RATE_HZ));
    expect(emptyModel(RATE_HZ).examples).toEqual([]);
  });

  it('is accepted by checkModel and survives a JSON round trip', () => {
    const m = emptyModel(RATE_HZ);
    const checked = checkModel(m);
    expect(checked.ok).toBe(true);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
    expect(checkModel(JSON.parse(JSON.stringify(m))).ok).toBe(true);
  });
});

describe('engine with a model without examples (U2)', () => {
  const PATTERNS = ['high', 'tap', 'high high'];

  it('an empty model: no throw, no segment, no unknown, no sound event and no match for impacts and noise', () => {
    const samples = impacts('high', IMPACTS);
    let r: Run | undefined;
    expect(() => { r = runEngine(emptyModel(RATE_HZ), samples, PATTERNS); }).not.toThrow();
    expect(r!.segments).toEqual([]);
    expect(r!.events.filter((e) => e.kind !== 'continuous')).toEqual([]);
    expect(r!.matches).toEqual([]);
  });

  it('a hum-only model: no segment, no match, but the continuous events of a hum still arrive', () => {
    const humOnly: SoundModel = { ...emptyModel(RATE_HZ), pitch: { baselineHz: HUM_HZ } };
    const withImpacts = runEngine(humOnly, impacts('mid', IMPACTS), PATTERNS);
    expect(withImpacts.segments).toEqual([]);
    expect(withImpacts.events.filter((e) => e.kind !== 'continuous')).toEqual([]);
    expect(withImpacts.matches).toEqual([]);

    const hum = runEngine(humOnly, humSignal(), [...PATTERNS, 'hum.rise', 'hum.fall']);
    expect(hum.segments).toEqual([]);
    const phases = hum.events.filter((e) => e.kind === 'continuous').map((e) => (e as { phase: string }).phase);
    expect(phases).toContain('start');
    expect(phases).toContain('update');
    expect(phases).toContain('end');
    expect(hum.events.filter((e) => e.kind !== 'continuous')).toEqual([]);
  });
});

describe('retrainLabel on an empty model (U3)', () => {
  it('retrainLabel adds the first label to an empty model', () => {
    const { model, report } = retrainLabel(emptyModel(RATE_HZ), 'tap', [rec('tap', impacts('high', IMPACTS))]);
    expect(model.sampleRate).toBe(RATE_HZ);
    expect(model.examples.length).toBeGreaterThanOrEqual(MIN_EXAMPLES_PER_LABEL);
    expect(new Set(model.examples.map((e) => e.label))).toEqual(new Set(['tap']));
    expect(Object.keys(model.thresholds)).toEqual(['tap']);
    expect(model.pitch).toBeUndefined();
    expect(report.labels.map((l) => l.label)).toEqual(['tap']);
    expect(report.warnings).toEqual([]);
    expect(checkModel(model).ok).toBe(true);
    const first = model.examples[0];
    const r = classifyVector(model, first.v);
    expect(r.kind).toBe('match');
    expect(r.kind === 'match' ? r.label : '').toBe('tap');
  });

  it('fewer than the minimum of examples throws TooFewExamplesError', () => {
    expect(() => retrainLabel(emptyModel(RATE_HZ), 'tap', [rec('tap', impacts('high', FEW_IMPACTS))])).toThrow(TooFewExamplesError);
  });

  it('background first gives a model with background examples only', () => {
    const noise = synthNoise('white', BACKGROUND_LENGTH_MS, BACKGROUND_NOISE_DBFS, RATE_HZ, rng(SEED));
    const { model, report } = retrainLabel(emptyModel(RATE_HZ), BACKGROUND, [rec(BACKGROUND, noise)]);
    expect(model.examples.length).toBeGreaterThanOrEqual(MIN_EXAMPLES_PER_LABEL);
    expect(model.examples.every((e) => e.label === BACKGROUND)).toBe(true);
    expect(report.labels.map((l) => l.label)).toEqual([BACKGROUND]);
    expect(model.sampleRate).toBe(RATE_HZ);
    expect(checkModel(model).ok).toBe(true);
  });

  it('hum first sets the pitch and trains nothing', () => {
    const { model, report } = retrainLabel(emptyModel(RATE_HZ), HUM_LABEL, [rec(HUM_LABEL, humSignal())]);
    expect(model.version).toBe(MODEL_VERSION);
    expect(model.k).toBe(KNN_K);
    expect(model.sampleRate).toBe(RATE_HZ);
    expect(model.mean).toEqual([]);
    expect(model.std).toEqual([]);
    expect(model.examples).toEqual([]);
    expect(model.thresholds).toEqual({});
    expect(Math.abs((model.pitch?.baselineHz ?? 0) - HUM_HZ)).toBeLessThan(HUM_HZ * HUM_PITCH_TOLERANCE);
    expect(report).toEqual({ labels: [], confusedPairs: [], warnings: [] });
    expect(checkModel(model).ok).toBe(true);
  });

  it('hum first with noise only gives no pitch, the no-pitch-found warning and the empty model', () => {
    const noise = synthNoise('white', NOISE_LENGTH_MS, NOISE_DBFS, RATE_HZ, rng(SEED));
    const { model, report } = retrainLabel(emptyModel(RATE_HZ), HUM_LABEL, [rec(HUM_LABEL, noise)]);
    expect(model).toEqual(emptyModel(RATE_HZ));
    expect(report.labels).toEqual([]);
    expect(report.confusedPairs).toEqual([]);
    expect(report.warnings.map((w) => w.code)).toEqual(['no-pitch-found']);
  });

  it('a sound label on a hum-only model keeps the pitch', () => {
    const humOnly: SoundModel = { ...emptyModel(RATE_HZ), pitch: { baselineHz: HUM_HZ } };
    const { model, report } = retrainLabel(humOnly, 'tap', [rec('tap', impacts('high', IMPACTS))]);
    expect(model.pitch).toEqual({ baselineHz: HUM_HZ });
    expect(new Set(model.examples.map((e) => e.label))).toEqual(new Set(['tap']));
    expect(report.labels.map((l) => l.label)).toEqual(['tap']);
    expect(humOnly.examples).toEqual([]);
  });

  it('a second hum on a hum-only model replaces the pitch', () => {
    const humOnly: SoundModel = { ...emptyModel(RATE_HZ), pitch: { baselineHz: HUM_HZ * 2 } };
    const { model } = retrainLabel(humOnly, HUM_LABEL, [rec(HUM_LABEL, humSignal())]);
    expect(Math.abs((model.pitch?.baselineHz ?? 0) - HUM_HZ)).toBeLessThan(HUM_HZ * HUM_PITCH_TOLERANCE);
    expect(model.examples).toEqual([]);
  });
});

describe('trainVectors (U4)', () => {
  it('still throws TooFewExamplesError for an empty list', () => {
    expect(() => trainVectors([], RATE_HZ)).toThrow(TooFewExamplesError);
  });
});
