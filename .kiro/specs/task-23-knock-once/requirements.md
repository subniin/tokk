# Requirements: Task 23, app 2, Knock Once for Yes

## Introduction
Task 23 is the fifth task of plan 3 (two apps). It builds app 2, Knock Once for Yes: a short Halloween séance game. The room is dark, a candle burns, and a spirit asks questions as text. The player answers by knocking on a table: one knock for yes, two knocks for no. The story branches on the answers and ends in one of three endings. The app lives in `apps/knock-once/`, imports only the public API `tokk`, follows `apps/README.md` (Task 21), and uses the template additions of Task 20 (start without sounds, `ears.labels`, `onEvent`, `onEnvelope`, `TeachOptions.text`, `--tokk-*` theming) the way Task 22 did.

The task also contains one small fix in app 1 (requirement 1), because app 1 shows a wrong "Heard:" line when listening is switched back on.

| Consumer | What it uses from this task |
|---|---|
| Task 21 (site) | `apps/knock-once/` is bundled to `dist/app.js`, copied by `build:site`, linked from the landing page (the link `apps/knock-once/` exists already and is the dead link that the build warns about), and counted by `count:wiring`. |
| Task 22 (Hands-Free) | Receives the "Heard:" fix of requirement 1. Nothing else changes in app 1. |
| Plan 3 completion check | `npm run count:wiring` gives the wiring lines. The human check with a real microphone (a whole game by knocking, one-knock and two-knock told apart at 95 per cent or better in the filming room) uses this app. |
| `docs/integration.md` (later) | The measured wiring lines and the development time. This task writes no hours (requirement 18.4). |
| Experiment E1 (later) | Decides whether a `glass` sound is added (requirement 14). This task adds nothing for it. |

Facts checked before this spec was written (step 1 of the tasks checks them again):
- `listen()` takes no `sounds` on a first run and starts with an empty model at the rate of the input. `ears.labels` lists the taught labels, sorted. A taught model is stored under `storageKey` (default `tokk:sounds`). The default key is shared by every page of one origin, and both apps are served from `https://subniin.github.io/tokk/`. App 1 uses `tokk:hands-free`, so this app needs its own key (requirement 3.5).
- `ears.teach(label, { ui: true, examples, text })` opens one dialog. `TeachOptions.text` replaces the dialog's texts (keys: `title` {label}, `quiet`, `record` {count}, `recordHum`, `recordBackground`, `training`, `count` {heard} {target} {kept}, `needMore` {min} {kept}, `review`, `failed`, `done`, `save`, `again`, `cancel`, `close`, `saved`, `savedSessionOnly`; an unknown key, an empty text or a wrong placeholder rejects with a `RangeError`). The dialog sits in a Shadow DOM and is themed by five CSS custom properties set on `:root`, `html` or `body`: `--tokk-bg`, `--tokk-fg`, `--tokk-accent`, `--tokk-font`, `--tokk-radius`. The focus outline and the warnings are not themable.
- `ears.teach` rejects while listening is paused, and `ears.pause()` and `ears.resume()` do nothing while a dialog is recording. While a dialog is open no handler, no `onEvent` and no `onEnvelope` is called. After Save or Cancel the engine is rebuilt and recognises again after its own calibration of about 1 s of audio.
- A `sound` event reaches `onEvent` as soon as the segment is classified. A match reaches its handler later: a pattern that is the prefix of a longer pattern waits for the longer one. Consecutive sounds are less than 350 ms apart (`GAP_CONSECUTIVE_MAX_MS`), a rest `_` is 350 to 1000 ms, both measured from the start of one sound to the start of the next. `setMode` and `Matcher.setPatterns` clear the pending sequence. `ears.setMode(name)` throws for a mode name that does not exist.
- `onEnvelope` gives the waveform as bins of 10 ms (`binMs`), two numbers per bin (`min`, `max`), about every 20 ms, with `t0` in seconds (a sample count divided by the sample rate). The arrays must not be modified. Tokk sends the envelope nowhere and the app must not send or store it. No envelope arrives while paused or while a dialog is open.
- `ears.toPageTime` stays correct across `pause()` and `resume()` (Task 20). This app does not need it.
- `ears.pause()` stops the microphone input to the engine and `ears.resume()` starts it again, so sound that is made while paused is never heard.
- `scripts/build-site.ts` returns `{ files, warnings, totalBytes }` and warns for every landing link whose target is missing. `site-src/index.html` already links `apps/knock-once/`. Task 22 left that warning in place on purpose.
- `core/synth` has the impact classes `low`, `mid`, `high` and `ring`, tones, noise and `place`. `test/web/fixture.ts` and `test/helpers/engine-fixture.ts` give `makeSignal`, the sample-rate and spacing constants and `checkTeachSegments`. Task 22's `test/web/hands-free-fixture.ts` is the model for a long generated stream with quiet gaps for the dialog handling.
- Chrome's fake microphone plays one WAV once from the moment a stream opens.
- Vitest runs in Node under `tsconfig.json` without DOM types. A pure module of the app that a vitest test imports must not use a DOM type or import from `'tokk'`. `tsconfig.web.json` (DOM) includes `apps/*/src/**/*.ts`.

## Requirements

### Requirement 1: Fix in Hands-Free: "Heard:" after the listening toggle
**User story:** As a Hands-Free user who turns listening back on with three clicks, I want the "Heard:" line to show what I just did and not "(ignored: listening is off)" under the "Listening is ON" banner.

#### Acceptance Criteria
1. WHEN `click click click` fires in Hands-Free (a match, not a key press), THE "Heard:" line SHALL show the toggle that was heard: `Heard: click click click ✓`. THE text SHALL have no "(ignored: listening is off)" part, whether listening is turned on or off by it. The check mark is paired with its words, as every mark of the app is.
2. THE text SHALL come from one pure function in `apps/hands-free/src/text.ts` (name chosen in the design: `heardToggle`), covered by a unit test in `test/hands-free-text.test.ts`. The unit test SHALL also assert that the text of the function never contains "ignored".
3. THE browser test E4 of Task 22 (`test/web/hands-free.spec.ts`) SHALL get two added assertions and no changed one: after the three clicks that turn listening off, and after the three clicks that turn it on again, `#heard` has the text of 1.1. The assertion for the single click while listening is off (`Heard: click ✓ (ignored: listening is off)`) SHALL stay as it is.
4. THE key `L` and the toggle button SHALL NOT change the "Heard:" line (nothing was heard). THE "Did:" texts SHALL NOT change. THE fix SHALL be outside the `// tokk:start` and `// tokk:end` block, so the Hands-Free wiring count stays 17.
5. NO other behaviour of app 1 SHALL change. NO test expectation of Task 22 SHALL change.

### Requirement 2: The steering file `halloween-ui.md`
**User story:** As the author, I want the Halloween look to be written down once, and loaded only when Kiro edits this app, so the template and app 1 stay free of it.

#### Acceptance Criteria
1. THE file `.kiro/steering/halloween-ui.md` SHALL exist with the front matter `inclusion: fileMatch` and the pattern `apps/knock-once/**`, so it loads only for files of this app.
2. IT SHALL describe, in short imperative rules in the style of `ui.md`:
   - the look: a dark room, candlelight (warm amber light on near-black), a séance table, a pale ectoplasm waveform; system fonts only (a serif stack); no image, font or script from outside;
   - the story voice: ghost questions are text (no speech synthesis, no voice recording), eerie and never gory, no real person, brand, place or quotation, the Edison "spirit phone" only as a light reference in one place and never as a quote;
   - captions always on: every recognised knock, every question and every effect appears as text, and there is no setting that turns the captions off;
   - reduced motion respected: no flicker, no flowing, no fade, no animation, a still ectoplasm, a canvas drawn at most once per second (the rule of `ui.md`), and the candle without flicker;
   - readable contrast: text at least 4.5 to 1 and graphics at least 3 to 1 against the dark background, also for the themed teach dialog (`--tokk-*`);
   - sound effects: synthesised with Web Audio only, short, quiet (a named peak level), faded in and out, never looped, never speech, played only between questions while `ears.pause()` holds the microphone, and never a sudden loud sound or a flash (no jump scare);
   - scope: Halloween elements live in `apps/knock-once/` only, never in `web/`, `teach.html`, `examples/`, `apps/hands-free/` or the `core/` code.
3. IT SHALL point to `ui.md`, `web-audio.md` and `privacy.md` for the shared rules, and SHALL NOT weaken any of them.
4. `.kiro/steering/ui.md` SHALL NOT change. A test (U11) SHALL check the front matter and the presence of the rules above by their key words, and SHALL scan `web/`, `teach.html`, `examples/` and `apps/hands-free/` for Halloween words (candle, séance and seance, ghost, spirit, ectoplasm, pumpkin, haunt, spooky, Halloween) and fail on a hit. The landing page `site-src/index.html` is not scanned (it links the app).
5. `docs/kiro.md` SHALL get the table row for this spec and for this steering file, as the other specs have (the A9 test of `test/kiro-config.test.ts` needs it).

### Requirement 3: The app folder, the build and the public API
**User story:** As the author, I want the app to follow the folder rules, so that `npm run dev`, `npm run build`, `npm run build:site` and `npm run count:wiring` treat it like every other app.

#### Acceptance Criteria
1. THE app SHALL be the folder `apps/knock-once/` with `index.html` at its root, `src/main.ts` as the entry, small modules beside it in `src/`, and `story.json` at the folder root. `index.html` SHALL load `./dist/app.js` with a relative URL. THE folder SHALL NOT have a `sounds.json` (the app starts without sounds and teaches `knock` on the first run) and SHALL NOT have a `sounds/` folder.
2. EVERY import of the app from a Tokk path SHALL be exactly `'tokk'`. A type-only import is allowed in a DOM module. THE pure modules of requirement 16 SHALL NOT import from `'tokk'` at all. `npm run check:public-api` SHALL pass.
3. THE Tokk wiring SHALL sit between `// tokk:start` and `// tokk:end`. EVERY value import from `'tokk'` and EVERY use of the object that `listen()` returns (`listen`, `ears.teach`, `ears.setMode`, `ears.pause`, `ears.resume`, `ears.labels`) SHALL be inside a marked block. The scan of the story, the flow, the captions, the canvas and the effects SHALL be outside, and SHALL reach Tokk only through small functions that the wiring passes in.
4. THE target for the wiring is at most 20 counted lines. THE measured number SHALL be written in `design.md`, "Measured values", from `npm run count:wiring`, whatever it is. IF it is above 20, it SHALL be reported as it is, and no Tokk call SHALL be moved out of the markers and no line joined or dropped to reach the target.
5. THE app SHALL pass its own `storageKey`: `'tokk:knock-once'`. THE reason SHALL be in the design: the two apps share one origin on Pages.
6. THE constants of the app (times, levels, counts, colours that a test checks, the storage key) SHALL be in `apps/knock-once/src/constants.ts`, each name with its unit (`_MS`, `_HZ`, `_DBFS`, `_PX`). The units rule says "keep the constants in `core/constants.ts`", but an app cannot import `core/` (`check:public-api`). This is the named exception of Task 22 and Task 21, recorded again in the design. THE app SHALL NOT hard-code a sample count: a buffer length is a duration in ms times the sample rate, divided by 1000 (the effect noise buffer, the ectoplasm history). THE app SHALL NOT compute a sound time `t` itself: it reads `t0` of an envelope as given, and every other time is `performance.now()` of the page or a timer in ms.
7. THE app SHALL NOT call `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon`, and SHALL NOT send or store audio, a waveform or the output of `onEnvelope`. The envelope is kept in memory for drawing only, for at most `ECTO_HISTORY_MS`. THE only thing the app writes to storage is what the library writes under `storageKey` (the model of feature vectors). THE story is read by `import` of `story.json` (bundled by esbuild, no request). IF step 1 of the tasks finds that the type check of `tsconfig.web.json` cannot import JSON without a config change, THE app SHALL read the story with one `fetch('./story.json')` of a relative URL instead, and the wiring test (U10) SHALL then allow exactly that one `fetch` and nothing else; the choice SHALL be recorded in the design.
8. EVERY URL in the app SHALL be relative. THE page SHALL work at `/apps/knock-once/index.html` on the dev server and at `/tokk/apps/knock-once/` on Pages. THE app SHALL have no external font, image, stylesheet or script.
9. THE app SHALL NOT use `innerHTML`, `eval`, `speechSynthesis` or `localStorage` directly.

### Requirement 4: The entrance, privacy and the microphone
**User story:** As a player, I want to read what the page will do before it asks for my microphone, and I want a way to play without one.

#### Acceptance Criteria
1. THE page SHALL first show an entrance with one heading, two or three plain sentences about the game (including the knock rules: one knock yes, two quick knocks no, and the summoning pattern), and two buttons: "Enter the room (use the microphone)" and "Play with the keyboard". Nothing SHALL ask for the microphone or create an audio context before a button is pressed.
2. THE entrance MAY have one light reference to the inventor Thomas Edison and his idea of a telephone for the dead, as one plain sentence without quotation marks, a date or a claim of what he said (requirement 7.8).
3. THE page SHALL show, in every state, one visible privacy line: "Your audio never leaves this device. Nothing is recorded or uploaded." It SHALL be real text and true of the code (requirement 3.7). THE page SHALL also say that the microphone stays on while the page is open (except for the short moments of sound effects) and that closing or reloading the page stops it.
4. "Enter the room" SHALL call `listen()` once inside its click handler, create the audio context for the effects in the same handler (a user gesture), and then follow requirement 5. WHEN `listen()` rejects, THE page SHALL show the error text and the sentence "The microphone is not available. You can still play with the keyboard and the buttons." and SHALL go on as keyboard play.
5. "Play with the keyboard" SHALL start the game with no `listen()` call. In that state the state line SHALL read "Microphone not in use (keyboard and buttons)". The key `T` and the "Teach again" button SHALL then start the microphone as in 4.4 and run the teaching.
6. WHEN the stored model already has `knock` (a returning visit), "Enter the room" SHALL go straight to the start screen with no dialog.

### Requirement 5: Teaching as part of the séance
**User story:** As a player, I want to teach the spirits my knock inside the story, once, and again whenever the table sounds different.

#### Acceptance Criteria
1. ON the first run (`ears.labels` lacks `knock`), THE app SHALL call `ears.teach('knock', { ui: true, examples, text })` once, with `examples` the library default of 10 (named constant), before the start screen. THE `text` SHALL be in the voice of the séance: the title, the quiet second, the knocking instruction `Knock on the table so the spirits can hear you.` (with the count `{count}`), the training text, the done, save, cancel and close buttons, and the saved text that says what happens next. THE exact strings are in the design. EVERY text SHALL pass the library's own check (known keys, allowed placeholders only, not empty), proved by U9.
2. THE page SHALL set the five `--tokk-*` custom properties on `:root` so the dialog looks like part of the room: a near-black background, a candle-cream text colour, an amber accent, a serif font stack and a small radius. THE colour pair that the dialog uses for text on its background SHALL have at least 4.5 to 1 contrast and the accent at least 3 to 1 against the dialog background, checked by U9 from the constants. THE page SHALL NOT try to style the inside of the Shadow DOM in any other way, and SHALL NOT change the focus outline of the dialog.
3. THE teaching SHALL be a single step. THE app SHALL NOT teach `hum` or `background` (design: later decisions). WHEN the user cancels (Esc or Cancel), THE page SHALL say in text "The spirits did not hear your knock. Press Teach again to try once more." and go on to the start screen with the state "Not ready: the knock sound is not taught yet." A knock that was never taught SHALL leave the knock patterns unable to fire, and the keyboard and the buttons SHALL still work.
4. THE control "Teach again" SHALL be a real button, always in the page after the entrance, and the key `T`. IT SHALL run the same dialog and replace the taught `knock`. IT SHALL be disabled (and the key ignored) while a sound effect plays, because `ears.teach` rejects while listening is paused. A rejection of any other kind SHALL be shown as text with the library's message and SHALL NOT crash the page.
5. WHILE the dialog is open, THE page SHALL ignore the answer and summon keys and buttons and the flow SHALL stay where it is. THE dialog's own saved screen stays until the user presses Close.
6. THE time to teach SHALL NOT be claimed as a measured number anywhere (requirement 19.3).

### Requirement 6: Modes and patterns
**User story:** As a player, I want a yes to be answered quickly, so I want each screen to listen only for the knocks it needs.

#### Acceptance Criteria
1. THE app SHALL define two modes with `listen({ modes, mode })`: `start` with the single pattern `knock knock _ knock` (summon the spirit), and `question` with the two patterns `knock` (yes) and `knock knock` (no). THE patterns, the modes and the answer names SHALL be one table in one place (`bindings.ts`). THE three patterns SHALL NEVER be active at the same time, in any state of the game, proved by U2 and U3.
2. THE reason SHALL be written in the design, with the numbers of the grammar: with all three patterns active, `knock` is the prefix of `knock knock`, which is the prefix of `knock knock _ knock`. Yes then waits 350 ms for a second knock, and no waits up to 1000 ms, because a rest of up to 1000 ms could still be followed by a third knock. In `question` alone, yes waits 350 ms and no fires at its second knock. In `start` alone the summon fires at its third knock. U2 SHALL measure these delays against the real engine and assert them, so the explanation is a test.
3. THE app SHALL call `ears.setMode` at every change of screen, so that the active mode is the mode of the screen: `start` on the start screen and on the ending screens (so that the same pattern summons the spirit again), `question` on every question screen. THE mode SHALL be set to the mode of the next screen before the microphone is resumed after an effect (requirement 11.3), so no knock is ever judged by the old screen's patterns.
4. THE engine SHALL be the gate: in `start` nothing but the summon pattern fires; in `question` nothing but `knock` and `knock knock` fires. THE flow SHALL also guard in the handlers (a handler that fires in a state that does not expect it does nothing), as a second layer. Both are tested (U2, U3, E1).
5. WHILE a sound effect plays, a dialog is open, or the game waits for the next screen (a transition), no handler of the app SHALL change the story. A knock heard at that moment SHALL change nothing and SHALL still be written as a caption if it was heard.

### Requirement 7: The story and its validator
**User story:** As the author, I want a short branching story whose structure is checked by a program, so that no path ends in nothing, loops, or hides a node.

#### Acceptance Criteria
1. THE story SHALL be in `apps/knock-once/story.json`, written by Kiro for this task, in English, original text. IT SHALL have 8 questions and exactly 3 endings (the validator accepts 7 to 10 questions and exactly 3 endings). THE shape is in the design: a version, a start node id, and a map of node ids to nodes; a question node has a text and a `yes` and a `no` target, an ending node has an id, a title and a text.
2. EVERY question SHALL be answerable by yes and by no. THE branches SHALL differ: a yes and a no from the same question SHALL lead to different nodes. THE paths SHALL merge in places (a node may have more than one way in), so that 8 questions and 3 endings give real branching and a game of 3 to 5 questions.
3. THE tone SHALL be eerie, not gory: a cold room, a stopped clock, a candle that leans, a name in the dust. NO violence, injury, body or blood, no real person, brand or place, no quotation, no medical, legal or money advice, no text taken or closely adapted from another work. THE questions SHALL be short (at most `STORY_QUESTION_MAX_CHARS`, 140) and plain, and SHALL be answerable by one knock or two without reading the previous text again.
4. THE endings SHALL be three different outcomes: a kind one (the spirit is at peace and the lamp stays lit), an open one (a door opens onto something unknown) and an unsettling one (the chair stays empty and the room goes quiet). THE endings are not gory and not frightening in a way that a child could not read.
5. A pure validator SHALL check the story and return every problem it finds as a list of texts that name the node. The rules: the shape is right (version, start, nodes, types, non-empty texts, ids match `[a-z0-9-]+`); the start node exists and is a question; every `yes` and `no` target exists; there are 7 to 10 questions and exactly 3 endings; every question has both targets and they differ; there is no cycle (a path that comes back to a node); no node is an orphan (every node is reachable from the start); every path from the start ends in an ending (no question without a way on; this follows from the rules above but is checked as its own rule so that the message is clear); all three endings are reachable; the shortest path to an ending has at least `STORY_PATH_MIN_QUESTIONS` (3) questions.
6. THE validator SHALL be pure (no DOM, no Tokk) and SHALL be unit-tested (U1) with the real file and with deliberately broken stories for every rule, and a property test (`test.prop`, no `numRuns`) that generates random layered stories (which are valid by construction) and checks they validate, and that adding one edge from a later layer back to an earlier one always reports a cycle.
7. THE app SHALL validate the story at start-up. WHEN the story is invalid the page SHALL show the problems as text and SHALL NOT start the game. A test (U1) SHALL prove that the real `story.json` is valid, so this never happens in a build.
8. THE inventor Edison MAY be mentioned once in the whole app, as a light reference ("a famous inventor once talked about a telephone for the dead", or the same in the app's own words), never as a quote and never with quotation marks around words he is said to have spoken. A unit test (U1) SHALL check that the name appears in at most one place of `story.json` and `index.html` together and that the text around it has no quotation marks.
9. THE texts SHALL be written by Kiro for this task and read by a person before the commit (a step of the tasks that is not marked done on Kiro's own reading alone).

### Requirement 8: The game flow
**User story:** As a player, I want a clear order of screens: entrance, teaching, summoning, questions, an ending, and a new game.

#### Acceptance Criteria
1. THE flow SHALL have these states: `entrance`, `teaching`, `waiting` (the start screen with the summon instruction), `between` (an effect plays, the answer is locked), `asking` (a question is shown and listened for) and `ending`. THE transitions SHALL be a pure table (`flow.ts`, tested as U3): `entrance` to `teaching` (first run) or to `waiting`; `teaching` to `waiting`; `waiting` to `between` on summon; `between` to `asking` when the effect and its tail are over and the question is shown; `asking` to `between` on an answer; `between` to `asking` (next question) or to `ending` (an ending node); `ending` to `between` on summon (a new game from the first question).
2. SUMMON SHALL be allowed only in `waiting` and `ending`. AN ANSWER SHALL be allowed only in `asking`, and the first accepted answer SHALL lock the state to `between` at once, so a second knock cannot answer twice.
3. THE start screen SHALL show the instruction in text and in words, "Knock, knock, pause, knock. Summon the spirit." with the same instruction for the keyboard and the button. THE question screen SHALL show the question, then the instruction "One knock for yes. Two knocks for no.". The ending screen SHALL show the ending title and text, the line "The spirit has gone. Knock, knock, pause, knock to call it again.", and the new game starts at the first question.
4. THE question text SHALL be shown as large text in the room (not read aloud). The previous question SHALL be replaced, not stacked. A change of the screen SHALL set `document.title`, and SHALL announce the question politely through a `role="status"` region.
5. AN ANSWER SHALL be written as a caption (requirement 10) at once, before the effect plays, and the next question SHALL be shown only after the effect and its tail are over (requirement 11).
6. THE app SHALL not store the progress of the game anywhere. A reload starts at the entrance.

### Requirement 9: The ectoplasm
**User story:** As a viewer, I want the waveform of the room to flow like ectoplasm, and I want a still picture if I asked for less motion.

#### Acceptance Criteria
1. THE page SHALL have a canvas that draws ribbons of pale ectoplasm whose height follows the sound level of the room, from `onEnvelope`. THE module SHALL keep the last `ECTO_HISTORY_MS` of the envelope as a rolling list of peak levels (the larger of the absolute `min` and `max` of each bin), with a length derived from the history in ms and the bin length in ms. IT SHALL NOT modify the arrays it receives and SHALL NOT keep them beyond the history. THE pure part (folding an envelope into the history, a level for a time window, the points of a ribbon for a width and a phase) SHALL be unit-tested (U7).
2. WHEN no envelope arrives for `ECTO_IDLE_MS` (the microphone is paused during an effect, the keyboard play has no microphone, or a dialog is open), THE ectoplasm SHALL settle to a calm, slowly drifting ribbon and SHALL NOT freeze on the last knock.
3. WHEN the user prefers reduced motion (`prefers-reduced-motion: reduce`, read at start and on change), THE canvas SHALL show one still image (a fixed, calm ribbon from a fixed seed), drawn once at start and again only on a resize or on a change of the setting, at most once per second. THERE SHALL be no animation frame loop, no timer that redraws, and no CSS animation or transition in that case. THE still image SHALL NOT depend on the envelope.
4. THE canvas SHALL NOT carry any information that is not also in text. IT SHALL be marked as a picture with a fixed accessible name ("A pale glowing ribbon that moves with the sounds in the room", or, in reduced motion, "A still pale glowing ribbon"). THE ribbon colour SHALL have at least 3 to 1 contrast against the background of the room (checked by U7 or U11 from the constants).
5. TWO attributes SHALL serve as test hooks and nothing else: `data-mode` on the canvas (`flowing` or `still`) and `data-level` (the peak level of the last `ECTO_LEVEL_WINDOW_MS`, rounded to two decimals).
6. THE frame loop SHALL not exceed the display's frame rate, SHALL stop when the tab is hidden (the browser pauses `requestAnimationFrame`), and SHALL draw within a budget that does not slow the page (a canvas of at most `ECTO_CANVAS_MAX_WIDTH_PX` wide). THE drawing code SHALL read no more than the rolling list.

### Requirement 10: Captions
**User story:** As a viewer of a muted video, or a player who is not sure what the room heard, I want every knock, every question and every effect written as text, and I want that to be impossible to turn off.

#### Acceptance Criteria
1. THE page SHALL have a visible captions list, always on, with no control that hides it. IT SHALL show, in order, the newest line last, at most `CAPTION_KEEP` lines (older lines are dropped), and SHALL scroll to the newest line without smooth scrolling.
2. EVERY sound the engine reports SHALL be captioned at once from `onEvent`: a `knock` as `Heard: knock ✓`; an unknown sound as `Heard: unknown sound ?`. EVERY mark is paired with its word. A continuous (pitch) event SHALL give no caption (the app does not use a hum).
3. EVERY action SHALL be captioned: the summoning (`The circle is open: knock, knock, pause, knock.`); an answer (`You answered: yes (one knock)` or `You answered: no (two knocks)`); an answer by key or button (the same with `(key Y)`, `(key N)` or `(button)`); a new game; the teaching result; listening problems.
4. EVERY question and EVERY ending SHALL be captioned as the spirit's line (`The spirit asks: <text>` and `The spirit says: <title>. <text>`). EVERY sound effect SHALL be captioned in square brackets, such as `[a cold wind passes]`, at the moment it starts, also when the effects are muted (the caption says what would have been heard).
5. THE caption texts SHALL be built by pure functions (U4), character by character. THE lines SHALL carry `data-kind` (`heard`, `action`, `spirit`, `effect`, `system`) so a test can count them.
6. THE captions list SHALL NOT be a live region that interrupts a screen reader at every knock. THE question has its own polite status region (requirement 8.4).
7. A knock that was made while the microphone was paused for an effect SHALL NOT be captioned, because it was never heard. THE page SHALL NOT claim otherwise.

### Requirement 11: Sound effects and the paused microphone
**User story:** As a player, I want a few quiet spooky sounds between the questions, and I do not want the room's speakers to knock for me.

#### Acceptance Criteria
1. THE effects SHALL be synthesised with Web Audio in the page (oscillators, filtered noise, gain envelopes). THE app SHALL have no audio file and no `<audio>` element. THE effects are: `summon` (a low rising drone, at most `EFFECT_SUMMON_MS`), `between` (a short breath of filtered noise with a soft tone, at most `EFFECT_BETWEEN_MS`) and `ending` (a slow falling tone, at most `EFFECT_ENDING_MS`). EACH SHALL be described by a data recipe (voices with start, duration, frequencies in Hz and gain in dB), so that U6 can check it.
2. THE effects SHALL be short and quiet: no recipe is longer than `EFFECT_TOTAL_MAX_MS` together with the tail, the peak of every recipe is at most `EFFECT_PEAK_DBFS` (−14 dBFS), each voice fades in over at least `EFFECT_FADE_IN_MS` and out over at least `EFFECT_FADE_OUT_MS`, no voice loops, and no effect is speech. THERE SHALL be no sudden loud sound and no flash.
3. EFFECTS SHALL play only between screens: after `summon` and after each answer, never while a question waits for an answer. FOR each effect THE app SHALL, in this order: lock the flow (`between`), call `ears.pause()`, play the effect, wait the effect's duration and the tail `EFFECT_TAIL_MS` (so the room's sound dies away), show the next screen and call `ears.setMode` for it (requirement 6.3), call `ears.resume()`, and unlock the flow (`asking` or `ending`). THE app SHALL call `ears.resume()` in every case, also when playing the effect fails (a `finally`), so the microphone is never left paused.
4. THE effect SHALL not end by an audio-clock event: the wait SHALL be a timer of the effect's duration in ms, so a suspended or missing audio context cannot stall the game.
5. THE effects SHALL have a visible, real control "Sound effects: on" / "Sound effects: off" (and the key `M`) that mutes them. WHEN muted, THE app SHALL NOT call `ears.pause()` (nothing is played, so the microphone has nothing to avoid), SHALL hold the transition for `TRANSITION_HOLD_MS` so the caption of the effect can be read, and the flow is the same. THE mute SHALL NOT be stored.
6. THE audio context SHALL be created in the click handler of the entrance and resumed there (`AudioContext.resume()` after a user gesture, `web-audio.md`). IF the context cannot be created, THE effects SHALL be treated as muted and the page SHALL say so as text.
7. THE scheduling logic (the order of the calls, the `finally`, a second effect asked while one runs, the mute case, the total time) SHALL be pure and unit-tested with injected functions and no fake timers (U5). THE Web Audio rendering of the recipes SHALL be a thin DOM module covered by the browser tests.
8. THE app SHALL NOT use `toPageTime`, because it does not match a sound to a moment on the page. (It stays correct across pause, Task 20.)

### Requirement 12: The keyboard and the buttons
**User story:** As a player who cannot knock, or as the tester, I want to do everything that a knock does with a key or a button.

#### Acceptance Criteria
1. THE key map SHALL be shown on the page in a short list under the heading "Keyboard" and SHALL be exactly: `Y`: yes (the same as one knock); `N`: no (the same as two knocks); `S`: summon the spirit (the same as the summoning pattern); `T`: Teach again; `M`: sound effects on or off; `Tab`, `Shift+Tab`, `Enter` and `Space`: the browser's own; `Esc` closes the teach dialog.
2. THE page SHALL also have real buttons "Summon the spirit", "Yes (one knock)" and "No (two knocks)", enabled only in the states where they are allowed (requirement 8.2). A key or a button SHALL do exactly what the matching sound does, through the same function of the flow, so there is one code path for the story.
3. THE letter keys SHALL be ignored with `Ctrl`, `Alt` or `Meta` held, when the focus is in a text field, select, textarea or editable element, while a teach dialog is open, and while "Keyboard shortcuts" is off. A button "Keyboard shortcuts: on" / "off" SHALL switch the letter keys (a single-character shortcut can be turned off, WCAG 2.1.4). THE other controls and the browser's keys SHALL work either way.
4. THE game SHALL be playable from the entrance to an ending with the keyboard only (E4), with no microphone.

### Requirement 13: Look, motion and contrast
**User story:** As any visitor, I want a dark, candle-lit room that I can read and that respects my settings.

#### Acceptance Criteria
1. THE page SHALL follow `halloween-ui.md` and `ui.md`: English text only; a near-black room with candlelight colours; a séance table drawn with CSS; system fonts; every control a real `<button>` with an accessible name and a visible focus outline of at least 2 px; text contrast of at least 4.5 to 1 and graphics at least 3 to 1, checked by a unit test from the colours of the style (U9).
2. THE candle SHALL be a simple shape. ITS flicker SHALL be a CSS animation only inside `@media (prefers-reduced-motion: no-preference)` and SHALL never flash more than three times a second. WITH reduced motion there SHALL be no CSS animation, no transition and no smooth scrolling anywhere in the page (a test reads the computed styles in E5).
3. THE page SHALL work at 320 px width and 200 per cent zoom without sideways scrolling, and SHALL be usable with a screen reader (headings, a status region for the question, buttons with names). The key text of the room SHALL not rely on colour.
4. THE page SHALL not use a jump scare, a flash, a sudden loud sound, a face, a skull, a blood colour or a gore image.
5. THE Halloween styling SHALL live in `apps/knock-once/` only (`halloween-ui.md`, requirement 2.4).

### Requirement 14: Not included: glass and wood
**User story:** As the author, I want to know that the "glass or wood" idea was left out on purpose.

#### Acceptance Criteria
1. THE app SHALL teach and use one sound, `knock`. THE app SHALL NOT teach, name or react to a `glass` sound. The design document says that this branch waits for experiment E1 (whether a glass tap and a wooden knock can be told apart on a laptop microphone), and that the design records where it would go (the `question` handlers and the caption of the answer) and what it would need (a `glass` label in the model, a different spirit line when the model has it).
2. THE app SHALL NOT claim in its text, tests or documents that it tells materials apart.

### Requirement 15: The site and the landing page
**User story:** As the operator, I want the landing page link to open the app on Pages and the site build to stop warning.

#### Acceptance Criteria
1. `npm run build:site` SHALL include `apps/knock-once/` (`index.html`, `story.json`, the built `dist/app.js`) without a change to the build scripts. THE output SHALL contain no `.ts`, `.wav`, `.map`, `.md` file and no `sounds/` or `src/` folder, and SHALL pass Task 21's relative-URL checks.
2. THE build with the real `apps/` folder SHALL no longer print the dead-link warning: `buildSite` SHALL return an empty `warnings` list (E6 asserts it). THE landing page text SHALL NOT change.
3. A Playwright test (E6) SHALL build the site with the real apps folder, serve it under `/tokk/` with the static test server of Task 21, open `/tokk/`, follow the link whose `href` is `apps/knock-once/`, and check the heading, the privacy line, that every request stays under `/tokk/`, that no request fails, that `story.json` is part of the bundle or is requested under `/tokk/apps/knock-once/`, and that "Enter the room" opens the teach dialog with the séance title (with the fake microphone) and Esc cancels it with the cancel text.
4. ANY existing test that expects the dead-link warning for the real `apps/` folder SHALL be found in step 1 of the tasks and changed in its expectation only (it expects the warning to be gone). THE tests that use a temporary apps folder with a missing app SHALL stay as they are.

### Requirement 16: Unit tests
**User story:** As the author, I want the logic that decides what the app does to be tested without a browser.

#### Acceptance Criteria
1. THE logic SHALL be in pure modules (no DOM type, no `'tokk'` import, no timer or clock of its own) so that Vitest in Node can import them: `story.ts` (the validator and the walk), `bindings.ts`, `flow.ts`, `captions.ts` (all texts), `effects.ts` (the scheduling) and `effect-recipes.ts` (the data), `ectoplasm.ts` (the history and the ribbons), `keys.ts`, `teach-texts.ts` (the dialog texts and the theme colours), `constants.ts`. THE DOM modules (`ui.ts`, `canvas.ts`, `audio.ts`) and `main.ts` use them.
2. THE tests SHALL be, at least:
   - U1 `test/knock-once-story.test.ts`: the validator (every rule with a broken story and its message; the real `story.json` is valid, with 8 questions and 3 endings; the Edison and no-quotation checks; a property test for layered stories and for an added back edge).
   - U2 `test/knock-once-gate.test.ts`: mode gating against the real engine (`createEngine` with the two modes, a model taught from synthetic knocks): `start` fires only the summon pattern, and not for one knock, two knocks, or the answer sounds; `question` fires `knock` and `knock knock` and nothing for the summon sequence except what its knocks mean (`knock knock` then `knock`); and the latency numbers of requirement 6.2 with all three patterns in one mode against the two modes.
   - U3 `test/knock-once-flow.test.ts`: the state table (allowed and refused moves, the lock after the first answer, the mode of every state, no state ever has all three patterns, a whole game by yes and no reaches an ending for every path of the real story).
   - U4 `test/knock-once-captions.test.ts`: every caption text of requirement 10, a mark always paired with its word, the `data-kind` of each line, the list keeps the newest `CAPTION_KEEP`.
   - U5 `test/knock-once-effects.test.ts`: effect scheduling with pause and resume: the order of `pause`, `play`, `wait`, `show`, `setMode`, `resume`; `resume` after a failed play; no overlap; muted means no pause; the total time at most `EFFECT_TOTAL_MAX_MS`; a locked flow.
   - U6 `test/knock-once-recipes.test.ts`: the recipes (durations, peak level, fades, frequencies below the Nyquist frequency of the lowest allowed sample rate, no voice longer than its effect).
   - U7 `test/knock-once-ectoplasm.test.ts`: the history length from ms, folding, the level of a window, the idle settle, the ribbon points inside the canvas, the still ribbon is the same on every call, the arrays of an envelope are not modified.
   - U8 `test/knock-once-keys.test.ts`: the key map and the ignore rules.
   - U9 `test/knock-once-teach.test.ts`: every dialog text passes `resolveTeachText` (imported from `web/teach-ui/text` in the test only), the first text asks to knock on the table, the contrast of the theme colours and of the style colours.
   - U10 `test/knock-once-wiring.test.ts`: the wiring honesty (requirement 3.3, 3.7, 3.9), the markers exist and are closed, the pure modules have no DOM word and no `'tokk'`, `countWiring` gives a number (reported, not limited), `storageKey` is `tokk:knock-once`.
   - U11 `test/halloween-scope.test.ts`: requirement 2.4.
   - U12 the Hands-Free text test (requirement 1.2).
3. EVERY test SHALL be able to fail: each is written first and seen to fail. A property test SHALL use `test.prop` and no `numRuns`. A test SHALL NOT use fake timers for the effects, the flow or the ectoplasm (they take their functions and times as arguments).
4. THE existing tests SHALL pass unchanged, except the named changes (design, "Changed tests").

### Requirement 17: End-to-end tests with the fake microphone
**User story:** As the author, I want the real flow checked in Chrome: teaching, summoning, yes, no, the captions, the paused microphone, the ectoplasm, reduced motion and the site link.

#### Acceptance Criteria
1. THE fixture SHALL be one generated WAV for Chrome's fake microphone, made in Node by a generator in `test/web/`, run by the global setup, with a JSON file of its times: a calibration lead with a quiet noise bed, then ten synthetic knocks for the teaching, then, timed to the app's screens and with quiet gaps longer than the slowest handling, one lone knock (not a pattern in `start`), the summon pattern, one knock (yes), a decoy knock during the effect that follows, and two quick knocks (no) (design, "The fixture and the timeline"). THE generator SHALL check in Node, with the same engine and the same modes, that the file gives ten teaching segments, the expected matches of the test part, and that the decoy WOULD be heard by an engine that was not paused (so that its absence in the browser proves the pause).
2. THE stand-in SHALL be synthetic, SHALL be named in the test file and the design, and SHALL say why it is fair (design, "Why this stand-in is fair"): a dull, short impact from `core/synth` (the class `mid`; the class `low` was tried first and its long segment breaks a quick pair, design "Measured values"). THE test file SHALL say that it shows the app's logic and wiring, and not the recognition of a real knock.
3. E1 `test/web/knock-once.spec.ts`, title "teach knock, summon the spirit, answer yes then no, and reach the next questions": the page opens, "Enter the room (use the microphone)" is pressed, the teach dialog appears with the séance texts (title, and the instruction to knock on the table), the test presses Done and Save and Close, the start screen shows the summon instruction, the lone knock does not summon, the summon pattern summons and the first question appears (the first node of `story.json`, read by the test), one knock answers yes and the node at the `yes` edge appears, two knocks answer no and the node at that node's `no` edge appears. THE test reads the edges from `story.json` and does not hard-code any question text. THE test never calls `ears` and never opens a dialog itself. IT asserts that the model is stored under `tokk:knock-once` as feature vectors with the label `knock`, and that no other storage entry has audio.
4. E1 also asserts the pause (requirement 11.3): the decoy knock that was placed in the window of the effect after "yes" produces no caption and no answer, and the next real knock is heard. THE page time of the effect start is read from a test hook (`data-effect` on the body: the effect name while it plays, empty otherwise) with a timestamp recorded by an in-page observer, so the test can show that the decoy fell inside the window. IF the decoy is not inside the measured window, the test SHALL fail with the numbers and say that the arrangement and not the app is out. The tolerance SHALL NOT be widened to pass.
5. E2, title "captions show every recognised knock as text" (same stream): the captions list has exactly one `Heard: knock ✓` line for each knock that was heard after the teaching (the lone knock, three summon knocks, one yes knock, two no knocks: seven), none for the decoy, the answer lines `You answered: yes (one knock)` and `You answered: no (two knocks)`, the spirit's question lines for the three questions in order, and effect lines in square brackets. THE test also asserts that no control hides the captions.
6. E3, title "the ectoplasm follows the envelope" (same stream): an in-page observer records the highest `data-level` during each knock window; it is above a named level for the knocks and below another named level in a quiet window; `data-mode` is `flowing`.
7. E4, title "keyboard alone plays the whole game to every ending" (default Chrome, no microphone): with real key presses (and Enter on buttons), from the entrance to each of the three endings by following edges of `story.json` (the test chooses answers by a walk of the file), with every question and every ending captioned, `S` starting a new game from an ending, `M` muting, `T` starting the microphone and Esc cancelling it with the cancel text, and the shortcuts button turning the letter keys off and on.
8. E5, title "reduced motion shows a still ectoplasm": with `reducedMotion: 'reduce'` emulated, the canvas has `data-mode="still"`; no `requestAnimationFrame` callback is scheduled by the page after the first draw (an init script counts calls); the canvas image is the same at two moments one second apart; `document.getAnimations()` is empty and no element has a CSS transition or animation; the same page without the emulation has `data-mode="flowing"` and the image changes between two moments.
9. E6, title "the landing page link opens Knock Once for Yes under /tokk/" (requirement 15.3).
10. E7, title "the screenshot of Knock Once for Yes is a small PNG, written only with TOKK_WRITE_SCREENSHOT=1" (requirement 18.1).
11. EVERY E2E SHALL record requests and fail on a request to another origin (apart from `data:` and `blob:`), on a failed request, on a console error and on a page error. THE tests with the fixture SHALL be one `test.describe.serial` block with its own Chrome and context (the file plays once from the moment the stream opens), and a failed test SHALL skip the later ones. NO title SHALL contain `smoke`. EVERY wait SHALL be on a state of the page or a named timeout with a unit, apart from the settle waits of the existing specs.

### Requirement 18: Screenshot, documents and housekeeping
**User story:** As the author, I want the screenshot for the README, a record of what was done, and one clean commit.

#### Acceptance Criteria
1. E7 SHALL take a PNG of the page at 1000 by 760 px with a question on screen, the ectoplasm flowing, the captions filled, the candle visible and the privacy line visible, and SHALL check the PNG signature and a size below a named limit always. IT SHALL write `docs/images/knock-once.png` only when `TOKK_WRITE_SCREENSHOT=1`. THE implementer SHALL write the file once with that variable and look at it before the commit (readable text, no clipped captions, no gore, the dark theme with readable contrast).
2. `docs/kiro.md` SHALL get the table rows of requirement 2.5. `docs/devlog.md` SHALL get one entry: what was built, the measured wiring lines, the decisions of this task (the two modes and their reason, effects with the pause, the story validator, the stand-in), the Hands-Free fix, that the site build no longer warns, the later decisions, and that nothing was pushed or deployed. It SHALL write no hours.
3. NO file outside the list of the design, "Layout", SHALL change. NO other spec SHALL be written. `README.md`, `site-src/`, `scripts/` and `docs/_planning/` SHALL NOT change. NO change to `web/`, `core/`, `node/` or any export.
4. DEVELOPMENT TIME: the implementer SHALL record the start time (the system clock, with the zone) and the base commit hash in the design, "Measured values", before the first change, and SHALL NOT compute or write a duration in hours. The end is the final commit, whose hash and time the operator reads from `git log`.
5. THE final commit message SHALL be `feat: add Knock Once for Yes app`. ONE commit holds the whole task, including the Hands-Free fix. Nothing SHALL be pushed.

### Requirement 19: Later decisions and non-goals
**User story:** As the author, I want the things this task leaves out written down.

#### Acceptance Criteria
1. THE `glass` sound (requirement 14), the `background` sound (talking near the table could be mistaken for a knock; decide after real recordings), a stored game progress, a stored mute, a "Stop microphone" button, sound for the spirit's voice, an ultrasound scare and more stories are NOT in this task. EACH is a later decision, listed in the design.
2. THE debug overlay is off (`debug` is not set).
3. THE app SHALL NOT claim a measured recognition quality, a teaching time, a one-knock and two-knock accuracy, or a number of wrong answers anywhere in its text, tests or documents. Those come from the human check with a real microphone and a real table, in the filming room.
