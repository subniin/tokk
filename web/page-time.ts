// Mapping from a sound time in seconds to a page time in ms (the clock of performance.now()), for ears.toPageTime.
// Pure: no DOM type, no clock, no network. The caller passes the page time of arrival of every envelope message.
//
// For each envelope message the delay value is the arrival time minus the sound time at the end of the message (in ms).
// The estimate of a stretch is the smallest delay value of the messages that arrived in the last windowMs: the message
// with the least queueing delay. A stretch is a span of listening between a resume() and the next pause(): while the
// microphone is paused the engine's clock stands still and the page's clock runs on, so each stretch has its own offset.
// A rebuild of the engine restarts the sound clock at 0: all stretches are dropped, and messages of the old engine that
// are still in flight are ignored until the first message whose t0 is 0 (the Worker restarts its envelope counters then).

import { WEB_TO_PAGE_TIME_WINDOW_MS } from './constants';

const MS_PER_SECOND = 1000;

export interface PageTime {
  envelope(arrivalMs: number, t0: number, endT: number): void;   // endT: the sound time in s at the end of the message
  pause(): void;
  resume(nowMs: number): void;                                    // nowMs: the page time of the resume() call
  rebuild(): void;
  toPageTime(t: number): number;
}

interface Delay { arrivalMs: number; delayMs: number }
interface Stretch {
  startT: number;              // sound time in s at which the stretch starts
  delays: Delay[];             // the messages of the last windowMs, in arrival order
  estimateMs: number;          // page time of sound time 0 on this stretch's offset
  provisional: boolean;        // set by resume(), replaced by the first message of the stretch
}

export function createPageTime(windowMs: number = WEB_TO_PAGE_TIME_WINDOW_MS): PageTime {
  let stretches: Stretch[] = [];
  let lastEndT = 0;             // sound time at the end of the last message of the current engine
  let waitForZero = false;      // after a rebuild: ignore messages until one with t0 0

  return {
    envelope(arrivalMs: number, t0: number, endT: number): void {
      if (waitForZero) {
        if (t0 !== 0) return;
        waitForZero = false;
      }
      const delayMs = arrivalMs - endT * MS_PER_SECOND;
      let s = stretches[stretches.length - 1];
      if (s === undefined) {
        s = { startT: t0, delays: [], estimateMs: delayMs, provisional: false };
        stretches.push(s);
      } else if (s.provisional) {
        s.delays = [];
        s.provisional = false;
      }
      s.delays.push({ arrivalMs, delayMs });
      s.delays = s.delays.filter((d) => d.arrivalMs >= arrivalMs - windowMs);
      s.estimateMs = Math.min(...s.delays.map((d) => d.delayMs));
      lastEndT = endT;
    },

    pause(): void {
      // Nothing to do: the stretch ends at lastEndT, and resume() starts the next one there.
    },

    resume(nowMs: number): void {
      stretches.push({ startT: lastEndT, delays: [], estimateMs: nowMs - lastEndT * MS_PER_SECOND, provisional: true });
    },

    rebuild(): void {
      stretches = [];
      lastEndT = 0;
      waitForZero = true;
    },

    toPageTime(t: number): number {
      if (!Number.isFinite(t)) throw new RangeError(`ears.toPageTime(t): t must be a finite number of seconds, got ${t}.`);
      if (stretches.length === 0) {
        throw new Error('ears.toPageTime(): no audio has arrived yet since listen() started or the engine was rebuilt, so there is no mapping. Call it from a handler.');
      }
      let s = stretches[0];
      for (let i = stretches.length - 1; i >= 0; i--) {
        if (stretches[i].startT <= t) { s = stretches[i]; break; }
      }
      return t * MS_PER_SECOND + s.estimateMs;
    },
  };
}
