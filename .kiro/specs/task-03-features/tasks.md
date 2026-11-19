# Tasks: Task 3, FFT, MFCC and segment features

Order is test-first. Do not write `core/dsp/fft.ts`, `core/dsp/mfcc.ts` or `core/features.ts` before the tests fail.

- [x] 1. Add feature constants
  - [x] 1.1 In the Features section of `core/constants.ts`, add `MEL_POWER_FLOOR` (1e-10), `FEATURE_CENTROID_SCALE_HZ` (1000), `FEATURE_DECAY_SCALE_MS` (100), `FEATURE_ATTACK_SCALE_MS` (100) and `FEATURE_ZCR_SCALE_PER_S` (1000), as listed in `design.md`. (Req 7.3)
  - [x] 1.2 Confirm the existing feature constants are unchanged and that `FEATURE_LENGTH` is 32.

- [x] 2. Write the test helper
  - [x] 2.1 Create `test/helpers/resample.ts` with the windowed-sinc `resample(x, fromRate, toRate)` described in `design.md` (Blackman window, half width 32 source samples, cutoff 95% of the lower Nyquist). (Req 6.4)

- [x] 3. Write failing tests in `test/features.test.ts`
  - [x] 3.1 `fft`: 1 kHz sine peak bin, match against a direct 64-point DFT within 1e-9, impulse is flat, length 1 is a no-op, bad lengths and mismatched arrays throw `RangeError`. (Req 1)
  - [x] 3.2 `fftSizeFor` gives 1024, 2048, 2048, 4096 and `windowLengthFor` gives 320, 882, 960, 1920 at 16000, 44100, 48000, 96000 Hz. `melFilterbank` has 26 rows and no weight above `min(8000, 0.45 x rate)` at 16000 and 48000 Hz. (Req 2.1, 3.1)
  - [x] 3.3 Vector has length 32 with all values finite for 0 samples, 1 sample, 5 ms of noise and 1 s of zeros. The input array is not modified. (Req 3.3, 3.5, 4.1, 4.3, 4.9)
  - [x] 3.4 Direction checks: `high` centroid feature is larger than `low`; `ring` decay feature is larger than `high`; the four classes give distinct vectors. (Req 5)
  - [x] 3.5 ZCR is per second: a 1 kHz sine gives the same feature at 16000, 48000 and 96000 Hz. (Req 4.8)
  - [x] 3.6 Attack with a quiet head, decay with no 20 dB drop (steady tone returns the remaining length), band ratios add up to 1 and to 0 for silence. (Req 4.4, 4.6, 4.7)
  - [x] 3.7 Resampler check: a 1 kHz sine at 96000 Hz resampled to 44100 and 48000 Hz keeps frequency and amplitude within 2%. (Req 6.4)
  - [x] 3.8 Level test: the four classes at -20 dB and 0 dB (same seed) differ by at most 5% of range in every dimension, with "range" as defined in Req 6.1 (max minus min over the 8 vectors, floor 0.01). The failure message names class, dimension, difference and limit. (Req 6.1, 6.3)
  - [x] 3.9 Rate test: each class is synthesised once at 96000 Hz, resampled to 44100 and 48000 Hz, and the vectors differ by at most 5% of range in every dimension, with the same range definition over the 8 vectors. (Req 6.1, 6.2)
  - [x] 3.10 `sampleRate` 0, negative, NaN and Infinity throw `RangeError` naming the parameter. (Req 7.4)
  - [x] 3.11 Run the features test file and confirm FAIL (modules missing).

- [x] 4. Implement `core/dsp/fft.ts`
  - [x] 4.1 Input checks, bit-reversal permutation, radix-2 butterflies with per-stage twiddles. (Req 1)
  - [x] 4.2 Run the FFT tests and confirm PASS.

- [x] 5. Implement `core/dsp/mfcc.ts`
  - [x] 5.1 `fftSizeFor`, mel conversion, `melFilterbank` with the 100 Hz to `min(8000, 0.45 x rate)` range. (Req 2.1, 2.4, 3.1)
  - [x] 5.2 `mfccFromPower` with floored log energies and the DCT-II, returning c1..c12 only. (Req 2.2, 2.3)
  - [x] 5.3 Run the mel and size tests and confirm PASS.

- [x] 6. Implement `core/features.ts`
  - [x] 6.1 Peak-normalized copy, zero-padding to one frame, complete frames only, Hann window. (Req 3, 4.3)
  - [x] 6.2 MFCC mean and std, summed power spectrum, centroid and band ratios. (Req 4.2, 4.4)
  - [x] 6.3 Frame energy in dB, attack, decay, ZCR per second. (Req 4.5 to 4.8)
  - [x] 6.4 Assemble the 32-value vector in the specified order, re-export `FEATURE_LENGTH`, check the sample rate. (Req 4.1, 4.2, 4.9, 7.4)
  - [x] 6.5 Run the full features test file and confirm PASS. If the rate test fails, fix the feature code, not the 5% bound or the floor.

- [x] 7. Verify and commit
  - [x] 7.1 Run the full test suite and the TypeScript check. Both pass, including Tasks 1 and 2.
  - [x] 7.2 Check that the three new `core/` files import no `fs`, `path`, DOM or Web Audio API, use no `Math.random`, and hard-code no sample counts or tuning values. (Req 7.1 to 7.3)
  - [x] 7.3 Confirm no Korean text in tracked files.
  - [x] 7.4 Add a line to `docs/devlog.md`.
  - [x] 7.5 Commit with the message `feat: add FFT, MFCC and segment features`.

