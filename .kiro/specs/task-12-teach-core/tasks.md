# Tasks: Task 12, move the teaching logic into core

Order is test-first. Do not write `core/teach.ts` or `retrainLabel` before the new tests fail. `test/teach.test.ts` must pass before the first change and after every step that touches `node/teach.ts`. Runtime target for `test/teach-core.test.ts`: under 30 s at `PBT_RUNS=100`, under 15 s at `PBT_RUNS=20` (see `design.md`).

- [x] 1. Check prerequisites
  - [x] 1.1 Run the whole test suite and the TypeScript check once and note that they pass before any change (baseline). Note the runtime of `test/teach.test.ts`.
  - [x] 1.2 Confirm that the constants of `design.md` exist in `core/constants.ts` with the plan's values, and that `HUM_LABEL` does not exist yet. Confirm that `core/continuous/pitch.ts` exports `medianPitchHz` and that `core/segment.ts`, `core/features.ts`, `core/classify/knn.ts` and `test/helpers/engine-fixture.ts` exist.
  - [x] 1.3 Confirm that `fixtures/audio/synth/sounds` exists and holds `<label>/*.wav` folders that `teachFromDir` accepts. Note its labels and whether it has `hum`, `background` or empty folders. If it does not exist, stop and report instead of choosing another folder.
  - [x] 1.4 Search the repository (including `scripts/`, `node/`, MCP tool code and tests) for uses of `TeachWarning`, `TeachReport` and the warning codes. Confirm that no `switch` over `code` lacks a default, and that nothing outside `node/teach.ts` needs a change. List the uses in the devlog line of step 7.
  - [x] 1.5 Confirm that `core/index.ts`, `node/index.ts` and `test/public-api.test.ts` need no change (no new runtime name is exported from them).

- [x] 2. Write failing tests in `test/teach-core.test.ts`
  - [x] 2.1 Put the test-only values at the top of the file: sample rates, hits per label, seed bases, gain, hum tone values, timeouts that grow with `PBT_RUNS`. Add the local helper that makes a `Recording` from a label, a file name, a hit count and a seed.
  - [x] 2.2 Build the small fixture set once in `beforeAll` (three impact labels, a `hum` file and a `background` file, a few seconds each). Time the step.
  - [x] 2.3 Write tests 1 to 8 of `design.md`: folder deep-equal, order and non-modification, ids and model shape, hum, `emptyFolders`, duplicate recordings. (Req 2, 3.1)
  - [x] 2.4 Write tests 9 to 14: other labels' vectors unchanged, whole-model retraining against `trainVectors`, reproduction by retraining with the original recordings, `keep`, new label, too few kept. (Req 4.2 to 4.7)
  - [x] 2.5 Write tests 15 to 19: sample rate mismatch warning, label mismatch, background, hum, input model unchanged and no samples. (Req 4.5, 4.8 to 4.11, 1.5)
  - [x] 2.6 Write test 20, the source scan of `core/teach.ts`. (Req 1.4)
  - [x] 2.7 Write the P8 property (end the name with `(Req 2.8)`) with `test.prop` from `@fast-check/vitest`, without `numRuns`, with a comment naming P8 and the requirement.
  - [x] 2.8 Run the new file and confirm FAIL (module missing). Run `test/teach.test.ts` and `test/public-api.test.ts` and confirm they still pass.

- [x] 3. Create `core/teach.ts` (move, then extend)
  - [x] 3.1 Add `HUM_LABEL` to the Teaching section of `core/constants.ts`. (Req 1.6)
  - [x] 3.2 Create `core/teach.ts` with the types `Recording`, `TeachWarning` (with the new code) and `TeachReport`, and move the helpers (`compareStrings`, `segmentsOf`, `startSample`, `endSample`, `backgroundWindows`, `calibrationWarnings`, `capEvenly`, `looReport`, `median`) from `node/teach.ts` without changing their behaviour. Keep the unit conversion factors file-local. (Req 1, 5.2, 5.3)
  - [x] 3.3 Write `teachFromRecordings` following the procedure of `design.md`: sort and reject duplicates, group, segments, background windows and cap, calibration warnings, count check, `knnClassifier.train`, hum pitch and warnings, `emptyFolders`, warning sort, report. (Req 2)
  - [x] 3.4 Run tests 2 to 8 and 20 and the P8 property for `teachFromRecordings`. Fix until they pass. Test 1 waits for step 4.

- [x] 4. Thin out `node/teach.ts`
  - [x] 4.1 Replace the body of `teachFromDir` by the reading steps of `design.md`: list folders, list `.wav` files, read with `readWavFile` and keep the `<label>/<file>:` error wrap with `cause`, collect `emptyFolders`, call `teachFromRecordings`. (Req 3.1 to 3.3)
  - [x] 4.2 Remove everything that moved. Re-export the types `TeachReport` and `TeachWarning` from `core/teach.ts`. Use `HUM_LABEL` instead of a private literal. Keep the header comment true: reads local files only, writes nothing, uses no network. (Req 3.4, 3.5, 5.4)
  - [x] 4.3 Run `test/teach.test.ts` and confirm every test passes with its expectations unchanged. Run test 1 of the new file (deep equal against the folder) and confirm PASS. If either fails, fix the new code, not the tests.
  - [x] 4.4 Run the tests of `scripts/sounds-rebuild.ts` and the MCP `teach` tool and confirm their text output is unchanged. (Req 5.5)

- [x] 5. Implement `retrainLabel`
  - [x] 5.1 Implement the procedure of `design.md`: label check, sort and duplicates, new examples (ordinary, `background`, `hum`), `keep`, sample rate warnings, vectors of other labels copied from `model.examples`, count check before training, `trainVectors`, `pitch` handling, report, warning sort. (Req 4)
  - [x] 5.2 Run tests 9 to 19 and the second P8 case and fix until they pass. Do not weaken a test to make it pass. If a test shows a rule of `design.md` is wrong, change `design.md` and `requirements.md` first and say why in the devlog.
  - [x] 5.3 Record the measured runtimes in the "Measured values" section of `design.md`. If the runtime target is exceeded, shrink the fixture pool first, not the number of property runs.

- [x] 6. Check layers, constants and the public API
  - [x] 6.1 Check that `core/teach.ts` imports only `core/` modules, and that `npx tsc --noEmit` (no DOM lib) passes. Check that it uses no `Math.random`, clock, network, or file system. (Req 1.4)
  - [x] 6.2 Check that no threshold, count or time constant is hard-coded in `core/teach.ts` or `node/teach.ts`, that every time is a sample count divided by the sample rate, and that the strings `'hum'` and `'background'` are not repeated as literals. (Req 5.2 to 5.4)
  - [x] 6.3 Check that `core/index.ts`, `node/index.ts` and `test/public-api.test.ts` are unchanged (`git diff` shows no change in them) and that the public API test passes.
  - [x] 6.4 Check that no sample is stored in a model or report in any code path, and that no Korean text is in tracked files outside `docs/_planning/`.

- [x] 7. Verify and commit
  - [x] 7.1 Run the full test suite and the TypeScript check. Both pass, including `test/teach.test.ts`, `test/public-api.test.ts` and the earlier tasks.
  - [x] 7.2 Run the property tests once with `PBT_RUNS` set to 1000 and confirm PASS.
  - [x] 7.3 Add a line to `docs/devlog.md`: teaching logic moved to `core/teach.ts`, the optional `emptyFolders` argument and why, the `sample-rate-mismatch` code, the decisions for `background` and `hum` in `retrainLabel`, the error-order difference of `design.md`, and the list from step 1.4.
  - [x] 7.4 Remove any temporary file created during the work and confirm `git status` shows only the intended files: `core/teach.ts`, `core/constants.ts`, `node/teach.ts`, `test/teach-core.test.ts`, `docs/devlog.md` and this spec.
  - [x] 7.5 Commit with the message `refactor: move teaching logic into core`.
