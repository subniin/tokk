// Test helper only. Resamples by windowed-sinc interpolation with a built-in low-pass, so no
// separate filter is needed. It lives outside core/ because the engine never resamples.

const HALF_WIDTH = 32;              // source samples on each side of the output position
const CUTOFF_FRACTION = 0.95;       // fraction of the lower Nyquist frequency that is kept

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

// Blackman window over u in [-1, 1]. Zero outside.
function blackman(u: number): number {
  if (Math.abs(u) >= 1) return 0;
  return 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
}

export function resample(x: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0 && toRate > 0)) {
    throw new RangeError(`sample rates must be positive, got ${fromRate} and ${toRate}.`);
  }
  const outLength = Math.round((x.length * toRate) / fromRate);
  const out = new Float32Array(outLength);
  const cutoff = Math.min(1, toRate / fromRate) * CUTOFF_FRACTION;

  for (let j = 0; j < outLength; j++) {
    const p = (j * fromRate) / toRate;
    const first = Math.max(0, Math.ceil(p - HALF_WIDTH));
    const last = Math.min(x.length - 1, Math.floor(p + HALF_WIDTH));
    let sum = 0;
    for (let n = first; n <= last; n++) {
      const u = p - n;
      sum += x[n] * cutoff * sinc(cutoff * u) * blackman(u / HALF_WIDTH);
    }
    out[j] = sum;
  }
  return out;
}
