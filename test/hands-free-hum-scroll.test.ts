// Task 22, U3: hum speed to a scroll step in px, and the scroll stops at the end of a hum (requirement 5.4).
import { test, fc } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import { createHumScroll } from '../apps/hands-free/src/hum-scroll';
import { HUM_SCROLL_PX_PER_S_PER_SPEED, HUM_UPDATE_DT_MAX_MS, HUM_FIRST_UPDATE_DT_MS, MS_PER_SECOND } from '../apps/hands-free/src/constants';

// Test-only values.
const OPTIONS = { pxPerSPerSpeed: 100, dtMaxMs: 100, firstDtMs: 20 };
const UPDATE_MS = 10;
const SPEED_MAX = 6;   // HUM_SPEED_MAX_SEMITONES of the library

describe('hum scroll (U3)', () => {
  it('uses the constants of the app by default', () => {
    const s = createHumScroll();
    const first = s.update({ t: 5, speed: 1, direction: 'down' });
    expect(first).toBeCloseTo((HUM_SCROLL_PX_PER_S_PER_SPEED * HUM_FIRST_UPDATE_DT_MS) / MS_PER_SECOND, 9);
    const second = s.update({ t: 5 + 50 / MS_PER_SECOND, speed: 1, direction: 'down' });
    expect(second).toBeCloseTo((HUM_SCROLL_PX_PER_S_PER_SPEED * 50) / MS_PER_SECOND, 9);
    expect(HUM_UPDATE_DT_MAX_MS).toBeGreaterThanOrEqual(50);
  });

  it('the first update of a hum uses the fixed first dt', () => {
    const s = createHumScroll(OPTIONS);
    expect(s.update({ t: 12.5, speed: 2, direction: 'down' })).toBeCloseTo(100 * 2 * (20 / 1000), 9);
  });

  it('the step is signed by the direction: up is negative, down is positive', () => {
    const up = createHumScroll(OPTIONS);
    const down = createHumScroll(OPTIONS);
    expect(up.update({ t: 1, speed: 3, direction: 'up' })).toBeLessThan(0);
    expect(down.update({ t: 1, speed: 3, direction: 'down' })).toBeGreaterThan(0);
  });

  it('the step is proportional to the sound time since the previous update', () => {
    const s = createHumScroll(OPTIONS);
    s.update({ t: 1, speed: 1, direction: 'down' });
    const a = s.update({ t: 1.02, speed: 1, direction: 'down' });
    const b = s.update({ t: 1.06, speed: 1, direction: 'down' });
    expect(a).toBeCloseTo(100 * 0.02, 9);
    expect(b).toBeCloseTo(100 * 0.04, 9);
  });

  it('dt is clamped to the longest step, and a gap above it counts as a new hum', () => {
    const s = createHumScroll(OPTIONS);
    s.update({ t: 1, speed: 1, direction: 'down' });
    // 100 ms is exactly the limit: it is used as it is.
    expect(s.update({ t: 1.1, speed: 1, direction: 'down' })).toBeCloseTo(100 * 0.1, 9);
    // 500 ms later is a gap: the fixed first dt, never 500 ms of scrolling.
    expect(s.update({ t: 1.6, speed: 1, direction: 'down' })).toBeCloseTo(100 * 0.02, 9);
  });

  it('a speed of 0 gives 0, and a bad speed throws', () => {
    const s = createHumScroll(OPTIONS);
    expect(s.update({ t: 1, speed: 0, direction: 'up' })).toBe(0);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => s.update({ t: 2, speed: bad, direction: 'up' })).toThrow(RangeError);
    }
  });

  it('end() makes the next update a first update', () => {
    const s = createHumScroll(OPTIONS);
    s.update({ t: 1, speed: 1, direction: 'down' });
    s.update({ t: 1.01, speed: 1, direction: 'down' });
    s.end();
    expect(s.update({ t: 1.02, speed: 1, direction: 'down' })).toBeCloseTo(100 * 0.02, 9);
  });

  it('the module has no timer: after end() nothing returns a step by itself', () => {
    const s = createHumScroll(OPTIONS);
    const total = [1, 1.01, 1.02].map((t) => s.update({ t, speed: 2, direction: 'down' })).reduce((a, b) => a + b, 0);
    s.end();
    // The only way to a step is a call of update. There is no other function on the object.
    expect(Object.keys(s).sort()).toEqual(['end', 'update']);
    expect(total).toBeGreaterThan(0);
  });

  test.prop([
    fc.double({ min: 0.1, max: SPEED_MAX, noNaN: true }),
    fc.integer({ min: 1, max: 100 }),
    fc.constantFrom('up' as const, 'down' as const),
  ])('doubling the speed doubles the step', (speed, dtMs, direction) => {
    const one = createHumScroll(OPTIONS);
    const two = createHumScroll(OPTIONS);
    one.update({ t: 3, speed, direction });
    two.update({ t: 3, speed: speed * 2, direction });
    const a = one.update({ t: 3 + dtMs / MS_PER_SECOND, speed, direction });
    const b = two.update({ t: 3 + dtMs / MS_PER_SECOND, speed: speed * 2, direction });
    expect(b).toBeCloseTo(a * 2, 6);
  });

  test.prop([fc.double({ min: 0, max: SPEED_MAX, noNaN: true }), fc.integer({ min: 1, max: 200 })])(
    'a step never exceeds the largest speed times the longest dt', (speed, dtMs) => {
      const s = createHumScroll(OPTIONS);
      s.update({ t: 0, speed, direction: 'down' });
      const step = s.update({ t: dtMs / MS_PER_SECOND, speed, direction: 'down' });
      expect(Math.abs(step)).toBeLessThanOrEqual((OPTIONS.pxPerSPerSpeed * SPEED_MAX * OPTIONS.dtMaxMs) / MS_PER_SECOND + 1e-9);
    });

  it('a steady stream of updates scrolls the speed times the rate', () => {
    const s = createHumScroll(OPTIONS);
    let total = 0;
    const n = 100;
    for (let i = 0; i < n; i++) total += s.update({ t: 1 + (i * UPDATE_MS) / MS_PER_SECOND, speed: 2, direction: 'down' });
    // The first update counts 20 ms, the next 99 count 10 ms each.
    expect(total).toBeCloseTo(100 * 2 * ((20 + 99 * UPDATE_MS) / MS_PER_SECOND), 6);
  });
});
