# Design: Task 33, app Shoo!

## Layout
```
apps/shoo/src/constants.ts      numbers of the rules, units in the names          [run A]
apps/shoo/src/monsters.ts       SoundId, Kind, MONSTERS, BOSS_PATTERN             [run A]
apps/shoo/src/waves.ts          WAVES, newKinds, spawnIntervalMs                  [run A]
apps/shoo/src/game.ts           GameState, reduce, reduceWithHit, modeFor         [run A]
apps/shoo/src/keys.ts           actionForKey                                      [run A]
apps/shoo/src/teach-texts.ts    English copy                                      [run A]
apps/shoo/sounds/<sound>/*.wav  synthesized teaching files, local only            [run A]
apps/shoo/sounds.json           feature vectors of the four sounds                [run A]
test/helpers/shoo-sounds.ts     recipe of the synthesized sounds                  [run A]
test/shoo-{monsters,waves,game,keys,teach,events}.test.ts                         [run A]
apps/shoo/index.html, src/{main,view,audio}.ts, src/style.css                     [run B]
test/web/shoo.spec.ts, test/web/shoo-fixture.ts                                   [run B]
```
The files of run A import nothing from the DOM, Web Audio or `tokk`.

## Rules (game.ts)
- `reduce` is a total function over phase and input. Only `battle` accepts `sound`, `pattern` and `tick`, so what the microphone hears while the app plays an intro or between-waves effect cannot change the game (Review Focus 3). Run B also calls `ears.pause()` around those effects.
- Phases: `room` -(roomDone)-> `intro` -(introDone)-> `battle` -> `between` -(nextWave)-> `intro` ... -> `won`; `battle` <-> `paused`; `lost` from any lost life. `restart` works everywhere.
- **Additions to the task's input list:** `roomDone`, `nextWave`, and an optional `seed` on `restart`. The start state is `room`; a returning player or "Play again" sends `roomDone` at once.
- **Settling.** After a hit and after a tick: lives at 0 give `lost` (this wins over an empty wave); an empty path with an empty queue gives `between`, or `won` in wave 5. The hit case matters because the last kill ends the wave without waiting for the next tick.
- **Targeting.** The monster with the largest `y` among those whose weak point equals the sound. The warden's weak point is `rhythm`, so no single sound can hit it, and the pattern `BOSS_PATTERN` hits only it. Any other pattern is ignored.
- **lastHeard.** Set by every sound heard in `battle` (`?` for `unknown`), also when it hits. A pattern does not change it.
- **Spawning.** `introDone` builds the queue of the wave: wave 5 starts with the warden, the rest are drawn from the other kinds of the wave with a seeded mulberry32 whose state (`rngState`) lives in `GameState`. `tick` moves monsters (`speed * dtMs / 1000`, the warden at `WARDEN_SPEED_FACTOR`), removes those with `y >= 1` (one life each), then spawns while the timer is at or below 0 and adds the wave's interval back. The first spawn comes on the first tick.
- **Time.** The game clock is a sum of `dtMs` ticks from the view. No audio time is computed here, so the "t = samples / sampleRate" rule applies in run B only, where the view reads Tokk events.
- **Hit report.** `reduceWithHit` gives `{ type: 'hit', id, kind, sound, removed }` or `{ type: 'miss', reason: 'unknown' | 'no-target', sound? }` or `null`. The view draws the four-step effect from it, apart from the state. `reduce` removes the monster at once.
- **Totals.** `shooed` counts the whole game. "Wave n cleared. N monsters shooed." uses this total (assumption, the doc does not say per wave).

## Waves (waves.ts)
Start values, to tune by play in run B: counts 6, 10, 14, 18, 14; speed 0.07, 0.08, 0.09, 0.10, 0.10 path fractions per second; spawn interval 2200, 2000, 1800, 1600, 1400 ms (equal steps). Each wave's `kinds` is the list of all kinds so far.

## Keys (keys.ts)
`1` to `4` give a sound only in keys mode. `Escape` toggles pause in every mode. Modifiers and text targets are ignored. The view sends `inject(sound)` for a sound action, and `pause`/`resume` by the phase for a toggle.

## Copy (teach-texts.ts)
`INTRO_TEXT` per kind, `TEACH_LINE` per sound (the `record` text of the dialog, with the 10 in the sentence), `ROOM_TEXT` (`title`, `body` as `recordBackground`, `button`), `READY_TEXT`, `waveLabel`. The library's `resolveTeachText` accepts them (tested).

## Sounds
The four sounds are `core/synth` impact classes: click `high`, clap `mid`, knock `low`, pop `ring`, at -6 dB over a -75 dBFS noise bed, 16 kHz (`SYNTH_FIXTURE_SAMPLE_RATE_HZ`, to keep the committed WAV files near 290 kB each). Ten copies per file, 700 ms + 100 ms apart. They are a stand-in, not a hand. `apps/shoo/sounds.json` is built with `npm run sounds:rebuild apps/shoo/sounds` and holds feature vectors only. The sample rate of the model is 16 kHz; run B regenerates a model for the browser fixture at the rate of its fake microphone if the page needs one.
The boss recording has knocks at 0, 250 and 850 ms after the lead (beat 250 ms below `GAP_CONSECUTIVE_MAX_MS`, rest 600 ms inside 350 to 1000 ms). The test recordings are written to a temporary folder and deleted.

## Constants and the units rule
The rule names `core/constants.ts`, and this run may not change `core/`. The app keeps `apps/shoo/src/constants.ts`, as the earlier apps do. Every time value is in ms (or a per-second speed, named `_PER_S`).

## Run B (not done in run A)
`main.ts` with the tokk block of requirement 18; `view.ts` with the effects of `shoo.md` 3.1 from `Hit`; `audio.ts` with generated effects and `ears.pause()`/`ears.resume()` around them; a style and SVG art copied from the approved mockup (`docs/_planning/tokk/apps/mockups/shoo.html`); the browser tests; tuning of counts, speeds and intervals, recorded below.

## Measured values
- Baseline before run A: 75 test files, 1106 passed, 2 todo.
- Leave-one-out accuracy of the synthesized sounds: 1.00 for all four, no confused pair.
- Tuned wave values: unchanged from the start values (counts 6, 10, 14, 18, 14; speeds 0.07 to 0.10 per second; spawns 2200 to 1400 ms). Run B had no person to play, so nothing was tuned by feel. The browser tests only show the pacing: at `?speed=1.5` wave 1 lasts about 17 s from the first spawn to the last escape. Tuning by play stays open for the operator.

## Changes outside apps/shoo in run A
- scripts/count-wiring.ts: an app folder without src/main.ts is not counted (apps/README.md: the entry is src/main.ts). Without this, the logic files alone made a sixth group with 0 lines and broke the wiring tables of the README and integration.md. Once run B adds main.ts, the group appears and those tables need the new row.
- docs/kiro.md: one row for this spec (test A9 lists every spec).

## Run B: the app
- `index.html` holds the SVG art (symbols of the mockup), the HUD and the screens as hidden sections. `src/view.ts` draws a `GameState` and the hit effect; `src/audio.ts` makes three effects (cleared, lost, dawn) with oscillators; `src/main.ts` is the tokk block plus the glue (phase flows, keys, microphone card, pause and settings); `src/test-params.ts` parses the test-only parameters.
- **Style sheet.** `src/style.css` is imported as text (`import styleText from './style.css' with { type: 'text' }`, which esbuild reads as its text loader; no build script changed) and put into a `<style>` at start. The site build copies only `dist/app.js`, so a separate `app.css` would be missing on Pages. `src/css.d.ts` declares the module.
- **Flow.** The title leads to the room card (first run only: no `background` example in the model), the room sound dialog (30 s, `backgroundMs`; the text of `ROOM_TEXT`), the intro of each wave (the new monster large; the dialog for its sound if `ears.labels` lacks it, else "Get ready." 3 s), "Wave n" for 1.5 s, the battle, "Wave n cleared." for 4 s with the effect, and after wave 5 dawn. Lost lives give the game-over screen. "Play again" starts a new game with a new seed and no teaching. Game progress is not stored.
- **Keys.** `actionForKey` is always called with `keysMode: true`, so 1 to 4 call `ears.inject` with the microphone too (requirement of run B). Escape closes settings, else toggles pause. Keys are ignored while a teach dialog is open.
- **Microphone card.** A denied start shows the card over the title (Try again, Play with keys). A lost microphone (`onError`) switches at once to a keys Ears (`connect('keys')`), so the keys keep working, and shows the card without a dim layer (Reconnect, Play with keys). Reconnect calls `listen` with the microphone again; if that fails the card returns and the keys Ears is restored.
- **Hit effect.** Stage times are constants (`HEARD_GROW_MS`, `ARC_*`, `FLASH_AT_MS`, `EXIT_AT_MS`, `HIT_EFFECT_MS` 1000). It uses the Web Animations API, started only when `prefers-reduced-motion` is not `reduce`; with it, a hit shows the word and "+1" for 600 ms and nothing moves. The CSS has its looping motion inside `prefers-reduced-motion: no-preference`. A skeleton that is hit once rattles on its live element, the warden's lantern flickers; the hp cells follow the state at once. Misses show text in both modes: "Not a monster sound", "No bats here" and so on.
- **Sound effects.** Played only in `between`, `lost` and `won`, wrapped in `ears.pause()` and `ears.resume()`. The Sound effects switch in Settings turns them off.
- **Settings** (a corner link) pauses the game and offers "Teach a sound again" (hidden in keys mode), the effects switch and Close. Pause and Settings are enabled only in battle and paused.
- **Test-only parameters.** `?speed=N` (1 to 16) multiplies the game clock and divides the waits (Get ready, wave label, between); a speed above 1 also shortens the room sound to 10000 ms, the shortest `backgroundMs` allowed. `?wave=N` starts at wave N, `?lives=N` gives N candles. The plain page has none of them. The attributes `data-phase`, `data-wave`, `data-shooed`, `data-mode`, `data-source` on `#stage` and `data-lives` on `#candles` show the state for the tests.
- **Browser tests** (`test/web/shoo.spec.ts`, `shoo-fixture.ts`): the fake microphone plays one WAV at 48 kHz. `shoo-first.wav` holds speech-like noise (3 s to 16 s), ten teaching clicks (24 s to 31.2 s) and two clicks in the fight (40 s, 43 s); the test closes the room dialog only after the noise has ended, so the click dialog does not count it. `shoo-play.wav` holds one click (8 s) and the rhythm three times (11 s, 16 s, 21 s) and is used with a stored model (`shoo-stored.json`, built with `retrainLabel` at 48 kHz) for the returning, boss and mic-lost tests. The Node engine hears both files as planned before the browser runs (`checkShooFixture`). Keys tests use no stream. Screenshot: `TOKK_WRITE_SCREENSHOT=1`.
- **Not covered by a browser test:** the "Not a monster sound" smoke (it needs an `unknown` sound from the microphone), the Settings "teach again" dialog, and a full game to dawn. The rules for them are in the unit tests of run A.
- **Not done:** the link from `site-src/index.html` (the task forbids touching `site-src/`); `npm run build:site` may warn about it, see tasks.md.