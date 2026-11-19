# Tasks: Task 5, kNN classifier with unknown rejection

Order is test-first. Do not write `core/classify/knn.ts` before the tests fail. Runtime target for `test/knn.test.ts`: under 20 s at `PBT_RUNS=100`, under 10 s at `PBT_RUNS=20` (see `design.md`).

- [x] 1. Check prerequisites
  - [x] 1.1 Confirm that `KNN_K`, `DISTANCE_THRESHOLD_FACTOR`, `THRESHOLD_PERCENTILE`, `MIN_EXAMPLES_PER_LABEL`, `STD_FLOOR_RANGE_FRACTION`, `STD_FLOOR_ABSOLUTE` and `BACKGROUND_MAX_EXAMPLES` exist in `core/constants.ts` with the plan's values. `BACKGROUND` is the only constant this task adds (step 3.1). (Req 11.2)
  - [x] 1.2 Confirm that `core/features.ts` (`extractFeatures`, `FEATURE_LENGTH`), `core/synth.ts` (`rng`, `synthImpact`, `synthTone`, `synthNoise`, `SYNTH_CLASSES`), `core/types.ts` and `test/setup.ts` (the `PBT_RUNS` setup) exist and that the Task 1 to 4 tests pass.
  - [x] 1.3 Confirm that `@fast-check/vitest` is installed and that `vitest.config.ts` loads `test/setup.ts`.

- [x] 2. Write failing tests in `test/knn.test.ts`
  - [x] 2.1 Put the test-only values at the top of the file, not in `core/constants.ts`: sample rate, seed bases, training gain, held-out count, the 0.95, 0.9 and 0.05 limits, pool sizes, the 500 ms training time bound, and the timeouts that grow with `PBT_RUNS`.
  - [x] 2.2 Build the fixtures once in `beforeAll`: class pool and held-out pool (features extracted once), background pool of 200 training and 40 held-out windows of `BACKGROUND_WINDOW_MS`. Time this step and note the result for `design.md`.
  - [x] 2.3 Write example tests 1 to 7 of `design.md` (accuracy, `TooFewExamplesError` and its message, exactly 5 examples, single-label model, JSON round trip, no samples in the model). Test names carry their requirement. (Req 2, 5, 8)
  - [x] 2.4 Write tests 8 to 14 (constant dimension, std floor, population std, nearest id, percentile with the 0, 1, 2, 3, 10 example, LOO ignores other labels, threshold 0). Hand-made one-dimensional models via `trainVectors`; expected values are computed from the returned `mean` and `std`. (Req 3, 4)
  - [x] 2.5 Write tests 15 to 20 (2-1 majority with `nearest` of the minority label, 1-1-1 tie, equal distances by id, unknown just above the threshold, match at exactly the threshold with confidence 0, confidence values, background returned as-is). (Req 5)
  - [x] 2.6 Write tests 21 to 24 (sample rate of the first example, statistics exclude background, other sample rate, invalid input). (Req 2, 3, 5, 7)
  - [x] 2.7 Write tests 25 and 26, the review item 11 gate: 10 examples per label plus 200 background examples classify held-out real examples at 95 % or more; the model is at most 5 points worse than the model without background; held-out background windows are not taken for a real label in 90 % or more. (Req 6)
  - [x] 2.8 Write test 27 (training time for 240 examples) and test 28 (source scan for forbidden imports, `Math.random`, `fetch`, `Date`, `performance`). (Req 8.4, 11)
  - [x] 2.9 Write the three properties with `test.prop` from `@fast-check/vitest`: P6 (Req 9.1), P7 (Req 10.1), P8 (Req 7.2, 7.4). Put a comment above each with the property number and the requirement, and end each test name with the requirement. Do not set `numRuns`. Use the pools and `trainVectors` or `classifyVector`, except P7, which uses `knnClassifier.classify`.
  - [x] 2.10 Run the knn test file and confirm FAIL (module missing).

- [x] 3. Implement `core/classify/knn.ts`
  - [x] 3.1 Add `BACKGROUND = 'background'` to the Classifier section of `core/constants.ts`. (Req 1.1, 11.2)
  - [x] 3.2 `TooFewExamplesError` and the count check, with the message format of Requirement 2.2, run before any other work. (Req 2)
  - [x] 3.3 `trainVectors`: id and vector checks, sort by id, statistics set without background, mean, population std, range, std floor. (Req 3, 6.1, 7.1)
  - [x] 3.4 Pairwise distances once, LOO nearest same-label distance, type 7 percentile, threshold factor, `PERCENT_DIVISOR` file-local. (Req 4)
  - [x] 3.5 `classifyVector`: standardize, sort by distance then id, k vote with the nearest-example tie rule, nearest of the winner, unknown test, confidence with the `T = 0` case, global `nearest`. (Req 5)
  - [x] 3.6 `knnClassifier.train` and `classify` on top of the vector helpers, `sampleRate` from the first example in input order, `export { BACKGROUND }`. (Req 1)
  - [x] 3.7 Run the knn test file and confirm PASS. If P6, P7, P8 or the item 11 gate fail, write the counterexample into `design.md` and change the rule, not the property and not the limits (Requirement 6.6). Record the measured accuracies and times in the "Measured values" section of `design.md`.

- [x] 4. Check the quick hook and the budget
  - [x] 4.1 Confirm that `scripts/pbt-quick.ts` lists `test/knn.test.ts` in its candidate files and runs it now that the file exists. The script already filters by existence, so no change is needed. Run `pbt:quick` once and confirm that it includes `test/knn.test.ts` and passes.
  - [x] 4.2 Note that `pbt:quick` defaults to 20 runs per property (`QUICK_RUNS`), while plan Task 11A and design 8.2 say 100. Do not change the script in this task. Record the difference in `docs/devlog.md` for the owner to decide.
  - [x] 4.3 Check the runtime target at `PBT_RUNS` 20 and 100. If it is exceeded, shrink the pools first (not the run count) and record the new numbers in `design.md`.

- [x] 5. Verify and commit
  - [x] 5.1 Run the full test suite and the TypeScript check. Both pass, including Tasks 1 to 4 and 11A.
  - [x] 5.2 Run the property tests once with `PBT_RUNS` set to 1000 and confirm PASS.
  - [x] 5.3 Check that `core/classify/knn.ts` imports no `fs`, `path`, DOM or Web Audio API, uses no `Math.random`, clock or network, and hard-codes no thresholds, factors or counts. Check that `core/index.ts` does not export `trainVectors` or `classifyVector`. (Req 11)
  - [x] 5.4 Confirm no Korean text in tracked files (outside `docs/_planning/`) and that `sounds.json`-shaped output contains feature vectors only.
  - [x] 5.5 Add a line to `docs/devlog.md`, including the deliberate difference from the plan (std floor range over non-background examples) and the item 11 decision.
  - [x] 5.6 Commit with the message `feat: add kNN classifier with unknown rejection`.
