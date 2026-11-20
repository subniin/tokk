import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createEngine, runSamples } from '../core/engine';
import type { SoundModel } from '../core/types';
import { WEB_ENVELOPE_RESOLUTION_MS } from '../web/constants';
import { createWorkerState, handleWorkerMessage, msToSamples, transferListOf } from '../web/protocol';
import type { WorkerToMain } from '../web/protocol';
import { buildModel, LEAD_MS, makeSignal } from './helpers/engine-fixture';
import type { Hit, ImpactName } from './helpers/engine-fixture';

// Test-only values.
const PBT_RUNS = Number(process.env.PBT_RUNS ?? '100');
const PROTOCOL_MS_PER_CASE = 1000;     // generous time per generated case
const PROTOCOL_TIMEOUT_FLOOR_MS = 120_000;
const SAMPLE_RATES_HZ = [16000, 44100, 48000];
const CHUNK_SIZE_MIN = 1;              // samples
const CHUNK_SIZE_MAX = 5000;           // samples
const MAX_IMPACTS = 4;
const GAP_MIN_MS = 500;
const GAP_MAX_MS = 1200;
const GAIN_MIN_DB = -12;
const GAIN_MAX_DB = -3;
const NOISE_BED_DB = -75;
const TAIL_MS = 600;
const SEED_MAX = 1_000_000;
const SETMODE_FIRST_AT_MS = LEAD_MS;
const SETMODE_SECOND_AT_MS = LEAD_MS + 2300;   // a quiet gap longer than any pending pattern
const SETMODE_SWITCH_AT_MS = LEAD_MS + 1300;   // inside that gap
const SETMODE_TOTAL_MS = SETMODE_SECOND_AT_MS + TAIL_MS + 500;
const UNSUPPORTED_RATE_HZ = 8000;
const REPLACE_RATE_HZ = 48000;

const ALL: ImpactName[] = ['low', 'mid', 'high', 'ring'];
const PATTERNS = ALL as string[];
const CASE_TIMEOUT_MS = Math.max(PROTOCOL_TIMEOUT_FLOOR_MS, PBT_RUNS * PROTOCOL_MS_PER_CASE);

function init(sounds: SoundModel, sampleRate: number, patterns: Record<string, string[]> = { default: PATTERNS }, mode = 'default') {
  return { type: 'init', sounds, sampleRate, patterns, mode } as const;
}

function feed(state: ReturnType<typeof createWorkerState>, samples: Float32Array, chunkSizes: number[]): WorkerToMain[] {
  const out: WorkerToMain[] = [];
  let at = 0;
  for (let i = 0; at < samples.length; i++) {
    const n = chunkSizes[i % chunkSizes.length];
    out.push(...handleWorkerMessage(state, { type: 'chunk', samples: samples.slice(at, at + n) }));
    at += n;
  }
  return out;
}

function engineErrorText(sampleRate: number): string {
  try {
    createEngine({ sounds: buildModel(['low', 'mid'], REPLACE_RATE_HZ), sampleRate });
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected createEngine to throw');
}

function splitMessages(msgs: WorkerToMain[]) {
  const events = [];
  const unknowns: number[] = [];
  const matches = [];
  for (const m of msgs) {
    if (m.type === 'event') {
      if (m.e.kind === 'unknown') unknowns.push(m.e.t);
      else events.push(m.e);
    } else if (m.type === 'match') {
      matches.push(m.event);
    }
  }
  return { events, unknowns, matches };
}

const hitArb = fc.record({
  cls: fc.constantFrom(...ALL),
  gapMs: fc.integer({ min: GAP_MIN_MS, max: GAP_MAX_MS }),
  gainDb: fc.integer({ min: GAIN_MIN_DB, max: GAIN_MAX_DB }),
});

const caseArb = fc.record({
  sampleRate: fc.constantFrom(...SAMPLE_RATES_HZ),
  hits: fc.array(hitArb, { minLength: 1, maxLength: MAX_IMPACTS }),
  chunkSizes: fc.array(fc.integer({ min: CHUNK_SIZE_MIN, max: CHUNK_SIZE_MAX }), { minLength: 1, maxLength: 4 }),
  seed: fc.integer({ min: 1, max: SEED_MAX }),
});

function signalFor(c: { sampleRate: number; hits: { cls: ImpactName; gapMs: number; gainDb: number }[]; seed: number }) {
  let at = LEAD_MS;
  const hits: Hit[] = c.hits.map((h) => {
    const hit = { atMs: at, cls: h.cls, gainDb: h.gainDb };
    at += h.gapMs;
    return hit;
  });
  return makeSignal({ sampleRate: c.sampleRate, totalMs: at + TAIL_MS, hits, seed: c.seed, noiseRmsDb: NOISE_BED_DB });
}

describe('protocol over the message boundary (P3)', () => {
  it('gives the events, unknowns and matches of runSamples at any chunk size', () => {
    fc.assert(fc.property(caseArb, (c) => {
      const signal = signalFor(c);
      const sounds = buildModel(ALL, c.sampleRate);
      const state = createWorkerState();
      const out = [
        ...handleWorkerMessage(state, init(sounds, c.sampleRate)),
        ...feed(state, signal, c.chunkSizes),
        ...handleWorkerMessage(state, { type: 'flush' }),
      ];
      expect(out.filter((m) => m.type === 'error')).toEqual([]);
      expect(splitMessages(out)).toEqual(runSamples(signal, c.sampleRate, sounds, PATTERNS));
    }), { numRuns: PBT_RUNS });
  }, CASE_TIMEOUT_MS);

  it('sends only messages that survive structuredClone, and a transfer list of the envelope buffers', () => {
    fc.assert(fc.property(caseArb, (c) => {
      const signal = signalFor(c);
      const state = createWorkerState();
      const out = [
        ...handleWorkerMessage(state, init(buildModel(ALL, c.sampleRate), c.sampleRate)),
        ...feed(state, signal, c.chunkSizes),
        ...handleWorkerMessage(state, { type: 'flush' }),
      ];
      for (const m of out) {
        expect(structuredClone(m)).toEqual(m);
        const list = transferListOf(m);
        if (m.type === 'envelope') {
          expect(list).toEqual([m.min.buffer, m.max.buffer]);
        } else {
          expect(list).toEqual([]);
        }
      }
    }), { numRuns: Math.max(1, Math.floor(PBT_RUNS / 5)) });
  }, CASE_TIMEOUT_MS);
});

describe('envelope', () => {
  it('covers the signal in bins of WEB_ENVELOPE_RESOLUTION_MS with exact min and max and consecutive t0', () => {
    fc.assert(fc.property(caseArb, (c) => {
      const signal = signalFor(c);
      const binSize = msToSamples(WEB_ENVELOPE_RESOLUTION_MS, c.sampleRate);
      const state = createWorkerState();
      const out = [
        ...handleWorkerMessage(state, init(buildModel(ALL, c.sampleRate), c.sampleRate)),
        ...feed(state, signal, c.chunkSizes),
        ...handleWorkerMessage(state, { type: 'flush' }),
      ];
      const mins: number[] = [];
      const maxs: number[] = [];
      let binsSoFar = 0;
      for (const m of out) {
        if (m.type !== 'envelope') continue;
        expect(m.t0).toBe((binsSoFar * binSize) / c.sampleRate);
        expect(m.min.length).toBe(m.max.length);
        expect(m.min.length).toBeGreaterThan(0);
        mins.push(...m.min);
        maxs.push(...m.max);
        binsSoFar += m.min.length;
      }
      const nBins = Math.floor(signal.length / binSize);
      expect(mins.length).toBe(nBins);
      for (let b = 0; b < nBins; b++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = b * binSize; i < (b + 1) * binSize; i++) {
          lo = Math.min(lo, signal[i]);
          hi = Math.max(hi, signal[i]);
        }
        expect(mins[b]).toBe(lo);
        expect(maxs[b]).toBe(hi);
      }
    }), { numRuns: Math.max(1, Math.floor(PBT_RUNS / 5)) });
  }, CASE_TIMEOUT_MS);

  it('finishes a bin that a chunk boundary cut, with one-sample chunks', () => {
    const rate = 16000;
    const binSize = msToSamples(WEB_ENVELOPE_RESOLUTION_MS, rate);
    const samples = Float32Array.from({ length: binSize * 2 + 3 }, (_, i) => Math.sin(i) * 0.5);
    const state = createWorkerState();
    handleWorkerMessage(state, init(buildModel(ALL, rate), rate));
    const out = feed(state, samples, [1]);
    const env = out.filter((m): m is Extract<WorkerToMain, { type: 'envelope' }> => m.type === 'envelope');
    expect(env.length).toBe(2);
    expect(env.map((m) => m.t0)).toEqual([0, binSize / rate]);
    expect(env.every((m) => m.min.length === 1)).toBe(true);
  });
});

describe('setMode', () => {
  it('switches which patterns fire, and an unknown mode gives an error message', () => {
    const rate = REPLACE_RATE_HZ;
    const sounds = buildModel(ALL, rate);
    const signal = makeSignal({
      sampleRate: rate, totalMs: SETMODE_TOTAL_MS, seed: 4242, noiseRmsDb: NOISE_BED_DB,
      hits: [
        { atMs: SETMODE_FIRST_AT_MS, cls: 'low', gainDb: -6 },
        { atMs: SETMODE_SECOND_AT_MS, cls: 'high', gainDb: -6 },
      ],
    });
    const cut = msToSamples(SETMODE_SWITCH_AT_MS, rate);
    const state = createWorkerState();
    const out = [
      ...handleWorkerMessage(state, init(sounds, rate, { a: ['low'], b: ['high'] }, 'a')),
      ...feed(state, signal.slice(0, cut), [4096]),
      ...handleWorkerMessage(state, { type: 'setMode', name: 'b' }),
      ...feed(state, signal.slice(cut), [4096]),
      ...handleWorkerMessage(state, { type: 'flush' }),
    ];
    expect(out.filter((m) => m.type === 'error')).toEqual([]);
    expect(out.filter((m) => m.type === 'match').map((m) => (m as { pattern: string }).pattern)).toEqual(['low', 'high']);

    const bad = handleWorkerMessage(state, { type: 'setMode', name: 'zz' });
    expect(bad.length).toBe(1);
    expect(bad[0].type).toBe('error');
    expect((bad[0] as { message: string }).message).toMatch(/Unknown mode "zz"/);
  });
});

describe('errors', () => {
  it('turns an unsupported sample rate into one error with the engine text, then errors on chunks', () => {
    const state = createWorkerState();
    const out = handleWorkerMessage(state, init(buildModel(['low', 'mid'], REPLACE_RATE_HZ), UNSUPPORTED_RATE_HZ));
    expect(out).toEqual([{ type: 'error', message: engineErrorText(UNSUPPORTED_RATE_HZ) }]);
    const next = handleWorkerMessage(state, { type: 'chunk', samples: new Float32Array(100) });
    expect(next.length).toBe(1);
    expect(next[0].type).toBe('error');
  });

  it('gives an error for a chunk before init, a chunk without Float32Array, and an unknown type', () => {
    const state = createWorkerState();
    const before = handleWorkerMessage(state, { type: 'chunk', samples: new Float32Array(10) });
    expect(before.map((m) => m.type)).toEqual(['error']);

    handleWorkerMessage(state, init(buildModel(ALL, REPLACE_RATE_HZ), REPLACE_RATE_HZ));
    const bad = handleWorkerMessage(state, { type: 'chunk', samples: [1, 2, 3] });
    expect(bad.map((m) => m.type)).toEqual(['error']);

    const unknown = handleWorkerMessage(state, { type: 'frobnicate' });
    expect(unknown.length).toBe(1);
    expect((unknown[0] as { message: string }).message).toContain('frobnicate');

    for (const junk of [null, undefined, 42, 'chunk', {}]) {
      expect(() => handleWorkerMessage(state, junk)).not.toThrow();
      expect(handleWorkerMessage(state, junk).map((m) => m.type)).toEqual(['error']);
    }
  });

  it('turns an exception inside the engine into an error message', () => {
    const rate = REPLACE_RATE_HZ;
    const good = buildModel(ALL, rate);
    const broken = { ...good, examples: null, mean: null } as unknown as SoundModel;
    const state = createWorkerState();
    const signal = makeSignal({
      sampleRate: rate, totalMs: LEAD_MS + 1000, seed: 9, noiseRmsDb: NOISE_BED_DB,
      hits: [{ atMs: LEAD_MS, cls: 'low', gainDb: -6 }],
    });
    const out = [
      ...handleWorkerMessage(state, init(broken, rate)),
      ...feed(state, signal, [4096]),
      ...handleWorkerMessage(state, { type: 'flush' }),
    ];
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((m) => m.type === 'error' || m.type === 'envelope')).toBe(true);
    expect(out.some((m) => m.type === 'error')).toBe(true);
  });

  it('answers a connect message with no outgoing message', () => {
    const state = createWorkerState();
    expect(handleWorkerMessage(state, { type: 'connect', port: { postMessage() {}, addEventListener() {} } })).toEqual([]);
  });
});

describe('replaceSounds', () => {
  it('uses the new model, restarts the engine clock and keeps envelope times continuous', () => {
    const rate = REPLACE_RATE_HZ;
    const first = buildModel(['low', 'mid'], rate);
    const second = buildModel(['low', 'mid'], rate, { low: 'high' });
    const signal = makeSignal({
      sampleRate: rate, totalMs: LEAD_MS + 1500, seed: 77, noiseRmsDb: NOISE_BED_DB,
      hits: [{ atMs: LEAD_MS, cls: 'low', gainDb: -6 }],
    });
    const state = createWorkerState();
    const run1 = [
      ...handleWorkerMessage(state, init(first, rate)),
      ...feed(state, signal, [4096]),
      ...handleWorkerMessage(state, { type: 'flush' }),
    ];
    const swap = handleWorkerMessage(state, { type: 'replaceSounds', sounds: second });
    expect(swap.filter((m) => m.type === 'error')).toEqual([]);
    const run2 = [...feed(state, signal, [4096]), ...handleWorkerMessage(state, { type: 'flush' })];

    const m1 = run1.filter((m) => m.type === 'match') as { pattern: string; event: { t: number } }[];
    const m2 = run2.filter((m) => m.type === 'match') as { pattern: string; event: { t: number } }[];
    expect(m1.map((m) => m.pattern)).toEqual(['low']);
    expect(m2.map((m) => m.pattern)).toEqual(['high']);
    expect(m2[0].event.t).toBe(m1[0].event.t);

    const env = [...run1, ...run2].filter((m) => m.type === 'envelope') as { t0: number; min: Float32Array }[];
    const binSize = msToSamples(WEB_ENVELOPE_RESOLUTION_MS, rate);
    let bins = 0;
    for (const m of env) {
      expect(m.t0).toBe((bins * binSize) / rate);
      bins += m.min.length;
    }
    expect(bins).toBe(Math.floor((2 * signal.length) / binSize));
  });
});
