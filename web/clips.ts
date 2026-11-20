// Clip bounds and clip building for the teach page: one wav file per kept segment, each with the take's quiet lead.
// Pure: no DOM type, no Node module, no network. A fresh Segmenter throws away the first NOISE_FLOOR_WARMUP_MS of a
// file, so every clip starts with the take's own quiet second (the part the dialog asked for) and then holds its
// segment with a margin, never reaching into a neighbouring segment (kept or deleted).

import { NOISE_FLOOR_WARMUP_MS } from '../core/constants';
import { WEB_TEACH_FILE_NAME, WEB_TEACH_PAGE_CLIP_MARGIN_MS } from './constants';
import { msToSamples } from './protocol';
import type { RecordKind } from './record-kind';

export interface TakeSegment { id: string; t: number; durationMs: number }   // t in s, from a sample count
export interface Clip { id: string; samples: Float32Array }
export interface ClipBounds { id: string; leadEnd: number; start: number; end: number }   // sample positions in the take: [0, leadEnd) + [start, end)

// The bounds of one clip per kept segment, in the order of `segments`. `segments` holds all segments of the take.
export function clipBounds(o: { totalSamples: number; sampleRate: number; segments: TakeSegment[]; keptIds: string[] }): ClipBounds[] {
  const kept = new Set(o.keptIds);
  const margin = msToSamples(WEB_TEACH_PAGE_CLIP_MARGIN_MS, o.sampleRate);
  const lead = Math.min(o.totalSamples, msToSamples(NOISE_FLOOR_WARMUP_MS, o.sampleRate));
  const starts = o.segments.map((s) => Math.round(s.t * o.sampleRate));
  const ends = o.segments.map((s, i) => starts[i] + msToSamples(s.durationMs, o.sampleRate));
  const bounds: ClipBounds[] = [];
  o.segments.forEach((s, i) => {
    if (!kept.has(s.id)) return;
    const previousEnd = i > 0 ? ends[i - 1] : 0;
    const nextStart = i + 1 < starts.length ? starts[i + 1] : o.totalSamples;
    const start = Math.min(o.totalSamples, Math.max(lead, previousEnd, starts[i] - margin));
    const end = Math.min(o.totalSamples, Math.max(start, Math.min(nextStart, ends[i] + margin)));
    bounds.push({ id: s.id, leadEnd: lead, start, end });
  });
  return bounds;
}

export function buildClips(o: {
  label: string; kind: RecordKind; samples: Float32Array; sampleRate: number; segments: TakeSegment[]; keptIds: string[];
}): Clip[] {
  if (o.kind !== 'sound') return [{ id: `${o.label}/${WEB_TEACH_FILE_NAME}`, samples: o.samples.slice() }];
  return clipBounds({ totalSamples: o.samples.length, sampleRate: o.sampleRate, segments: o.segments, keptIds: o.keptIds }).map((b) => {
    const out = new Float32Array(b.leadEnd + (b.end - b.start));
    out.set(o.samples.subarray(0, b.leadEnd), 0);
    out.set(o.samples.subarray(b.start, b.end), b.leadEnd);
    return { id: b.id, samples: out };
  });
}
