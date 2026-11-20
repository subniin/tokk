import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { SegmentReport } from '../core/engine';
import { WEB_ENVELOPE_RESOLUTION_MS, WEB_OVERLAY_REDRAW_REDUCED_MOTION_MS, WEB_OVERLAY_WINDOW_MS } from '../web/constants';
import { msToSamples } from '../web/protocol';
import { createWaveformModel, nextRedraw } from '../web/overlay/waveform';

// Test-only values.
const PBT_RUNS = Number(process.env.PBT_RUNS ?? '100');
const SAMPLE_RATE_HZ = 48000;
const MS_PER_SECOND = 1000;
const TOLERANCE_FRACTION = 1e-9;       // fractions of the window
const CHUNK_BINS_MAX = 60;
const GAP_BINS_MAX = 30;
const CHUNKS_MAX = 40;

const BIN_S = msToSamples(WEB_ENVELOPE_RESOLUTION_MS, SAMPLE_RATE_HZ) / SAMPLE_RATE_HZ;
const WINDOW_S = WEB_OVERLAY_WINDOW_MS / MS_PER_SECOND;
const MAX_BINS = WEB_OVERLAY_WINDOW_MS / WEB_ENVELOPE_RESOLUTION_MS;

function bins(n: number, base = 0): { min: Float32Array; max: Float32Array } {
  return {
    min: Float32Array.from({ length: n }, (_, i) => -((base + i) % 10) / 10),
    max: Float32Array.from({ length: n }, (_, i) => ((base + i) % 10) / 10),
  };
}

function report(t: number, durationMs: number, label = 'low'): SegmentReport {
  return { t, durationMs, result: { kind: 'match', label, confidence: 1, nearest: { id: `${label}/a.wav#0`, label, distance: 1 } } };
}

function fill(model: ReturnType<typeof createWaveformModel>, firstBin: number, count: number): void {
  const { min, max } = bins(count, firstBin);
  model.pushEnvelope((firstBin * msToSamples(WEB_ENVELOPE_RESOLUTION_MS, SAMPLE_RATE_HZ)) / SAMPLE_RATE_HZ, min, max);
}

describe('waveform model', () => {
  it('derives the maximum number of bins from the window and the bin length', () => {
    expect(createWaveformModel({ sampleRate: SAMPLE_RATE_HZ }).maxBins).toBe(MAX_BINS);
  });

  it('keeps only the last window of bins and ends the window at the end of the newest bin', () => {
    const m = createWaveformModel({ sampleRate: SAMPLE_RATE_HZ });
    fill(m, 0, MAX_BINS * 3);
    const v = m.view();
    expect(v.bins.length).toBe(MAX_BINS);
    expect(v.endS).toBeCloseTo(MAX_BINS * 3 * BIN_S, 9);
    expect(v.startS).toBeCloseTo(v.endS - WINDOW_S, 9);
    expect(v.bins[0].x).toBeCloseTo(0, 9);
    expect(v.bins[v.bins.length - 1].x).toBeCloseTo(1 - BIN_S / WINDOW_S, 9);
  });

  it('starts blank on the left while less than a window has arrived', () => {
    const m = createWaveformModel({ sampleRate: SAMPLE_RATE_HZ });
    fill(m, 0, 100);
    const v = m.view();
    expect(v.bins.length).toBe(100);
    expect(v.bins[0].x).toBeCloseTo(1 - (100 * BIN_S) / WINDOW_S, 9);
  });

  it('stays still when nothing arrives (a pause)', () => {
    const m = createWaveformModel({ sampleRate: SAMPLE_RATE_HZ });
    fill(m, 0, 200);
    expect(m.view()).toEqual(m.view());
    const before = m.view();
    m.pushSegment(report(0.5, 100));
    expect(m.view().startS).toBe(before.startS);
    expect(m.view().endS).toBe(before.endS);
  });

  it('keeps a gap blank instead of closing it up', () => {
    const m = createWaveformModel({ sampleRate: SAMPLE_RATE_HZ });
    fill(m, 0, 50);
    fill(m, 150, 50);   // 100 bins missing
    const v = m.view();
    expect(v.bins.length).toBe(100);
    const jump = v.bins[50].x - v.bins[49].x;
    expect(jump).toBeCloseTo((101 * BIN_S) / WINDOW_S, 9);
  });

  it('clears bins and marks when t0 goes back, then starts the window again', () => {
    const m = createWaveformModel({ sampleRate: SAMPLE_RATE_HZ });
    fill(m, 0, 200);
    m.pushSegment(report(0.5, 100));
    fill(m, 0, 10);
    const v = m.view();
    expect(v.bins.length).toBe(10);
    expect(v.marks).toEqual([]);
    expect(v.endS).toBeCloseTo(10 * BIN_S, 9);
  });

  it('clips a mark to the window and drops marks that left it', () => {
    const m = createWaveformModel({ sampleRate: SAMPLE_RATE_HZ });
    fill(m, 0, 300);          // 3 s, window starts at -2 s
    m.pushSegment(report(1, 500, 'low'));
    let v = m.view();
    expect(v.marks.length).toBe(1);
    expect(v.marks[0]).toMatchObject({ kind: 'sound', label: 'low' });
    expect(v.marks[0].x0).toBeCloseTo((1 - v.startS) / WINDOW_S, 9);
    expect(v.marks[0].x1).toBeCloseTo((1.5 - v.startS) / WINDOW_S, 9);

    fill(m, 300, 400);        // end at 7 s, window starts at 2 s: the mark [1, 1.5] is gone
    expect(m.view().marks).toEqual([]);

    m.pushSegment(report(1.8, 500, 'mid'));   // [1.8, 2.3] against a window start of 2 s: clipped at 0
    v = m.view();
    expect(v.marks.length).toBe(1);
    expect(v.marks[0].x0).toBe(0);
    expect(v.marks[0].x1).toBeCloseTo((2.3 - v.startS) / WINDOW_S, 9);

    m.pushSegment(report(0.1, 100));   // ends before the window start: dropped at once
    expect(m.view().marks.length).toBe(1);
  });

  it('marks unknown and background with their own kind and text', () => {
    const m = createWaveformModel({ sampleRate: SAMPLE_RATE_HZ });
    fill(m, 0, 300);
    m.pushSegment({ t: 1, durationMs: 100, result: { kind: 'unknown', nearest: { id: 'a/b#0', label: 'a', distance: 9 } } });
    m.pushSegment(report(2, 100, 'background'));
    const marks = m.view().marks;
    expect(marks.map((x) => [x.kind, x.label])).toEqual([['unknown', 'unknown'], ['background', 'background']]);
  });

  it('gives x fractions between 0 and 1 that increase with time', () => {
    const m = createWaveformModel({ sampleRate: SAMPLE_RATE_HZ });
    fill(m, 0, 777);
    m.pushSegment(report(4, 800));
    const v = m.view();
    for (let i = 0; i < v.bins.length; i++) {
      expect(v.bins[i].x).toBeGreaterThanOrEqual(-TOLERANCE_FRACTION);
      expect(v.bins[i].x).toBeLessThanOrEqual(1);
      if (i > 0) expect(v.bins[i].x).toBeGreaterThan(v.bins[i - 1].x);
    }
    for (const mark of v.marks) {
      expect(mark.x0).toBeGreaterThanOrEqual(0);
      expect(mark.x1).toBeLessThanOrEqual(1);
      expect(mark.x1).toBeGreaterThanOrEqual(mark.x0);
    }
  });

  it('gives the bins of a direct computation for random chunks and gaps (property)', () => {
    const chunkArb = fc.record({ gap: fc.integer({ min: 0, max: GAP_BINS_MAX }), n: fc.integer({ min: 1, max: CHUNK_BINS_MAX }) });
    fc.assert(fc.property(fc.array(chunkArb, { minLength: 1, maxLength: CHUNKS_MAX }), (chunks) => {
      const m = createWaveformModel({ sampleRate: SAMPLE_RATE_HZ });
      const all: { index: number; min: number; max: number }[] = [];
      let index = 0;
      for (const c of chunks) {
        index += c.gap;
        const { min, max } = bins(c.n, index);
        m.pushEnvelope(index * BIN_S, min, max);
        for (let i = 0; i < c.n; i++) all.push({ index: index + i, min: min[i], max: max[i] });
        index += c.n;
      }
      const end = index * BIN_S;
      const start = end - WINDOW_S;
      const expected = all.filter((b) => b.index * BIN_S >= start - BIN_S / 2);
      const v = m.view();
      expect(v.bins.length).toBeLessThanOrEqual(MAX_BINS);
      expect(v.bins.length).toBe(expected.length);
      v.bins.forEach((b, i) => {
        expect(b.min).toBe(expected[i].min);
        expect(b.max).toBe(expected[i].max);
        expect(Math.abs(b.x - (expected[i].index * BIN_S - start) / WINDOW_S)).toBeLessThan(1e-6);
      });
    }), { numRuns: PBT_RUNS });
  });
});

describe('nextRedraw', () => {
  it('does nothing when nothing changed', () => {
    expect(nextRedraw({ reducedMotion: false, dirty: false, nowMs: 5, lastDrawMs: 0 }).action).toBe('none');
    expect(nextRedraw({ reducedMotion: true, dirty: false, nowMs: 5, lastDrawMs: 0 }).action).toBe('none');
  });

  it('asks for an animation frame without reduced motion', () => {
    expect(nextRedraw({ reducedMotion: false, dirty: true, nowMs: 5, lastDrawMs: 4 })).toEqual({ action: 'frame', delayMs: 0 });
  });

  it('asks for a timer with reduced motion, at most once per WEB_OVERLAY_REDRAW_REDUCED_MOTION_MS', () => {
    const p = WEB_OVERLAY_REDRAW_REDUCED_MOTION_MS;
    expect(nextRedraw({ reducedMotion: true, dirty: true, nowMs: 0, lastDrawMs: null })).toEqual({ action: 'timer', delayMs: 0 });
    expect(nextRedraw({ reducedMotion: true, dirty: true, nowMs: 300, lastDrawMs: 0 })).toEqual({ action: 'timer', delayMs: p - 300 });
    expect(nextRedraw({ reducedMotion: true, dirty: true, nowMs: p + 50, lastDrawMs: 0 })).toEqual({ action: 'timer', delayMs: 0 });
  });
});
