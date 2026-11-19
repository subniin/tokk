// Turns one segment into a fixed-length, level-independent feature vector (see design.md, "Vector layout").
// Pure TypeScript: no I/O, no dependencies, no randomness, no clock.

import {
  BAND_EDGES_HZ,
  DECAY_DROP_DB,
  FEATURE_ATTACK_SCALE_MS,
  FEATURE_CENTROID_SCALE_HZ,
  FEATURE_DECAY_SCALE_MS,
  FEATURE_HOP_MS,
  FEATURE_LENGTH,
  FEATURE_ZCR_SCALE_PER_S,
  MFCC_COUNT,
  SILENCE_LEVEL_DBFS,
} from './constants';
import { fft } from './dsp/fft';
import { fftSizeFor, melFilterbank, mfccFromPower, windowLengthFor } from './dsp/mfcc';
import type { Segment } from './types';

export { FEATURE_LENGTH } from './constants';

const MS_PER_SECOND = 1000;
const COEFF_COUNT = MFCC_COUNT - 1;
const BAND_COUNT = BAND_EDGES_HZ.length + 1;

// Divides by the peak absolute value, so the largest sample is 1. A silent or empty input stays zero.
function normalizedCopy(samples: Float32Array): Float64Array {
  const out = new Float64Array(samples.length);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak === 0) return out;
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / peak;
  return out;
}

// Periodic Hann window, w[n] = 0.5 - 0.5 cos(2 pi n / N).
function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

// Index of the band that bin frequency f falls in. BAND_EDGES_HZ are lower edges, so the count of edges at or below f gives the band.
function bandOf(freqHz: number): number {
  let band = 0;
  for (const edge of BAND_EDGES_HZ) if (freqHz >= edge) band++;
  return band;
}

function meanOf(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

// Population standard deviation. Zero for one value.
function stdOf(values: number[], mean: number): number {
  let sum = 0;
  for (const v of values) sum += (v - mean) * (v - mean);
  return Math.sqrt(sum / values.length);
}

export function extractFeatures(seg: Segment): number[] {
  const rate = seg.sampleRate;
  if (!(Number.isFinite(rate) && rate > 0)) {
    throw new RangeError(`sampleRate must be a positive finite number, got ${rate}.`);
  }

  const x = normalizedCopy(seg.samples);
  const len = x.length;
  const win = windowLengthFor(rate);
  const n = fftSizeFor(rate);
  const hop = Math.round((FEATURE_HOP_MS * rate) / MS_PER_SECOND);
  const padded = new Float64Array(Math.max(len, win));
  padded.set(x);
  const paddedLen = padded.length;
  const frameCount = Math.floor((paddedLen - win) / hop) + 1;

  const hann = hannWindow(win);
  const bank = melFilterbank(n, rate);
  const bins = n / 2 + 1;
  const summedPower = new Float64Array(bins);
  const frameCoeffs: Float64Array[] = [];
  const frameEnergyDb = new Float64Array(frameCount);
  const floorPower = Math.pow(10, SILENCE_LEVEL_DBFS / 10);
  const re = new Float64Array(n);
  const im = new Float64Array(n);

  for (let f = 0; f < frameCount; f++) {
    const start = f * hop;
    re.fill(0);
    im.fill(0);
    let sumSquares = 0;
    for (let i = 0; i < win; i++) {
      const v = padded[start + i];
      sumSquares += v * v;
      re[i] = v * hann[i];
    }
    frameEnergyDb[f] = 10 * Math.log10(Math.max(sumSquares / win, floorPower));

    fft(re, im);
    const power = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      power[k] = re[k] * re[k] + im[k] * im[k];
      summedPower[k] += power[k];
    }
    frameCoeffs.push(mfccFromPower(power, bank));
  }

  // MFCC mean and standard deviation over frames.
  const means: number[] = [];
  const stds: number[] = [];
  for (let j = 0; j < COEFF_COUNT; j++) {
    const column = frameCoeffs.map((c) => c[j]);
    const mean = meanOf(column);
    means.push(mean);
    stds.push(stdOf(column, mean));
  }

  // Spectral centroid and band ratios from the power summed over all frames.
  let totalPower = 0;
  let weightedFreq = 0;
  const bandPower = new Array<number>(BAND_COUNT).fill(0);
  for (let k = 0; k < bins; k++) {
    const freq = (k * rate) / n;
    totalPower += summedPower[k];
    weightedFreq += freq * summedPower[k];
    bandPower[bandOf(freq)] += summedPower[k];
  }
  const centroidHz = totalPower > 0 ? weightedFreq / totalPower : 0;
  const bandRatios = bandPower.map((p) => (totalPower > 0 ? p / totalPower : 0));

  // Attack and decay on the frame energy grid. The attack frame is the first with the largest energy.
  let attack = 0;
  for (let f = 1; f < frameCount; f++) {
    if (frameEnergyDb[f] > frameEnergyDb[attack]) attack = f;
  }
  const dropLevel = frameEnergyDb[attack] - DECAY_DROP_DB;
  let decayEnd = -1;
  for (let f = attack + 1; f < frameCount; f++) {
    if (frameEnergyDb[f] <= dropLevel) {
      decayEnd = f;
      break;
    }
  }
  const attackMs = (attack * hop * MS_PER_SECOND) / rate;
  const decayMs =
    decayEnd === -1
      ? ((paddedLen - attack * hop) * MS_PER_SECOND) / rate
      : ((decayEnd - attack) * hop * MS_PER_SECOND) / rate;

  // Zero crossings per second on the normalized, unpadded signal. A sample is negative when below 0.
  let crossings = 0;
  for (let i = 1; i < len; i++) {
    if ((x[i - 1] < 0) !== (x[i] < 0)) crossings++;
  }
  const zcrPerSecond = len < 2 ? 0 : crossings / (len / rate);

  const vector: number[] = [
    ...means,
    ...stds,
    centroidHz / FEATURE_CENTROID_SCALE_HZ,
    decayMs / FEATURE_DECAY_SCALE_MS,
    attackMs / FEATURE_ATTACK_SCALE_MS,
    zcrPerSecond / FEATURE_ZCR_SCALE_PER_S,
    ...bandRatios,
  ];
  if (vector.length !== FEATURE_LENGTH) {
    throw new Error(`feature vector has ${vector.length} values, expected ${FEATURE_LENGTH}.`);
  }
  return vector;
}
