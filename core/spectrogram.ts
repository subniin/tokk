// Spectrogram renderer: samples in, a grayscale pixel grid out. Pure TypeScript, no I/O, no randomness.
// One column is one hop (SPECTROGRAM_HOP_MS), one row is one band of SPECTROGRAM_MAX_HZ / SPECTROGRAM_HEIGHT_PX Hz.

import {
  SPECTROGRAM_CEILING_DBFS, SPECTROGRAM_FFT_SIZE, SPECTROGRAM_FLOOR_DBFS, SPECTROGRAM_HEIGHT_PX, SPECTROGRAM_HOP_MS,
  SPECTROGRAM_MAX_HZ,
} from './constants';
import { fft } from './dsp/fft';

const GRAY_MAX = 255;
const MS_PER_S = 1000;
const DB_PER_DECADE = 20;

export interface SpectrogramOptions { startS?: number; endS?: number }
export interface SpectrogramImage { width: number; height: number; gray: Uint8Array }

export function spectrogramHopSamples(sampleRate: number): number {
  return Math.max(1, Math.round((sampleRate * SPECTROGRAM_HOP_MS) / MS_PER_S));
}

function checkSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`sampleRate must be a finite number greater than 0, got ${sampleRate}`);
  }
}

// Start and end sample of the selected range, clamped to the recording. Empty when endSample <= startSample.
export function spectrogramRange(
  length: number, sampleRate: number, startS?: number, endS?: number,
): { startSample: number; endSample: number } {
  checkSampleRate(sampleRate);
  if (startS !== undefined && !Number.isFinite(startS)) throw new RangeError(`startS must be a finite number, got ${startS}`);
  if (endS !== undefined && !Number.isFinite(endS)) throw new RangeError(`endS must be a finite number, got ${endS}`);
  const clamp = (v: number): number => Math.min(Math.max(v, 0), length);
  const startSample = startS === undefined ? 0 : clamp(Math.round(startS * sampleRate));
  const endSample = endS === undefined ? length : clamp(Math.round(endS * sampleRate));
  return { startSample, endSample };
}

// Bins of band r: those with lo <= k * sampleRate / N < hi, compared in integers of Hz * N. The top band also takes
// the bin at SPECTROGRAM_MAX_HZ. Without a bin in the band, the nearest bin to the centre is used. Bands at or above
// Nyquist have no bins and read the floor.
function bandBins(sampleRate: number): number[][] {
  const frame = SPECTROGRAM_FFT_SIZE;
  const nyquistBin = frame / 2;
  const bandHz = SPECTROGRAM_MAX_HZ / SPECTROGRAM_HEIGHT_PX;
  const bands: number[][] = [];
  for (let r = 0; r < SPECTROGRAM_HEIGHT_PX; r++) {
    const lo = r * bandHz;
    const hi = (r + 1) * bandHz;
    if (lo >= sampleRate / 2) {
      bands.push([]);
      continue;
    }
    const bins: number[] = [];
    const top = r === SPECTROGRAM_HEIGHT_PX - 1;
    for (let k = 0; k <= nyquistBin; k++) {
      const scaled = k * sampleRate;
      if (scaled >= lo * frame && (scaled < hi * frame || (top && scaled === hi * frame))) bins.push(k);
    }
    if (bins.length === 0) {
      const centre = Math.round(((lo + hi) / 2) * frame / sampleRate);
      bins.push(Math.min(Math.max(centre, 0), nyquistBin));
    }
    bands.push(bins);
  }
  return bands;
}

export function renderSpectrogram(samples: Float32Array, sampleRate: number, options: SpectrogramOptions = {}): SpectrogramImage {
  const height = SPECTROGRAM_HEIGHT_PX;
  const { startSample, endSample } = spectrogramRange(samples.length, sampleRate, options.startS, options.endS);
  const count = endSample - startSample;
  if (count <= 0) return { width: 0, height, gray: new Uint8Array(0) };

  const frame = SPECTROGRAM_FFT_SIZE;
  const hop = spectrogramHopSamples(sampleRate);
  const range = samples.subarray(startSample, endSample);
  const width = Math.ceil(count / hop);

  const window = new Float64Array(frame);
  let windowSum = 0;
  for (let n = 0; n < frame; n++) {
    window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / frame);
    windowSum += window[n];
  }
  const windowGain = windowSum / 2;
  const bands = bandBins(sampleRate);
  const floorDbfs = SPECTROGRAM_FLOOR_DBFS;
  const tiny = 10 ** (floorDbfs / DB_PER_DECADE);
  const span = SPECTROGRAM_CEILING_DBFS - floorDbfs;

  const gray = new Uint8Array(width * height);
  const re = new Float64Array(frame);
  const im = new Float64Array(frame);
  const mag = new Float64Array(frame / 2 + 1);

  for (let x = 0; x < width; x++) {
    const first = x * hop - frame / 2;
    for (let n = 0; n < frame; n++) {
      const i = first + n;
      re[n] = i >= 0 && i < count ? range[i] * window[n] : 0;
      im[n] = 0;
    }
    fft(re, im);
    for (let k = 0; k < mag.length; k++) mag[k] = Math.hypot(re[k], im[k]) / windowGain;
    for (let r = 0; r < height; r++) {
      const bins = bandMax(mag, bands[r]);
      let value = 0;
      if (bins !== undefined) {
        const level = Math.min(Math.max(DB_PER_DECADE * Math.log10(Math.max(bins, tiny)), floorDbfs), SPECTROGRAM_CEILING_DBFS);
        value = Math.round(((level - floorDbfs) / span) * GRAY_MAX);
      }
      gray[(height - 1 - r) * width + x] = value;
    }
  }
  return { width, height, gray };
}

function bandMax(mag: Float64Array, bins: number[]): number | undefined {
  if (bins.length === 0) return undefined;
  let m = 0;
  for (const k of bins) if (mag[k] > m) m = mag[k];
  return m;
}
