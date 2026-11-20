# Design: Task 23, app 2, Knock Once for Yes

## Layout
```
apps/knock-once/index.html            entrance, room (candle, table, canvas), question, captions, controls, key list, one inline style   [new]
apps/knock-once/story.json            8 questions, 3 endings                                                                          [new]
apps/knock-once/src/main.ts           entry: the Tokk wiring (marked) and the glue between the modules                                [new]
apps/knock-once/src/constants.ts      every number with its unit; the storage key; the theme colours                                  [new, pure]
apps/knock-once/src/bindings.ts       the two modes, the three patterns, the answer each pattern gives                                [new, pure]
apps/knock-once/src/story.ts          validateStory, the walk (next node for an answer), shortest and longest path                    [new, pure]
apps/knock-once/src/flow.ts           the state table, what each state allows, the mode of each state                                 [new, pure]
apps/knock-once/src/captions.ts       every caption text, the kinds, the rolling list                                                 [new, pure]
apps/knock-once/src/effects.ts        runBetween: the order of lock, pause, play, wait, show, setMode, resume, unlock                 [new, pure]
apps/knock-once/src/effect-recipes.ts the three effects as data (voices in ms, Hz, dB)                                                [new, pure]
apps/knock-once/src/ectoplasm.ts      envelope history, level of a window, ribbon points, the still ribbon                            [new, pure]
apps/knock-once/src/keys.ts           key event -> action, with the ignore rules                                                      [new, pure]
apps/knock-once/src/teach-texts.ts    the dialog texts, the theme properties, the cancel text                                         [new, pure]
apps/knock-once/src/ui.ts             DOM: entrance, question, captions list, buttons, key listener, state line                       [new, DOM]
apps/knock-once/src/canvas.ts         DOM: the ectoplasm canvas, frame loop, reduced motion, still image                              [new, DOM]
apps/knock-once/src/audio.ts          DOM: Web Audio rendering of the recipes, the audio context                                      [new, DOM]
.kiro/steering/halloween-ui.md        fileMatch apps/knock-once/**                                                                    [new]
apps/hands-free/src/text.ts           + heardToggle                                                                                   [changed, requirement 1]
apps/hands-free/src/main.ts           the toggle handler of the glue shows heardToggle (outside the markers)                          [changed, requirement 1]
test/hands-free-text.test.ts          + the heardToggle test                                                                          [changed]
test/web/hands-free.spec.ts           + two assertions in E4                                                                          [changed]
test/knock-once-story.test.ts         U1                                                                                              [new]
test/knock-once-gate.test.ts          U2                                                                                              [new]
test/knock-once-flow.test.ts          U3                                                                                              [new]
test/knock-once-captions.test.ts      U4                                                                                              [new]
test/knock-once-effects.test.ts       U5                                                                                              [new]
test/knock-once-recipes.test.ts       U6                                                                                              [new]
test/knock-once-ectoplasm.test.ts     U7                                                                                              [new]
test/knock-once-keys.test.ts          U8                                                                                              [new]
test/knock-once-teach.test.ts         U9 (texts, theme and style contrast)                                                            [new]
test/knock-once-wiring.test.ts        U10                                                                                             [new]
test/halloween-scope.test.ts          U11 (the steering file, Halloween only in this app)                                             [new]
test/web/knock-once-fixture.ts        generator and Node check of the one WAV, its JSON of times                                      [new]
test/web/global-setup.ts              + one call to the generator                                                                     [changed]
test/web/paths.ts                     + paths and URLs of the new files                                                               [changed]
test/web/knock-once.spec.ts           E1 to E7                                                                                        [new]
docs/images/knock-once.png            written once with TOKK_WRITE_SCREENSHOT=1                                                       [new]
docs/kiro.md                          + table rows (this spec, the steering file)                                                     [changed]
docs/devlog.md                        + one entry                                                                                     [changed]
```
The unit tests live in `test/` (Vitest, Node). The browser tests live in `test/web/` (Playwright). The pure modules are imported by relative path from the tests, which is not an app import of an internal path, so `check:public-api` has nothing to say. `.kiro/steering/ui.md` does not change: `halloween-ui.md` states the shared rules again for this app (captions, reduced motion, contrast), so the app does not need `ui.md`'s pattern widened, and `ui.md` keeps saying that it has no Halloween.

## Assumptions (written without a person to ask)
1. **Single screen, no router.** The game has no deep links and stores no progress, so there is no hash. The "screens" are states of one document (the flow table). A reload starts at the entrance.
2. **One taught sound, `knock`.** The task text says "teach knock". `background` is not taught (later decisions). The consequence is that talking near the table may be heard as a knock if it is close enough to the examples. The unknown-sound rule of the library (distance above the threshold) is the only guard. This is one of the things the human check looks at.
3. **The story is imported, not fetched.** esbuild bundles JSON, so `import` gives the story with no request and no loading state. Step 1 of the tasks checks that the web type check accepts the import. If it does not, the fallback of requirement 3.7 (one `fetch` of a relative URL) is used and recorded.
4. **The constants live in the app.** The units rule says "keep the constants in `core/constants.ts`". An app cannot import `core/`. Task 21 and Task 22 recorded the same exception. The names keep their units, which is the purpose of the rule.
5. **The ending screens use the `start` mode.** The same `knock knock _ knock` calls the spirit back for a new game. The plan says nothing about a new game. It costs no extra pattern and no extra mode.
6. **Effects are muted-able.** The plan does not ask for a mute. An effect that cannot be turned off is an access problem (for example for a player who is sensitive to sound), and the mute also makes the keyboard test fast. The mute is not stored.
7. **Edison.** The user allows the "spirit phone" as a light reference only. It is one plain sentence on the entrance, with no quotation, date or claim of a quote.
8. **The effect captions appear even when the effects are muted.** The captions are always on, and a muted player still learns what the room would have sounded like.
9. **Two `data-` attributes and two others are test hooks** (`data-mode`, `data-level` on the canvas; `data-effect` on the body; `data-node` on the question). They change nothing for a user and are not documented as an API.

## Findings from reading the code
1. **Two apps, one origin.** `https://subniin.github.io/tokk/apps/hands-free/` and `.../knock-once/` share `localStorage`. App 1 already uses `tokk:hands-free`. This app uses `tokk:knock-once`, so a model taught in one never loads in the other. The first-run base is a fixed fingerprint, so the library would not even warn.
2. **A match is late, a sound is not.** `onEvent` gives the `knock` sound as soon as its segment is classified, and a match comes up to 350 ms (yes) later. The captions show `Heard: knock ✓` at once and the answer line when the match fires, so a player who sees nothing happen for 350 ms still sees the knock was heard.
3. **`ears.pause()` is a real stop of input.** Sound made while paused is never heard. `ears.teach` rejects while paused, and `pause()` and `resume()` do nothing while a dialog is recording. The app therefore never starts a teach while an effect plays (the button is disabled, the key ignored), and never pauses while a dialog is open (an effect is never started then, because the flow is `teaching`).
4. **`setMode` clears the pending sequence.** Setting the mode for the next screen while the microphone is paused loses nothing: after an answer fires the sequence is empty anyway.
5. **After Save the engine is rebuilt** and recognises after about 1 s of audio (`NOISE_FLOOR_WARMUP_MS`). The gap after the teaching in the fixture covers it, and the human check says that the first knock after Close should wait a second.
6. **`onEnvelope` is not called while a dialog is open or while paused.** The ectoplasm must settle on its own when no envelope arrives (requirement 9.2). The arrays are shared with the debug overlay and must not be modified, so the history copies the one number per bin that it needs.
7. **`toPageTime` is not needed here.** It exists for app 1 (which key was highlighted when the sound was made). A knock answers the current question, which is the question on screen, so the app does not map times.
8. **The landing link already exists.** `site-src/index.html` links `apps/knock-once/` (that is the dead link of Task 21). The warning goes away when the folder exists. The landing text does not change.
9. **Vitest follows imports from `test/` under `tsconfig.json` with no DOM.** The pure modules take times and functions as arguments, as in Task 22, so the tests need no fake timers.
10. **The existing fixtures cannot be reused as one stream.** The teaching dialog and the game share one stream, and the game's gaps depend on the app's handling. A new generator is needed. It reuses `makeSignal`, `SYNTH_CLASSES`, `rng`, `place`, `checkTeachSegments`, the sample-rate and spacing constants and the style of `hands-free-fixture.ts`.

## Decisions

### The two modes, and why never three patterns at once
The grammar waits when a pattern is the prefix of a longer one. The three patterns are `knock` (yes), `knock knock` (no) and `knock knock _ knock` (summon):

| Active patterns | Yes fires after | No fires after | Summon fires after |
|---|---|---|---|
| all three at once | 350 ms (waits for a second knock) | up to 1000 ms (a rest of up to 1000 ms could still be followed by the third knock) | at the third knock |
| `question` only: `knock`, `knock knock` | 350 ms | at the second knock, no wait | not active |
| `start` only: `knock knock _ knock` | not active | not active | at the third knock, no wait |

The delays are measured from the last knock of the pattern. In a video a yes that answers after a third of a second and a no after a full second looks slow. With two modes the same player gets a no that fires at once, and the yes keeps the only wait that cannot be removed (it must see whether a second knock comes). U2 measures all of this against the real engine (the match time minus the sound time `m.t`, with the stream pushed in chunks of a named length in ms), so the table above is a test and not a claim.

The modes are switched by screen: `start` on the start screen and on the endings, `question` on a question. The switch is made while the microphone is paused for an effect, before `resume()` (requirement 6.3), so the first knock after an effect is judged by the new screen's patterns. A summon sequence heard in `question` mode is read as what it is there (a `knock knock` no, then a `knock` yes) and U2 asserts that, so nobody assumes that a stray summon is ignored.

### Bindings (`bindings.ts`)
| Name | Pattern | Mode | Answer or action |
|---|---|---|---|
| summon | `knock knock _ knock` | `start` | summon the spirit |
| yes | `knock` | `question` | answer yes |
| no | `knock knock` | `question` | answer no |

The module exports the pattern strings, the two lists (`MODE_START_PATTERNS`, `MODE_QUESTION_PATTERNS`) and the action of each pattern. The wiring builds `modes` from them.

### The flow (`flow.ts`)
| State | Shown | Mode of the engine | Allowed |
|---|---|---|---|
| `entrance` | the entrance | none (no microphone yet) | the two start buttons |
| `teaching` | the dialog | none (no handler fires) | the dialog's own controls |
| `waiting` | the start screen | `start` | summon (sound, `S`, button), Teach again, mute |
| `between` | the effect, the caption of it | none (paused, or held when muted) | nothing that changes the story |
| `asking` | a question | `question` | yes, no (sounds, `Y`, `N`, buttons), Teach again |
| `ending` | the ending | `start` | summon (a new game), Teach again |

`transition(state, event)` is pure and returns the next state or `null` for a refused event. Events: `begin` (an entrance button), `needsTeaching`, `taught`, `summon`, `answer`, `shown` (the effect and its tail are over and the next screen is drawn), `reachedEnding`. The story position is separate: `advance(story, nodeId, answer)` returns the next node id. U3 plays every path of the real story to an ending and checks the states on the way.

Handlers guard on the state: a summon handler does nothing unless the state allows it, and an answer handler locks the state to `between` before it does anything else. This is the second layer behind the engine's own gating (requirement 6.4).

### Effects and the paused microphone (`effects.ts`, `effect-recipes.ts`, `audio.ts`)
`runBetween(plan, io)` is the one function that every effect goes through. `plan` has the effect name, `muted`, the tail in ms and the hold in ms. `io` has `lock`, `pause`, `caption`, `play`, `wait`, `show`, `setMode`, `resume` and `unlock`, all passed in. The order:
1. `lock`, then `caption` (the effect text is written first, whether or not it is muted).
2. Not muted: `pause`, `play(effect)`, `wait(duration of the recipe + tail)`. Muted: `wait(hold)` only.
3. `show` (the next question or the ending is drawn), `setMode` for that screen, `resume` (not muted only), `unlock`.
4. Steps 2 to 3 sit in a `try`/`finally`: when `play` throws, a `system` caption says that the effect could not play and the sequence goes on with `show`, `setMode`, `resume` and `unlock`. `resume` is always called when `pause` was.
5. A second `runBetween` while one runs returns "busy" and calls nothing.

`wait` is a timer of the given ms, not an audio-clock event, so a suspended or missing audio context cannot stall the game (requirement 11.4). `play` only schedules the Web Audio nodes and returns at once.

**The recipes** are data: for each effect a total duration in ms and a list of voices. A voice has a kind (`sine` or `noise`), a start and a length in ms, a start and an end frequency in Hz (for noise, the centre of a band-pass or low-pass filter), and a gain in dB. First values (Kiro may tune them by ear in step 9, but U6 keeps the limits):

| Effect | Used after | Duration | Voices |
|---|---|---|---|
| `summon` | the summon | 1800 ms | a sine rising from 55 Hz to 82 Hz at -22 dB over the whole effect; band-passed noise at 900 Hz, 400 to 1500 ms, at -36 dB |
| `between` | every answer that leads to a question | 900 ms | low-passed noise sweeping from 300 Hz to 1200 Hz over 700 ms at -32 dB; a sine at 220 Hz, 200 to 800 ms, at -34 dB |
| `ending` | an answer that leads to an ending | 2400 ms | a sine falling from 196 Hz to 98 Hz at -24 dB over the whole effect; low-passed noise at 200 Hz at -38 dB |

Every voice fades in over `EFFECT_FADE_IN_MS` (60 ms) and out over `EFFECT_FADE_OUT_MS` (200 ms). The sum of the linear peaks of all voices of an effect must stay at or below `EFFECT_PEAK_DBFS` (-14 dBFS), which U6 checks as a worst case (the sum of the amplitudes, not the real peak). The noise buffer is `duration in ms` times the context's sample rate divided by 1000 samples long, so no sample count is written down. The tail `EFFECT_TAIL_MS` (200 ms) is the room's decay: the microphone reopens after it. The longest total is the ending, 2400 ms plus the tail, below `EFFECT_TOTAL_MAX_MS` (3000 ms).

**Why the caption comes first and the mute holds the same time:** the player reads the effect line while the effect plays. A muted player reads it during `TRANSITION_HOLD_MS` (900 ms), the same as the shortest effect, so the pace of the game does not depend on the mute.

**The audio context.** It is created in the click handler of the entrance and resumed there. If `AudioContext` does not exist or throws, the effects are treated as muted and a `system` caption says so. The app has no `<audio>` element and no file.

### The ectoplasm (`ectoplasm.ts`, `canvas.ts`)
The history is a rolling list of peak levels, one number per 10 ms bin (the larger of `|min|` and `|max|`, clamped to 1). Its length is `ECTO_HISTORY_MS / binMs`, derived at start from the bin length of the first envelope, not written as a count. `fold(history, env)` appends the bins of an envelope and drops the oldest. `levelOf(history, ECTO_LEVEL_WINDOW_MS)` is the largest value of the newest bins that cover that time. When the newest envelope is older than `ECTO_IDLE_MS`, the level eases to a small idle value, so the ribbon settles and does not freeze.

A ribbon is a smooth line across the canvas built from a few layers (`ECTO_LAYER_COUNT`, a count) of slow sine waves whose height is the history level at that column, plus the phase of the drift. `ribbonPoints(history, width, height, phaseMs, layer)` returns the points; `stillRibbonPoints(width, height)` returns a fixed calm ribbon from a fixed seed. The canvas draws each layer with a pale teal-green stroke and a wider, fainter glow stroke (a second stroke, not a blur filter, to keep the draw cheap), on the room's near-black.

`canvas.ts` owns the frame loop. In flowing mode it uses `requestAnimationFrame`, so the browser stops it in a hidden tab. In reduced-motion mode it draws once (and on a resize, at most once per second, and when the setting changes), and schedules nothing else. It reads `matchMedia('(prefers-reduced-motion: reduce)')` at start and listens for changes. The canvas is at most `ECTO_CANVAS_MAX_WIDTH_PX` wide and its size follows the container with a debounce. `data-mode` and `data-level` are written from the loop (flowing) or once (still).

The envelope is only drawn. It is copied bin by bin into the history, kept for `ECTO_HISTORY_MS` and then dropped. It is not stored, not sent and not logged (privacy rule).

### Captions (`captions.ts`)
`Caption` is a kind and a text. The functions: `heardKnock()` gives `Heard: knock ✓`; `heardUnknown()` gives `Heard: unknown sound ?`; `summoned()` gives `The circle is open: knock, knock, pause, knock.`; `answered(answer, via)` gives `You answered: yes (one knock)` or `You answered: no (two knocks)`, with `via` `knock`, a key (`(key Y)`) or `button` (`(button)`) in place of the knock words when the answer did not come from a knock; `spiritAsks(text)` gives `The spirit asks: <text>`; `spiritEnds(title, text)` gives `The spirit says: <title>. <text>`; `effectCaption(name)` gives the text in square brackets (`[a low hum rises from the table]`, `[a cold breath passes over the candle]`, `[the sound sinks into the floor]`); plus the system lines (teaching cancelled, microphone not available, an effect could not play, effects muted or on). `pushCaption(list, caption, keep)` returns a new list of at most `CAPTION_KEEP` (60) lines. Every mark is paired with its word. A knock that was not heard (paused) has no caption.

The DOM list uses `textContent` for every line, a `data-kind` attribute on each, and no live region. The newest line is scrolled into view with `scrollIntoView({ block: 'nearest', behavior: 'auto' })`.

### The story (`story.json`, `story.ts`)
**Shape.** `version` 1, `start` (a node id), `nodes` (a map from id to node). A question node has `type: 'question'`, `text`, `yes` and `no`. An ending node has `type: 'ending'`, `title` and `text`. The id is the key in the map and matches `[a-z0-9-]+`.

**Outline (the graph the text is written for).** The texts are Kiro's to write in step 7. The edges are fixed here so the tests and the text agree:

| Node | Yes goes to | No goes to |
|---|---|---|
| `q1` | `q2` | `q3` |
| `q2` | `q4` | `q3` |
| `q3` | `q5` | `q6` |
| `q4` | `q7` | `q5` |
| `q5` | `q7` | `q6` |
| `q6` | `q8` | `chair` |
| `q7` | `lamp` | `q8` |
| `q8` | `door` | `chair` |

The endings are `lamp` (the spirit is at peace and the lamp stays lit), `door` (a door opens onto something unknown) and `chair` (the chair stays empty and the room goes quiet). Reaching them: `lamp` only through `q7` yes, `door` only through `q8` yes, `chair` through `q6` no or `q8` no. The shortest path has 3 questions (`q1` no, `q3` no, `q6` no, ending `chair`); the longest has 6 (for example `q1` yes, `q2` yes, `q4` no, `q5` yes, `q7` no, `q8`). The graph is acyclic by construction (every edge goes to a higher-numbered question or to an ending). No question has the same target for yes and no. The ending ids are `lamp`, `door` and `chair`, and no question id uses those words.

**The first questions are about the room, not about danger:** is the room cold, is the clock stopped, is someone in the room with you, did you come alone, and so on, each answerable by one or two knocks. The writer's rules are in requirement 7.3 and 7.4. The Edison sentence is on the entrance page and not in the story (the validator test counts both).

**The validator.** `validateStory(raw)` returns `{ ok: true, story }` or `{ ok: false, problems }`, where every problem is a sentence that names the node ("q4: the target of no, q9, does not exist."). It checks the rules of requirement 7.5 in this order: shape, start, targets, counts, differing targets, cycles (a depth-first search with a stack), reachability from the start (orphans), dead ends, all endings reachable, shortest path length. It collects all problems and does not stop at the first, so the message of a broken file is complete. `nextNode(story, id, answer)` is the walk that the flow uses. `pathLengths(story)` gives the shortest and longest number of questions to an ending (for the tests). A duplicate key in the JSON text cannot be seen after parsing and is not checked (JSON.parse keeps the last one); the file is small and read by a person.

**The property test** builds a random layered story (a number of layers, a few questions per layer, every question pointing yes and no to different nodes of the next layer or to endings in the last layer, every node reachable by construction) and asserts `ok`. A second property adds one edge from a node of a later layer to a node of an earlier layer and asserts that a cycle problem is reported.

### Teaching and the séance theme (`teach-texts.ts`)
One step: `ears.teach('knock', { ui: true, examples: TEACH_KNOCK_EXAMPLES, text })`, only when `ears.labels` lacks `knock`. The five properties are set on `:root` before the dialog opens.

| Key | Text |
|---|---|
| `title` | `The spirits are listening` |
| `quiet` | `Hold your breath. Let the room fall silent for one moment.` |
| `record` | `Knock on the table so the spirits can hear you. Knock {count} times, one slow knock at a time.` |
| `training` | `The spirits are learning your knock...` |
| `save` | `Seal the knock` |
| `saved` | `The spirits know your knock. Press Close to enter the room.` |

The other keys keep the library's defaults. The cancel text is `The spirits did not hear your knock. Press Teach again to try once more.` The theme: `--tokk-bg` `#17100c`, `--tokk-fg` `#f3e3c3`, `--tokk-accent` `#e0a243`, `--tokk-font` a serif stack (`Georgia, "Times New Roman", serif`), `--tokk-radius` `2px`. These are first values: step 1 reads `web/teach-ui/teach-dialog.ts` to see which pairs (text on background, text on accent, accent against background) the dialog really draws, and U9 checks exactly those pairs from the constants. If the dialog puts text on the accent colour, the pair must have 4.5 to 1.

### Keys (`keys.ts`)
`actionForKey({ key, ctrl, alt, meta, targetKind }, { shortcutsOn, dialogOpen })` returns `yes`, `no`, `summon`, `teach`, `mute` or `null`. A key is compared in lower case. The ignore rules are those of Task 22 (modifiers, text targets, a dialog open, shortcuts off). The flow decides whether the action is allowed in the current state; the key map only names it.

### The page (`index.html`, `ui.ts`)
```
header           h1 "Knock Once for Yes", privacy line, state line (role="status": microphone state)
section#entrance the text, the Edison sentence, the two buttons
section#room     the candle, the table, the canvas (role="img", fixed name), the question (role="status", data-node)
section#help     the instruction for this screen ("Knock, knock, pause, knock ..." / "One knock for yes. Two knocks for no.")
section#actions  buttons: Summon the spirit, Yes (one knock), No (two knocks), Teach again, Sound effects: on, Keyboard shortcuts: on
section#captions the captions list (no control hides it)
section#keys     the key map
```
The room is drawn with CSS only: a radial candle glow, a table band, no image file. The candle flicker is a CSS animation inside `@media (prefers-reduced-motion: no-preference)`, slow and at most three changes of brightness a second. Colours (first values): room `#0d0907`, text `#f3e3c3`, the candle glow `#f2c46b`, ectoplasm `#9fe8c8`, button `#2a1c14` with text `#f3e3c3` and a 2 px border `#e0a243`, focus outline `#ffd98a`. U9 computes the contrast of each pair from the style block and from the constants.

### The wiring (`main.ts`)
Counted lines are the lines between the markers: one `import { listen } from 'tokk'`, one start function that runs inside the click handler of "Enter the room", with `listen({ storageKey, modes, mode: 'start', onEvent, onEnvelope })` where the `modes` come from `bindings.ts` and the handlers call glue functions (`app.summon()`, `app.answer('yes')`, `app.answer('no')`), the first-run `await ears.teach('knock', { ui: true, examples, text })` guarded by `ears.labels`, and one small object `port` of four adapters (`setMode`, `pause`, `resume`, `teach`) that the glue and `runBetween` use. If the count is above 20 the number is reported. Every use of `ears` is inside the block, so the glue never sees it.

### Constants (`constants.ts`)
| Name | Initial value | Meaning |
|---|---|---|
| `STORAGE_KEY` | `'tokk:knock-once'` | the `storageKey` |
| `TEACH_KNOCK_EXAMPLES` | 10 | examples of the teaching (the library default) |
| `EFFECT_SUMMON_MS` / `EFFECT_BETWEEN_MS` / `EFFECT_ENDING_MS` | 1800 / 900 / 2400 | effect durations |
| `EFFECT_TAIL_MS` | 200 | the room's decay before the microphone reopens |
| `EFFECT_TOTAL_MAX_MS` | 3000 | the largest duration plus tail allowed |
| `EFFECT_PEAK_DBFS` | -14 | the largest sum of voice peaks |
| `EFFECT_FADE_IN_MS` / `EFFECT_FADE_OUT_MS` | 60 / 200 | the least fades |
| `TRANSITION_HOLD_MS` | 900 | the hold when effects are muted |
| `ECTO_HISTORY_MS` | 4000 | how long the envelope is kept |
| `ECTO_LEVEL_WINDOW_MS` | 300 | the window of `data-level` |
| `ECTO_IDLE_MS` | 1500 | no envelope for this long: settle |
| `ECTO_CANVAS_MAX_WIDTH_PX` | 960 | the largest canvas |
| `ECTO_RESIZE_DEBOUNCE_MS` | 1000 | the least time between still redraws |
| `ECTO_LAYER_COUNT` | 3 | ribbon layers (a count) |
| `CAPTION_KEEP` | 60 | lines kept |
| `STORY_QUESTION_MIN` / `STORY_QUESTION_MAX` / `STORY_ENDING_COUNT` | 7 / 10 / 3 | counts the validator accepts |
| `STORY_PATH_MIN_QUESTIONS` | 3 | the shortest path to an ending |
| `STORY_QUESTION_MAX_CHARS` | 140 | the longest question |
| `FOCUS_OUTLINE_PX` | 2 | outline width |
| `COLOR_*` | the colours above | the colours that U9 and U7 check |

## The fixture and the timeline
One WAV at `WEB_TEST_SAMPLE_RATE_HZ` (48000 Hz), made by `test/web/knock-once-fixture.ts`, with a JSON of the start time of every part. Chrome plays it once from the moment the stream opens. The test drives the dialog and the game, so the quiet gaps between the parts are longer than the slowest handling. Every time is a stream time in ms, built from named constants and put on the sample grid (a whole number of samples, as `hands-free-fixture.ts` does with `onGrid`). The values are first values: step 10 of the tasks sets them from the measured handling times with at least a factor of 2 margin and records them.

| Part | From | Content | Rule |
|---|---|---|---|
| Calibration lead | 0 | noise bed at `SYNTH_FIXTURE_LEAD_NOISE_DBFS` | `WEB_TEST_TEACH_LEAD_MS` (3000): the app opens the dialog and its quiet second fits |
| Teaching | 3000 | 10 knocks, 800 ms apart (`WEB_TEST_IMPACT_SPACING_MS`), each with its own seed | the dialog counts exactly 10 |
| Gap A | after the last teaching knock | quiet, 12000 | Done, training, Save, Close, the start screen, the new engine's calibration (1000) |
| Lone knock | after gap A | one knock | `start` does not summon; caption `Heard: knock ✓` |
| Gap B | 8000 | quiet | the single-knock sequence times out (1000 ms at most) |
| Summon | after gap B | knocks at +0, +250 (`KNOCK_GAP_CONSECUTIVE_MS`) and +850 (`KNOCK_GAP_REST_MS` 600 after the second) | summons; the first question appears after the effect |
| Gap C | 8000 after the third summon knock | quiet | the match (at once), the effect (1800 + 200), the question drawn, setMode, resume |
| Yes | after gap C | one knock at Y | fires `knock` 350 ms later; `between` effect starts |
| Decoy | Y + 900 (`KNOCK_DECOY_AFTER_YES_MS`) | one knock | falls inside the paused window; must not be heard |
| Gap D | 8000 after the decoy | quiet | the effect (900 + 200), the next question drawn, resume |
| No | after gap D | two knocks 250 ms apart, the second at -3 dB (`KNOCK_PAIR_SECOND_GAIN_DB`) | answers no at the second knock; the next question appears |
| Tail | 6000 | quiet | the last captions and the screenshot |

All parts have the noise bed under them. Knocks are at `WEB_TEST_GAIN_DB` (-6 dBFS peak), each with its own random seed. The timeline is built so that the decoy sits about 500 ms after the pause starts and about 600 ms before it ends (the yes knock matches at about Y + 350, the pause then lasts 900 + 200 ms). The E1 arrangement checks this with measured numbers (below).

### Why this stand-in is fair
The knock is a synthetic stand-in, not a recording: an impact of `core/synth`. The first choice was the lowest class (`SYNTH_CLASSES.low`), with a switch to the next class if it did not work; step 4.3 found that it does not (see "Measured values"), so the stand-in is `SYNTH_CLASSES.mid`: noise through a band around 1200 Hz, a 60 ms exponential decay, 180 ms long. A hand knock on a table is a dull, low, short thump with a fast decay. The stand-in has what the pipeline reacts to: a sharp onset, a fast decay, a duration well under the segment limit, a spectrum that is low and broad. Each copy has its own random seed, as two real knocks differ, so the kNN has a spread to learn. The second knock of a pair is 3 dB quieter, as the second knock of a real quick pair often is, which checks that the features do not depend on loudness.

What the app's logic depends on is the **count and the spacing of the onsets** that the engine finds, and that each is recognised as `knock` rather than unknown. The grammar decides yes, no and summon from the times of the onsets, not from the timbre. So the stand-in tests the app's logic and wiring exactly as far as it matters: modes, answers, the effect pause, captions, the story. It does not show how well a real knock is recognised, how well a real one-knock and a real quick two-knock are told apart by a person with uneven rhythm, or whether talking near the table gives false knocks. Those are the human check with a real table in the filming room (target 95 per cent or better for one against two knocks), and none of them is claimed here.

### Node check of the fixture
`checkKnockOnceFixture` runs in the global setup and throws with a message that names the part:
1. The teaching part has exactly 10 segments (`checkTeachSegments`).
2. A model made the way the dialog makes it (`retrainLabel` for `knock` from the 10 segments) and the engine with the app's two modes recognise the test part: in `start`, no match for the lone knock and one `knock knock _ knock` for the summon; in `question`, one `knock` at the yes knock and **also one `knock` at the decoy** (an engine that is not paused would hear it, so its absence in the browser proves the pause), and one `knock knock` for the no pair. The same sounds with all three patterns in one mode give the later matches of requirement 6.2.
3. The times in the JSON are within one sample of the written file, and every knock is heard at its time (a presence check as in Task 22).

### The arrangement of E1
1. An init script wraps `navigator.mediaDevices.getUserMedia` and stores `performance.now()` when its promise resolves as `micStartMs`. The stream time `T` is the page time `micStartMs + T` within `SYNC_TOLERANCE_MS` (100 ms).
2. A second init script observes `document.body` and records the page time at which `data-effect` is set and cleared (a MutationObserver with `performance.now()`).
3. After the teaching, the test waits on page state, not on stream time, for each step: the start screen, the summon instruction, then the first question, the next question and so on, each with a named timeout.
4. The decoy check: when the effect after the yes starts, the test reads the recorded start and end page times and the decoy's page time `micStartMs + decoy`. The decoy must lie at least `DECOY_MARGIN_MS` (250) after the start and before the end. If not, the test fails with the three numbers and says that the arrangement, not the app, is out. The tolerance is not widened and the check is not dropped.
5. The caption counts (E2) and the level observer (E3) read the same stream after the game's last answer.

## Tests
| Id | File | What it proves |
|---|---|---|
| U1 | `test/knock-once-story.test.ts` | each rule with a broken story and its message (shape, start, missing target, too few or too many questions, wrong ending count, equal targets, a cycle, an orphan, a dead end, an unreachable ending, a path that is too short); the real `story.json` is valid with 8 questions and 3 endings; every question is at most 140 characters; the Edison name appears in at most one place of `story.json` and `index.html` and has no quotation marks around it; no text has a markup character; a property test of layered stories and of an added back edge |
| U2 | `test/knock-once-gate.test.ts` | real engine: `start` fires only the summon for the summon sequence and nothing for one knock, two knocks, three evenly spaced knocks; `question` fires `knock` and `knock knock`; the summon sequence in `question` gives `knock knock` then `knock`; the latency numbers: with all three patterns in one mode yes waits 350 ms or more and no waits more than 350 ms and at most 1000 ms plus the push step, and with two modes the no fires within one push step of its second knock's sound event (the segment of a knock closes about 235 ms after `m.t`, see "Measured values") and yes waits 350 ms |
| U3 | `test/knock-once-flow.test.ts` | the table: allowed and refused moves, the lock after the first answer, summon only in `waiting` and `ending`, the mode of every state, never all three patterns active in any state, every path of the real story ends in an ending with the right states on the way |
| U4 | `test/knock-once-captions.test.ts` | every text of requirement 10 character by character, the kind of each, a mark always paired with a word, the list keeps the newest 60, an answer by key and by button |
| U5 | `test/knock-once-effects.test.ts` | the order `lock, caption, pause, play, wait, show, setMode, resume, unlock`; `resume` after a failed `play`; a second run while busy calls nothing; muted: no `pause`, no `resume`, one `wait` of the hold; the wait is the recipe duration plus the tail and never more than `EFFECT_TOTAL_MAX_MS`; the mode is set before `resume` |
| U6 | `test/knock-once-recipes.test.ts` | every duration at most its effect's, the worst-case peak at most -14 dBFS, the fades at least the least values, frequencies below the Nyquist frequency of 16000 Hz (the lowest rate), no voice longer than the effect, the total with tail at most 3000 ms |
| U7 | `test/knock-once-ectoplasm.test.ts` | the history length from ms and bin length, `fold` keeps the newest, `levelOf` of a window, the idle settle, ribbon points inside the canvas for a range of sizes, the still ribbon is identical on every call, an envelope's arrays are not modified, the ribbon colour has 3 to 1 contrast |
| U8 | `test/knock-once-keys.test.ts` | each key to its action, case-insensitive, the ignore rules, the keys that must not be taken (Tab, Enter, Space, the arrows) |
| U9 | `test/knock-once-teach.test.ts` | every dialog text passes `resolveTeachText`; the `record` text contains `Knock on the table so the spirits can hear you.`; the theme and style contrasts; no `transition`, `animation` or `smooth` outside the `no-preference` media block in `index.html`; `lang="en"`; the privacy sentence is in `index.html` |
| U10 | `test/knock-once-wiring.test.ts` | no `from 'tokk'` value import and no `ears.` outside the markers in `apps/knock-once/src/**`; the markers exist and are closed; the pure modules have no `document`, `window`, `HTMLElement`, `AudioContext` or `'tokk'`; `countWiring` gives a number (reported, not limited); no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `innerHTML`, `eval`, `speechSynthesis`, `localStorage`; `STORAGE_KEY` is `tokk:knock-once` |
| U11 | `test/halloween-scope.test.ts` | the steering file's front matter and rule key words; no Halloween word in `web/`, `teach.html`, `examples/`, `apps/hands-free/`; `ui.md` is unchanged in its Halloween rule |
| U12 | `test/hands-free-text.test.ts` | `heardToggle` gives `Heard: click click click ✓` and never contains "ignored" |
| E1 to E3 | `test/web/knock-once.spec.ts` (serial block, one Chrome with the generated WAV) | requirements 17.3 to 17.6 |
| E4 | same file, default Chrome | the keyboard game to every ending |
| E5 | same file | reduced motion |
| E6 | same file | the landing link under `/tokk/`, no site warning |
| E7 | same file, in the serial block after E3 | the screenshot |

### E4, keyboard only
The default Chrome of the project (no microphone is started, so the fake file does not matter). The test reads `story.json` and plans three walks that end in the three endings (a breadth-first search on the file picks the answers). With real key presses: `Tab` to "Play with the keyboard" and `Enter`; `S` summons; for each question the test waits for the question text of the node and presses `Y` or `N`; every question and ending line is in the captions; at an ending `S` starts again; `M` mutes (the effect caption still appears, the hold passes) and the effect for each answer shortens the run; the shortcuts button turns the letter keys off (`Y` does nothing) and on; every control reached by `Tab` shows an outline of at least 2 px; `T` starts the microphone and opens the dialog with the séance title, and `Esc` cancels with the cancel text. No request leaves the origin, no console error. Without the mute each walk would take the effect times (about 5 to 20 s), so the first walk runs with effects on (to prove the flow with the real timers and the Web Audio calls) and the other two with the mute.

### E5, reduced motion
Two pages in the same test file, with `emulateMedia({ reducedMotion: 'reduce' })` and without. An init script wraps `requestAnimationFrame` to count calls. In the reduced page: `data-mode="still"`, the count of frames after the first draw stays at 0 over `STILL_OBSERVE_MS`, `canvas.toDataURL()` is the same at two moments, `document.getAnimations().length` is 0, no element has a computed `animation-name` other than `none` or a non-zero `transition-duration`, and `scroll-behavior` is `auto`. In the other page: `data-mode="flowing"`, the frames keep coming, the image changes between two moments (the idle drift), and the candle has its animation.

### E6, under `/tokk/`
`buildSite({ outDir, appsDir: <the real apps folder> })` into a temporary folder; the returned `warnings` list must be empty; `startSiteServer(outDir, '/tokk/')`; open `/tokk/`; follow the link whose `href` is `apps/knock-once/`; check the heading and the privacy line; press "Enter the room (use the microphone)" (the project's fake microphone); see the dialog with the title "The spirits are listening"; press `Esc`; see the cancel text. All requests start with `/tokk/` (the favicon is the one allowed exception of Task 21), no console error. The temporary folder is removed.

## Changed tests
- `test/hands-free-text.test.ts` gains the `heardToggle` test. `test/web/hands-free.spec.ts` gains two assertions in E4 and changes none.
- `test/web/global-setup.ts` and `test/web/paths.ts` only gain lines.
- `test/kiro-config.test.ts` A9 needs the `docs/kiro.md` rows (table rows, not a change of the test). Step 1 reads it and the steering checks to make sure `halloween-ui.md` fits them.
- Any existing test that expects the dead-link warning for the real `apps/` folder: found in step 1 (search the tests for `knock-once` and `warnings`). Its expectation changes to "no warning"; tests that use a temporary apps folder keep theirs. If the Task 22 spec's E6 only logs the warning (it only builds), nothing changes there.

## Risks
- **Timing of the long fixture.** The gaps are long on purpose. A slow machine could still exceed them. The first run measures the handling times, and a failure names the part that was played before its screen was ready.
- **The decoy window.** The decoy has to fall inside the paused window, about 500 ms from each edge. A page that is slow to react to the match could move the window by a hundred milliseconds. The E1 arrangement measures the window and fails with numbers, rather than passing by luck. If the measured offset between `micStartMs` and the true start is above 100 ms, step 10 stops and reports the numbers.
- **What `ears.pause()` really drops.** The design relies on it dropping the sound completely. The Node check shows the engine would hear the decoy, and E1 shows the page does not, which is the proof. If the browser does hear it, the finding goes to the operator, not into a weaker test.
- **A quick yes is a slow yes.** A single knock waits 350 ms. A player who knocks twice slower than 350 ms apart answers yes twice (the second knock is lost to the effect's pause, which is a mild help). The instruction line says "Two quick knocks". The human check measures it.
- **Talking near the table.** With only `knock` taught, loud speech or a clap could be taken for a knock. The captions would show `Heard: knock ✓` and a wrong answer, which the player sees. A `background` step is a later decision after real recordings.
- **Web Audio in test Chrome.** The fake audio device may not run the audio clock. The game never waits for the audio clock (a timer is used), so the tests do not depend on it. The sound of the effects itself is a human check (a person listens once, at a normal speaker volume, for loudness and unpleasantness).
- **Real microphone behaviour is untested here.** The stand-in shows logic, not recognition. A person must run the human check before the app is shown in a video.
- **The Edison sentence** must stay light. A person reads it in the story review.

## Later decisions (not in this task)
1. **`glass`.** Waits for experiment E1 (can a glass tap and a wood knock be told apart on a laptop microphone). If E1 says yes, the work is: teach a second label `glass` in the same dialog flow, add a `glass` handler to the `question` mode, and let the spirit use a different caption and line when `ears.labels` has `glass`. The modes stay two, and the patterns stay at most as many as the grammar can answer without waiting more. Until then the app has one sound, and no text, test or document says otherwise.
2. **A `background` step** (talking near the table), decided after real recordings.
3. **Stored progress and a stored mute.** A player cannot keep their place across a reload.
4. **A "Stop microphone" control** that calls `ears.stop()`.
5. **More stories** and a story chosen at random.
6. **Ultrasound** (the idea of a scare when someone walks up). Not planned.
7. **A debug view** (`debug: true` behind a URL parameter) for the human check.

## Measured values (the implementer fills these in)
- Start (step 1.1): the system clock time with zone, and the base commit hash, written before the first change. The end is the final commit, read from `git log` by the operator. No duration in hours.
- Facts of the Introduction that differed from the code, if any.
- Whether the JSON import type-checks in `tsconfig.web.json`, and the choice that followed.
- The parameters of `SYNTH_CLASSES.low` and the result of the Node check of the fixture.
- What the teach dialog draws with `--tokk-bg`, `--tokk-fg` and `--tokk-accent`, and the contrast of each pair.
- Before and after: the vitest count, the Playwright count and the runtimes.
- The wiring lines from `npm run count:wiring` for `apps/knock-once` (and `apps/hands-free`, which must still be 17).
- The size of `apps/knock-once/dist/app.js` (minified) and of the app in `site/`.
- The measured handling times of the fixture (the last teaching knock to the start screen ready; the summon match to the first question; the yes match to the next question) and the gap values that follow.
- The offset between `micStartMs` and the true start of the stream, the measured start and end of the paused window after the yes and the position of the decoy in it.
- The delays of requirement 6.2 as measured by U2.
- The ectoplasm: the highest and the lowest `data-level` of E3 and the thresholds.
- The words of each question and ending, and the result of the reading checklist.
- The contrast ratios of the style colours and of the theme colours.
- The peak sum of each effect recipe in dBFS.

### Recorded
- **Start (1.1):** 2026-11-20 19:26:41 +09:00 (system clock), base commit `e7d5083` (feat: add Hands-Free app).
- **Before (1.2):** `npm test`: 55 files, 926 passed, 2 todo, 1 failed (`test/kiro-config.test.ts` A9: "not listed: task-23-knock-once", the new spec folder, which step 3.2 lists), 67.9 s. The three type checks, `npm run build` and `npm run check:public-api` pass. `npm run count:wiring`: `apps/hands-free` 17, `examples/hello` 7. `npm run test:web`: 52 tests, 51 passed and 1 failed (`site.spec.ts` "the hello example works under /tokk/", the pattern line came 0.8 s late), 7.0 min; the same file alone passed 5 of 5 straight after, so it is recorded as a timing flake of an existing test, not touched.
- **Facts of the Introduction (1.3):** all hold. `pause()` sets a flag in the worklet (`web/worklet-source.ts`), which then forwards no sample, so input made while paused is dropped (requirement 11 holds). `pause()` and `resume()` return early while `teaching` is true, which is only while the dialog records: after Save the dialog's saved screen is open with `teaching` false, so handlers and `onEvent` run again there (the app's flow is still `teaching` then, so its handlers do nothing). `web/index.ts` exports `listen` and the types `MatchEvent`, `EngineEvent` and `Envelope`. A match's `t` is the start time of the last sound of the pattern (`core/grammar.ts` `fire`); the engine dispatches inside `push`, so a test observes the stream time at the handler as the samples pushed so far divided by the sample rate.
- **The teach dialog (1.3):** with the theme it draws `--tokk-fg` text on `--tokk-bg` (also the buttons, which have a `--tokk-fg` 1 px border on `--tokk-bg`), `--tokk-accent` only as the `accent-color` of the progress bar on `--tokk-bg` and as the thumbnail waveform on the fixed canvas background `#0d1117`. No text sits on the accent. U9 checks those three pairs.
- **JSON (1.4):** `tsconfig.web.json` (moduleResolution `bundler`) type-checks `import story from '../story.json'` with no config change (checked with a throwaway config outside the repository), and esbuild bundles JSON by default. Choice of requirement 3.7: **import**, no `fetch`.
- **`SYNTH_CLASSES.low` (1.4):** centre 300 Hz, bandwidth 150 Hz (0.5 of the centre), decay 120 ms, duration 360 ms (3 decays, under the 400 ms cap).
- **Class of the stand-in (4.3, changed from `low` to `mid`):** with `low` the Segmenter makes a 400 ms segment of each knock, longer than any consecutive gap (below 350 ms). In a quick pair the second onset cuts the first segment at 250 ms, and that shorter segment is classified unknown (Node probe: `0, 250` gave one knock event at the second knock and one unknown at the first). No consecutive gap can avoid this, so the next class was taken: `mid` (centre 1200 Hz, bandwidth 600 Hz, decay 60 ms, duration 180 ms, a 220 ms segment) gives one knock event per knock for one knock, a quick pair and the summon sequence. It is still a short, dull, band-limited impact; it is higher than a real table knock, which the human check covers.
- **Dead-link warning (1.4):** no test expects the warning for the real `apps/` folder. `test/build-site.test.ts` S7 expects it for a temporary folder with only `hands-free` and keeps it. `test/web/hands-free.spec.ts` E6 only builds (a comment names the warning; it is not an expectation and is not changed).
- **The Node check of the fixture (5.1):** passes with the `mid` stand-in: 10 teaching segments; in `start` one `knock knock _ knock` at the third summon knock and nothing for the lone knock; in `question` `knock` at the yes knock, `knock` at the decoy (an engine that is not paused hears it) and `knock knock` at the second no knock; the same three with all three patterns in one mode; every knock present in the written file. The WAV is 54.38 s, 5,220,524 bytes, in the ignored `test/web/generated/`.
- **U2 delays (6.6), pushes of 20 ms:** two modes: yes 365 ms after `m.t` (the grammar's own wait after the knock's sound event 140 ms), no 235 ms after `m.t` (grammar wait 0 ms), summon 235 ms (grammar wait 0 ms). All three patterns in one mode: yes 365 ms, no 1015 ms after `m.t` (grammar wait 780 ms). The 235 ms is the time the Segmenter needs to close the 220 ms segment of the knock, so "no fires within one push step" holds for the grammar's wait (handler time minus the stream time of the knock's sound event), which is what U2 asserts; the delays from `m.t` are asserted as the design's table says (yes at least 350 ms; no in one mode above 350 ms and at most 1000 ms plus one push step and a 1 ms rounding allowance).
- **Wiring (8.3, 12.4):** `apps/knock-once` 19 counted lines (target 20); `apps/hands-free` still 17; `examples/hello` 7.
- **Sizes (8.4, 12.3):** `apps/knock-once/dist/app.js` 118,451 bytes minified (it holds the bundled library and Worker). The app in `site/`: `index.html` 7,136, `story.json` 1,604, `dist/app.js` 118,451, together 127,191 bytes; the whole site 498,148 bytes in 11 files.
- **Handling times of the fixture (10.1):** the last teaching Done to the start screen ready 211 ms (gap A 12,000 ms); the summon effect started 265 ms after the third summon knock and the first question followed after the 2,000 ms effect (gap C 8,000 ms, so the question was drawn about 5.7 s before the yes knock); the paused window after the yes ended about 1.5 s after the yes knock (gap D 8,000 ms after the decoy). Every gap is more than twice the measured handling, so the first values stay.
- **Clock and decoy (10.1, four runs):** offset of the lone knock's level rise from `micStartMs` plus its stream time 44.6 to 54.4 ms (limit 100 ms; it includes the audio graph, one 20 ms envelope message and one frame). Paused window after the yes, in stream time: 39,437 to 40,554 ms; the decoy at 39,950 ms lies 496 to 513 ms after the start and 598 to 604 ms before the end (margin 250 ms). The decoy made no caption and no answer in every run.
- **Ectoplasm (10.2):** the highest `data-level` in the 400 ms after each heard knock: 0.33 to 0.51; the quiet window (3 to 6 s after the lone knock): 0.000. The thresholds stay at 0.1 for a knock and 0.02 for quiet.
- **Contrast (U9, U7):** page text on the room 15.7, text on a button 13.0, candle on the room 12.2, ectoplasm on the room 14.0, button border on the button 7.4 and on the room 8.9, focus outline on the room 14.7 and on a button 12.2; dialog text on `--tokk-bg` 14.9, accent on `--tokk-bg` 8.4, accent on the thumbnail background 8.5.
- **Effect recipes (U6):** worst-case peak sums: summon -20.4 dBFS, between -26.9 dBFS, ending -22.4 dBFS (limit -14). The first values are kept. The long voices fade in over 240 ms and out over 400 ms (four and two times the least fades). The listening check of step 9.3 was not done: the implementer has no speakers in this session, so the loudness and the feel of the effects are not judged yet.
- **The story (7.2):** q1 "Is the room colder now than when you sat down?"; q2 "Did the clock on the wall stop ticking a moment ago?"; q3 "Did you come into this room alone tonight?"; q4 "Is the candle flame leaning toward the empty chair?"; q5 "May I write my name in the dust on the table?"; q6 "Can you hear a second breath in the room, slow and quiet?"; q7 "Will you leave the small lamp in the window burning for me?"; q8 "Shall I open the door that was locked when you came in?"; endings `lamp` "The lamp stays lit", `door` "The door is open", `chair` "The empty chair". The implementer's own reading against the checklist: original sentences, no brand, person or place in the story (Edison only on the entrance), no violence, injury, body or blood, no advice, each question plain and under 140 characters (longest 59), three different outcomes. The operator's reading is still to come, so step 7.2 is not marked done.
- **Other differences from the design:** the captions list scrolls itself with `scrollTop` instead of `scrollIntoView`, because `scrollIntoView` also scrolls the page to the list when the list is below the fold. The state line and the "Teach again" button follow the flow state `between`, not the runner's busy flag (the busy flag is still set when `unlock` redraws, which left "Listening is paused" on screen; seen in the first screenshot, now asserted in E1). At 320 px width the ending text ran 14 px past the 15rem room and was clipped (step 12.1, a check by hand at 320, 500 and 1000 px): below 40rem the room now grows with its text and the question sits between the candle and the ribbon, with no sideways scroll at 320 px or at 500 px (1000 px at 200 per cent zoom). Because of the state-line fix, the screenshot was written twice with `TOKK_WRITE_SCREENSHOT=1`, once before it and once after it (the 320 px rule does not change the 1000 px layout).
- **Before and after (12.5):** `npm test` 926 passed, 2 todo, 1 failed (67.9 s) before; 1009 passed, 2 todo, 66 files (67.9 s) after. `PBT_RUNS=1000 npm test`: 1009 passed (606.7 s). `npm run pbt:quick`: 144 passed, 2 todo. `npm run test:web`: 52 tests (51 passed, 1 timing flake of `site.spec.ts`, 7.0 min) before; 59 passed twice (7.9 min each) after.
