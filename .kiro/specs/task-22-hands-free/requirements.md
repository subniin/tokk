# Requirements: Task 22, app 1, Hands-Free

## Introduction
Task 22 is the fourth task of plan 3 (two apps). It builds app 1, Hands-Free: a small reading site that a person browses with mouth sounds and a humming voice, for people who find it hard to use their hands. The app lives in `apps/hands-free/`, imports only the public API `tokk`, follows `apps/README.md` (Task 21), and is the first real user of the template additions of Task 20 (start without sounds, `ears.labels`, `onEvent`, `ears.toPageTime`, `TeachOptions.text`, inert `hum.*` patterns).

What the app does, in one paragraph. The first visit starts a guided teaching of three sounds (a tongue click ten times, a steady hum, the room's usual noise), about one minute in total. After that a highlight frame moves over the links and buttons of the page in reading order. One `click` presses the element that was highlighted when the sound was made. `click click` goes back. `click click click` turns listening off and on. A hum that rises or falls scrolls the page up or down, faster the further the pitch is from the taught one. Every recognition is also written as text. The same actions work from the keyboard. Audio never leaves the device.

| Consumer | What it uses from this task |
|---|---|
| Task 21 (site) | `apps/hands-free/` is bundled to `dist/app.js`, copied by `build:site`, linked from the landing page (the link `apps/hands-free/` exists already), and counted by `count:wiring`. |
| Task 23 (Knock Once for Yes) | Nothing from the app. It shares the origin `https://subniin.github.io/tokk/`, which is why this app sets its own `storageKey` (requirement 3.9). |
| Plan 3 completion check | `npm run count:wiring` gives the wiring lines of this app. The human check with a real microphone (teaching time, three articles read hands-free, wrong clicks) uses this app. |
| `docs/integration.md` (later) | The measured wiring lines and the development time of this app. This task writes no hours (requirement 14.4). |

Facts checked before this spec was written (step 1 of the tasks checks them again):
- `listen()` takes no `sounds` on a first run and then starts with an empty model at the rate of the input. `ears.labels` lists the taught labels, sorted, with `hum` when a hum pitch was taught and without `background`. `ears.sounds` is the current model, so the examples of `background` are visible as `ears.sounds.examples`. A taught model is stored under `storageKey` (default `tokk:sounds`) and comes back on the next visit. The default key is shared by every page of one origin.
- `hum.rise` and `hum.fall` patterns are accepted without a pitch baseline and stay silent until a hum is taught (Task 20). They fire on every pitch `update` event that is more than 2 semitones (`HUM_DEADZONE_SEMITONES`) from the baseline. `MatchEvent.speed` is the distance beyond the dead zone in semitones, from above 0 up to 6 (`HUM_SPEED_MAX_SEMITONES`). The `end` of a hum gives no match. It does reach `onEvent` as a `continuous` event with `phase: 'end'`.
- A `MatchEvent.t` is the sound time in seconds (a sample count divided by the sample rate) of the last sound of the pattern. A `click` pattern that is a prefix of `click click` fires 350 ms (`GAP_CONSECUTIVE_MAX_MS`) after the click it ends on, so the match arrives after the sound. `ears.toPageTime(t)` maps that sound time to the `performance.now()` clock of the page, within 50 ms in the Task 20 measurement, and keeps working across `pause()` and `resume()`. It throws before audio has arrived and just after a model change (Save, Cancel, import) until audio of the new engine arrives.
- `listen({ modes, mode })` and `ears.setMode(name)` switch the set of patterns. `Matcher.setPatterns` clears the pending sequence. A pattern that is in no mode of the page never fires, and a mode that holds one pattern gives that pattern no waiting time for a longer pattern.
- `ears.teach(label, { ui: true, examples, text })` opens one dialog. Its promise resolves on Save, but the dialog stays on its saved screen until the user presses Close (or Esc), and, before this task, `ears.teach` rejected with an `Error` ("a teach dialog is already open") while any dialog existed. Requirement 16 changes this: a dialog that shows only its saved screen is closed by the next `ears.teach`, and a dialog that is recording or reviewing keeps rejecting with that error. Cancel rejects with an `AbortError`. A hum needs at least 2 s of recording (`WEB_TEACH_HUM_RECORD_MS`), and background needs at least 10 s (`WEB_TEACH_BACKGROUND_RECORD_MS`), before Done is enabled. A sound needs the `examples` count (default 10, minimum 5) and a quiet first second.
- `TeachOptions.text` keys are `title` ({label}), `quiet`, `record` ({count}), `recordHum`, `recordBackground`, `training`, `count` ({heard} {target} {kept}), `needMore` ({min} {kept}), `review`, `failed`, `done`, `save`, `again`, `cancel`, `close`, `saved`, `savedSessionOnly`. An unknown key, an empty text or a placeholder a key does not have rejects with a `RangeError`. The dialog is in a Shadow DOM, themed only through `--tokk-bg`, `--tokk-fg`, `--tokk-accent`, `--tokk-font` and `--tokk-radius`.
- Vitest runs in Node with `lib: ES2022` (no DOM types) under `tsconfig.json`, which follows imports from `test/`. `tsconfig.web.json` (DOM, `paths` for `tokk`) includes `apps/*/src/**/*.ts`. A pure module of the app that is imported by a vitest test therefore must not use a DOM type or import from `'tokk'`.
- `scripts/count-wiring.ts` counts the non-blank, non-comment lines between `// tokk:start` and `// tokk:end` in `apps/*/src/**`, summed over all files and blocks of an app. A group with no marker is reported as "no markers", not as an error.
- `apps/` holds `README.md` only. `site-src/index.html` already links `apps/hands-free/` with the text "browse the web with mouth sounds". `docs/images/` holds `overlay.png`. `.kiro/steering/ui.md` matches `web/**/*`, `teach.html` and `examples/**/*`, not `apps/**`.
- Chrome's fake microphone plays one WAV once from the moment a stream opens. A teaching sequence of three dialogs against one such file has fixed timing, which is why the fixture has long quiet gaps (design.md, "The fixture and the timeline").

## Requirements

### Requirement 1: The app folder, the build and the public API
**User story:** As the author, I want the app to follow the folder rules, so that `npm run dev`, `npm run build`, `npm run build:site` and `npm run count:wiring` treat it like every later app.

#### Acceptance Criteria
1. THE app SHALL be the folder `apps/hands-free/` with `index.html` at its root, `src/main.ts` as the entry and small modules beside it in `src/`. `index.html` SHALL load `./dist/app.js` with a relative URL. THE folder SHALL NOT have a `sounds.json` (the app starts without sounds, requirement 3.1) and SHALL NOT have a `sounds/` folder, so no recording can reach the site.
2. EVERY import of the app from a Tokk path SHALL be exactly `'tokk'`. A type-only import (`import type`) is allowed in a DOM module and is erased by the build. The pure modules of requirement 12 SHALL NOT import from `'tokk'` at all (design.md, "Modules"). `npm run check:public-api` SHALL pass.
3. THE Tokk wiring SHALL sit between `// tokk:start` and `// tokk:end`. EVERY value import from `'tokk'` and EVERY use of the object that `listen()` returns (`listen`, `ears.teach`, `ears.toPageTime`, `ears.setMode`, `ears.labels`, `ears.sounds`) SHALL be inside a marked block. Code that does not use Tokk (the scan, the views, the text, the keys) SHALL be outside. THE wiring MAY be in more than one block and file, and `count:wiring` sums them.
4. THE target for the wiring is at most 20 counted lines. THE measured number SHALL be written in `design.md`, "Measured values", from `npm run count:wiring`, whatever it is. IF the number is above 20, it SHALL be reported as it is, and no Tokk call SHALL be moved out of the markers, and no line SHALL be joined or dropped, to reach the target.
5. THE constants of the app (times, pixel sizes, counts, the storage key, the number of examples) SHALL be in `apps/hands-free/src/constants.ts`, each name with its unit (`_MS`, `_PX`, `_HZ`, `_PER_S`). The units rule says "keep the constants in `core/constants.ts`", but an app cannot import `core/` (`check:public-api`), and Task 21 kept its own constants in `scripts/` for the same reason. This is a named exception, recorded in design.md. THE app SHALL NOT hard-code a sample count, and it SHALL NOT compute a time from anything but `performance.now()` of the page or the sound time `t` that the engine gives.
6. THE app SHALL NOT call `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon`, SHALL NOT send or store audio, a waveform or the output of `onEnvelope`, and SHALL NOT use `onEnvelope`. The only things it writes to storage are the model that the library stores under `storageKey` and nothing else (requirement 3.9, privacy rule).
7. EVERY URL in the app SHALL be relative. THE page SHALL work at `/apps/hands-free/index.html` on the dev server and at `/tokk/apps/hands-free/` on Pages.
8. THE app SHALL have no external font, image, stylesheet or script, and no Halloween element (`ui.md`). The look is generic: system font, plain colours, one inline `<style>` block or one stylesheet beside `index.html`.

### Requirement 2: The start screen and the microphone
**User story:** As a visitor, I want to choose how I use the page before the browser asks for my microphone, and I want to read what happens to my audio.

#### Acceptance Criteria
1. THE page SHALL show first a start screen with one heading, two or three plain sentences about what the app is, and two buttons: "Start with the microphone" and "Use the keyboard only". Nothing SHALL ask for the microphone before the first button is pressed (a browser needs a user gesture for the audio context, and the visitor should know why the page asks).
2. THE page SHALL show, on every screen and in every state, one visible privacy line in the page header: "Your audio never leaves this device. Nothing is recorded or uploaded." It SHALL be real text, not an image, and it SHALL be true of the code (requirement 1.6).
3. THE privacy text SHALL also say, near the listening state, that the microphone stays on while the page is open even when listening is off, so that three clicks can turn listening on again, and that closing or reloading the page stops it. THE page SHALL NOT claim that listening off turns the microphone off.
4. "Start with the microphone" SHALL call `listen()` once, inside the click handler, and SHALL then follow requirement 3. WHEN `listen()` rejects (permission refused, no microphone, an unsupported sample rate), THE page SHALL show the error message as text and SHALL continue as keyboard only (requirement 2.5) with the sentence "The microphone is not available. You can still use the keyboard and the mouse."
5. "Use the keyboard only" SHALL show the content at once, with the scan, the keys, the buttons and the slider working, and with no `listen()` call. In this state the listening state SHALL read "Microphone not in use (keyboard only)". THE controls "Teach again" and the key `T` SHALL then start the microphone as in 2.4 and run the whole teaching (requirement 3.7), so the keyboard-only visitor can add the microphone later. THE key `L` SHALL answer in text that listening needs the microphone.
6. WHEN the stored model already has the taught `click`, `hum` and `background` (a returning visit), pressing "Start with the microphone" SHALL go straight to the content with listening on and SHALL NOT open a dialog.

### Requirement 3: The first-run guided teaching
**User story:** As a new user, I want the app to teach itself my sounds in about a minute with plain, friendly instructions, and I want to redo it whenever I like.

#### Acceptance Criteria
1. THE app SHALL call `listen()` without `sounds`, so it starts with an empty model. It SHALL use `modes` (requirement 6.1), `mode: 'on'`, the `storageKey` of 3.9 and `onEvent` (requirement 7.1).
2. AFTER `listen()` resolves, THE app SHALL compute the missing steps from the model: `click` is missing when `ears.labels` lacks `click`, `hum` when it lacks `hum`, `background` when `ears.sounds.examples` has no example labelled `background`. THE steps SHALL always run in the order click, hum, background. WHEN no step is missing, the app SHALL go to the content (requirement 2.6).
3. THE steps SHALL be, in this order, each one `ears.teach(label, { ui: true, examples, text })`:
   1. `click`: "click (tongue click)", 10 examples (`examples: 10`, the library default, named as a constant), a quiet first second as the dialog gives it.
   2. `hum`: a steady comfortable hum for at least 2 s (the dialog's own minimum).
   3. `background`: speak normally for at least 10 s (the dialog's own minimum). THE text SHALL explain that this teaches the app what to ignore.
4. THE texts of the dialog SHALL be plain, friendly English in the app's voice, set with `TeachOptions.text` for each step, and SHALL include the step number ("Step 1 of 3"), what to do, and, in `saved`, what comes next. THE exact strings are in design.md, "Teach texts". EVERY text SHALL pass the library's own check (known keys, allowed placeholders only, not empty), proved by a unit test (U7).
5. THE page behind the dialog SHALL show the progress as text too: "Teaching: step 1 of 3, click" with the three step names and a mark on the done and the current one (the mark paired with the words "done" and "now"). THE progress SHALL be readable without colour and SHALL NOT use motion.
6. THE steps SHALL NOT be skippable once the sequence has started, except by Cancel (Esc or the Cancel button), which stops the sequence. WHEN the user cancels, THE app SHALL say in text "Teaching was cancelled. Press Teach again to continue." and SHALL go to the content with the taught sounds so far in use. A `click` that was never taught SHALL leave listening unable to act, and the state text SHALL say "Not ready: the click sound is not taught yet."
7. THE control "Teach again" SHALL be in the page at all times (the control bar, a real button, reachable by Tab) and SHALL also be the key `T`. WHEN pressed it SHALL run all three steps, each replacing the sounds of its label (the dialog says so itself). While a dialog is open, the page SHALL not accept scan actions and no handler of Tokk fires (the library drops them).
8. THE dialog's saved screen stays open until the user presses Close, and a new `ears.teach` closes a dialog that shows only that saved screen (requirement 16). THE app SHALL therefore go on to the next step by awaiting the next `ears.teach` at once after the previous one resolves, three times in a row, with no retry, no wait and no match on an error message, and SHALL treat every rejection as a failure of the step (requirement 3.10). THE `saved` text of the first two steps SHALL say which step comes next. THE saved screen of the last step stays until the user presses Close (its `saved` text says so).
9. THE app SHALL pass `storageKey: 'tokk:hands-free'`. The default key is shared with every other page of the same origin, and the two apps of plan 3 are served from one origin on Pages, so a model taught in one would load in the other. THE model SHALL then persist across visits by the library's own rule (feature vectors only, never a recording).
10. IF a step fails for another reason than Cancel (the training fails, the model cannot be stored), THE app SHALL show the library's message as text with a "Teach again" button and SHALL NOT crash the page. "Saved for this session only" (storage refused) SHALL be shown as the dialog shows it.
11. AFTER the last step is saved, THE app SHALL set the mode to `on`, start the scan (requirement 4.1) and write "Listening is on" in the state (requirement 6.3). The target time of the whole teaching is about one minute for a person; this task SHALL NOT claim a measured teaching time (the human check does, with a real microphone).

### Requirement 4: The scan
**User story:** As a user who can only make sounds, I want a frame that moves over the page for me, at a speed that suits me, and that I can pause.

#### Acceptance Criteria
1. THE scan SHALL highlight, one at a time, the focusable elements of the content area (`<main>`): links and enabled buttons that are visible, in document order, which is the reading order of the page. THE page's own controls (the control bar, the header, the teach button) SHALL NOT be scan targets. THE scan SHALL wrap from the last target to the first. THE targets SHALL be collected again whenever the view changes. WHEN a view has no target, the scan SHALL wait and SHALL record nothing.
2. THE highlight SHALL be a frame drawn on the element itself (an outline of at least 3 px that contrasts at least 3 to 1 with the page, an offset, and the attribute `data-scan="current"`), with no transition and no animation, and it SHALL scroll the element into view with `block: 'nearest'` and no smooth scrolling when it is outside the window. THE name of the highlighted element SHALL also be shown as text ("Highlighted: …") in a region that is not a live region, so a screen reader is not interrupted every step.
3. THE time between two moves SHALL be 1200 ms by default and adjustable from 600 ms to 3000 ms in steps of 200 ms with a range input labelled "Scan step (seconds between moves)", which shows its value as text ("1.2 s"). A change of the value SHALL restart the wait for the next move from that moment, with the highlight staying where it is. THE speed SHALL NOT be stored (design.md, "Later decisions").
4. THE scan SHALL have a pause control: a real button "Pause scan" / "Resume scan" and the key `P`. While paused the highlight stays on its element and no move happens. WHEN resumed, the next move SHALL happen one full step after the resume.
5. THE scan SHALL run only while the app is in the content state with listening on (or in keyboard-only mode) and not paused by the user. WHILE listening is off, the scan SHALL stop and the frame SHALL be hidden, and it SHALL start again with a full step when listening is turned on. WHILE a teach dialog is open, the scan SHALL be stopped.
6. EVERY move SHALL be recorded as the pair of the time `performance.now()` (read at the moment the highlight is set) and the target. THE record SHALL be the scan history of requirement 5.1. WHEN a view changes, THE history SHALL be cleared and the scan SHALL start at the first target of the new view, with that first highlight recorded too.
7. THE scan SHALL NOT depend on a frame loop: moves come from one pending timer, so with reduced motion or a hidden tab nothing animates and nothing piles up (a move that is late by a timer delay is recorded at its real time).

### Requirement 5: The patterns and what they do
**User story:** As a user, I want a small, fixed set of sounds that do the four things I need while reading.

#### Acceptance Criteria
1. `click` SHALL activate the element that the scan history says was highlighted at `ears.toPageTime(m.t)` for the match `m`, and SHALL NOT activate the element that is highlighted when the match arrives. The lookup SHALL be: the last recorded move whose time is less than or equal to the page time; none when the time is before the first kept move (the history was cleared or pruned). THE history SHALL keep the moves of the last `SCAN_HISTORY_KEEP_MS` only. WHEN the lookup finds no target, or the target is no longer in the document, nothing SHALL be activated and the recognition text SHALL say so (requirement 7.2). WHEN `toPageTime` throws, nothing SHALL be activated and the text SHALL say that the timing was not ready.
2. "Activate" SHALL be `element.click()` of the element, so a link and a button behave exactly as for a mouse press.
3. `click click` SHALL go back (requirement 8.5). `click click click` SHALL turn listening on or off (requirement 6). `hum.rise` SHALL scroll the page up and `hum.fall` SHALL scroll it down (the order of the design document, 5.5), faster the higher `m.speed` is.
4. THE hum scroll SHALL work from the hum updates only: each `hum.rise` or `hum.fall` match scrolls by a step that is proportional to `m.speed` and to the sound time that passed since the previous update of the same hum (`m.t` differences, so it does not depend on the page's frame rate), with the time clamped to `HUM_UPDATE_DT_MAX_MS` and with a fixed `HUM_FIRST_UPDATE_DT_MS` for the first update of a hum. THE scroll SHALL stop at the end of the hum: the app SHALL reset the hum state on the `continuous` event with `phase: 'end'` and SHALL start no timer or frame loop that could scroll on its own. A hum that stays inside the dead zone (±2 semitones) SHALL scroll nothing. THE scroll SHALL be instant (no smooth behaviour), so reduced motion needs no special case.
5. THE patterns of the app SHALL be one table in one place (`bindings.ts`, requirement 12), with the pattern strings, the mode that holds each one and the action name. NO pattern SHALL mix a hum with another sound (the grammar forbids it).
6. A `click` SHALL be late by the grammar's 350 ms because `click click` exists. THE app SHALL show the recognition of a single click at once through `onEvent` ("Heard: click ✓") and the action when the match arrives, so the user sees that the sound was heard.

### Requirement 6: Listening off
**User story:** As a user who wants to talk to someone, I want listening off to mean that nothing but one deliberate sound can wake the page.

#### Acceptance Criteria
1. THE app SHALL define two modes with `listen({ modes })`: `on` with all five patterns (`click`, `click click`, `click click click`, `hum.rise`, `hum.fall`) and `off` with `click click click` only. TURNING listening off or on SHALL be `ears.setMode('off')` or `ears.setMode('on')`. THE app SHALL NOT use `ears.pause()` for this (a paused microphone cannot hear the sound that turns listening on, and a pause stops `toPageTime` clock updates).
2. IN the `off` mode nothing but `click click click` SHALL fire: a single click, two clicks, a hum that rises or falls, and sounds that the model does not know SHALL give no action, no scroll and no state change. This is proved against the real engine (U2) and in the browser (E4).
3. THE listening state SHALL be shown big and in text: a banner of at least 1.5 times the body font size reading "Listening is ON" or "Listening is OFF", with one line under it that says what to do ("Make three quick clicks to turn listening off." / "Make three quick clicks to turn listening on."). THE state SHALL not be told by colour, shape or sound alone. A change of the state SHALL be announced politely (a `role="status"` region).
4. WHILE listening is off, THE recognition text SHALL still show what was heard, marked as ignored: "Heard: click ✓ (ignored: listening is off)". THE `onEvent` of Tokk gives sounds in both modes, so this needs no extra Tokk call.
5. THE key `L` and a button "Turn listening off" / "Turn listening on" SHALL do the same as `click click click`. THE mode and the banner SHALL always agree (one source of truth for the state).
6. THE app SHALL NOT have the "block clicks while someone speaks" guard (the design document's alternative to the false clicks of speech). It is a later decision after real recordings (requirement 15.1).

### Requirement 7: Recognition shown as text
**User story:** As a viewer of a muted video, or a user who is not sure what the page heard, I want every recognition written on the page.

#### Acceptance Criteria
1. THE app SHALL use `listen({ onEvent })` and SHALL show two lines of text, always visible, near the listening state: "Heard:" (the last thing the engine heard) and "Did:" (the last thing the app did). THE texts SHALL be built by one pure function per line (requirement 12, U6), so the formats are tested.
2. THE formats SHALL be:
   - a sound event: "Heard: click ✓". Every mark is paired with its word, so no result depends on a glyph alone.
   - an unknown sound: "Heard: unknown sound ?".
   - a hum match: "Heard: hum ↑ speed 3.0" for `hum.rise` and "Heard: hum ↓ speed 1.5" for `hum.fall`, with the speed to one decimal. At the end of a hum: "Heard: hum ended".
   - a click pattern when it fires: the "Did:" line says what happened: `Did: opened "<title>"`, `Did: went back to the list`, `Did: already at the list`, `Did: listening is now off`, `Did: listening is now on`, `Did: scrolled up`, `Did: scrolled down`.
   - nothing to activate: `Did: nothing (no link was highlighted at that moment)`, and `Did: nothing (the timing was not ready)`.
   - while listening is off: the "Heard:" line carries "(ignored: listening is off)" for sounds, and the "Did:" line says nothing happened.
   - a key press: the same "Did:" texts, with `(key K)` at the end.
3. THE two lines SHALL NOT be live regions that interrupt a screen reader on every sound. THE listening state banner and the view change (focus to the heading) are the announcements.
4. THE text SHALL update at once and SHALL NOT animate. A hum updates its line at most once per `RECOGNITION_UPDATE_MS` (so a stream of hum updates does not rewrite the text on every hop).

### Requirement 8: Articles and navigation
**User story:** As a reader, I want a list of three articles, to open one, read it to the end and come back, without the listening ever stopping.

#### Acceptance Criteria
1. THE app SHALL be one document. THE views SHALL be a list of articles and one view per article, switched inside the document. THE microphone stream, the engine, the taught model, the scan settings and the listening state SHALL live across all view changes. The reasons are in design.md, "Single document, not separate pages".
2. THE view SHALL be mirrored in the URL hash: `#/` for the list and `#/article/<id>` for an article, so the browser's Back and Forward buttons and a link to an article work, and a reload shows the same view. THE view SHALL be rendered from the hash on load and on `hashchange` only, so there is one source of truth. An unknown id or a malformed hash SHALL show the list (with the sentence "That article was not found." under the heading).
3. THE list view SHALL show a heading, a sentence, and for each article a link whose text is the title, with the one-sentence summary after it in the same list item. THE article view SHALL show a link "Back to the list" at the top (a scan target), the title as the page heading, the paragraphs, and at the end a link "Read next: <title of the next article>" (a scan target that wraps through the three).
4. WHEN the view changes, THE page SHALL set `document.title`, move the keyboard focus to the view's heading (a heading with `tabindex="-1"`), scroll to the top, clear the scan history and restart the scan at the first target. THE focus move SHALL NOT scroll with a smooth behaviour.
5. "Back" (`click click`, the key `B`) SHALL go from an article to the list by setting the hash to `#/`. At the list it SHALL do nothing and say so ("Did: already at the list"); it SHALL NOT call `history.back()`, because that could leave the app and end the listening. THE parent of a view SHALL be one pure function (requirement 12, U4).
6. THE browser's own Back button SHALL work as usual inside the document (it changes the hash, which renders the view).
7. THE articles SHALL be rendered with DOM calls and `textContent`, never with `innerHTML` and never from a network response.

### Requirement 9: Look, motion and keyboard
**User story:** As any visitor, I want a plain page that I can use with the keyboard and that respects my settings.

#### Acceptance Criteria
1. THE page SHALL follow `ui.md`: all visible text in English; a visible focus outline of at least 2 px on every control; text contrast of at least 4.5 to 1 and graphics (the scan frame, the state banner border) at least 3 to 1, checked in a unit test by the hex values of the style (as the landing page test does); no Halloween element; every control a real `<button>`, `<a>`, `<input>` with an accessible name.
2. THE page SHALL respect `prefers-reduced-motion`: it has no CSS transition, no CSS animation, no smooth scrolling and no frame loop at all, whatever the setting. THE scan is the control method and stays on with reduced motion (it has the pause control of 4.4); this is recorded in design.md.
3. THE page SHALL be usable at 320 px width and 200 per cent zoom without sideways scrolling.
4. THE key map SHALL be exactly the following, shown on the page in a short list under the heading "Keyboard":
   - `K`: the same as `click` (activate the element highlighted at the moment of the key press).
   - `B`: the same as `click click` (back).
   - `L`: the same as `click click click` (listening on or off).
   - `P`: pause or resume the scan.
   - `T`: Teach again.
   - `Tab`, `Shift+Tab`, `Enter`, `Space`, the arrow keys, `Home`, `End`, `Page Up` and `Page Down`: the browser's own, on every control and for scrolling (they stand in for the hum). `Esc` closes the teach dialog (the library's).
   - THE slider changes the scan step with the arrow keys, `Home` and `End`.
5. THE letter keys SHALL be ignored when `Ctrl`, `Alt` or `Meta` is held, when the focus is in a text field, a select, a textarea or an editable element, while a teach dialog is open, and while "Keyboard shortcuts" is off. A button "Keyboard shortcuts: on" / "off" SHALL turn the letter keys off and on (a single-character shortcut must be possible to turn off, WCAG 2.1.4). THE other controls and the browser's keys SHALL work either way.
6. THE page SHALL do everything that a sound does without a sound (activate, back, toggle listening, scroll, pause, speed, teach again). THE only thing that needs the microphone is the recognition itself.

### Requirement 10: The three articles
**User story:** As a reader, I want three short, plain, original articles on everyday topics.

#### Acceptance Criteria
1. THE app SHALL have three articles written by Kiro for this task, in English, original text. THE topics are neutral and everyday: how bread rises (id `bread-rises`), why puddles disappear (id `vanishing-puddles`) and how to keep a houseplant alive (id `houseplant-basics`). THE text SHALL contain no real brand, product, company, person, place name or quotation, no medical, legal or money advice, and no text copied or closely adapted from another work.
2. EACH article SHALL have a title, a one-sentence summary for the list, and 8 to 10 paragraphs of 30 to 50 words, so that it is 280 to 420 words long and taller than the window (at a 1280 by 720 window the page can be scrolled by at least 600 px, requirement 13.9). THE sentences SHALL be short and plain.
3. THE articles SHALL be data in `src/articles.ts` (id, title, summary, paragraphs), not HTML files and not fetched (design.md, "Articles as data"). THE data module SHALL have no DOM and no Tokk import.
4. A unit test (U9) SHALL check the shape (three articles, unique ids that match `[a-z0-9-]+`, paragraph and word counts, every field a non-empty string, no `<` or `http`), and a human review step in the tasks SHALL check the originality and the no-brand, no-person rule by reading the three texts.

### Requirement 11: The site and the landing page
**User story:** As the operator, I want the landing page link to open the app on Pages.

#### Acceptance Criteria
1. `npm run build:site` SHALL include `apps/hands-free/` (`index.html`, the built `dist/app.js`, and any other non-excluded file) without a change to the build scripts, and the output SHALL pass Task 21's relative-URL checks.
2. THE landing page link `apps/hands-free/` (already in `site-src/index.html`) SHALL open the working app under `/tokk/`. A Playwright test (E6) SHALL build the site with the real `apps/` folder and serve it under `/tokk/` with the static test server of Task 21, follow the landing link, and check the start screen, the privacy line, no request outside `/tokk/`, and that "Start with the microphone" opens the first teach step (the dialog) with the fake microphone. THE landing page text SHALL NOT change.
3. THE build with the real apps folder prints the Task 21 warning for the missing `apps/knock-once/` link until Task 23. THIS is not a failure of this task and SHALL be noted in the devlog.

### Requirement 12: Unit tests
**User story:** As the author, I want the logic that decides what the app does to be tested without a browser.

#### Acceptance Criteria
1. THE logic SHALL be in pure modules (no DOM type, no `'tokk'` import, no timer, no global clock) so that Vitest in Node can import them: `history.ts` (the scan history), `bindings.ts` (the patterns, the modes and the actions), `hum-scroll.ts`, `nav.ts` (views, hash, parent), `keys.ts` (the key map), `text.ts` (the recognition texts and the teach texts), `steps.ts` (the teach steps and the missing steps), `articles.ts` (data), `constants.ts`. The DOM modules and `main.ts` use them.
2. THE tests SHALL be, at least:
   - U1 `test/hands-free-history.test.ts`: the scan history returns the element highlighted at a given page time (requirement 5.1), also as a property test against a plain reference, with the edge cases (a time equal to a move, before the first move, after the last, after the pruning, after `clear`, a move recorded out of order throws).
   - U2 `test/hands-free-gate.test.ts`: listening off, only `click click click` fires, against the real engine (design.md, "Tests"): the `on` patterns give `click`, `click click`, `click click click` and `hum.rise` or `hum.fall` for the matching sounds; the `off` patterns give `click click click` and nothing else for the same sounds.
   - U3 `test/hands-free-hum-scroll.test.ts`: hum speed to a scroll step, and it stops on hum end.
   - U4 `test/hands-free-nav.test.ts`: the article and back navigation state.
   - U5 `test/hands-free-keys.test.ts`: the key map (requirement 9.4 and 9.5).
   - U6 `test/hands-free-text.test.ts`: the recognition formats (requirement 7.2).
   - U7 `test/hands-free-steps.test.ts`: the missing steps from a model, the order, the examples count, and that every teach text passes `resolveTeachText` and its placeholders.
   - U8 `test/hands-free-wiring.test.ts`: the wiring honesty (requirement 1.3), the markers exist, and `countWiring` of the app sums to a number (the number is reported, not limited).
   - U9 `test/hands-free-articles.test.ts`: the article data (requirement 10.4) and the contrast of the style colours (requirement 9.1).
3. EVERY test SHALL be able to fail: each is written first and seen to fail (tasks step 2). A property test SHALL use `test.prop` and no `numRuns` (the count comes from `PBT_RUNS`). A test SHALL NOT use fake timers for the history or the scroll (they take the times as arguments).
4. THE existing tests SHALL pass unchanged, except the named changes (design.md, "Changed tests").

### Requirement 13: End-to-end tests with the fake microphone
**User story:** As the author, I want the real first-run flow, the click lookup, the back sound and the keyboard checked in Chrome.

#### Acceptance Criteria
1. THE fixture SHALL be one generated WAV for Chrome's fake microphone, made in Node by a generator in `test/web/` and run by the global setup (as the other fixtures are), with a JSON file of its times. IT SHALL hold, in this order and with the quiet gaps of design.md: a calibration lead (a quiet noise bed), the teach sounds in the order the first-run flow asks (ten click sounds, a steady hum with vibrato, speech-like shaped noise), and the test sounds (design.md, "The fixture and the timeline"). THE generator SHALL check in Node, with the same engine, that the file gives the expected taught examples (ten segments in the click part) and the expected matches in the test part, and SHALL throw when it does not (as `checkFixture` does for the other files).
2. THE stand-ins SHALL be synthetic and SHALL be the ones of design.md, "Why these stand-ins are fair": the impact class `high` of `core/synth` (3500 Hz band, 25 ms decay) for the tongue click, a harmonic tone with vibrato for the hum, and pink noise with a syllable-rate envelope and short pauses for the speech-like background. THE test file and the design SHALL say that they are stand-ins, not recordings, and that they show the app's logic and wiring, not the recognition of a real mouth.
3. E1 `test/web/hands-free.spec.ts`, title "first run teaches click, hum and background, then a click opens the highlighted article link": the page opens, "Start with the microphone" is pressed, and the test goes through the real flow (the dialog of each step with the app's texts, Done and Save for each, with the app's next `ears.teach` closing the saved dialog and opening the next one by itself, and Close for the last), then sets the scan step to its minimum with the keyboard, arranges the scan by pausing and resuming it at computed page times (design.md), and the click sound of the file opens the article that was highlighted when the sound was made, and not the one highlighted when the match fired.
4. E2 (same file, same stream), title '"click click" goes back to the article list': two clicks 250 ms apart in the article view go back to the list; the text says so.
5. E3 (same stream), title "a falling hum scrolls the page down and stops when the hum ends, and a steady hum scrolls nothing": in an article view a steady hum at the taught pitch (with vibrato, inside the dead zone) scrolls nothing, then a falling hum with vibrato scrolls the page down, and the scroll position stops changing within `HUM_STOP_SETTLE_MS` after the hum ended. THE proportion of the step to the speed is proved by U3, not here.
6. E4 (same stream), title '"click click click" turns listening off, a click then does nothing, and "click click click" turns it on': also asserts that the speech-like probe sound fires nothing while listening is on.
7. E5 (a separate test with the default fake microphone file), title "keyboard alone can do every action": after "Use the keyboard only", with real key presses only: Tab to the controls and a visible focus outline, the key `P`, the slider with `Home`, `K` opens the highlighted article, a scroll key scrolls, `B` goes back, `L` answers that it needs the microphone, the shortcuts button turns the letter keys off and on, and `T` opens the teaching dialog (the microphone starts) and `Esc` cancels it with the cancel text.
8. E6 (requirement 11.2), title "the landing page link opens Hands-Free under /tokk/".
9. EVERY E2E SHALL record requests and fail on a request to another origin (apart from `data:` and `blob:`), on a failed request, on a console error and on a page error. THE article is taller than the window by at least `ARTICLE_SCROLL_MIN_PX` (asserted in E3).
10. THE tests with the fixture SHALL be one `test.describe.serial` block with its own Chrome and its own context (the fake microphone file plays once from the moment the stream opens), and a failed test SHALL skip the later ones of the block. A unique `storageKey` is NOT possible (the app sets its own), so each test context starts with empty storage, and E1 asserts the model is stored under `tokk:hands-free` after the teaching.
11. NO title SHALL contain `smoke`. EVERY wait SHALL be on a state of the page or a named timeout with a unit, not a bare sleep, except the settle waits that the existing specs use.

### Requirement 14: Screenshot, documents and housekeeping
**User story:** As the author, I want the screenshot for the README and a record of what was done.

#### Acceptance Criteria
1. A test (E7, in the serial block after E4) SHALL take a PNG of the page in the list view with listening on, the highlight frame visible, the two recognition lines filled and the privacy line visible, at 1000 by 760 px. It SHALL check the PNG signature and a size below a named limit always, and SHALL write `docs/images/hands-free.png` only when `TOKK_WRITE_SCREENSHOT=1` (as the overlay test does). THE implementer SHALL write the file once with that variable and look at it before the commit.
2. `.kiro/steering/ui.md` SHALL get `apps/hands-free/**/*` in its `fileMatchPattern` list, so the UI rules load when Kiro edits the app. Nothing else of the file SHALL change, and `test/kiro-config.test.ts` SHALL still pass.
3. `docs/kiro.md` SHALL get one table row for this spec (the A9 test of `test/kiro-config.test.ts` fails otherwise). `docs/devlog.md` SHALL get one entry (what was built, the measured wiring lines, the decisions of requirement 15, the dead landing link to `knock-once`, that nothing was pushed or deployed).
4. DEVELOPMENT TIME (plan note and design document 9): the implementer SHALL record the start time (the system clock, with the zone) and the base commit hash in `design.md`, "Measured values", before the first change. THE end is the final commit `feat: add Hands-Free app`, whose hash and time the operator reads from `git log` (no second commit is made to record them). THE implementer SHALL NOT compute or write a duration in hours: the operator derives it from the run log and the commit times, and writes it in `docs/integration.md` later with the Kiro credits.
5. NO file outside the list of design.md, "Layout", SHALL change. NO other spec SHALL be written. `README.md` SHALL NOT change (its "pending" lines are Task 24's or plan 4's). NO change to `web/`, except the one named in requirement 16, and none to `core/`, `node/`, `scripts/`, `site-src/` or any runtime export.
6. THE final commit message SHALL be `feat: add Hands-Free app`. Nothing SHALL be pushed.

### Requirement 15: Later decisions and non-goals
**User story:** As the author, I want the things this task leaves out written down, so that they are decided later and not forgotten.

#### Acceptance Criteria
1. THE "block clicks while speech" guard (design document 7.1, experiment E3) is NOT in this task. It is a later decision, taken after real recordings show whether the wrong-click rate is above the target (listening on: at most 2 per hour, listening off: 0 in 10 minutes). The design records the place where it would go (a gate in `click` before the lookup).
2. THE scan speed is not stored. THE microphone cannot be stopped from the page (no "Stop microphone" button). THE Chrome extension is Task 24. THE debug overlay is off (`debug` is not set). THE waveform is not shown. THE scan covers `<main>` only, not the page's own controls. EACH is a later decision, listed in design.md.
3. THE app SHALL NOT claim a measured recognition quality, a teaching time or a number of wrong clicks anywhere in its text, tests or documents. Those come from the human check with a real microphone.
### Requirement 16: Sequential teaching (a small template fix)
**User story:** As an app author, I want to teach several sounds in a row with three awaits, so that no app needs a retry loop or a match on an error message.

#### Acceptance Criteria
1. WHEN `ears.teach()` is called while the previous dialog shows only its saved (finished) screen, THAT dialog SHALL close (as if the user pressed Close) and the new teach SHALL start.
2. WHEN `ears.teach()` is called while the previous dialog is still recording or reviewing (it has not been saved), it SHALL keep rejecting with the existing error ("ears.teach(): a teach dialog is already open. Save or cancel it first."), and the open dialog SHALL stay as it is.
3. E8, in `test/web/teach.spec.ts`, titled "teach closes a finished dialog and starts the next, and still rejects while a dialog is recording", SHALL prove both cases in Chrome. No expectation of an existing test changes.
4. `.kiro/steering/integrate.md` and the integrate skill of the power SHALL each get one line about sequential teaching ("await `ears.teach()` one after the other; a dialog that only shows its saved screen is closed by the next call").
5. THE change SHALL touch only `web/listen.ts` (no other file of `web/`, `core/` or any export) and no public type.
