# Requirements: Task 33, app Shoo! (sound defense game)

## Introduction
Shoo! is a five-minute Halloween game for one or a few players at a laptop. Monsters walk down a path to a porch. Each kind runs from one sound: a tongue click, a clap, a knock or a lip pop. The kind of sound is the weapon, so the game shows what Tokk does: it tells taught sounds apart. The last monster, the Grave Warden, runs only from a rhythm, `knock knock _ knock`.

The task is split into two runs.
- **Run A (this spec, first run):** the spec, the pure game rules in `apps/shoo/src/` and their tests, the synthesized sounds for Node tests, and the `expectEvents` tests.
- **Run B (later):** the screen, the audio, the Tokk wiring, the browser tests and the tuning by play.

Sources: plan `2026-11-22-tokk-redesign.md` (Global Constraints, Review Focus, Task 33), `apps/redesign.md` 5.3, `apps/shoo.md` (approved copy), `apps/mockups/shoo.html` (approved look). All in `docs/_planning/`, which is not part of the repository.

Facts used (checked in `web/listen.ts` and `node/expect.ts`):
- `ears.inject(label)` makes an app-made sound go through the same patterns as a microphone sound. `source: 'keys'` starts `listen()` without a microphone. `onError` gets a `TokkError` when the microphone is denied or lost.
- `expectEvents(wavPath, expected, { sounds, patterns?, matches? })` runs a recording through the engine with one pattern set and checks the sound names and the fired patterns.
- A pattern that is the prefix of a longer pattern waits for the longer one. Consecutive sounds are less than 350 ms apart (`GAP_CONSECUTIVE_MAX_MS`), a rest `_` is 350 to 1000 ms, both start to start.

## Terms
- **Sound:** one of `click`, `clap`, `knock`, `pop`. The label of an event is a sound, `unknown` or `background`.
- **Kind:** `bat`, `ghost`, `skeleton`, `pumpkin`, `warden`.
- **Phase:** `room`, `intro`, `battle`, `between`, `paused`, `lost`, `won`.

## Requirements

### Run A: rules (pure code)
1. **Monsters.** `MONSTERS` holds, per kind, the weak sound and the hit points: bat `click` 1, ghost `clap` 1, skeleton `knock` 2, pumpkin `pop` 1, warden `rhythm` 3. `BOSS_PATTERN` is `knock knock _ knock`.
2. **Waves.** `WAVES` has five entries `{ kinds, count, speed }`. Wave 1 has bat, wave 2 adds ghost, wave 3 adds skeleton, wave 4 adds pumpkin, wave 5 adds warden. Every wave lists all earlier kinds. Start values (tuned by play in run B): counts 6, 10, 14, 18, 14; speed in path fractions per second 0.07, 0.08, 0.09, 0.10, 0.10; one spawn every 2.2 s in wave 1 down to 1.4 s in wave 5. Wave 5 has exactly one warden, it spawns first and walks at half speed. `newKinds(wave)` lists the kinds that appear first in that wave.
3. **State.** `GameState` has `phase`, `wave`, `lives` (start 3), `monsters`, `shooed`, `lastHeard`, and the spawn fields (queue, spawn timer, ids) and a seed. A `Monster` is `{ id, kind, hp, y }`, `y` from 0 (top of the path) to 1 (porch).
4. **Sounds hit.** In `battle`, a sound hits the one monster whose weak sound equals it and whose `y` is largest: `hp` minus 1; at 0 the monster is removed and `shooed` rises by 1. A sound with no such monster leaves the monsters unchanged. Every sound heard in `battle` sets `lastHeard`, except `unknown`, which sets `'?'`. `background` is ignored.
5. **Boss pattern.** `BOSS_PATTERN` hits the warden the same way. Three hits remove it. In wave 5 a single `knock` still hits a skeleton.
6. **Ticks.** `tick` moves every monster by its speed and spawns from the queue on the wave's timer. A monster with `y >= 1` is removed and costs one life. Lives at 0 give `lost`. An empty wave with an empty queue gives `between`, or `won` after wave 5.
7. **Ignored input (Review Focus 3).** `sound`, `pattern` and `tick` change nothing in `paused`, `intro`, `between`, `room`, `lost` and `won`. The app makes sounds in `intro` and `between`, so what the microphone hears then must not count.
8. **Flow inputs.** `roomDone` leaves `room` for `intro`. `introDone` leaves `intro` for `battle`. `nextWave` leaves `between` for the `intro` of the next wave. `pause` and `resume` work between `battle` and `paused` only. `restart` works in every phase and returns the start state.
9. **Determinism.** Spawn order comes from a small seeded generator kept in the state. `reduce` is pure and does not change its input. The same seed gives the same spawn order.
10. **Hit report.** `reduceWithHit(state, input)` returns `{ state, hit }`. `hit` names the monster that was hit and whether it was removed, or why nothing was hit (`unknown` or `no-target`), or is `null` when the input did nothing of this kind. `reduce` returns only the state.
11. **Mode.** `modeFor(state)` is `boss` in wave 5 during `battle`, otherwise `battle`.
12. **Keys.** Keys `1` to `4` map to click, clap, knock, pop in keys mode. `Escape` toggles pause. Modifier keys and text fields are ignored. The mapping is a pure function.
13. **Copy.** `teach-texts.ts` holds the English copy of `shoo.md` section 5: the intro line and the teach line per kind and per sound, the room text and the wave labels. Every sound has a teach text. The teach lines pass the library's text check.
14. **Sounds for Node tests.** `apps/shoo/sounds/{click,clap,knock,pop}/` hold synthesized teaching WAV files (ten sounds each, `core/synth` impact classes), and `apps/shoo/sounds.json` holds feature vectors only, built from them by `npm run sounds:rebuild`.
15. **Event tests.** With `expectEvents` on recordings made from those sounds: the four sounds in order give their labels in order; a boss rhythm recording with `patterns: [BOSS_PATTERN]` gives `matches: [BOSS_PATTERN]`; two knocks give no pattern.

### Run B: app (later)
16. **Folder rules.** `apps/shoo/` follows `apps/README.md`: entry `src/main.ts`, `index.html` loads `./dist/app.js`, the Tokk code sits between `// tokk:start` and `// tokk:end`, the app imports from `'tokk'` only, every URL is relative, no external request.
17. **Screen.** The screen follows the approved mockup and the copy of `shoo.md`. Hits show the four-step effect of `shoo.md` 3.1, drawn apart from the state. With `prefers-reduced-motion` the effects are static and monster movement stays.
18. **Wiring.** `listen({ storageKey: 'tokk:shoo', modes: { battle: {}, boss: { [BOSS_PATTERN]: hit } }, mode: 'battle', onEvent, onError })`. First run teaches `background` for 30 s, then each wave's `newKinds` sound that `ears.labels` lacks. Microphone failure or loss shows the card and switches to `source: 'keys'` with `1` to `4` as `inject(sound)`.
19. **Audio out.** The app's own sounds are generated with Web Audio. `ears.pause()` runs before and `ears.resume()` after each effect that plays during `intro` and `between`.
20. **Browser tests.** First run teaching, a full wave, a missed monster, the boss rhythm, game over and again, `keys-only`, `mic-lost`, `returning`, widths 320 and 1280 px.
21. **Tuning.** Counts, speeds and spawn times are tuned by play, and the final values are recorded in `design.md`.

### Rules that hold for both runs
22. English only. No audio leaves the device. Only feature vectors are stored, never in `sounds.json` as samples; original recordings stay in the local `sounds/` folders.
23. Every threshold and time constant is in ms, Hz or dB with the unit in the name. No hard-coded sample count: derive it from the sample rate and a constant. Every time `t` is a cumulative sample count divided by the sample rate.
24. Run A changes nothing in `core/`, `web/`, other apps, the site or `docs/_planning/`. No push, no publish.
