// The rolling window of the waveform and its marks, as a pure model. No DOM type, no Node module, no clock.
// Every time comes from the messages (a cumulative sample count divided by the sample rate), not from a timer.

import type { SegmentReport } from '../../core/engine';
import { WEB_ENVELOPE_RESOLUTION_MS, WEB_OVERLAY_REDRAW_REDUCED_MOTION_MS, WEB_OVERLAY_WINDOW_MS } from '../constants';
import { msToSamples } from '../protocol';

const MS_PER_SECOND = 1000;
const HALF = 0.5;

export type MarkKind = 'sound' | 'unknown' | 'background';

export interface ViewBin { x: number; min: number; max: number }        // x: start of the bin, 0 to 1
export interface ViewMark { x0: number; x1: number; kind: MarkKind; label: string }
export interface WaveformView {
  startS: number;       // start of the window
  endS: number;         // end of the newest bin
  binWidth: number;     // width of one bin as a fraction of the window
  bins: ViewBin[];
  marks: ViewMark[];
}

export interface WaveformModel {
  pushEnvelope(t0: number, min: Float32Array, max: Float32Array): void;
  pushSegment(report: SegmentReport): void;
  view(): WaveformView;
  readonly maxBins: number;
}

interface Mark { startS: number; endS: number; kind: MarkKind; label: string }

export function markOf(report: SegmentReport): { kind: MarkKind; label: string } {
  const r = report.result;
  if (r.kind === 'unknown') return { kind: 'unknown', label: 'unknown' };
  if (r.label === 'background') return { kind: 'background', label: 'background' };
  return { kind: 'sound', label: r.label };
}

export function createWaveformModel(o: { sampleRate: number }): WaveformModel {
  const binS = msToSamples(WEB_ENVELOPE_RESOLUTION_MS, o.sampleRate) / o.sampleRate;
  const windowS = WEB_OVERLAY_WINDOW_MS / MS_PER_SECOND;
  const maxBins = Math.round(WEB_OVERLAY_WINDOW_MS / WEB_ENVELOPE_RESOLUTION_MS);
  const tolS = binS * HALF;

  let starts: number[] = [];
  let mins: number[] = [];
  let maxs: number[] = [];
  let marks: Mark[] = [];
  let endS = 0;

  const trim = (): void => {
    const startS = endS - windowS - tolS;
    let drop = 0;
    while (drop < starts.length && starts[drop] < startS) drop++;
    if (drop > 0) {
      starts = starts.slice(drop);
      mins = mins.slice(drop);
      maxs = maxs.slice(drop);
    }
    const windowStart = endS - windowS;
    marks = marks.filter((m) => m.endS >= windowStart);
  };

  return {
    maxBins,
    pushEnvelope(t0, min, max) {
      // A t0 before the end of the data means the Worker restarted (a new init): start the window again.
      if (starts.length > 0 && t0 < endS - tolS) {
        starts = []; mins = []; maxs = []; marks = [];
      }
      for (let i = 0; i < min.length; i++) {
        starts.push(t0 + i * binS);
        mins.push(min[i]);
        maxs.push(max[i]);
      }
      if (min.length > 0) endS = t0 + min.length * binS;
      trim();
    },
    pushSegment(report) {
      const { kind, label } = markOf(report);
      const startS = report.t;
      const end = report.t + report.durationMs / MS_PER_SECOND;
      if (starts.length > 0 && end < endS - windowS) return;
      marks.push({ startS, endS: end, kind, label });
    },
    view() {
      const startS = endS - windowS;
      const bins = starts.map((s, i): ViewBin => ({ x: (s - startS) / windowS, min: mins[i], max: maxs[i] }));
      const out: ViewMark[] = [];
      for (const m of marks) {
        const x0 = Math.max(0, (m.startS - startS) / windowS);
        const x1 = Math.min(1, (m.endS - startS) / windowS);
        if (x1 < 0 || x0 > 1 || x1 < x0) continue;
        out.push({ x0, x1, kind: m.kind, label: m.label });
      }
      return { startS, endS, binWidth: binS / windowS, bins, marks: out };
    },
  };
}

export interface RedrawAction { action: 'none' | 'frame' | 'timer'; delayMs: number }

// Decides how the canvas is redrawn. Pure: the caller passes the times.
// Normal motion: one animation frame after a change. Reduced motion: a timer, at most once per
// WEB_OVERLAY_REDRAW_REDUCED_MOTION_MS, and never an animation frame.
export function nextRedraw(o: { reducedMotion: boolean; dirty: boolean; nowMs: number; lastDrawMs: number | null }): RedrawAction {
  if (!o.dirty) return { action: 'none', delayMs: 0 };
  if (!o.reducedMotion) return { action: 'frame', delayMs: 0 };
  const wait = o.lastDrawMs === null ? 0 : o.lastDrawMs + WEB_OVERLAY_REDRAW_REDUCED_MOTION_MS - o.nowMs;
  return { action: 'timer', delayMs: Math.max(0, wait) };
}
