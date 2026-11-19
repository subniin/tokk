# Tasks: Task 8, Engine, teachFromDir and expectEvents

Order is test-first. Do not write `core/engine.ts`, `node/teach.ts` or `node/expect.ts` before their tests fail. Hum-related tests stay `test.todo` in this task (Requirement 7.4).

- [x] 1. Check prerequisites
  - [x] 1.1 Confirm that `core/segment.ts`, `core/classify/knn.ts`, `core/grammar.ts`, `core/features.ts`, `core/wav.ts`, `core/synth.ts` and `node/files.ts` exist and that the tests of Tasks 1 to 5, 7 and 11A pass.
  - [x] 1.2 Confirm that `core/continuous/pitch.ts` does not exist (Task 6 is not done) and that `test/setup.ts` provides `PBT_RUNS`.
  - [x] 1.3 Confirm that `core/constants.ts` has `SAMPLE_RATE_MIN_HZ`, `SAMPLE_RATE_MAX_HZ`, `BACKGROUND_WINDOW_MS`, `BACKGROUND_WINDOW_OVERLAP_PERCENT`, `BACKGROUND_MAX_EXAMPLES` and `NOISE_FLOOR_WARMUP_MS`. Do not add the three new constants yet.

- [x] 2. Write failing tests
  - [x] 2.1 Add the knn test: `trainVectors` with 4 examples per label throws by default and trains with `{ minExamplesPerLabel: 4 }`. (Req 16.4)
  - [x] 2.2 Write `test/helpers/engine-fixture.ts`: `buildModel` (trains through a real `Segmenter` run, cached), `makeSignal`, `clip`, `loudestWindowDb`. Put the test-only values (`LEAD_MS` 1200, `P1_*`, `TRAIN_SPACING_MS`, `TRAIL_MS`) at the top of the test files, with units in the names. (Req 15, 16.1)
  - [x] 2.3 `test/engine.test.ts`, construction: `RangeError` for 8000, 96001 and NaN; `on` with `modes`, unknown `mode`, `modes` without `mode`; a bad pattern in an inactive mode fails at creation; `setMode` with an unknown name keeps the mode. (Req 1, 4)
  - [x] 2.4 `test/engine.test.ts`, inputs: empty buffer, zeros and -70 dBFS dither give no events, matches or unknowns (Review Focus 2); a `background` impact gives nothing; a tone against an impact-only model gives an `unknown` with its `t`. (Req 2, 6)
  - [x] 2.5 `test/engine.test.ts`, patterns: `low low` at 200 ms fires once; **`low` and `low low` at 250 ms fire only `low low`** (the plan's test); the same at 300 ms (fails without the advance rule); `low` alone fires without `flush` after trailing silence, with `t` of the sound; `flush` fires a pending pattern; `setMode` switches handlers and drops a pending sequence. (Req 3, 4, 5)
  - [x] 2.6 `test/engine.test.ts`, chunk independence: events and matches equal for chunk sizes 1, 441, 4096 and 50000 (Req 5.3), through `runSamples` and through an engine pushed in chunks.
  - [x] 2.7 `test/engine.test.ts`, **P1** (classes `mid` and `high`, gap 100-600 ms) and **P1b** (classes `low` and `ring`, gap 300-600 ms) with `test.prop`, exactly N events of the class, no `unknown`. Do not set `numRuns`. Set the timeout from `PBT_RUNS`. (Req 15)
  - [x] 2.8 `test/engine.test.ts`, `test.todo`: impact during an active hum is not classified; `hum.rise` through the engine; P1 with a hum before the impacts; the `low` class is not taken for a hum (review item 12). (Req 7.4)
  - [x] 2.9 `test/teach.test.ts`, examples: labels from folder names with `looAccuracy >= 0.9` and no confused pair for four classes; 3 impacts in one file give 3 examples with ids `low/a.wav#0..2`; examples hold only `id`, `label`, `v`; `TooFewExamplesError` for 4 examples, for a silent label folder (count 0) and for an empty directory; missing directory rejects with `ENOENT`; single-label folder classifies its sound and rejects a far one; 24-bit file rejects with the path and `16-bit PCM`; non-wav files and dot folders ignored; equal reports on two runs. (Req 8, 12)
  - [x] 2.10 `test/teach.test.ts`, background: 30 s of steady noise from sample 0 gives at least 5 window examples, the first id `background/<file>#w0`; an all-zero window is skipped; 120 s of noise gives exactly 200 examples at the evenly spaced indices; no calibration warning for a background file. (Req 9)
  - [x] 2.11 `test/teach.test.ts`, warnings: impact at 300 ms gives `sound-in-calibration` and no example; 800 ms file gives `shorter-than-calibration`; file with no sound gives `no-sound-found`; impact at 1050 ms gives no warning; clean file gives `warnings: []`; sorted order; `hum` folder gives `hum-folder-ignored`, no label `hum`, no `model.pitch`. (Req 10, 11)
  - [x] 2.12 `test/teach.test.ts`, `expectEvents`: passes for matching labels; the error has `expected` and `actual`, shows both lists and names `unknown` sounds; an unexpected `unknown` alone does not fail; an unsupported file rejects unchanged. `test.todo`: `hum` folder sets `pitch.baselineHz` near the tone frequency. (Req 7.4, 13)
  - [x] 2.13 `test/public-api.test.ts`: exact runtime export names of `core/index.ts` and `node/index.ts`; `package.json` `exports` has `"."` and `"./node"` and the target files exist. (Req 14)
  - [x] 2.14 Run the new tests and confirm FAIL (modules missing). Every sound in them starts at or after 1200 ms. (Req 16.1)

- [x] 3. Constants, classifier option and tracker interface
  - [x] 3.1 Add `ENGINE_ADVANCE_MARGIN_MS`, `LOO_MIN_EXAMPLES_PER_LABEL` and `CONFUSED_PAIR_MIN_RATE` to `core/constants.ts`, each in its own section with a comment. (Req 16.2)
  - [x] 3.2 Add the optional third parameter `options?: { minExamplesPerLabel?: number }` to `trainVectors` in `core/classify/knn.ts`. Default stays `MIN_EXAMPLES_PER_LABEL`. Run the knn tests: all pass, including 2.1. (Req 16.4)
  - [x] 3.3 Create `core/continuous/tracker.ts` with `PitchEvent`, `ContinuousTracker` and `noopTracker`. (Req 7.1)

- [x] 4. Implement `core/engine.ts` and `core/index.ts`
  - [x] 4.1 `createEngine`: rate check, mode resolution, one throwaway `Matcher` per mode, active `Matcher`. (Req 1)
  - [x] 4.2 `push`: count samples, tracker, segmenter, classification rules (overlap, `unknown`, `background`, sound), handler calls. (Req 2)
  - [x] 4.3 Advance rule `min(now - margin, openSegmentStart() ?? Infinity)` after every push. (Req 3)
  - [x] 4.4 `flush` order (tracker, segmenter, classify, `advance(Infinity)`) and `setMode`. (Req 4, 5)
  - [x] 4.5 Private `createTracker(sampleRate)` returning `noopTracker()`. Not an option, not exported. (Req 7.2)
  - [x] 4.6 `runSamples`. (Req 6)
  - [x] 4.7 `core/index.ts` with exactly the names of Requirement 14.1.
  - [x] 4.8 Run `test/engine.test.ts`. Expect PASS except the `test.todo` entries. P1 and P1b can fail: read the counterexample, find the cause in the engine, classifier or segmenter, and record it in `design.md` ("Risks and rules"). Do not change the properties, the SNR or the gain range to pass. If P1b fails at 300 ms, read the Task 4 evidence before touching `P1_SLOW_CLASS_MIN_GAP_MS`. Done after seven rounds: P1 and P1b are statistical acceptance tests (Requirement 15.7), measured 99.7 % exact at 300 cases each, 0 over-counts, 0 wrong labels; counterexamples and rule changes in design.md "Risks and rules".

- [x] 5. Implement the Node tools
  - [x] 5.1 `node/teach.ts`: folder and file listing in code-unit order, segments as examples, ids, counts with zero entries and `TooFewExamplesError` before training, wrapped read errors. (Req 8)
  - [x] 5.2 Background windows, silent-window skip, ids `#w<n>`, evenly spaced cap of 200. (Req 9)
  - [x] 5.3 Calibration warnings with the padded run, `no-sound-found`, sorted warnings, `hum-folder-ignored`. (Req 10, 11)
  - [x] 5.4 Report: leave-one-out with `trainVectors` and `classifyVector`, `looAccuracy`, `confusedPairs`. (Req 12)
  - [x] 5.5 `node/expect.ts` with `ExpectEventsError` and `expectEvents`. (Req 13)
  - [x] 5.6 `node/index.ts` with exactly the names of Requirement 14.2.
  - [x] 5.7 Add `exports` to `package.json` (`"."` and `"./node"`). Leave `main`, `scripts` and dependencies unchanged. (Req 14.3)
  - [x] 5.8 Run `test/teach.test.ts` and `test/public-api.test.ts`. Expect PASS except the `test.todo` entries.

- [x] 6. Verify and commit
  - [x] 6.1 Run the full test suite and the TypeScript check. All earlier tests still pass.
  - [x] 6.2 Run `test/engine.test.ts` once with `PBT_RUNS` set to 1000 and confirm PASS.
  - [x] 6.3 Check that nothing under `core/` imports `fs`, `path`, `node:` modules, DOM or Web Audio, uses `Math.random` or a clock, or hard-codes a sample count or threshold. Run `npm run check:public-api`. (Req 14.5, 16.2)
  - [x] 6.4 Check that no code sends audio over the network or writes samples into a model or a file, and that `sounds.json` is not written by this task. (Req 16.3)
  - [x] 6.5 Confirm that the `test.todo` entries of Requirement 7.4 are listed, and that Task 6 will find them by name.
  - [x] 6.6 Confirm no Korean text in tracked files (outside `docs/_planning/`) and that no temporary file or directory remains (test temp folders are removed in `afterEach`).
  - [x] 6.7 Add a line to `docs/devlog.md`, including the P1b gap bound and any counterexample found.
  - [x] 6.8 Commit with the message `feat: add engine, teachFromDir and expectEvents`.
