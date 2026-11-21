# Design: Task 34, app Click Talk

## Layout
```
apps/click-talk/src/constants.ts     numbers, units in the names                          [run A]
apps/click-talk/src/phrases.ts       Category, CATEGORIES, validPhraseCount, Frequent     [run A]
apps/click-talk/src/board.ts         BoardState, BoardInput, INITIAL_BOARD, reduce        [run A]
apps/click-talk/src/patterns.ts      PATTERNS, patternsFor, inputForPattern, settleBurst  [run A]
apps/click-talk/src/settings.ts      Settings, load/save, editPhrases, countSaid          [run A]
apps/click-talk/src/speech.ts        VoiceLike, pickVoice, NO_VOICE_TEXT                  [run A]
apps/click-talk/src/keys.ts          actionForKey                                         [run A]
apps/click-talk/src/teach-texts.ts   English copy                                         [run A]
apps/click-talk/sounds/<sound>/*.wav synthesized teaching files, local only               [run A]
apps/click-talk/sounds.json          feature vectors of click and pop                     [run A]
test/helpers/click-talk-sounds.ts    recipe of the synthesized sounds                     [run A]
test/click-talk-{board,settings,speech,keys,teach,events}.test.ts                         [run A]
apps/click-talk/index.html, src/{main,view,alarm,caregiver}.ts, speak() in speech.ts, style.css  [run B]
test/web/click-talk.spec.ts, test/web/click-talk-fixture.ts                               [run B]
```
The files of run A import nothing from the DOM, Web Audio, speech or `tokk`.

## Board (board.ts)
- `category` is the frame on the category board and the open category on a phrase board. `index` is 0 on the category board; on a phrase board 0 is Back and `n` is phrase `n - 1`. So the scan cycle of a phrase board has `phrases + 1` cells and Back is first. `said` is set only in `speaking`.
- `from` is the one field beyond the task's list. It holds the screen help returns to (`categories` or `phrases`), set when help starts and cleared when it ends. The frame (`category`, `index`) is untouched by help, so `stopHelp` brings back the same frame.
- `choose` on the category whose `id` is `help` starts help with `from: 'categories'`. On stop the frame is on Help.
- **Help while speaking:** the app cancels the speech, so the board goes to `help` with `said: null` and `from: 'categories'`; it does not return to `speaking`. A `spoken` that arrives late during help is ignored.
- **Ignored input (Review Focus 3):** in `speaking` only `spoken` and `help` do anything. In `help` only `stopHelp` does. Run B also calls `ears.pause()` around speech and alarm.
- **`said` after `spoken`:** it becomes `null`. The last said phrase for the Frequent board is kept by the app (run B, `countSaid` plus a variable). After a reload the Frequent board starts with the most used phrases and no "Last said" cell content.
- **Frequent with no phrases:** the phrase board has only Back, and `next` stays on Back. The view shows `Phrases you use often will show here.`
- `reduce` takes the categories as an argument. The app builds them each time with `withFrequent(settings.phrases, settings.counts, lastSaid)`, so the other categories are the caregiver's lists unchanged.

## Frequent (phrases.ts)
`frequentPhrases(counts, lastSaid)`: last said first, then phrases by count, descending, ties alphabetical, each once, at most 8 (a full 4 x 2 board). Counts of 0 are skipped. The task says "top 8, first cell Last said"; this design makes the first cell the last said phrase and lets it take one of the 8 places.

## Patterns and the two-pop rule (patterns.ts)
`PATTERNS` is data; `patternsFor(mode)` gives the keys, in the order of the table, for `listen({ modes })`. Run B maps each fired pattern with `inputForPattern`.

**What the grammar gives for `pop pop` with `['click', 'pop', 'pop pop pop']`** (checked in `test/click-talk-events.test.ts`, matches `[]`): nothing. After the first pop the matcher waits, because `pop pop pop` could follow. The second pop extends the pending sequence. When 350 ms pass without a third pop, `fire` looks for a pattern of exactly two pops, finds none, and drops both pops. The same happens in one-sound mode with `click click` (matches `[]`). One pop is fine: it fires `pop` after the wait. Three pops fire `pop pop pop` at once, and nothing else.

**How run B makes it one `choose`:** `onEvent` gets every sound event with its time `t` in seconds (`t` = samples / sample rate). Run B keeps the times of the `pop` events of the current burst (`click` in one-sound mode), clearing the list when a pop starts a new burst (gap of 350 ms or more, see `settleBurst`). After each `pop` event it starts one timer of `BURST_GAP_MAX_MS` plus a small margin. When the timer ends it calls `settleBurst(times, nowS)`, where `nowS` is the time of the latest audio the page has seen (the `t` of the newest event or envelope bin, not the wall clock). Results: `wait` (a third pop may still come: re-arm), `choose` (send one `{ type: 'choose' }`, clear the list), `none` (clear the list; the grammar already handled one pop or three pops). A third pop cancels the timer. A `pop pop pop` match and a `pop` match come from the grammar as usual. `settleBurst` is the whole rule and is tested as a pure function: no sound, one pop, two pops then silence (`choose`), the `wait` window, three and four pops (`none`), only the last burst counts, two pops far apart (`none`), a gap of exactly 350 ms starts a new burst.
Four pops give the help pattern and then one `pop`, which the grammar also reports; the board ignores a `choose` during `help`.

Limit: the limit of the burst is the grammar's `GAP_CONSECUTIVE_MAX_MS` (350 ms) with the grammar's tolerance (1e-6 ms). `BURST_GAP_MAX_MS` in `constants.ts` repeats it because an app cannot import `core/`; a test keeps the two equal.

## Settings (settings.ts)
Stored key `click-talk:settings` (`SETTINGS_KEY`). `saveSettings` is `JSON.stringify`. `loadSettings` reads every key on its own: a wrong type or a number outside its range (`scanMs` 500 to 5000, `rate` 0.5 to 2) takes the default. `voiceURI` is any string or null. `onlineVoices` is true only for the value `true`. Phrases: the four phrase categories are matched by `id` against the defaults; a list that is not 6 or 8 non-blank strings is dropped and the default list is used (the "last valid list" at load time). Frequent and Help always have empty lists. Counts keep whole numbers of 0 or more and skip the key `__proto__`. `editPhrases` does the same for a live edit, with the previous list as the last valid one, and returns the caregiver message as `error`.

## Speech (speech.ts)
`pickVoice` takes `readonly VoiceLike[]` (structural: `voiceURI`, `name`, `lang`, `localService`), so a real `SpeechSynthesisVoice` fits. With `onlineVoices` false the list is first reduced to `localService === true`, so a network voice is never picked, also not by `voiceURI`. English is `en`, `en-US`, `en_GB` and so on. `speak()` is run B.

## Keys (keys.ts)
`actionForKey(key, { mode, level })` gives `{ type: 'sound', sound }` (run B sends `inject(sound)`), `{ type: 'stopHelp' }`, or null. Decision: in one-sound mode only Enter is `click`, as written in the task; Space is left to the browser. If a one-switch device sends Space, run B or the operator may want Space there too (one line in `keys.ts` and its test).

## Copy (teach-texts.ts)
`WELCOME_TEXT`, `MODE_TEXT`, `TEACH_LINE` (the `record` text of each sound, with the 10 in the sentence), `BACKGROUND_LINE` (the `recordBackground` text), all from section 5. A test reads `click-talk.md` when it is present and checks every line against it; without the file the test is skipped.

## Sounds
Click is the `high` impact class of `core/synth` and pop is the `mid` class, at -6 dB over a -75 dBFS noise bed, 16 kHz (`SYNTH_FIXTURE_SAMPLE_RATE_HZ`). Ten copies per file, 800 ms apart. They are a stand-in, not a mouth. `apps/click-talk/sounds.json` is built with `npm run sounds:rebuild apps/click-talk/sounds`. Leave-one-out accuracy is 1.00 for both, no confused pair.
Pop first used the `ring` class (200 ms decay): two ring pops 250 or 300 ms apart ran into each other and the second came out `unknown`. The `mid` class (60 ms decay) separates cleanly. Burst recordings use 300 ms between starts, inside the consecutive range (below 350 ms). A real lip pop is short, so this is a property of the stand-in only.
Test recordings are written to a temporary folder and deleted.

## Constants and the units rule
The rule names `core/constants.ts`, and this task may not change `core/`. The app keeps `apps/click-talk/src/constants.ts`, as the earlier apps do. Every time is in ms (`_MS`), `rate` is a factor (`_FACTOR`).

## Run B (not done in run A)
Requirements 19 to 24. Notes for the builder:
- The tokk block of `main.ts` starts the first run with `teach('click')`, `teach('pop')` (two sounds), then `teach('background', { backgroundMs: BACKGROUND_TEACH_MS })`.
- Voices load late in Chrome: read `speechSynthesis.getVoices()` again on `voiceschanged` before concluding that no voice exists.
- The one-sound `tick` timer must stop while `speaking` and `help`, and must restart on `spoken` and `stopHelp`.
- Browser tests need a fake `speechSynthesis` that records what was spoken.

## Measured values
- Baseline before run A: see tasks.md.
- Leave-one-out accuracy of the synthesized sounds: 1.00 for both.

## Changes outside apps/click-talk in run A
- `docs/kiro.md`: one row for this spec (test A9 lists every spec).
