// The pattern sets of the two modes, as data, and the rule for two sounds then silence. Pure.
import { BURST_GAP_MAX_MS, BURST_TOLERANCE_MS, MS_PER_SECOND } from './constants';
import type { BoardInput } from './board';

export type Mode = 'two' | 'one';

// Pattern -> input. The wiring maps each pattern to its input; a one-sound `tick` comes from a timer every scanMs.
export const PATTERNS: Readonly<Record<Mode, Readonly<Record<string, BoardInput['type']>>>> = {
  two: { click: 'next', pop: 'choose', 'pop pop pop': 'help' },
  one: { click: 'choose', 'click click click': 'help' },
};

// The pattern set of a mode, for listen({ modes }) and for expectEvents({ patterns }).
export function patternsFor(mode: Mode): string[] {
  return Object.keys(PATTERNS[mode]);
}

export function inputForPattern(mode: Mode, pattern: string): BoardInput | null {
  const table = PATTERNS[mode];
  if (!Object.prototype.hasOwnProperty.call(table, pattern)) return null;
  return { type: table[pattern] } as BoardInput;
}

// Two pops then silence. The grammar holds a first pop back because `pop pop pop` could follow. When only two come, no
// pattern is exactly two pops, so the grammar fires nothing and both pops are lost. Run B calls settleBurst with the
// times (s) of the pops of the current burst and "now" (s), and sends one `choose` when it says 'choose'. The same rule
// serves `click` in one-sound mode. Times are t = samples / sample rate, as the events give them.
//   'wait'   the last sound is less than BURST_GAP_MAX_MS ago: a third could still come
//   'choose' the burst is exactly two sounds and the gap has passed: one choose
//   'none'   nothing to add (no sound, one sound which the grammar handles, three or more sounds)
export type Settled = 'wait' | 'choose' | 'none';

export function settleBurst(timesS: readonly number[], nowS: number): Settled {
  if (timesS.length === 0) return 'none';
  let size = 1;
  for (let i = timesS.length - 1; i > 0; i--) {
    const gapMs = (timesS[i] - timesS[i - 1]) * MS_PER_SECOND;
    if (gapMs < BURST_GAP_MAX_MS - BURST_TOLERANCE_MS) size++;
    else break;
  }
  const sinceLastMs = (nowS - timesS[timesS.length - 1]) * MS_PER_SECOND;
  if (sinceLastMs < BURST_GAP_MAX_MS - BURST_TOLERANCE_MS) return 'wait';
  return size === 2 ? 'choose' : 'none';
}
