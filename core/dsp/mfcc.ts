// Frame sizing, mel filterbank and MFCC for the segment features. Pure TypeScript: no I/O, no dependencies, no randomness.

import {
  FEATURE_FFT_WINDOW_MULTIPLE,
  FEATURE_FRAME_MIN_MS,
  MEL_FILTER_COUNT,
  MEL_MAX_HZ,
  MEL_MAX_NYQUIST_FRACTION,
  MEL_MIN_HZ,
  MEL_POWER_FLOOR,
  MFCC_COUNT,
} from '../constants';

const MS_PER_SECOND = 1000;
const MEL_SCALE_HZ = 700;
const MEL_SCALE_FACTOR = 2595;

function checkSampleRate(sampleRate: number): void {
  if (!(Number.isFinite(sampleRate) && sampleRate > 0)) {
    throw new RangeError(`sampleRate must be a positive finite number, got ${sampleRate}.`);
  }
}

function hzToMel(hz: number): number {
  return MEL_SCALE_FACTOR * Math.log10(1 + hz / MEL_SCALE_HZ);
}

function melToHz(mel: number): number {
  return MEL_SCALE_HZ * (Math.pow(10, mel / MEL_SCALE_FACTOR) - 1);
}

// Analysis window length: FEATURE_FRAME_MIN_MS of samples, rounded. This is 20 ms at every rate.
export function windowLengthFor(sampleRate: number): number {
  checkSampleRate(sampleRate);
  return Math.round((FEATURE_FRAME_MIN_MS * sampleRate) / MS_PER_SECOND);
}

// FFT size: smallest power of two that is at least FEATURE_FFT_WINDOW_MULTIPLE x the window length.
// The window is zero-padded to this size, which keeps mel triangles stable across bin widths.
export function fftSizeFor(sampleRate: number): number {
  const minSize = FEATURE_FFT_WINDOW_MULTIPLE * windowLengthFor(sampleRate);
  let n = 1;
  while (n < minSize) n *= 2;
  return n;
}

// Triangular mel filters between MEL_MIN_HZ and min(MEL_MAX_HZ, MEL_MAX_NYQUIST_FRACTION x sampleRate).
// Filter m rises from edge point m to point m + 1 and falls to point m + 2. Each row has fftSize/2 + 1 weights.
export function melFilterbank(fftSize: number, sampleRate: number): Float64Array[] {
  checkSampleRate(sampleRate);
  if (!(Number.isInteger(fftSize) && fftSize >= 2)) {
    throw new RangeError(`fftSize must be an integer of at least 2, got ${fftSize}.`);
  }
  const lowMel = hzToMel(MEL_MIN_HZ);
  const highMel = hzToMel(Math.min(MEL_MAX_HZ, MEL_MAX_NYQUIST_FRACTION * sampleRate));
  const edgesHz: number[] = [];
  for (let i = 0; i < MEL_FILTER_COUNT + 2; i++) {
    edgesHz.push(melToHz(lowMel + (i * (highMel - lowMel)) / (MEL_FILTER_COUNT + 1)));
  }

  const bins = fftSize / 2 + 1;
  const bank: Float64Array[] = [];
  for (let m = 0; m < MEL_FILTER_COUNT; m++) {
    const f0 = edgesHz[m];
    const f1 = edgesHz[m + 1];
    const f2 = edgesHz[m + 2];
    const row = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      const f = (k * sampleRate) / fftSize;
      if (f <= f0 || f >= f2) row[k] = 0;
      else if (f <= f1) row[k] = (f - f0) / (f1 - f0);
      else row[k] = (f2 - f) / (f2 - f1);
    }
    bank.push(row);
  }
  return bank;
}

// DCT-II cosine table: COS_TABLE[j - 1][m] = cos(pi x j x (m + 0.5) / MEL_FILTER_COUNT) for j = 1..MFCC_COUNT - 1.
// It depends only on the constants, so it is built once.
const COS_TABLE: Float64Array[] = [];
for (let j = 1; j < MFCC_COUNT; j++) {
  const row = new Float64Array(MEL_FILTER_COUNT);
  for (let m = 0; m < MEL_FILTER_COUNT; m++) {
    row[m] = Math.cos((Math.PI * j * (m + 0.5)) / MEL_FILTER_COUNT);
  }
  COS_TABLE.push(row);
}

// Log mel energies of one power spectrum, then the DCT-II. Returns c1..c(MFCC_COUNT - 1). c0 is dropped.
export function mfccFromPower(power: Float64Array, bank: Float64Array[]): Float64Array {
  if (bank.length !== MEL_FILTER_COUNT) {
    throw new RangeError(`filterbank must have ${MEL_FILTER_COUNT} rows, got ${bank.length}.`);
  }
  const logEnergy = new Float64Array(MEL_FILTER_COUNT);
  for (let m = 0; m < MEL_FILTER_COUNT; m++) {
    const row = bank[m];
    if (row.length !== power.length) {
      throw new RangeError(`power spectrum has ${power.length} bins but the filterbank has ${row.length}.`);
    }
    let energy = 0;
    for (let k = 0; k < power.length; k++) energy += row[k] * power[k];
    logEnergy[m] = Math.log(Math.max(energy, MEL_POWER_FLOOR));
  }

  const out = new Float64Array(MFCC_COUNT - 1);
  for (let j = 0; j < MFCC_COUNT - 1; j++) {
    const cos = COS_TABLE[j];
    let sum = 0;
    for (let m = 0; m < MEL_FILTER_COUNT; m++) sum += logEnergy[m] * cos[m];
    out[j] = sum;
  }
  return out;
}
