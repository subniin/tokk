// A length that grows with the window: clamp(minimum, V vw, maximum). It is never smaller than the minimum, so a small screen
// and a phone keep the small size, and it reaches the maximum in a window WEB_FLUID_REFERENCE_WIDTH_PX wide.
// V is rounded up in the fourth decimal, so that the maximum is reached at the reference width and not 0.01 px short of it.

import { WEB_FLUID_REFERENCE_WIDTH_PX } from './constants';

const PERCENT = 100;
const VW_DECIMAL_SCALE = 10000;
const EPSILON = 1e-9;

export function fluidPx(minPx: number, maxPx: number): string {
  const vw = Math.ceil((maxPx / WEB_FLUID_REFERENCE_WIDTH_PX) * PERCENT * VW_DECIMAL_SCALE - EPSILON) / VW_DECIMAL_SCALE;
  return `clamp(${minPx}px, ${vw}vw, ${maxPx}px)`;
}