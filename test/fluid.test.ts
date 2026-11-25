import { describe, expect, it } from 'vitest';
import { WEB_FLUID_REFERENCE_WIDTH_PX, WEB_OVERLAY_WIDTH_MAX_PX, WEB_OVERLAY_WIDTH_PX, WEB_TEACH_WIDTH_MAX_PX, WEB_TEACH_WIDTH_PX } from '../web/constants';
import { fluidPx } from '../web/fluid';

const PERCENT = 100;

describe('fluidPx', () => {
  it('writes clamp(minimum, V vw, maximum)', () => {
    expect(fluidPx(480, 600)).toBe('clamp(480px, 31.25vw, 600px)');
    expect(fluidPx(16, 20)).toBe('clamp(16px, 1.0417vw, 20px)');
  });

  it('reaches the maximum at the reference width and never goes below the minimum', () => {
    for (const [min, max] of [[WEB_TEACH_WIDTH_PX, WEB_TEACH_WIDTH_MAX_PX], [WEB_OVERLAY_WIDTH_PX, WEB_OVERLAY_WIDTH_MAX_PX], [12, 20]]) {
      const vw = Number(/, ([\d.]+)vw,/.exec(fluidPx(min, max))?.[1]);
      expect((vw * WEB_FLUID_REFERENCE_WIDTH_PX) / PERCENT).toBeGreaterThanOrEqual(max);
      expect(max).toBeGreaterThan(min);
    }
  });
});
