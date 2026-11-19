# Requirements: Task 2, Deterministic sound synthesis for tests

## Introduction
Task 2 adds `core/synth.ts`. It builds test sounds from a seed and parameters, so the same call always returns the same samples. Later tests use these sounds as "taught sounds" and as inputs, because the project has no recordings yet. The module is pure TypeScript with no dependencies and no I/O.

Later property-based tests that depend on it (design section 8.6):

| Property | What it uses from this task |
|---|---|
| P1 count preservation | `synthImpact` at gains from -20 to +6 dB, `synthNoise` as background at SNR 15 dB or more, `place` for gaps of 100-600 ms |
| P2 silence and noise | `synthNoise` white and pink at -60 to -20 dB |
| P4 sample-rate invariance | `synthImpact`, `synthTone`, `place`, called at one high rate (96000 Hz) and then resampled by the test |
| P6 self-consistency | `SYNTH_CLASSES` (2 to 4 distinct sounds), `rng` for example variation |
| P7 unknown sound | `synthTone` (sustained, harmonic) against a model trained only on impacts |

## Requirements

### Requirement 1: Seeded random numbers
**User story:** As a test author, I want a seeded random source, so that failures are reproducible.

#### Acceptance Criteria
1. THE `rng(seed)` function SHALL return a function that implements mulberry32 and returns numbers in [0, 1).
2. WHEN two generators are created with the same seed, THE system SHALL return the same sequence from both.
3. WHEN two generators are created with different seeds, THE system SHALL return different sequences (first 8 values differ for seeds 1 and 2).

### Requirement 2: Impact sounds
**User story:** As a test author, I want a short knock-like sound with controlled spectrum and decay, so that I can make distinct sound classes.

#### Acceptance Criteria
1. WHEN `synthImpact` is called with `centerHz`, `bandwidthHz`, `decayMs`, `durationMs`, `gainDb`, a sample rate, and a random function, THE system SHALL return a `Float32Array` of `round(durationMs x sampleRate / 1000)` samples.
2. THE system SHALL build the sound from white noise limited to the band around `centerHz` and multiply it by an amplitude envelope `exp(-t / decayMs)`, where `decayMs` is the amplitude time constant.
3. WHEN `synthImpact` is called twice with equal parameters and equal-seeded random functions, THE system SHALL return identical arrays.
4. THE peak absolute sample of the result SHALL be within 1 dB of `gainDb` (dB relative to full scale 1.0).
5. WHEN `durationMs` is at least 3 x `decayMs`, THE system SHALL produce a signal whose level at `3 x decayMs` after onset is at least 20 dB below the peak.
6. THE system SHALL apply a linear fade-out over the last `SYNTH_FADE_OUT_MS` (10 ms), so that the last sample is 0.
7. WHEN a 400 ms impact is generated for the `ring` class, THE last 10 ms SHALL fade to 0 (no click at the cut).

### Requirement 3: Tones
**User story:** As a test author, I want a sustained harmonic tone, so that P7 can check that a non-impact sound is rejected.

#### Acceptance Criteria
1. WHEN `synthTone` is called with `f0Hz`, `durationMs`, `gainDb` and a sample rate, THE system SHALL return a `Float32Array` of `round(durationMs x sampleRate / 1000)` samples containing the fundamental plus 3 harmonics with amplitudes 1/2, 1/3 and 1/4 of the fundamental.
2. THE strongest spectral peak of the result SHALL be at `f0Hz` within 5 Hz.
3. THE peak absolute sample of the result SHALL be within 1 dB of `gainDb`.
4. THE system SHALL apply the same 10 ms linear fade-out as in Requirement 2.6.
5. WHERE `vibratoCents` is given, THE system SHALL modulate the frequency by that peak deviation. WHERE `glideToHz` is given, THE system SHALL move the frequency linearly from `f0Hz` to `glideToHz` over the duration.
6. THE system SHALL NOT need a random function, and two calls with equal parameters SHALL return identical arrays.

### Requirement 4: Noise
**User story:** As a test author, I want white and pink noise at a chosen level, so that P1 and P2 can build backgrounds.

#### Acceptance Criteria
1. WHEN `synthNoise` is called with `'white'` or `'pink'`, a duration, `gainDb`, a sample rate, and a random function, THE system SHALL return `round(durationMs x sampleRate / 1000)` samples.
2. THE RMS level of the result SHALL be within 0.5 dB of `gainDb` (dBFS).
3. WHEN the kind is `'white'`, THE system SHALL return noise whose power per octave rises by about 3 dB per octave. WHEN the kind is `'pink'`, THE system SHALL return noise whose power per octave is within 2 dB of flat across 100 Hz to 8 kHz (test with band energies from DFT or a long average).
4. WHEN called twice with equal-seeded random functions, THE system SHALL return identical arrays.

### Requirement 5: Placement
**User story:** As a test author, I want to put clips at times on a timeline, so that I can build sequences with exact gaps.

#### Acceptance Criteria
1. WHEN `place` receives clips with `atMs`, `totalMs`, and a sample rate, THE system SHALL return a `Float32Array` of `round(totalMs x sampleRate / 1000)` zeros with each clip added starting at sample `round(atMs x sampleRate / 1000)`.
2. WHEN clips overlap, THE system SHALL add them sample by sample without clipping or scaling.
3. WHEN a clip runs past the end, THE system SHALL cut it at the end and SHALL NOT throw.
4. IF a clip has a negative `atMs`, THEN THE system SHALL throw a `RangeError`.

### Requirement 6: Sound classes for property tests
**User story:** As a test author, I want four distinct impact sounds ready to use, so that P1, P6 and P7 do not each invent their own.

#### Acceptance Criteria
1. THE `SYNTH_CLASSES` object SHALL contain `low` (300 Hz, decay 120 ms), `mid` (1200 Hz, 60 ms), `high` (3500 Hz, 25 ms) and `ring` (2000 Hz, 200 ms).
2. FOR every class, THE `bandwidthHz` SHALL equal 50% of `centerHz`.
3. FOR every class, THE `durationMs` SHALL equal `min(3 x decayMs, 400)`, so that `low` = 360, `mid` = 180, `high` = 75 and `ring` = 400.
4. EACH class SHALL be usable as the parameters of `synthImpact` after adding a `gainDb`.

### Requirement 7: Input checks and layer rule
**User story:** As a maintainer, I want misuse to fail loudly and `core/` to stay portable.

#### Acceptance Criteria
1. IF `durationMs`, `decayMs`, `bandwidthHz` or `sampleRate` is not a positive finite number, or `centerHz` or `f0Hz` is not below the Nyquist frequency, THEN THE system SHALL throw a `RangeError` that names the parameter.
2. THE `core/synth.ts` file SHALL NOT import `fs`, `path`, DOM or Web Audio APIs, and SHALL have no runtime dependencies.
3. THE system SHALL NOT call `Math.random` or read the clock, so output depends only on arguments and the random function.
4. THE synthesis values (fade length, maximum duration, bandwidth fraction, duration multiple, harmonic count, vibrato rate) SHALL come from named constants in `core/constants.ts`, and `core/synth.ts` SHALL NOT hard-code them or any sample count.
