# Requirements: Task 26, the third case, a reveal.js slide deck with sound control

## Introduction
Task 26 is the second task of plan 4. It builds the third integration case: an open-source web app that we did not write, with Tokk sound control added by the `integrator` custom agent. The operator chose reveal.js (an MIT-licensed slide framework) as the target. The case lives in `cases/slides/`: our own deck of five or six slides about Tokk, shown by reveal.js, where two claps go to the next slide and three claps go back.

The work has three stages. Only stage 2 is measured, because the claim to prove is "Kiro adds sound control to someone else's app". The deck itself is the starting point and is not part of the claim.

| Stage | What | Who runs it | Measured | Ends with |
|---|---|---|---|---|
| 1. Baseline | `cases/slides/` with the deck and no Tokk code at all, the build, the site link, `count:wiring` and `check:public-api` covering `cases/`, a browser test of the deck | normal Kiro run | no | commit `chore: add reveal.js slides case (no sound)` |
| 2a. Examples | synthetic clap examples, `sounds.json`, test recordings, the grammar gate test | normal Kiro run | yes, the start of stage 2 | no commit |
| 2b. Wiring | the `listen()` wiring and one `expectEvents` test per pattern | the `integrator` agent, headless, with the exact prompt of design.md | yes | no commit |
| 2c. Finish | the caption, the fake-microphone E2E, the site and documents, all checks | normal Kiro run | yes, the end of stage 2 | commit `feat: add sound control to the slides case` |

Start of the measured time is the start of the 2a run. End is the 2c commit. The operator reads the times from the Kiro run logs and from git, and gives them to 2c. Nothing in this task computes or writes a duration on its own (requirement 16).

| Consumer | What it uses from this task |
|---|---|
| `docs/integration.md` (Task 25) | The third-case row. 2c fills it with the values the operator gives, the `count:wiring` number of `cases/slides` and the `git diff --stat` of stage 2 against the stage 1 commit. |
| Task 27 (README) | The numbers and the credits line of this case. Task 27 does not exist yet, so 2c adds only a short note and a licence line for reveal.js (requirement 15.4). |
| Task 28 and 29 | The screenshot `docs/images/slides.png` and the measured values. |

Facts that this spec was written from. "Read" means read in this repository before the spec was written.
- Read: `listen()` accepts no `sounds` on a first run and starts with an empty model at the rate of the input. `ears.labels` lists the taught labels. `ears.teach(label, { ui: true })` opens the teach dialog, resolves on Save, and the dialog stays on its saved screen until the user presses Close. The model taught in the dialog is stored under `storageKey`. The default key is shared by every page of one origin, so this case sets its own key.
- Read: the grammar (`core/grammar.ts`). When both `clap clap` and `clap clap clap` are in one pattern set, a sequence of two claps is an exact match that still has a longer candidate, so it waits. A third clap less than 350 ms (`GAP_CONSECUTIVE_MAX_MS`, less the tolerance) after the second extends the sequence, and then only `clap clap clap` fires. `clap clap` never fires first. `clap clap` itself fires only after the engine has waited about 350 ms past the second clap. A single clap matches nothing, because it is only a prefix. This is the answer to the question in the task about three claps: the table works as given, and no alternative is needed. Requirement 8.6 proves it with a test, so this is not left as a reading of the code.
- Read: `scripts/count-wiring.ts` groups only `apps/<name>/src` and `examples/<name>`. `scripts/check-public-api.ts` scans only `apps/`. `scripts/build.ts` finds only `apps/<name>/src/main.ts`. `scripts/build-site.ts` copies and bundles only apps. `.gitignore` ignores `apps/*/dist/` only. `tsconfig.web.json` includes `apps/*/src/**/*.ts` only. Each of these changes in stage 1.
- Read: `test/integration-doc.test.ts` (I1) requires a row in the "Wiring lines" table for every group that `count:wiring` prints, and (I2) requires that some row of "Cases" still says "not done yet". Both are named updates (requirements 15.1 and 15.2).
- Read: `test/kiro-config.test.ts` (A9) requires that `docs/kiro.md` names every folder in `.kiro/specs/`. This spec folder is new, so stage 1 adds its row first. A11 pins the front matter of `.kiro/steering/integrate.md`, so that file is not changed. The `integrator` agent already has `.kiro/steering/integrate.md` as a resource and may run only `npm test*` and `npx vitest*` (its `shell` rule).
- Given by the operator: reveal.js 6.0.2 is on npm, published 2026-09-10, licence MIT, no runtime dependencies.
- NOT verified when this spec was written: the contents of reveal.js 6.0.2 itself. The package was not in `node_modules`, and installing or fetching it was not possible in the session that wrote this spec. So the `exports` map, the CSS and theme paths, whether the package ships type declarations, the author string, the LICENSE text, the names of configuration keys and the DOM class of the current slide are all unknown to this spec. Step 1.2 of the tasks reads them from `node_modules` after the install and records them in design.md, "Measured values". Every place where the design depends on one of them says so and gives a rule for each outcome. No import path, no config key and no class name in this spec is a fact until step 1.2 has checked it.

## Requirements

### Requirement 1: The dependency, the licence and the credit
**User story:** As the author, I want the third-party code to be an exact, credited dependency that I never edit, so that the case is honest about what we built.

#### Acceptance Criteria
1. THE package SHALL get exactly one new dependency: `reveal.js` at the exact version `6.0.2` as a `devDependency` (no caret, no tilde), with `package-lock.json` updated by the package manager. No other package SHALL be added, and no existing version SHALL change. The package is bundled into the case at build time, so it is a build-time dependency like `esbuild`. THE npm package `tokk` SHALL still list no runtime dependency, and `npm pack --dry-run` SHALL list the same files as before.
2. THE case SHALL call only the public API of reveal.js (the documented entry point, its documented configuration, `next()` and `prev()`). IT SHALL NOT import a file from inside the package that is not an export of its `exports` map, SHALL NOT patch, copy-and-edit or monkey-patch reveal.js code, and SHALL NOT change anything under `node_modules`. A test (U5) SHALL scan `cases/` for an import of reveal.js and fail on any specifier that is not allowed by the rule above.
3. `cases/slides/README.md` SHALL name reveal.js, give its author as written in the `author` field of `node_modules/reveal.js/package.json` and in the first copyright line of its LICENSE (the text is read in step 1.2 and copied as it is, not retyped from memory), say version 6.0.2, say the licence is MIT, link its home page as the package states it, and say in one sentence what the case adds (a deck of our own, and sound control).
4. `cases/slides/` SHALL hold a byte-for-byte copy of the LICENSE file of reveal.js 6.0.2 (design.md names the file). A test (U5) SHALL compare it with `node_modules/reveal.js/LICENSE` when that file exists. THE copy SHALL be part of the site output, because the bundle contains reveal.js code and the bundle build drops licence comments (`legalComments: 'none'`).
5. NO reveal.js logo, wordmark or other image of the project SHALL appear on screen, in the deck, in a screenshot or in the page title. THE name "reveal.js" SHALL NOT be the title of the page or of a slide. It MAY appear in the README, in `docs/integration.md`, in the root README licence line, and in one descriptive phrase of the landing-page link ("built with reveal.js") as a credit.
6. THE deck SHALL use one stock theme that ships inside the package. THE theme SHALL be chosen by step 1.2 by this rule: among the stock themes, take one whose CSS needs no font file, if one exists, so the build needs no font loader. IF every stock theme needs font files, take the theme `white` or `black` (whichever of the two the package ships) and allow the build to emit the font files with esbuild's `file` loader for the case bundle only (design.md, "The build of a case"). The choice and the reason SHALL be written in "Measured values".

### Requirement 2: The folder, the build and the dev server
**User story:** As the author, I want the case to follow the same folder rules as an app, so that the build, the site, the dev server and the checks treat it alike.

#### Acceptance Criteria
1. THE case SHALL be `cases/slides/` with `index.html` at its root and `src/main.ts` as the entry. `index.html` SHALL load the bundle with relative URLs: `./dist/app.js` as a module script and, if the bundle has CSS, `./dist/app.css` as a stylesheet. Every other URL in the case SHALL be relative (no leading `/`, no scheme). THE case SHALL work at `/cases/slides/index.html` on the dev server and at `/tokk/cases/slides/` on Pages.
2. THE case SHALL have no external font, image, stylesheet or script. THE only reveal.js code and CSS SHALL come from the bundle.
3. `scripts/build.ts` SHALL build every `cases/<name>/src/main.ts` to `cases/<name>/dist/app.js` the same way as an app (same options, same `tokk` alias, same name rule), in `npm run build`, and rebuild it on save in `npm run dev`. THE dev server SHALL serve `/cases/slides/index.html` with no new server code. A new case folder needs a restart, as a new app does.
4. `.gitignore` SHALL ignore `cases/*/dist/`. `tsconfig.web.json` SHALL include `cases/*/src/**/*.ts`. THE type check `npx tsc -p tsconfig.web.json --noEmit` SHALL pass with the case in it.
5. IF reveal.js 6.0.2 ships no type declarations that the checks accept, THE case SHALL carry one small declaration file in `cases/slides/src/` that declares only the public members the case uses. IT SHALL NOT use `any` for the whole module. The outcome is recorded in "Measured values".
6. `src/main.ts` SHALL keep the reveal.js object in a module-level constant named `deck`, and SHALL start the deck once, after the DOM is ready. The name `deck` is part of the prompt of stage 2b, so it SHALL NOT change.
7. THE bundle build SHALL print no warning. THE constants of the case (a time, a size, a count) SHALL be in `cases/slides/src/constants.ts` with the unit in the name, a named exception to "keep constants in `core/constants.ts`" for the same reason as the apps (a case cannot import `core/`). A hard-coded sample count SHALL NOT appear anywhere.

### Requirement 3: The deck
**User story:** As a viewer, I want a short, plain deck about Tokk that works with the keyboard and the mouse, so that the case is a real app that someone could present with.

#### Acceptance Criteria
1. THE deck SHALL have five or six slides, written for this repository in plain English. The text SHALL be original (not copied or adapted from any other source, including the reveal.js demo and its documentation), SHALL name no third party except where requirement 1.5 allows, and SHALL claim no measured number. THE slides, in order: a title slide ("Tokk"), what Tokk is (react to short sounds in a web page), teach a sound (10 examples), bind a pattern (a pattern table), where the sound stays (nothing leaves the device), and an optional closing slide ("Try it"). THE writer SHALL NOT use the words "reveal.js" as a heading.
2. THE slide content SHALL be in `index.html` as `section` elements inside the structure that reveal.js documents, with real headings and text (no text in images).
3. THE theme text and background SHALL meet the contrast rule of `ui.md` (text 4.5 to 1, graphics 3 to 1), checked by hex values in a unit test (U4) when the theme sets them, or by reading the computed colours in the browser test when the theme is a stock one.
4. THE deck SHALL respect `prefers-reduced-motion` and the rule of `ui.md` for motion: THE reveal.js configuration SHALL turn off slide transitions, background transitions and automatic animation, and THE case stylesheet SHALL set no CSS transition or animation. IF the stock CSS of reveal.js defines a transition or animation that the configuration cannot turn off, THE case stylesheet SHALL override it with `transition: none` and `animation: none` on the same selectors. THE browser test (E4) SHALL show that no animation or transition runs on the page, with and without `prefers-reduced-motion`.
5. EVERY control of the deck SHALL be reachable and usable by keyboard, with an accessible name and a visible focus outline (the reveal.js controls keep their own; the case adds an outline only where a stock one is missing).
6. THE document SHALL have a `lang="en"` attribute, a title that is not "reveal.js" (the suggested title is "Tokk in five slides", adapted to the real number of slides), a viewport meta tag, and no inline event handler.

### Requirement 4: The site and the landing page
**User story:** As a visitor of the Pages site, I want to open the deck from the landing page and have it work under `/tokk/`.

#### Acceptance Criteria
1. `scripts/build-site.ts` SHALL copy every `cases/<name>/` to `<out>/cases/<name>/` with the same deny list as an app (`sounds`, `src`, `dist`, `node_modules`, `extension`, `test` folders; `.wav`, `.ts`, `.tsx`, `.map`, `.md` files; names that start with a dot) and SHALL bundle its `src/main.ts` to `<out>/cases/<name>/dist/app.js` (and its CSS, and font files if the bundle has any), minified. IT SHALL NOT copy `sounds.json` of a case: the synthetic model of this case only serves a Node test, and the page must not load it. The case copy SHALL keep the LICENSE copy of requirement 1.4 and the `recordings` folder SHALL NOT be copied (requirement 8.2). The deny list stays shared with the hello example and the apps, and the skip of `sounds.json` applies to cases only.
2. WHEN `build-site` is called with an `appsDir` and no `casesDir` (as the existing tests do with a fixture folder), IT SHALL copy no case, so that the existing tests keep their exact file lists. WHEN it is called with neither, IT SHALL use the real `apps/` and `cases/` folders. A `casesDir` option SHALL exist for the new tests.
3. `site-src/index.html` SHALL have a link `cases/slides/` in the list of the landing page, with the text of requirement 1.5 and a short description. THE site build SHALL print no dead-link warning when both `apps/knock-once` and `cases/slides` exist.
4. THE site output SHALL contain no `.wav`, no `src` folder, no `.ts` file, no `.map`, no `.md`, no `sounds` folder and no `sounds.json` below `cases/`. THE site output of the case SHALL make no request outside `/tokk/` and none to another origin (E5).
5. THE npm package list SHALL NOT change (`cases/` is not in `files`).

### Requirement 5: The counting and checking scripts cover `cases/`
**User story:** As the author, I want every claim about the case to come from the same scripts as the apps.

#### Acceptance Criteria
1. `scripts/count-wiring.ts` SHALL report `cases/<name>` groups, counted from the files below `cases/<name>/src`, with the kind `case`, sorted with the others, with the same counting rules and the same "(no markers)" report for a group without markers. THE kind of the existing groups SHALL NOT change. THE output of the existing groups SHALL NOT change.
2. `scripts/check-public-api.ts` SHALL scan `cases/` like `apps/`. A relative or root-relative import into `core/`, `web/`, `node/` or `tools/`, and any `tokk/...` sub-path other than `tokk/node`, in a file of a case SHALL fail the check with the same message shape. A bare import of `reveal.js` or of one of its documented CSS exports SHALL pass. A missing `apps/` or `cases/` folder SHALL NOT fail the check or stop it from scanning the other.
3. THE two scripts' tests SHALL be extended with named additions (U1, U2). No existing expectation SHALL be weakened.

### Requirement 6: Stage 1 has no Tokk
**User story:** As the author, I want the baseline to be a plain reveal.js deck, so that stage 2 shows what sound control adds.

#### Acceptance Criteria
1. AT the stage 1 commit, no file of `cases/slides/` SHALL import `'tokk'` or any Tokk path, contain `tokk:start` or `tokk:end`, mention a microphone, a clap, a caption, `sounds` or `listen` in code or visible text, or contain a button for sound. `count:wiring` SHALL report `cases/slides` with "(no markers)" and 0 lines. A step (not a lasting test) SHALL check this before the commit, because stage 2 changes it on purpose.
2. A browser test (E0, in `test/web/slides.spec.ts`) SHALL show that the deck loads on the dev server, that the first slide is shown, that the arrow keys move to the next and the previous slide (read from the current-slide marker that step 1.2 recorded), and that the page makes no request to another origin and has no console or page error. IT SHALL use no microphone.
3. THE same test SHALL run the page from a site build under `/tokk/` (E5, built with `build-site` into a temporary folder and served as the Task 21 tests do) and SHALL show the same behaviour and that every request stays below `/tokk/`.

### Requirement 7: The stage 1 commit
**User story:** As the author, I want one clean baseline commit that the measurement can diff against.

#### Acceptance Criteria
1. THE commit SHALL have the message `chore: add reveal.js slides case (no sound)`, and SHALL contain: this spec folder, `cases/slides/` (index.html, src, README.md, the LICENSE copy), the two script changes and their tests, the `build.ts` and `build-site.ts` changes and their tests, `site-src/index.html`, `.gitignore`, `tsconfig.web.json`, `package.json`, `package-lock.json`, `.kiro/steering/ui.md` (requirement 15.5), `docs/kiro.md`, `docs/devlog.md`, `docs/integration.md` (the wiring row of requirement 15.1) and `test/web/slides.spec.ts`.
2. ALL checks of requirement 17.1 except the Tokk ones that do not apply yet SHALL pass before the commit. THE commit hash SHALL be given to the operator in the report, because stage 2 is diffed against it.
3. NOTHING SHALL be pushed.

### Requirement 8: Stage 2a, the synthetic clap examples
**User story:** As the author, I want honest, reproducible synthetic claps so that the `expectEvents` tests can run on any machine, and so that nobody thinks they are real recordings.

#### Acceptance Criteria
1. THE examples SHALL be made with `core/synth` like `examples/hello`: 10 claps in `cases/slides/sounds/clap/`, as the synthetic fixtures do it (one WAV file that holds the ten claps, spaced as `WEB_TEST_IMPACT_SPACING_MS` spaces them, after a quiet lead long enough for the calibration window). THE teach report SHALL count exactly 10 clap examples, and `sounds:rebuild` SHALL build `cases/slides/sounds.json` from the folder. IF the report shows another number, THE spacing or the seeds SHALL be changed, and the test (U6) SHALL not be weakened.
2. THE test recordings SHALL be two WAV files in `cases/slides/recordings/`, made the same way and with the same stand-in: two claps with a gap that is inside `GAP_CONSECUTIVE_MAX_MS` for the pattern `clap clap`, and three claps with the same gap for `clap clap clap`. The folder is not a label folder (`sounds:rebuild` only reads `sounds/`).
3. THE stand-in for a hand clap SHALL be the synthetic impact class `mid` of `core/synth` (a band-limited burst centred near 1200 Hz that decays within tens of milliseconds, over a low white-noise bed). THE choice and the reasons SHALL be written in design.md, "Why the stand-in is fair". The recipe (class, gain, spacing, seeds, rate, noise bed level) SHALL be named constants in one test helper (`test/helpers/slides-claps.ts`) that the one-time writer of the WAV files and the browser fixture of stage 2c both use, and SHALL be repeated in the case README.
4. A `background` folder SHALL NOT be added unless step 2a.4 shows a false sound event on the two test recordings or on a noise-only recording made with the same bed. IF one is needed, it SHALL be made with `synthNoise` in the same way as the fixtures, and the reason SHALL be written down.
5. `cases/slides/README.md` SHALL say in plain words that the claps in `sounds/clap/`, the recordings in `recordings/` and `sounds.json` are synthetic (made by a program, not recorded from a hand), that they exist only so that the Node tests can run, that the page does not load them, and that in the browser each user teaches the app their own claps on the first run. IT SHALL say that no claim about how well Tokk recognises a real clap is made by these files.
6. A test (U7, the grammar gate) SHALL run the real engine (`createEngine`) with the two patterns of the table in one mode over each test recording and SHALL assert: the two-clap recording fires `clap clap` and not `clap clap clap`; the three-clap recording fires `clap clap clap` and not `clap clap`; a recording with one clap fires nothing. IF the real engine fires `clap clap` before `clap clap clap` on the three-clap recording, THE operator SHALL be told before stage 2b (stop and report), and the table SHALL be changed to the simplest correct alternative with the reason, as the task allows.
7. A test (U6) SHALL check that `sounds.json` is a valid model at the sample rate of the recordings, has the label `clap` with exactly 10 examples, holds no key that names audio (the list of the hello test H6), and does not contain the text `RIFF`.
8. Everything in this requirement SHALL stay below `cases/slides/` and `test/`. No file of `examples/`, `fixtures/` or `core/` SHALL change.

### Requirement 9: Stage 2b, the wiring by the `integrator` agent
**User story:** As the operator, I want the `integrator` agent to do the Tokk wiring from a sound list and a pattern table alone, so that the measurement shows what Kiro does with the power.

#### Acceptance Criteria
1. THE input of the agent SHALL be exactly the text in design.md, "The prompt of stage 2b". THE operator gives it as it is. This task SHALL NOT run the agent, and SHALL NOT edit the agent file `.kiro/agents/integrator.json`.
2. THE pattern table SHALL be: `clap clap` goes to the next slide by `deck.next()`, and `clap clap clap` goes to the previous slide by `deck.prev()`. By requirement 8.6 and the grammar, no alternative is needed.
3. THE wiring SHALL be between `// tokk:start` and `// tokk:end` in `cases/slides/src/main.ts`. IT SHALL import `listen` (and a type if needed) from `'tokk'` only, SHALL call `listen()` once, inside the click handler of a button, SHALL pass `storageKey: 'tokk:slides'`, SHALL pass no `sounds` (so the first run teaches: `if (!ears.labels.includes('clap')) await ears.teach('clap', { ui: true })`), SHALL pass `on` with the two patterns, and SHALL NOT load `cases/slides/sounds.json`. THE `debug` overlay SHALL NOT be on.
4. THE one new element in `index.html` that the agent may add is a button `id="start-sound"` with the text "Start sound control". THE agent SHALL NOT add styling, a caption, a README, a build change or any other file except `test/slides-events.test.ts`. THE styling and the caption belong to 2c.
5. THE agent SHALL write one `expectEvents` test per pattern in `test/slides-events.test.ts` against the recordings of requirement 8.2, with `cases/slides/sounds.json` as the model: `['clap', 'clap']` for the first recording and `['clap', 'clap', 'clap']` for the second. THE tests SHALL pass with `npm test` or `npx vitest`.
6. THE agent SHALL be allowed to run `npm test` and `npx vitest` only (its permission rule). Everything else (type checks, the build, the browser test, `count:wiring`) is for 2c. THE operator SHALL read the agent's report (files written, lines of Tokk code, test result) and keep it with the run log.
7. THE agent SHALL NOT send audio anywhere, SHALL write no audio into `sounds.json`, and SHALL write no sample count. THE units rule applies to any time it writes.

### Requirement 10: Stage 2c, the caption
**User story:** As a viewer of a muted video, I want every recognised pattern written in a corner of the page.

#### Acceptance Criteria
1. THE page SHALL show a small caption in one corner, outside the element that reveal.js owns, as plain text in a `role="status"` region with `aria-live="polite"`. IT SHALL show, as text: before the start "Sound control is off. Press Start sound control."; while the dialog teaches "Teach your clap in the dialog."; after the teaching "Listening. Clap twice for the next slide, three times for the previous slide."; and after each recognised pattern "Heard: clap clap. Next slide." or "Heard: clap clap clap. Previous slide.". A microphone error SHALL show the library's message as text and "The keyboard still works.".
2. THE caption text SHALL come from one pure function (`caption.ts`, U9) with no DOM type and no `'tokk'` import, so it is tested in Node. EVERY result SHALL be text: nothing is told by colour, shape or sound alone.
3. THE caption SHALL meet the contrast rule (text 4.5 to 1 on its own background, and a border or outline of at least 3 to 1), SHALL have no transition or animation, SHALL NOT cover the reveal.js controls or the slide number at 320 px width and at 200 per cent zoom, and SHALL be readable on the deck theme (it has its own background).
4. THE caption SHALL NOT show `clap clap` when `clap clap clap` was clapped (E2 proves this by recording every text the region shows).
5. THE caption calls SHALL be added to the handlers that the agent wrote, with the smallest change that does it. Lines added inside the Tokk markers for the caption SHALL be counted by `count:wiring` like any other, and the report SHALL say how many of the final lines they are (requirement 16.3).
6. THE start button SHALL be styled in 2c: visible focus outline of at least 2 px, accessible name from its text, contrast as above, placed so that it does not cover the deck. After a successful start it MAY be hidden or disabled, and the caption says what to do next.
7. THE page SHALL contain no Halloween element and no third-party logo (`ui.md`).

### Requirement 11: Stage 2c, the fake-microphone end-to-end test
**User story:** As the author, I want a browser test that does what a user does, with the real teach dialog and no test access to the library object, so that the wiring is shown to work.

#### Acceptance Criteria
1. A serial Playwright test (E1, in `test/web/slides.spec.ts`) SHALL use its own Chrome with the fake microphone playing one generated WAV (`test/web/slides-fixture.ts`, generated by the global setup into the ignored folder, with a JSON of the stream time of every part and its own Node check, like `hands-free-fixture.ts`). IT SHALL: open the page; press "Start sound control"; wait for the dialog the app opens; let the ten teaching claps be counted; press the dialog's own Done, Save and Close; clap once and see the slide stay on slide 1; clap twice and see slide 2; clap three times and see slide 1 again. THE test SHALL NOT call `ears` and SHALL NOT open a dialog itself.
2. THE current slide SHALL be read from the DOM (the marker recorded in step 1.2), never from a global that the page exposes for the test. NO test hook SHALL be added to the page.
3. THE fixture SHALL use the stand-in of requirement 8.3 for every clap, with the same recipe as the recordings, and SHALL be checked in Node before it is written: the teaching part holds exactly ten segments, and a model made the way the dialog makes it recognises the single clap as nothing, the two claps as `clap clap` only and the three claps as `clap clap clap` only.
4. THE gaps between the parts SHALL be at least twice the measured handling time of the dialog (step 2c.5 measures and records them), and the quiet after the teaching SHALL cover the new engine's calibration second. IF a run fails for a reason of timing, the gap is raised from the measurement. No retry SHALL be added to the test.
5. THE test SHALL record every request and fail on a request to another origin, a failed request, a console error or a page error. THE title of no test SHALL contain `smoke`.
6. THE E2E SHALL run three times in a row with the whole of `test:web`, and all runs SHALL pass.

### Requirement 12: Keyboard, mouse and reduced motion still work
**User story:** As a user without a microphone, I want the deck to work as before.

#### Acceptance Criteria
1. WITH the sound control started and the teaching done, THE arrow keys SHALL still move the deck (E3, in the same stream, at the end), and WITHOUT pressing the start button the deck SHALL work as in stage 1. THE start button SHALL be reachable by Tab and SHALL work with Enter and Space, and pressing it SHALL NOT also move a slide (step 2c checks what reveal.js does with a key pressed on a focused button, and the case SHALL adapt its own button, not reveal.js, if it moves one).
2. A microphone that is refused or missing SHALL leave the deck usable and the caption SHALL say so (E3 uses a context with no microphone permission or a rejecting `getUserMedia`).
3. WITH `prefers-reduced-motion: reduce` emulated and without it, no CSS animation or transition SHALL be running after a slide change and after a caption change (E4, by the browser's list of running animations).

### Requirement 13: The site build of the finished case
**User story:** As a visitor, I want the finished case on Pages.

#### Acceptance Criteria
1. `build:site` SHALL finish with no warning, and its output SHALL satisfy requirement 4.4 for the finished case (E5, repeated with sound control in the bundle). THE bundle SHALL contain no network call for audio (the check of requirement 18.2 SHALL pass on `cases/slides/src`).
2. THE page under `/tokk/cases/slides/` SHALL load, start, and show the dialog after the start button (the fake microphone) with every request below `/tokk/`.

### Requirement 14: The screenshot
**User story:** As a reader of the README and the video editor, I want one picture of the case with the caption visible.

#### Acceptance Criteria
1. `docs/images/slides.png` SHALL be written by E1 only when the environment variable `TOKK_WRITE_SCREENSHOT` is `1`, once, after the two claps (slide 2) with the caption "Heard: clap clap. Next slide." visible. WITHOUT the variable the test SHALL write nothing, as the hands-free test does.
2. THE picture SHALL show no third-party logo, no Halloween element and no personal data, and SHALL be smaller than the byte limit that the test sets (the hands-free limit is the model). THE step SHALL open the PNG and check that the slide, the caption and the controls are readable.

### Requirement 15: Documents and steering
**User story:** As a reader, I want the numbers and the credit in the right places.

#### Acceptance Criteria
1. AT stage 1, `docs/integration.md` SHALL get one row in "Wiring lines": `cases/slides` with 0 (the value of `count:wiring`), so that test I1 keeps passing. THE third row of "Cases" SHALL stay "not done yet" (test I2 needs it).
2. AT stage 2c, THE third row of "Cases" SHALL be filled with: the target (reveal.js 6.0.2, MIT, credit in the case README); the sounds taught (`clap`, synthetic for the tests, the user's own claps in the browser); the wiring lines (the `count:wiring` number of `cases/slides`, with the number the agent reported in 2b and the difference that the caption added); the start and end time, the duration, the Kiro credits and the "what Kiro did / what the orchestrator corrected" texts exactly as the operator gives them in the 2c prompt; the `git diff --stat` summary of stage 2 against the stage 1 commit as the operator gives it. THE row SHALL NOT contain a hash of the 2c commit (it does not exist yet), and SHALL name the stage 1 commit hash that the operator gives. THE tests I1 and I2 SHALL get named updates: I1 now includes the new number, and I2 now checks the third row for the computed `cases/slides` line count and for the words "reveal.js" and "MIT" in place of "not done yet". No expectation SHALL be loosened (the row for hands-free and knock-once stay as they are).
3. THE "Double clap" row of "Human checks with a real microphone" SHALL be rewritten: what to measure, "Teach the clap once in the deck, then clap twice 10 times and three times 10 times, and count the times the slide moved as the table says"; target, "at least 9 of 10 for each pattern" (the target is a decision of this spec and may be changed by the operator); value, "not measured yet" (test I4 stays true).
4. THE root `README.md` SHALL get a short note and a licence line for reveal.js: what the case is, the name, author (read from the package), version 6.0.2, the MIT licence, and a link to `cases/slides/`. THE note SHALL NOT state a number followed by "minutes", "seconds" or "lines" outside a code block (test D1 of the hello test allows only the one measured count of the hello example), and SHALL NOT remove the word "pending" that R1 requires. Task 27 rewrites the README later, so no other README text SHALL change.
5. `.kiro/steering/ui.md` SHALL get `cases/slides/**/*` added to `fileMatchPattern` in stage 1 and nothing else. `.kiro/steering/integrate.md` and the integrate skill SHALL NOT change, `.kiro/agents/` SHALL NOT change, and `.kiro/hooks/` SHALL NOT change (the `public-api-only` hook watches `apps/**`; `check:public-api` covers `cases/`; that is recorded as a later decision).
6. `docs/kiro.md` SHALL get one row for `.kiro/specs/task-26-slides-case/` (stage 1, first step) and one sentence about the third case and the headless run in stage 2c. `docs/devlog.md` SHALL get one line at each commit (what was built, what was decided, that nothing was pushed).
7. `apps/README.md` SHALL get one sentence that `cases/` follows the same rules and a pointer to `cases/slides/README.md`, without removing a phrase that test R1 requires.

### Requirement 16: Measurements
**User story:** As the author, I want every number in the documents to be measured, and none invented.

#### Acceptance Criteria
1. TIMES and Kiro credits are given by the operator in the 2c prompt. THIS task writes no duration, no hour and no credit of its own anywhere, and no value that the operator did not give.
2. THE `count:wiring` number of `cases/slides` SHALL be read from the script at 2c, not counted by hand. THE number the agent reports in 2b SHALL be kept in the report of 2b, and the 2c row SHALL give both when they differ.
3. THE row SHALL say how many of the lines were added by the caption in 2c (the difference of the two counts when the caption changed the marked block, else "none").
4. THE case SHALL make no claim about recognition quality with a real clap. The synthetic note of requirement 8.5 SHALL be repeated in the integration row and in the README note. THE "Double clap" human check stays "not measured yet".
5. THE 2b measurement SHALL be the real run: nothing in this spec or its tasks edits `cases/slides/src/main.ts` between the start of 2b and the end of the agent's run.

### Requirement 17: Checks, commits and housekeeping
**User story:** As the author, I want both commits to be clean and verified.

#### Acceptance Criteria
1. AT the end of stage 1 and again at the end of 2c, THESE SHALL pass: `build`, `build:site` (no warning), `count:wiring`, `pbt:quick`, `npm test`, `test:web` twice, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc -p tsconfig.test-web.json --noEmit`, and `check:public-api`. `PBT_RUNS=1000 npm test` SHALL be run once at 2c. `npm pack --dry-run` SHALL list the same files as before.
2. THERE SHALL be exactly two commits, with the two messages of the task. No `git push`, no publish, no workflow run and no repository setting SHALL be touched.
3. NO temporary file, folder, script or generated output SHALL remain (`site/`, `dist/`, `test/web/generated/` and `cases/*/dist/` are ignored by Git, and `site/` is deleted by the step that builds it). THE one-time writer of the synthetic WAV files SHALL NOT be committed as a script (its recipe is in `test/helpers/slides-claps.ts` and the README); it is deleted after the files are written.
4. NO existing test SHALL be weakened or deleted. A named update is allowed only where this spec names it, and it keeps a check that fails on a broken input.

### Requirement 18: Privacy, units and rules of the project
**User story:** As the author, I want the project rules to hold in the new code.

#### Acceptance Criteria
1. EVERY import of the case from a Tokk path is exactly `'tokk'`. THE case imports reveal.js by its package name only.
2. THE case source SHALL NOT call `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon`, SHALL NOT use `onEnvelope`, and SHALL NOT write to `localStorage` or `sessionStorage` or read it (the library stores the taught model under `tokk:slides`; the case writes no storage itself). THE test U10 SHALL search `cases/slides/src` for these names.
3. `sounds.json` SHALL hold feature vectors only. THE original recordings SHALL stay in the local `sounds/` and `recordings/` folders of the case (synthetic, and committed, like `fixtures/audio/synth/`), and SHALL NOT reach the site.
4. EVERY threshold and time constant SHALL be in ms, Hz or dB with the unit in the name. No sample count SHALL be hard-coded. EVERY time `t` that a test computes SHALL be a sample count divided by the sample rate, in seconds.
5. THE new text a user can read SHALL be in English.
