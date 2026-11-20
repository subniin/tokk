# Tasks: Task 14, microphone, Worker and `listen()`

Order is test-first. Do not write `web/protocol.ts`, `web/worklet-source.ts`, `web/mic.ts` or `web/listen.ts`, and do not replace `web/worker.ts`, before the tests that cover them exist and fail. After every step that touches configuration or code, `npm test`, `npx tsc --noEmit` and `npx tsc -p tsconfig.web.json --noEmit` must still pass (apart from the new tests that are meant to fail). If installed Chrome cannot be launched by Playwright, stop and report. Do not download a browser.

- [x] 1. Check prerequisites
  - [x] 1.1 Run `npm test`, the three type checks that exist (`tsconfig.json`, `tsconfig.web.json`) and `npm run build` once, and note that they pass (baseline) and the runtime of the whole suite.
  - [x] 1.2 Read the Task 13 results in the devlog and `design.md` ("Measured values"). Confirm that the files listed in `requirements.md` ("Introduction") exist with the content described there, and that `listen`, `web/protocol.ts`, `web/mic.ts`, `web/listen.ts`, `web/worklet-source.ts`, `web/constants.ts`, `playwright.config.ts`, `tsconfig.test-web.json`, `test/web/` and `.kiro/hooks/web-smoke.json` do not exist yet.
  - [x] 1.3 Find the function in `core/engine.ts` that checks the sample rate. Confirm it is not exported and that its message is built there only.
  - [x] 1.4 Search `core/` for an existing conversion from milliseconds to a sample count. If one exists, use it from `web/` by relative import. If none exists, plan one exported function in `web/protocol.ts`.
  - [x] 1.5 Read `core/grammar.ts` and confirm that a pattern that is the plain name of a label fires on a single sound of that label, and how long the matcher waits before it reports one (so the tests know what `flush` must produce). Note the pattern syntax in `design.md` if it differs from the assumption.
  - [x] 1.6 Read the signature of `teachFromRecordings` and decide whether the teaching set needs a `background` recording. Note it in `design.md`.
  - [x] 1.7 Search `test/` and `scripts/` for every file that imports a path below `web/`. List those that would be reached by the base `tsc` after `web/index.ts` exports `listen` (at least `test/load-sounds.test.ts`). Decide, for requirement 8.3 (c), whether each one reads names as text, imports `web/load-sounds.ts` instead, or moves to `test/web-unit/`. Record the decision.
  - [x] 1.8 Run `npm view @playwright/test time --json` and `npm view @playwright/test dist-tags`. Choose the newest stable version published on or before 2026-11-06 (no alpha, beta or `next`). Record the version, its date and the cut-off in `design.md` ("Measured values").
  - [x] 1.9 Check that Chrome is installed (the `channel: 'chrome'` target) and note its version. Do not install anything yet.
  - [x] 1.10 Read `scripts/check-public-api.ts` and `.kiro/hooks/pbt-quick.json`. Confirm that `check:public-api` does not depend on the files this task adds, and note the hook matcher style to copy.

- [x] 2. Write the failing vitest tests (no browser needed)
  - [x] 2.1 `test/protocol.test.ts`: tests 1 to 7 of the table in `design.md`. Use `test/helpers/engine-fixture.ts` for models and signals, `runSamples` as the oracle, `PBT_RUNS` for the run count and a named timeout per run, with units. Run the file and confirm FAIL (module missing).
  - [x] 2.2 `test/worklet.test.ts`: test 8. A fake processor base class, a fake `registerProcessor`, a fake `sampleRate`, chunk size passed as `processorOptions`, a recording fake port. Include a `chunkFrames` that is not a multiple of 128. Run and confirm FAIL.
  - [x] 2.3 `test/web-unit/mic.test.ts`: test 9, with `vi.stubGlobal` for `navigator`, `AudioContext`, `AudioWorkletNode`, `MessageChannel`, `Blob` and `URL`, and fake timers for the resume timeout. Run and confirm FAIL. Create `tsconfig.test-web.json` first if the type check of this file needs it.
  - [x] 2.4 `test/build.test.ts`: apply the named changes of requirement 8.3 (a), (b) and the new vm test (test 10, test 11). `test/load-sounds.test.ts`: apply 8.3 (c) as decided in step 1.7. Do not change `test/public-api.test.ts`. Run both files and confirm the changed and new tests FAIL and the others still pass.

- [x] 3. Configuration and dependency
  - [x] 3.1 Install `@playwright/test` with the exact version of step 1.8 as a devDependency (no range prefix). Confirm that no browser was downloaded and that `package-lock.json` records the version.
  - [x] 3.2 Add `.gitignore` entries for `test/web/generated/`. Confirm `test-results/` and `playwright-report/` are ignored.
  - [x] 3.3 In `scripts/build.ts`, export the port and host constants and change nothing else in that file. Run `npm run build` and the build test.
  - [x] 3.4 Create `tsconfig.test-web.json` (requirement 1.8), and change `tsconfig.json` to also exclude `test/web-unit`. Run all three type checks.
  - [x] 3.5 Create `playwright.config.ts` (requirement 1.3 and 1.4) and add `test:web` to `package.json` `scripts`. Run `npx playwright test --list` and confirm that it lists no test yet and does not fail.

- [x] 4. Write the failing Playwright tests
  - [x] 4.1 `test/web/fixture.ts`, `test/web/global-setup.ts`: generate the teaching set, the model and the test WAV into `test/web/generated/` (requirement 9), with the check of 9.3. Run the setup alone through the config and fix until the Node check passes. Check that Playwright can import the core and helper files by relative path. If it cannot, move the generation into a `tsx` script that the `test:web` script runs first and note why in `design.md`.
  - [x] 4.2 `test/web/instrument.ts` and `test/web/listen.html` (requirement 9.5 and 9.6). The page uses only `/dist/tokk.js`.
  - [x] 4.3 `test/web/listen.spec.ts`: tests 12 to 15, with the test-only constants at the top. The smoke test title contains `smoke`. Run `npm run test:web` and confirm the tests FAIL because `listen` does not exist (not because of the setup or the page).
  - [x] 4.4 Confirm that Chrome starts, that the fake device is selected, and whether headless Chrome delivers audio. Record the result in `design.md` ("Measured values"). Change to headed mode only if headless fails, and write why.

- [x] 5. Constants, protocol, worker, worklet
  - [x] 5.1 Create `web/constants.ts` (requirement 2.1).
  - [x] 5.2 Add the `export` keyword to the sample-rate check in `core/engine.ts` (requirement 8.2). Do not change anything else in `core/`. Run the engine tests.
  - [x] 5.3 Create `web/protocol.ts` (requirement 3), with the ms-to-samples helper if step 1.4 needed one. No DOM type, no Node import.
  - [x] 5.4 Replace `web/worker.ts` (requirement 4). Delete the ping code. Confirm that no other file used `answer`.
  - [x] 5.5 Create `web/worklet-source.ts` (requirement 5).
  - [x] 5.6 Run `test/protocol.test.ts` and `test/worklet.test.ts` and fix the code until they pass. Do not weaken a test. If a test shows that a rule in `design.md` is wrong, change `requirements.md` and `design.md` first and say why in the devlog.
  - [x] 5.7 Measure the time of `test/protocol.test.ts` at `PBT_RUNS=20` and `PBT_RUNS=100`, and record it. If it is over 30 s at 100 runs, shorten the signal length, not the test list.

- [x] 6. Microphone and `listen()`
  - [x] 6.1 Create `web/mic.ts` (requirement 6) in the order of `design.md`. Run `test/web-unit/mic.test.ts` and fix the code until it passes.
  - [x] 6.2 Create `web/listen.ts` (requirement 7): validation by a throwaway engine, microphone path, WAV path with the pacing timer, handler dispatch with the asynchronous rethrow, pause, resume, `setMode`, `stop`, one routing function. `debug` is accepted and ignored.
  - [x] 6.3 Update `web/index.ts` (requirement 8.1).
  - [x] 6.4 Run all three type checks and `npm test`. Fix until they pass.
  - [x] 6.5 Run `npm run build`. Check that `dist/tokk.js` holds the Worker and the worklet strings and has no Node references, and note its size.

- [x] 7. End-to-end run
  - [x] 7.1 Run `npm run test:web`. Fix the code until the four tests pass. Read the real `AudioContext.sampleRate` in the microphone test and note it. If no chunk arrives from the node with no output, add the zero-gain fallback of `design.md` and note it.
  - [x] 7.2 Measure the lost start of the capture (time from the start of the file to the first impact that the engine saw) and adjust `WEB_TEST_CAPTURE_START_ALLOWANCE_MS` if the first impact is lost or if the file is longer than needed. Record both numbers.
  - [x] 7.3 Run two microphone tests in a row in one run and see whether the second starts at the beginning of the file. If not, launch a fresh browser for each microphone test and record it.
  - [x] 7.4 Run `npm run test:web -- --grep smoke` and confirm it passes in under 20 s, including browser start. Run the whole `npm run test:web` three times and confirm that it does not flake. If a test flakes, find the cause. Do not add retries to hide it.

- [x] 8. The hook
  - [x] 8.1 Create `.kiro/hooks/web-smoke.json` in the format of `pbt-quick.json`, as in requirement 11. Check the matcher against the four sample paths of 11.3 and note the result.
  - [x] 8.2 Run the hook command by hand once (`npm run test:web -- --grep smoke`) and confirm it exits with code 0 and finishes within the hook's timeout.

- [x] 9. Check the rules and the consumers
  - [x] 9.1 Search `web/` for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `localStorage`, `indexedDB`. Confirm the only hits are the model read in `load-sounds.ts` and the WAV read in `listen.ts`, both GET without a body. Confirm no audio, sample, envelope or model leaves the page.
  - [x] 9.2 Check that `web/` has no import of `fs`, `path`, `zlib`, `process`, `node:*` or `node/`, that `core/` has no DOM use, that every time value has a unit in its name, that no sample count is typed, that every event time is a sample count divided by the sample rate, and that no clock is used for an event time.
  - [x] 9.3 Check that the microphone constraints appear in one place and are exactly those of the steering file, that `resume()` is only called in the paths of requirement 6.11, and that no `AudioContext` is created for a WAV source.
  - [x] 9.4 Run `npm run check:public-api`, `npm run mcp` (start and stop it, or run its test), and confirm that the other hooks and `npm run sounds:rebuild` are unaffected.
  - [x] 9.5 Check that no Korean text is in tracked files outside `docs/_planning/`, and that nothing generated is tracked (`git status` shows `test/web/generated/`, `test-results/`, `playwright-report/` and `dist/` as ignored).

- [x] 10. Verify and commit
  - [x] 10.1 Fill in "Measured values" of `design.md` (every item of that list).
  - [x] 10.2 Run `npm test`, `npm run test:web`, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc -p tsconfig.test-web.json --noEmit`, `npm run build` and `npm pack --dry-run`. All pass, and the pack list is unchanged from Task 13 except for the new type files.
  - [x] 10.3 Run `PBT_RUNS=1000 npx vitest run test/protocol.test.ts` once and note the result and the time.
  - [x] 10.4 Add the line of requirement 12.6 to `docs/devlog.md`.
  - [x] 10.5 Remove every temporary file and confirm that `git status` shows only the intended files: `.gitignore`, `package.json`, `package-lock.json`, `playwright.config.ts`, `tsconfig.json`, `tsconfig.test-web.json`, `scripts/build.ts`, `core/engine.ts`, the new and changed `web/` files, `test/protocol.test.ts`, `test/worklet.test.ts`, `test/web-unit/`, `test/web/` (without `generated/`), `test/build.test.ts`, `test/load-sounds.test.ts` (and any other file named in step 1.7), `.kiro/hooks/web-smoke.json`, `docs/devlog.md` and this spec.
  - [x] 10.6 Commit with the message `feat: add browser microphone, worker and listen()`.
