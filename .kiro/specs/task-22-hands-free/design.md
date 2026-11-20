# Design: Task 22, app 1, Hands-Free

## Layout
```
apps/hands-free/index.html            start screen, header, state banner, controls, recognition lines, <main>, one inline style   [new]
apps/hands-free/src/main.ts           entry: the Tokk wiring (marked) and the glue between the modules                           [new]
apps/hands-free/src/constants.ts      every number with its unit; the storage key                                                 [new, pure]
apps/hands-free/src/bindings.ts       the patterns, the two modes, the action names                                               [new, pure]
apps/hands-free/src/history.ts        scan history: record(timeMs, target), lookup(timeMs), clear(), pruning                      [new, pure]
apps/hands-free/src/hum-scroll.ts     hum update -> scroll step in px; reset on hum end                                           [new, pure]
apps/hands-free/src/nav.ts            view state, hash parse and format, parent view                                              [new, pure]
apps/hands-free/src/keys.ts           key event -> action, with the ignore rules                                                  [new, pure]
apps/hands-free/src/text.ts           "Heard:" and "Did:" formats, the teach texts, the state texts                               [new, pure]
apps/hands-free/src/steps.ts          the three teach steps, the missing steps from a model                                      [new, pure]
apps/hands-free/src/articles.ts       the three articles as data                                                                  [new, pure]
apps/hands-free/src/scan.ts           DOM: collect targets, frame, timer, pause, speed; uses history.ts                           [new, DOM]
apps/hands-free/src/views.ts          DOM: render the list and an article from nav.ts and articles.ts                             [new, DOM]
apps/hands-free/src/ui.ts             DOM: banner, recognition lines, controls, progress, keys listener                           [new, DOM]
.kiro/steering/ui.md                  + apps/hands-free/**/* in fileMatchPattern
docs/kiro.md                          + one table row
docs/devlog.md                        + one entry
docs/images/hands-free.png            written once with TOKK_WRITE_SCREENSHOT=1
test/hands-free-history.test.ts       U1                                                                                          [new]
test/hands-free-gate.test.ts          U2                                                                                          [new]
test/hands-free-hum-scroll.test.ts    U3                                                                                          [new]
test/hands-free-nav.test.ts           U4                                                                                          [new]
test/hands-free-keys.test.ts          U5                                                                                          [new]
test/hands-free-text.test.ts          U6                                                                                          [new]
test/hands-free-steps.test.ts         U7 (steps, texts)                                                                           [new]
test/hands-free-wiring.test.ts        U8                                                                                          [new]
test/hands-free-articles.test.ts      U9 (articles, style contrast)                                                               [new]
test/web/hands-free-fixture.ts        generator and Node check of the one WAV, its JSON of times                                  [new]
test/web/global-setup.ts              + one call to the generator
test/web/paths.ts                     + paths and URLs of the new files
test/web/hands-free.spec.ts           E1 to E7 (serial block), E5 keyboard, E6 under /tokk/                                       [new]
web/listen.ts                         ears.teach closes a dialog that shows only its saved screen, then starts the new teach      [changed, requirement 16]
test/web/teach.spec.ts                + E8, the sequential-teach test (no existing expectation changes)                           [changed]
.kiro/steering/integrate.md           + one line about sequential teaching                                                         [changed]
powers/tokk/skills/integrate/SKILL.md + the same line                                                                              [changed]
```
The unit tests live in `test/` (Vitest, Node). The browser tests live in `test/web/` (Playwright), like the others. The pure modules sit in `apps/hands-free/src/` and are imported by relative path from the tests. This is not an app import of an internal path, so `check:public-api` has nothing to say.

## Assumptions (written without a person to ask)
1. **Single document, articles as data.** The plan lets this spec choose and lists `articles/*.html`. The choice and its reasons are below. The file list of the plan is changed on purpose: there are no `articles/*.html`.
2. **Listening off is a mode, not `ears.pause()`.** Reasons below.
3. **The "?" in the task text is read as the plan's "✓" and "↑".** The task text shows `"click ?"` and `"hum ? 3"`, and the plan (apps plan, Task 22) shows `"click ✓"` and `"hum ↑ speed 3"`. A character was probably lost in transfer. The formats of requirement 7 follow the plan. A glyph is always paired with a word, so nothing depends on a glyph alone.
4. **The constants live in the app, not in `core/constants.ts`.** The units rule says to keep constants in `core/constants.ts`. An app cannot import `core/` (the check fails the save), and Task 21 kept its own constants in `scripts/` for the same reason. The names keep their units, which is the purpose of the rule.
5. **"Keyboard only" is a start choice, and the teaching cannot be skipped once started.** The plan says "no skip". A visitor with no microphone, or who refuses it, must still be able to use the page (requirement 9.6), so the skip is the other start button, not a button in the teaching.
6. **The scan stops while listening is off.** The plan does not say. A frame that keeps hopping while the user talks to someone is noise, and nothing can be activated by sound anyway. The scan runs for keyboard-only visitors.
7. **The scan covers `<main>` only.** A hands-free user needs the articles, not the app's own controls, and a longer cycle makes every article slower to reach. The controls are for the helper, the keyboard and the mouse.
8. **No stored scan speed.** The plan has none. A later decision (below).
9. **Two `data-` attributes are test hooks.** They change nothing for a user (design "Test hooks").
10. **A page title and focus move on a view change** (requirement 8.4). The plan does not ask. A single-document app without it is silent for a screen reader, and the cost is three lines.

## Findings from reading the code
1. **Two apps share one origin on Pages.** `https://subniin.github.io/tokk/apps/hands-free/` and `.../knock-once/` share `localStorage`. The default `storageKey` `tokk:sounds` would give the second app the model of the first. The first-run base is a fixed fingerprint (`firstRunBase()`), so the library would not even warn. This app uses `tokk:hands-free`. Task 23 should use its own key.
2. **A match arrives late, a sound does not.** `onEvent` gives a `sound` event as soon as the segment is classified. A `click` match comes 350 ms after the click. The "Heard:" line is therefore filled from `onEvent` (immediately) and the "Did:" line from the handler (late). A user who hears no reaction for 350 ms still sees that the click was heard.
3. **`toPageTime` is for the match, inside the handler.** It throws before audio arrives and after Save, Cancel or an import until new audio arrives. A handler runs only for a match of the current engine, so it works there. The app still catches the throw and says so (requirement 5.1). The mapping is within 50 ms of the true capture time in the Task 20 measurement. The page time is the time the sound reached the page with the smallest-delay rule applied, so a real input device with a fixed delay (a Bluetooth headset) can make the lookup late by that delay. At the smallest step of 600 ms that is a small share. It is a measurement for the human check, not a fix here (later decisions).
4. **The dialog stays on its saved screen, and a new `ears.teach` used to reject while it was there.** `ears.teach` resolves on Save, and the dialog stays on its saved screen until the user presses Close or Esc. Before this task a new `ears.teach` then rejected with "a teach dialog is already open". A guided sequence of three steps needs the second to start right after the first is saved. Options:

   | Option | Cost |
   |---|---|
   | A. The app retries `ears.teach` while the rejection is the "already open" `Error` | Public API only, but it couples the app to one error message. **Not chosen** (operator decision). |
   | B. The app shows a "Next step" button that the user presses after Close | No coupling. Six more presses in a minute, and a wrong order gives an error. |
   | C. A small template fix: `ears.teach` closes a dialog that shows only its saved (finished) screen and starts the new teach; a dialog that is still recording or reviewing keeps rejecting with the existing error | The clean fix, a few lines in `web/listen.ts`. **Chosen** (operator decision), as requirement 16 of this task. |

   Choice: **C**. The app has no retry, no wait and no message match: it awaits `ears.teach` three times in a row. The new behaviour is proved by E8 in `test/web/teach.spec.ts` (both cases), and E1 goes through the real flow. The only other change is one line about sequential teaching in `.kiro/steering/integrate.md` and in the integrate skill of the power.
5. **Hum updates have no end match.** `hum.rise` and `hum.fall` fire on each pitch update beyond the dead zone and never on the end of the hum. Scrolling inside the match handler, with no timer, stops by itself when the hum ends. The `continuous` `end` event (from `onEvent`) only resets the state so that the next hum starts with the fixed first step.
6. **A mode with one pattern has no waiting time.** In `off` the only pattern is `click click click`. It is the longest of its family, so it fires on the third click at once and the first two clicks are not held back. In `on`, `click` waits 350 ms for a second click, `click click` waits 350 ms for a third.
7. **`setPatterns` clears the pending sequence.** After `click click click` fires the sequence is empty anyway, so switching the mode loses nothing.
8. **The engine is rebuilt after each Save.** Patterns recognise again after the new engine's own calibration (1 s of audio, `NOISE_FLOOR_WARMUP_MS`). The next dialog's quiet second and the quiet gaps of the fixture cover it. After the last Save the app should not expect a click for about a second (the human check mentions it).
9. **Vitest follows imports from `test/` under `tsconfig.json` with no DOM.** A pure module that mentions `document`, `HTMLElement`, `performance` as a type or `'tokk'` fails `npx tsc --noEmit`. `performance.now()` itself is a Node global, but the pure modules take times as arguments, which is also what makes them testable without fake timers.
10. **The existing fixtures cannot be reused as one stream.** The Task 16 and Task 20 fixtures are one dialog each, with one WAV each, and the teaching dialogs of this flow come one after the other against one file. A new generator is needed (below). It reuses the helpers (`makeSignal`, `synthTone`, `SYNTH_CLASSES`, `rng`, `place`) and the constants of `test/web/fixture.ts`.
11. **The static site server of Task 21 answers 404 outside `/tokk/`.** E6 reuses `startSiteServer` and `buildSite` with the real `apps/` folder. The real folder has no `knock-once`, so the build prints the dead-link warning of Task 21 and still finishes.

## Decisions

### Single document, not separate pages
The articles are views inside one document. The reasons:
- **The listening must stay alive.** A new page load ends the audio context, the worker and the stream. The next page needs a user gesture again for the audio context, a new `listen()`, a new calibration second in which a click is lost, and the engine's pending patterns, the scan history and the state (listening on or off) are gone. A hands-free user would have to click a "Start" button with a mouse after every article. That defeats the app.
- **The state is the point.** "Listening off" must survive navigation. With separate pages it would have to be stored and restored, and a stored "off" that loads as "on" by a bug is the exact failure the app must not have.
- **The scan history needs a stable clock.** One document, one `performance.now()` timeline, one `toPageTime` mapping.
- **The cost is small.** One hash-based router of about ten lines (`nav.ts`), and a focus move and a title change per view (requirement 8.4).
- **What is given up:** deep links that work without the script (the page is blank without JavaScript) and the browser's cache per article. The app needs scripts and a microphone anyway.

The hash mirrors the view (`#/`, `#/article/<id>`), so Back, Forward, reload and a link work, and the view is rendered from the hash alone. "Back" by sound is "go to the parent view" (set the hash to `#/`), not `history.back()`: a `history.back()` from the first view would leave the app and end the listening. At the list, back does nothing and says so.

### Articles as data
The plan lists `articles/*.html`. Fetching fragments would need a request per view, a loading state and an error state, and the first scan target would appear a moment after the view changes (the history would record a first move before the content is stable). Bundling the plain text as data costs about 3 KB, needs no request, works at once, and a new article is one object. The build stays unchanged (an `.html` text loader would need a change to `scripts/build.ts`, outside this task). The text is rendered with `textContent`.

### Listening off is a mode
`listen({ modes: { on, off } })` with `off` holding `click click click` only. Alternatives:
| Option | Result |
|---|---|
| `ears.pause()` | The microphone stops, so the toggle sound cannot be heard. Wrong. |
| A flag in each handler | The engine still waits 350 ms after a click for a longer pattern, and a hum still reaches the handler. One forgotten `if` is a wrong click, and the plan's rule is that nothing but the toggle fires. |
| **A mode** | The engine itself fires nothing else. One table (`bindings.ts`) is the proof, and U2 tests it against the real engine. |

The cost is that the microphone stays open while off. The page says so (requirement 2.3).

### The patterns and actions (`bindings.ts`)
| Action | Pattern | Mode `on` | Mode `off` | What it does |
|---|---|---|---|---|
| `activate` | `click` | yes | no | activate the target highlighted at `toPageTime(m.t)` |
| `back` | `click click` | yes | no | go to the parent view |
| `toggle` | `click click click` | yes | yes | switch the mode |
| `scrollUp` | `hum.rise` | yes | no | scroll up by the hum step |
| `scrollDown` | `hum.fall` | yes | no | scroll down by the hum step |

The module exports the pattern strings, the two lists of patterns (`MODE_ON_PATTERNS`, `MODE_OFF_PATTERNS`) and the action of each pattern. The wiring builds `modes` from them.

### Modules and why they are pure
`history.ts`, `hum-scroll.ts`, `nav.ts`, `keys.ts`, `text.ts`, `steps.ts`, `bindings.ts`, `articles.ts` and `constants.ts` have no DOM type, no `'tokk'` import and no timer, and take every time as an argument. Types that Tokk would provide (an event, a model) are small structural types of the module (`HeardSound`, `ModelLike` with `examples: { label: string }[]`), which the real objects satisfy. This lets Vitest import them under `tsconfig.json` and keeps the logic testable without fake timers. `scan.ts`, `views.ts`, `ui.ts` and `main.ts` use the DOM and are covered by the browser tests.

### The scan (`scan.ts`, `history.ts`)
- **Targets.** `main a[href], main button:not([disabled])` that are visible (not `hidden`, not `display: none`, with a size), in document order. Recomputed on each view render.
- **Moves.** One pending `setTimeout` for the next move. On a move: set `data-scan="current"` on the new target (and remove it from the old), read `performance.now()` at that moment, `history.record(now, target)`, update the "Highlighted:" text, and `scrollIntoView({ block: 'nearest', behavior: 'auto' })` when needed. Then schedule the next move `stepMs` later. A timer that fires late records its real time.
- **Pause.** Clears the timer. **Resume** schedules one full step. A change of the step clears and reschedules one full step from now.
- **Run condition.** `running = (content state) && (listening on || keyboard only) && !userPaused && !dialogOpen`. One function `scanShouldRun(state)` decides, and every state change calls it, so the rule has one place.
- **The history.** `record(timeMs, target)` appends and drops entries older than `SCAN_HISTORY_KEEP_MS` before the newest, but always keeps the newest entry at or before the oldest kept time so that a lookup for a time inside the window still finds the element that was highlighted at the window start. A time that is before the previous record throws a `RangeError`. `lookup(timeMs)` returns the target of the last record at or before `timeMs`, or `null` when there is none (the history was cleared, or the time is before the first kept record). `clear()` empties it. The target type is a generic parameter, so tests use strings.
- **The element may be gone.** `main.ts` checks `target.isConnected` before `click()`.
- **The frame.** CSS `[data-scan="current"] { outline: 3px solid <colour>; outline-offset: 3px; }` where the colour has at least 3 to 1 contrast with the page background and with the link colour. No transition. The frame does not hide the focus outline: the focus outline is a second outline in another colour with a larger offset, so a focused and highlighted element shows both.

### The hum scroll (`hum-scroll.ts`)
State: the sound time `t` of the previous update, or none. `update({ t, speed, direction })` returns a signed step in px: `speed` times `HUM_SCROLL_PX_PER_S_PER_SPEED` times `dt` in seconds, where `dt = t - previousT` clamped to `HUM_UPDATE_DT_MAX_MS` and, for the first update after a reset (or after a gap above `HUM_UPDATE_DT_MAX_MS`), the fixed `HUM_FIRST_UPDATE_DT_MS`. `direction` `up` gives a negative step (the page moves up), `down` a positive one. `end()` forgets the previous `t`. A `speed` that is not finite or is negative throws a `RangeError`; a speed of 0 gives 0.
- Initial values: `HUM_SCROLL_PX_PER_S_PER_SPEED` 120 (so speed 6 scrolls 720 px/s and a typical speed of 2 scrolls 240 px/s), `HUM_UPDATE_DT_MAX_MS` 100, `HUM_FIRST_UPDATE_DT_MS` set from the measured update interval of the pitch tracker (step 6 of the tasks measures it and records it in "Measured values"; until then 20).
- The scroll is `window.scrollBy({ top: step, behavior: 'instant' })`, called inside the handler only. No timer, no frame loop.
- The text line is updated at most once per `RECOGNITION_UPDATE_MS` (150 ms) while a hum goes on, so the stream of updates does not rewrite the DOM at the tracker's rate. The scroll itself is not throttled.

### Navigation (`nav.ts`)
`View` is `{ kind: 'list' } | { kind: 'article'; id: string }`. Functions: `parseHash(hash, ids)` (a hash and the known ids give a view and a `notFound` flag), `formatHash(view)`, `parentOf(view)` (an article gives the list; the list gives itself) and `nextArticleId(id, ids)` (wraps). `main.ts` renders from `parseHash(location.hash)` on load and on `hashchange`. "Open" is `location.hash = formatHash(view)` through the link's own `href` (`#/article/<id>`), so activating the link by `click()` is the same as a mouse press. "Back" sets `location.hash = '#/'` unless already there.

### Teaching (`steps.ts`)
`STEPS` is an array of three objects: `{ label, examples?, text }`. `missingSteps(model)` takes `{ labels: string[]; examples: { label: string }[] }` and returns the steps in order: `click` when `labels` lacks `click`, `hum` when it lacks `hum`, `background` when no example has the label `background`. `allSteps()` returns the three for Teach again.

The runner (in `main.ts`) for each step: set the progress text, then `await ears.teach(step.label, { ui: true, examples: step.examples, text: step.text })`, three times in a row. On an `AbortError` it stops with the cancel text. On another error it shows the message. After the last step: `ears.setMode('on')`, scan on, state text "Listening is ON".

The next `ears.teach` of a step after the first is called as soon as the previous one resolves (the user has just pressed Save). The dialog of the previous step shows only its saved screen, so `ears.teach` closes it and opens the next one (Finding 4, requirement 16). The app does not wait for Close and does not match any error message. After the last step the dialog stays on its saved screen until the user presses Close.

### Teach texts (every string passes `resolveTeachText`)
| Step | Key | Text |
|---|---|---|
| click | `title` | `Step 1 of 3: your click` |
| click | `quiet` | `Stay quiet for a second, so the app can hear the room.` |
| click | `record` | `Make a tongue click {count} times, with a short pause between clicks.` |
| click | `saved` | `Saved. Step 2 of 3 comes next.` |
| hum | `title` | `Step 2 of 3: your hum` |
| hum | `recordHum` | `Hum one steady note at a comfortable pitch. Keep going for at least 2 seconds, then press Done.` |
| hum | `saved` | `Saved. Step 3 of 3 comes next.` |
| background | `title` | `Step 3 of 3: the room` |
| background | `recordBackground` | `Speak normally for about 10 seconds, as if you were talking to someone nearby. This teaches the app what to ignore. Then press Done.` |
| background | `saved` | `Saved. Press Close to start using the page.` |

The other keys keep the library's defaults. The numbers "2 seconds" and "10 seconds" come from `TEACH_HUM_MIN_S` and `TEACH_BACKGROUND_MIN_S` in `constants.ts`; U7 asserts that they equal the library's `WEB_TEACH_HUM_RECORD_MS` and `WEB_TEACH_BACKGROUND_RECORD_MS` divided by 1000, so a change in the dialog's minimum fails the test and not a user. The dialog is not themed (the app is generic), so no `--tokk-*` property is set.

### The page structure (`index.html`, `ui.ts`)
```
header
  h1 "Hands-Free reader"
  p#privacy        (always visible)
  div#state        big banner, role="status": "Listening is ON" + the instruction line; also "Microphone not in use (keyboard only)" and "Not ready: ..."
  p#mic-note       the microphone-stays-on sentence
section#intro      the start screen (hidden after the first choice)
section#controls   buttons: Teach again, Pause scan / Resume scan, Turn listening off/on, Keyboard shortcuts: on/off; range: Scan step
section#progress   teaching progress as text (hidden when not teaching)
section#recognition  p#heard  p#did  p#highlighted
main#content       the list or the article (the scan covers this only)
section#keys       the key map as a short list
```
The controls, the key list and the recognition lines are outside `main`, so they are not scan targets (Assumption 7).

### Keys (`keys.ts`)
`actionForKey({ key, ctrl, alt, meta, targetKind }, { shortcutsOn, dialogOpen })` returns one of `activate`, `back`, `toggle`, `pause`, `teach` or `null`. `key` is compared case-insensitively. `targetKind` is `'text'` for input, textarea, select and editable elements, `'other'` otherwise (the DOM listener maps the target). A `K` with the focus on a range input is allowed (a range does not take letters).

### Text (`text.ts`)
Pure functions: `heardSound(label, listening)`, `heardUnknown(listening)`, `heardHum(direction, speed)`, `heardHumEnded()`, `didOpened(title)`, `didBack()`, `didAlreadyAtList()`, `didListening(on)`, `didScrolled(direction)`, `didNothingNoTarget()`, `didNothingNoTiming()`, `withKey(text, key)`, `stateText(state)`. The formats are those of requirement 7.2, character by character, in U6.

### Test hooks
Two attributes, no behaviour: `data-lookup-page-ms` on `#did` (the value `ears.toPageTime(m.t)` returned for the last `click`, in ms with one decimal) and `data-view` on `main` (`list` or the article id). E1 uses the first to check, from inside, that its arrangement of the scan matched the lookup (below). They are not documented as an API.

### The wiring (`main.ts`)
Counted lines are the lines between the markers, which include the import and the function wrapper that holds `listen()` (it must run inside the click handler of "Start with the microphone"). The target is 20. A first sketch in words: one `import { listen } from 'tokk'`; inside the start function one `listen({ storageKey, modes, mode, onEvent })` whose `modes` come from `bindings.ts` and whose handlers call small functions of the glue (`app.activate(ears.toPageTime(m.t))`, `app.back()`, `app.toggle()`, `app.hum('up', m)`, `app.hum('down', m)`); the `onEvent` call `app.heard(e)`; the step loop with `ears.teach` (three awaits in a row); one `ears.setMode` inside the toggle. If the real count is above 20 the number is reported (requirement 1.4). Every use of `ears` is inside the block, so the glue functions receive times, labels and a mode setter as arguments and never see `ears`.

### Constants (`constants.ts`)
| Name | Initial value | Meaning |
|---|---|---|
| `STORAGE_KEY` | `'tokk:hands-free'` | the `storageKey` |
| `SCAN_STEP_MS_DEFAULT` | 1200 | default time between moves |
| `SCAN_STEP_MS_MIN` / `SCAN_STEP_MS_MAX` | 600 / 3000 | the range |
| `SCAN_STEP_MS_INCREMENT` | 200 | the slider step |
| `SCAN_HISTORY_KEEP_MS` | 10000 | at least the largest step (3000) plus the longest wait of a pattern (1000, a rest) plus the lag of the mapping, with a margin |
| `HUM_SCROLL_PX_PER_S_PER_SPEED` | 120 | scroll speed per unit of `m.speed` |
| `HUM_UPDATE_DT_MAX_MS` | 100 | longest `dt` of one hum step |
| `HUM_FIRST_UPDATE_DT_MS` | 10 (measured: the tracker updates every 10 ms) | `dt` of the first update of a hum |
| `RECOGNITION_UPDATE_MS` | 150 | least time between two rewrites of a hum text |
| `TEACH_CLICK_EXAMPLES` | 10 | examples of the click step |
| `TEACH_HUM_MIN_S` / `TEACH_BACKGROUND_MIN_S` | 2 / 10 | what the texts say (equal to the dialog's minimum) |
| `FOCUS_OUTLINE_PX` / `SCAN_FRAME_PX` | 2 / 3 | outline widths in the style |
| `STATE_BANNER_FONT_SCALE` | 1.5 | banner size relative to the body font (a ratio, no unit) |

### Style
One inline `<style>` in `index.html`. Colours: text `#1a1a1a` on `#fafafa`, links `#1d4ed8`, visited `#5b21b6`, the scan frame and the focus outline in two dark colours that each have at least 3 to 1 against `#fafafa` and against the link colour, the banner with a 3 px border in `#1a1a1a` (the state is in words as well). No `transition`, no `animation`, no `scroll-behavior: smooth`. Layout in `rem`, a column no wider than 46 rem, `overflow-wrap: anywhere`, so 320 px width and 200 per cent zoom work. U9 parses the hex colours of the style block and checks the contrasts.

### The articles
Three objects in `articles.ts`: `bread-rises` ("Why bread rises"), `vanishing-puddles` ("Where puddles go"), `houseplant-basics` ("Keeping a houseplant alive"). Each has a one-sentence summary and 8 to 10 paragraphs of 30 to 50 words. Rules for the writer: original, plain, short sentences, no brand, product, company, person, place name, quotation, advice about health, law or money. Facts are the everyday kind that is true in all places (warmth and yeast make dough rise, water leaves a puddle by evaporation, a plant needs light and the right amount of water). Kiro writes them in step 5. A person reads them in step 9 against the checklist of the tasks.

## The fixture and the timeline
One WAV at `WEB_TEST_SAMPLE_RATE_HZ` (48000 Hz), made by `test/web/hands-free-fixture.ts`, with a JSON of the start time of every part. Chrome plays it once from the moment the stream opens. The flow is driven by the test (it presses Done, Save and Close), so the quiet gaps between the parts must be longer than the slowest handling. Every time below is a stream time in ms, built from named constants; the values are the first values, and step 5 sets them from the measured handling times with at least a factor of 2 margin and records them.

| Part | From | Content | Rule |
|---|---|---|---|
| Calibration lead | 0 | noise bed at `SYNTH_FIXTURE_LEAD_NOISE_DBFS` | `WEB_TEST_TEACH_LEAD_MS` (3000): the app opens the dialog, and its quiet second fits in it |
| Click teaching | 3000 | 10 clicks, 800 ms apart (`WEB_TEST_IMPACT_SPACING_MS`), each with its own seed | the dialog counts exactly 10 |
| Gap A | after the last click | quiet, 12000 | Done, training, Save, the next `ears.teach` closes the saved dialog, the hum dialog opens |
| Hum teaching | after gap A | steady tone at 150 Hz (`WEB_TEST_HUM_BASELINE_HZ`) with 50 cents vibrato (`HUM_VIBRATO_CENTS`), 4000 | longer than the dialog's 2000 ms minimum; the test presses Done after the hum ended |
| Gap B | after the hum | quiet, 12000 | the same handling, the background dialog opens |
| Background teaching | after gap B | speech-like shaped noise, 13000 | longer than the dialog's 10000 ms minimum; the test presses Done after it ended |
| Gap C | after the noise | quiet, 14000 | Done, training, Save, Close, `setMode('on')`, the new engine's calibration (1000), the keyboard step that sets the minimum scan step, the arrangement of S1 |
| S1 | after gap C | one click | arranged scan; opens the article |
| S2a, S2b | S1 plus 8000 | a steady hum at 150 Hz with vibrato, 2000; quiet 3000; then a falling hum 150 Hz to 106 Hz (6 semitones) with vibrato, 3000 | steady scrolls nothing; falling scrolls and stops |
| S3 | after the hum plus 8000 | two clicks 250 ms apart | back to the list |
| S4 | S3 plus 8000 | speech-like noise, a new seed, 3000 | nothing fires |
| S5 | S4 plus 8000 | three clicks 250 ms apart | listening off |
| S6 | S5 plus 8000 | one click | nothing opens |
| S7 | S6 plus 8000 | three clicks 250 ms apart | listening on |
| Tail | S7 plus 6000 | quiet | screenshot |

All parts have the noise bed under them. The impacts are at `WEB_TEST_GAIN_DB` (-6 dBFS peak). The speech-like noise is at about -35 dBFS RMS (a named constant, checked in Node). Clicks inside a pattern are `HANDS_FREE_CLICK_GAP_MS` (250 ms, less than the 350 ms of a consecutive gap) apart.

### Why these stand-ins are fair
The stand-ins make the pipeline do what it does for a real mouth. They do not make the recognition of a real mouth proved.
- **Click: the impact class `high` of `core/synth`** (white noise through a band centred on 3500 Hz, an exponential decay of 25 ms, a 75 ms duration, a 10 ms fade-out, each copy with its own random seed). A tongue click is a short, bright transient with most of its energy in the low kilohertz and a decay of a few tens of milliseconds. The class has the properties the pipeline reacts to: a sharp onset, a fast decay, a broad spectrum, a duration well under the segment limit. Each copy differs by the random seed, as two real clicks differ, so the kNN has a spread to learn. It is the same class the other web fixtures use as `tap`, so its behaviour in Node and Chrome is already known. It does not show how well a real click is told from a cough or a spoken "t", which needs recordings.
- **Hum: a harmonic tone with vibrato** (`synthTone`, fundamental 150 Hz, three harmonics at 1/h, 50 cents of vibrato at 5 Hz, a glide for the falling hum). A hum is a voiced, periodic sound with a stable pitch between 80 and 400 Hz and a small wobble. The tone has a clear pitch for the tracker, harmonics for the high-energy ratio test, and a wobble well inside the +-2 semitone dead zone, so the test can tell a steady hum (no scroll) from a deliberate fall. A real hum has formants, breath and a drifting pitch that the tone does not have, so the stand-in cannot show how often a real hum or a spoken vowel crosses the dead zone by accident (experiment E5).
- **Background: pink noise with a syllable-rate envelope and short pauses** (`synthNoise('pink')` multiplied by a 4 Hz raised-cosine envelope with 60 to 100 per cent depth and a pause of 100 to 300 ms every second or so, from a seeded generator). The background class exists to absorb sounds that are not the app's sounds: sustained, broadband, modulated at the rate of speech, with no sharp onset. The noise has those properties, and the probe (S4) is the same generator with another seed, so it shows that background-like sound fires nothing. A real voice has plosives, which are the cause of wrong clicks and which this noise lacks. That risk is not tested here, which is why the human check (wrong clicks per hour, listening on and off) stays, and why the speech guard is a later decision.

### Node check of the fixture
`checkHandsFreeFixture` runs in the global setup and throws with a message that names the part:
1. The click teaching part has exactly 10 segments (`checkTeachSegments`).
2. A model made the way the dialog makes it (`retrainLabel` for `click` from the 10 segments, the hum baseline from the hum part with `medianPitchHz`, the background windows from the background part) recognises the test part with the app's patterns (`runSamples` with the `on` list): exactly one `click` at S1, one `hum.fall` match run in S2b and none in S2a, one `click click` at S3, nothing in S4, one `click click click` at S5, one `click` at S6, one `click click click` at S7. The same part with the `off` list gives only the matches of S5 and S7.
3. The times in the JSON are within one sample of the written file.

### The arrangement of S1 (the click lookup)
The point of E1 is that the click opens the element highlighted when the sound was made and not the one highlighted when the match arrives (350 ms later or more). The scan runs at its own pace, so the test makes the scan phase deterministic with the pause and resume controls, driven by timers inside the page so that no Playwright round trip enters the timing.
1. An init script wraps `navigator.mediaDevices.getUserMedia` and stores `performance.now()` when its promise resolves as `micStartMs`. The file starts to play when the stream opens, so `S = micStartMs + (the stream time of S1)` is the page time of the click, within `SYNC_TOLERANCE_MS`.
2. After the teaching, with the scan step set to its minimum (600 ms, `Home` on the slider), the test schedules in the page: a pause at `S - 1500`, and a resume at `S - 425`. After the resume the next move is one full step (600 ms) later, at `S + 175`.
3. At `S - 1000` the test reads the highlighted target `X` (its text) and the next target `Y` in document order. At the click the highlight is on `X`. At `S + 175` it moves to `Y`. The match arrives at `S + 350` or later, when the highlight is on `Y`.
4. The opened article must be `X` (the hash is `#/article/<id of X>` and the heading is its title). `X` is different from `Y` because the list has three targets.
5. The self-check: the app writes the page time of its lookup in `data-lookup-page-ms`. The test asserts that its value is within `SYNC_TOLERANCE_MS` of `S`. If it is not, the test fails with the two numbers and says that the clock sync of the arrangement, not the app, is out. The window is 175 ms on each side of `S + 175`, `toPageTime` is within 50 ms, so `SYNC_TOLERANCE_MS` is 100 ms. IF the measured offset between `micStartMs` and the true start is above 100 ms in step 5, the step stops and reports the measured offsets. It does not widen the tolerance or weaken the assertion.

## Tests
| Id | File | What it proves |
|---|---|---|
| U1 | `test/hands-free-history.test.ts` | lookup by page time: between moves, at a move, before the first (none), after the last, after pruning, after `clear`, out-of-order record throws; a property test against a plain reference |
| U2 | `test/hands-free-gate.test.ts` | the table (`off` holds exactly `click click click`); against the real engine (`runSamples` with synthetic clicks and hums and a model taught from synthetic impacts, with a pitch baseline): `on` fires `click`, `click click`, `click click click` and the two hum patterns for the matching input; `off` fires only `click click click`, and nothing for one click, two clicks, a rising hum and a falling hum |
| U3 | `test/hands-free-hum-scroll.test.ts` | the step is proportional to speed (doubling the speed doubles the step, a property test), proportional to `dt`, signed by the direction, 0 for speed 0, clamped `dt`, a fixed first step, `end()` makes the next update a first update, bad speeds throw. It also checks that no update after `end()` returns a step without a new call (the module has no timer) |
| U4 | `test/hands-free-nav.test.ts` | list to article to list; `parentOf(list)` is the list; a hash round trip for every id; unknown id and junk hashes give the list with `notFound`; `nextArticleId` wraps |
| U5 | `test/hands-free-keys.test.ts` | each key to its action, case-insensitive, the ignore rules (modifiers, text targets, dialog open, shortcuts off), the keys that must not be taken (arrows, Space, Tab, Enter) |
| U6 | `test/hands-free-text.test.ts` | the formats of requirement 7.2 character by character, a glyph always with its word |
| U7 | `test/hands-free-steps.test.ts` | `missingSteps` for an empty model, a model with each label, all taught; the order; the example count; every text passes `resolveTeachText` (imported from `web/teach-ui/text` in the test only); `TEACH_HUM_MIN_S` and `TEACH_BACKGROUND_MIN_S` equal the dialog's minimums |
| U8 | `test/hands-free-wiring.test.ts` | no `from 'tokk'` value import and no `ears.` outside the markers in `apps/hands-free/src/**`; the markers exist and are closed; the pure modules have no `document`, `window`, `HTMLElement` or `'tokk'`; `countWiring` gives a number (reported, not limited); no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `onEnvelope` |
| U9 | `test/hands-free-articles.test.ts` | the article data rules; the contrast of the style colours; no `transition`, `animation` or `smooth` in `index.html`; `lang="en"`; the privacy sentence is in `index.html` |
| E1 to E4, E7 | `test/web/hands-free.spec.ts` (serial block, one Chrome with the generated WAV) | requirement 13.3 to 13.6 and 14.1 |
| E5 | same file | the keyboard-only run |
| E6 | same file | the landing link under `/tokk/` |

The "off gate" is tested twice, on purpose: U2 shows that the engine with the app's table does it, E4 shows that the page's wiring uses that table.

### E5, keyboard only
The default Chrome of the project (the fake microphone plays the existing `listen-test.wav`, which makes no difference because the microphone is not started until `T`). Steps, with real key presses only: open the page; Tab to "Use the keyboard only" and Enter; the content shows, the listening state reads "Microphone not in use (keyboard only)"; `P` pauses the scan, the scan frame stays; Tab to the slider and `Home` sets 0.6 s, Tab away; `P` resumes; wait for a move; `P`, then `K` opens the highlighted article (the hash and heading match the highlighted target read before); `PageDown` scrolls (the scroll position grows, the article is taller than `ARTICLE_SCROLL_MIN_PX`); `B` goes back; `L` writes that listening needs the microphone; the shortcuts button turns the letter keys off (`K` does nothing) and on again; every control reached by Tab has an outline of at least 2 px (`getComputedStyle`); `T` starts the microphone and opens the teaching dialog with the title "Step 1 of 3: your click"; `Esc` cancels with the sentence "Teaching was cancelled. Press Teach again to continue."; no request leaves the origin; no console error.

### E6, under `/tokk/`
`buildSite({ outDir, appsDir: <the real apps folder> })` into a temporary folder, `startSiteServer(outDir, '/tokk/')`, open `/tokk/`, follow the link whose `href` is `apps/hands-free/`, wait for the start screen, check the heading and the privacy line, press "Start with the microphone" (the fake microphone of the project, `listen-test.wav`), see the dialog (`[data-tokk-teach]`) with the title "Step 1 of 3: your click", press `Esc`. All requests start with `/tokk/` (the favicon is the one allowed exception of Task 21), no console error. The temporary folder is removed.

### Browser-test arrangement (E1 to E4, E7)
- `test.describe.serial`, one `beforeAll` that launches Chrome with `fakeMicArgs(<the generated WAV>)` and one context and page, an init script for `micStartMs`, and one `afterAll` that closes it. `baseURL` is the dev server.
- E1 goes through the real flow by pressing the dialog's own buttons (`[data-action="done"]`, `save`, `close`) at the right moments as the existing specs do (`teachCopies`, `closeDialog`), but it does NOT call `ears` and does not open any dialog itself: the app does, and the test waits for `[data-tokk-teach]` to appear with each step's title. It asserts that the progress text shows the right step, that the app opens the next dialog after Close with no further press, and that after the last Close the state reads "Listening is ON". It asserts that the model is stored under `tokk:hands-free` (a JSON entry with a model whose labels include `click` and `hum`, and no field of audio).
- Each later test waits on page state (the hash, the state text, the scroll position) with a named timeout, and each sound group has at least 6 s of quiet before it.
- The screenshot (E7) is taken at the end, in the list view with listening on, after one more move of the frame, with the recognition lines filled from S7.

## Changed tests
- None of the existing test expectations changes. `test/web/global-setup.ts` and `test/web/paths.ts` only gain lines, and `test/web/teach.spec.ts` gains the test E8 (requirement 16). `test/kiro-config.test.ts` A9 needs the `docs/kiro.md` row (a table row, not a change of the test), as for Tasks 20 and 21. The `ui.md` change is covered by the existing test of the steering files, which the implementer reads in step 1. The `integrate.md` line and the skill line must keep `test/kiro-config.test.ts` passing (both files keep naming the same terms).

## Risks
- **Timing of the long fixture.** The gaps are long on purpose. A slow machine could still exceed them. The first run measures the handling times, and a failure names the part that was played before its dialog was ready.
- **Clock sync of E1.** Described above. The self-check makes a bad sync fail clearly instead of making a flaky pass.
- **The template fix (Finding 4).** `ears.teach` now closes a finished dialog. A caller that relied on the rejection while a saved screen was open would see a change. No code in the repository does (the existing "already open" test opens a dialog that is still recording, and it still rejects).
- **Real microphone behaviour is untested here.** The stand-ins show logic, not recognition. The human check of plan 3 and experiments E3 and E5 decide the rest. A person must run that check before the app is shown in a video.
- **Hum scroll speed is a guess.** `HUM_SCROLL_PX_PER_S_PER_SPEED` is set so that the largest speed is not faster than a person can follow. It is tuned in the human check.
- **A real input device delay.** `toPageTime` is the time the sound reached the page. A fixed device delay makes the lookup late by that delay. A person using a wireless headset at the smallest step could see a wrong element near a move. A measurement for the human check.
- **The microphone stays on while listening is off.** The page says so. A user who wants it off closes the page.
- **Dead landing link to `knock-once`** until Task 23.

## Later decisions (not in this task)
1. **The speech guard** (block clicks for a time while speech is heard). Decide after real recordings. The place is a check in the `activate` path before the lookup, and a "Heard: speech" text.
2. **Stored scan speed and shortcuts setting.** A hands-free user cannot set them without help. A small `localStorage` entry (no audio) would remember them.
3. **A "Stop microphone" control** that calls `ears.stop()`.
4. **A close signal** (resolve `teach` on close, or an `onClose` option). Not needed now that a finished dialog is closed by the next `ears.teach`.
5. **The Chrome extension** (Task 24).
6. **Teach by sound only.** The "Teach again" control is not a scan target, because teaching needs sounds that the user is making.
7. **A debug view** (`debug: true` behind a URL parameter) for the human check.

## Measured values (the implementer fills these in)
- Start (step 1.1): 2026-11-20 18:06 +09:00 (system clock, the zone is UTC+09:00); base commit 3a32cf3 (uild: add app bundles, static site and wiring line count). The spec text was edited first for the operator's change (requirement 16).
- Start: the system clock time with zone, and the base commit hash, written before the first change. The end is the final commit, read from `git log` by the operator. No duration in hours.
- Facts of the Introduction that differed from the code, if any.
- Before and after: the vitest count, the Playwright count and the runtimes.
- The wiring lines from `npm run count:wiring` for `apps/hands-free`, and the blocks.
- The size of `apps/hands-free/dist/app.js` (minified) and of the app in `site/`.
- The measured handling times of the fixture (from the last click to the hum dialog being ready, the same for the other two gaps) and the gap values that follow.
- The offset between `micStartMs` and the true start of the stream (from the self-check of E1), and the largest `toPageTime` error seen in E1.
- The update interval of the pitch tracker for a hum (the value for `HUM_FIRST_UPDATE_DT_MS`).
- The wall time of E1 to E4 (the whole serial block).
- The words of each article, and the result of the reading checklist.
- The contrast ratios of the style colours.

### Results (filled in by the implementer, 2026-11-20)
- **Start:** 2026-11-20 18:06 +09:00, base commit 3a32cf3. The end is the final commit, read from `git log`. No duration in hours.
- **Differences of the Introduction facts:** none found in the parts that were read (`web/listen.ts`, `web/teach-ui/teach-dialog.ts`): `ears.teach` resolved on Save, the dialog stayed on its saved screen and a new `teach` rejected with "ears.teach(): a teach dialog is already open. Save or cancel it first." That behaviour is the one requirement 16 changes. The other facts of the Introduction (labels, inert hum patterns, `toPageTime`) were not read again one by one. They are covered by the Task 20 tests and by E1 to E4. The WAV is larger than the tasks assumed: the stream is 127775 ms long, so the file is 12266444 bytes at 48000 Hz and 16 bits (the 5 to 6 MB of step 3.1 came from a shorter plan). It is in the ignored folder and is not committed.
- **Before and after.** Vitest before: 841 passed, 1 failed, 2 todo (46 files, 69 s). The failure was `test/kiro-config.test.ts` A9, which fails whenever a new spec folder is not listed in `docs/kiro.md`. Vitest after: 927 passed, 2 todo (55 files, 71 s). Playwright before: 44 passed (4.2 min). Playwright after: 52 passed, twice (6.5 min each). The new Playwright tests are E1 to E7 (7) and E8 (1). `npm run pbt:quick`: 144 passed, 2 todo (14 s). The three type checks, `npm run build`, `npm run build:site` and `npm run check:public-api` pass. `PBT_RUNS=1000 npm test` was not run.
- **Wiring lines (`npm run count:wiring`):** `apps/hands-free` 17 lines (target 20), in one block of `main.ts`. `examples/hello` 7 lines.
- **Sizes:** `apps/hands-free/dist/app.js` 116409 bytes (minified, with the Worker source). The app in `site/apps/hands-free/`: `index.html` 5189 bytes and `dist/app.js` 116409 bytes, and nothing else. The whole site was 370885 bytes in 8 files. `site/` was deleted after the check. The relative-URL scan of Task 21 (`scanSiteFile`) found no problem in the two files. `npm pack --dry-run`: 55 files, no `apps/` entry, 250.1 kB.
- **Handling times of the fixture (E1, three runs):** Done to the hum dialog ready 79 to 136 ms (gap A is 12000 ms), Done to the background dialog ready 98 to 103 ms (gap B is 12000 ms), Done to Close and "Listening is ON" 1418 to 1445 ms (gap C is 14000 ms). Every gap is at least 8 times the handling time, so the first gap values stay.
- **Clock self-check of E1:** the arrangement was set at stream time 53708 to 53732 ms for a first timer at 63700 ms (about 10 s of margin). The page time of the lookup minus the page time of the arranged sound was 3.3, 5.7, 4.9 and 0.5 ms over four runs (limit `SYNC_TOLERANCE_MS` 100 ms). The tolerance was not widened. `toPageTime` therefore agreed with `micStartMs` within 6 ms in every run, which is the only `toPageTime` error that E1 shows.
- **Pitch tracker update interval (step 1.5):** 10 ms for a steady synthetic hum (min, max and mean all 10.00 ms over 286 updates, Node engine). `HUM_FIRST_UPDATE_DT_MS` is 10. `HUM_SCROLL_PX_PER_S_PER_SPEED` stays 120: in E3 the falling hum moved the page by more than 100 px and less than the article height, and the scroll stopped within `HUM_STOP_SETTLE_MS`.
- **Wall time of E1 to E4 and E7:** about 2.1 min for the serial block (1.1 min for E1, 18 s for E3, 6 s for E2, 32 s for E4, 1 s for E7), as one Chrome on one 127.8 s stream.
- **Words of the articles:** `bread-rises` 8 paragraphs, 312 words; `vanishing-puddles` 8 paragraphs, 309 words; `houseplant-basics` 8 paragraphs, 316 words. The reading checklist of step 5.2 was not run as a person's check: the text is the implementer's own, the unit test finds no markup, quotation, capitalised name in a sentence or advice word, and a person must still read the three texts.
- **Contrast of the style colours (U9):** text on the page `#1a1a1a` 16.67, link `#2563eb` 4.95, visited link `#5b21b6` 8.61, text on a button 14.06. Frame `#1a1a1a` 16.67 on the page and 3.37 on the link colour. Focus outline `#2e0a4f` 15.81 on the page and 3.19 on the link colour. Banner border 16.67 on the page.
- **Template fix (requirement 16):** `web/listen.ts` got a flag `dialogSaved`; E8 failed before the change (the saved screen was still there) and passes after it. Every other test of `test/web/teach.spec.ts` passes unchanged.
- **Test-only finding:** the keyboard test failed once in about 40 runs because Back (`B`) sets the hash and the page renders on the later `hashchange` event, which moved the focus to the heading after the test had tabbed to a button. The test now waits for the list heading after `B`. The app did not change.