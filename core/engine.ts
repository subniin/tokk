// Engine: Segmenter -> classifier -> SoundEvent -> Matcher (design 4.1).
// Pure TypeScript: no I/O, DOM, Web Audio, clock or randomness.

import { BACKGROUND, ENGINE_ADVANCE_MARGIN_MS, SAMPLE_RATE_MAX_HZ, SAMPLE_RATE_MIN_HZ } from './constants';
import { knnClassifier } from './classify/knn';
import { noopTracker, type ContinuousTracker } from './continuous/tracker';
import { Matcher } from './grammar';
import { Segmenter } from './segment';
import type { Classifier, MatchEvent, Nearest, Segment, SoundEvent, SoundModel } from './types';

const MS_PER_SECOND = 1000;

export type Handlers = Record<string, (m: MatchEvent) => void>;
export type EngineEvent = SoundEvent | { kind: 'unknown'; t: number; nearest: Nearest };

export interface EngineOptions {
  sounds: SoundModel;
  sampleRate: number;
  on?: Handlers;
  modes?: Record<string, Handlers>;
  mode?: string;
  onEvent?: (e: EngineEvent) => void;
  classifier?: Classifier;
}

export interface Engine {
  push(chunk: Float32Array): void;
  flush(): void;
  setMode(name: string): void;
}

export interface RunResult {
  events: SoundEvent[];
  matches: MatchEvent[];
  unknowns: number[];
}

// Task 6 replaces this function with the real pitch tracker.
function createTracker(_sampleRate: number): ContinuousTracker {
  return noopTracker();
}

function checkSampleRate(sampleRate: number): void {
  if (!(Number.isFinite(sampleRate) && sampleRate >= SAMPLE_RATE_MIN_HZ && sampleRate <= SAMPLE_RATE_MAX_HZ)) {
    throw new RangeError(
      `sampleRate must be between ${SAMPLE_RATE_MIN_HZ} and ${SAMPLE_RATE_MAX_HZ} Hz, got ${sampleRate}.`,
    );
  }
}

function modeList(modes: Record<string, Handlers>): string {
  return Object.keys(modes).join(', ');
}

function overlaps(seg: Segment, ranges: { start: number; end: number | null }[], now: number): boolean {
  const a = seg.t;
  const b = seg.t + seg.durationMs / MS_PER_SECOND;
  return ranges.some((r) => a <= (r.end ?? now) && r.start <= b);
}

export function createEngine(o: EngineOptions): Engine {
  checkSampleRate(o.sampleRate);
  if (o.on !== undefined && o.modes !== undefined) {
    throw new Error('Give either `on` or `modes`, not both.');
  }
  let modes: Record<string, Handlers>;
  let modeName: string;
  if (o.modes !== undefined) {
    modes = o.modes;
    if (o.mode === undefined) {
      throw new Error(`\`modes\` needs \`mode\`. Available modes: ${modeList(modes)}.`);
    }
    if (!Object.prototype.hasOwnProperty.call(modes, o.mode)) {
      throw new Error(`Unknown mode "${o.mode}". Available modes: ${modeList(modes)}.`);
    }
    modeName = o.mode;
  } else {
    modes = { default: o.on ?? {} };
    modeName = 'default';
  }

  const baselineHz = o.sounds.pitch?.baselineHz;
  for (const handlers of Object.values(modes)) new Matcher(Object.keys(handlers), baselineHz);

  const sampleRate = o.sampleRate;
  const classifier = o.classifier ?? knnClassifier;
  const onEvent = o.onEvent;
  const segmenter = new Segmenter(sampleRate);
  const tracker = createTracker(sampleRate);
  const matcher = new Matcher(Object.keys(modes[modeName]), baselineHz);
  let handlers = modes[modeName];
  let totalSamples = 0;

  const now = (): number => totalSamples / sampleRate;

  const dispatch = (matches: MatchEvent[]): void => {
    for (const m of matches) handlers[m.pattern]?.(m);
  };

  // Sends an event to the caller and the matcher. Returns the matches it produced.
  const feed = (e: SoundEvent): MatchEvent[] => {
    onEvent?.(e);
    return matcher.push(e);
  };

  const classify = (segments: Segment[]): MatchEvent[] => {
    const out: MatchEvent[] = [];
    const ranges = tracker.voicedRanges();
    for (const seg of segments) {
      if (overlaps(seg, ranges, now())) continue;
      const r = classifier.classify(o.sounds, seg);
      if (r.kind === 'unknown') {
        onEvent?.({ kind: 'unknown', t: seg.t, nearest: r.nearest });
        continue;
      }
      if (r.label === BACKGROUND) continue;
      out.push(...feed({ kind: 'sound', label: r.label, t: seg.t, durationMs: seg.durationMs, confidence: r.confidence }));
    }
    return out;
  };

  return {
    push(chunk: Float32Array): void {
      if (chunk.length === 0) return;
      totalSamples += chunk.length;
      const t = now();

      const pitch: MatchEvent[] = [];
      for (const e of tracker.push(chunk)) pitch.push(...feed(e));
      dispatch(pitch);

      dispatch(classify(segmenter.push(chunk)));

      const limit = t - ENGINE_ADVANCE_MARGIN_MS / MS_PER_SECOND;
      dispatch(matcher.advance(Math.min(limit, segmenter.openSegmentStart() ?? Infinity)));
    },

    flush(): void {
      const pitch: MatchEvent[] = [];
      for (const e of tracker.flush()) pitch.push(...feed(e));
      dispatch(pitch);

      dispatch(classify(segmenter.flush()));
      dispatch(matcher.advance(Infinity));
    },

    setMode(name: string): void {
      if (!Object.prototype.hasOwnProperty.call(modes, name)) {
        throw new Error(`Unknown mode "${name}". Available modes: ${modeList(modes)}.`);
      }
      matcher.setPatterns(Object.keys(modes[name]));
      handlers = modes[name];
      modeName = name;
    },
  };
}

export function runSamples(
  samples: Float32Array,
  sampleRate: number,
  sounds: SoundModel,
  patterns: string[] = [],
): RunResult {
  const events: SoundEvent[] = [];
  const matches: MatchEvent[] = [];
  const unknowns: number[] = [];
  const engine = createEngine({
    sounds,
    sampleRate,
    on: Object.fromEntries(patterns.map((p) => [p, (m: MatchEvent) => matches.push(m)])),
    onEvent: (e) => {
      if (e.kind === 'unknown') unknowns.push(e.t);
      else events.push(e);
    },
  });
  engine.push(samples);
  engine.flush();
  return { events, matches, unknowns };
}
