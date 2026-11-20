// Worker-side recorder of one teaching recording. It keeps the chunks in memory, runs a fresh Segmenter over them
// (its own NOISE_FLOOR_WARMUP_MS calibration) and reports numbers only: progress, segment times and small envelopes.
// Pure: no DOM type, no Node module, no clock, no randomness, no network. The samples never leave the Worker.

import { Segmenter } from '../core/segment';
import type { Segment } from '../core/types';
import { WEB_TEACH_FILE_NAME, WEB_TEACH_THUMBNAIL_BINS } from './constants';
import type { RecordKind } from './record-kind';

export type RecordOut =
  | { type: 'record-progress'; t: number }
  | { type: 'record-segment'; id: string; t: number; durationMs: number; min: Float32Array; max: Float32Array }
  | { type: 'record-limit' };

export interface Recorder {
  readonly label: string;
  readonly kind: RecordKind;
  push(chunk: Float32Array): RecordOut[];
  // Flushes the Segmenter and stops collecting. `samples` is the whole recording, `ids` the ids of all segments sent.
  finish(): { out: RecordOut[]; samples: Float32Array; ids: string[]; segments: { id: string; t: number; durationMs: number }[] };
}

// Min and max of `bins` near equal slices of the samples (fewer when there are fewer samples). Raw, not normalised.
export function thumbnailOf(samples: Float32Array, bins: number): { min: Float32Array; max: Float32Array } {
  const n = Math.min(bins, samples.length);
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * samples.length) / n);
    const to = Math.floor(((i + 1) * samples.length) / n);
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = from; k < to; k++) {
      if (samples[k] < lo) lo = samples[k];
      if (samples[k] > hi) hi = samples[k];
    }
    min[i] = lo;
    max[i] = hi;
  }
  return { min, max };
}

export function createRecorder(o: { label: string; kind: RecordKind; sampleRate: number; maxSamples: number }): Recorder {
  const chunks: Float32Array[] = [];
  const ids: string[] = [];
  const found: { id: string; t: number; durationMs: number }[] = [];   // every segment sent, for the clips of Task 17
  const segmenter = o.kind === 'sound' ? new Segmenter(o.sampleRate) : null;
  let count = 0;            // samples collected so far
  let limitSent = false;
  let finished = false;

  const segmentMessages = (segments: Segment[]): RecordOut[] => segments.map((seg) => {
    const id = `${o.label}/${WEB_TEACH_FILE_NAME}#${ids.length}`;
    ids.push(id);
    found.push({ id, t: seg.t, durationMs: seg.durationMs });
    const { min, max } = thumbnailOf(seg.samples, WEB_TEACH_THUMBNAIL_BINS);
    return { type: 'record-segment', id, t: seg.t, durationMs: seg.durationMs, min, max };
  });

  return {
    label: o.label,
    kind: o.kind,
    push(chunk) {
      if (finished || limitSent || chunk.length === 0) return [];
      const room = o.maxSamples - count;
      const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
      chunks.push(part);
      count += part.length;
      const out: RecordOut[] = [];
      if (segmenter !== null) out.push(...segmentMessages(segmenter.push(part)));
      out.push({ type: 'record-progress', t: count / o.sampleRate });
      if (count >= o.maxSamples) {
        limitSent = true;
        out.push({ type: 'record-limit' });
      }
      return out;
    },
    finish() {
      const out = finished || segmenter === null ? [] : segmentMessages(segmenter.flush());
      finished = true;
      const samples = new Float32Array(count);
      let at = 0;
      for (const c of chunks) {
        samples.set(c, at);
        at += c.length;
      }
      chunks.length = 0;
      return { out, samples, ids: [...ids], segments: found.map((s) => ({ ...s })) };
    },
  };
}
