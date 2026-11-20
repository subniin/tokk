import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BACKGROUND, HUM_LABEL, MIN_EXAMPLES_PER_LABEL, NOISE_FLOOR_WARMUP_MS, SYNTH_FIXTURE_LEAD_MARGIN_MS,
  SYNTH_FIXTURE_LEAD_NOISE_DBFS, SYNTH_FIXTURE_TAIL_MS,
} from '../core/constants';
import { Segmenter } from '../core/segment';
import { rng, synthNoise } from '../core/synth';
import { retrainLabel } from '../core/teach';
import type { SoundModel } from '../core/types';
import { WEB_TEACH_FILE_NAME, WEB_TEACH_HUM_RECORD_MS, WEB_TEACH_MAX_RECORDING_MS, WEB_TEACH_THUMBNAIL_BINS } from '../web/constants';
import { createRecorder } from '../web/recorder';
import { createWorkerState, handleWorkerMessage, msToSamples } from '../web/protocol';
import type { WorkerToMain } from '../web/protocol';
import { buildModel, makeSignal, TRAIN_GAIN_DB, TRAIN_SPACING_MS } from './helpers/engine-fixture';
import type { Hit } from './helpers/engine-fixture';

// Test-only values.
const PBT_RUNS = Number(process.env.PBT_RUNS ?? '100');
const RATE_HZ = 48000;
const MS_PER_SECOND = 1000;
const LEAD_MS = NOISE_FLOOR_WARMUP_MS + SYNTH_FIXTURE_LEAD_MARGIN_MS;
const IMPACTS = 8;
const CHUNK_MS = 20;
const CHUNK_SIZE_MAX = 5000;           // samples
const SEED = 4242;
const SEED_MAX = 1_000_000;
const IMPACTS_MAX = 7;
const IMPACTS_MIN = 1;
const HUM_HZ = 150;
const HUM_PITCH_TOLERANCE = 0.05;      // fraction of the hum pitch
const HUM_AMPLITUDE = 0.3;
const HUM_LENGTH_MS = 3000;
const BACKGROUND_LENGTH_MS = 4000;
const BACKGROUND_NOISE_DBFS = -45;
const PBT_MS_PER_CASE = 1500;
const PBT_TIMEOUT_FLOOR_MS = 120_000;
const LIMIT_TIMEOUT_MS = 120_000;
const EARLY_IMPACT_MS = 300;           // inside the calibration period
const LIMIT_OVERRUN_MS = 5000;        // recorded after the limit, to show that it is not collected

const CHUNK_SAMPLES = msToSamples(CHUNK_MS, RATE_HZ);
const MODEL = (): SoundModel => buildModel(['low', 'mid'], RATE_HZ);
const WITH_HIGH = (): SoundModel => buildModel(['low', 'mid', 'high'], RATE_HZ);

function init(sounds: SoundModel = MODEL(), patterns = ['low', 'mid']) {
  const state = createWorkerState();
  expect(handleWorkerMessage(state, { type: 'init', sounds, sampleRate: RATE_HZ, patterns: { default: patterns }, mode: 'default' })).toEqual([]);
  return state;
}

function impacts(cls: Hit['cls'], count: number, firstAtMs = LEAD_MS, seed = SEED): Float32Array {
  const hits: Hit[] = Array.from({ length: count }, (_, i) => ({ atMs: firstAtMs + i * TRAIN_SPACING_MS, cls, gainDb: TRAIN_GAIN_DB }));
  return makeSignal({ sampleRate: RATE_HZ, totalMs: firstAtMs + count * TRAIN_SPACING_MS + SYNTH_FIXTURE_TAIL_MS, hits, seed, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS });
}

function feed(state: ReturnType<typeof createWorkerState>, samples: Float32Array, size = CHUNK_SAMPLES): WorkerToMain[] {
  const out: WorkerToMain[] = [];
  for (let at = 0; at < samples.length; at += size) {
    out.push(...handleWorkerMessage(state, { type: 'chunk', samples: samples.slice(at, at + size) }));
  }
  return out;
}

const only = <T extends WorkerToMain['type']>(msgs: WorkerToMain[], type: T) => msgs.filter((m): m is Extract<WorkerToMain, { type: T }> => m.type === type);

function batchSegments(samples: Float32Array) {
  const s = new Segmenter(RATE_HZ);
  return [...s.push(samples), ...s.flush()];
}

describe('recorder through the Worker messages', () => {
  it('records, finds the segments, trains and drops a deleted example', () => {
    const state = init();
    const samples = impacts('high', IMPACTS);
    expect(handleWorkerMessage(state, { type: 'record-start', label: 'tap', kind: 'sound' })).toEqual([]);
    const out = feed(state, samples);
    const progress = only(out, 'record-progress');
    expect(progress).toHaveLength(Math.ceil(samples.length / CHUNK_SAMPLES));
    expect(progress[progress.length - 1].t).toBe(samples.length / RATE_HZ);
    const seen = only(out, 'record-segment');
    const expected = batchSegments(samples);
    expect(seen.length).toBeGreaterThanOrEqual(MIN_EXAMPLES_PER_LABEL);
    expect(seen.map((s) => s.t)).toEqual(expected.slice(0, seen.length).map((s) => s.t));
    expect(seen.map((s) => s.id)).toEqual(seen.map((_, n) => `tap/${WEB_TEACH_FILE_NAME}#${n}`));
    for (const s of seen) {
      expect(s.min.length).toBe(s.max.length);
      expect(s.min.length).toBeLessThanOrEqual(WEB_TEACH_THUMBNAIL_BINS);
      expect(s.durationMs).toBeGreaterThan(0);
    }

    const deleted = [seen[0].id];
    const end = handleWorkerMessage(state, { type: 'record-stop', deleted });
    const trained = only(end, 'record-trained');
    expect(trained).toHaveLength(1);
    const tapIds = trained[0].model.examples.filter((e) => e.label === 'tap').map((e) => e.id);
    expect(tapIds).not.toContain(deleted[0]);
    expect(tapIds).toHaveLength(expected.length - 1);
    expect(trained[0].report.labels.map((l) => l.label)).toContain('tap');
    expect(Object.keys(trained[0].model.thresholds)).toContain('tap');
  });

  it('sends no match, segment, event or envelope message while a recording is open', () => {
    const state = init(MODEL(), ['low']);
    handleWorkerMessage(state, { type: 'record-start', label: 'tap', kind: 'sound' });
    const out = feed(state, impacts('low', IMPACTS));
    expect(out.length).toBeGreaterThan(0);
    for (const m of out) expect(['record-progress', 'record-segment']).toContain(m.type);
  });

  it('after record-cancel the old model and a fresh calibrated engine are used', () => {
    const state = init(MODEL(), ['low']);
    handleWorkerMessage(state, { type: 'record-start', label: 'tap', kind: 'sound' });
    feed(state, impacts('high', IMPACTS));
    expect(handleWorkerMessage(state, { type: 'record-cancel' })).toEqual([]);
    const out = feed(state, impacts('low', 3));
    expect(only(out, 'match')).toHaveLength(3);
    const classes = only(feed(state, impacts('high', 2)), 'segment').map((m) => m.result.kind === 'match' ? m.result.label : 'unknown');
    expect(classes).not.toContain('high');
  });

  it('after record-end the new model is used by a fresh engine', () => {
    const state = init(MODEL(), ['low']);
    handleWorkerMessage(state, { type: 'record-start', label: 'tap', kind: 'sound' });
    feed(state, impacts('high', IMPACTS));
    expect(handleWorkerMessage(state, { type: 'record-end', sounds: WITH_HIGH() })).toEqual([]);
    const labels = only(feed(state, impacts('high', 3)), 'segment').map((m) => (m.result.kind === 'match' ? m.result.label : 'unknown'));
    expect(labels).toEqual(['high', 'high', 'high']);
  });

  it('the envelope counters restart with the engine after end and cancel', () => {
    const state = init(MODEL(), ['low']);
    feed(state, impacts('low', 1));
    handleWorkerMessage(state, { type: 'record-start', label: 'tap', kind: 'sound' });
    feed(state, impacts('high', 1));
    handleWorkerMessage(state, { type: 'record-cancel' });
    const env = only(feed(state, impacts('low', 1)), 'envelope');
    expect(env[0].t0).toBe(0);
  });

  it('does not report a sound inside the first calibration second of the recording', () => {
    const state = init();
    handleWorkerMessage(state, { type: 'record-start', label: 'tap', kind: 'sound' });
    const early = makeSignal({
      sampleRate: RATE_HZ, totalMs: LEAD_MS + IMPACTS * TRAIN_SPACING_MS + SYNTH_FIXTURE_TAIL_MS, seed: SEED, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS,
      hits: [EARLY_IMPACT_MS, ...Array.from({ length: IMPACTS }, (_, i) => LEAD_MS + i * TRAIN_SPACING_MS)].map((atMs): Hit => ({ atMs, cls: 'high', gainDb: TRAIN_GAIN_DB })),
    });
    const seen = only(feed(state, early), 'record-segment');
    expect(seen.length).toBeGreaterThanOrEqual(MIN_EXAMPLES_PER_LABEL);
    for (const s of seen) expect(s.t).toBeGreaterThanOrEqual(NOISE_FLOOR_WARMUP_MS / MS_PER_SECOND);
  });

  it('answers record-failed with a message that says what to do when fewer than 5 are kept', () => {
    const state = init();
    handleWorkerMessage(state, { type: 'record-start', label: 'tap', kind: 'sound' });
    const seen = only(feed(state, impacts('high', IMPACTS)), 'record-segment');
    const deleted = seen.slice(0, seen.length - (MIN_EXAMPLES_PER_LABEL - 1)).map((s) => s.id);
    const out = handleWorkerMessage(state, { type: 'record-stop', deleted });
    expect(out.map((m) => m.type)).toEqual(['record-failed']);
    const message = (out[0] as Extract<WorkerToMain, { type: 'record-failed' }>).message;
    expect(message).toMatch(/at least 5/);
    expect(message).toMatch(/Record again/);
  });

  it('a hum recording sets pitch.baselineHz and sends no segments', () => {
    const state = init();
    handleWorkerMessage(state, { type: 'record-start', label: HUM_LABEL, kind: 'sound' });   // a wrong kind is ignored
    const hum = Float32Array.from({ length: msToSamples(HUM_LENGTH_MS, RATE_HZ) }, (_, i) => HUM_AMPLITUDE * Math.sin((2 * Math.PI * HUM_HZ * i) / RATE_HZ));
    const out = feed(state, hum);
    expect(only(out, 'record-segment')).toHaveLength(0);
    const trained = only(handleWorkerMessage(state, { type: 'record-stop', deleted: [] }), 'record-trained');
    expect(trained).toHaveLength(1);
    expect(Math.abs((trained[0].model.pitch?.baselineHz ?? 0) - HUM_HZ)).toBeLessThan(HUM_HZ * HUM_PITCH_TOLERANCE);
    expect(WEB_TEACH_HUM_RECORD_MS).toBeLessThan(HUM_LENGTH_MS);
  });

  it('a background recording adds background examples and sends no segments', () => {
    const state = init();
    handleWorkerMessage(state, { type: 'record-start', label: BACKGROUND, kind: 'background' });
    const noise = synthNoise('white', BACKGROUND_LENGTH_MS, BACKGROUND_NOISE_DBFS, RATE_HZ, rng(SEED));
    const out = feed(state, noise);
    expect(only(out, 'record-segment')).toHaveLength(0);
    const trained = only(handleWorkerMessage(state, { type: 'record-stop', deleted: [] }), 'record-trained');
    expect(trained).toHaveLength(1);
    expect(trained[0].model.examples.filter((e) => e.label === BACKGROUND).length).toBeGreaterThanOrEqual(MIN_EXAMPLES_PER_LABEL);
  });

  it('ignores a flush while a recording is open', () => {
    const state = init();
    handleWorkerMessage(state, { type: 'record-start', label: 'tap', kind: 'sound' });
    expect(handleWorkerMessage(state, { type: 'flush' })).toEqual([]);
  });

  it('sends record-limit once, stops collecting and still trains', () => {
    const state = init();
    handleWorkerMessage(state, { type: 'record-start', label: BACKGROUND, kind: 'background' });
    const lengthMs = WEB_TEACH_MAX_RECORDING_MS + LIMIT_OVERRUN_MS;
    const noise = synthNoise('white', lengthMs, BACKGROUND_NOISE_DBFS, RATE_HZ, rng(SEED));
    const out = feed(state, noise, msToSamples(MS_PER_SECOND, RATE_HZ));
    expect(only(out, 'record-limit')).toHaveLength(1);
    const progress = only(out, 'record-progress');
    expect(progress[progress.length - 1].t).toBe(msToSamples(WEB_TEACH_MAX_RECORDING_MS, RATE_HZ) / RATE_HZ);
    const end = handleWorkerMessage(state, { type: 'record-stop', deleted: [] });
    expect(end.map((m) => m.type)).toEqual(['record-trained']);
  }, LIMIT_TIMEOUT_MS);

  it('answers error and changes nothing on protocol misuse', () => {
    const fresh = createWorkerState();
    expect(handleWorkerMessage(fresh, { type: 'record-start', label: 'tap', kind: 'sound' })[0].type).toBe('error');

    const state = init();
    for (const m of [{ type: 'record-stop', deleted: [] }, { type: 'record-end', sounds: MODEL() }, { type: 'record-cancel' }]) {
      expect(handleWorkerMessage(state, m)[0].type).toBe('error');
    }
    handleWorkerMessage(state, { type: 'record-start', label: 'tap', kind: 'sound' });
    expect(handleWorkerMessage(state, { type: 'record-start', label: 'other', kind: 'sound' })[0].type).toBe('error');
    const seen = only(feed(state, impacts('high', IMPACTS)), 'record-segment');
    expect(seen[0].id.startsWith('tap/')).toBe(true);   // the first recording is still the open one
  });
});

describe('recorder ids and times', () => {
  it('equal the ids and times of retrainLabel and a batch Segmenter for any chunking', () => {
    const arb = fc.record({
      seed: fc.integer({ min: 1, max: SEED_MAX }),
      count: fc.integer({ min: IMPACTS_MIN, max: IMPACTS_MAX }),
      sizes: fc.array(fc.integer({ min: 1, max: CHUNK_SIZE_MAX }), { minLength: 1, maxLength: 6 }),
    });
    const model = buildModel(['low', 'mid'], RATE_HZ);
    fc.assert(fc.property(arb, ({ seed, count, sizes }) => {
      const samples = impacts('high', count + MIN_EXAMPLES_PER_LABEL, LEAD_MS, seed);
      const recorder = createRecorder({ label: 'tap', kind: 'sound', sampleRate: RATE_HZ, maxSamples: msToSamples(WEB_TEACH_MAX_RECORDING_MS, RATE_HZ) });
      const out = [] as ReturnType<typeof recorder.push>;
      for (let at = 0, i = 0; at < samples.length; i++) {
        const n = sizes[i % sizes.length];
        out.push(...recorder.push(samples.slice(at, at + n)));
        at += n;
      }
      const fin = recorder.finish();
      out.push(...fin.out);
      const segs = out.filter((m) => m.type === 'record-segment');
      const batch = batchSegments(samples);
      expect(segs.map((s) => s.t)).toEqual(batch.map((s) => s.t));
      expect(fin.ids).toEqual(segs.map((s) => s.id));
      const { model: next } = retrainLabel(model, 'tap', [{ label: 'tap', file: WEB_TEACH_FILE_NAME, samples, sampleRate: RATE_HZ }]);
      expect(next.examples.filter((e) => e.label === 'tap').map((e) => e.id).sort()).toEqual([...fin.ids].sort());   // the model keeps its examples sorted by id text
      expect(fin.samples.length).toBe(samples.length);
    }));
  }, Math.max(PBT_TIMEOUT_FLOOR_MS, PBT_RUNS * PBT_MS_PER_CASE));
});
