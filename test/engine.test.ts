import { describe, it, expect } from 'vitest';
import { createEngine, runSamples } from '../core/engine';
import type { EngineEvent } from '../core/engine';
import { place, rng, synthNoise, synthTone } from '../core/synth';
import type { MatchEvent, SoundEvent } from '../core/types';
import { HUM_END_UNVOICED_MS, HUM_SPEED_MAX_SEMITONES } from '../core/constants';
import {
  LEAD_MS, TRAIL_MS, buildModel, buildNoisyModel, clip, hitSeed, impactClip, loudestWindowDb, makeSignal,
  type Hit, type ImpactName,
} from './helpers/engine-fixture';

// Test-only values.
const SR_HZ = 44100;
const P1_MAX_IMPACTS = 5;
const P1_GAP_MIN_MS = 210;        // first segment no longer cut by the next hit (known limit, design.md)
const P1_GAP_MAX_MS = 600;
const P1_SLOW_CLASS_MIN_GAP_MS = 440;   // same limit for low and ring
const P1_GAIN_MIN_DB = -20;
const P1_GAIN_MAX_DB = 6;
const P1_SNR_MIN_DB = 20;        // known limit, see design.md
const P1_TRAIN_SNR_MIN_DB = 15;  // training noise range stays 15-30 dB (Req 15.2)
const P1_SNR_MAX_DB = 30;
const P1_TRAIN_SNR_MAX_DB = 30;   // training SNR range is 15-30 dB (Req 15.2)
const PATTERN_GAIN_DB = -6;
const SILENCE_MS = 3000;
const FLUSH_CUT_MS = 300;       // shorter than an isolated low segment (about 400 ms)
const DITHER_DB = -70;
const PBT_RUNS = Number(process.env.PBT_RUNS ?? '100');
const P1_MS_PER_CASE = 1000;
const P1_CASES_DEFAULT = 150;   // default npm test
const P1_CASES_FULL = 300;      // used when PBT_RUNS >= 300
const P1_EXACT_RATE_MIN = 0.98;
const P1_CASE_SEED = 8101;
const P1B_CASE_SEED = 8202;
const P1_SEED_MAX = 1_000_000;
const P1_IMPACT_SPAN_MS = 500;
const TIMEOUT_FLOOR_MS = 120_000;
const CHUNK_SIZES = [1, 441, 4096, 50000];

const ALL: ImpactName[] = ['low', 'mid', 'high', 'ring'];
const model = () => buildModel(ALL, SR_HZ);

function hits(cls: ImpactName, atMs: number[], gainDb = PATTERN_GAIN_DB): Hit[] {
  return atMs.map((a) => ({ atMs: a, cls, gainDb }));
}
function signalOf(h: Hit[], trailMs = TRAIL_MS, seed = 77): Float32Array {
  const last = Math.max(...h.map((x) => x.atMs));
  return makeSignal({ sampleRate: SR_HZ, totalMs: last + 500 + trailMs, hits: h, seed });
}

describe('construction (Req 1, 4)', () => {
  const base = () => ({ sounds: model(), sampleRate: SR_HZ });

  it.each([8000, 96001, NaN])('rejects sampleRate %s with a RangeError naming sampleRate', (sr) => {
    expect(() => createEngine({ ...base(), sampleRate: sr })).toThrow(RangeError);
    expect(() => createEngine({ ...base(), sampleRate: sr })).toThrow(/sampleRate/);
    expect(() => runSamples(new Float32Array(10), sr, model())).toThrow(RangeError);
  });

  it('rejects on with modes, an unknown mode and modes without mode', () => {
    expect(() => createEngine({ ...base(), on: {}, modes: { a: {} }, mode: 'a' })).toThrow();
    expect(() => createEngine({ ...base(), modes: { a: {} } })).toThrow(/a/);
    expect(() => createEngine({ ...base(), modes: { a: {}, b: {} }, mode: 'zz' })).toThrow(/a, b|a.*b/);
  });

  it('checks the patterns of an inactive mode at creation', () => {
    expect(() => createEngine({ ...base(), modes: { a: { low: () => {} }, b: { '_ low': () => {} } }, mode: 'a' })).toThrow(RangeError);
  });

  it('keeps the mode when setMode gets an unknown name', () => {
    const calls: string[] = [];
    const e = createEngine({ ...base(), modes: { a: { low: () => calls.push('a') }, b: { low: () => calls.push('b') } }, mode: 'a' });
    expect(() => e.setMode('nope')).toThrow(/a, b|a.*b/);
    e.push(signalOf(hits('low', [LEAD_MS])));
    e.flush();
    expect(calls).toEqual(['a']);
  });
});

describe('inputs (Req 2, 6)', () => {
  it('gives nothing for an empty buffer, zeros and dither', () => {
    const none = { events: [], matches: [], unknowns: [] };
    expect(runSamples(new Float32Array(0), SR_HZ, model(), ['low'])).toEqual(none);
    expect(runSamples(new Float32Array(SR_HZ * 3), SR_HZ, model(), ['low'])).toEqual(none);
    const dither = synthNoise('white', SILENCE_MS, DITHER_DB, SR_HZ, rng(5));
    expect(runSamples(dither, SR_HZ, model(), ['low'])).toEqual(none);
  });

  it('drops a background impact and still reports low', () => {
    const m = buildModel(['low', 'ring'], SR_HZ, { ring: 'background' });
    const r = runSamples(signalOf([...hits('ring', [LEAD_MS]), ...hits('low', [LEAD_MS + 1500])]), SR_HZ, m);
    expect(r.events.map((e) => (e.kind === 'sound' ? e.label : ''))).toEqual(['low']);
    expect(r.unknowns).toEqual([]);
  });

  it('reports a tone against an impact-only model as unknown with its t', () => {
    const m = buildModel(['low', 'mid'], SR_HZ);
    const tone = synthTone({ f0Hz: 800, durationMs: 300, gainDb: -6 }, SR_HZ);
    const x = new Float32Array(Math.round((LEAD_MS + 300 + TRAIL_MS) * SR_HZ / 1000));
    x.set(tone, Math.round(LEAD_MS * SR_HZ / 1000));
    const r = runSamples(x, SR_HZ, m);
    expect(r.events).toEqual([]);
    expect(r.unknowns).toHaveLength(1);
    expect(Math.abs(r.unknowns[0] - LEAD_MS / 1000)).toBeLessThan(0.02);
  });

  it('does not keep or modify a pushed chunk and ignores empty chunks', () => {
    const e = createEngine({ sounds: model(), sampleRate: SR_HZ });
    const chunk = signalOf(hits('low', [LEAD_MS]));
    const copy = chunk.slice();
    e.push(new Float32Array(0));
    e.push(chunk);
    expect(chunk).toEqual(copy);
  });
});

describe('patterns (Req 3, 4, 5)', () => {
  const run = (cls: ImpactName, at: number[], patterns: string[]) => runSamples(signalOf(hits(cls, at)), SR_HZ, model(), patterns);

  it('low low at 200 ms fires once with the t of the second sound', () => {
    const r = run('low', [LEAD_MS, LEAD_MS + 200], ['low low']);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].pattern).toBe('low low');
    expect(r.matches[0].t).toBeCloseTo(r.events[1].t, 9);
  });

  it.each([250, 300])('low and low low with impacts %i ms apart fire only low low', (gap) => {
    const r = run('low', [LEAD_MS, LEAD_MS + gap], ['low', 'low low']);
    expect(r.matches.map((m) => m.pattern)).toEqual(['low low']);
  });

  it('fires low alone without flush after trailing silence, with the t of the sound', () => {
    const matches: MatchEvent[] = [];
    const e = createEngine({ sounds: model(), sampleRate: SR_HZ, on: { low: (m) => matches.push(m) } });
    const events: EngineEvent[] = [];
    const e2 = createEngine({ sounds: model(), sampleRate: SR_HZ, on: {}, onEvent: (x) => events.push(x) });
    const x = signalOf(hits('low', [LEAD_MS]), 1500);
    e.push(x);
    e2.push(x);
    e2.flush();
    expect(matches).toHaveLength(1);
    const sound = events.find((v) => v.kind === 'sound')!;
    expect(matches[0].t).toBe(sound.t);
  });

  it('flush fires a pending pattern', () => {
    const matches: MatchEvent[] = [];
    const e = createEngine({ sounds: model(), sampleRate: SR_HZ, on: { low: (m) => matches.push(m), 'low low': (m) => matches.push(m) } });
    // Cut while the segment is still open, so only flush can close it.
    e.push(signalOf(hits('low', [LEAD_MS]), 0).subarray(0, Math.round((LEAD_MS + FLUSH_CUT_MS) * SR_HZ / 1000)));
    expect(matches).toHaveLength(0);
    e.flush();
    expect(matches.map((m) => m.pattern)).toEqual(['low']);
  });

  it('setMode switches handlers and drops a pending sequence', () => {
    const calls: string[] = [];
    const e = createEngine({
      sounds: model(), sampleRate: SR_HZ,
      modes: { a: { 'low low': () => calls.push('a') }, b: { low: () => calls.push('b') } }, mode: 'a',
    });
    const pre = Math.round((LEAD_MS + 450) * SR_HZ / 1000);
    const x = signalOf(hits('low', [LEAD_MS, LEAD_MS + 3000]), 0);
    e.push(x.subarray(0, pre));
    e.setMode('b');
    e.push(x.subarray(pre));
    e.flush();
    expect(calls).toEqual(['b']);
  });
});

describe('chunk independence (Req 5.3)', () => {
  it('gives equal events and matches for every chunking', () => {
    const h: Hit[] = [
      { atMs: LEAD_MS, cls: 'low', gainDb: -6 }, { atMs: LEAD_MS + 250, cls: 'low', gainDb: -6 },
      { atMs: LEAD_MS + 1500, cls: 'mid', gainDb: -10 }, { atMs: LEAD_MS + 1900, cls: 'high', gainDb: -3 },
      { atMs: LEAD_MS + 2400, cls: 'low', gainDb: -6 },
    ];
    const x = signalOf(h);
    const patterns = ['low', 'low low', 'mid high', 'high'];
    const whole = runSamples(x, SR_HZ, model(), patterns);
    expect(whole.events.length).toBeGreaterThan(3);
    for (const size of CHUNK_SIZES) {
      const events: EngineEvent[] = [];
      const matches: MatchEvent[] = [];
      const e = createEngine({
        sounds: model(), sampleRate: SR_HZ, on: Object.fromEntries(patterns.map((p) => [p, (m: MatchEvent) => matches.push(m)])),
        onEvent: (v) => events.push(v),
      });
      for (let i = 0; i < x.length; i += size) e.push(x.subarray(i, i + size));
      e.flush();
      expect(events.filter((v) => v.kind !== 'unknown')).toEqual(whole.events);
      expect(matches).toEqual(whole.matches);
    }
  });
});

describe('P1 count preservation, statistical acceptance (Req 15)', () => {
  const rates = [44100, 48000] as const;
  // Cases per test: P1_CASES_DEFAULT keeps `npm test` short; PBT_RUNS >= P1_CASES_FULL runs the full set.
  const cases = PBT_RUNS >= P1_CASES_FULL ? P1_CASES_FULL : P1_CASES_DEFAULT;
  const timeout = Math.max(TIMEOUT_FLOOR_MS, P1_MS_PER_CASE * cases);

  type Outcome = 'exact' | 'over' | 'under' | 'wrong-label';
  interface Case { rate: number; cls: ImpactName; n: number; gap: number; gain: number; snr: number; seed: number }

  function drawCases(classes: ImpactName[], gapMinMs: number, seed: number): Case[] {
    const r = rng(seed);
    const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
    return Array.from({ length: cases }, () => ({
      rate: rates[int(0, rates.length - 1)],
      cls: classes[int(0, classes.length - 1)],
      n: int(1, P1_MAX_IMPACTS),
      gap: int(gapMinMs, P1_GAP_MAX_MS),
      gain: int(P1_GAIN_MIN_DB, P1_GAIN_MAX_DB),
      snr: int(P1_SNR_MIN_DB, P1_SNR_MAX_DB),
      seed: int(1, P1_SEED_MAX),
    }));
  }

  function runCase(c: Case): { outcome: Outcome; labels: string[]; unknowns: number } {
    const m = buildNoisyModel(ALL, c.rate, P1_TRAIN_SNR_MIN_DB, P1_TRAIN_SNR_MAX_DB);
    // The SNR holds for every impact: the noise is set from the quietest clean clip (Req 15.3).
    const quietestDb = Math.min(...Array.from({ length: c.n }, (_, k) => loudestWindowDb(impactClip(c.cls, c.gain, c.rate, hitSeed(c.seed, k)), c.rate)));
    const h = hits(c.cls, Array.from({ length: c.n }, (_, k) => LEAD_MS + k * c.gap), c.gain);
    const x = clip(makeSignal({ sampleRate: c.rate, totalMs: LEAD_MS + (c.n - 1) * c.gap + P1_IMPACT_SPAN_MS + TRAIL_MS, hits: h, seed: c.seed, noiseRmsDb: quietestDb - c.snr }));
    const r = runSamples(x, c.rate, m);
    const labels = r.events.map((e) => (e.kind === 'sound' ? e.label : 'continuous'));
    const outcome: Outcome = labels.some((l) => l !== c.cls) ? 'wrong-label'
      : labels.length > c.n ? 'over' : labels.length < c.n ? 'under' : 'exact';
    return { outcome, labels, unknowns: r.unknowns.length };
  }

  function accept(name: string, classes: ImpactName[], gapMinMs: number, seed: number): void {
    const results = drawCases(classes, gapMinMs, seed).map((c) => ({ c, ...runCase(c) }));
    const count = (o: Outcome) => results.filter((x) => x.outcome === o).length;
    const exactRate = count('exact') / results.length;
    // A miss is fine only as an `unknown`: every under-count must be explained by unknowns.
    const missNotUnknown = results.filter((x) => x.outcome === 'under' && x.labels.length + x.unknowns < x.c.n).length;
    const failing = results.filter((x) => x.outcome !== 'exact').slice(0, 3)
      .map((x) => `[${x.c.rate}, ${x.c.cls}, N=${x.c.n}, gap ${x.c.gap} ms, gain ${x.c.gain} dB, SNR ${x.c.snr} dB, seed ${x.c.seed}] -> ${x.outcome}: [${x.labels.join(', ')}], ${x.unknowns} unknown`);
    const report = `${name}: ${results.length} cases, exact ${(exactRate * 100).toFixed(1)} %, over ${count('over')}, under ${count('under')}, wrong label ${count('wrong-label')}, miss without unknown ${missNotUnknown}` + (failing.length ? `\n  ${failing.join('\n  ')}` : '');
    console.log(report);
    expect({ exactOk: exactRate >= P1_EXACT_RATE_MIN, over: count('over'), wrongLabel: count('wrong-label'), missNotUnknown }, report)
      .toEqual({ exactOk: true, over: 0, wrongLabel: 0, missNotUnknown: 0 });
  }

  it('P1 engine returns exactly N events for mid and high impacts in at least 98 % of cases, never more, never a wrong label', () => {
    accept('P1', ['mid', 'high'], P1_GAP_MIN_MS, P1_CASE_SEED);
  }, timeout);

  it('P1b engine returns exactly N events for low and ring impacts in at least 98 % of cases, never more, never a wrong label', () => {
    accept('P1b', ['low', 'ring'], P1_SLOW_CLASS_MIN_GAP_MS, P1B_CASE_SEED);
  }, timeout);
});
describe('hum paths (Task 6)', () => {
  const HUM_GAIN_DB = -12;
  const HUM_LEAD_MS = LEAD_MS;
  const HUM_BASELINE_HZ = 150;
  const HUM_STEADY_F0_HZ = 200;
  const HUM_MIN_MS = 2500;
  const HUM_IMPACT_AFTER_MS = 1500;
  const GLIDE_MS = 2000;
  const GLIDE_UP_HZ = 300;
  const GLIDE_DOWN_HZ = 100;
  const VIBRATO_CENTS = 50;
  const PRE_HUM_F0_MIN_HZ = 150;
  const PRE_HUM_F0_MAX_HZ = 350;
  const PRE_HUM_MS_MIN = 1000;
  const PRE_HUM_MS_MAX = 2000;
  const PRE_HUM_GAIN_MIN_DB = -12;
  const PRE_HUM_GAIN_MAX_DB = 0;
  const PRE_HUM_NOISE_ONLY_MS = 700;
  const PRE_HUM_CASE_SEED = 8303;
  const LOW_SWEEP_GAIN_MIN_DB = -20;
  const LOW_SWEEP_GAIN_MAX_DB = 6;
  const LOW_SWEEP_SEEDS = [101, 202, 303, 404];
  const LOW_SWEEP_SNR_DB = 20;
  const LOW_SWEEP_EXACT_MIN = 0.98;
  const MS = 1000;

  const hum = (f0Hz: number, durationMs: number, extra: { vibratoCents?: number; glideToHz?: number } = {}) =>
    synthTone({ f0Hz, durationMs, gainDb: HUM_GAIN_DB, ...extra }, SR_HZ);
  const soundEvents = (events: SoundEvent[]) => events.filter((e) => e.kind === 'sound');
  const risingFalling = ['hum.rise', 'hum.fall'];
  const pitchModel = () => ({ ...model(), pitch: { baselineHz: HUM_BASELINE_HZ } });

  it('an impact during an active hum is not classified', () => {
    const impactAtMs = HUM_LEAD_MS + HUM_IMPACT_AFTER_MS;
    const total = HUM_LEAD_MS + HUM_MIN_MS + TRAIL_MS;
    const x = clip(place([
      { atMs: HUM_LEAD_MS, samples: hum(HUM_STEADY_F0_HZ, HUM_MIN_MS) },
      { atMs: impactAtMs, samples: impactClip('mid', PATTERN_GAIN_DB, SR_HZ, 5) },
    ], total, SR_HZ));
    const r = runSamples(x, SR_HZ, model());
    expect(soundEvents(r.events)).toEqual([]);
    expect(r.unknowns).toEqual([]);
    expect(r.events.some((e) => e.kind === 'continuous' && e.phase === 'start')).toBe(true);
  });

  it('hum.rise fires through the engine for a rising hum', () => {
    const run = (x: Float32Array) => runSamples(x, SR_HZ, pitchModel(), risingFalling).matches;
    const line = (f0: number, extra: { vibratoCents?: number; glideToHz?: number }) =>
      place([{ atMs: HUM_LEAD_MS, samples: hum(f0, GLIDE_MS, extra) }], HUM_LEAD_MS + GLIDE_MS + TRAIL_MS, SR_HZ);
    const up = run(line(HUM_BASELINE_HZ, { glideToHz: GLIDE_UP_HZ }));
    expect(up.length).toBeGreaterThan(0);
    for (const m of up) {
      expect(m.pattern).toBe('hum.rise');
      expect(m.speed!).toBeGreaterThan(0);
      expect(m.speed!).toBeLessThanOrEqual(HUM_SPEED_MAX_SEMITONES);
    }
    const down = run(line(HUM_BASELINE_HZ, { glideToHz: GLIDE_DOWN_HZ }));
    expect(down.length).toBeGreaterThan(0);
    expect(down.every((m) => m.pattern === 'hum.fall')).toBe(true);
    expect(run(line(HUM_BASELINE_HZ, {}))).toEqual([]);
    expect(run(line(HUM_BASELINE_HZ, { vibratoCents: VIBRATO_CENTS }))).toEqual([]);
  });

  describe('P1 with a hum before the impacts', () => {
    const cases = PBT_RUNS >= P1_CASES_FULL ? P1_CASES_FULL : P1_CASES_DEFAULT;
    const timeout = Math.max(TIMEOUT_FLOOR_MS, P1_MS_PER_CASE * cases);
    const rates = [44100, 48000] as const;
    const classes: ImpactName[] = ['mid', 'high'];

    it('P1 with a hum before the impacts', () => {
      const r = rng(PRE_HUM_CASE_SEED);
      const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
      let exact = 0;
      let over = 0;
      let wrongLabel = 0;
      let missNotUnknown = 0;
      let humLeak = 0;
      const failing: string[] = [];
      for (let k = 0; k < cases; k++) {
        const c = {
          rate: rates[int(0, rates.length - 1)], cls: classes[int(0, classes.length - 1)], n: int(1, P1_MAX_IMPACTS),
          gap: int(P1_GAP_MIN_MS, P1_GAP_MAX_MS), gain: int(P1_GAIN_MIN_DB, P1_GAIN_MAX_DB), snr: int(P1_SNR_MIN_DB, P1_SNR_MAX_DB),
          seed: int(1, P1_SEED_MAX), humHz: int(PRE_HUM_F0_MIN_HZ, PRE_HUM_F0_MAX_HZ), humMs: int(PRE_HUM_MS_MIN, PRE_HUM_MS_MAX),
          humGain: int(PRE_HUM_GAIN_MIN_DB, PRE_HUM_GAIN_MAX_DB),
        };
        const m = buildNoisyModel(ALL, c.rate, P1_TRAIN_SNR_MIN_DB, P1_TRAIN_SNR_MAX_DB);
        const quietestDb = Math.min(...Array.from({ length: c.n }, (_, i) => loudestWindowDb(impactClip(c.cls, c.gain, c.rate, hitSeed(c.seed, i)), c.rate)));
        const firstImpactMs = LEAD_MS + c.humMs + PRE_HUM_NOISE_ONLY_MS;
        const h = hits(c.cls, Array.from({ length: c.n }, (_, i) => firstImpactMs + i * c.gap), c.gain);
        const base = makeSignal({ sampleRate: c.rate, totalMs: firstImpactMs + (c.n - 1) * c.gap + P1_IMPACT_SPAN_MS + TRAIL_MS, hits: h, seed: c.seed, noiseRmsDb: quietestDb - c.snr });
        const tone = synthTone({ f0Hz: c.humHz, durationMs: c.humMs, gainDb: c.humGain }, c.rate);
        const humAt = Math.round((LEAD_MS * c.rate) / MS);
        for (let i = 0; i < tone.length; i++) base[humAt + i] += tone[i];
        const res = runSamples(clip(base), c.rate, m);
        const labels = soundEvents(res.events).map((e) => (e.kind === 'sound' ? e.label : ''));
        const leak = res.events.filter((e) => e.kind === 'continuous' && e.t > (firstImpactMs - HUM_END_UNVOICED_MS) / MS).length;
        if (leak > 0) humLeak++;
        const wrong = labels.some((l) => l !== c.cls);
        if (wrong) wrongLabel++;
        else if (labels.length > c.n) over++;
        else if (labels.length < c.n) { if (labels.length + res.unknowns.length < c.n) missNotUnknown++; }
        else exact++;
        if (failing.length < 3 && (wrong || labels.length !== c.n || leak > 0)) {
          failing.push(`[${c.rate}, ${c.cls}, N=${c.n}, gap ${c.gap}, gain ${c.gain}, SNR ${c.snr}, seed ${c.seed}, hum ${c.humHz} Hz ${c.humMs} ms ${c.humGain} dB] labels [${labels}], ${res.unknowns.length} unknown, leak ${leak}`);
        }
      }
      const exactRate = exact / cases;
      const report = `P1 with hum: ${cases} cases, exact ${(exactRate * 100).toFixed(1)} %, over ${over}, wrong label ${wrongLabel}, miss without unknown ${missNotUnknown}, continuous after the hum ${humLeak}` + (failing.length ? `\n  ${failing.join('\n  ')}` : '');
      console.log(report);
      expect({ exactOk: exactRate >= P1_EXACT_RATE_MIN, over, wrongLabel, missNotUnknown, humLeak }, report)
        .toEqual({ exactOk: true, over: 0, wrongLabel: 0, missNotUnknown: 0, humLeak: 0 });
    }, timeout);
  });

  it('the low class is not taken for a hum (review item 12)', () => {
    const m = buildNoisyModel(ALL, SR_HZ, P1_TRAIN_SNR_MIN_DB, P1_TRAIN_SNR_MAX_DB);
    let cases = 0;
    let exact = 0;
    let continuous = 0;
    let wrongLabel = 0;
    let missNotUnknown = 0;
    for (let gain = LOW_SWEEP_GAIN_MIN_DB; gain <= LOW_SWEEP_GAIN_MAX_DB; gain++) {
      for (const seed of LOW_SWEEP_SEEDS) {
        cases++;
        const noiseDb = loudestWindowDb(impactClip('low', gain, SR_HZ, hitSeed(seed, 0)), SR_HZ) - LOW_SWEEP_SNR_DB;
        const x = clip(makeSignal({ sampleRate: SR_HZ, totalMs: LEAD_MS + P1_IMPACT_SPAN_MS + TRAIL_MS, hits: hits('low', [LEAD_MS], gain), seed, noiseRmsDb: noiseDb }));
        const r = runSamples(x, SR_HZ, m);
        continuous += r.events.filter((e) => e.kind === 'continuous').length;
        const labels = r.events.filter((e) => e.kind === 'sound').map((e) => (e.kind === 'sound' ? e.label : ''));
        if (labels.some((l) => l !== 'low')) wrongLabel++;
        else if (labels.length === 1) exact++;
        else if (labels.length + r.unknowns.length < 1) missNotUnknown++;
      }
    }
    console.log(`low sweep: ${cases} cases, exact ${exact}, continuous events ${continuous}, wrong label ${wrongLabel}, miss without unknown ${missNotUnknown}`);
    expect(cases).toBe((LOW_SWEEP_GAIN_MAX_DB - LOW_SWEEP_GAIN_MIN_DB + 1) * LOW_SWEEP_SEEDS.length);
    expect({ exactOk: exact / cases >= LOW_SWEEP_EXACT_MIN, continuous, wrongLabel, missNotUnknown })
      .toEqual({ exactOk: true, continuous: 0, wrongLabel: 0, missNotUnknown: 0 });
  }, TIMEOUT_FLOOR_MS);
});
