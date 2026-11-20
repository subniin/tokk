# Tasks: Task 15, debug overlay

Order is test-first. Do not write `web/overlay/*`, the `onSegment` change in `core/engine.ts`, the `segment` message, the `debug` wiring in `web/listen.ts`, `.kiro/steering/ui.md` or the plain `process(inputs)` method before the tests that cover them exist and fail. After every step that touches configuration or code, `npm test`, `npx tsc --noEmit` and `npx tsc -p tsconfig.web.json --noEmit` must still pass (apart from the new tests that are meant to fail). If installed Chrome cannot be launched by Playwright, stop and report. Do not download a browser. Do not change `test/public-api.test.ts`.

- [x] 1. Check prerequisites and the preliminary cleanup facts
  - [x] 1.1 Run `npm test`, the three type checks (`tsconfig.json`, `tsconfig.web.json`, `tsconfig.test-web.json`), `npm run build` and `npm run test:web` once. Note that they pass (baseline), the vitest count (Task 14 recorded 474 passed, 2 todo), the runtime of both suites and the size of `dist/tokk.js`.
  - [x] 1.2 Confirm the facts in `requirements.md` ("Introduction"): `web/listen.ts` has the `route` function with `event` and `envelope` cases that do nothing; `web/protocol.ts` has the open unions and `msToSamples`; `core/engine.ts` calls `onEvent` for pitch, sound and unknown, and skips `background` without an event; a `sound` event has no `nearest`; `web/overlay/`, `.kiro/steering/ui.md` and `docs/images/` do not exist.
  - [x] 1.3 Read `classify` in `core/engine.ts` again. Confirm that one call `onSegment?.(...)` right after the classifier call, after the voiced-range `continue`, can report every outcome without a change of event order or timing (requirement 2.7). If it cannot, stop and report.
  - [x] 1.4 Search `web/` and `test/` for word-dodging tricks (`'proc'`, `"proc"`, string concatenation that builds `process`, `require`, `fs`, `path`, `zlib`) and for every place that calls the worklet method by a computed key (`test/worklet.test.ts` first). Record every hit in `design.md` ("Measured values").
  - [x] 1.5 Search `web/` and `test/` for `requestAnimationFrame` and `matchMedia`. Record whether anything besides the code of this task would call `requestAnimationFrame` in the test page (used in step 7).
  - [x] 1.6 Read `thresholds` in the fixture model (`test/web/generated/sounds.json` after a run) and confirm the labels `low`, `mid`, `high`, `ring` each have a threshold. Note whether a `background` threshold ever exists in a model made by `teachFromRecordings`.
  - [x] 1.7 Read `scripts/build.ts` and confirm the esbuild options of the browser bundle (target, platform, no minify), to build the probe of step 2.2 with the same shape. Read `test/helpers/resample.ts` and `test/helpers/engine-fixture.ts` for the helpers the fixture needs.
  - [x] 1.8 Read `.kiro/steering/web-audio.md` and `integrate.md` for the front matter and style to copy into `ui.md`.
  - [x] 1.9 Decide whether the segment tests live in `test/engine-segment.test.ts` or in `test/protocol.test.ts` (prefer a new file if the protocol file is long). Record the decision in `design.md`.

- [x] 2. Write the failing vitest tests for the cleanup and the core change
  - [x] 2.1 `test/node-globals.test.ts` with the table of flagged and not-flagged snippets of requirement 1.3 and 1.4, and `test/helpers/node-globals.ts` as an empty stub that exports `findNodeGlobalUse` returning the wrong answer (so the tests fail for the behavior, not for a missing import). Run and confirm FAIL.
  - [x] 2.2 In the same test file, the probe test of requirement 1.7: bundle an in-memory entry with `export const x = process.env.X;` with esbuild in the browser shape of step 1.7 and expect `findNodeGlobalUse` to flag the output. Also expect no flag for a bundle of a class with a `process(inputs)` method. Run and confirm FAIL.
  - [x] 2.3 `test/worklet.test.ts`: add the test of requirement 1.9 (`WORKLET_SOURCE` contains `process(inputs)` and no quoted `'proc'`). If the file calls the method by a computed key, change the call to `.process(...)`. Run and confirm the new test FAILS and the others pass.
  - [x] 2.4 `test/build.test.ts`: replace the `process` word check on `dist/tokk.js` by `expect(findNodeGlobalUse(text)).toEqual([])`, and express the `require(`, `node:`, `fs`, `path` and `zlib` checks through the same function (requirement 1.6). Run it against the current build: it passes (the build is clean). That is expected: this test is made stronger, not failing. Confirm with the probe of 2.2 that a `process.env.X` in the bundle would fail it.
  - [x] 2.5 The segment tests of requirement 2.6, in the file chosen in step 1.9. Use `test/helpers/engine-fixture.ts` signals and `runSamples` as the oracle for the unchanged output, a direct `createEngine` run with `onSegment` as the oracle for the messages, `PBT_RUNS` for the run count and a named timeout with a unit. Run and confirm FAIL (no option, no message).
  - [x] 2.6 Write the changes to `design.md` and `docs/devlog.md` that name the build test change: it tightens the check from the word `process` to Node global use, and does not let a bug pass.

- [x] 3. Write the failing vitest tests for the overlay's pure code
  - [x] 3.1 `test/overlay-format.test.ts`: tests 6, 7 and 8 of the table in `design.md`, including the property test (no `NaN`, `undefined` or `Infinity`, label always in the text, match row starts with `Pattern`). Create `web/overlay/format.ts` as a stub that exports the functions with wrong results so the tests fail for behavior. Run and confirm FAIL.
  - [x] 3.2 `test/overlay-waveform.test.ts`: tests 9 and 10, including the property test that compares `view()` with a direct computation. Create `web/overlay/waveform.ts` as a stub. Add the constants of requirement 3.1 to `web/constants.ts` first (they are needed by the tests). Run and confirm FAIL.
  - [x] 3.3 `test/overlay-theme.test.ts`: test 11, with the contrast formula inside the test. Create `web/overlay/theme.ts` with the named colours as a first draft (a failing pair is expected to show the test works). Run and confirm FAIL, or, if the draft already passes, change one pair to a failing value, see it fail, and put the real value back (note it in the devlog).

- [x] 4. Write the failing Playwright tests
  - [x] 4.1 `test/web/fixture.ts` and `test/web/paths.ts`: write the second model at `WEB_TEST_MISMATCH_SAMPLE_RATE_HZ` (44100) from the same teaching set at that rate to `sounds-44100.json`, with the URL and path constants (requirement 10.2). Keep the Task 14 check. Run the global setup alone and confirm the folder stays below 2 MB.
  - [x] 4.2 `test/web/listen.html`: add `?debug=1`, the `<h1>` and the two page rules (requirement 10.1). Run `npm run test:web` and confirm that the four Task 14 tests still pass.
  - [x] 4.3 `test/web/instrument.ts`: add the option `countAnimationFrames` that wraps `window.requestAnimationFrame` and exposes the count through `readInstrumentation`. The wrapper calls the original and changes no behavior.
  - [x] 4.4 `test/web/overlay.spec.ts`: tests 12 to 19 of the table, with the test-only constants at the top. The title of no test contains `smoke`. Use the WAV source and compute every expected count with `runSamples` in Node. Run `npm run test:web` and confirm the overlay tests FAIL because the overlay does not exist (not because of the page, the fixture or the setup), and that the four Task 14 tests pass.

- [x] 5. Cleanup and core change
  - [x] 5.1 `web/worklet-source.ts`: write the method as `process(inputs)`, delete the computed key and its comment (requirement 1.1). Run `test/worklet.test.ts` and `test/build.test.ts`.
  - [x] 5.2 `test/helpers/node-globals.ts`: write `findNodeGlobalUse` (patterns in `design.md`, "The `process` cleanup"). Run `test/node-globals.test.ts` and `test/build.test.ts`, run `npm run build`, and confirm both pass. Write the known limit (a text check is not a parser) as a comment at the top of the helper.
  - [x] 5.3 `core/engine.ts`: add `SegmentReport`, the `onSegment` option and the one call (requirement 2.1 to 2.3). Run the whole engine test group and `npm test`; no existing test changes.
  - [x] 5.4 `web/protocol.ts`: add the `segment` message, pass `onSegment` in `buildEngine`, keep the order of requirement 2.4. Run the segment tests and `test/protocol.test.ts` and fix the code until they pass. Do not weaken a test. If a test shows that a rule in `design.md` is wrong, change `requirements.md` and `design.md` first and say why in the devlog.

- [x] 6. Pure overlay code
  - [x] 6.1 `web/overlay/format.ts`: implement requirement 4. Run `test/overlay-format.test.ts` until it passes.
  - [x] 6.2 `web/overlay/waveform.ts`: implement requirement 5 and the redraw decision of requirement 7.4. Run `test/overlay-waveform.test.ts` until it passes.
  - [x] 6.3 `web/overlay/theme.ts`: choose the final colours (dark panel, light text, Okabe-Ito label palette without black, two greys) and run `test/overlay-theme.test.ts` until it passes. Record the computed ratios in `design.md`.

- [x] 7. DOM part and `listen()`
  - [x] 7.1 `web/overlay/draw.ts`: `drawWaveform(ctx, view, colours)` with bins, baseline, marks (solid, grey, dashed), label text with a halo, and the minimum mark width (requirement 6.5, 6.6, 6.11). No state, no DOM except the context type.
  - [x] 7.2 `web/overlay/overlay.ts`: `mountOverlay` (requirements 6 and 7): host, open shadow root, `all: initial` reset, header with title, badge and button, body with canvas, warning line and rows, the two redraw schedules and the media-query listener, deferred mount if `document.body` is missing, `destroy()` that is safe twice. Build with `createElement` and `textContent`. No `innerHTML` with data.
  - [x] 7.3 `web/listen.ts`: `debug` wiring (requirement 8), `tryMount`, the three `route` cases, `setState` on pause and resume, `destroy` on stop and on the failure path, and the updated comment on `debug`. Run all three type checks and `npm test`.
  - [x] 7.4 Run `npm run build`. Check that `dist/tokk.js` still has no Node global use (the new check), still imports in Node without a DOM (nothing at import time touches `document` or `matchMedia`) and note its size.
  - [x] 7.5 Run `npm run test:web`. Fix the code until the overlay tests and the four Task 14 tests pass. Read the result of the `requestAnimationFrame` count (step 1.5): if it is not usable as the proof, change that test as `design.md` says and record why.
  - [x] 7.6 Check by hand in the test page URL (`/test/web/listen.html?debug=1&...`) that Tab reaches the button, that the panel does not cover the start button of the page when collapsed, and whether the row list needs `tabindex="0"` (record it).
  - [x] 7.7 Run `npm run test:web` three times in a row and confirm that it does not flake. If a test flakes, find the cause. Do not add retries.

- [x] 8. Steering file and rules check
  - [x] 8.1 Create `.kiro/steering/ui.md` (requirement 9) in the style of step 1.8. It must hold: reduced motion, results as text, no Halloween in the template and app 1, English text, keyboard and accessible names, Shadow DOM for debug and teach panels, contrast 4.5 to 1. It does not repeat the other steering files.
  - [x] 8.2 Search `web/overlay/` and `web/listen.ts` for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `localStorage`, `indexedDB`, `Image`, `innerHTML`. Confirm the only hits are the existing WAV GET in `listen.ts`, and none in `web/overlay/`.
  - [x] 8.3 Check that `web/overlay/format.ts`, `waveform.ts` and `theme.ts` have no DOM type and no Node import (the base `tsc` accepts a vitest file that imports them), that `core/` has no DOM use, that every time and size constant has a unit in its name, that no sample count is typed, that no clock is used for a shown time, and that `window.matchMedia` and `document` are not touched at import time.
  - [x] 8.4 Check that `debug` off creates nothing: run the `no overlay without debug` test and read `listen.ts` once more for any overlay call outside an `if (overlay)` guard.
  - [x] 8.5 Run `npm run check:public-api`, `npm run mcp` (start and stop it, or run its test) and confirm the other hooks and `npm run sounds:rebuild` are unaffected. Confirm that `test/public-api.test.ts` is unchanged.
  - [x] 8.6 Check that no Korean text is in tracked files outside `docs/_planning/`.

- [x] 9. Screenshot
  - [x] 9.1 Run the screenshot test once with `TOKK_WRITE_SCREENSHOT=1` so it writes `docs/images/overlay.png`. Open the file and check that it shows the waveform, marks with their text, rows with `confidence`, `nearest` and `distance`, one bold `Pattern` row, the `Listening` badge and no warning. If the first impact is cut off, take it earlier as `design.md` says.
  - [x] 9.2 Check the file size is under 100000 bytes and record it. Run the test again without the variable and confirm that it does not change the file (`git status` shows the image as added once).

- [x] 10. Verify and commit
  - [x] 10.1 Fill in "Measured values" of `design.md` (every item of that list).
  - [x] 10.2 Run `npm test`, `npm run test:web`, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc -p tsconfig.test-web.json --noEmit`, `npm run build` and `npm pack --dry-run`. All pass, and the pack list is unchanged except for new type files (`docs/images/` is not in the package).
  - [x] 10.3 Run `PBT_RUNS=1000 npx vitest run test/protocol.test.ts test/overlay-waveform.test.ts test/overlay-format.test.ts` once and note the result and the time.
  - [x] 10.4 Add the line of requirement 12.6 to `docs/devlog.md`.
  - [x] 10.5 Remove every temporary file (probe files, scratch scripts) and confirm that `git status` shows only the intended files: `core/engine.ts`, `web/constants.ts`, `web/protocol.ts`, `web/listen.ts`, `web/worklet-source.ts`, `web/overlay/*`, `test/helpers/node-globals.ts`, `test/node-globals.test.ts`, `test/build.test.ts`, `test/worklet.test.ts`, `test/engine-segment.test.ts` (or `test/protocol.test.ts`), `test/overlay-format.test.ts`, `test/overlay-waveform.test.ts`, `test/overlay-theme.test.ts`, `test/web/overlay.spec.ts`, `test/web/listen.html`, `test/web/fixture.ts`, `test/web/paths.ts`, `test/web/instrument.ts`, `docs/images/overlay.png`, `.kiro/steering/ui.md`, `docs/devlog.md` and this spec. `test/web/generated/`, `test-results/`, `playwright-report/` and `dist/` stay ignored.
  - [x] 10.6 Commit with the message `feat: add debug overlay`.
