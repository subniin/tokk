import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createEngine, runSamples } from '../core/engine';
import type { EngineEvent, SegmentReport } from '../core/engine';
import { place, synthTone } from '../core/synth';
import type { MatchEvent, SoundModel } from '../core/types';
import { createWorkerState, handleWorkerMessage } from '../web/protocol';
import type { WorkerToMain } from '../web/protocol';
import { buildModel, clip, impactClip, LEAD_MS, makeSignal, TRAIL_MS } from './helpers/engine-fixture';
import type { Hit, ImpactName } from './helpers/engine-fixture';

// Test-only values.
const PBT_RUNS = Number(process.env.PBT_RUNS ?? '100');
const CASE_MS_BUDGET = 1000;            // generous time per generated case
const TIMEOUT_FLOOR_MS = 120_000;
const SAMPLE_RATES_HZ = [16000, 44100, 48000];
const FIXED_RATE_HZ = 48000;
const CHUNK_SIZE_MIN = 1;               // samples
const CHUNK_SIZE_MAX = 5000;            // samples
const MAX_IMPACTS = 4;
const GAP_MIN_MS = 500;
const GAP_MAX_MS = 1200;
const GAIN_MIN_DB = -12;
const GAIN_MAX_DB = -3;
const NOISE_BED_DB = -75;
const TAIL_MS = 600;
const SEED_MAX = 1_000_000;
const FIXED_SEED = 4242;
const HUM_F0_HZ = 200;
const HUM_GAIN_DB = -12;
const HUM_MS = 2500;
const HUM_IMPACT_AFTER_MS = 1500;
const IMPACT_GAIN_DB = -6;
const BACKGROUND_LABEL = 'background';

const ALL: ImpactName[] = ['low', 'mid', 'high', 'ring'];
const PATTERNS = ALL as string[];
const TIMEOUT_MS = Math.max(TIMEOUT_FLOOR_MS, PBT_RUNS * CASE_MS_BUDGET);

interface Case { sampleRate: number; hits: { cls: ImpactName; gapMs: number; gainDb: number }[]; chunkSizes: number[]; seed: number }

const caseArb = fc.record({
  sampleRate: fc.constantFrom(...SAMPLE_RATES_HZ),
  hits: fc.array(fc.record({
    cls: fc.constantFrom(...ALL),
    gapMs: fc.integer({ min: GAP_MIN_MS, max: GAP_MAX_MS }),
    gainDb: fc.integer({ min: GAIN_MIN_DB, max: GAIN_MAX_DB }),
  }), { minLength: 1, maxLength: MAX_IMPACTS }),
  chunkSizes: fc.array(fc.integer({ min: CHUNK_SIZE_MIN, max: CHUNK_SIZE_MAX }), { minLength: 1, maxLength: 4 }),
  seed: fc.integer({ min: 1, max: SEED_MAX }),
});

function signalFor(c: Case): Float32Array {
  let at = LEAD_MS;
  const hits: Hit[] = c.hits.map((h) => {
    const hit = { atMs: at, cls: h.cls, gainDb: h.gainDb };
    at += h.gapMs;
    return hit;
  });
  return makeSignal({ sampleRate: c.sampleRate, totalMs: at + TAIL_MS, hits, seed: c.seed, noiseRmsDb: NOISE_BED_DB });
}

interface DirectRun { reports: SegmentReport[]; events: EngineEvent[]; matches: MatchEvent[] }

function runDirect(signal: Float32Array, sampleRate: number, sounds: SoundModel, withCallback: boolean): DirectRun {
  const out: DirectRun = { reports: [], events: [], matches: [] };
  const engine = createEngine({
    sounds,
    sampleRate,
    on: Object.fromEntries(PATTERNS.map((p) => [p, (m: MatchEvent) => out.matches.push(m)])),
    onEvent: (e) => out.events.push(e),
    ...(withCallback ? { onSegment: (r: SegmentReport) => out.reports.push(r) } : {}),
  });
  engine.push(signal);
  engine.flush();
  return out;
}

function runMessages(signal: Float32Array, sampleRate: number, sounds: SoundModel, chunkSizes: number[]): WorkerToMain[][] {
  const state = createWorkerState();
  const calls: WorkerToMain[][] = [];
  calls.push(handleWorkerMessage(state, { type: 'init', sounds, sampleRate, patterns: { default: PATTERNS }, mode: 'default' }));
  let at = 0;
  for (let i = 0; at < signal.length; i++) {
    const n = chunkSizes[i % chunkSizes.length];
    calls.push(handleWorkerMessage(state, { type: 'chunk', samples: signal.slice(at, at + n) }));
    at += n;
  }
  calls.push(handleWorkerMessage(state, { type: 'flush' }));
  return calls;
}

const reportOf = (m: Extract<WorkerToMain, { type: 'segment' }>): SegmentReport => ({ t: m.t, durationMs: m.durationMs, result: m.result });

describe('onSegment in the engine', () => {
  it('reports every classified segment in order, and changes no event, match or time', () => {
    fc.assert(fc.property(caseArb, (c) => {
      const signal = signalFor(c);
      const sounds = buildModel(ALL, c.sampleRate);
      const withCb = runDirect(signal, c.sampleRate, sounds, true);
      const without = runDirect(signal, c.sampleRate, sounds, false);
      expect(withCb.events).toEqual(without.events);
      expect(withCb.matches).toEqual(without.matches);
      const run = runSamples(signal, c.sampleRate, sounds, PATTERNS);
      expect(withCb.events.filter((e) => e.kind !== 'unknown')).toEqual(run.events);
      expect(withCb.matches).toEqual(run.matches);
      const times = withCb.reports.map((r) => r.t);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      for (const r of withCb.reports) {
        expect(r.durationMs).toBeGreaterThan(0);
        expect(r.result.nearest.id.length).toBeGreaterThan(0);
      }
    }), { numRuns: PBT_RUNS });
  }, TIMEOUT_MS);

  it('has a count equal to sound events plus unknown events plus background segments', () => {
    const model = buildModel(ALL, FIXED_RATE_HZ, { ring: BACKGROUND_LABEL });
    fc.assert(fc.property(caseArb, (c) => {
      const signal = signalFor({ ...c, sampleRate: FIXED_RATE_HZ });
      const r = runDirect(signal, FIXED_RATE_HZ, model, true);
      const sounds = r.events.filter((e) => e.kind === 'sound').length;
      const unknowns = r.events.filter((e) => e.kind === 'unknown').length;
      const background = r.reports.filter((x) => x.result.kind === 'match' && x.result.label === BACKGROUND_LABEL).length;
      expect(r.reports.length).toBe(sounds + unknowns + background);
    }), { numRuns: Math.max(1, Math.floor(PBT_RUNS / 2)) });
  }, TIMEOUT_MS);

  it('reports a background segment with kind match and gives no event for it', () => {
    const model = buildModel(['low', 'ring'], FIXED_RATE_HZ, { ring: BACKGROUND_LABEL });
    const hits: Hit[] = [{ atMs: LEAD_MS, cls: 'ring', gainDb: IMPACT_GAIN_DB }, { atMs: LEAD_MS + 1000, cls: 'low', gainDb: IMPACT_GAIN_DB }];
    const signal = makeSignal({ sampleRate: FIXED_RATE_HZ, totalMs: LEAD_MS + 2000 + TAIL_MS, hits, seed: FIXED_SEED });
    const r = runDirect(signal, FIXED_RATE_HZ, model, true);
    const bg = r.reports.filter((x) => x.result.kind === 'match' && x.result.label === BACKGROUND_LABEL);
    expect(bg.length).toBe(1);
    expect(r.events.some((e) => e.kind === 'sound' && e.label === BACKGROUND_LABEL)).toBe(false);
    expect(r.events.some((e) => e.t === bg[0].t)).toBe(false);
    expect(r.events.filter((e) => e.kind === 'sound').map((e) => (e.kind === 'sound' ? e.label : ''))).toEqual(['low']);
  });

  it('does not report a segment that overlaps a hum', () => {
    const total = LEAD_MS + HUM_MS + TRAIL_MS;
    const signal = clip(place([
      { atMs: LEAD_MS, samples: synthTone({ f0Hz: HUM_F0_HZ, durationMs: HUM_MS, gainDb: HUM_GAIN_DB }, FIXED_RATE_HZ) },
      { atMs: LEAD_MS + HUM_IMPACT_AFTER_MS, samples: impactClip('mid', IMPACT_GAIN_DB, FIXED_RATE_HZ, FIXED_SEED) },
    ], total, FIXED_RATE_HZ));
    const r = runDirect(signal, FIXED_RATE_HZ, buildModel(ALL, FIXED_RATE_HZ), true);
    expect(r.events.some((e) => e.kind === 'continuous')).toBe(true);
    expect(r.reports).toEqual([]);
  });
});

describe('segment message', () => {
  it('equals the onSegment calls of a direct run, at any chunk size', () => {
    fc.assert(fc.property(caseArb, (c) => {
      const signal = signalFor(c);
      const sounds = buildModel(ALL, c.sampleRate);
      const direct = runDirect(signal, c.sampleRate, sounds, true);
      const msgs = runMessages(signal, c.sampleRate, sounds, c.chunkSizes).flat();
      expect(msgs.filter((m) => m.type === 'error')).toEqual([]);
      const got = msgs.filter((m): m is Extract<WorkerToMain, { type: 'segment' }> => m.type === 'segment').map(reportOf);
      expect(got).toEqual(direct.reports);
    }), { numRuns: PBT_RUNS });
  }, TIMEOUT_MS);

  it('survives structuredClone', () => {
    fc.assert(fc.property(caseArb, (c) => {
      const msgs = runMessages(signalFor(c), c.sampleRate, buildModel(ALL, c.sampleRate), c.chunkSizes).flat();
      for (const m of msgs.filter((x) => x.type === 'segment')) expect(structuredClone(m)).toEqual(m);
    }), { numRuns: Math.max(1, Math.floor(PBT_RUNS / 5)) });
  }, TIMEOUT_MS);

  it('comes before the event and match messages of its segment, and the envelope stays last in a call', () => {
    fc.assert(fc.property(caseArb, (c) => {
      const calls = runMessages(signalFor(c), c.sampleRate, buildModel(ALL, c.sampleRate), c.chunkSizes);
      for (const call of calls) {
        const envAt = call.findIndex((m) => m.type === 'envelope');
        if (envAt >= 0) expect(envAt).toBe(call.length - 1);
        call.forEach((m, i) => {
          if (m.type !== 'event' || m.e.kind === 'continuous') return;
          const t = m.e.t;
          const segAt = call.findIndex((s) => s.type === 'segment' && s.t === t);
          expect(segAt).toBeGreaterThanOrEqual(0);
          expect(segAt).toBeLessThan(i);
        });
        const lastSegment = call.map((m) => m.type).lastIndexOf('segment');
        const firstMatch = call.findIndex((m) => m.type === 'match');
        if (lastSegment >= 0 && firstMatch >= 0) expect(lastSegment).toBeLessThan(firstMatch);
      }
    }), { numRuns: Math.max(1, Math.floor(PBT_RUNS / 2)) });
  }, TIMEOUT_MS);

  it('gives no segment message for a background segment as an event, and keeps the event messages as before', () => {
    const model = buildModel(['low', 'ring'], FIXED_RATE_HZ, { ring: BACKGROUND_LABEL });
    const hits: Hit[] = [{ atMs: LEAD_MS, cls: 'ring', gainDb: IMPACT_GAIN_DB }];
    const signal = makeSignal({ sampleRate: FIXED_RATE_HZ, totalMs: LEAD_MS + 1000 + TAIL_MS, hits, seed: FIXED_SEED });
    const msgs = runMessages(signal, FIXED_RATE_HZ, model, [960]).flat();
    const segs = msgs.filter((m) => m.type === 'segment');
    expect(segs.length).toBe(1);
    expect(msgs.filter((m) => m.type === 'event' && m.e.kind !== 'continuous')).toEqual([]);
  });
});
