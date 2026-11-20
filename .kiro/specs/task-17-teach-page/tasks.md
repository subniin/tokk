# Tasks: Task 17, developer teach page `teach.html`

Order is test-first. Do not write `web/teach-page/files.ts`, `web/clips.ts`, the new messages in `web/protocol.ts`, the dialog options, `web/teach-page.ts` or `teach.html` before the tests that cover them exist and fail. After every step that touches code, `npm test`, `npx tsc --noEmit` and `npx tsc -p tsconfig.web.json --noEmit` must still pass (apart from the new tests that are meant to fail). If installed Chrome cannot be launched by Playwright, stop and report. Do not download a browser. Do not change `test/public-api.test.ts`. Do not change `scripts/sounds-rebuild.ts` or `core/`. Do not weaken a test to pass it. The byte-equality of the E2E `sounds.json` was replaced by the model comparison of design finding 9 on the operator's decision, after the measurement of the Math differences between Node and Chrome. If a test shows that a rule in `design.md` is wrong, change `requirements.md` and `design.md` first and say why in `docs/devlog.md`.

- [ ] 1. Check prerequisites and the facts of the spec
  - [ ] 1.1 (ran before the first change, all except `npm run check:public-api`, which ran in 7.1: 646 passed, 2 todo; 23 web tests passed) Run `npm test`, the three type checks (`tsconfig.json`, `tsconfig.web.json`, `tsconfig.test-web.json`), `npm run build`, `npm run check:public-api` and `npm run test:web` once. Note that they pass, the vitest count, the runtimes and the size of `dist/tokk.js`.
pm run check:public-api, which ran in 7.1: 646 passed, 2 todo; 23 web tests passed) Run `npm test`, the three type checks (`tsconfig.json`, `tsconfig.web.json`, `tsconfig.test-web.json`), `npm run build`, `npm run check:public-api` and `npm run test:web` once. Note that they pass, the vitest count, the runtimes and the size of `dist/tokk.js`.
  - [x] 1.2 Confirm the facts in `requirements.md` ("Introduction"): the target path, text format, refusal and `TooFewExamplesError` behaviour of `scripts/sounds-rebuild.ts`; the listing rule of `node/teach.ts`; `writeWav` and `readWav` in `core/wav.ts`; the synchronous `onSave` and `replaceLine` in the dialog; the dev server serving the root on port 5173.
  - [x] 1.3 Read `web/protocol.ts`, `web/recorder.ts`, `web/worker.ts` and `web/worker-factory.ts`. Confirm that a record-only `init` and `record-start` without an engine fit `handle` with additive branches only, and that `test/protocol.test.ts` and `test/teach-recorder.test.ts` need no change.
  - [ ] 1.4 (not run as a separate check; see design "Measured values") In the installed Chrome through Playwright, check once with a throwaway script (deleted afterwards) that an OPFS directory handle supports `entries()`, `getDirectoryHandle`, `getFileHandle` and `createWritable()` on the main thread, and that `addInitScript` can replace and delete `window.showDirectoryPicker`. Record the result in `design.md`. If `createWritable` is missing, stop and report.
  - [ ] 1.5 (not run) Check which of `showDirectoryPicker`, `queryPermission`, `requestPermission`, directory async iteration and `webkitRelativePath` the installed `lib.dom` types have. Record the missing ones.
  - [x] 1.6 Read `core/segment.ts` and `core/constants.ts` for the pre-roll and hangover of a segment. Choose `WEB_TEACH_PAGE_CLIP_MARGIN_MS` (design, "Clips") and record why.
  - [x] 1.7 Read `test/web/global-setup.ts`, `fixture.ts`, `paths.ts` and `teach.spec.ts` for the teaching WAV, the per-test Chrome launch, the rate of the fixture and the synth label helpers that the seed can reuse.
  - [x] 1.8 Read `web/teach-ui/format.ts` `savedLine` for a `null` argument, and `web/overlay/format.ts` `sampleRateWarning`.

- [ ] 2. Write the failing vitest tests
  - [x] 2.1 Add the constants of requirement 9.5 to `web/constants.ts`.
  - [x] 2.2 `test/teach-page-files.test.ts`: tests 1 to 7 of the table in `design.md`. Create `web/teach-page/files.ts` as a stub that exports the functions with wrong results, so the tests fail for behaviour and not for a missing import. Tests 3 and 6 use a temp folder in Node and remove it in `afterEach`. Run and confirm FAIL.
  - [x] 2.3 `test/teach-clips.test.ts`: tests 8 to 12, with the synth impacts and noise bed of the existing test helpers, named constants with units, and `PBT_RUNS` for test 9. Create `web/clips.ts` as a stub and add the new message types to `web/protocol.ts` with no handling yet. Run and confirm FAIL.

- [ ] 3. Write the failing Playwright tests
  - [x] 3.1 `test/web/paths.ts`: `DEV_TEACH_PAGE_URL` and the seed folder path. `test/web/global-setup.ts`: write the seed wav files of `low` and `mid` at the teaching WAV's rate. Run the global setup alone and confirm the folder stays small and the Node `teachFromDir` trains the seed folder.
  - [x] 3.2 `test/web/teach-page.spec.ts`: tests 13 to 15 of the table, with the OPFS stand-in through `page.addInitScript` (design, "Test hook"), the per-test Chrome launch with the teaching WAV, the copy-out and `runSoundsRebuild` comparison in Node, and the temp folder removed in `finally`. The title of no test contains `smoke`. Run `npm run test:web` and confirm the new tests FAIL because the page does not exist yet (not because of the setup), and that all existing tests still pass.

- [ ] 4. Pure code and the Worker
  - [x] 4.1 `web/teach-page/files.ts`: implement requirement 6 and the helpers of design "Names and paths". Run `test/teach-page-files.test.ts` until it passes.
  - [x] 4.2 `web/clips.ts`: implement design "Clips". Run tests 8 and 9 until they pass. If test 9 finds a clip with zero or two segments, change the margin rule in `design.md` first, then the code.
  - [x] 4.3 `web/protocol.ts`: the record-only `init`, `record-stop { clips }`, `record-clips`, `teach-recordings`, `teach-result`, `teach-failed`, and their buffers in `transferListOf`. Run `test/teach-clips.test.ts`, `test/protocol.test.ts` and `test/teach-recorder.test.ts` until they pass.

- [ ] 5. Dialog options, bundle and page
  - [x] 5.1 `web/teach-ui/teach-dialog.ts` (and `format.ts` if step 1.8 needs it): `existingLine` and the async `onSave` with `text` (design, "Dialog changes"). Run `npm run test:web -- teach.spec` and confirm the Task 16 tests pass unchanged.
  - [x] 5.2 `scripts/build.ts`: build `web/teach-page.ts` into `dist/teach-page.js` in the dev server with the Worker source plugin and watch; `npm run build` unchanged. Run `test/build.test.ts`.
  - [x] 5.3 `web/teach-page.ts` and `teach.html`: requirements 1 to 8. Folder access, listing and reading, the name input, the controller, the candidate and Save path, the read-back check, the fallback input and downloads, Test now. Build every node with `createElement` and `textContent`.
  - [x] 5.4 Check the page's text and focus colours with the contrast helper of the overlay theme test, and add the pairs to that test if they are new. Record the ratios.
  - [x] 5.5 Run `npm run test:web` until tests 13 to 15 pass. If the page finds a segment count other than 10 in the teaching WAV, or the two `sounds.json` models disagree in the sense of design finding 9, stop and report the evidence before changing anything.
  - [x] 5.6 Search `web/teach-page.ts`, `web/teach-page/` and `web/clips.ts` for the words of requirement 9.1 and confirm no hit.

- [ ] 6. Person check (by hand, optional for the commit)
  - [ ] 6.1 (not run: needs a person with a real microphone) `npm run dev`, open `http://localhost:5173/teach.html` in Chrome, pick a scratch copy of a project folder, teach one sound with a real microphone, use Test now and Stop, and run `npm run sounds:rebuild <folder>/sounds` to compare. Record the result in `docs/devlog.md`. Do not commit the recordings.

- [ ] 7. Finish
  - [x] 7.1 Run `npm test`, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc -p tsconfig.test-web.json --noEmit`, `npm run build`, `npm run check:public-api` and `npm run test:web`. All must pass. Run `PBT_RUNS=1000` for `test/teach-clips.test.ts` once.
  - [x] 7.2 Confirm `npm run test:web -- --grep smoke` still runs in under 20 seconds.
  - [ ] 7.3 (filled in except the training time, which was not measured) Fill in every item of "Measured values" in `design.md`.
  - [x] 7.4 Add one line to `docs/devlog.md` (what was added, the URL, the folder rule, the add-only re-teach rule, the model comparison result (finding 9), anything that differed from this spec).
  - [x] 7.5 Remove any temporary file or script created while working, including the OPFS check of step 1.4. Check `git status` shows only intended files.
  - [x] 7.6 Commit with the message `feat: add teach page`.
