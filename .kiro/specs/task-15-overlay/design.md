# Design: Task 15, debug overlay

## Layout
```
web/overlay/format.ts       pure text: formatEventRow, formatMatchRow, sampleRateWarning, stateLabel
web/overlay/waveform.ts     pure model: rolling window of envelope bins, marks, view(), redraw schedule decision
web/overlay/theme.ts        colour constants (no DOM), so a vitest test can compute contrast ratios
web/overlay/draw.ts         the only canvas code: drawWaveform(ctx, view, colours). No state. Task 16 reuses it
web/overlay/overlay.ts      mountOverlay: host, Shadow DOM, header, button, canvas, rows, warning, badge, destroy
web/constants.ts            + WEB_OVERLAY_* constants
web/protocol.ts             + `segment` message, buildEngine passes onSegment
web/listen.ts               debug: true mounts the overlay, route() feeds it, pause/resume/stop drive it
web/worklet-source.ts       method written as process(inputs)
core/engine.ts              + optional onSegment option (type SegmentReport, not in core/index.ts)
test/helpers/node-globals.ts  findNodeGlobalUse(text)
test/node-globals.test.ts     table of flagged and not-flagged snippets, esbuild bundle probe
test/overlay-format.test.ts   vitest
test/overlay-waveform.test.ts vitest
test/engine-segment.test.ts   vitest (or inside test/protocol.test.ts, decided in step 1)
test/build.test.ts          the `process` word check becomes the findNodeGlobalUse check
test/worklet.test.ts        + one test: plain process(inputs)
test/web/listen.html        + ?debug=1, an h1 and two page rules
test/web/fixture.ts, paths.ts  + sounds-44100.json
test/web/overlay.spec.ts    Playwright
docs/images/overlay.png     one small screenshot, committed
.kiro/steering/ui.md
```

## Data flow
```
Worker: createEngine -- onSegment --> segment {t, durationMs, result}   (new, every classified segment)
                    +- onEvent -----> event {e}                         (unchanged, pitch / sound / unknown)
                    +- handlers ----> match {pattern, event}            (unchanged)
        chunk ----------------------> envelope {t0, min, max}          (unchanged)

page: route(msg)
        segment  --> overlay.onEvent(report)        rows + marks
        envelope --> overlay.onEnvelope(msg)        waveform bins
        match    --> overlay.onMatch(pattern, m)    bold row     --> then the user's handler
        pause()/resume() --> overlay.setState; stop() --> overlay.destroy
```
Without `debug: true` the overlay variable is `null` and `route` skips three `if` checks. Nothing else changes.

## Findings from reading the code
1. **The `event` message cannot carry what the plan asks for.** The plan lists, per row, `nearest.id` and distance over the label's threshold, and a dashed mark for `background`. In `core/engine.ts` a `sound` event has no `nearest`, and a `background` segment emits no event (the loop `continue`s before `feed`). Only `unknown` has `nearest`. Options:
   - (a) Add `nearest` to the `sound` event and a new `background` event kind, in the `onEvent` path. Rejected: `SoundEvent` also goes to the grammar and to `runSamples`, so `events` of `runSamples`, the P3 test of Task 14, the MCP `listen` output and `node/` tools would all change. That is a wide change for a debug view.
   - (b) Add one optional callback `onSegment` that reports every classified segment with its `ClassifyResult`. Nothing existing reads it, so no existing test changes. Chosen.
   - (c) Run a second classifier on the main thread to find the nearest example. Rejected: it duplicates work and the answers could differ from the engine's (the engine's answer is what the overlay must explain).
2. **Event times restart on `replaceSounds`** (Task 14 design). Envelope times do not. After Task 16 replaces the model, segment times (engine clock) and envelope times (session clock) differ by the engine's restart. The overlay takes the times as given. Task 16 must either pass an offset or restart the envelope counter too; this task does not decide it. The model of `waveform.ts` clears itself when `t0` goes back (requirement 5.6), which is what a restarted counter does, so the simple choice for Task 16 is to restart both counters together.
3. **The 44.1k and 48k pair classifies the same** (plan, facts from plan 1). The warning for that pair is therefore stricter than the real risk. It stays, because the steering rule says to warn when the rates differ, and its text says "can be less accurate". The 16 kHz sentence is the case that matters.
4. **`runSamples` gives no background count**, because background segments emit no event. The E2E row count is events plus unknown segments. The fixture model has no `background` label, so no background rows appear in the E2E test. Background rows are covered by the segment tests and the format tests.

## Decisions

### `onSegment` in the engine
`classify(segments)` already loops over segments and has the `ClassifyResult` in hand. The change is one line after the classifier call, `onSegment?.({ t: seg.t, durationMs: seg.durationMs, result: r })`, placed before the `unknown` and `background` branches so all three outcomes are reported, and after the voiced-range `continue` so a skipped segment is not reported. The matcher and `onEvent` are not touched. The exported type is `SegmentReport = { t: number; durationMs: number; result: ClassifyResult }`, in `core/engine.ts` only. The first task step reads the engine again and stops if the line cannot go there without a change of order (requirement 2.7).

`result` is sent as is. It is plain data (strings and numbers), so `structuredClone` works, and it has `nearest.label` for the threshold lookup without a second message field.

### Why the overlay entry is still named `onEvent`
The plan's interface names `onEvent(e: EngineEvent)`. The input is now a `SegmentReport`, because that is the only message with the data. The name stays so the interface in the plan and in Task 16/17 text reads the same. The type in the signature is the truth, and `design.md` and the code comment say so. `event` messages (pitch, sound, unknown) are not routed to the overlay: the same segment would give two rows.

### Rows and marks come from the same report
One report gives one mark and one row. A pattern match gives one more row (a match is not a segment). The 20-row limit counts both kinds. The limit is a count of rows, so `WEB_OVERLAY_MAX_ROWS` carries `ROWS` in its name instead of a unit. Newest first, so the latest decision is at the top where the eye is, and a collapsed list does not hide it.

### Time axis
The waveform's right edge is the end of the newest envelope bin. No wall clock draws. Bin `i` of a message is at `t0 + i * binSamples / sampleRate`, with `binSamples = msToSamples(WEB_ENVELOPE_RESOLUTION_MS, sampleRate)`, the same conversion the Worker uses. A mark spans `[t, t + durationMs / 1000]`, clipped to the window. Marks arrive after the sound ended (the classifier needs the whole segment), so a mark shows up behind the right edge by the length of the segment plus the segmenter's delay. This is shown correctly because the mark is placed by its own time, not by its arrival.

At 48000 Hz a bin is 480 samples. At 44100 Hz it is 441. The window holds `WEB_OVERLAY_WINDOW_MS / WEB_ENVELOPE_RESOLUTION_MS` bins (500) plus the one that is being completed. The model keeps one number array pair, trimmed on every push, so memory is bounded.

### Pure model and drawing split
`waveform.ts` has the state and the arithmetic, and no DOM type, so vitest tests it with exact numbers. `draw.ts` takes a view (bins with x fractions, marks with x fractions, kind and label) and a 2D context, and draws. It keeps no state, so Task 16 can draw a small waveform piece for a segment cell with the same function and a different view. The view type is the contract between them.

### Redraw schedule
Two schedules, chosen by `prefers-reduced-motion`:
- Normal: after any change, request one animation frame and draw in it (coalesced, at most one request outstanding). No change, no frame. So an idle page costs nothing and a rolling waveform costs one draw per frame while data arrives (about 100 envelope bins per second arrive in messages every 20 ms).
- Reduced motion: one `setInterval` of `WEB_OVERLAY_REDRAW_REDUCED_MOTION_MS`. It draws the latest view if anything changed. No `requestAnimationFrame` call is made. Rows, badge and warning are DOM text and update at once in both modes, because they are not motion.

A small pure function `nextRedraw(mode, dirty, ...)` in `waveform.ts` returns what to do (`frame`, `timer` or `none`), so the choice is tested without a DOM. The overlay listens to the media-query change and switches schedule, clearing the old timer or frame first.

While collapsed, the overlay skips drawing and marks the canvas dirty, so it draws once when it is expanded.

### Shadow DOM and style isolation
The host is a plain `div` (no custom element, so no global registry entry and nothing to define in the page). Its shadow root is `open`. Two directions of leaking:
- Page to panel: normal selectors do not cross a shadow boundary, but inherited properties do (`font-family`, `font-size`, `color`, `line-height`, `font-weight`). The shadow style starts with `:host { all: initial }` and then sets the panel's own values, so a page rule on `body` has no effect. The E2E test sets a large font size and a red colour on `body` and reads the computed values inside the panel.
- Panel to page: the style lives inside the shadow root as one `<style>` element, so it matches nothing outside. The E2E test reads the computed font size of the page `h1` before and after.

The style is a string inside `overlay.ts`. No stylesheet file and no network request. The panel is built with `createElement` and `textContent`, never `innerHTML` with data, so a label or a pattern name that contains markup shows as text (labels come from the developer's own model, but the pattern name comes from the page's code, and the rule costs nothing).

### Size and position
Fixed to the bottom right corner with a margin, `z-index` at `WEB_OVERLAY_Z_INDEX` (the largest 32-bit signed integer, so a page modal does not hide it by accident). Width `WEB_OVERLAY_WIDTH_PX` = 360. Waveform height `WEB_OVERLAY_WAVEFORM_HEIGHT_PX` = 80. The row list has a fixed maximum height in `px` (named in the style constants of `overlay.ts`) with its own scroll, so 20 rows never grow the panel past the viewport. Rows wrap long ids. On a viewport narrower than the panel, the width is `min(WEB_OVERLAY_WIDTH_PX, 100% minus margins)`.

The panel covers a corner of the page. A developer who needs the corner collapses it (the header stays, about one line). Moving the panel is not part of this task.

### Colour and text
- Panel background and text: a dark background with light text. The two colours are named in `overlay.ts`, and the ratio is computed in a vitest test with the WCAG luminance formula (no browser), so the 4.5 to 1 claim is a test, not a belief. The test also checks the grey of `unknown` and `background` marks against the canvas background, the warning text against its background, and the focus outline against the header.
- Label colours: a fixed palette of seven colours taken from the Okabe-Ito set (eight colours, the published colour-blind-safe palette, minus black). Labels take the colours in the order of the sorted label list of the model, wrapping after seven. Two labels can share a colour in a model with more than eight sounds. That is why every mark carries its label text, and why this is allowed.
- `unknown` is grey with a solid outline. `background` is grey with a dashed outline (`setLineDash`). They differ by outline style and text, not by colour. Label text is drawn with a dark outline stroke under the fill (a halo), so it stays readable over any mark colour and over the waveform.
- The `unknown` and `background` greys have enough contrast against the canvas background as drawing elements (3 to 1 for non-text graphics in WCAG 1.4.11) and their text uses the text colour.

### Rows as a list
The rows are an ordered list (`<ol>`) in the panel. A row is a `<li>` with cells in `<span>` elements for the parts, each part with a visually separate position, and the row's `aria-label` equal to the full `text` of the formatter, so a screen reader reads one clear sentence instead of cell fragments. The list has no `aria-live` (it would speak every result at the speed of the sounds). The state badge and the warning have `role="status"`, which is polite and changes rarely.

Bold is the CSS `font-weight` 700 on the match row's `<li>`. The row also starts with the word `Pattern`, so a reader without styles still sees the difference. The test checks both.

### The collapse button
A `<button type="button">` in the header. Its visible text is `Collapse` or `Expand` with the word `panel` hidden in an `aria-label`: `Collapse debug panel` and `Expand debug panel`. The label starts with the visible word, so the accessible name contains the visible text (WCAG 2.5.3). `aria-expanded` and `aria-controls` point to the body's `id`. The body is hidden with the `hidden` attribute, which removes it from layout and from the accessibility tree. The focus outline is a 2 px solid outline with an offset, defined in the panel style.

The overlay does not take focus at mount and does not return focus anywhere on destroy. It adds no `tabindex` to anything but the native button and the scrollable list (the list gets `tabindex="0"` only if its content overflows, so a keyboard user can scroll it; step 5 of the tasks checks if this is needed, and if not it is left out).

### Mount and destroy rules
`mountOverlay` appends one host to `document.body`. If `document.body` is missing (a script in `head` before the body exists), it waits for `DOMContentLoaded` once and appends then, and `destroy()` before that cancels the wait. `destroy()` removes the host and everything the overlay registered: the animation frame, the interval, the media-query listener, the click listener of the button. After destroy every method is a no-op that does not throw, because `stop()` and a late Worker message can cross.

### `listen()` changes
The overlay is created after `init` is posted, so the rate is known and a failure before that never leaves an element behind. The `debug` read happens once at the top (`const overlay = opts.debug === true ? tryMount() : null`, placed where the rate is known). `tryMount` wraps `mountOverlay` in a `try`/`catch` and logs the error, so a page without `document` (a test in Node, a worker) still gets `listen()` working. The failure path of `listen()` (the existing `catch` that tears down) also destroys the overlay.

`route` gets three cases that call the overlay inside their own `try`/`catch`. The `match` case calls the overlay before the handler, and the handler does not depend on it. The `pause()` and `resume()` methods call `setState`. `stop()` calls `destroy()` in its teardown, before the Worker is terminated, so a message in flight finds a destroyed overlay and nothing happens.

### Cost when `debug` is off
The overlay module is in the bundle, because the plan does not need a dynamic import. The cost is bytes, which the build records (size of `dist/tokk.js` before and after, in "Measured values"). No overlay function runs and no DOM is touched when `debug` is not `true`. A test loads the page without `?debug=1` and checks that no host element and no `canvas` exists in the document, and the Node import test of the build test still passes (nothing at import time touches `document` or `matchMedia`).

### The `process` cleanup
Why the word was banned: `dist/tokk.js` must not depend on Node globals. A Node global in browser code throws `ReferenceError` in the page, or hides a bundler replacement that does not happen in the CDN case. The word `process` also names the Web Audio method, so a word ban forced the computed key.

New check: `findNodeGlobalUse(text)` runs regular expressions on the text of the bundle and returns the offending snippets. The patterns look at what follows or precedes the word:
- `\bprocess\s*(\?\.|\.|\[)` for member access, plus `typeof\s+process\b`, plus `(globalThis|window|self)\s*\.\s*process\b`;
- `\brequire\s*\(`, `\b__dirname\b`, `\b__filename\b`, `\bmodule\.exports\b`, `\bexports\.\w+\s*=`;
- an import or export specifier that starts with `node:`, and the bare `fs`, `path`, `zlib` specifiers with or without a subpath (the existing check, moved into the function).

A method definition `process(inputs) {` is followed by `(`, not by `.`, `?.` or `[`, so it is not flagged. A call `this.process(x)` is preceded by `.process` where `process` is a property, not the object; the pattern for member access needs `process` as the start of the access, so `this.process` is not flagged (the check does not flag a property named `process` that follows a dot, using a negative lookbehind for `.`). Comments and plain sentences: the word followed by a space and a word is not matched by any pattern. The words inside string literals that look like code (a string `"process.env"`) are flagged. That is wanted: it is the safer side, and it shows in the table test as a documented decision.

Known limit: a regular-expression check on text is not a parser. It cannot see `const p = globalThis; p['pro' + 'cess']`. The build test is a guard against accidents, not against a determined trick. This limit is written in the test file comment.

The test table (`test/node-globals.test.ts`) is the specification of the function. A second test bundles `export const x = process.env.X;` with esbuild (`platform: 'browser'`, no `define`, so the reference stays) and expects the function to flag the output. The reason for the second test: the first test uses hand-written text, the second uses text that has the shape of a real bundle, so a future change of the bundler options that rewrites such a reference away would show up.

Search before the change: `web/` and `test/` for `'proc'`, `"proc"`, `'ess'` and for any other computed key that dodges a word. The result is written in "Measured values".

## Test design

### Pure tests
`format.ts` and `waveform.ts` have no DOM, so vitest runs them in Node with exact expectations. The text format is compared as a full string for a few fixed reports (a golden string per kind), and the property test checks the invariants: no `NaN`, `undefined` or `Infinity` in the text, the text always contains the label, a match row starts with `Pattern`.

For `waveform.ts` the property test makes random envelope chunks (random lengths and values, random gaps), feeds them to the model and compares `view()` with a direct computation on the whole data: the same bins, the same x positions to within a stated tolerance in fractions. It also checks the bound on the number of bins.

### Contrast test
A vitest test computes the contrast ratio (WCAG relative luminance) for the colour pairs named in `overlay.ts` (exported as constants from a small `web/overlay/theme.ts` that has no DOM, so the test can import it). Pairs: text on panel, warning text on warning background, grey mark on canvas, focus outline on header. Limits: 4.5 for text, 3 for graphics. If a pair fails, the colour changes, not the limit.

### E2E: exact numbers with the WAV source
`listen.html?debug=1&source=<wav>&model=<model>` runs the fixture through the WAV pacing, at the file's 48000 Hz, with no gesture needed and no fake-device variation. The spec computes the expected counts with `runSamples` in Node (events of kind `sound`, plus `unknowns`, plus matches) from the same WAV and model files, as the Task 14 WAV test does. It never types a number.

The wait is `waitForFunction` on the number of rows reaching the expected count, with a timeout of the fixture length plus the slack of Task 14, then a settle time (as in Task 14) to show that no extra row arrives. The row count then is compared for equality, so a missing row and an extra row both fail.

For the warning test the page loads `sounds-44100.json`. The classifier may give `unknown` for some sounds with that model (a different-rate model on a 48000 Hz input). That does not matter, because the test reads the warning line only. The test waits for the overlay host, not for rows.

### E2E: reaching inside the shadow root
Playwright's CSS locators pierce open shadow roots, so tests can reach the elements inside the panel directly. The host gets a stable `data-tokk-overlay` attribute (set on the host, not on the page elements) as the only hook for tests and for the screenshot clip. Inside, tests use roles and text (`getByRole('button', { name: 'Collapse debug panel' })`, `getByRole('status')`), which also checks the accessible names. Computed styles are read with `evaluate` on the located element.

### Reduced motion
`page.emulateMedia({ reducedMotion: 'reduce' })` before `goto`. An init script (added to `instrument.ts` as an option `countAnimationFrames`) wraps `window.requestAnimationFrame` to count calls, calling the original. The test asserts the count is 0 with reduced motion after the rows appeared, and above 0 in a normal run of the same page. The test page itself never calls `requestAnimationFrame`, and Tokk's other code does not (Task 14 uses timers and the audio thread), which the first task step confirms by a search. If the page or Chrome calls it for another reason, the test counts only calls whose stack contains the overlay's file name, or is dropped in favor of the canvas redraw counter (decided in step 7 with the evidence). The unit test of the schedule decision stays the main proof.

### Screenshot
The screenshot test clips to the host's bounding box with the Playwright `clip` option, at device pixel ratio 1. The file is written only with `TOKK_WRITE_SCREENSHOT=1`. It is taken after the last pattern row exists, while the window (5 s) still holds the whole run: the fixture's impacts span 2.4 s from the first to the last, plus the 1.7 s lead, so the first impact would be at 1.7 s and the window starts at the end minus 5 s. The first task step computes where the window starts at that moment. If the lead has already left the window, that is fine (silence is not interesting); if an impact is cut off, the screenshot is taken earlier, after the third row.

The image is small because the box is about 360 by 400 CSS pixels with flat colours. The test limit is `WEB_TEST_SCREENSHOT_MAX_BYTES` (100000). The image is committed because the README of Task 19 and the usage notes use it. It contains no person's voice or data (synthetic fixture).

## Risks and rules
- **Overlay hides page content.** A fixed panel covers a corner. Mitigation: a collapse button, a small header, and the same `ui.md` rule for every panel. No drag in this task.
- **`all: initial` also resets `display`.** The shadow style sets `display: block` on the host after the reset, and the host's `position: fixed` is set inline or in the same rule after `all: initial`. The E2E test sees the panel only if both hold.
- **Canvas has no text for assistive tools.** The canvas has `role="img"` and an `aria-label`, and every fact of the canvas is in the rows. This is the reason rows are required, not optional.
- **Pitch events are not shown.** A hum session gives no rows. The overlay is a debug view for sounds in this task. A continuous-value row is a later addition (the format function takes a report type that can grow).
- **A `segment` message per segment is cheap** (a few per second). A pitch-heavy session produces many `event` messages but no `segment` messages, so the overlay does not slow it.
- **Handlers must not depend on the overlay.** Covered by requirement 8.3, 8.4 and a test in which `mountOverlay` is made to throw (a page where `document.body` is replaced by a stub is not needed; the test forces the failure by passing an invalid parent, or by stubbing the module in a vitest test of `listen`, decided in step 6).
- **Task 16 fit.** The teach dialog needs `setState('teaching')` (exists), `drawWaveform` and the view type (exist, no overlay state), and a way to restart the time axis after `replaceSounds` (the model clears when `t0` goes back). The dialog and the overlay must not both draw a mark for the same segment twice: the dialog gets its own segments from record messages, not from `segment`.
- **Task 17 fit.** `teach.html` calls `listen({ debug: true })`. The overlay needs no change.
- **Privacy.** No network call, no storage. Search `web/overlay/` for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `localStorage`, `indexedDB`, `Image`, `src =` and confirm no hit.

## Tests
| # | Test | Where | Requirement |
|---|---|---|---|
| 1 | `findNodeGlobalUse` flags `process.env`, `process.`, `require(`, `__dirname`, `node:` imports, bare `fs`/`path`/`zlib`; does not flag `process(inputs)`, `registerProcessor`, prose | `test/node-globals.test.ts` | 1.3, 1.4, 1.7 |
| 2 | an esbuild bundle of `process.env.X` is flagged | `test/node-globals.test.ts` | 1.5, 1.7 |
| 3 | `dist/tokk.js` has no Node global use (the changed check) | `test/build.test.ts` | 1.3, 1.6 |
| 4 | worklet source has plain `process(inputs)` and no `'proc'` | `test/worklet.test.ts` | 1.1, 1.9 |
| 5 | `onSegment` reports every classified segment; `segment` messages equal a direct run; chunk sizes do not matter; output without it is unchanged | `test/engine-segment.test.ts` | 2 |
| 6 | event row text for sound, unknown, background; thresholds missing; no `NaN` | `test/overlay-format.test.ts` | 4.2 to 4.4 |
| 7 | match row bold and starts with `Pattern`; speed only when set | `test/overlay-format.test.ts` | 4.5 |
| 8 | rate warning: null, both rates, 16000 sentence, invalid input | `test/overlay-format.test.ts` | 4.6 |
| 9 | window keeps 5 s, bounded bins, gaps, restart, marks clipped, x fractions | `test/overlay-waveform.test.ts` | 5 |
| 10 | redraw decision: frame vs once per second | `test/overlay-waveform.test.ts` | 7.2 to 7.4 |
| 11 | colour contrast of the named pairs | `test/overlay-theme.test.ts` | 7.6 |
| 12 | `debug: true` shows one row per fixture event and a bold match row | `test/web/overlay.spec.ts` | 6.7, 8.1 |
| 13 | a page h1 keeps its computed font size; the page body rule does not reach the panel | `test/web/overlay.spec.ts` | 6.2, 6.3 |
| 14 | the rate warning appears with the 44100 Hz model and not with the main model | `test/web/overlay.spec.ts` | 6.8 |
| 15 | reduced motion still shows rows and calls no `requestAnimationFrame` | `test/web/overlay.spec.ts` | 7.1 to 7.3 |
| 16 | collapse button: keyboard, accessible name, `aria-expanded` | `test/web/overlay.spec.ts` | 6.4 |
| 17 | pause shows `Paused`, resume `Listening`, stop removes the panel | `test/web/overlay.spec.ts` | 8.5, 8.6 |
| 18 | no `debug`, no overlay | `test/web/overlay.spec.ts` | 8.2 |
| 19 | screenshot within size, written with `TOKK_WRITE_SCREENSHOT=1` | `test/web/overlay.spec.ts` | 10.4 |

Test-only values at the top of `overlay.spec.ts`: `WEB_TEST_WAIT_SLACK_MS`, `WEB_TEST_SETTLE_MS` (as in `listen.spec.ts`), `WEB_TEST_MISMATCH_SAMPLE_RATE_HZ` (44100, in `fixture.ts`), `WEB_TEST_SCREENSHOT_MAX_BYTES` (100000), `WEB_TEST_TAB_LIMIT` (a count, the bound of Tab presses to reach the button).

## Measured values
To be filled in by the implementer (every item).
- Result of the search for word-dodging tricks in `web/` and `test/` (requirement 1.2).
- Size of `dist/tokk.js` before and after this task, in bytes, and the difference.
- Runtime of `test/web/overlay.spec.ts` and of the whole `npm run test:web`, and the runtime of `npm run test:web -- --grep smoke` (must stay under 20 s).
- The computed contrast ratios of the colour pairs.
- Size of `docs/images/overlay.png` in bytes.
- Whether the `<ol>` needed `tabindex="0"`.
- Whether the `requestAnimationFrame` count was usable as is (step 7 of the tasks).
- Full vitest count before and after (baseline 474 passed, 2 todo).
- Whether `core/engine.ts` took the `onSegment` call without a change of event order (step 1).

## Results (filled in by the implementer, 2026-11-20)
- Word-dodging search (1.2, 1.4): the only hit was ['proc' + 'ess'] in web/worklet-source.ts, now process(inputs). 	est/worklet.test.ts already called .process(...). No other computed key, and no s, path, zlib or 
equire trick in web/.
- Test change named (task 2.6): 	est/build.test.ts replaces the \bprocess\b word check by indNodeGlobalUse(text) equal to []. It tightens the check from a word to Node global use (process.env.X in the bundle still fails, shown by the esbuild probe test). It does not let a bug pass.
- Step 1.3: onSegment fits right after the classifier call and after the voiced-range continue, with no change of event order or timing. Segment tests are in 	est/engine-segment.test.ts.
- Step 1.5: nothing in web/ or 	est/ called 
equestAnimationFrame or matchMedia before. Finding: Playwright's own waiting (page.click, evaluate polling) calls 
equestAnimationFrame in the page, so the raw count was 2 with reduced motion. instrument.ts now counts only calls whose stack contains /dist/tokk.js. With that filter the count is 0 with reduced motion and above 0 without it.
- Step 1.6: the fixture model has thresholds for low, mid, high and 
ing, and none for ackground.
- Redraw schedule: with reduced motion the overlay uses one setTimeout per redraw, with the delay from 
extRedraw (at most one redraw per WEB_OVERLAY_REDRAW_REDUCED_MOTION_MS), not a setInterval.
- Palette: 7 colours (Okabe-Ito minus black), not 8.
- dist/tokk.js size: 116722 bytes before, 134953 bytes after (+18231 bytes).
- Contrast ratios: text on panel 15.00, text on header 12.17, text on canvas 15.95, warning text 9.21, unknown mark 9.87, background mark 7.49, waveform 9.18, baseline 3.15, focus outline on header 10.02, lowest label colour 3.65.
- docs/images/overlay.png: 22275 bytes, 360 by 276 px.
- The row list needed 	abindex="0" (it scrolls above 168 px, and 20 rows are taller), with an ria-label.
- Runtime: 
pm run test:web about 52 s for 12 tests (the four Task 14 tests about 17 s; the smoke test 6.5 s).
- Vitest count: 474 passed, 2 todo before; 571 passed, 2 todo after. 
pm run pbt:quick: 143 passed, 2 todo.
