import { describe, it, expect } from 'vitest';
import { renderSpectrogram } from '../core/spectrogram';

const SAMPLE_RATE_HZ = 16000;
const TONE_HZ = 1000;
const HEIGHT_PX = 256;
const BAND_HZ = 31.25;
const EDGE_COLUMNS = 5;
const DURATION_S = 1;
const BRIGHT_MIN = 250;
const CROP_BRIGHT_MIN = 200;
const MS_PER_S = 1000;

function sine(freqHz: number, sampleRate: number, durationS: number, amplitude = 1): Float32Array {
  const n = Math.round(durationS * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin(2 * Math.PI * freqHz * (i / sampleRate));
  return out;
}

const bandOf = (hz: number): number => Math.floor(hz / BAND_HZ);
const rowOf = (band: number): number => HEIGHT_PX - 1 - band;

interface Image { width: number; height: number; gray: Uint8Array }

function rowSums(img: Image, from = EDGE_COLUMNS, to = img.width - EDGE_COLUMNS): number[] {
  const sums = new Array<number>(img.height).fill(0);
  for (let y = 0; y < img.height; y++) for (let x = from; x < to; x++) sums[y] += img.gray[y * img.width + x];
  return sums;
}

function brightestBand(img: Image): number {
  const sums = rowSums(img);
  let best = 0;
  for (let y = 1; y < sums.length; y++) if (sums[y] > sums[best]) best = y;
  return img.height - 1 - best;
}

const at = (img: Image, band: number, x: number): number => img.gray[rowOf(band) * img.width + x];

describe('renderSpectrogram: frequency axis (Req 1.3 to 1.5, 4.2)', () => {
  it('puts a 1 kHz sine at 16000 Hz in band 32, image row 223, height 256', () => {
    const img = renderSpectrogram(sine(TONE_HZ, SAMPLE_RATE_HZ, DURATION_S), SAMPLE_RATE_HZ);
    expect(img.height).toBe(HEIGHT_PX);
    expect(brightestBand(img)).toBe(32);
    expect(rowOf(brightestBand(img))).toBe(223);
  });

  it.each([44100, 48000])('puts a 1 kHz sine at %i Hz within one row of band 32', (rate) => {
    const img = renderSpectrogram(sine(TONE_HZ, rate, DURATION_S), rate);
    expect(Math.abs(brightestBand(img) - bandOf(TONE_HZ))).toBeLessThanOrEqual(1);
  });

  it('reaches at least 250 for a full-scale sine and gives 0 for silence', () => {
    const img = renderSpectrogram(sine(TONE_HZ, SAMPLE_RATE_HZ, DURATION_S), SAMPLE_RATE_HZ);
    expect(Math.max(...img.gray)).toBeGreaterThanOrEqual(BRIGHT_MIN);
    const quiet = renderSpectrogram(new Float32Array(SAMPLE_RATE_HZ), SAMPLE_RATE_HZ);
    expect(quiet.gray.every((v) => v === 0)).toBe(true);
  });

  it('draws 500 Hz lower in the image than 4 kHz', () => {
    const low = renderSpectrogram(sine(500, SAMPLE_RATE_HZ, DURATION_S), SAMPLE_RATE_HZ);
    const high = renderSpectrogram(sine(4000, SAMPLE_RATE_HZ, DURATION_S), SAMPLE_RATE_HZ);
    expect(rowOf(brightestBand(low))).toBeGreaterThan(rowOf(brightestBand(high)));
  });

  it('lights the top bands for a 7.9 kHz sine at 16000 Hz', () => {
    const img = renderSpectrogram(sine(7900, SAMPLE_RATE_HZ, DURATION_S), SAMPLE_RATE_HZ);
    expect(img.height).toBe(HEIGHT_PX);
    const band = brightestBand(img);
    expect(band).toBeGreaterThanOrEqual(250);
    expect(band).toBeLessThanOrEqual(255);
  });

  it('reads black for bands at or above Nyquist when the sample rate is 8000 Hz', () => {
    const rate = 8000;
    const img = renderSpectrogram(sine(TONE_HZ, rate, DURATION_S), rate);
    for (let band = bandOf(rate / 2); band < HEIGHT_PX; band++) expect(at(img, band, img.width >> 1)).toBe(0);
    expect(Math.abs(brightestBand(img) - bandOf(TONE_HZ))).toBeLessThanOrEqual(1);
  });
});

describe('renderSpectrogram: size and range (Req 1.7 to 1.10, 4.2)', () => {
  it('gives 100 columns for 1 s at 16000 Hz', () => {
    const img = renderSpectrogram(sine(TONE_HZ, SAMPLE_RATE_HZ, DURATION_S), SAMPLE_RATE_HZ);
    expect(img.width).toBe(100);
    expect(img.gray.length).toBe(img.width * img.height);
  });

  function halfSilent(): Float32Array {
    const out = new Float32Array(2 * SAMPLE_RATE_HZ);
    out.set(sine(TONE_HZ, SAMPLE_RATE_HZ, 1), SAMPLE_RATE_HZ);
    return out;
  }
  const columns = (img: Image, band: number, from: number, to: number): number[] => {
    const out: number[] = [];
    for (let x = from; x < to; x++) out.push(at(img, band, x));
    return out;
  };

  it('crops 1..2 s to a bright tone row and 0..1 s to a black one', () => {
    const samples = halfSilent();
    const tone = renderSpectrogram(samples, SAMPLE_RATE_HZ, { startS: 1, endS: 2 });
    expect(tone.width).toBe(100);
    for (const v of columns(tone, 32, EDGE_COLUMNS, tone.width - EDGE_COLUMNS)) expect(v).toBeGreaterThanOrEqual(CROP_BRIGHT_MIN);
    const none = renderSpectrogram(samples, SAMPLE_RATE_HZ, { startS: 0, endS: 1 });
    expect(none.width).toBe(100);
    for (const v of columns(none, 32, 0, none.width)) expect(v).toBe(0);
  });

  it('crops 0.5..1.5 s to dark on the left and bright on the right', () => {
    const img = renderSpectrogram(halfSilent(), SAMPLE_RATE_HZ, { startS: 0.5, endS: 1.5 });
    expect(img.width).toBe(100);
    for (const v of columns(img, 32, 0, 45)) expect(v).toBe(0);
    for (const v of columns(img, 32, 55, 95)) expect(v).toBeGreaterThanOrEqual(CROP_BRIGHT_MIN);
  });

  it('renders a range the same as the samples cut out by hand', () => {
    const samples = halfSilent();
    const a = renderSpectrogram(samples, SAMPLE_RATE_HZ, { startS: 0.5, endS: 1.5 });
    const b = renderSpectrogram(samples.subarray(SAMPLE_RATE_HZ / 2, 3 * SAMPLE_RATE_HZ / 2), SAMPLE_RATE_HZ);
    expect(a.width).toBe(b.width);
    expect([...a.gray]).toEqual([...b.gray]);
  });

  it('clamps endS past the end and a negative startS to 0', () => {
    const samples = sine(TONE_HZ, SAMPLE_RATE_HZ, DURATION_S);
    const whole = renderSpectrogram(samples, SAMPLE_RATE_HZ);
    const past = renderSpectrogram(samples, SAMPLE_RATE_HZ, { endS: 99 });
    const neg = renderSpectrogram(samples, SAMPLE_RATE_HZ, { startS: -3 });
    expect([...past.gray]).toEqual([...whole.gray]);
    expect([...neg.gray]).toEqual([...whole.gray]);
  });

  it('gives width 0 and an empty array for empty ranges', () => {
    const empty = renderSpectrogram(new Float32Array(0), SAMPLE_RATE_HZ);
    expect(empty).toEqual({ width: 0, height: HEIGHT_PX, gray: new Uint8Array(0) });
    const samples = sine(TONE_HZ, SAMPLE_RATE_HZ, DURATION_S);
    expect(renderSpectrogram(samples, SAMPLE_RATE_HZ, { startS: 5 }).width).toBe(0);
    expect(renderSpectrogram(samples, SAMPLE_RATE_HZ, { startS: 0.5, endS: 0.5 }).width).toBe(0);
    expect(renderSpectrogram(samples, SAMPLE_RATE_HZ, { startS: 0.6, endS: 0.2 }).gray.length).toBe(0);
  });

  it('gives one finite column for 3 ms and 3 columns for 25 ms at 16000 Hz', () => {
    const samples = sine(TONE_HZ, SAMPLE_RATE_HZ, DURATION_S);
    const short = renderSpectrogram(samples, SAMPLE_RATE_HZ, { startS: 0.1, endS: 0.1 + 3 / MS_PER_S });
    expect(short.width).toBe(1);
    expect([...short.gray].every((v) => Number.isFinite(v))).toBe(true);
    const mid = renderSpectrogram(samples, SAMPLE_RATE_HZ, { startS: 0.1, endS: 0.1 + 25 / MS_PER_S });
    expect(mid.width).toBe(3);
  });
});

describe('renderSpectrogram: validation and purity (Req 1.11, 1.14)', () => {
  const samples = sine(TONE_HZ, SAMPLE_RATE_HZ, 0.1);

  it('throws RangeError for a bad sample rate or a non-finite range', () => {
    for (const rate of [0, NaN, -16000, Infinity]) expect(() => renderSpectrogram(samples, rate)).toThrow(RangeError);
    expect(() => renderSpectrogram(samples, SAMPLE_RATE_HZ, { startS: NaN })).toThrow(RangeError);
    expect(() => renderSpectrogram(samples, SAMPLE_RATE_HZ, { endS: Infinity })).toThrow(RangeError);
  });

  it('does not change the input, is deterministic and has no NaN', () => {
    const input = sine(TONE_HZ, SAMPLE_RATE_HZ, DURATION_S, 0.5);
    const copy = Float32Array.from(input);
    const a = renderSpectrogram(input, SAMPLE_RATE_HZ);
    const b = renderSpectrogram(input, SAMPLE_RATE_HZ);
    expect([...input]).toEqual([...copy]);
    expect([...a.gray]).toEqual([...b.gray]);
    expect([...a.gray].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
  });
});
