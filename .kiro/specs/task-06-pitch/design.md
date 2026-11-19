# Design: Task 6, Hum pitch tracker (YIN)

## Layer rule
`core/continuous/pitch.ts` is pure TypeScript: no `fs`, `path`, `node:` modules, DOM or Web Audio, no clock, no `Math.random`. `node/teach.ts` may import it from `core/`. Every threshold is in ms, Hz or dB with the unit in its name, and every sample count comes from the sample rate and a constant. Every time `t` is a cumulative sample count divided by the sample rate, in seconds. The factors 1000 (ms per second) and 12 (semitones per octave) are file-local named constants, as in `core/synth.ts` and `core/grammar.ts`.

## Files
| Path | Change | Content |
|---|---|---|
| `core/continuous/pitch.ts` | new | `PitchTracker`, `medianPitchHz` |
| `core/constants.ts` | edit | `PITCH_MAX_STEP_SEMITONES`, `PITCH_FILTER_Q` in the Pitch section |
| `core/engine.ts` | edit | body of the private `createTracker` and one import |
| `node/teach.ts` | edit | `hum` folder, warning code `no-pitch-found`, `hum-folder-ignored` removed |
| `scripts/pbt-quick.ts` | edit | one more candidate file |
| `test/pitch.test.ts` | new | tracker tests, review item 12, P9, P3 (pitch), speed, E5 todo |
| `test/engine.test.ts` | edit | four `test.todo` entries become tests |
| `test/teach.test.ts` | edit | one `test.todo` becomes tests, one test replaced |
| `docs/devlog.md` | edit | one line |

The segmenter, features, classifier, grammar, `core/continuous/tracker.ts` and `core/index.ts` are not touched.

## Constants
Already in `core/constants.ts` and unchanged: `PITCH_ANALYSIS_RATE_HZ` 8000, `PITCH_LOWPASS_HZ` 3400, `YIN_WINDOW_MS` 40, `PITCH_HOP_MS` 10, `YIN_THRESHOLD` 0.15, `PITCH_MIN_HZ` 80, `PITCH_MAX_HZ` 400, `PITCH_HIGH_BAND_MIN_HZ` 1000, `PITCH_HIGH_ENERGY_RATIO_MAX` 0.2, `PITCH_MIN_LEVEL_DBFS` -50, `HUM_START_VOICED_MS` 120, `HUM_END_UNVOICED_MS` 60, `SILENCE_LEVEL_DBFS` -90, `HUM_DEADZONE_SEMITONES` 2, `HUM_SPEED_MAX_SEMITONES` 6.

New:
| Name | Value | Why |
|---|---|---|
| `PITCH_MAX_STEP_SEMITONES` | 1 | Largest pitch change between two consecutive hops (10 ms) of a voiced run. 100 semitones per second is far above a real glide and far below the scatter of a noisy or narrow-band sound. The chosen fix for review item 12 and the first knob for E5 |
| `PITCH_FILTER_Q` | 1 / square root of 2 (about 0.7071), unitless | Quality factor of the 2nd-order low-pass and high-pass. A Butterworth response has no ripple |

Derived inside the tracker, never written as numbers: hop count of the window (`YIN_WINDOW_MS / PITCH_HOP_MS`, 4), start count (`HUM_START_VOICED_MS / PITCH_HOP_MS` rounded up, 12), end count (`HUM_END_UNVOICED_MS / PITCH_HOP_MS` rounded up, 6), 8 kHz samples per hop (80) and per window (320), shortest lag (`PITCH_ANALYSIS_RATE_HZ / PITCH_MAX_HZ`, 20) and longest lag (`PITCH_ANALYSIS_RATE_HZ / PITCH_MIN_HZ`, 100, rounded up).

Test-only constants sit at the top of `test/pitch.test.ts` with units in the names: `P9_GLIDE_MS` 1500, `P9_F_MIN_HZ` 100, `P9_F_MAX_HZ` 350, `P9_MIN_DELTA_HZ` 30, `P9_VIBRATO_MAX_CENTS` 30, `P9_MIN_TRACKED_FRACTION` 0.3, `SWEEP_GAIN_MIN_DB` -20, `SWEEP_GAIN_MAX_DB` 6, `SWEEP_SNR_DB` 20, `SPEED_BUDGET_MS` 3000, `SPEED_AUDIO_S` 60, and the lead and trail lengths.

## Interfaces
`PitchTracker` implements `ContinuousTracker` (Task 8, unchanged).
| Member | Meaning |
|---|---|
| constructor(sampleRate) | `RangeError` outside `SAMPLE_RATE_MIN_HZ` to `SAMPLE_RATE_MAX_HZ` |
| push(chunk) | Returns the pitch events of the hops completed by this chunk, in order |
| flush() | Closes an open hum (Requirement 5.5). Returns its `end` event or nothing |
| voicedRanges() | Copy of the list of hum ranges in seconds, `end` null while active |

`medianPitchHz(samples, sampleRate)` returns Hz or `null`.

A private function (name free) runs the whole analysis over one input and returns, per hop, the time, `f0` and the voiced flag. `PitchTracker` and `medianPitchHz` share it, so that "same hops" in Requirement 8.4 holds by construction. `createTracker(sampleRate)` in `core/engine.ts` returns `new PitchTracker(sampleRate)`.

## Analysis in one hop
State kept between chunks: low-pass filter state, high-pass filter state, the 8 kHz sample ring (one window), the energy blocks of the last window (total energy and high-band energy per hop), the total number of input samples, the next 8 kHz sample index, the hop number, and the hum state (voiced count, unvoiced count, previous-candidate `f0`, range list, first-hop time of the current run).

1. **Filters.** Every input sample passes the low-pass (for the 8 kHz stream) and the high-pass (for the energy ratio). The coefficients come from the sample rate, the cutoff and `PITCH_FILTER_Q` by the standard bilinear 2nd-order forms. The same sample also adds its square to the total energy of the current hop block and the square of its high-passed value to the high-band block. Sums are built in sample order, so they do not depend on the chunking.
2. **Resampling.** Output sample `j` sits at input position `j x sampleRate / 8000`. The whole part and the remainder are computed with integers from `j`, so the position is exact and there is no drift at 44100 Hz. The sample is the linear interpolation of the low-passed input at the whole index and the next one. A rate of at least 16 kHz means the output rate is at most half the input rate, so the next sample needed by the last output sample of hop `h` is already inside the `b(h)` samples of that hop. A hop is therefore analysed exactly when its last input sample arrives.
3. **Hop.** Hop `h` ends at `b(h) = round(h x sampleRate x PITCH_HOP_MS / 1000)` input samples and has time `b(h) / sampleRate`. After the fourth hop the window (hops `h-3` to `h`) is analysed.
4. **Level and ratio.** Level = 10 log10 of the mean of the summed energy over the window, in dBFS (RMS), with an all-zero window at `SILENCE_LEVEL_DBFS`. Ratio = summed high-band energy / summed total energy. If either fails, the hop is not a candidate and YIN is skipped (this is also the speed gain, since most real input is not a hum).
5. **YIN.** On the 320 samples of the 8 kHz window: difference function for lags 1 to one beyond the longest lag, over the integration length (window minus that lag, 219 samples); cumulative mean normalized difference with its first value 1; first lag from the shortest lag with a value under `YIN_THRESHOLD`, followed down while the next value is lower; parabolic interpolation on the three values around it (skipped at the edge of the lag range); `f0 = 8000 / refined lag`. No lag under the threshold means no candidate. `f0` outside 80 to 400 Hz after refinement means no candidate.
6. **Stability.** Compared with the previous hop, if that hop was a candidate: semitone change = 12 x log2(f0 / previous f0). Over `PITCH_MAX_STEP_SEMITONES` means unvoiced. The hop still becomes the previous-candidate reference. If the previous hop was not a candidate, there is nothing to compare and the hop is voiced.
7. **State machine** (Requirement 5), then the range list (Requirement 6).

Cost per hop: 80 8 kHz samples to produce, up to 101 lags over 219 samples, about 22,000 multiply-adds, and only for hops that pass level and ratio. For 60 s that is 6,000 hops, about 130 million operations at the very most, plus 2.9 million input samples through two filters. This is a few hundred milliseconds, which leaves a large margin under the 3 s budget.

### Why the stability rule compares with the previous hop
A voiced run needs 12 hops (120 ms). A narrow-band noise at 300 Hz (the `low` impact) can give an occasional periodic-looking window, but its estimate scatters from hop to hop, so two stable hops in a row are rare and twelve are not expected. A hum drifts by a fraction of a semitone per hop. Comparing with the immediately preceding hop is the simplest rule that keeps a glide and breaks a scatter, and it matches the wording of the plan for review item 12 ("max semitone change between consecutive hops").

Consequence: a single glitch hop (an octave error) costs two hops, because the hop after it is compared with the glitch and also looks unstable. At a 60 ms end count, an active hum survives that.

Margin for glides, from the P9 range: the fastest glide is 250 Hz in 1500 ms from 100 Hz to 350 Hz. At 100 Hz it moves 1.7 Hz per hop, about 0.29 semitone. The limit of 1 has more than 3 times the margin, and a limit of 0.5 (the fallback of Requirement 9.3) has 1.7 times, plus about 0.1 for the estimate error. Vibrato of 50 cents at 5 Hz changes at most 0.16 semitone per hop.

## Events, times and ranges
A `start` event is emitted at the hop that completes the 12th voiced hop. Its `t` is the time of that hop, which is the end of its window, so every event is causal. The `start` event therefore comes 11 hops after the first voiced hop, and 15 hops (150 ms) after the range `start`.

| Time | Value |
|---|---|
| range `start` | Start of the window of the first voiced hop of the run: time of hop `h0 - 4`, where `h0` is that hop (time 0 at the earliest) |
| `start` and `update` `t` | Time of the hop |
| `end` `t` and range `end` | Time of the hop that reached the end count, which is 60 ms after the last voiced hop |
| `end` `value` | `f0` of the last voiced hop |

**Why the range ends at the end event and not at the last voiced hop.** An impact inside a hum adds energy above 1 kHz, the hops become unvoiced, and the hum ends 60 ms after the last voiced hop. That last voiced hop is within one hop of the impact onset. The segmenter starts the impact segment `ONSET_LEAD_MS` (5 ms) before its onset hop. A range that ended at the last voiced hop could therefore end a few ms before the segment starts, and the impact would be classified. With the end at the `end` event, the segment starts 55 ms or more inside the range. The cost is that a sound that starts less than 60 ms after a hum stops is also dropped. This is the same trade as the hang time of any gate and is tunable with `HUM_END_UNVOICED_MS`.

**Why the start is the window start.** The window of the first voiced hop already holds the onset, otherwise it would fail the level or the periodicity test. Its start is therefore at or before the onset and at most about one hop after the segment start (the segment starts 5 ms before its onset hop). Segments are tested by intersection, so the hum's own segment (which opens at its onset and usually stays open to the end of the hum) intersects the range and is dropped. This is the behaviour the plan calls "start back-dated to voicing onset".

**Known limit.** The range exists only after `start` (at least 12 hops after the onset). A segment that closes before that, such as a click in the first 120 ms of a hum, is classified normally. It is at most one segment per hum, the hum onset is a likely place for a plosive, and it is only seen in E5 recordings. Nothing in this task tries to cure it.

**No pruning.** The range list grows by one entry (two numbers) per hum. See Requirement 6.4.

## Engine wiring
`createEngine` is unchanged except through `createTracker`. For one `push` the order of Task 8 stays: the tracker first (its events go to `onEvent` and the matcher, and its matches to the handlers), then the segmenter, with the classification of each closed segment against the ranges from the tracker. `flush` calls `tracker.flush()` first, so that an open range is closed before the last segments are checked.

The matcher acts on `continuous` events with `phase: 'update'` only, so `start` and `end` reach `onEvent` and `runSamples().events` but fire nothing. `hum.rise` and `hum.fall` therefore begin with the first update, one hop after `start`.

The tracker runs in every engine. For an app with sound patterns only this costs well under 5 % of real time (the 3 s per 60 s budget of the speed test is the ceiling, the estimate above is a tenth of it) and protects it from classifying a user's humming. Telling the engine to skip the tracker when no hum is expected would give the rule up, so it is not offered.

**P1 and P1b with the real tracker.** `mid` and `high` have most energy above 1 kHz and fail the ratio test (1200 Hz and 3500 Hz centres). `ring` (2000 Hz centre) fails it too. White noise at 20 dB SNR has no YIN dip under 0.15. The one class that could pass is `low`, which review item 12 names. If the tests of Requirement 9 or the P1b rate fail, the counterexample is evidence about the tracker, and the order of Requirement 9.3 applies.

## medianPitchHz
Shares the hop analysis. It collects the `f0` of every voiced hop that belongs to a run that reached the start count (from its first hop, including the 11 before the `start` event), sorts them, and returns the middle (or the mean of the two middle values). The sort uses numeric order, not string order. No run, no values, `null`.

## teachFromDir, hum folder
In the folder loop, a label `hum` no longer gets a warning. It is read file by file (sorted, errors wrapped with the relative path as for other files), each file gives `medianPitchHz` or `null`, and a `null` gives a `no-pitch-found` warning for `hum/<file>`. After `knnClassifier.train`, `model.pitch = { baselineHz }` is set when at least one value exists. With none (no file, or only `null`), `model.pitch` stays undefined and one `no-pitch-found` warning names the folder `hum` when the folder had no file at all. The folder does not go into `labels` and not into the minimum count check. The report's leave-one-out step reads `model.examples` only, so it does not see the baseline.

`TeachWarning['code']` becomes `'shorter-than-calibration' | 'sound-in-calibration' | 'no-sound-found' | 'no-pitch-found'`. Every file that mentions `hum-folder-ignored` is updated. A search for the string is a task step, because the MCP server and its tests may print or check warning codes.

A model with `pitch` is still a small JSON of numbers: the baseline is one number, with no sample of the recording (privacy rule).

## Testing
`vitest`, `@fast-check/vitest` and the fixed seeds of `rng` from `core/synth.ts`. Property tests use `test.prop` and take the run count from `PBT_RUNS` in `test/setup.ts`.

**`test/pitch.test.ts`**
- Fixed (from the plan): a 2 s 150 Hz tone gives one `start`, updates within 3 Hz of 150 and one `end`; a tone shorter than `HUM_START_VOICED_MS` (derived, 100 ms) gives nothing and no range; white noise gives nothing; each impact class gives nothing; `medianPitchHz` of 220 Hz is 220 within 3 Hz; `medianPitchHz` of silence and of noise is `null`; the range `start` is before the `start` event time by `YIN_WINDOW_MS + HUM_START_VOICED_MS - PITCH_HOP_MS` (150 ms today) and is not after the tone onset by more than one hop; 60 s of 48 kHz audio runs in under 3 s.
- Added: a 150 Hz tone with 50 cents of vibrato starts and ends; two tones 1 s apart give two ranges in order, the first closed and the second open (before `flush`); `flush` closes an open hum with an `end` and `end` of the range equal to the last hop; `push` after `flush` continues the timeline (times keep growing); the constructor and `medianPitchHz` throw `RangeError` at 8000 Hz and 96001 Hz; a returned range list is a copy; a 400 Hz tone and an 80 Hz tone are within the allowed error (the end of the range, where interpolation matters most); the time of every event is `b(h) / sampleRate` for an integer `h`.
- Chunk invariance: equal events and ranges for chunks of 1, 441, 4096 and 50000 samples at 16000, 44100 and 48000 Hz, compared with `toEqual` (bit-equal). Property P3 (pitch) over a list of chunk sizes from 1 to 4096 on a fixed signal (a hum, a gap, an impact, a second hum).
- Review item 12 (Requirement 9): a fixed sweep of the four classes, 27 gains and 2 seeds at 48000 Hz with 20 dB SNR white noise (216 cases of about 2 s each; the 60 s test shows the cost is small), and a property over the sample rate, the class, the gain, the seed and 1 to 5 impacts. The signal is the build of Task 8's `makeSignal` with `noiseRmsDb` set from the quietest clean impact as in Task 8 Requirement 15.3, then clamped.
- Noise: white and pink noise from -60 to -20 dBFS give no event, as a property over the level, the kind, the rate and the seed.
- P9: Requirement 13. The test collects the `start` and `update` values with their times, takes the first and last quarter by count, and compares their means.
- `test.todo`: `E5: speech recordings give at most one hum start per minute`, and `E5: hum recordings start within 0.5 s for at least 90 % of the hums`.

**`test/engine.test.ts`** (the four todos, Requirement 11): the hum-and-impact test (fixed), the rising and falling hum test with the baseline set on the model (fixed), P1 with a hum before the impacts (150 or 300 cases by `PBT_RUNS` as P1, `rng`-drawn), and the `low` sweep through `runSamples`. The existing P1 and P1b stay as they are.

**`test/teach.test.ts`**: the three tests of Requirement 12.6. The old test `skips the hum folder with a warning` is deleted.

## Evidence record
Filled in by the implementer (2026-11-19).
- **Review item 12, without the stability rule (step 4.6).** The sweep of 4 classes x 27 gains x 2 seeds at 48000 Hz with 20 dB SNR noise gave no `start` for any class or gain (`low`, `mid`, `high`, `ring`: 0 of 216). Instrumented run over the same 216 signals (29,592 analysed hops): the longest run of voiced hops was 0 for every class, so the margin against the start count of 12 hops was the whole count. No hop was voiced at all. The property test (rate, class, gain, seed, 1 to 5 impacts) also gave no event.
- **With the stability rule (step 4.7), `PITCH_MAX_STEP_SEMITONES` 1.** The sweep gave 0 of 216 again, and the property and noise-only properties passed at `PBT_RUNS` 1000 with no counterexample. The constant was not lowered to 0.5. The rule is kept because it is the first E5 knob and P9 passes with it (the fastest glide moves less than 0.3 semitone per hop).
- **P1 and P1b rates.** Before the wiring (no-op tracker), 150 cases each: P1 100.0 %, P1b 100.0 % exact, no over-count, no wrong label. After the wiring (real tracker), 150 cases: P1 100.0 %, P1b 100.0 %. With `PBT_RUNS` 300 (300 cases): P1 99.7 % (1 under-count, explained by an `unknown`), P1b 99.7 % (1 under-count, explained by an `unknown`), no over-count, no wrong label. These match the pre-wiring behaviour; the tracker found no hum in any P1 or P1b case. "P1 with a hum before the impacts": 100.0 % of 150 and of 300 cases, no continuous event after the hum. The `low` sweep through `runSamples` at 44100 Hz: 108 of 108 exact, no `continuous` event.
- **Speed.** 60 s of 48 kHz audio (hums, impacts and white noise at -45 dBFS), `push` in chunks of 4096 and `flush` timed: about 210 ms (206 and 211 ms in two runs), budget 3000 ms.
- **Deviation from this design.** After refinement, the parabolic interpolation can put `f0` of a tone exactly at the edge of the range a little outside it (an 80 Hz tone gave 79.99 Hz, a 400 Hz tone 400.2 Hz) and Requirement 4.1(c) would then drop it. The integer lag is already inside the search range, so `f0` is clamped to `PITCH_MIN_HZ` to `PITCH_MAX_HZ` instead of being rejected. Requirement 5.7 (every value inside the range) holds by construction. The 80 Hz and 400 Hz tests check this.
- **Warning for an all-null hum folder.** A hum folder whose files all give `null` has one `no-pitch-found` warning per file (`hum/<file>`). The warning with `file` equal to `hum` is for a folder with no `.wav` file. In both cases `model.pitch` is undefined.
- **Known limit (Requirement 11.10).** A segment that closes before its hum is confirmed (a click in the first `HUM_START_VOICED_MS` of a hum) is classified, because no range exists yet. See "Events, times and ranges".
- E5: not run, needs real recordings.

## E5 procedure and remedies
E5 is not run in this task. A speech-like synthetic test is not convincing: speech vowels have formants, jitter, breath noise and an intonation that a short synthesis does not reproduce, and a signal made to pass the tracker would only show that the signal was made to pass. Real recordings decide.

When the recordings exist (2 minutes of hum and 2 minutes of speech, 16-bit PCM, in `fixtures/audio/full/`): run each file through `runSamples` with no patterns, count the `continuous` events with phase `start` in the speech files (criterion: at most 1 per minute) and in the hum files (every hum should start within 0.5 s of its beginning), and write the numbers into `docs/experiments.md` as the E5 row. If the speech criterion fails, change one constant at a time in this order and run the recordings again. Each is a value in `core/constants.ts` only:
1. `HUM_START_VOICED_MS`: raise from 120 (a vowel is rarely as steady as a hum for a long time).
2. `PITCH_MAX_STEP_SEMITONES`: lower from 1 toward 0.5 (speech intonation moves more than a hum).
3. `PITCH_HIGH_ENERGY_RATIO_MAX`: lower from 0.2 (fricatives and bright vowels).
4. `PITCH_MIN_LEVEL_DBFS`: raise from -50 (quiet background speech).
5. `YIN_THRESHOLD`: lower from 0.15 (accept only very periodic sound).

Not built, because nothing yet shows a need: a limit on the pitch range inside the start window, and a hum-only mode that needs a trained baseline. If all five fail, design 11 applies: hum scroll gets an explicit listening switch in the app. Retuning must keep the tests of this task green, which Requirement 10.2 secures by deriving test durations from the constants. Only P9's glide duration and the sweep ranges are fixed numbers, and the stability limit has a margin against them (see "Why the stability rule compares with the previous hop").

## Risks and rules
- **Review item 12.** See Requirement 9 and the evidence record. A failure is evidence about the tracker. Do not drop `low`, loosen the sweep or turn the hum path off for P1.
- **P1 and P1b.** They share the engine with the tracker from now on. Any fall under 98 % exact, any over-count and any wrong label must be explained in this file. The properties are not changed to pass.
- **Impact inside a hum.** The impact adds energy above 1 kHz and ends the hum after 60 ms. For a loud impact the hum may start again after it. Both are expected. The test checks only that the impact is not classified and the hum is not an event.
- **Interpolation error at 400 Hz.** At 8 kHz a 400 Hz period is 20 samples. Without parabolic interpolation the error is up to 10 Hz. It is part of the design for that reason.
- **Low-pass at 3400 Hz, 2nd order.** It attenuates weakly near 4 kHz, so a 16 kHz input with strong 4 kHz to 8 kHz energy can fold into the 8 kHz stream. Such a sound fails the ratio test first. A steeper filter would cost speed and is not needed for hum.
- **Sample rates that are not multiples of 8000.** Handled by exact integer positions (Requirement 2.2) and tested at 44100 Hz with the chunk sizes of Requirement 7.1.
- **Hum only, not a voice-activity detector.** The tracker says nothing about speech. A held vowel can look like a hum. E5 measures this.
