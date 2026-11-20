# Tasks: Task 16, in-app teach dialog

Order is test-first. Do not write `web/recorder.ts`, the record messages in `web/protocol.ts`, `web/teach-ui/*`, or the `teach`, `storageKey`, `sounds`, `exportSounds` and `importSounds` parts of `web/listen.ts` before the tests that cover them exist and fail. After every step that touches code, `npm test`, `npx tsc --noEmit` and `npx tsc -p tsconfig.web.json --noEmit` must still pass (apart from the new tests that are meant to fail). If installed Chrome cannot be launched by Playwright, stop and report. Do not download a browser. Do not change `test/public-api.test.ts` unless step 1.4 shows a runtime export name changes. Do not weaken a test to pass it. If a test shows that a rule in `design.md` is wrong, change `requirements.md` and `design.md` first and say why in `docs/devlog.md`.

- [x] 1. Check prerequisites and the facts of the spec
  - [x] 1.1 Run `npm test`, the three type checks (`tsconfig.json`, `tsconfig.web.json`, `tsconfig.test-web.json`), `npm run build`, `npm run check:public-api` and `npm run test:web` once. Note that they pass, the vitest count, the runtimes and the size of `dist/tokk.js`.
  - [x] 1.2 Confirm the facts in `requirements.md` ("Introduction"): `retrainLabel` ids, `keep`, hum and background rules, `TooFewExamplesError`; `replaceSounds` rebuilds the engine and does not reset the envelope counters; `setState('teaching')` exists; `Segmenter` takes only the sample rate.
  - [x] 1.3 Find where `loadSounds` validates a model (`web/index.ts` or elsewhere), and whether a `sounds.json` serializer exists in `core/` or `node/` (design, findings 6 and `exportSounds`). Record both in `design.md` ("Measured values").
  - [x] 1.4 Read `test/public-api.test.ts` and `web/index.ts`. Confirm that adding `Ears` members and that `TeachReport` already is exported as a type change no runtime export name. If a runtime name does change, stop and put the change in `design.md` first.
  - [x] 1.5 Search `test/` for any test that reads `ears.sounds` by identity (design, finding 7).
  - [x] 1.6 Read `web/overlay/draw.ts` and `waveform.ts` and decide the thumbnail drawing (design, "Thumbnails"). Record the decision.
  - [x] 1.7 Read `test/web/fixture.ts`, `paths.ts`, `global-setup.ts`, `instrument.ts`, `listen.html` and `overlay.spec.ts` for the helpers and patterns the new E2E files copy (WAV writing, model at a given rate, `countAnimationFrames`, fake microphone flags). Read `test/overlay-theme.test.ts` for how contrast pairs are listed.
  - [x] 1.8 Search `test/` and `web/` for any other use of `Segmenter` chunk invariance that the property test of step 2.4 can reuse.

- [ ] 2. Write the failing vitest tests
  - [x] 2.1 `test/teach-state.test.ts`: tests 1 to 7 of the table in `design.md`. Create `web/teach-ui/state.ts` and `web/teach-ui/format.ts` as stubs that export the functions with wrong results, so the tests fail for behavior and not for a missing import. Add the constants of requirement 8.1 to `web/constants.ts` first (the tests need them). Run and confirm FAIL.
  - [x] 2.2 `test/teach-storage.test.ts`: tests 15 and 16, with a stub `Storage` object and a stub that throws. Create `web/teach-ui/storage.ts` as a stub. Run and confirm FAIL.
  - [x] 2.3 `test/teach-recorder.test.ts`: tests 9 to 14 through `handleWorkerMessage`, with synthetic impacts from the existing test helpers, a noise bed lead of `NOISE_FLOOR_WARMUP_MS` plus the fixture margin, and named constants with units. Create `web/recorder.ts` as a stub. Run and confirm FAIL.
  - [x] 2.4 In the same file, test 8: random chunk sizes (use `PBT_RUNS`), live ids and times from the recorder against the ids of `retrainLabel` for the same samples. Run and confirm FAIL.
  - [ ] 2.5 (not run in this order: the three contrast pairs were added after the dialog was written, and the check failed for a value, see 6.2) Add the extended contrast pairs (test 27) to the existing overlay theme test only if the dialog adds a pair that is not already listed. Run it and confirm FAIL for a missing colour, or note that no new pair exists.

- [x] 3. Write the failing Playwright tests
  - [x] 3.1 `test/web/fixture.ts` and `test/web/paths.ts`: write the teaching WAV (`WEB_TEST_TEACH_LEAD_MS` of noise bed, `WEB_TEST_TEACH_COPIES` copies of one synth impact `SYNTH_FIXTURE_SOUNDS_SPACING_MS` apart, a tail), a second one with 4 copies, and a recognition WAV (calibration lead, `WEB_TEST_TAP_COPIES` impacts of the same sound), all at the rate of the page's AudioContext as in Task 14. Run the global setup alone and confirm the folder stays small.
  - [x] 3.2 `test/web/teach.html`: a button that calls `listen()` and then `ears.teach(label, { ui: true })`, exposes `ears`, the promise outcome, a button used for the focus-return test, an `h1` and two page rules (as in `listen.html`), and options in the URL for `storageKey`, `source`, `sounds` and `debug`. Run `npm run test:web` and confirm all existing tests still pass.
  - [x] 3.3 `test/web/teach.spec.ts`: tests 17 to 26 of the table. The title of no test contains `smoke`. Use a new browser context per microphone test and a unique `storageKey` per test. Run `npm run test:web` and confirm the new tests FAIL because the feature does not exist (not because of the page, the fixture or the setup).

- [x] 4. Pure code
  - [x] 4.1 `web/teach-ui/state.ts`: implement requirement 2. Run `test/teach-state.test.ts` until tests 1 to 6 pass.
  - [x] 4.2 `web/teach-ui/format.ts`: implement requirement 3. Run until test 7 passes.
  - [x] 4.3 If step 1.3 found the validation inline in `loadSounds`, move it to a function in `web/` that `loadSounds` calls, with no change in behavior. Run the existing `loadSounds` tests before and after.
  - [x] 4.4 `web/teach-ui/storage.ts`: implement requirement 5 with the validation function. Run `test/teach-storage.test.ts` until it passes.

- [x] 5. Worker side
  - [x] 5.1 `web/recorder.ts`: implement requirement 1.3 to 1.5, 1.8 and 1.10 (fresh `Segmenter`, chunks, ids, thumbnails, limit). Run the recorder tests until tests 8, 11, 13 (segments part) and 14 (limit) pass.
  - [x] 5.2 `web/protocol.ts`: add the messages, the `recorder` and `sounds` fields of the Worker state, the handlers for `record-start`, `record-stop`, `record-end`, `record-cancel`, the shared rebuild function (also used by `replaceSounds`, whose behavior stays the same) and the envelope counter reset for the record paths only. Run `test/teach-recorder.test.ts` and `test/protocol.test.ts` until they pass.
  - [x] 5.3 Search `web/recorder.ts` and `web/protocol.ts` for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `indexedDB`, `Image`, `localStorage` and confirm no hit.
  - [x] 5.4 Measure the training time of `record-stop` for the fixture model and for one with 200 background examples. Record both in `design.md`. If it takes more than a few seconds, report it in the devlog and go on.

- [x] 6. The dialog
  - [x] 6.1 `web/teach-ui/teach-dialog.ts`: implement requirement 4 against the controller seam. Build with `createElement` and `textContent`. Keep the style as a string in the file. Reuse `drawWaveform` for thumbnails or the local function, as decided in step 1.6.
  - [x] 6.2 Add any new colour to `web/overlay/theme.ts` (or reuse the existing ones), and add its pair to the contrast test. Record the computed ratios.
  - [x] 6.3 Search `web/teach-ui/` for the words of requirement 8.3 and confirm no hit (`localStorage` only in `storage.ts`).

- [ ] 7. `listen()` wiring
  - [x] 7.1 `web/listen.ts`: `storageKey` and the start-up replace (with the throwaway-engine check and the warning), the `sounds` getter, `teach` with its validation and the controller, the shared apply-a-model function, overlay re-mount, `exportSounds`, `importSounds`, the dropped `match` messages and ignored `pause`/`resume` while the dialog is open, and `stop()` closing the dialog. Update the doc comment of `listen()` (requirement 6.9, design finding 5).
  - [x] 7.2 Run `npm run test:web` until the new Playwright tests pass. If the segment count in the teaching WAV is not `WEB_TEST_TEACH_COPIES`, stop and report the evidence (design, "E2E timing") before changing an expectation.
  - [ ] 7.3 (optional, not run) Run the keyboard and reduced-motion tests by hand once in the shown browser if Playwright can be started with a window (optional), to look at the dialog. Do not commit a screenshot.

- [x] 8. Finish
  - [x] 8.1 (`PBT_RUNS=1000` was run for the two new property test files only, as the task instructions said, not for the whole suite) Run `npm test`, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc -p tsconfig.test-web.json --noEmit`, `npm run build`, `npm run check:public-api` and `npm run test:web`. All must pass. Run `PBT_RUNS=1000 npm test` once.
  - [x] 8.2 Confirm `npm run test:web -- --grep smoke` still runs in under 20 seconds.
  - [x] 8.3 Fill in every item of "Measured values" in `design.md`.
  - [x] 8.4 Add one line to `docs/devlog.md` (what was added, the stale-model risk, the training time, anything that differed from this spec).
  - [x] 8.5 Remove any temporary file or script created while working. Check `git status` shows only intended files.
  - [x] 8.6 Commit with the message `feat: add in-app teach dialog`.
