# Requirements: Task 34, app Click Talk (two-sound communication board)

## Introduction
Click Talk is a communication board (AAC) for people who cannot speak or use their hands, for example after a stroke or with ALS. At a laptop in front of a bed or wheelchair, a tongue click moves a frame over large cells and a lip pop chooses. The laptop then says the chosen phrase with a voice on the device. A caregiver sets it up. A one-sound mode scans by itself and uses a click to choose. A Help cell and the pattern `pop pop pop` start a loud red alarm screen.

The task is split into two runs.
- **Run A (this spec, first run):** the spec, the pure rules in `apps/click-talk/src/` and their tests, the synthesized sounds for Node tests, and the `expectEvents` tests.
- **Run B (later):** the screen, speech, alarm, caregiver settings screen, Tokk wiring and the browser tests.

Sources: plan `2026-11-22-tokk-redesign.md` (Global Constraints, Review Focus, Task 34), `apps/redesign.md` 5.2, `apps/click-talk.md` (approved copy, section 5, and the sound table, section 4), `apps/mockups/click-talk.html` (approved look). All in `docs/_planning/`, which is not part of the repository.

Facts used (checked in `web/listen.ts`, `node/expect.ts` and `core/grammar.ts`):
- `ears.inject(label)` makes an app-made sound go through the same patterns as a microphone sound. `source: 'keys'` starts `listen()` without a microphone. `onError` gets a `TokkError` when the microphone is denied or lost. `TeachOptions.backgroundMs` sets the length of the room recording.
- `expectEvents(wavPath, expected, { sounds, patterns?, matches? })` runs a recording through the engine with one pattern set and checks the sound names and the fired patterns.
- A pattern that is the prefix of a longer pattern waits for the longer one. Consecutive sounds are less than 350 ms apart (`GAP_CONSECUTIVE_MAX_MS`), a rest `_` is 350 to 1000 ms, both start to start.

## Terms
- **Sound:** `click` or `pop`. The label of an event is a sound, `unknown` or `background`.
- **Mode:** `two` (click moves, pop chooses) or `one` (the frame moves every `scanMs`, click chooses).
- **Level:** `categories`, `phrases`, `speaking`, `help`.
- **Burst:** sounds of one label that follow each other less than 350 ms apart, start to start.

## Requirements

### Run A: rules (pure code)
1. **Categories.** `CATEGORIES` has six entries `{ id, title, phrases }` in the order Needs, Body, People, Talk, Frequent, Help, with the default phrases of `click-talk.md` section 5 (Needs 8, Body 8, People 6, Talk 8). Frequent and Help have no stored phrases: Frequent is built from counts, choosing Help starts the alarm.
2. **Phrase count.** `validPhraseCount(n)` is true only for 6 and 8 (a 3 x 2 or 4 x 2 board without an empty cell). The caregiver message is `Each category holds 6 or 8 phrases. Add one more or remove one.`
3. **Board state.** `BoardState` has `level`, `category`, `index`, `said`, and `from` (the screen to return to from help). `reduce(state, input, categories)` is pure and does not change its input.
4. **Category board.** `next` moves the frame through the six categories and wraps. `choose` opens the phrase board with the frame on Back, or starts help on the Help category.
5. **Phrase board.** The scan order is Back first, then the phrases, then it wraps. Choosing Back returns to the category board with the frame on the same category. Choosing a phrase gives `speaking` with `said` set to the phrase. `spoken` returns to the category board.
6. **Help.** The input `help` gives `help` from the category board, the phrase board and `speaking`. `stopHelp` returns to the screen before it (category or phrase board, same frame). Help from `speaking` returns to the category board and drops `said`.
7. **Ignored input (Review Focus 3).** `next`, `choose`, `tick` (and `help` itself) change nothing while `speaking` (except `help`) and `help`. A late `spoken` does not leave `help`.
8. **Tick.** `tick` moves like `next`. One-sound mode sends it every `scanMs`.
9. **Frequent.** `frequentPhrases(counts, lastSaid)` gives the last said phrase first, then the most used, each once, at most 8, ties in alphabetical order. With nothing said it gives `[]` and the board shows `Phrases you use often will show here.` The order and content of the other categories never change, whatever the counts.
10. **Patterns.** `PATTERNS` is data: two-sound `{ click: 'next', pop: 'choose', 'pop pop pop': 'help' }`, one-sound `{ click: 'choose', 'click click click': 'help' }`. `patternsFor(mode)` lists the patterns of a mode; `inputForPattern(mode, pattern)` gives the board input.
11. **Two pops then silence.** The grammar gives no match for `pop pop` with the two-sound set (it waits for a third pop, then nothing is exactly two). The pure function `settleBurst(timesS, nowS)` says `wait`, `choose` or `none`, so that two pops then silence end as exactly one `choose`. One pop is left to the grammar, three pops are the help pattern.
12. **Settings.** `Settings` has `mode`, `scanMs`, `voiceURI`, `rate`, `onlineVoices`, `phrases`, `counts`. `loadSettings(text | null)` and `saveSettings(settings)` are pure, for the localStorage key `click-talk:settings`. Defaults: mode `two`, `scanMs` 1500, `onlineVoices` false, `rate` 1, `voiceURI` null, the default phrases. Missing or wrongly typed keys take the defaults. Broken JSON gives the defaults and throws or warns nothing. A category whose list is not 6 or 8 non-blank phrases keeps the last valid list. Titles, ids and order cannot be changed by stored text. Settings hold text, numbers and flags only.
13. **Editing.** `editPhrases(settings, id, phrases)` refuses a list that is not valid with the caregiver message and keeps the last valid list. `countSaid` adds one to the count of a phrase.
14. **Voice.** `pickVoice(voices, settings)` returns null for `[]`. With `onlineVoices` false only voices with `localService === true` are allowed. Order: the chosen `voiceURI`, an English local voice, any local voice, then (online voices on) an English network voice and any voice. The voice type is structural, so Node tests need no DOM (Review Focus 5). The notice text is `No offline voice on this device. Phrases are shown on screen only.`
15. **Keys.** In two-sound mode Space is `click` and Enter is `pop`. In one-sound mode Enter is `click` and Space does nothing. In `help` any key except a lone modifier stops the alarm. Modifier combinations and text fields are ignored outside help. The mapping is a pure function.
16. **Copy.** `teach-texts.ts` holds the English copy of `click-talk.md` section 5: the welcome text, the mode text, the teach line of `click` and `pop`, and the 30-second room line. The lines pass the library's text check.
17. **Sounds for Node tests.** `apps/click-talk/sounds/{click,pop}/` hold synthesized teaching WAV files (ten sounds each, `core/synth` impact classes), and `apps/click-talk/sounds.json` holds feature vectors only, built from them by `npm run sounds:rebuild`. Recordings stay in these local folders.
18. **Event tests.** With `expectEvents` on recordings made from those sounds: two-sound set, one pop gives `['pop']`; three pops give only `['pop pop pop']`; two pops give no match (the grammar) and `settleBurst` turns them into one choose. One-sound set: one click gives `['click']`, three clicks give only `['click click click']`.

### Run B: the app (not done in run A)
19. **Screen.** `index.html`, `style.css` and `view.ts` copy the approved mockup: category colours, scan frame, preview line, sound bar, speaking screen with the 3 s bar, full-screen red help screen that does not flash, welcome and mode screens, light and dark theme, `prefers-reduced-motion`. Cell text 28 px or more, scan frame 6 px or more, contrast AA.
20. **Speech.** `speak(text, settings)` uses `speechSynthesis` with the voice from `pickVoice`. Without a voice it resolves at once, the phrase is shown for 3 s, and `No offline voice on this device` is shown once.
21. **Alarm.** `alarm.ts` makes the repeating alarm sound with Web Audio (no audio file). Any key or click stops it.
22. **Caregiver screen.** `caregiver.ts`: a `Settings` text button (mouse and keyboard) with mode, scan speed, teach again, voice, speaking speed, online voices (off, with the explanation), phrase lists with Add, Edit and Remove, a refusal with the caregiver message, test the alarm, the not-a-medical-device note, Back to the board.
23. **Tokk wiring.** `main.ts` with the tokk block: `listen({ storageKey: 'tokk:click-talk', modes: { two, one }, mode, onEvent, onError })`, the first-run flow (welcome, mode, `teach('click')`, `teach('pop')` for two sounds, `teach('background', { backgroundMs: 30000 })`), `ears.pause()` and `ears.resume()` around speech and alarm, the `settleBurst` timer for two pops, one-sound `tick` every `scanMs`, and on a microphone error a card plus `source: 'keys'`.
24. **Browser tests.** Two-sound flow with a fake `speechSynthesis`, one-sound auto scan, help pattern and Help cell, `keys-only`, `mic-lost`, `returning`, widths 320 and 1280 px, no offline voice.

## Rules for every run
- English only. Never send audio over the network. `sounds.json` holds feature vectors only. Original recordings stay in the local `sounds/` folders.
- Every threshold and time constant is in ms, Hz or dB with the unit in the name. Times `t` are sample counts divided by the sample rate, in seconds.
- Do not change `core/` or `web/`. The files of run A import nothing from the DOM, Web Audio, speech or `tokk`.
