# Requirements: Task 15, debug overlay

## Introduction
Task 15 is the fourth task of plan 2 (browser layer). It adds the debug overlay: one small panel on the page that shows what the engine hears, so a developer can see why a sound was or was not recognised. `listen({ debug: true })` mounts it. It shows a rolling 5 s waveform, marks for every classified segment, the last 20 rows of results with the nearest example and its distance, bold rows for pattern matches, a sample-rate warning, and a state badge. It is also the first task that uses the `event` and `envelope` messages that Task 14 left unused.

The task has a preliminary cleanup. Task 14 wrote the worklet method as `['proc' + 'ess']` only so that the text of `dist/tokk.js` has no `process` word, because the build test banned that word. That is a workaround for a test that is too blunt. The test is changed to look for real Node global use, and the method is written plainly.

Task 14 left these files that this task builds on: `web/listen.ts` (one routing function `route` with `event` and `envelope` cases that do nothing, `debug` accepted and ignored), `web/protocol.ts` (message unions open to new members, `msToSamples`, `handleWorkerMessage`), `web/constants.ts`, `web/worklet-source.ts`, `test/build.test.ts`, `test/web/` (`fixture.ts`, `instrument.ts`, `paths.ts`, `global-setup.ts`, `listen.html`, `listen.spec.ts`) and `playwright.config.ts`.

| Consumer | What it uses from this task |
|---|---|
| Task 16 (`ears.teach`) | `setState('teaching')`, the waveform drawing function (`web/overlay/draw.ts`) and the pure waveform window (`web/overlay/waveform.ts`) for the segment cells, the `segment` message |
| Task 17 (`teach.html`) | "Test now" runs `listen({ debug: true })` and shows events in this overlay |
| Task 19 (`examples/hello`) | `debug: true`, `docs/images/overlay.png` for the README |
| Task 18 (power, agents) | `.kiro/steering/ui.md` is part of what the power ships |

Facts checked before this spec was written (the first task step checks them again):
- `core/engine.ts` calls `onEvent` for pitch events (`continuous`), for `sound` events (after the classifier said `match` for a label other than `background`) and for `unknown` segments. A segment that the classifier assigns to `background` produces no event at all. The `sound` event has `label`, `t`, `durationMs` and `confidence`, and has no `nearest`. Only `unknown` carries `nearest`.
- So the `event` messages of Task 14 cannot give an overlay row the nearest example and the distance for a match, and cannot give a `background` mark. The plan's wording ("`nearest.id`, distance / that label's threshold", "background = dashed") needs data that no current message carries. Requirement 2 adds that data with an additive callback. This is a finding of this spec and it is the one change in `core/`.
- `SoundModel.thresholds` is a record from label to threshold. `Nearest` is `{ id, label, distance }` with `id` = `<label>/<file>#<segment index>`.
- `EngineEvent` and `Handlers` are exported from `core/engine.ts` and not from `core/index.ts`. `web/` imports them by relative path.
- The `envelope` message has `t0` (seconds), `min` and `max` (`Float32Array`), one pair per `WEB_ENVELOPE_RESOLUTION_MS` (10 ms) bin, counted over the whole session and continuous across `replaceSounds`.
- The fake microphone in Chrome may deliver any context rate. The WAV source gives the rate of the file (48000 Hz for the fixture) and needs no gesture, so the overlay E2E tests use the WAV source for exact numbers.
- `.kiro/steering/` has `web-audio.md`, `integrate.md` and others with front matter `inclusion: fileMatch` and `fileMatchPattern`. `ui.md` does not exist yet.

## Requirements

### Requirement 1: Preliminary cleanup of the `process` workaround
**User story:** As a maintainer, I want the worklet to be written in plain code, and I want the build test to catch real Node use instead of a word.

#### Acceptance Criteria
1. `web/worklet-source.ts` SHALL define the processor method as `process(inputs)` in plain form. THE computed key `['proc' + 'ess']` and the comment that explains it SHALL be removed. THE method SHALL behave exactly as before (same body, returns `true`).
2. THE text of `web/` and `dist/tokk.js` SHALL contain no other trick to avoid a word of a test (search for string concatenations that build `process`, `require`, `fs`, `path` or `zlib`, and record the result in `design.md`).
3. `test/build.test.ts` SHALL replace the check `not.toMatch(/\bprocess\b/)` on `dist/tokk.js` by a check for real Node global use. THE check SHALL be one exported-from-helper function `findNodeGlobalUse(text): string[]` in `test/helpers/node-globals.ts` that returns the offending snippets, and the build test SHALL expect an empty list. THE function SHALL flag at least:
   - `process` as an object: `process.` member access (`process.env`, `process.nextTick`, `process.platform`), `process?.`, `process[`, `typeof process`, `globalThis.process`, `window.process`, `self.process`;
   - `require(` with any spacing;
   - `__dirname` and `__filename`;
   - `module.exports` and `exports.` assignment of CommonJS;
   - `import` or `from` of a `node:` specifier, and a dynamic `import("node:...")`;
   - `import` or `from` of the bare `fs`, `path` or `zlib` specifiers, with or without a subpath.
4. THE function SHALL NOT flag: a method named `process` that is defined or called without the `process.` object form (`process(inputs) {`, `class X { process(inputs) { ... } }`, `registerProcessor`, `processorOptions`, `AudioWorkletProcessor`), the word `process` inside an English comment or a plain sentence of a string, or an identifier that only contains the letters (`processing`, `subprocess`).
5. THE exclusion in 4 SHALL be decided by the syntax around the word, not by a list of allowed files, so that `process.env.X` in any file under `web/` still fails the test.
6. THE existing checks of the same test (`fs`, `path`, `zlib` import specifiers, `node:`, `require(`) SHALL stay, and SHALL be expressed through the same function so there is one list.
7. THE helper SHALL have its own test (`test/node-globals.test.ts`) with a table of flagged and not-flagged snippets (all of 3 and 4), and one test that bundles a small in-memory entry containing `export const x = process.env.X;` with esbuild in the browser configuration and shows that the function flags the bundle output. This proves the check works on bundler output and that `process.env.X` still fails.
8. THE change in `test/build.test.ts` SHALL be named in `design.md` as a test change that tightens the check from "a word" to "Node global use", not a change that lets a bug pass.
9. `test/worklet.test.ts` SHALL get one test that `WORKLET_SOURCE` contains the text `process(inputs)` and contains no quoted `'proc'`. If that test file calls the method by a computed key, the call SHALL be changed to `.process(...)`.

### Requirement 2: Segment reports from the engine and the `segment` message
**User story:** As a developer reading the overlay, I want every classified segment as a row with its nearest example and distance, also when it was ignored as background.

#### Acceptance Criteria
1. `core/engine.ts` SHALL get one new optional option `onSegment`, called once for every segment that the classifier looked at, in the order of segments, before the matcher sees the event of that segment. THE argument SHALL be `{ t, durationMs, result }` with `t` in seconds (the segment start, as it is today), `durationMs`, and `result` the `ClassifyResult` of the classifier (`match` with `label`, `confidence`, `nearest`, or `unknown` with `nearest`). A segment whose label is `background` SHALL be reported with `result.kind` `match` and `label` `background`.
2. THE segments that the engine skips because they overlap a voiced (humming) range SHALL NOT be reported (they are not classified).
3. THE option SHALL change nothing else: events, matches, timing and the output of `runSamples` SHALL be identical with and without it. `core/index.ts` and the public API SHALL NOT change. THE exported type of the argument SHALL live in `core/engine.ts` and SHALL NOT be added to `core/index.ts` (`web/` imports it by relative path, as it does `EngineEvent`).
4. `web/protocol.ts` SHALL add a Worker to main message `segment` with fields `t`, `durationMs` and `result`. `buildEngine` SHALL pass `onSegment` and append a `segment` message. IN one `chunk` call, the `segment` message of a segment SHALL come before the `event` and `match` messages that segment produced, and the `envelope` message SHALL stay last. THE message SHALL survive `structuredClone`.
5. THE existing `event` and `match` messages SHALL stay unchanged, so `test/protocol.test.ts` tests 1 to 7 of Task 14 pass unchanged. No existing test changes for this requirement.
6. NEW tests (`test/protocol.test.ts` or `test/engine-segment.test.ts`, chosen in the first task step): over the same signals as the P3 property test, the `segment` messages equal the `onSegment` calls of a direct engine run on the whole signal (same count, same order, same values), at random chunk sizes; the count of `segment` messages equals the count of `sound` events plus `unknown` events plus background segments; a `background` segment gives no `event` message; with `onSegment` absent the engine output is identical to before (compare `runSamples` on a fixed signal).
7. IF the first task step finds that the engine cannot report a segment in this way without changing event order or timing, THE implementer SHALL stop and report. Rewriting `core/` is outside this task.

### Requirement 3: Constants
**User story:** As a maintainer, I want every time value and size of the overlay to be named with its unit.

#### Acceptance Criteria
1. `web/constants.ts` SHALL get: `WEB_OVERLAY_WINDOW_MS` (5000, the length of the rolling waveform), `WEB_OVERLAY_MAX_ROWS` (20, a count of rows, the name says so), `WEB_OVERLAY_REDRAW_REDUCED_MOTION_MS` (1000), `WEB_OVERLAY_WIDTH_PX`, `WEB_OVERLAY_WAVEFORM_HEIGHT_PX`, `WEB_OVERLAY_Z_INDEX` and the number of decimals used in the row text (`WEB_OVERLAY_TIME_DECIMALS`, `WEB_OVERLAY_CONFIDENCE_DECIMALS`, `WEB_OVERLAY_DISTANCE_DECIMALS`). THE values of the sizes are chosen in `design.md`. No other constant SHALL be added without a name and a unit in `design.md`.
2. THE number of waveform bins in the window SHALL be derived from `WEB_OVERLAY_WINDOW_MS` and `WEB_ENVELOPE_RESOLUTION_MS`, not typed. NO sample count SHALL be hard-coded in `web/overlay/`.
3. EVERY time `t` that the overlay shows or uses SHALL come from the messages (a cumulative sample count divided by the sample rate). THE time of bin `i` of an envelope message SHALL be `t0` plus `i` times the bin length in samples (from `msToSamples` and the sample rate) divided by the sample rate. NO clock (`Date`, `performance.now`) SHALL be used to compute a time that is shown or drawn. Timers and `requestAnimationFrame` SHALL only decide when to redraw.

### Requirement 4: `web/overlay/format.ts`
**User story:** As a maintainer, I want the text of the overlay to be pure functions that Node tests can run.

#### Acceptance Criteria
1. `web/overlay/format.ts` SHALL import no DOM type and no Node module (type imports from `core/` and `web/protocol.ts` are allowed), so the base `tsc` accepts a vitest file that imports it.
2. `formatEventRow(report, thresholds)` SHALL take a segment report (requirement 2.1) and the `thresholds` record of the model, and return an object with at least: `kind` (`sound`, `unknown` or `background`), `label` (the label, or the text `unknown`, or `background`), `text` (one line of English), and the parts as separate strings (`time`, `label`, `confidence`, `nearestId`, `distance`, `threshold`) so the DOM can show them in cells.
3. THE `text` SHALL have this order and form (numbers are rounded to the decimals of requirement 3.1, `t` in seconds with the unit `s`):
   - sound: `<t> s  <label>  confidence <c>  nearest <nearest.id>  distance <d> / threshold <th>`
   - unknown: `<t> s  unknown  nearest <nearest.id>  distance <d> / threshold <th>` (no confidence)
   - background: `<t> s  background (no event)  nearest <nearest.id>  distance <d> / threshold <th>`
4. THE threshold SHALL be the threshold of the label that the row shows: the matched label for a `sound`, `nearest.label` for `unknown`, and `background` for a background row. A label that has no threshold, a missing record, or a number that is not finite SHALL give the text `n/a` for the threshold, and a distance that is not finite SHALL give `n/a`. The function SHALL never print `NaN`, `undefined` or `Infinity`.
5. `formatMatchRow(pattern, match)` SHALL return an object with `kind: 'match'`, `bold: true`, the parts and a `text` of the form `Pattern "<pattern>" matched at <t> s`, followed by `  speed <v>` (the same decimals as distance) when `match.speed` is defined. THE word `Pattern` SHALL be in the text, so a match row is recognisable without bold.
6. `sampleRateWarning(micRate, modelRate)` SHALL return `null` when the two rates are equal, and otherwise a text of the form: `Sample rate warning: the input runs at <micRate> Hz but the sounds were taught at <modelRate> Hz. Recognition can be less accurate. Teach the sounds again at this rate.` WHEN `micRate` is 16000, the text SHALL add the sentence: `At 16000 Hz the high-frequency features are empty, so sounds that differ mostly in the high frequencies look alike.` A rate that is not a finite positive number SHALL give `null` (no warning about data that is not there).
7. `stateLabel(state)` SHALL return the English badge text for `listening`, `paused` and `teaching` (`Listening`, `Paused`, `Teaching`).
8. THE functions SHALL be deterministic and have no side effects. THE units rule applies: the rate texts name Hz, the time texts name s.

### Requirement 5: `web/overlay/waveform.ts`
**User story:** As a maintainer, I want the rolling window and the marks to be one pure model, so the drawing code only draws and Task 16 can reuse the model.

#### Acceptance Criteria
1. `web/overlay/waveform.ts` SHALL import no DOM type and no Node module. IT SHALL hold the state of the window: the envelope bins of the last `WEB_OVERLAY_WINDOW_MS`, the marks of the segment reports, and the end time of the data.
2. `pushEnvelope(t0, min, max)` SHALL append the bins and keep only the bins inside the window counted back from the newest bin (so memory is bounded). `pushSegment(report)` SHALL store a mark with start `t`, length `durationMs`, kind and label, and drop marks that end before the start of the window.
3. THE window end SHALL be the time of the end of the newest bin, not a clock. WHEN no envelope arrives (paused), the window SHALL stay where it is.
4. `view()` SHALL return, for the current window, the bins with their x position as a fraction from 0 to 1 and the marks clipped to the window with start and end as fractions. A mark that is partly outside SHALL be clipped, a mark fully outside SHALL not appear.
5. A gap in the envelope (a pause, or a `t0` that is later than the end of the last bin) SHALL be kept as a gap in time (blank), not closed up.
6. A `t0` that is earlier than the end of the data (the Worker restarted with a new `init`) SHALL clear the bins and the marks and start the window again. This is stated in `design.md` with the reason.
7. THE model SHALL be deterministic and its tests SHALL need no browser.

### Requirement 6: `web/overlay/overlay.ts`, `mountOverlay()`
**User story:** As a developer, I want a panel that shows what the engine hears and decides, and does not disturb my page.

#### Acceptance Criteria
1. `mountOverlay(o: { sounds: SoundModel; sampleRate: number })` SHALL return `{ onEnvelope, onEvent, onMatch, setState, destroy }`. `onEnvelope` takes the `envelope` message, `onEvent` takes a segment report (requirement 2.1), `onMatch(pattern, match)` takes the pattern name and the `MatchEvent`, and `setState` takes `'listening'`, `'paused'` or `'teaching'`. THE argument types SHALL come from `web/protocol.ts` and `core/` (type imports). `onEvent` keeps the name of the plan's interface; the reason for the segment-report type is in `design.md`.
2. **One panel in a Shadow DOM.** `mountOverlay` SHALL create one host element and append it to `document.body`, with a fixed position (a corner of the viewport) and a high `z-index`. THE panel SHALL live in a shadow root, so the page's CSS does not apply to it and its CSS does not apply to the page. THE shadow root SHALL be `open` (so tests and assistive tools can reach it). THE host SHALL carry the attribute `data-tokk-overlay` (on the host only), as the one hook for tests and the screenshot clip. THE colour constants SHALL be in `web/overlay/theme.ts` without DOM types, so a vitest test can compute their contrast. THE host SHALL reset inherited styles (`all: initial` or the equivalent in the shadow style) and set its own font, size, colour and line height, so a page rule on `body` does not change the panel's text.
3. **No effect on the page.** `mountOverlay` SHALL NOT add a style sheet, a class, an attribute or a listener to the page's own elements, SHALL NOT change `document.body` styles, and SHALL NOT add the host more than once for one call. IT SHALL NOT take focus when it mounts.
4. **Collapsible.** THE panel SHALL have a header with the title text `Tokk debug`, the state badge and one `<button>` that collapses and expands the body. THE button SHALL be a real button (reachable with Tab, activated with Enter and Space), SHALL have the accessible name `Collapse debug panel` when open and `Expand debug panel` when collapsed (the visible text carries the same words), SHALL set `aria-expanded` and `aria-controls` for the body, and SHALL have a visible focus outline. A collapsed panel SHALL show the header only. THE data SHALL keep being collected while collapsed, and drawing MAY pause.
5. **Waveform.** THE body SHALL have one `<canvas>` of fixed size (`WEB_OVERLAY_WIDTH_PX` by `WEB_OVERLAY_WAVEFORM_HEIGHT_PX` CSS pixels, scaled by the device pixel ratio for sharp lines) with `role="img"` and an English `aria-label` that says it shows the waveform of the last 5 seconds. THE canvas SHALL draw from the model of requirement 5: the min and max of each bin as a vertical line, the newest data at the right edge, a baseline.
6. **Marks.** FOR every segment report THE canvas SHALL draw a mark over the segment's time span:
   - a `sound` (a matched label other than `background`): a solid outline and fill in the colour of that label, with the label text drawn next to the mark;
   - `unknown`: a grey solid outline with the text `unknown`;
   - `background`: a dashed grey outline with the text `background`.
   THE colour of a label SHALL come from a fixed palette indexed by the position of the label in the sorted list of labels of `sounds`, so the same label always has the same colour in one session. A mark SHALL always have its text, and a mark of 1 pixel or less SHALL still be drawn with a minimum visible width. Text SHALL not be drawn outside the canvas.
7. **Rows.** BELOW the canvas an ordered list SHALL show at most `WEB_OVERLAY_MAX_ROWS` rows, newest first. EACH segment report SHALL add one row made by `formatEventRow`, with the parts in separate cells and the full `text` available as the row's accessible text. EACH pattern match SHALL add one row made by `formatMatchRow`, in bold (`font-weight` 700) and starting with the word `Pattern`. THE older rows SHALL be removed from the DOM when there are more than the maximum. THE `pitch` (continuous) events SHALL NOT make rows.
8. **Sample-rate warning.** WHEN `sampleRateWarning(o.sampleRate, o.sounds.sampleRate)` returns text, THE panel SHALL show it in a line under the header, visible also when the body is collapsed, with `role="status"`. WHEN it returns `null`, THE line SHALL not be in the DOM. THE warning SHALL be computed once at mount (the rates do not change in a session).
9. **State badge.** THE badge SHALL show `stateLabel(state)` as text (`Listening` at mount) with `role="status"`. `setState` SHALL change the text. THE badge SHALL not rely on colour alone (it has the word).
10. **destroy().** IT SHALL remove the host element, cancel every timer and animation frame, remove every listener it added, and release the canvas. IT SHALL be safe to call twice. AFTER it, `onEnvelope`, `onEvent`, `onMatch` and `setState` SHALL do nothing and SHALL NOT throw.
11. `mountOverlay` SHALL use the DOM only inside `web/overlay/`. `format.ts` and `waveform.ts` SHALL stay DOM-free. THE drawing of the waveform and the marks SHALL be in `web/overlay/draw.ts` as a function that takes a 2D drawing context, the view from requirement 5 and the colours, and keeps no state, so Task 16 can draw its segment cells with it. `draw.ts` SHALL be the only file that calls the canvas API.
12. THE overlay SHALL send nothing over the network, SHALL NOT store samples, envelope data or rows anywhere (no `localStorage`, no IndexedDB, no file), and SHALL NOT add a `fetch` or an image request. Row text comes from messages already on the page.

### Requirement 7: Reduced motion, text and keyboard
**User story:** As a user who asked for less motion, or who cannot tell colours apart, I want to read the same information.

#### Acceptance Criteria
1. `mountOverlay` SHALL read `window.matchMedia('(prefers-reduced-motion: reduce)')` at mount and SHALL listen for changes of that query, so a change in the system setting takes effect without a reload. IT SHALL remove that listener in `destroy()`.
2. WITHOUT reduced motion, THE canvas SHALL redraw on `requestAnimationFrame` while there is something that changed (new data or a collapsed-to-open change), so the waveform rolls. A frame with no change SHALL NOT redraw.
3. WITH reduced motion, THE canvas SHALL NOT roll. IT SHALL redraw once every `WEB_OVERLAY_REDRAW_REDUCED_MOTION_MS` with a timer, and SHALL NOT call `requestAnimationFrame`. THE rows, the badge and the warning SHALL still update at once (they are text, not motion). THE panel SHALL have no CSS transition or animation in either mode.
4. THE redraw decision (which kind of schedule, and whether a redraw is due) SHALL be a small pure function in `waveform.ts` or `format.ts` that Node tests can run with fake times (no DOM).
5. EVERY recognition result SHALL be readable as text: a mark has its label text on the canvas and its row has the label, the numbers and the word `unknown` or `background` where they apply. NO information SHALL be carried by colour alone (colour, outline style and text together, never only one).
6. ALL text SHALL be English. THE text colour against the panel background SHALL have a contrast ratio of at least 4.5 to 1 (the design names the colours and the ratio computed). THE label colours SHALL be told apart in the marks by their text, and the palette SHALL be chosen to stay distinguishable for the common types of colour-blindness (the design names the source of the palette).
7. THE panel SHALL not trap focus, SHALL not open a dialog, and SHALL not move the focus on its own.

### Requirement 8: `listen({ debug: true })`
**User story:** As a developer, I want `debug: true` to be the only switch.

#### Acceptance Criteria
1. WHEN `debug` is `true`, `listen()` SHALL call `mountOverlay` once, after the engine sample rate is known (the context rate for a microphone, the file rate for a WAV) and after the Worker has been given `init`. THE `sounds` passed SHALL be the model of the options. IF `mountOverlay` throws (for example `document` is missing), `listen()` SHALL log the error with `console.error`, continue without an overlay and SHALL NOT reject.
2. WHEN `debug` is `false` or absent, NO overlay code SHALL run: `listen()` SHALL NOT call `mountOverlay`, SHALL NOT create an element, a style, a canvas, a media-query list or a timer for the overlay, and SHALL NOT read `document`. THE default path SHALL stay as cheap as before this task. A dynamic import is not required. THE size of `dist/tokk.js` before and after SHALL be recorded in `design.md`.
3. THE one routing function of `listen.ts` SHALL pass `segment` messages to `overlay.onEvent`, `envelope` messages to `overlay.onEnvelope` and `match` messages to `overlay.onMatch`, only when an overlay exists. A failure inside an overlay call SHALL be caught and logged with `console.error` and SHALL NOT stop the dispatch of handlers.
4. THE order of work for a `match` message SHALL be: overlay row first, then the user's handler. The handler call SHALL not depend on the overlay.
5. `pause()` SHALL call `setState('paused')` and `resume()` SHALL call `setState('listening')` on the overlay. `setState('teaching')` is for Task 16 and is not called in this task.
6. `stop()` SHALL call `destroy()` on the overlay. After `stop()` no overlay call SHALL be made and the host element SHALL not be in the document.
7. A failed `listen()` (a rejection after the overlay was mounted) SHALL destroy the overlay before it rejects.
8. THE type `ListenOptions.debug` SHALL stay `boolean | undefined`. THE comment "accepted and ignored until the overlay exists" SHALL be updated.
9. `Ears` SHALL not get a new member in this task.

### Requirement 9: `.kiro/steering/ui.md`
**User story:** As a developer who builds with Kiro, I want the rules of the interface in one steering file.

#### Acceptance Criteria
1. `.kiro/steering/ui.md` SHALL exist, in English, in the style of the other steering files: front matter with `inclusion: fileMatch` and `fileMatchPattern` set to `web/**/*`, `teach.html` and `examples/**/*`, then a title and a flat list of rules (no prose paragraphs).
2. IT SHALL state, as rule sentences from design section 8.3 and this task: respect `prefers-reduced-motion` (no rolling or looping motion, redraw at most once per second, no transitions); show every recognition result as text, never by colour, shape or sound alone; no Halloween elements in the template (`web/`, `teach.html`) and in app 1 (Halloween styling lives in app 2's `halloween-ui.md` only); user-facing text in English; controls reachable by keyboard with an accessible name and a visible focus; debug and teach panels live in a Shadow DOM and leave the page's styles alone; text contrast of at least 4.5 to 1.
3. IT SHALL NOT repeat the rules of the other steering files (`web-audio.md`, `units.md`, `privacy.md`, `layers.md`). It MAY point to them by name.
4. `docs/devlog.md` SHALL name the file. THE rule that the overlay and the later teach dialog follow `ui.md` SHALL be stated in `design.md`.

### Requirement 10: Test page, fixtures and the screenshot
**User story:** As a maintainer, I want end-to-end tests with exact numbers, and one small picture for the README.

#### Acceptance Criteria
1. `test/web/listen.html` SHALL accept a `debug` query parameter (`?debug=1`) that passes `debug: true` to `listen()`, and SHALL contain one `<h1>` with a fixed text and a page rule that gives it a distinctive font size (a value with units that the browser's default would not give). A second page rule SHALL set a large font size and a strong colour on `body`, to show that the page's styles do not reach into the panel. No other behavior of the page SHALL change, and the Task 14 tests SHALL pass unchanged.
2. THE fixture generator SHALL also write a second model, from the same teaching set made at `WEB_TEST_MISMATCH_SAMPLE_RATE_HZ` (44100, test-only, in Hz), to `test/web/generated/` (`sounds-44100.json`), with its URL and path in `test/web/paths.ts`. IT SHALL NOT need a second WAV. THE total size of the generated folder SHALL stay below 2 MB. THE rate SHALL differ from `WEB_TEST_SAMPLE_RATE_HZ`, and the WAV source gives the 48000 Hz of the file, so the warning is exact and does not depend on the fake device.
3. THE generator check of Task 14 (Node recognises the file with the main model) SHALL stay. THE second model SHALL not be asked to recognise the file (a rate mismatch is the point).
4. THE E2E test that writes the screenshot SHALL write `docs/images/overlay.png` only when the environment variable `TOKK_WRITE_SCREENSHOT` is `1`, so an ordinary run does not change a committed file. THE image SHALL be the clipped box of the overlay host (not the whole page), at device pixel ratio 1, after all rows have appeared, and SHALL be under `WEB_TEST_SCREENSHOT_MAX_BYTES` (test-only, 100000 bytes). A normal run of the same test SHALL check that the clipped screenshot is a PNG within that size, without writing it.
5. THE screenshot SHALL be taken from the fixture run with the main model, showing waveform, marks with text, rows and one bold pattern row. THE committed file SHALL be created in the last task steps, and `git status` SHALL show it as the one added image.

### Requirement 11: Tests
**User story:** As a maintainer, I want the tests to exist and fail before the code.

#### Acceptance Criteria
1. **`test/overlay-format.test.ts` (vitest, no DOM).**
   - `formatEventRow` for a `sound` shows time, label, confidence, nearest id, distance and that label's threshold, in the exact text of requirement 4.3.
   - `formatEventRow` for `unknown` shows `unknown` and the nearest id and distance over the threshold of `nearest.label`, and has no confidence.
   - `formatEventRow` for `background` shows `background (no event)`.
   - A missing threshold, a `NaN` distance and an infinite distance give `n/a` and the text never contains `NaN`, `undefined` or `Infinity` (a property test over random reports and threshold records).
   - `formatMatchRow` is bold, starts the text with `Pattern`, and adds the speed only when it is defined.
   - `sampleRateWarning` is `null` for equal rates, is text with both rates for different rates, adds the 16000 Hz sentence (with the phrase `high-frequency features are empty`) when the input is 16000 Hz and not otherwise, and is `null` for a rate that is not a positive finite number.
   - `stateLabel` gives the three texts.
2. **`test/overlay-waveform.test.ts` (vitest, no DOM).** The window keeps only the last `WEB_OVERLAY_WINDOW_MS` of bins and never more bins than the derived maximum; the end of the window is the end of the newest bin; a pause keeps the window still; a gap stays blank; a `t0` that goes back clears the model; marks are clipped and dropped when they leave the window; the x fractions are between 0 and 1 and increase with time; the redraw decision gives a frame schedule without reduced motion and a once-per-`WEB_OVERLAY_REDRAW_REDUCED_MOTION_MS` schedule with it (fake times). A property test: for random envelope chunks the bins in the view equal the bins computed directly from the same data.
3. **`test/overlay-theme.test.ts` (vitest).** The contrast ratio (WCAG relative luminance) of each named colour pair is at least 4.5 for text and 3 for graphics.
4. **`test/node-globals.test.ts` and `test/build.test.ts`** as in requirement 1.7 and 1.3, and the worklet text test of requirement 1.9.
5. **Segment tests** of requirement 2.6.
6. **`test/web/overlay.spec.ts` (Playwright, Chrome).** With the WAV source and the main model, so the numbers are exact:
   - `debug: true shows one row per fixture event and a bold match row`: the number of event rows equals the number of events and unknown segments that `runSamples` gives in Node for the same WAV and model (the spec computes it, it does not type a number); the number of pattern rows equals the number of matches; the pattern rows have computed `font-weight` of at least 700 and their text starts with `Pattern`; the first event row's text contains the label, `confidence`, `nearest` and `distance`; the badge says `Listening`; no warning line is present (equal rates).
   - `overlay styles do not leak: a page h1 keeps its computed font size`: the computed font size and font weight of the page `h1` are the same with the overlay mounted as without it (read before `listen()` and after the rows appear), and the page `body` rule does not change the panel's computed font size or colour (read from an element inside the shadow root).
   - `the sample-rate warning appears when the model rate differs from the context rate`: with the 44100 Hz model and the 48000 Hz WAV the warning line is visible with both rates in its text, has `role="status"`, and with the main model it is absent. (The 16000 Hz sentence is covered by the vitest test, because no 16000 Hz source exists in the fixture.)
   - `reduced motion still shows rows`: the page is opened with `emulateMedia({ reducedMotion: 'reduce' })`. THE rows, the pattern row, the badge and the canvas are present. AN init script counts calls of `requestAnimationFrame`, and the count stays 0 with reduced motion while it is above 0 without it.
   - `the collapse button works from the keyboard and has an accessible name`: Tab reaches the button (by focusing the page and pressing Tab until it is focused, with a bound), the accessible name is `Collapse debug panel`, Enter collapses the body (`aria-expanded` is `false`, the rows are hidden), Space expands it, and the name changes to `Collapse debug panel` again.
   - `pause() sets the badge to Paused and stop() removes the panel`: after `ears.pause()` the badge reads `Paused`, after `ears.resume()` `Listening`, and after `ears.stop()` the host element is not in the document.
   - `no overlay without debug`: a run without `?debug=1` finds no overlay host, and no `canvas` and no shadow root is created by Tokk.
   - `the screenshot`: requirement 10.4.
7. THE new tests SHALL be written and shown failing before the code they test, in the order of `tasks.md`.
8. `npm test`, `npm run test:web`, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc -p tsconfig.test-web.json --noEmit` and `npm run build` SHALL pass at the end, and the four Task 14 browser tests (the smoke test, the WAV test, the gesture test and the stop test) SHALL still pass without change.
9. THE smoke test of Task 14 SHALL stay the only test with `smoke` in its title, so the `web-smoke` hook stays under 20 s.

### Requirement 12: Rules that apply
**User story:** As a maintainer, I want this task to follow the project rules.

#### Acceptance Criteria
1. **Units.** EVERY threshold and time constant SHALL be in ms, Hz or dB (sizes in px) with the unit in its name. NO sample count SHALL be hard-coded. Constants used by `web/` SHALL be in `web/constants.ts` or `core/constants.ts`. Test-only values stay at the top of their test file, with units. EVERY time `t` SHALL be a cumulative sample count divided by the sample rate.
2. **Privacy.** NO code SHALL send audio over the network. NO sample, envelope or row SHALL be stored. THE screenshot shows synthetic fixture audio only (no recording of a person).
3. **Layers.** `core/` SHALL stay pure (the one change of requirement 2 adds a callback). `web/` SHALL NOT import `fs`, `path` or `node/`. The DOM SHALL be used only in `web/overlay/overlay.ts` and `web/overlay/draw.ts` and the existing `web/` files that already use it. Apps import `tokk` only.
4. **Web audio.** THE rule "Warn in the debug overlay when the sample rate differs from the rate of the taught sounds" of `.kiro/steering/web-audio.md` is satisfied by requirement 6.8. THE microphone and worklet rules of Task 14 SHALL stay true.
5. ALL text written for people (overlay text, comments, docs, test titles, the steering file) SHALL be English.
6. THE devlog SHALL get a line: the `process` cleanup and the new build check, the `onSegment` finding and the `segment` message, the overlay files, `ui.md`, the screenshot path and size, and the size of `dist/tokk.js` before and after.
