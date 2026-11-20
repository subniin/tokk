// The scan history (requirement 4.6, 5.1): each move of the highlight is recorded with the page time in ms, and a lookup
// by page time returns the target that was highlighted then. Pure: the times are arguments, the target type is generic.

export class ScanHistory<T> {
  private moves: { timeMs: number; target: T }[] = [];

  constructor(private readonly keepMs: number) {
    if (!(Number.isFinite(keepMs) && keepMs > 0)) throw new RangeError(`keepMs must be a positive finite number, got ${keepMs}.`);
  }

  get size(): number { return this.moves.length; }

  // A move earlier than the previous one throws and changes nothing. Moves older than keepMs before the newest are dropped,
  // except the newest move at or before the start of the window, so that a time inside the window still finds its target.
  record(timeMs: number, target: T): void {
    if (!Number.isFinite(timeMs)) throw new RangeError(`timeMs must be a finite number, got ${timeMs}.`);
    const last = this.moves[this.moves.length - 1];
    if (last !== undefined && timeMs < last.timeMs) {
      throw new RangeError(`A move at ${timeMs} ms is earlier than the previous move at ${last.timeMs} ms.`);
    }
    this.moves.push({ timeMs, target });
    const windowStartMs = timeMs - this.keepMs;
    let firstKept = 0;
    for (let i = 0; i < this.moves.length; i++) {
      if (this.moves[i].timeMs <= windowStartMs) firstKept = i;
      else break;
    }
    if (firstKept > 0) this.moves = this.moves.slice(firstKept);
  }

  // The target of the last move at or before timeMs, or null when there is none.
  lookup(timeMs: number): T | null {
    for (let i = this.moves.length - 1; i >= 0; i--) {
      if (this.moves[i].timeMs <= timeMs) return this.moves[i].target;
    }
    return null;
  }

  clear(): void { this.moves = []; }
}
