# Requirements: Task 6, Hum pitch tracker (YIN)

## Introduction
Task 6 builds the continuous path of the engine: `PitchTracker` follows the pitch of a hum and `medianPitchHz` finds the comfortable pitch of a recording. It then replaces the no-op tracker in `createEngine`, turns on the hum tests that Task 8 left as `test.todo`, and makes the rule "a segment that overlaps a voiced range is not classified" live. The hum folder of `teachFromDir` sets `model.pitch.baselineHz`.

Design 5.4 gives the idea: lower the signal to 8 kHz, run YIN, and report a pitch only where the sound is periodic, between 80 and 400 Hz, low in energy above 1 kHz and loud enough. The matcher (Task 7) turns the pitch events into `hum.rise` and `hum.fall`. The matcher acts on `update` events only, so a `start` event never fires a pattern. This task does not change that.

| Consumer | What it uses from this task |
|---|---|
| Task 8 engine | `PitchTracker` through the existing `ContinuousTracker` socket. Only the private `createTracker` function of `core/engine.ts` changes |
| Task 8 `teachFromDir` | `medianPitchHz` for the `hum` folder. The `hum-folder-ignored` warning goes away |
| Task 7 matcher | `continuous` events with `phase: 'update'` and `value` in Hz, with `sounds.pitch.baselineHz` |
| Review item 12 | Evidence that the synthetic `low` class (300 Hz centre, 150 Hz band, 360 ms) is not taken for a hum, at any gain |
| Experiment E5 (required) | Real recordings of hum and speech decide the final constants. This task only makes the knobs |
| P1, P1b (Task 8) | They run with the real tracker from now on and must keep their rates |
| P9 | Glide direction, `test/pitch.test.ts` |

## Requirements

### Requirement 1: Construction and public surface
**User story:** As the author of the engine, I want a tracker that fits the existing socket, so that wiring it changes one function.

#### Acceptance Criteria
1. THE file `core/continuous/pitch.ts` SHALL export `PitchTracker` and `medianPitchHz`. `PitchTracker` SHALL implement `ContinuousTracker` of `core/continuous/tracker.ts` unchanged: `push(chunk)` and `flush()` return `PitchEvent[]`, and `voicedRanges()` returns `{ start: number; end: number | null }[]` in seconds.
2. THE constructor SHALL take the sample rate. IF it is not finite, or is below `SAMPLE_RATE_MIN_HZ` or above `SAMPLE_RATE_MAX_HZ`, THEN it SHALL throw a `RangeError` that names `sampleRate` and the allowed range. `medianPitchHz` SHALL apply the same check.
3. THE tracker SHALL NOT keep or modify a pushed chunk, and SHALL ignore an empty chunk.
4. THE tracker and `medianPitchHz` SHALL NOT be exported from `core/index.ts`. `node/teach.ts` imports `medianPitchHz` from `core/continuous/pitch` directly, as it already imports other core modules.
5. FILES under `core/` SHALL NOT import `fs`, `path`, `node:` modules, DOM or Web Audio APIs, and SHALL NOT use a clock or `Math.random`.

### Requirement 2: Analysis stream and hop grid
**User story:** As a developer, I want the pitch of a 48 kHz recording to cost little, and the same result for any chunk size.

#### Acceptance Criteria
1. THE tracker SHALL lower the input to `PITCH_ANALYSIS_RATE_HZ` (8000 Hz) in two steps: a 2nd-order IIR low-pass at `PITCH_LOWPASS_HZ` (3400 Hz) at the original rate, then linear interpolation at the 8000 Hz output positions. The filter state SHALL carry over between chunks.
2. THE position of output sample `j` in the input SHALL be computed from `j`, the input rate and the output rate with integer arithmetic (whole part and exact fraction), never by adding a rounded step. THE result SHALL NOT drift for rates that are not a multiple of 8000 (for example 44100 Hz).
3. THE tracker SHALL work in hops of `PITCH_HOP_MS` (10 ms). Hop `h` (counted from 1) SHALL end at the input sample count `b(h) = round(h x sampleRate x PITCH_HOP_MS / 1000)`, computed from `h` and not by adding a rounded hop length. THE time of hop `h` SHALL be `b(h) / sampleRate` in seconds. A hop SHALL be analysed as soon as `b(h)` samples have arrived, and not before.
4. THE analysis window SHALL end at the hop and last `YIN_WINDOW_MS` (40 ms), which is `YIN_WINDOW_MS / PITCH_HOP_MS` hops. THE first window SHALL be analysed after those hops have arrived. A partial hop at the end of the input SHALL NOT be analysed, also not by `flush()`.
5. EVERY sample count (hop, window, lag limits) SHALL be derived from a sample rate and a constant in ms or Hz. NO sample count SHALL be written as a number.

### Requirement 3: YIN
**User story:** As a developer, I want a fundamental frequency with enough precision to compare it with the baseline within a 2 semitone dead zone.

#### Acceptance Criteria
1. THE tracker SHALL compute the difference function over the 8 kHz window, the cumulative mean normalized difference, and the absolute threshold `YIN_THRESHOLD` (0.15). THE search SHALL start at the lag of `PITCH_MAX_HZ` (400 Hz) and end at the lag of `PITCH_MIN_HZ` (80 Hz), both derived from the analysis rate. THE integration length SHALL be the window length minus one lag beyond the longest lag (the extra lag is for interpolation).
2. THE chosen lag SHALL be the first lag whose normalized difference is under the threshold, followed down to the local minimum. IF no lag is under the threshold, THEN the hop SHALL be unvoiced for periodicity. THE tracker SHALL NOT fall back to the global minimum.
3. THE tracker SHALL refine the lag by parabolic interpolation over its two neighbours, and SHALL report `f0 = PITCH_ANALYSIS_RATE_HZ / refined lag`. WITHOUT this step a 400 Hz tone would be off by up to 10 Hz at 8 kHz.
4. A window of digital silence SHALL be unvoiced and SHALL NOT divide by zero.

### Requirement 4: Voiced decision per hop
**User story:** As a user, I want only a steady, low, loud, periodic sound to count as a hum.

#### Acceptance Criteria
1. A hop SHALL be a **candidate** WHEN all of these hold: (a) the window level, the RMS of the last `YIN_WINDOW_MS` of the original-rate signal in dBFS, is at least `PITCH_MIN_LEVEL_DBFS` (-50 dBFS); an all-zero window counts as `SILENCE_LEVEL_DBFS`; (b) the energy above `PITCH_HIGH_BAND_MIN_HZ` (1000 Hz), measured at the original rate with a 2nd-order high-pass and divided by the total energy of the same window, is below `PITCH_HIGH_ENERGY_RATIO_MAX` (0.2); (c) YIN gives an `f0` from `PITCH_MIN_HZ` (80 Hz) to `PITCH_MAX_HZ` (400 Hz).
2. THE tracker SHALL check (a) and (b) before YIN and SHALL skip YIN when either fails.
3. **Pitch stability (chosen fix for review item 12, also the first knob of E5).** A candidate hop SHALL be **voiced** only when the previous hop was not a candidate, or the pitch changed from the previous candidate by at most `PITCH_MAX_STEP_SEMITONES` (1 semitone per hop of 10 ms). THE change in semitones SHALL be 12 x log2 of the ratio of the two `f0` values. An unstable hop SHALL be unvoiced, and SHALL still be the reference for the next hop.
4. A step limit of 1 semitone per hop SHALL still let a glide through. THE fastest glide of P9 (Requirement 13) changes by less than half of the limit per hop.
5. THE filters of 4.1 SHALL carry their state over between chunks. THE energy and level sums SHALL be built per hop in sample order, so that the result does not depend on the chunking.

### Requirement 5: Hum state machine and events
**User story:** As an app developer, I want one `start`, a stream of `update` events, and one `end` for each hum.

#### Acceptance Criteria
1. WHILE no hum is active, THE tracker SHALL count consecutive voiced hops. A hop that is not voiced SHALL reset the count to zero. WHEN the count reaches `HUM_START_VOICED_MS / PITCH_HOP_MS` (120 ms, 12 hops, rounded up), THE tracker SHALL emit `{ kind: 'continuous', name: 'pitch', phase: 'start', t, value }` with the time and `f0` of that hop.
2. WHILE a hum is active, THE tracker SHALL emit one `update` for every voiced hop, with the time and `f0` of that hop. A hop that is not voiced SHALL emit nothing.
3. WHILE a hum is active, THE tracker SHALL count consecutive hops that are not voiced. A voiced hop SHALL reset that count. WHEN the count reaches `HUM_END_UNVOICED_MS / PITCH_HOP_MS` (60 ms, 6 hops, rounded up), THE tracker SHALL emit an `end` event and the hum SHALL become inactive.
4. THE `end` event SHALL carry the time of the hop that reached the count (the time the end is known), and the `value` of the last voiced hop. Event times SHALL NOT decrease within one run.
5. `flush()` SHALL, when a hum is active, emit an `end` at the time of the last analysed hop with the last voiced `value`, and close the open range with the same time. IT SHALL clear both counts and the previous-candidate reference. The filter and resampler state SHALL stay, so that `push` after `flush` continues the same timeline.
6. A voiced run shorter than `HUM_START_VOICED_MS` SHALL give no event and no range.
7. THE `value` of every event SHALL be a finite number from `PITCH_MIN_HZ` to `PITCH_MAX_HZ`.

### Requirement 6: voicedRanges
**User story:** As the author of the engine, I want to know which time spans belong to a hum, including the spans the segmenter closes late.

#### Acceptance Criteria
1. WHEN a `start` event is emitted, THE tracker SHALL open a range whose `start` is the **start of the analysis window of the first hop of the voiced run** that reached the count (the voicing onset), and not the time of the `start` event. `end` SHALL be null while the hum is active.
2. WHEN an `end` event is emitted, THE tracker SHALL close the range with `end` equal to the time of that event (Requirement 5.4). **Why:** an impact that interrupts a hum raises the energy above 1 kHz and makes the hops unvoiced. If the range ended at the last voiced hop, it would end at the onset of the impact, and the impact segment (which starts `ONSET_LEAD_MS` before its onset hop) could fall just outside. The `HUM_END_UNVOICED_MS` hang time keeps the impact inside the range.
3. THE list SHALL be in time order and hold only hums that reached `start`. IT SHALL be a copy: changing the returned array SHALL NOT change the tracker.
4. THE range list is not pruned in this task. A range is two numbers, and a session of hours with thousands of hums stays small. **Known limit:** an app that runs for days would need a history limit.

### Requirement 7: Chunk invariance and speed
**User story:** As a developer, I want a file run and a microphone run to give the same answer, quickly.

#### Acceptance Criteria
1. FOR any chunking of the same samples, THE events, their times and values, and `voicedRanges()` SHALL be equal. THE test SHALL use chunks of 1 sample, one hop, 441, 4096 and 50000 samples, at 16000, 44100 and 48000 Hz, and a property over random lists of chunk sizes.
2. THE tracker SHALL process 60 s of 48 kHz audio in under 3 s (the `corpus-score` hook budget is `CORPUS_SCORE_BUDGET_MS`). THE test SHALL measure the time of the `push` and `flush` calls only, not the synthesis.
3. THE analysis cost SHALL NOT grow with the length of the input except through the range list (Requirement 6.4).

### Requirement 8: medianPitchHz
**User story:** As a developer who teaches the baseline, I want the typical pitch of a recording of a comfortable hum.

#### Acceptance Criteria
1. THE `medianPitchHz(samples, sampleRate)` function SHALL run the same analysis as `PitchTracker`, and return the median of the `f0` of every voiced hop that lies inside a hum, from the first hop of the voiced run (before the `start` event) to the last voiced hop. WITH an even count, the median SHALL be the mean of the two middle values.
2. IT SHALL return `null` WHEN the recording has no hum (no run reached `HUM_START_VOICED_MS`), including an empty or silent recording.
3. A 220 Hz tone SHALL give 220 Hz within 3 Hz.
4. THE function SHALL give the same value for the whole buffer as for the same samples pushed in any chunking to a tracker (the same hops are used).

### Requirement 9: Review item 12, impacts are not hums
**User story:** As a developer, I want a sharp sound never to be taken for a hum, because that would remove the impact from classification and break P1.

#### Acceptance Criteria
1. FOR every synthetic impact class of `SYNTH_CLASSES` (`low`, `mid`, `high`, `ring`), every integer gain from -20 dB to +6 dB, and white noise at 20 dB signal-to-noise ratio (measured as in Task 8 Requirement 15.3), THE tracker SHALL emit no event and keep no range. The test SHALL use a fixed sweep at 48000 Hz with two seeds, and a property over the sample rate (16000, 44100, 48000), the class, the gain, the seed and 1 to 5 impacts with gaps from 150 to 600 ms. Samples SHALL be clamped to the range -1 to +1 as in Task 8.
2. THE order of the work SHALL be: (a) build the tracker with the rules of Requirements 2 to 6 but without 4.3, (b) run the test of 9.1 and write the result into `design.md` (which classes and gains, if any, gave a `start`, and the smallest margin seen), (c) add 4.3. The stability rule SHALL be added in either outcome, because it is also the E5 knob (Requirement 10).
3. IF the test still fails with `PITCH_MAX_STEP_SEMITONES` at 1, THEN the constant SHALL be lowered once to 0.5 and the test run again. IF it still fails, THEN the implementation SHALL stop and report the counterexample. It SHALL NOT drop the `low` class, weaken the sweep, or turn off the hum path for P1.
4. NOISE alone (white and pink, from -60 dBFS to -20 dBFS, the three sample rates) SHALL give no event (plan test "white noise gives no pitch events").

### Requirement 10: Preparation for E5
**User story:** As the person who records E5, I want to change a constant, not the code.

Experiment E5 (design 11) records 2 minutes of hum and 2 minutes of speech. It passes when speech gives at most one false hum per minute. A speech-like synthetic signal cannot be made convincing: real vowels have formants, jitter, breath noise and an intonation that no short synthesis reproduces. **Real recordings decide.** This task does not claim to meet E5.

#### Acceptance Criteria
1. THE constants that E5 may change SHALL all be in `core/constants.ts`, each with its unit: `HUM_START_VOICED_MS` (120), `HUM_END_UNVOICED_MS` (60), `PITCH_MAX_STEP_SEMITONES` (1, new), `PITCH_HIGH_ENERGY_RATIO_MAX` (0.2), `PITCH_MIN_LEVEL_DBFS` (-50) and `YIN_THRESHOLD` (0.15). Only `PITCH_MAX_STEP_SEMITONES` is new (design 11 names "pitch stability" and "voiced duration" as the E5 remedies). The other five exist already in the Pitch section.
2. NO test SHALL depend on the numeric value of an E5 constant in a way that a retune breaks it. Test durations SHALL be derived from the constants (for example the "short tone" is `HUM_START_VOICED_MS` minus two hops, which is 100 ms today).
3. THE order of remedies for E5 SHALL be written in `design.md`: raise `HUM_START_VOICED_MS`, lower `PITCH_MAX_STEP_SEMITONES`, lower `PITCH_HIGH_ENERGY_RATIO_MAX`, raise `PITCH_MIN_LEVEL_DBFS`, lower `YIN_THRESHOLD`. IF none of them reaches the E5 criterion, THEN the design 11 fallback applies (hum scroll needs an explicit listen on and off switch in the app).
4. THE test file SHALL hold `test.todo` entries for the E5 criterion: speech recordings give at most one `start` per minute, and hum recordings give a `start` within 0.5 s for at least 90 % of the hums. These need real recordings and SHALL NOT be replaced by a synthetic test.

### Requirement 11: Engine wiring
**User story:** As an app developer, I want a hum to move `hum.rise` and `hum.fall`, and I want a hum not to be taken for a sound.

#### Acceptance Criteria
1. THE private `createTracker` of `core/engine.ts` SHALL return `new PitchTracker(sampleRate)`. NO other engine rule SHALL change (Task 8 Requirement 7.2). THE tracker SHALL stay out of `EngineOptions` and `core/index.ts`.
2. THE engine SHALL run the tracker in every engine, also when no `hum.*` pattern is used. **Why:** the rule of 11.3 protects every app from classifying its users' humming.
3. A segment that overlaps a range of `tracker.voicedRanges()` SHALL NOT be classified: no event and no `unknown` (Task 8 Requirement 2.2). A range with `end` null lasts until the current time. THE rule SHALL be tested with the real tracker.
4. THE following `test.todo` entries of `test/engine.test.ts` SHALL become tests with the same titles: `an impact during an active hum is not classified`, `hum.rise fires through the engine for a rising hum`, `P1 with a hum before the impacts`, `the low class is not taken for a hum (review item 12)`.
5. THE test for the first entry SHALL put a `mid` impact into a steady 200 Hz hum of at least 2 s, with the impact at least 1 s after the hum starts. IT SHALL get no sound event and no `unknown` for the impact, and no sound event for the hum itself.
6. THE test for `hum.rise` SHALL use a model with `pitch.baselineHz` of 150 Hz and the patterns `hum.rise` and `hum.fall`. A glide from 150 Hz up to 300 Hz SHALL fire `hum.rise` at least once, with `speed` above 0 and at most `HUM_SPEED_MAX_SEMITONES`, and never `hum.fall`. A glide down from 150 Hz to 100 Hz SHALL fire `hum.fall` and never `hum.rise`. A steady 150 Hz hum, and one with 50 cents of vibrato, SHALL fire neither (dead zone `HUM_DEADZONE_SEMITONES`).
7. THE test "P1 with a hum before the impacts" SHALL use the cases, classes (`mid`, `high`), gap range, gain range, SNR range, seeds-from-`rng` method and acceptance rule of P1 (Task 8 Requirement 15.7), and add before the first impact a 150 Hz to 350 Hz hum of 1 to 2 s with a gain from -12 dB to 0 dB, followed by at least 600 ms of noise only. THE hum SHALL add no event, and `runSamples` SHALL return no `continuous` event for an impact.
8. THE test "the low class is not taken for a hum (review item 12)" SHALL run one `low` impact at every integer gain from -20 dB to +6 dB, with 4 fixed seeds each (108 cases), with 20 dB SNR noise, through `runSamples` at 44100 Hz. It SHALL expect exactly one event with the label `low` in at least 98 % of the cases (the classifier is statistical, Task 8 Requirement 15.8), no `continuous` event in any case, and no wrong label. A miss SHALL be explained by an `unknown`. (The tracker-level test of Requirement 9 is the strict one, because it does not involve the classifier.)
9. THE existing P1 and P1b tests SHALL run unchanged with the real tracker and SHALL meet their acceptance rule of 98 % exact, no over-count, no wrong label. IF they do not, THEN the cause SHALL be found and recorded in `design.md`. The properties, the ranges and the rate SHALL NOT be loosened.
10. **Known limit.** A segment that closes before its hum is confirmed (a click in the first `HUM_START_VOICED_MS` of a hum) is classified, because no range exists yet. THE limit SHALL be stated in `design.md`.

### Requirement 12: The hum folder of teachFromDir
**User story:** As a developer, I want to teach the baseline pitch from a folder of hums.

#### Acceptance Criteria
1. FOR a folder named `hum`, THE function SHALL read every `.wav` file in code-unit order with `readWavFile` (with the same wrapped error as other files), compute `medianPitchHz` for each file, and set `model.pitch = { baselineHz }` AFTER training, where `baselineHz` is the median of the per-file values that are not null. WITH an even count it SHALL be the mean of the two middle values.
2. THE `hum` folder SHALL NOT be a label: it SHALL NOT count toward `MIN_EXAMPLES_PER_LABEL`, appear in `report.labels` or `confusedPairs`, or give calibration warnings. THE segmenter SHALL NOT run on its files.
3. FOR a file in the `hum` folder with no hum (`null`), THE report SHALL hold a warning with the new code `no-pitch-found`, the relative path in `file`, and a message that asks for a steady hum of at least 2 s. WHEN the folder holds no usable file, `model.pitch` SHALL be undefined and the folder SHALL be named in a `no-pitch-found` warning with `file` equal to `hum`.
4. THE warning code `hum-folder-ignored` SHALL be removed from `TeachWarning`, and every use of it (code, tests, MCP text, docs) SHALL be updated. THE other three codes and the sort order of Task 8 Requirement 11.6 SHALL stay.
5. THE model SHALL hold the baseline only. NO sample of a hum file SHALL be stored in the model or written anywhere, and no audio SHALL leave the machine (privacy rule).
6. THE test `the hum folder sets pitch.baselineHz near the tone frequency` SHALL become a test: a `hum` folder with two files (200 Hz and 210 Hz tones of 2 s) next to two impact classes gives `model.pitch.baselineHz` within 3 Hz of 205 Hz, no warning, and no `hum` label. A second test SHALL give a `hum` file of noise and expect the `no-pitch-found` warning and no `model.pitch`. A third test SHALL build an engine from the taught model with the pattern `hum.rise` and expect no error (the matcher needs `baselineHz`).
7. THE test `skips the hum folder with a warning` of Task 8 SHALL be replaced by the tests of 12.6, because the behaviour it checked is gone by design (Task 8 Requirement 10.2).

### Requirement 13: P9 glide direction and the quick property script
**User story:** As a developer, I want a property that a rising hum is reported as rising.

#### Acceptance Criteria
1. THE property P9 SHALL run with `test.prop` of `@fast-check/vitest`. IT SHALL NOT set `numRuns`: the run count comes from `PBT_RUNS` in `test/setup.ts`.
2. THE input SHALL be a tone from `synthTone` of `P9_GLIDE_MS` (1500 ms) that glides from `f0` to `f1`, with `f0` and `f1` integers in the range 100 to 350 Hz and `|f1 - f0| >= 30 Hz`, vibrato from 0 to 30 cents, and the sample rate from 16000, 44100 and 48000 Hz.
3. THE assertion SHALL be: the tracker reports a `start`; the mean of the last quarter of the reported values (the `start` and the `update` events) is above the mean of the first quarter when `f1 > f0`, and below it when `f1 < f0`; and the difference is at least `P9_MIN_TRACKED_FRACTION` (0.3) of `|f1 - f0|`. THE failure message SHALL show `f0`, `f1`, the vibrato, the sample rate and both means.
4. THE property "P3 chunk invariance (pitch)" of Requirement 7.1 SHALL run under the same rules.
5. THE script `scripts/pbt-quick.ts` SHALL list `test/pitch.test.ts` as a candidate, so that `pbt:quick` runs the pitch properties. THE hook triggers of `.kiro/hooks` are not changed by this task.

### Requirement 14: Constants, layers, privacy and finished modules
**User story:** As a maintainer, I want the rules of the project kept.

#### Acceptance Criteria
1. EVERY threshold and time constant SHALL be a named constant with its unit in `core/constants.ts`. THIS task SHALL add `PITCH_MAX_STEP_SEMITONES` (1) and `PITCH_FILTER_Q` (the unitless quality factor of the two 2nd-order filters, 1 / square root of 2, a Butterworth response). THE constants of the Pitch section that exist already SHALL NOT change value.
2. EVERY time `t` SHALL be a cumulative sample count divided by the sample rate, in seconds. Unit conversion factors (1000 ms per second, 12 semitones per octave) SHALL be file-local named constants, as in `core/synth.ts` and `core/grammar.ts`.
3. NO code of this task SHALL send audio over the network, store samples in a model, or write recordings. Original recordings stay in the local `sounds/` folders.
4. THE finished modules SHALL change only as follows: `core/engine.ts` (the body of `createTracker` and its import), `node/teach.ts` (the hum folder and the warning code), `core/constants.ts` (the two constants), `scripts/pbt-quick.ts` (one candidate), and the tests named in Requirements 11, 12 and 13. THE tests of Tasks 1 to 5, 7 and 8 SHALL still pass, apart from the one replaced test of 12.7.
5. `docs/devlog.md` SHALL get a line with the review item 12 result, the P1 and P1b rates, the speed of the 60 s test, and the E5 status ("not run, needs real recordings").
