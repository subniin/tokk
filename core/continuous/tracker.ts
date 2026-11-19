// Socket for the continuous (hum pitch) path. Task 6 supplies the real tracker.
// Pure TypeScript: no I/O, DOM, Web Audio, clock or randomness.

import type { SoundEvent } from '../types';

export type PitchEvent = Extract<SoundEvent, { kind: 'continuous' }>;

export interface ContinuousTracker {
  push(chunk: Float32Array): PitchEvent[];
  flush(): PitchEvent[];
  // Voiced ranges in seconds. `end` is null while a range is still open.
  voicedRanges(): { start: number; end: number | null }[];
}

export function noopTracker(): ContinuousTracker {
  return {
    push: () => [],
    flush: () => [],
    voicedRanges: () => [],
  };
}
