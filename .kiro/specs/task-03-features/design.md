# Design: Task 3, FFT, MFCC and segment features

## Layer rule
`core/dsp/fft.ts`, `core/dsp/mfcc.ts` and `core/features.ts` are pure TypeScript. No `fs`, `path`, DOM, or Web Audio. No dependencies, no `Math.random`, no clock. All times are in ms and all levels in dB. Sample counts come from the sample rate and the constants, never from literals.

## Interfaces
```ts
// core/dsp/fft.ts
export function fft(re: Float64Array, im: Float64Array): void            // in place, forward, unscaled

// core/dsp/mfcc.ts
export function fftSizeFor(sampleRate: number): number                  // smallest power of two >= FEATURE_FFT_WINDOW_MULTIPLE x window length
export function windowLengthFor(sampleRate: number): number                  // round(FEATURE_FRAME_MIN_MS x sampleRate / 1000)
export function melFilterbank(fftSize: number, sampleRate: number): Float64Array[]   // MEL_FILTER_COUNT rows, each fftSize/2 + 1 weights
export function mfccFromPower(power: Float64Array, bank: Float64Array[]): Float64Array // MFCC_COUNT - 1 values (c1..c12)

// core/features.ts
export const FEATURE_LENGTH: number                                     // re-exported from constants (32)
export function extractFeatures(seg: Segment): number[]
```
`FEATURE_LENGTH` is defined in `core/constants.ts` (it already is) and `core/features.ts` re-exports it, so Task 5 can import it from either place.

## Constants
These already exist in `core/constants.ts` and are used as they are: `FEATURE_LENGTH` (32), `FEATURE_FRAME_MIN_MS` (20), `FEATURE_HOP_MS` (10), `MEL_FILTER_COUNT` (26), `MEL_MIN_HZ` (100), `MEL_MAX_HZ` (8000), `MEL_MAX_NYQUIST_FRACTION` (0.45), `MFCC_COUNT` (13), `DECAY_DROP_DB` (20), `BAND_EDGES_HZ` ([500, 2000, 5000]), `SILENCE_LEVEL_DBFS` (-90).

This task adds six named exports to the "Features" section of `core/constants.ts`:

| Export | Value | Meaning |
|---|---|---|
| `FEATURE_FFT_WINDOW_MULTIPLE` | 2 | FFT size is at least this many window lengths |
| `MEL_POWER_FLOOR` | 1e-10 | Lower limit of a mel energy before the logarithm (power units after peak normalization, no unit in the name) |
| `FEATURE_CENTROID_SCALE_HZ` | 1000 | Divisor that puts the centroid near 0-8 |
| `FEATURE_DECAY_SCALE_MS` | 100 | Divisor for `decayMs` |
| `FEATURE_ATTACK_SCALE_MS` | 100 | Divisor for `attackMs` |
| `FEATURE_ZCR_SCALE_PER_S` | 1000 | Divisor for zero crossings per second |

The scale divisors only bring the four scalar features to the same order of magnitude as the MFCC values. Final per-dimension standardization is the classifier's job (Task 5). The number of MFCCs kept is `MFCC_COUNT - 1` (12) and is computed, not stored.

The test-only values (`RANGE_FRACTION` 0.05, `RANGE_FLOOR` 0.01, resampler taps) live at the top of `test/features.test.ts` and its helper, not in `core/constants.ts`, because the engine never reads them.

## `fft`
Iterative radix-2 decimation in time. Steps: check `re.length === im.length`, length is at least 1 and a power of two (`(n & (n - 1)) === 0`), else `RangeError`; bit-reversal permutation of both arrays; then for each stage `len = 2, 4, ..., n` combine butterflies with twiddles `exp(-2 pi i k / len)`. Twiddles are computed per stage with `Math.cos` and `Math.sin` of `-2 pi k / len`, not by repeated multiplication, so error does not grow with size. No scaling. Length 1 is a no-op.

## Framing
- `window = round(FEATURE_FRAME_MIN_MS x sampleRate / 1000)` samples, exactly 20 ms at every rate: 320 at 16000 Hz, 882 at 44100 Hz, 960 at 48000 Hz, 1920 at 96000 Hz. This is the analysis frame for MFCC, frame energy, attack and decay.
- `fftSize = smallest power of two >= FEATURE_FFT_WINDOW_MULTIPLE x window` (2 x window). Values: 1024 at 16000 Hz, 2048 at 44100 and 48000 Hz, 4096 at 96000 Hz. Each window is zero-padded to `fftSize` before the FFT.

Why the window is exactly 20 ms and the FFT is 2x the window: with the window rounded up to the FFT size, a 44.1 kHz frame was 23.2 ms and a 48 kHz frame was 21.3 ms. That 9% difference moved the MFCC std by more than the 5% rate bound allows (worst ratio 7.8). The zero-padded 2x FFT keeps the mel triangles stable across bin widths, and the measured worst ratio is 0.50.
- `hop = round(FEATURE_HOP_MS x sampleRate / 1000)` samples.
- Work on the peak-normalized copy `x` of length `L`. If `L < window`, extend `x` with zeros to `window`. The frame count is `F = floor((Lp - window) / hop) + 1`, where `Lp` is the padded length. A partial last frame is dropped. The time of frame `i` is `i x hop / sampleRate x 1000` ms (its start).
- Hann window over the window length: `w[n] = 0.5 - 0.5 cos(2 pi n / window)` (periodic form), built once per call. FFT input samples `window..fftSize-1` are zero.

Why complete frames only: a partial tail would be zero-padded and look like a sudden fade to silence, which adds a rate-dependent click to MFCC std. Because the segmenter's segments start 5 ms before onset and end after the level falls, dropping less than one hop of tail loses almost nothing.

Known limit: a 20 ms frame is longer than a 25 ms `high` impact's fast decay, so one frame contains most of that sound. Attack and decay are therefore measured on a 10 ms grid of overlapping 20 ms frames. They are coarse but stable, and both rates use the same frame and hop in ms (20 ms and 10 ms).

## Mel filterbank and MFCC
- `hzToMel(f) = 2595 x log10(1 + f / 700)` and its inverse.
- `lo = MEL_MIN_HZ`, `hi = min(MEL_MAX_HZ, MEL_MAX_NYQUIST_FRACTION x sampleRate)` (7200 Hz at 16000 Hz). Take `MEL_FILTER_COUNT + 2` points evenly spaced in mel between `hzToMel(lo)` and `hzToMel(hi)` and convert back to Hz. Filter `m` is the triangle rising from point `m` to point `m + 1` and falling to point `m + 2`, with weight 1 at its center and weights evaluated at the bin frequency `k x sampleRate / fftSize`.
- A very narrow low filter can catch no bin center. Its weights are then all 0, its energy is floored, and its log is a constant. This is acceptable: it adds the same constant to every frame and to every segment at that rate.
- Per frame: window, `fft`, `power[k] = re^2 + im^2` for `k = 0..fftSize/2`, mel energies `e[m] = sum bank[m][k] x power[k]`, `l[m] = ln(max(e[m], MEL_POWER_FLOOR))`.
- DCT-II (unnormalized): `c[j] = sum over m of l[m] x cos(pi x j x (m + 0.5) / MEL_FILTER_COUNT)` for `j = 1..MFCC_COUNT - 1`. `c0` is not computed.
- Per segment: mean and population standard deviation of each of the 12 coefficients over frames. With one frame, the std is 0.

Why the natural log and the floor: after peak normalization the largest sample is 1, so powers are at most about `window^2`, and a floor of 1e-10 is far below any real signal. It only protects against `ln(0)` for all-zero frames.

## Peak normalization
`peak = max |x[i]|`. If `peak > 0`, `x = samples / peak` on a new `Float64Array`. If `peak === 0` or there are no samples, `x` is zeros. The input is never modified. This removes level before any feature, and it makes `-20 dB` and `0 dB` versions of the same sound equal up to float32 rounding in the input.

## Scalar features
All use `x` (normalized, before zero padding for ZCR and after for frames).
- **Summed power spectrum** `P[k]` = sum over frames of `power[k]`. Bin frequency `f_k = k x sampleRate / fftSize`.
- **Centroid**: `sum f_k P[k] / sum P[k]`, divided by `FEATURE_CENTROID_SCALE_HZ`. 0 if `sum P` is 0.
- **Band ratios**: with edges `BAND_EDGES_HZ = [500, 2000, 5000]`, bin `k` falls in band 0 if `f_k < 500`, band 1 if `500 <= f_k < 2000`, band 2 if `2000 <= f_k < 5000`, band 3 otherwise. Ratio = band power / `sum P`. All 0 if silent. At 16000 Hz the top band holds 5000 to 8000 Hz, so it is smaller than at 48000 Hz. That is the known 16 kHz limit in the design (P4 compares classification only between 44.1 kHz and 48 kHz).
- **Frame energy** `E[i]` in dB: `10 log10(max(mean(x[start..start+window)^2), 10^(SILENCE_LEVEL_DBFS / 10)))`, using unwindowed samples.
- **Attack**: index `a` of the first frame with the largest `E`. `attackMs = a x hop / sampleRate x 1000`, divided by `FEATURE_ATTACK_SCALE_MS`.
- **Decay**: first index `d > a` with `E[d] <= E[a] - DECAY_DROP_DB`. `decayMs = (d - a) x hop / sampleRate x 1000`. If no such frame, `decayMs = (Lp - a x hop) / sampleRate x 1000` (the remaining length from the start of the maximum frame, where `Lp` is the padded length). Divided by `FEATURE_DECAY_SCALE_MS`.
- **ZCR**: `count of i in 1..L-1 where (x[i-1] < 0) !== (x[i] < 0)`, divided by `L / sampleRate` seconds, then by `FEATURE_ZCR_SCALE_PER_S`. 0 if `L < 2`. It uses the original length `L`, not the padded one, so padding does not dilute it.

Level-independence of these: the frame-energy rule is relative (differences of dB), the peak is already 1, and none of the scalars uses an absolute level or a duration.

## Vector layout
```
[ 0..11 ] mfcc1..12 mean
[12..23 ] mfcc1..12 std
[24] centroidHz / 1000     [25] decayMs / 100     [26] attackMs / 100     [27] zcrPerSecond / 1000
[28] ratio < 500   [29] 500-2000   [30] 2000-5000   [31] > 5000
```
A final check inside `extractFeatures` throws if the array length differs from `FEATURE_LENGTH`. This guards later edits.

## Input checks
`sampleRate` not positive and finite throws `RangeError('sampleRate ...')`. Everything else is accepted, including empty and silent segments, which return a finite vector (MFCC from floored energies, scalars 0, ratios 0).

## Test helper: resampler
`test/helpers/resample.ts` exports `resample(x: Float32Array, fromRate: number, toRate: number): Float32Array`. Method: **windowed-sinc interpolation with a built-in low-pass**. For each output index `j` the time is `j / toRate` and the source position is `p = j x fromRate / toRate`. The output is the sum over source samples `n` with `|p - n| < HALF_WIDTH` of `x[n] x h(p - n)`, where `h(u) = c sinc(c u) x blackman(u / HALF_WIDTH)` and `c = min(1, toRate / fromRate) x 0.95`. This cuts at 95% of the lower Nyquist, so nothing aliases when going from 96000 Hz to 44100 Hz or 48000 Hz. `HALF_WIDTH` is 32 source samples, which is plenty for ratios near 2. Samples outside the input count as 0. Output length is `round(x.length x toRate / fromRate)`.

Why windowed sinc and not linear after a low-pass: it is one function with no separate filter, it has no passband droop, and the ratio 96000 to 44100 is not an integer, so a direct evaluation at fractional positions is simpler than polyphase decimation. It is slow (about 64 multiplies per output sample), which is fine for clips under 0.5 s.

The test also checks the helper itself: a 1 kHz sine at 96000 Hz resampled to 44100 Hz and 48000 Hz keeps its frequency (zero crossing rate) and amplitude within 2%, away from the edges.

## File layout (created by Task 3)
```
core/ dsp/fft.ts          (new)
core/ dsp/mfcc.ts         (new)
core/ features.ts         (new)
core/ constants.ts        (edited: 5 new exports in the Features section)
test/ features.test.ts    (new)
test/ helpers/resample.ts (new)
.kiro/specs/task-03-features/
```

## Testing
`test/features.test.ts` (vitest). Synthetic input comes from `core/synth.ts` (Task 2) with fixed seeds, always wrapped as `{ t: 0, durationMs, samples, sampleRate }`.

Planned tests:
- `fft`: 1 kHz sine at 48000 Hz peaks at the nearest bin; matches a direct DFT on 64 random samples within 1e-9; impulse gives a flat spectrum; length 1 is a no-op; lengths 0, 3 and mismatched arrays throw `RangeError`.
- `fftSizeFor` returns 1024, 2048, 2048, 4096 at 16000, 44100, 48000, 96000 Hz, and `windowLengthFor` returns 320, 882, 960, 1920.
- `melFilterbank`: 26 rows; the last filter's upper edge is at most `min(8000, 0.45 x rate)` (weights are 0 above it) at 16000 and 48000 Hz.
- Vector length is 32 and every value is finite for 0 samples, 5 ms of noise, one sample, and 1 s of zeros.
- The input array is not modified.
- `high` has a larger centroid feature than `low`; `ring` has a larger decay feature than `high`.
- ZCR is per second: a 1 kHz sine gives about 2 (2000 crossings per second / 1000) at 16000, 48000 and 96000 Hz.
- Attack: a clip with 50 ms of silence at -90 dB and then a loud impact has a larger attack feature than the same impact placed at the start (silence is first made non-zero by tiny noise, since a silent head only counts when its frame energy is lower than the maximum).
- Decay with no 20 dB drop returns the remaining length: a steady tone gives `decayMs` close to its length minus the attack.
- Band ratios add up to 1 for the four classes and to 0 for silence.
- Level: same impact at -20 dB and 0 dB passes the 5%-of-range check for all 32 dimensions and all 4 classes (Requirement 6.3).
- Rate: the four classes at 44100 Hz and 48000 Hz, resampled from one 96000 Hz synthesis, pass the 5%-of-range check for all 32 dimensions (Requirement 6.2). The failure message names the class, the dimension index, the difference and the allowed value.
- The four class vectors are distinct (Requirement 5.3).
- The resampler helper keeps a sine's frequency and amplitude within 2%.

Risk and rule: the 5% rate check is the real test of the design. If a dimension fails, find the cause (for example the mel filters at 100 Hz, or frame grid rounding) and fix the feature code. Do not raise the 5% bound or the `RANGE_FLOOR` to make the test pass.
