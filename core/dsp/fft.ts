// In-place radix-2 FFT (decimation in time). Pure TypeScript: no I/O, no dependencies, no randomness.

function isPowerOfTwo(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0;
}

// Forward transform, X[k] = sum x[n] exp(-2 pi i k n / N). Unscaled. Writes the result back into re and im.
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (im.length !== n) {
    throw new RangeError(`re and im must have the same length, got ${n} and ${im.length}.`);
  }
  if (!isPowerOfTwo(n)) {
    throw new RangeError(`FFT length must be a power of two (at least 1), got ${n}.`);
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  // Butterflies. Twiddles for each stage come from cos and sin directly, so their error does not grow with size.
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angleStep = (-2 * Math.PI) / len;
    const wr = new Float64Array(half);
    const wi = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      wr[k] = Math.cos(angleStep * k);
      wi[k] = Math.sin(angleStep * k);
    }
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr[k] - im[b] * wi[k];
        const xi = re[b] * wi[k] + im[b] * wr[k];
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}
