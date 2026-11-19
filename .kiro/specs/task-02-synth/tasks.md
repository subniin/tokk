# Tasks: Task 2, Deterministic sound synthesis for tests

Order is test-first. Do not write `core/synth.ts` before the tests fail.

- [x] 1. Add synthesis constants
  - [x] 1.1 In the Synthesis section of `core/constants.ts`, add `SYNTH_BANDWIDTH_FRACTION` (0.5), `SYNTH_DURATION_DECAY_MULTIPLE` (3), `SYNTH_TONE_HARMONICS` (3) and `SYNTH_VIBRATO_RATE_HZ` (5), as listed in `design.md`. (Req 7.4)
  - [x] 1.2 Confirm `SYNTH_FADE_OUT_MS` (10) and `SYNTH_MAX_DURATION_MS` (400) already exist and are unchanged.

- [x] 2. Write failing tests in `test/synth.test.ts`
  - [x] 2.1 `rng`: same seed gives the same sequence, different seeds differ, values are in [0, 1), and the first values for one fixed seed match a recorded list. (Req 1)
  - [x] 2.2 Same seed gives identical output for `synthImpact`, white `synthNoise` and pink `synthNoise`. (Req 2.3, 4.4)
  - [x] 2.3 `synthImpact` peak level matches `gainDb` within 1 dB at -20, 0 and +6 dB. (Req 2.4)
  - [x] 2.4 `synthImpact` level at `3 x decayMs` after onset is at least 20 dB below peak for `low`, `mid` and `high`. (Req 2.5)
  - [x] 2.5 `synthTone` has its strongest spectral peak at `f0Hz` within 5 Hz, using a few directly computed DFT bins (no FFT exists yet). Harmonics are near 1/2, 1/3, 1/4. (Req 3.1, 3.2)
  - [x] 2.6 `synthTone` peak matches `gainDb`; glide and vibrato calls return the right length and no NaN. (Req 3.3, 3.5)
  - [x] 2.7 The last 10 ms of a 400 ms `ring` impact fade to 0, and the same holds for a tone. (Req 2.6, 2.7, 3.4)
  - [x] 2.8 `synthNoise` RMS matches `gainDb` within 0.5 dB; pink is within 2 dB of flat per octave band, white rises about 3 dB per octave. (Req 4.2, 4.3)
  - [x] 2.9 Sample counts equal `round(durationMs x rate / 1000)` at 16000, 44100, 48000 and 96000 Hz. (Req 2.1, 3.1, 4.1)
  - [x] 2.10 `place` puts a clip at `atMs`, sums overlaps, cuts at the end, and rejects negative `atMs`. (Req 5)
  - [x] 2.11 `SYNTH_CLASSES` has `low`, `mid`, `high`, `ring` with bandwidth 50% of center and `durationMs = min(3 x decayMs, 400)` (360, 180, 75, 400). (Req 6)
  - [x] 2.12 Bad parameters throw `RangeError` naming the parameter. (Req 7.1)
  - [x] 2.13 Run the synth test file and confirm FAIL (module missing).

- [x] 3. Implement `core/synth.ts`
  - [x] 3.1 `rng` (mulberry32). (Req 1)
  - [x] 3.2 Shared helpers: sample count from ms, peak scaling, RMS scaling, fade-out, parameter checks. (Req 7.1)
  - [x] 3.3 `synthImpact` with the band-pass biquad, `exp(-t / decayMs)` envelope, fade-out, and peak scaling. (Req 2)
  - [x] 3.4 `synthTone` with accumulated phase, vibrato, glide, harmonics at 1/n, fade-out, and peak scaling. (Req 3)
  - [x] 3.5 `synthNoise` white and pink (Kellet) with RMS scaling. (Req 4)
  - [x] 3.6 `place`. (Req 5)
  - [x] 3.7 `SYNTH_CLASSES`, built from the constants. (Req 6)
  - [x] 3.8 Run the synth test file and confirm PASS.

- [x] 4. Verify and commit
  - [x] 4.1 Run the full test suite and the TypeScript check. Both pass, including the Task 1 tests.
  - [x] 4.2 Check that `core/synth.ts` imports no `fs`, `path`, DOM or Web Audio API, uses no `Math.random`, and has no hard-coded sample counts or synthesis values. (Req 7.2, 7.3, 7.4)
  - [x] 4.3 Confirm no Korean text in tracked files.
  - [x] 4.4 Add a line to `docs/devlog.md`.
  - [x] 4.5 Commit with the message `feat: add deterministic sound synthesis for tests`.
