# Design: Task 26, the third case, a reveal.js slide deck with sound control

## Layout
```
cases/slides/index.html               the deck (5 or 6 sections), the stock theme link, the script link; stage 2b adds one button    [new]
cases/slides/src/main.ts              starts reveal.js through its public API as `deck`; stage 2b adds the marked wiring            [new]
cases/slides/src/constants.ts         every number with its unit                                                                    [new, pure]
cases/slides/src/reveal.d.ts          only if the package ships no usable types (requirement 2.5)                                  [new, maybe]
cases/slides/src/caption.ts           the caption texts                                                                             [new in 2c, pure]
cases/slides/src/style.css            our own CSS: caption, start button, motion override (name fixed by step 1.2)                  [new]
cases/slides/README.md                reveal.js credit (stage 1); the synthetic note (2a); how to use (2c)                          [new]
cases/slides/LICENSE-revealjs.txt     byte copy of the LICENSE of reveal.js 6.0.2                                                   [new]
cases/slides/sounds/clap/clap-01.wav  ten synthetic claps                                                                          [new in 2a]
cases/slides/sounds.json              feature vectors built by sounds:rebuild                                                       [new in 2a]
cases/slides/recordings/clap-x2.wav   synthetic: two claps                                                                          [new in 2a]
cases/slides/recordings/clap-x3.wav   synthetic: three claps                                                                        [new in 2a]
scripts/build.ts                      builds cases like apps                                                                        [changed]
scripts/build-site.ts                 copies and bundles cases, skips sounds.json of a case, `casesDir` option                      [changed]
scripts/count-wiring.ts               + `cases/<name>` groups, kind `case`                                                          [changed]
scripts/check-public-api.ts           + scans `cases/`                                                                              [changed]
site-src/index.html                   + one list item                                                                               [changed]
.gitignore, tsconfig.web.json         + `cases/*/dist/`, + `cases/*/src/**/*.ts`                                                   [changed]
package.json, package-lock.json       + devDependency reveal.js 6.0.2 (exact)                                                       [changed]
.kiro/steering/ui.md                  + `cases/slides/**/*` in fileMatchPattern                                                     [changed]
docs/kiro.md, docs/devlog.md          one row, one line per commit                                                                  [changed]
docs/integration.md                   stage 1: wiring row; 2c: third-case row and the double-clap check                             [changed]
docs/images/slides.png                written once with TOKK_WRITE_SCREENSHOT=1                                                     [new in 2c]
README.md, apps/README.md             a short note and a licence line; one sentence                                                 [changed in 2c / stage 1]
test/helpers/slides-claps.ts          the clap stand-in recipe (constants and a function)                                           [new in 2a]
test/count-wiring.test.ts             + U1                                                                                          [changed]
test/check-public-api.test.ts         + U2                                                                                          [changed]
test/build-site.test.ts               + U3 (and the named updates it needs)                                                         [changed]
test/slides-deck.test.ts              U4, U5, U10 (reads files only)                                                                [new]
test/slides-sounds.test.ts            U6, U7                                                                                        [new in 2a]
test/slides-events.test.ts            U8, written by the integrator agent                                                           [new in 2b]
test/slides-caption.test.ts           U9                                                                                            [new in 2c]
test/integration-doc.test.ts          named updates I1, I2                                                                          [changed]
test/web/slides.spec.ts               E0 and E5 (stage 1), E1 to E4 and E6 (2c)                                                    [new]
test/web/slides-fixture.ts            generator and Node check of the stream for E1                                                 [new in 2c]
test/web/global-setup.ts, paths.ts    + the generator call, paths and URLs                                                          [changed in 2c]
```
Unit tests live in `test/` (Vitest in Node). Browser tests live in `test/web/` (Playwright). The case modules that a Node test imports (`constants.ts`, `caption.ts`) use no DOM type and no `'tokk'` import, because `tsconfig.json` has no DOM and follows imports from `test/` (the same rule as Task 22).

## Assumptions (written without a person to ask)
1. **The operator's choice of reveal.js is final.** The fallback rules below cover only facts about reveal.js 6.0.2 that could not be read when this spec was written.
2. **Three claps need no alternative table.** The grammar was read (requirements, Introduction) and U7 proves it before the agent runs.
3. **The synthetic examples are committed.** They are small, they are labelled synthetic in three places, and the Node tests need them on a clean checkout. `fixtures/audio/synth/` is committed on the same reasoning. `.gitignore` is not changed for them.
4. **The deck object is named `deck`.** The plan and the task say `Reveal.next()`. The prompt says `deck.next()` and explains that it is the same object of the same public API. IF step 1.2 finds that `next` or `prev` have other names in 6.0.2, the prompt is changed before 2b and the change is written in "Measured values".
5. **One caption element, one start button.** The plan asks for a caption; the button is needed because `listen()` must run after a click (browser rule in `integrate.md`).
6. **The caption calls are added by 2c inside the agent's handlers.** The alternative is a caption driven by a second event source. It would need `onEvent`, which shows sounds and not patterns, so the pattern text is only available in the handlers. The cost is a few lines in the marked block, reported openly (requirement 16.3).
7. **Targets for the human check** ("at least 9 of 10") are a decision of this spec. The operator may change them in the 2c prompt.
8. **No `debug: true`.** The overlay would sit on the deck and in the screenshot. The caption is the visible result.
9. **No change to `.kiro/hooks/public-api-only.json`.** It checks saves in `apps/**` only. Extending it is not needed for the checks of this task (`check:public-api` covers `cases/`), and the file is out of scope. Recorded as a later decision.

## Findings from reading the code
1. **The plan's three claps question is answered by the grammar.** `Matcher.push` keeps a sequence while any pattern can still extend it, and `settle()` fires at once only when nothing longer can extend the match. With `clap clap` and `clap clap clap` in one set, the second clap leaves `clap clap` exact but extendable, so it waits for `advance(t)` to show that no third clap came in time. The third clap extends the sequence and `clap clap clap` fires alone. `clap clap` fires about 350 ms after the second clap (`GAP_CONSECUTIVE_MAX_MS` less `GAP_TOLERANCE_MS`). A single clap is a valid prefix of both and fires nothing. The visible cost is a delay on the next-slide action. It is written in the case README and in the 2c caption hint.
2. **`expectEvents` checks sound labels, not patterns.** It returns the labels of the `sound` events in order (`node/expect.ts`). "One expectEvents test per pattern" therefore means: the recording for the pattern gives the labels the pattern is made of. The pattern firing itself is proved by U7 (engine and matcher) and by E1 (the browser). This is stated in the README so nobody reads U8 as more than it is.
3. **Tests import Node code by relative path.** Existing tests import `'../node/score'`, `'../core/engine'` and so on. Vitest has no `tokk/node` alias and `tsconfig.json` has no `paths`. The prompt therefore names `'../node'` (`node/index.ts` exports `expectEvents`, `teachFromDir`, `readWavFile`). Step 2a.1 confirms that this import works in a Vitest test before the prompt is used.
4. **`sounds:rebuild` writes the model next to the folder it reads.** `sounds:rebuild cases/slides/sounds` reads `cases/slides/sounds/<label>/*.wav` and writes `cases/slides/sounds.json`. It refuses to overwrite a file that is not a model, needs at least 5 examples per label, and prints the leave-one-out accuracy and the confused pairs.
5. **A recording needs a quiet lead.** The first second is the calibration window (`NOISE_FLOOR_WARMUP_MS`), and `teach` warns `sound-in-calibration` otherwise. `fixtures/audio/synth` and `test/web/fixture.ts` use `NOISE_FLOOR_WARMUP_MS` plus a margin.
6. **The shared test constants already exist.** `test/web/fixture.ts` exports `WEB_TEST_SAMPLE_RATE_HZ`, `WEB_TEST_TEACH_COPIES`, `WEB_TEST_IMPACT_SPACING_MS`, `WEB_TEST_TEACH_LEAD_MS`, `WEB_TEST_GAIN_DB` and `checkTeachSegments`. `test/helpers/engine-fixture.ts` has `makeSignal`, `Hit` and `buildModel`. `test/web/hands-free-fixture.ts` shows the pattern for a stream that drives a teach dialog, a JSON of times and a Node check. The new fixture copies the shape and uses `mid` instead of `high`.
7. **The shared build functions take roots as arguments.** `findApps(appsDir)`, `appBuildOptions(appDir, ...)`, `buildApps(appsDir)` and `watchApps(appsDir)` are generic over the folder. A case needs the same build with another root, so the change is small: call them for `cases/` too.
8. **Esbuild bundles CSS imported from JavaScript into a file beside the bundle** (`app.css` next to `app.js`). Whether the stock theme CSS references font files is unknown until step 1.2, so the loader rule below is conditional.
9. **`legalComments: 'none'` drops licence comments from the bundle.** The MIT licence asks for the notice in copies and substantial portions. The LICENSE copy in the case folder is shipped to the site for this reason (requirement 1.4).
10. **`test/kiro-config.test.ts` pins `integrate.md` front matter** (`apps/**/*` and `docs/integration.md`). The agent has the file as a resource, so the pattern need not include `cases/`.

## Decisions

### The import of reveal.js (rule, not a guess)
Step 1.2 reads `node_modules/reveal.js/package.json` and records: `exports` (or `main`/`module`/`style`), the author, the licence, the types field, and the files of the theme and the base CSS. Then:
| Question | If yes | If no |
|---|---|---|
| Does `exports` (or the absence of an `exports` field) allow the JavaScript entry that the package documents? | Import it by the package name (`import Reveal from 'reveal.js'` or the form its README documents). | Stop and report. The case cannot call the public API. |
| Does the package expose the base CSS and a stock theme CSS as importable exports? | `import` them in `main.ts` by the allowed specifier. Esbuild writes `dist/app.css`; `index.html` links it. | The CSS is a file in the package that `exports` does not expose: do not import a forbidden deep path. Instead the site and dev builds copy the two CSS files unchanged from `node_modules` to `cases/slides/dist/` (a copy, not an edit), and `index.html` links them. The copy is a named step of the build. Record it. |
| Does the stock theme CSS reference font files? | Allow esbuild's `file` loader for `.woff`, `.woff2` and `.ttf` in the case build only, with the assets emitted beside the bundle and referenced by relative URLs. The fonts are part of the package and keep its licence (a note in the case README). | No loader is needed. |
| Does the package ship type declarations that `tsc` accepts under `strict`? | Use them. | Add `cases/slides/src/reveal.d.ts` with only the members the case uses (the constructor or default object, `initialize`, `next`, `prev`, `on` if the case uses it). |
Configuration keys used for motion (transition, background transition, auto animate, controls tutorial or similar) are the ones that the package's own documentation or types name. Step 1.2 records the exact names. A key that does not exist in 6.0.2 is not used, and the CSS override of requirement 3.4 covers the case.

### The deck
Six sections at most, original text, in this order:
1. Title: "Tokk" with the line "Teach it a sound. Bind a pattern. Ship."
2. "What it is": a template that lets a web page react to short sounds, with the sound model kept on the device.
3. "Teach a sound": record about ten examples of one sound, such as a clap, and build a small model.
4. "Bind a pattern": a pattern is a few sounds in a row (two claps, three claps) and an action. Three short lines of text, not a code image.
5. "Your audio stays here": nothing is sent anywhere, no recording is stored by the page, only feature numbers.
6. (optional) "Try it": open the deck, press Start sound control, clap twice, clap three times. Written without the word "reveal.js" as a heading.
The deck is stage 1, so slide 6 says "use the arrow keys" in stage 1 and 2c changes the one sentence to mention the claps. This is the only slide text that changes in stage 2, and it changes in 2c by a small edit (its test is U4 with the text read from the file). Keep no number and no measured claim in the text.

### The build of a case
`scripts/build.ts` gets a `CASES_DIR` next to `APPS_DIR`. `findApps` is called with each root (the name rule and the "no src/main.ts" warning stay the same), `buildApps` and `watchApps` take the root, `buildBundles` builds both roots, and `dev()` watches both. `appBuildOptions` is unchanged for an app. For a case, the options add, only if step 1.2 says so, `loader` entries for the font types and an `assetNames` template that keeps URLs relative. The `tokk` alias stays (the case imports `'tokk'` in stage 2). `buildSite` loops over the two roots, writing `<out>/apps/<name>` and `<out>/cases/<name>`, and copies the LICENSE copy because it is a normal file (no dot, no denied extension). `copyTree` gets one optional list of file names to skip, used with `['sounds.json']` for cases only.

`casesDir` defaults: when `buildSite` is called with no options, both real folders are used. When `appsDir` is given and `casesDir` is not, no case is copied, so the existing tests that pass a fixture `appsDir` keep their exact output (requirement 4.2). The `main()` of `build-site.ts` passes the flags it has today and adds `--cases-dir`.

### The count and the public-API check
`collectGroups` gets a third entry in its table of kinds: base `cases`, kind `case`, sub `src`, the code extensions. Everything else is shared. `formatReport` prints the kind as it does for `app` and `example`. In `check-public-api.ts` the single `apps/` root becomes a list of roots (`apps`, `cases`), the early exit "no apps/ folder" becomes "no apps/ or cases/ folder" and only fires when both are missing, and the file walk and the rules stay the same. A bare `reveal.js` specifier has no `/`, and a CSS export such as `reveal.js/dist/reveal.css` has the first segment `reveal.js`, which is not one of the internal folders, so both pass without a rule change. U2 proves it.

### Why the stand-in is fair
Real hand claps are sharp, broadband bursts of roughly one to four kilohertz that die away within a few tens of milliseconds. Of the four fixed classes of `core/synth`, `mid` (about 1200 Hz centre, 60 ms decay) is the one that sits inside that range and has a short decay. `low` (300 Hz) is a thud, `ring` (2000 Hz, 200 ms) is a bell, and `high` (3500 Hz, 25 ms) is the click that Task 22 already uses for a tongue click, so a different class keeps the two cases apart. Using an existing class adds no new synthesis code and no new constant outside the recipe.
Why this is fair for what the tests claim: the tests claim only that the pattern logic and the wiring work (two sounds close together fire `clap clap`, three fire `clap clap clap`, one fires nothing, the slide moves, the caption says it). They do not depend on how real a clap sounds, only on the model telling the stand-in from silence and from the noise bed. Why it is not a claim about real claps: a synthetic burst has no room, hand shape or microphone in it. So the README, the integration row and the human check say that recognition of a real clap is "not measured yet". In the browser the user teaches their own claps on the first run, so real use never depends on the stand-in.

### The recipe (`test/helpers/slides-claps.ts`)
Named constants with units: the class `mid`, the clap gain in dB (`WEB_TEST_GAIN_DB` is the shared level), the spacing of the ten teaching claps (`WEB_TEST_IMPACT_SPACING_MS`), the gap of a pattern's claps (a value well below `GAP_CONSECUTIVE_MAX_MS`, for example 250 ms, named with `_MS`), the lead (`NOISE_FLOOR_WARMUP_MS` plus a margin), the noise bed level (`SYNTH_FIXTURE_LEAD_NOISE_DBFS`), the tail, the sample rate (`WEB_TEST_SAMPLE_RATE_HZ`) and the seeds. One function builds a signal from a list of clap start times in ms (converted to a sample index by the same rule as `place`). The one-time writer (a temporary script outside the repository) calls the function and `writeWavFile`. The browser fixture calls the same function.

### The prompt of stage 2b
The operator gives the text between the lines below to the `integrator` agent as its input, unchanged. The agent runs headless with the line in `docs/kiro.md` plus the flags for a trusted workspace and a required MCP start. The agent's own steering (`integrate.md`) and its permissions stay as they are.

----- begin prompt -----
Add sound control to the slide deck in cases/slides, using Tokk.

Sounds list
| Sound name | Example folder | Model |
|---|---|---|
| clap | cases/slides/sounds/clap/ | cases/slides/sounds.json |
The clap examples are synthetic. They exist only so that the Node tests can run.

Pattern table
| Sound name | Pattern | Action |
|---|---|---|
| clap | clap clap | go to the next slide: call deck.next() |
| clap | clap clap clap | go to the previous slide: call deck.prev() |

The two patterns are in one set. Three claps fire only the three-clap pattern. That is the grammar, so add no wait, no timer and no counter of your own.

The deck
- cases/slides/src/main.ts already starts the slide framework and keeps it in a module-level constant named deck. deck.next() and deck.prev() are the public next and previous slide calls of that framework. Do not change how the deck starts. Do not edit any file under node_modules.

What to write
1. Check that cases/slides/sounds.json and the folder cases/slides/sounds/clap/ exist, and that the two recordings cases/slides/recordings/clap-x2.wav and cases/slides/recordings/clap-x3.wav exist. If one is missing, stop and say which one. Do not invent recordings.
2. In cases/slides/index.html add exactly one element: <button id="start-sound" type="button">Start sound control</button>, placed after the deck and outside it. Add no style and no other element.
3. In cases/slides/src/main.ts write the Tokk wiring between a line "// tokk:start" and a line "// tokk:end" (the file has no markers yet; write one block). Import listen from 'tokk' only. On the click of #start-sound call listen() once with:
   - storageKey: 'tokk:slides'
   - no sounds option, because every user teaches their own claps on the first run. Do not load cases/slides/sounds.json in the browser.
   - on: the two patterns of the table, each calling the action of the table.
   - no debug option.
   After listen() resolves, if ears.labels does not include 'clap', await ears.teach('clap', { ui: true }).
   Show a failure of listen() or teach() as nothing more than a rethrown or caught error; do not add a caption or any other screen text. The page will get its caption later.
4. Write one expectEvents test per pattern in test/slides-events.test.ts. Import expectEvents from '../node'. Use cases/slides/sounds.json as the model and the two recordings:
   - clap-x2.wav must give ['clap', 'clap'] (pattern: clap clap)
   - clap-x3.wav must give ['clap', 'clap', 'clap'] (pattern: clap clap clap)
   Read the model with the existing helpers of this repository, not with new code that decodes audio. You may call the listen tool of the mcp-ears server on the two recordings to look at the events.
5. Run the tests with npm test or npx vitest and report the result.
6. Report: every file you wrote, and the number of lines of Tokk code you added between the markers, counted from the file.

Rules
- Change only the files named above: cases/slides/index.html, cases/slides/src/main.ts, test/slides-events.test.ts.
- Do not write a README, a style, a caption, a build change or a bindings.yaml.
- Run nothing except npm test and npx vitest. Anything else is done later by someone else.
- Write every threshold and time in ms, Hz or dB with the unit in the name. Do not hard-code a sample count.
- Never send audio over the network. Never put a recording into sounds.json. Recordings stay in the local sounds and recordings folders.
----- end prompt -----

The prompt names the files and the order so that the agent needs no choice that the measurement should not include. It states the grammar once because the plan asks that the choice be explained, and it keeps the caption and the style out of the agent's job so that 2b is the wiring and nothing else. It says "read the model with the existing helpers" because the agent may only run tests, so it must find a loader in the repository (for example a model reader in `node/` or `web/model.ts`); if none fits, the agent reports it and the operator decides, which the report keeps as a "what the orchestrator corrected" item.

### The caption (`caption.ts`)
One pure function `captionText(state)` where the state is one of: `off`, `teaching`, `listening`, `heard` (with the pattern and the action) and `error` (with a message). The texts are those of requirement 10.1. The DOM glue (`main.ts`, outside the markers, plus the calls inside the handlers) writes the text with `textContent`. The caption element and its CSS are in `index.html` and `style.css`: a fixed box in the bottom-left corner (the reveal.js controls sit bottom-right, and the slide number bottom-right; step 2c.3 checks both positions in the real page and moves the box if either overlaps), dark text colour and light background (or the reverse) with hex values that U4 checks for 4.5 to 1, a 2 px border at least 3 to 1 against the page, `max-width` in `rem` so it wraps at 320 px, no `transition`, no `animation`.

### The start button
`#start-sound` is styled in 2c in the same corner area, not over the slide content, with a visible focus outline. Reveal.js listens for keys on the document. Step 2c.3 reads what 6.0.2 does with Space or Enter pressed on a focused button, and reports it. If reveal.js also moves a slide, the case stops the key event at the button with a handler outside the markers; reveal.js is not changed.

### The fixture and the timeline (`test/web/slides-fixture.ts`)
One WAV at `WEB_TEST_SAMPLE_RATE_HZ`, written into the ignored folder, and a JSON of the start time of every part. Chrome plays it once from the moment the stream opens. The test drives the flow (it presses the dialog's buttons), so the gaps are longer than the slowest handling. First values, to be set from measurement with a factor of 2 (step 2c.5):
| Part | From | Content | Rule |
|---|---|---|---|
| Lead | 0 | noise bed | `WEB_TEST_TEACH_LEAD_MS`: the app opens the dialog and its quiet second fits |
| Teaching | after the lead | 10 claps, `WEB_TEST_IMPACT_SPACING_MS` apart | the dialog counts exactly 10 |
| Gap A | after the last teaching clap | quiet, 14000 ms | Done, training, Save, Close, the new engine's calibration second, the caption becomes "Listening" |
| S0 | after gap A | one clap | the slide stays; the caption shows no "Heard" |
| Gap B | after S0 | quiet, 8000 ms | longer than the pending wait of a prefix pattern plus handling |
| S1 | after gap B | two claps, 250 ms apart | `clap clap` fires about 350 ms later; the deck moves to slide 2 |
| Gap C | after S1 | quiet, 8000 ms | same |
| S2 | after gap C | three claps, 250 ms apart | `clap clap clap` fires alone; the deck moves to slide 1 |
| Tail | after S2 | quiet, 6000 ms | the keyboard check and the screenshot need no sound |
The screenshot is taken after S1 (slide 2, caption "Heard: clap clap. Next slide."), with `TOKK_WRITE_SCREENSHOT=1`.

Node check of the fixture (before it is written): (1) the teaching part holds exactly ten segments (`checkTeachSegments`); (2) a model made the way the dialog makes it (`retrainLabel` over the teaching part, as `handsFreeModel` does) run with the two patterns in one mode gives exactly: nothing for S0, `clap clap` for S1, `clap clap clap` for S2, in that order; (3) the JSON times match the written file (each part is heard where the JSON says). If a check fails, the generator is fixed, not the check.

### E2: no `clap clap` flash
An init script installs a `MutationObserver` on the caption and appends every text it shows to an array in the page. After S2 the test reads the array and asserts that no text between the S2 start and the end of S2's handling equals the text of `clap clap`. This proves the grammar claim in the browser, not only in Node.

### The reduced-motion test (E4)
The test loads the page twice, with and without emulated `prefers-reduced-motion: reduce`, changes the slide by key, and asserts that the list of running animations of the document is empty a moment after the change (and that no element of the case has a non-zero `transition-duration` or `animation-duration`, read from computed style for the elements the case owns and for the reveal.js controls and slides). If the stock CSS cannot be overridden for some element, the test names that element and the step reports it (requirement 3.4).

## Tests
| # | Test | File | Requirement |
|---|---|---|---|
| U1 | `cases/<name>` group counted from `src`, kind `case`, "(no markers)" for a case without markers, markers inside `src` counted, existing groups unchanged | `test/count-wiring.test.ts` | 5.1 |
| U2 | a `cases/` file with a forbidden import fails, a `reveal.js` and a `reveal.js/…css` import pass, a missing `apps/` or `cases/` folder does not fail | `test/check-public-api.test.ts` | 5.2 |
| U3 | build-site copies a case without `sounds.json`, `src`, `.wav`, `recordings`, `test`; keeps the LICENSE copy; copies none when only `appsDir` is given; the landing link has no dead-link warning; every URL is relative | `test/build-site.test.ts` | 4 |
| U4 | the deck file: 5 or 6 `section` elements, `lang`, title not "reveal.js", no external URL, no `on…=` attribute, no `<img`, no Tokk word in stage 1 (a one-time step) and contrast hex values of our CSS | `test/slides-deck.test.ts` | 3, 6 |
| U5 | the dependency is exact `6.0.2` in `devDependencies` and in the lock file; the LICENSE copy equals the package's; the README names reveal.js, the author read from the package, `6.0.2` and `MIT`; every import of reveal.js in `cases/` is an allowed specifier | `test/slides-deck.test.ts` | 1 |
| U6 | `sounds.json` valid, rate equals the recordings', 10 examples of `clap`, no audio keys, no `RIFF`; the three folders exist; the WAV files decode and have the recipe's rate | `test/slides-sounds.test.ts` | 8.1, 8.7 |
| U7 | the grammar gate (requirement 8.6) with the real engine | `test/slides-sounds.test.ts` | 8.6 |
| U8 | one `expectEvents` test per pattern (written by the agent) | `test/slides-events.test.ts` | 9.5 |
| U9 | `captionText` formats, character by character; no DOM type, no `'tokk'` import | `test/slides-caption.test.ts` | 10 |
| U10 | wiring shape: one marked block, `import` from `'tokk'` only inside it, `storageKey: 'tokk:slides'`, no `sounds:` option, no `debug`, no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `onEnvelope`, `localStorage`, `sessionStorage`, `innerHTML` in `cases/slides/src`; `deck` is a module-level constant; reveal.js is not imported inside the markers | `test/slides-deck.test.ts` | 9.3, 18 |
| I1, I2, I4 | named updates of `test/integration-doc.test.ts` (requirement 15) | `test/integration-doc.test.ts` | 15 |
| E0 | the deck loads on the dev server; arrow keys move slides; no foreign request, no error | `test/web/slides.spec.ts` | 6.2 |
| E5 | the same under `/tokk/` from a site build, with every request below `/tokk/` | `test/web/slides.spec.ts` | 6.3, 13 |
| E1 | teach, one clap, two claps, three claps (serial, own Chrome); the screenshot | `test/web/slides.spec.ts` | 11, 14 |
| E2 | the caption never shows `clap clap` in S2 | `test/web/slides.spec.ts` | 10.4 |
| E3 | the keyboard still works after the start; a refused microphone leaves the deck usable | `test/web/slides.spec.ts` | 12.1, 12.2 |
| E4 | no animation or transition runs, with and without reduced motion | `test/web/slides.spec.ts` | 12.3 |
| E6 | the finished site build under `/tokk/` starts, shows the dialog, makes no outside request | `test/web/slides.spec.ts` | 13.2 |

## Measured values
To be filled in as measured. Write no duration and no credit (requirement 16).

Stage 1, step 1.2 (reveal.js, read from `node_modules` after `npm install --save-dev --save-exact reveal.js@6.0.2`):
- `package.json` fields: `version` 6.0.2; `license` MIT; `author` {"name":"Hakim El Hattab","email":"hakim.elhattab@gmail.com","web":"https://hakim.se"}; `homepage` https://revealjs.com; `main` dist/reveal.js; `module` dist/reveal.mjs; `style` absent; `types` dist/reveal.d.ts; `dependencies` absent. `exports`: "." (types ./dist/reveal.d.ts, import ./dist/reveal.mjs, require and default ./dist/reveal.js), "./reveal.css", "./reset.css", "./theme/*" (to ./dist/theme/*), "./plugin/highlight/monokai.css" and the plugins highlight, markdown, math, notes, search, zoom. All of this matches what the operator gave.
- Import chosen: `import Reveal from 'reveal.js'` (the default export, as the package types declare it), `import 'reveal.js/reveal.css'`, `import 'reveal.js/theme/serif.css'`. Esbuild writes the CSS to `dist/app.css`, and `index.html` links it. No copy step from node_modules is needed.
- Theme: `serif`. Reason (requirement 1.6): its CSS has no `url(` and no `@import`, so it needs no font file (it uses a local font stack). `white` and `black` have 8 `url(`/`@import` references each; `simple`, `sky` and `night` import Google Fonts (an external request, not allowed). `dracula` has none either. No loader was added.
- Type declarations: usable under `strict` (`dist/reveal.d.ts`, `dist/config.d.ts`). Only CSS side-effect imports needed a declaration: `cases/slides/src/css.d.ts` (`declare module '*.css'`).
- Configuration keys used for motion (named in `config.d.ts`): `transition: 'none'`, `backgroundTransition: 'none'`, `autoAnimate: false`, `controlsTutorial: false`. The stock CSS still sets transitions (controls, progress) and one animation (control tutorial bounce), so `src/style.css` sets `transition: none !important` and `animation: none !important` on `*`.
- DOM marker of the current slide: class `present` on the top-level section, selector `.reveal .slides > section.present`.
- Names: `next` and `prev` exist (`NavigationFunction`), and `initialize(options?)` returns a Promise. `new Reveal(options)` finds `.reveal` in the document. Not read in stage 1: what the package does with a key on a focused button (2c checks it in the browser).
- Author and licence line for the README: author "Hakim El Hattab"; LICENSE first line "Copyright (C) 2011-2026 Hakim El Hattab, http://hakim.se, and reveal.js contributors"; MIT.
- Lock file: npm also synced `package-lock.json` with `package.json` (root name version 1.0.0 to 0.1.0, and the `bin` and `engines` fields), besides adding `reveal.js`. This is npm's own change, not a hand edit.

Stage 1 results:
- Before: vitest 67 files, 1014 passed, 2 todo (69 s); Playwright 59 passed (7.9 min); the three type checks, build, check:public-api clean; count:wiring 3 groups.
- After: vitest 68 files, 1061 passed, 2 todo (77 s); `pbt:quick` 144 passed, 2 todo; Playwright 62 passed twice (8.0 and 7.9 min); the three type checks, build, `build:site` (no warning) and check:public-api clean; `npm pack --dry-run` lists 55 files and none of `cases/`.
- Bundle sizes (minified, from `build:site`): `cases/slides/dist/app.js` 119068 bytes, `app.css` 59061 bytes, `index.html` 1770, LICENSE copy 1108. Site total 679274 bytes in 15 files; no `.wav`, `src`, `sounds.json` or `.md` below `cases/`.
- Wiring lines of `cases/slides`: 0 (no markers).
- Step 4.4 search (case-insensitive for tokk, listen, microphone, clap, caption, sounds in `index.html` and `src/`): only the product name "Tokk" (title, title slide, one sentence) and the plain English word "sounds" in prose (both required by requirement 3.1), plus `addEventListener` in `main.ts`. No import of tokk, no marker, no microphone, clap, caption or button for sound. README is documentation and says there is none.
- Named updates to existing tests: `test/build-site.test.ts` (landing hrefs, and one more dead-link warning when only `appsDir` is given), `test/web/site.spec.ts` (landing hrefs, `casesDir`), `test/halloween-scope.test.ts` (ui.md front matter).
- Stage 1 commit hash: given in the final report.
Stage 2a: teach report (examples, leave-one-out accuracy, confused pairs, warnings); WAV sizes; whether a `background` folder was needed and why; the import form that works in Vitest for `expectEvents`.

Stage 2b (from the operator's report of the run): files written, lines the agent reported, test result.

Stage 2c: the measured handling times of the dialog and the gaps set from them; the wiring lines from `count:wiring` and the part added by the caption; what reveal.js does with a key on a focused button; the screenshot size; the vitest and Playwright counts; `build:site` output summary; `npm pack --dry-run` result.
