# Tasks: Task 6, Hum pitch tracker (YIN)

Order is test-first. Do not write `core/continuous/pitch.ts` before its tests fail. Do not change a property, a range or an acceptance rate to make a test pass: read the counterexample, find the cause, and record it in `design.md` (Requirement 9.3 and 11.9).

- [x] 1. Check prerequisites
  - [x] 1.1 Confirm that `core/continuous/tracker.ts`, `core/engine.ts`, `core/segment.ts`, `core/grammar.ts`, `node/teach.ts`, `scripts/pbt-quick.ts`, `test/setup.ts` and `test/helpers/engine-fixture.ts` exist and that the tests of Tasks 1 to 5, 7 and 8 pass.
  - [x] 1.2 Confirm that `core/continuous/pitch.ts` and `test/pitch.test.ts` do not exist.
  - [x] 1.3 Confirm that the Pitch section of `core/constants.ts` has `PITCH_ANALYSIS_RATE_HZ`, `PITCH_LOWPASS_HZ`, `YIN_WINDOW_MS`, `PITCH_HOP_MS`, `YIN_THRESHOLD`, `PITCH_MIN_HZ`, `PITCH_MAX_HZ`, `PITCH_HIGH_BAND_MIN_HZ`, `PITCH_HIGH_ENERGY_RATIO_MAX`, `PITCH_MIN_LEVEL_DBFS`, `HUM_START_VOICED_MS` and `HUM_END_UNVOICED_MS`. Do not add the two new constants yet.
  - [x] 1.4 Confirm that `test/engine.test.ts` has the four `test.todo` entries of Requirement 11.4 and `test/teach.test.ts` has `the hum folder sets pitch.baselineHz near the tone frequency`, and note the title of the Task 8 test `skips the hum folder with a warning`.
  - [x] 1.5 Confirm that the fixture helpers can place impacts with a noise level set from the quietest clean impact (`makeSignal` with `noiseRmsDb`, `impactClip`, `loudestWindowDb`, `clip`). If a helper is missing, add the smallest one to `test/helpers/engine-fixture.ts`.
  - [x] 1.6 Search the whole repository (code, tests, `tools/mcp-ears`, `docs/`, `.kiro/`, outside `docs/_planning/`) for `hum-folder-ignored` and list every file. These files are updated in step 6.

- [x] 2. Write failing tests
  - [x] 2.1 `test/pitch.test.ts`, tracker basics (Requirements 1, 3, 5, 6): the fixed tests listed in `design.md` "Testing", in particular the 2 s 150 Hz tone, the short tone (derived from the constants), white noise, every impact class, the range `start` back-dating, `flush`, push after `flush`, two hums in order, the copy of the range list, the `RangeError` cases, the 80 Hz and 400 Hz tones, and the time of every event as `b(h) / sampleRate`.
  - [x] 2.2 `test/pitch.test.ts`, `medianPitchHz` (Requirement 8): 220 Hz within 3 Hz, `null` for silence, noise and an empty array, the value equal to the median of the values the tracker reports plus the 11 hops before `start`.
  - [x] 2.3 `test/pitch.test.ts`, chunk invariance (Requirement 7.1): fixed chunk sizes 1, one hop, 441, 4096 and 50000 at 16000, 44100 and 48000 Hz with bit-equal events and ranges, and the property P3 (pitch) over a list of chunk sizes.
  - [x] 2.4 `test/pitch.test.ts`, speed (Requirement 7.2): 60 s of 48 kHz audio (a hum, impacts and noise) in under 3 s, timing only `push` and `flush`.
  - [x] 2.5 `test/pitch.test.ts`, review item 12 (Requirement 9.1): the fixed sweep of four classes, 27 gains and 2 seeds at 48000 Hz with 20 dB SNR noise, and the property over rate, class, gain, seed and 1 to 5 impacts. Both expect no event and no range. Add the noise-only property (white and pink, -60 to -20 dBFS, three rates).
  - [x] 2.6 `test/pitch.test.ts`, vibrato (a 150 Hz tone with 50 cents of vibrato starts and ends) and P9 (Requirement 13): `test.prop`, no `numRuns`, the glide of 1500 ms, `f0` and `f1` from 100 to 350 Hz with a difference of at least 30 Hz, vibrato 0 to 30 cents, rates 16000, 44100 and 48000 Hz, the first-quarter and last-quarter means, `P9_MIN_TRACKED_FRACTION` 0.3.
  - [x] 2.7 `test/pitch.test.ts`, E5: the two `test.todo` entries of Requirement 10.4, with a comment that real recordings are needed.
  - [x] 2.8 `test/engine.test.ts`: turn the four todos into tests with the same titles (Requirement 11.4 to 11.8): the impact inside a hum (no sound event and no `unknown` for the impact, no event for the hum), `hum.rise` and `hum.fall` through the engine with `pitch.baselineHz` of 150 Hz (including the steady and the vibrato hum that fire nothing), P1 with a hum before the impacts (same rule as P1, `rng`-drawn cases), and the `low` sweep through `runSamples` (108 cases, at least 98 % exact, no `continuous` event, no wrong label). The existing P1 and P1b stay unchanged.
  - [x] 2.9 `test/teach.test.ts`: delete `skips the hum folder with a warning`. Turn the todo into the three tests of Requirement 12.6 (two hum files near 205 Hz, a noise hum file with the `no-pitch-found` warning, an engine built from the taught model with `hum.rise`). Add a test that the hum folder is not counted toward the minimum and that a directory with a hum folder next to two impact classes gives no warning.
  - [x] 2.10 Run `test/pitch.test.ts`, `test/engine.test.ts` and `test/teach.test.ts`. Expect FAIL because the module is missing and the wiring is not done. Confirm that the tests of other files still pass.

- [x] 3. Constants and the quick script
  - [x] 3.1 Add `PITCH_MAX_STEP_SEMITONES` (1) and `PITCH_FILTER_Q` (1 / square root of 2) to the Pitch section of `core/constants.ts`, each with a comment that names the unit (or "unitless") and says that `PITCH_MAX_STEP_SEMITONES` is an E5 knob. Do not change the other values. (Requirement 14.1)
  - [x] 3.2 Add `test/pitch.test.ts` to the candidate list of `scripts/pbt-quick.ts`. The script skips files that do not exist, so the order of the work does not matter. (Requirement 13.5)

- [x] 4. Implement `core/continuous/pitch.ts`
  - [x] 4.1 Constructor with the rate check, the two 2nd-order filters from `PITCH_FILTER_Q`, the exact integer positions of the 8 kHz samples and the linear interpolation. State carries over between chunks. (Requirement 1, 2)
  - [x] 4.2 Hop grid `b(h)`, per-hop energy blocks (total and high-band) built in sample order, window level and ratio, hop times as `b(h) / sampleRate`. (Requirement 2, 4.1, 4.2, 4.5)
  - [x] 4.3 YIN over the 320 samples: difference function, cumulative mean normalized difference, threshold search from the shortest lag with the local-minimum follow-through, parabolic interpolation, range check, silent window. (Requirement 3)
  - [x] 4.4 Candidate decision and state machine: start count, update per voiced hop, end count, event times and values, `flush`. **Without** the stability rule yet. (Requirement 4.1, 5)
  - [x] 4.5 `voicedRanges` (window-start back-dating, end at the `end` event, copy on read) and `medianPitchHz` sharing the same hop analysis. (Requirement 6, 8)
  - [x] 4.6 **Evidence for review item 12.** Run the sweep and the property of 2.5 against this build, without the stability rule. Write the outcome into the "Evidence record" of `design.md`: which classes and gains, if any, gave a `start`, and the margin seen. Do not change the test.
  - [x] 4.7 Add the stability rule of Requirement 4.3 with `PITCH_MAX_STEP_SEMITONES`. Run the sweep and the property again. IF a case still gives a `start`, THEN lower the constant once to 0.5 and run again. IF it still fails, THEN stop, write the counterexample into `design.md` and report. Do not exclude `low`, shrink the sweep or switch off the hum path for P1. (Requirement 9.2, 9.3)
  - [x] 4.8 Run `test/pitch.test.ts`. Expect PASS except the two E5 todos. This includes the speed test, P9 and P3 (pitch). If the speed test fails, profile before changing the design: skip YIN for hops that fail the level or ratio test (4.2), and check that the difference function runs only on the 8 kHz window.

- [x] 5. Wire the engine
  - [x] 5.1 Change the private `createTracker` in `core/engine.ts` to return `new PitchTracker(sampleRate)` and add its import. Change nothing else in the file, the options or `core/index.ts`. (Requirement 11.1)
  - [x] 5.2 Run `test/engine.test.ts`. Expect PASS, including the four tests of 2.8 and the unchanged P1 and P1b. If P1 or P1b fall under 98 % exact, or give an over-count or a wrong label, find the cause (compare with the run before 5.1), record it in `design.md` and fix the tracker. Do not loosen the properties. (Requirement 11.9)
  - [x] 5.3 Record the exact rates of P1 and P1b before and after, in the "Evidence record". Run `test/engine.test.ts` once with `PBT_RUNS` set to 300 to use the full case set.
  - [x] 5.4 State in `design.md` that a segment closing before its hum is confirmed is still classified (the known limit of Requirement 11.10) if it is not there yet.

- [x] 6. Teach the baseline
  - [x] 6.1 In `node/teach.ts`, read the files of the `hum` folder in code-unit order with the wrapped read error, compute `medianPitchHz`, and set `model.pitch = { baselineHz }` after training from the median of the non-null values. Keep the folder out of `labels`, the example counts and the minimum check. (Requirement 12.1, 12.2)
  - [x] 6.2 Add the warning code `no-pitch-found` (file `hum/<file>`, or `hum` when the folder has no file) and remove `hum-folder-ignored` from `TeachWarning`. Keep the sort order. (Requirement 12.3, 12.4)
  - [x] 6.3 Update every file listed in step 1.6 (tests, MCP text and tests, docs outside `docs/_planning/`) for the removed code. Task 8's spec files stay as they are: they record what Task 8 did.
  - [x] 6.4 Run `test/teach.test.ts`, the MCP test and `test/public-api.test.ts`. Expect PASS.

- [x] 7. Verify
  - [x] 7.1 Run the full test suite and the TypeScript check. All earlier tests still pass, apart from the one replaced test of 2.9.
  - [x] 7.2 Run `test/pitch.test.ts` once with `PBT_RUNS` set to 1000 and confirm PASS. Run the quick property script and confirm that it includes `test/pitch.test.ts`.
  - [x] 7.3 Check that nothing under `core/` imports `fs`, `path`, `node:` modules, DOM or Web Audio, uses `Math.random` or a clock, or hard-codes a sample count or a threshold (the file-local factors of Requirement 14.2 excepted). Run the public API check script. (Requirement 1.5, 14.1, 14.2)
  - [x] 7.4 Check that no code sends audio over the network, that the taught model holds the baseline number only, and that no recording is written by this task. (Requirement 12.5, 14.3)
  - [x] 7.5 Confirm that the E5 todos are listed, that `design.md` has the E5 remedy order and the filled "Evidence record", and that no E5 result is claimed.
  - [x] 7.6 Confirm no Korean text in tracked files outside `docs/_planning/`, and that no temporary file or directory remains (the teach tests remove their temp folders in `afterEach`).
  - [x] 7.7 Add a line to `docs/devlog.md` with the review item 12 result, the P1 and P1b rates, the time of the 60 s test and "E5 not run, needs real recordings". (Requirement 14.5)

- [x] 8. Commit
  - [x] 8.1 Commit the new files, the edited files listed in `design.md` "Files", and this spec folder with the message `feat: add YIN pitch tracker for hum`.
