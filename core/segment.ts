// Chunk-invariant onset segmenter. Measures a 10 ms level every 5 ms, tracks a noise floor and
// opens a segment on a sudden rise. Pure TypeScript: no I/O, DOM, Web Audio, clock or randomness.

import {
  SEGMENT_HOP_MS,
  LEVEL_WINDOW_MS,
  SILENCE_LEVEL_DBFS,
  NOISE_FLOOR_INITIAL_DBFS,
  NOISE_FLOOR_MIN_DBFS,
  NOISE_FLOOR_RISE_TIME_CONSTANT_MS,
  NOISE_FLOOR_WARMUP_MS,
  NOISE_FLOOR_WARMUP_RISE_MS,
  ONSET_ABOVE_FLOOR_DB,
  ONSET_MIN_LEVEL_DBFS,
  ONSET_RISE_DB,
  ONSET_MIN_GAP_MS,
  ONSET_LEAD_MS,
  REONSET_MIN_SEGMENT_AGE_MS,
  REONSET_RISE_DB,
  REONSET_CONFIRM_MS,
  REONSET_CONFIRM_BEFORE_MS,
  REONSET_CONFIRM_DB,
  OFFSET_ABOVE_FLOOR_DB,
  OFFSET_HOLD_MS,
  SEGMENT_MAX_MS,
} from './constants';
import type { Segment } from './types';

const MS_PER_SECOND = 1000;
const DB_POWER_DIVISOR = 10;

// Whole sample count for a duration. All decisions compare these integers.
function msToSamples(ms: number, sampleRate: number): number {
  return Math.round((ms * sampleRate) / MS_PER_SECOND);
}

interface OpenSegment {
  start: number;      // absolute sample index
  onsetHop: number;   // hop index that opened the segment
  belowCount: number; // consecutive hops below the offset line
}

// A re-onset candidate that waits for its confirmation window to arrive.
interface Candidate {
  hop: number;        // candidate hop index
  levels: number[];   // levels of the hops from the candidate hop up to the latest analyzed hop
}

export class Segmenter {
  private readonly sampleRate: number;
  private readonly hop: number;
  private readonly window: number;
  private readonly lead: number;
  private readonly gap: number;
  private readonly age: number;
  private readonly hold: number;
  private readonly maxLen: number;
  private readonly alpha: number;
  private readonly alphaWarmup: number;
  private readonly warmupEnd: number;     // absolute sample index where the calibration period ends
  private readonly confirmPost: number;   // samples after the candidate that are compared
  private readonly confirmPre: number;    // samples before the candidate that are compared
  private readonly confirmRatio: number;  // REONSET_CONFIRM_DB as a power ratio

  private floor = NOISE_FLOOR_INITIAL_DBFS;
  private prevLevel = SILENCE_LEVEL_DBFS;
  private lastOnsetHop: number | null = null;
  private lastEnd = 0;
  private open: OpenSegment | null = null;
  private pending: Candidate | null = null;   // cleared whenever the open segment closes

  // Input buffer. buf[i] holds absolute sample bufBase + i. Samples before the retained
  // region are dropped when the buffer is compacted.
  private buf: Float32Array;
  private bufBase = 0;
  private used = 0;
  private total = 0;     // absolute count of samples pushed
  private nextHop = 0;   // next hop to analyze

  constructor(sampleRate: number) {
    if (!(Number.isFinite(sampleRate) && sampleRate > 0)) {
      throw new RangeError(`sampleRate must be a positive finite number, got ${sampleRate}.`);
    }
    const hop = msToSamples(SEGMENT_HOP_MS, sampleRate);
    if (hop < 1) {
      throw new RangeError(`sampleRate ${sampleRate} is too low: the ${SEGMENT_HOP_MS} ms hop would be 0 samples.`);
    }
    this.sampleRate = sampleRate;
    this.hop = hop;
    this.window = msToSamples(LEVEL_WINDOW_MS, sampleRate);
    this.lead = msToSamples(ONSET_LEAD_MS, sampleRate);
    this.gap = msToSamples(ONSET_MIN_GAP_MS, sampleRate);
    this.age = msToSamples(REONSET_MIN_SEGMENT_AGE_MS, sampleRate);
    this.hold = msToSamples(OFFSET_HOLD_MS, sampleRate);
    this.maxLen = msToSamples(SEGMENT_MAX_MS, sampleRate);
    // The coefficients use the real hop length, so the rise per second is the same at every rate.
    const hopSeconds = hop / sampleRate;
    this.alpha = 1 - Math.exp(-hopSeconds / (NOISE_FLOOR_RISE_TIME_CONSTANT_MS / MS_PER_SECOND));
    this.alphaWarmup = 1 - Math.exp(-hopSeconds / (NOISE_FLOOR_WARMUP_RISE_MS / MS_PER_SECOND));
    this.warmupEnd = msToSamples(NOISE_FLOOR_WARMUP_MS, sampleRate);
    this.confirmPost = msToSamples(REONSET_CONFIRM_MS, sampleRate);
    this.confirmPre = msToSamples(REONSET_CONFIRM_BEFORE_MS, sampleRate);
    this.confirmRatio = Math.pow(10, REONSET_CONFIRM_DB / DB_POWER_DIVISOR);
    this.buf = new Float32Array(2 * (this.maxLen + this.window + this.lead + this.hop));
  }

  push(chunk: Float32Array): Segment[] {
    if (chunk.length === 0) return [];
    this.append(chunk);
    const out: Segment[] = [];
    while ((this.nextHop + 1) * this.hop <= this.total) {
      this.analyzeHop(this.nextHop, out);
      this.nextHop++;
    }
    return out;
  }

  // Closes an open segment at the last pushed sample. An undecided re-onset candidate is dropped.
  flush(): Segment[] {
    if (this.open === null) return [];
    const start = this.open.start;
    const end = Math.min(this.total, start + this.maxLen);
    this.open = null;
    this.pending = null;
    this.lastEnd = end;
    return [this.emit(start, end)];
  }

  noiseFloorDb(): number {
    return this.floor;
  }

  openSegmentStart(): number | null {
    return this.open === null ? null : this.open.start / this.sampleRate;
  }

  // Copies the chunk into the buffer. Never keeps a reference to the caller's array.
  private append(chunk: Float32Array): void {
    const needed = this.used + chunk.length;
    if (needed > this.buf.length) {
      this.compact();
      const needed2 = this.used + chunk.length;
      if (needed2 > this.buf.length) {
        const grown = new Float32Array(Math.max(needed2, 2 * this.buf.length));
        grown.set(this.buf.subarray(0, this.used));
        this.buf = grown;
      }
    }
    this.buf.set(chunk, this.used);
    this.used += chunk.length;
    this.total += chunk.length;
  }

  // Drops samples that no future hop or open segment can still need. A re-onset candidate lies at
  // least REONSET_MIN_SEGMENT_AGE_MS after the segment start, so its "before" window is inside the segment.
  private compact(): void {
    const hopStart = this.nextHop * this.hop;
    const keep = [
      hopStart - this.lead,
      (this.nextHop + 1) * this.hop - this.window,
    ];
    if (this.open !== null) keep.push(this.open.start);
    const keepFrom = Math.max(0, Math.min(...keep));
    const drop = keepFrom - this.bufBase;
    if (drop > 0) {
      this.buf.copyWithin(0, drop, this.used);
      this.used -= drop;
      this.bufBase = keepFrom;
    }
  }

  private levelAt(end: number): number {
    const from = Math.max(0, end - this.window);
    let sum = 0;
    for (let i = from - this.bufBase; i < end - this.bufBase; i++) {
      const v = this.buf[i];
      sum += v * v;
    }
    const count = end - from;
    if (sum === 0) return SILENCE_LEVEL_DBFS;
    const db = DB_POWER_DIVISOR * Math.log10(sum / count);
    return Math.max(SILENCE_LEVEL_DBFS, db);
  }

  // Mean of squares over the absolute sample range [from, to).
  private meanEnergy(from: number, to: number): number {
    let sum = 0;
    for (let i = from - this.bufBase; i < to - this.bufBase; i++) {
      const v = this.buf[i];
      sum += v * v;
    }
    return sum / (to - from);
  }

  private analyzeHop(h: number, out: Segment[]): void {
    const hopEnd = (h + 1) * this.hop;
    const level = this.levelAt(hopEnd);

    if (this.open === null) {
      if (hopEnd > this.warmupEnd && this.isOnset(h, level)) {
        const start = Math.max(h * this.hop - this.lead, this.lastEnd);
        this.open = { start, onsetHop: h, belowCount: 0 };
        this.lastOnsetHop = h;
      } else {
        this.updateFloor(level, hopEnd);
      }
    } else {
      const seg = this.open;
      // The old segment follows its own end rules until a re-onset is confirmed.
      if (hopEnd - seg.start >= this.maxLen) {
        const end = seg.start + this.maxLen;
        out.push(this.emit(seg.start, end));
        this.lastEnd = end;
        this.open = null;
        this.pending = null;
      } else {
        if (level < this.floor + OFFSET_ABOVE_FLOOR_DB) {
          seg.belowCount++;
        } else {
          seg.belowCount = 0;
        }
        if (seg.belowCount * this.hop >= this.hold) {
          out.push(this.emit(seg.start, hopEnd));
          this.lastEnd = hopEnd;
          this.open = null;
          this.pending = null;
        }
      }
      if (this.open !== null) this.stepReonset(h, hopEnd, level, out);
    }
    this.prevLevel = level;
  }

  // Two-stage re-onset. Stage 1 marks a candidate hop: a one-hop rise of REONSET_RISE_DB in a segment
  // that is old enough. Stage 2 runs once the confirmation window after the candidate has arrived. It
  // accepts the candidate only if the mean energy after it exceeds the mean energy just before it by
  // REONSET_CONFIRM_DB, because a real hit adds energy that persists and a fluctuation of a decaying
  // narrowband tail does not. Only buffered hops are used, so chunk boundaries do not matter.
  private stepReonset(h: number, hopEnd: number, level: number, out: Segment[]): void {
    const seg = this.open as OpenSegment;
    const p = this.pending;
    if (p === null) {
      if ((h - seg.onsetHop) * this.hop >= this.age && level - this.prevLevel >= REONSET_RISE_DB) {
        this.pending = { hop: h, levels: [level] };
      }
      return;
    }
    p.levels.push(level);
    const c = p.hop * this.hop;
    if (hopEnd < c + this.confirmPost) return;
    this.pending = null;

    const post = this.meanEnergy(c, c + this.confirmPost);
    const pre = this.meanEnergy(c - this.confirmPre, c);
    if (!(post > 0 && post >= pre * this.confirmRatio)) return;

    // Confirmed. Cut ONSET_LEAD_MS before the candidate hop and continue as a new segment.
    const newStart = c - this.lead;
    out.push(this.emit(seg.start, newStart));
    let below = 0;
    for (let i = p.levels.length - 1; i >= 0 && p.levels[i] < this.floor + OFFSET_ABOVE_FLOOR_DB; i--) below++;
    this.open = { start: newStart, onsetHop: p.hop, belowCount: below };
    this.lastOnsetHop = p.hop;
    this.lastEnd = newStart;
  }

  private isOnset(h: number, level: number): boolean {
    const gapOk = this.lastOnsetHop === null || (h - this.lastOnsetHop) * this.hop >= this.gap;
    return (
      level > this.floor + ONSET_ABOVE_FLOOR_DB &&
      level >= ONSET_MIN_LEVEL_DBFS &&
      level - this.prevLevel >= ONSET_RISE_DB &&
      gapOk
    );
  }

  private updateFloor(level: number, hopEnd: number): void {
    if (level < this.floor) {
      this.floor = Math.max(level, NOISE_FLOOR_MIN_DBFS);
    } else if (level > this.floor) {
      const alpha = hopEnd <= this.warmupEnd ? this.alphaWarmup : this.alpha;
      this.floor += alpha * (level - this.floor);
    }
  }

  private emit(start: number, end: number): Segment {
    const count = end - start;
    const samples = this.buf.slice(start - this.bufBase, end - this.bufBase);
    return {
      t: start / this.sampleRate,
      durationMs: (count / this.sampleRate) * MS_PER_SECOND,
      samples,
      sampleRate: this.sampleRate,
    };
  }
}
