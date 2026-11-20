// Task 22, U1: the scan history returns the element that was highlighted at a given page time (requirement 5.1).
import { test, fc } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import { ScanHistory } from '../apps/hands-free/src/history';

// Test-only values.
const KEEP_MS = 1000;
const STEP_MS = 300;

function filled(): ScanHistory<string> {
  const h = new ScanHistory<string>(KEEP_MS);
  h.record(100, 'a');
  h.record(400, 'b');
  h.record(700, 'c');
  return h;
}

describe('scan history (U1)', () => {
  it('returns the target of the last move at or before the time', () => {
    const h = filled();
    expect(h.lookup(100)).toBe('a');
    expect(h.lookup(399)).toBe('a');
    expect(h.lookup(550)).toBe('b');
    expect(h.lookup(699.5)).toBe('b');
  });

  it('a time equal to a move gives that move', () => {
    const h = filled();
    expect(h.lookup(400)).toBe('b');
    expect(h.lookup(700)).toBe('c');
  });

  it('a time before the first move gives none', () => {
    expect(filled().lookup(99.9)).toBeNull();
    expect(new ScanHistory<string>(KEEP_MS).lookup(0)).toBeNull();
  });

  it('a time after the last move gives the last move', () => {
    expect(filled().lookup(50_000)).toBe('c');
  });

  it('clear forgets everything', () => {
    const h = filled();
    h.clear();
    expect(h.size).toBe(0);
    expect(h.lookup(500)).toBeNull();
    h.record(10, 'z');
    expect(h.lookup(500)).toBe('z');
  });

  it('a move recorded before the previous one throws and changes nothing', () => {
    const h = filled();
    expect(() => h.record(699, 'late')).toThrow(RangeError);
    expect(h.size).toBe(3);
    expect(h.lookup(800)).toBe('c');
    expect(() => h.record(Number.NaN, 'x')).toThrow(RangeError);
    expect(() => h.record(Number.POSITIVE_INFINITY, 'x')).toThrow(RangeError);
  });

  it('a move at the same time as the previous one is kept, and the later one wins', () => {
    const h = filled();
    h.record(700, 'd');
    expect(h.lookup(700)).toBe('d');
  });

  it('pruning drops old moves but keeps the one that covers the oldest kept time', () => {
    const h = new ScanHistory<string>(KEEP_MS);
    for (let i = 0; i < 10; i++) h.record(i * 500, `m${i}`);   // the newest is at 4500; the window starts at 3500
    expect(h.size).toBeLessThan(10);
    expect(h.lookup(3500)).toBe('m7');     // m7 is at 3500
    expect(h.lookup(3700)).toBe('m7');
    expect(h.lookup(4500)).toBe('m9');
    expect(h.lookup(0)).toBeNull();        // before the first kept move
  });

  it('the covering move survives when the window start falls between two moves', () => {
    const h = new ScanHistory<string>(KEEP_MS);
    h.record(0, 'old');
    h.record(2000, 'new');                 // the window is 1000..2000, the move before it covers 1000..1999
    expect(h.lookup(1200)).toBe('old');
    expect(h.lookup(2000)).toBe('new');
  });

  test.prop(
    [
      fc.array(fc.integer({ min: 0, max: 2000 }), { minLength: 1, maxLength: 40 }),
      fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 30 }),
    ],
  )('matches a plain reference for every time inside the kept window', (gaps, probes) => {
    const h = new ScanHistory<number>(KEEP_MS);
    const all: { t: number; id: number }[] = [];
    let t = 0;
    gaps.forEach((g, id) => {
      t += g;
      all.push({ t, id });
      h.record(t, id);
    });
    const newest = all[all.length - 1].t;
    for (const p of probes) {
      const time = newest - KEEP_MS + (p % (KEEP_MS + STEP_MS * 3));   // inside the window and a little beyond the newest move
      const ref = [...all].reverse().find((m) => m.t <= time);
      const got = h.lookup(time);
      if (time >= newest - KEEP_MS) expect(got).toBe(ref === undefined ? null : ref.id);
      else if (got !== null) expect(got).toBe(ref?.id);   // older than the window: none or still the right move
    }
  });
});
