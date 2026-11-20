import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BACKGROUND, HUM_LABEL, MIN_EXAMPLES_PER_LABEL, NOISE_FLOOR_WARMUP_MS, SYNTH_FIXTURE_LEAD_NOISE_DBFS, SYNTH_FIXTURE_SOUNDS_SPACING_MS,
  SYNTH_FIXTURE_TAIL_MS,
} from '../core/constants';
import { Segmenter } from '../core/segment';
import { teachFromRecordings } from '../core/teach';
import type { Recording } from '../core/teach';
import { readWav, writeWav } from '../core/wav';
import { WEB_TEACH_FILE_NAME, WEB_TEACH_PAGE_CLIP_MARGIN_MS } from '../web/constants';
import { buildClips, clipBounds } from '../web/clips';
import type { TakeSegment } from '../web/clips';
import { createWorkerState, handleWorkerMessage, msToSamples, transferListOf } from '../web/protocol';
import type { WorkerToMain } from '../web/protocol';
import { LEAD_MS, TRAIN_GAIN_DB, TRAIN_PER_CLASS, TRAIN_SPACING_MS, makeSignal } from './helpers/engine-fixture';
import type { Hit, ImpactName } from './helpers/engine-fixture';

// Test-only values.
const PBT_RUNS = Number(process.env.PBT_RUNS ?? '100');
const PBT_TIMEOUT_FLOOR_MS = 120_000;
const PBT_MS_PER_CASE = 1500;
const RATE_HZ = 48000;
const CHUNK_MS = 20;
const TAKE_MS = 10000;
const LEAD_END_MS = NOISE_FLOOR_WARMUP_MS;
const SEGMENT_MS = 100;
const SEED = 7100;
const SEED_MAX = 1_000_000;
const GAP_EXTRA_MAX_MS = 800;           // added to TRAIN_SPACING_MS
const HITS_MIN = 2;
const HITS_MAX = 5;
const TEACH_LEAD_MS = 3000;             // as the noise bed of the browser teaching WAV
const TEACH_COPIES = 10;
const TEACH_CLASS: ImpactName = 'high';
const CLASSES: ImpactName[] = ['low', 'mid', 'high', 'ring'];
const HUM_HZ = 150;
const HUM_AMPLITUDE = 0.3;
const HUM_TAKE_MS = 3000;
const BACKGROUND_TAKE_MS = 4000;
const TOO_FEW_RECORDING_MS = 500;
const TWO_PI = 2 * Math.PI;

const CHUNK_SAMPLES = msToSamples(CHUNK_MS, RATE_HZ);
const MARGIN = msToSamples(WEB_TEACH_PAGE_CLIP_MARGIN_MS, RATE_HZ);
const LEAD_END = msToSamples(LEAD_END_MS, RATE_HZ);
const at = (ms: number): number => msToSamples(ms, RATE_HZ);

// A take whose sample i holds the value i, so that a test can read the source position of every clip sample.
const ramp = (ms: number): Float32Array => Float32Array.from({ length: at(ms) }, (_, i) => i);
const seg = (id: string, startMs: number, durationMs: number): TakeSegment => ({ id, t: at(startMs) / RATE_HZ, durationMs });

function spans(clip: Float32Array): [number, number][] {
  // Runs of consecutive source positions.
  const out: [number, number][] = [];
  let from = 0;
  for (let i = 1; i <= clip.length; i++) {
    if (i === clip.length || clip[i] !== clip[i - 1] + 1) {
      out.push([clip[from], clip[i - 1] + 1]);
      from = i;
    }
  }
  return out;
}

describe('clip bounds (requirement 4.2)', () => {
  const take = ramp(TAKE_MS);
  const build = (segments: TakeSegment[], keptIds: string[]) =>
    buildClips({ label: 'tap', kind: 'sound', samples: take, sampleRate: RATE_HZ, segments, keptIds });

  it('holds the lead and the segment with a margin on each side', () => {
    const clips = build([seg('a', 3000, SEGMENT_MS), seg('b', 5000, SEGMENT_MS)], ['a', 'b']);
    expect(clips.map((c) => c.id)).toEqual(['a', 'b']);
    const segLen = at(SEGMENT_MS);
    expect(spans(clips[0].samples)).toEqual([[0, LEAD_END], [at(3000) - MARGIN, at(3000) + segLen + MARGIN]]);
    expect(spans(clips[1].samples)).toEqual([[0, LEAD_END], [at(5000) - MARGIN, at(5000) + segLen + MARGIN]]);
  });

  it('keeps the part of a neighbour out of the clip, also a deleted neighbour', () => {
    const segLen = at(SEGMENT_MS);
    const close = [seg('a', 3000, SEGMENT_MS), seg('b', 3150, SEGMENT_MS), seg('c', 3300, SEGMENT_MS)];
    const clips = build(close, ['a', 'c']);
    expect(clips.map((c) => c.id)).toEqual(['a', 'c']);
    // The gap between a and b is 50 ms, less than the margin: a ends where b starts, c starts where b ends.
    expect(spans(clips[0].samples)[1]).toEqual([at(3000) - MARGIN, at(3150)]);
    expect(spans(clips[1].samples)[1]).toEqual([at(3150) + segLen, at(3300) + segLen + MARGIN]);
  });

  it('starts the first segment right after the lead when its margin would reach into the lead', () => {
    const clips = build([seg('a', 1050, SEGMENT_MS)], ['a']);
    expect(spans(clips[0].samples)).toEqual([[0, at(1050) + at(SEGMENT_MS) + MARGIN]]);
  });

  it('stops at the end of the take', () => {
    const clips = build([seg('a', TAKE_MS - SEGMENT_MS, SEGMENT_MS)], ['a']);
    expect(spans(clips[0].samples)[1][1]).toBe(take.length);
  });

  it('gives no clip for a deleted segment and none when nothing is kept', () => {
    expect(build([seg('a', 3000, SEGMENT_MS), seg('b', 5000, SEGMENT_MS)], ['b']).map((c) => c.id)).toEqual(['b']);
    expect(build([seg('a', 3000, SEGMENT_MS)], [])).toEqual([]);
  });

  it('returns the bounds without copying samples', () => {
    const bounds = clipBounds({ totalSamples: take.length, sampleRate: RATE_HZ, segments: [seg('a', 3000, SEGMENT_MS)], keptIds: ['a'] });
    expect(bounds).toEqual([{ id: 'a', leadEnd: LEAD_END, start: at(3000) - MARGIN, end: at(3000) + at(SEGMENT_MS) + MARGIN }]);
  });

  it('gives the whole take as one clip for hum and background', () => {
    for (const [label, kind] of [[HUM_LABEL, 'hum'], [BACKGROUND, 'background']] as const) {
      const clips = buildClips({ label, kind, samples: take, sampleRate: RATE_HZ, segments: [], keptIds: [] });
      expect(clips).toHaveLength(1);
      expect(clips[0].id).toBe(`${label}/${WEB_TEACH_FILE_NAME}`);
      expect(Array.from(clips[0].samples)).toEqual(Array.from(take));
    }
  });
});

// Segments a take like the recorder does, then returns the clips that buildClips makes and how often each re-segments.
function segmentTake(samples: Float32Array): TakeSegment[] {
  const s = new Segmenter(RATE_HZ);
  return [...s.push(samples), ...s.flush()].map((x, i) => ({ id: `s${i}`, t: x.t, durationMs: x.durationMs }));
}

function resegmentCounts(samples: Float32Array, segments: TakeSegment[]): number[] {
  const clips = buildClips({ label: 'tap', kind: 'sound', samples, sampleRate: RATE_HZ, segments, keptIds: segments.map((s) => s.id) });
  return clips.map((c) => {
    const back = readWav(writeWav(c.samples, RATE_HZ));
    const s = new Segmenter(back.sampleRate);
    return [...s.push(back.samples), ...s.flush()].length;
  });
}

describe('each clip is one segment after writeWav and readWav (requirements 4.2, 4.4)', () => {
  it('holds for the ten impacts of the browser teaching file', () => {
    const totalMs = TEACH_LEAD_MS + TEACH_COPIES * SYNTH_FIXTURE_SOUNDS_SPACING_MS + SYNTH_FIXTURE_TAIL_MS;
    const hits: Hit[] = Array.from({ length: TEACH_COPIES }, (_, i) => ({ atMs: TEACH_LEAD_MS + i * SYNTH_FIXTURE_SOUNDS_SPACING_MS, cls: TEACH_CLASS, gainDb: TRAIN_GAIN_DB }));
    const samples = makeSignal({ sampleRate: RATE_HZ, totalMs, hits, seed: SEED, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS });
    const segments = segmentTake(samples);
    expect(segments).toHaveLength(TEACH_COPIES);
    expect(resegmentCounts(samples, segments)).toEqual(Array(TEACH_COPIES).fill(1));
  });

  it('holds for random gaps and classes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: SEED_MAX }),
        fc.array(fc.record({ gapExtraMs: fc.integer({ min: 0, max: GAP_EXTRA_MAX_MS }), cls: fc.constantFrom(...CLASSES) }), { minLength: HITS_MIN, maxLength: HITS_MAX }),
        (seed, steps) => {
          let atMs = LEAD_MS;
          const hits: Hit[] = steps.map((s) => {
            const hit = { atMs, cls: s.cls, gainDb: TRAIN_GAIN_DB };
            atMs += TRAIN_SPACING_MS + s.gapExtraMs;
            return hit;
          });
          const samples = makeSignal({ sampleRate: RATE_HZ, totalMs: atMs + SYNTH_FIXTURE_TAIL_MS, hits, seed, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS });
          const segments = segmentTake(samples);
          expect(segments).toHaveLength(hits.length);
          expect(resegmentCounts(samples, segments)).toEqual(Array(hits.length).fill(1));
        },
      ),
      { numRuns: PBT_RUNS },
    );
  }, Math.max(PBT_TIMEOUT_FLOOR_MS, PBT_RUNS * PBT_MS_PER_CASE));
});

function recordOnlyState() {
  const state = createWorkerState();
  const out = handleWorkerMessage(state, { type: 'init', sounds: null, sampleRate: RATE_HZ, patterns: {}, mode: '', recordOnly: true });
  expect(out).toEqual([]);
  return state;
}

function feed(state: ReturnType<typeof createWorkerState>, samples: Float32Array): WorkerToMain[] {
  const out: WorkerToMain[] = [];
  for (let from = 0; from < samples.length; from += CHUNK_SAMPLES) {
    out.push(...handleWorkerMessage(state, { type: 'chunk', samples: samples.slice(from, from + CHUNK_SAMPLES) }));
  }
  return out;
}

function impacts(count: number, seed = SEED): Float32Array {
  const hits: Hit[] = Array.from({ length: count }, (_, i) => ({ atMs: LEAD_MS + i * TRAIN_SPACING_MS, cls: 'low', gainDb: TRAIN_GAIN_DB }));
  return makeSignal({ sampleRate: RATE_HZ, totalMs: LEAD_MS + count * TRAIN_SPACING_MS + SYNTH_FIXTURE_TAIL_MS, hits, seed, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS });
}

describe('record-only init (requirement 4.1)', () => {
  it('builds no engine, drops chunks outside a recording and sends no engine message', () => {
    const state = recordOnlyState();
    expect(state.engine).toBeNull();
    expect(feed(state, impacts(3))).toEqual([]);
  });

  it('records without an engine and sends only record messages', () => {
    const state = recordOnlyState();
    expect(handleWorkerMessage(state, { type: 'record-start', label: 'tap', kind: 'sound' })).toEqual([]);
    const out = feed(state, impacts(3));
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((m) => m.type === 'record-progress' || m.type === 'record-segment' || m.type === 'record-limit')).toBe(true);
    expect(out.filter((m) => m.type === 'record-segment')).toHaveLength(3);
  });

  it('answers error to setMode, flush and replaceSounds', () => {
    const state = recordOnlyState();
    for (const msg of [{ type: 'setMode', name: 'x' }, { type: 'flush' }, { type: 'replaceSounds', sounds: { version: 1, examples: [] } }]) {
      const out = handleWorkerMessage(state, msg);
      expect(out.map((m) => m.type), msg.type).toEqual(['error']);
    }
  });

  it('leaves a normal init unchanged: a missing model is still an error', () => {
    const out = handleWorkerMessage(createWorkerState(), { type: 'init', sounds: null, sampleRate: RATE_HZ, patterns: {}, mode: '' });
    expect(out.map((m) => m.type)).toEqual(['error']);
  });
});

describe('record-stop with clips (requirement 4.2)', () => {
  it('answers record-clips with one clip per kept segment and no training', () => {
    const state = recordOnlyState();
    handleWorkerMessage(state, { type: 'record-start', label: 'tap', kind: 'sound' });
    const heard = feed(state, impacts(8));
    const ids = heard.flatMap((m) => (m.type === 'record-segment' ? [m.id] : []));
    expect(ids).toHaveLength(8);
    const deleted = [ids[2]];
    const out = handleWorkerMessage(state, { type: 'record-stop', deleted, clips: true });
    expect(out.some((m) => m.type === 'record-trained' || m.type === 'record-failed')).toBe(false);
    const clipsMsg = out.find((m) => m.type === 'record-clips');
    expect(clipsMsg).toBeDefined();
    if (clipsMsg?.type !== 'record-clips') throw new Error('unreachable');
    expect(clipsMsg.label).toBe('tap');
    expect(clipsMsg.sampleRate).toBe(RATE_HZ);
    expect(clipsMsg.clips.map((c) => c.id)).toEqual(ids.filter((id) => id !== deleted[0]));
    expect(clipsMsg.clips.every((c) => c.samples.length > LEAD_END)).toBe(true);
    expect(transferListOf(clipsMsg)).toHaveLength(clipsMsg.clips.length);
  });

  it('gives one whole-take clip for hum and background', () => {
    for (const [label, take] of [
      [HUM_LABEL, Float32Array.from({ length: at(HUM_TAKE_MS) }, (_, i) => HUM_AMPLITUDE * Math.sin((TWO_PI * HUM_HZ * i) / RATE_HZ))],
      [BACKGROUND, Float32Array.from({ length: at(BACKGROUND_TAKE_MS) }, (_, i) => 0.001 * Math.sin(i))],
    ] as const) {
      const state = recordOnlyState();
      handleWorkerMessage(state, { type: 'record-start', label, kind: 'sound' });
      feed(state, take);
      const out = handleWorkerMessage(state, { type: 'record-stop', deleted: [], clips: true });
      const msg = out.find((m) => m.type === 'record-clips');
      if (msg?.type !== 'record-clips') throw new Error('no record-clips');
      expect(msg.clips).toHaveLength(1);
      expect(msg.clips[0].samples.length).toBe(take.length);
      expect(out.some((m) => m.type === 'record-trained')).toBe(false);
    }
  });

  it('still answers an error for record-stop without a recording', () => {
    expect(handleWorkerMessage(recordOnlyState(), { type: 'record-stop', deleted: [], clips: true }).map((m) => m.type)).toEqual(['error']);
  });
});

function labelRecording(label: string, cls: ImpactName, seed: number): Recording {
  const hits: Hit[] = Array.from({ length: TRAIN_PER_CLASS }, (_, i) => ({ atMs: LEAD_MS + i * TRAIN_SPACING_MS, cls, gainDb: TRAIN_GAIN_DB }));
  const samples = makeSignal({ sampleRate: RATE_HZ, totalMs: LEAD_MS + TRAIN_PER_CLASS * TRAIN_SPACING_MS + SYNTH_FIXTURE_TAIL_MS, hits, seed, noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS });
  return { label, file: `${label}-01.wav`, samples, sampleRate: RATE_HZ };
}

describe('teach-recordings (requirements 2.4, 4.2)', () => {
  it('answers teach-result equal to teachFromRecordings, also before init', () => {
    const recordings = [labelRecording('low', 'low', SEED), labelRecording('mid', 'mid', SEED + 1)];
    const out = handleWorkerMessage(createWorkerState(), { type: 'teach-recordings', requestId: 7, recordings, emptyFolders: [] });
    expect(out.map((m) => m.type)).toEqual(['teach-result']);
    const direct = teachFromRecordings(recordings, { emptyFolders: [] });
    expect(out[0]).toEqual({ type: 'teach-result', requestId: 7, model: direct.model, report: direct.report });
    expect(direct.model.examples.length).toBeGreaterThan(0);
  });

  it('answers teach-failed with the counts when a label has too few examples', () => {
    const quiet: Recording = { label: 'tap', file: 'tap-01.wav', samples: new Float32Array(at(TOO_FEW_RECORDING_MS)), sampleRate: RATE_HZ };
    const out = handleWorkerMessage(createWorkerState(), { type: 'teach-recordings', requestId: 3, recordings: [quiet], emptyFolders: ['empty'] });
    expect(out).toHaveLength(1);
    const msg = out[0];
    if (msg.type !== 'teach-failed') throw new Error(`got ${msg.type}`);
    expect(msg.requestId).toBe(3);
    expect(msg.counts).toEqual({ empty: 0, tap: 0 });
    expect(msg.message).toContain(String(MIN_EXAMPLES_PER_LABEL));
  });
});
