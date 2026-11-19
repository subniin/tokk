# Requirements: Task 3, FFT, MFCC and segment features

## Introduction
Task 3 adds `core/dsp/fft.ts`, `core/dsp/mfcc.ts` and `core/features.ts`. `extractFeatures(seg)` turns one `Segment` into a fixed-length vector of 32 numbers. The kNN classifier (Task 5) measures distance between these vectors, so two recordings of the same sound must give nearly the same vector whatever the loudness or the sample rate.

Why the features must be level-independent (design section 5.2): the user knocks harder or softer, and the microphone gain differs between devices. If the vector changed with level, a taught sound would be rejected as `unknown` when it is played louder, and P1 (count preservation across -20 to +6 dB, trained at one gain) would fail. Three things make the vector level-free: the segment is divided by its peak before any feature is computed, `decayMs` uses a relative 20 dB drop, and there is no absolute duration feature (louder knocks ring longer above the noise floor, so duration would leak level into the vector).

The module is pure TypeScript with no dependencies and no I/O.

| Consumer | What it uses from this task |
|---|---|
| Task 5 (kNN) | `extractFeatures`, `FEATURE_LENGTH` |
| Task 9 (spectrogram) | `fft` |
| P1, P4, P6 | Level and sample-rate stability of the vector |

## Requirements

### Requirement 1: FFT
**User story:** As a developer of later DSP code, I want a small in-place FFT, so that features and spectrograms share one implementation.

#### Acceptance Criteria
1. THE `fft(re, im)` function SHALL transform the complex signal held in two `Float64Array`s in place, using radix-2 decimation in time, and SHALL return nothing.
2. WHEN the length is a power of two (including 1), THE system SHALL compute the forward transform with no scaling, `X[k] = sum x[n] exp(-2 pi i k n / N)`.
3. IF `re` and `im` differ in length, or the length is 0 or not a power of two, THEN THE system SHALL throw a `RangeError` that names the problem.
4. WHEN a 1 kHz sine is sampled at 48000 Hz over 1024 samples, THE largest magnitude in bins 0 to N/2 SHALL be the bin nearest 1 kHz.
5. THE result SHALL match a directly computed DFT on a random 64-sample input to within 1e-9.

### Requirement 2: Mel filterbank and MFCC
**User story:** As a developer of the classifier, I want cepstral coefficients that describe spectral shape, so that sounds differ by timbre rather than by level.

#### Acceptance Criteria
1. THE system SHALL build `MEL_FILTER_COUNT` (26) triangular filters spaced evenly on the mel scale between `MEL_MIN_HZ` (100) and `min(MEL_MAX_HZ, MEL_MAX_NYQUIST_FRACTION x sampleRate)` (8000 Hz, or 0.45 x sampleRate when that is lower).
2. THE system SHALL compute `MFCC_COUNT` (13) coefficients per frame as the DCT-II of the log mel energies, and SHALL drop c0, so each frame yields 12 coefficients (c1 to c12).
3. WHEN a frame has no energy, THE system SHALL still return finite coefficients, by flooring each mel energy before the logarithm.
4. THE filterbank SHALL depend only on the FFT size and the sample rate, so it can be built once and reused for all frames of a segment.

### Requirement 3: Framing
**User story:** As a developer, I want frame sizes defined in time, so that the same sound gives similar frames at every sample rate.

#### Acceptance Criteria
1. THE analysis window SHALL be `FEATURE_FRAME_MIN_MS` (20 ms) of samples, rounded to a whole number of samples, so it has the same duration at every rate. THE FFT size SHALL be the smallest power of two that is at least `FEATURE_FFT_WINDOW_MULTIPLE` (2) times the window length, which gives 1024 at 16000 Hz, 2048 at 44100 and 48000 Hz, and 4096 at 96000 Hz. Each window SHALL be zero-padded to the FFT size.
2. THE hop SHALL be `round(FEATURE_HOP_MS x sampleRate / 1000)` samples (10 ms), and each frame SHALL be multiplied by a Hann window of the window length before the FFT.
3. WHEN the segment is shorter than one window (one frame), THE system SHALL zero-pad it at the end to one frame.
4. WHEN the segment is at least one frame long, THE system SHALL use only complete frames, and SHALL NOT pad a partial last frame.
5. WHEN the segment has 0 samples, THE system SHALL treat it as all zeros of one frame.

### Requirement 4: Feature vector
**User story:** As a developer of the classifier, I want one vector layout that everyone agrees on, so that distances compare the same things.

#### Acceptance Criteria
1. THE `FEATURE_LENGTH` constant SHALL be 32, and `extractFeatures(seg)` SHALL return a `number[]` of exactly that length.
2. THE system SHALL fill the vector in this order: indices 0-11 mean of mfcc1..12 over frames; 12-23 standard deviation (population) of mfcc1..12 over frames; 24 `centroidHz / 1000`; 25 `decayMs / 100`; 26 `attackMs / 100`; 27 `zcrPerSecond / 1000`; 28-31 energy ratios of the bands below 500 Hz, 500 to 2000 Hz, 2000 to 5000 Hz, and above 5000 Hz.
3. THE system SHALL copy the input and divide the copy by its peak absolute value before computing any feature, and SHALL NOT change `seg.samples`. WHEN the peak is 0, THE system SHALL use the zeros unchanged.
4. THE spectral centroid and the four band ratios SHALL be computed from the power spectrum summed over all frames. The four ratios SHALL add up to 1 (to within 1e-9), or all be 0 when the segment is silent.
5. THE frame energy used for decay and attack SHALL be the mean square of the unwindowed samples of each frame, converted to dB with a floor at `SILENCE_LEVEL_DBFS`.
6. `decayMs` SHALL be the time from the frame with the largest energy to the first later frame whose energy is at least `DECAY_DROP_DB` (20 dB) below that maximum. WHEN no later frame drops that far, `decayMs` SHALL be the time from the start of the maximum frame to the end of the segment.
7. `attackMs` SHALL be the time from the start of the segment to the start of the frame with the largest energy. WHEN several frames share the maximum, THE system SHALL use the first.
8. `zcrPerSecond` SHALL be the number of sign changes between neighbouring samples divided by the segment length in seconds (not per sample). A sample counts as negative when it is below 0.
9. THE vector SHALL NOT contain an absolute duration, and SHALL NOT contain NaN or infinity for any input, including a 0-sample, a 5 ms or an all-zero segment.
10. THE system SHALL return identical vectors for identical inputs (no randomness, no clock).

### Requirement 5: Behaviour on the synthetic classes
**User story:** As a test author, I want the features to separate the four synth classes in the expected directions.

#### Acceptance Criteria
1. THE `centroidHz / 1000` of `high` SHALL be larger than that of `low`.
2. THE `decayMs / 100` of `ring` SHALL be larger than that of `high`.
3. THE four synth classes SHALL give four vectors that are pairwise different in at least one dimension by more than 5% of that dimension's range (see Requirement 6.1 for "range").

### Requirement 6: Level and sample-rate independence
**User story:** As a user, I want a sound to give the same vector whether I knock softly or hard, and on a 44.1 kHz or a 48 kHz device.

#### Acceptance Criteria
1. THE "dimension range" of dimension `d` over a test set of vectors SHALL be `max(max_d - min_d, RANGE_FLOOR)`, where `max_d` and `min_d` are the largest and smallest values of dimension `d` over the whole set and `RANGE_FLOOR` is 0.01. The floor stops a dimension that is nearly constant across the set from producing an impossible tolerance.
2. WHEN each of the four synth classes is synthesised once at 96000 Hz and then resampled to 44100 Hz and 48000 Hz by the test helper, THE features at the two rates SHALL differ, for every dimension of every class, by at most 5% of that dimension's range. The range is taken over the 8 vectors (4 classes x 2 rates).
3. WHEN the same impact is synthesised with the same seed at -20 dB and at 0 dB, THE features SHALL differ, for every dimension of every class, by at most 5% of that dimension's range. The range is taken over the 8 vectors (4 classes x 2 levels).
4. THE resampler SHALL live in the test helper, not in `core/`.

### Requirement 7: Layer rule and constants
**User story:** As a maintainer, I want `core/` to stay portable and tunable from one file.

#### Acceptance Criteria
1. THE files `core/dsp/fft.ts`, `core/dsp/mfcc.ts` and `core/features.ts` SHALL NOT import `fs`, `path`, DOM or Web Audio APIs, and SHALL have no runtime dependencies.
2. THE system SHALL NOT call `Math.random` or read the clock.
3. THE existing constants `FEATURE_LENGTH`, `FEATURE_FRAME_MIN_MS`, `FEATURE_HOP_MS`, `MEL_FILTER_COUNT`, `MEL_MIN_HZ`, `MEL_MAX_HZ`, `MEL_MAX_NYQUIST_FRACTION`, `MFCC_COUNT`, `DECAY_DROP_DB`, `BAND_EDGES_HZ` and `SILENCE_LEVEL_DBFS` SHALL be used, and any other tuning value this task needs SHALL be a named export of `core/constants.ts`. The files SHALL NOT hard-code sample counts.
4. IF `sampleRate` is not a positive finite number, THEN `extractFeatures` SHALL throw a `RangeError` that names the parameter. The 16000-96000 Hz range check belongs to the engine (Task 8).
