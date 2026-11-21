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
- Tuned wave values: to be filled in by run B.

## Changes outside apps/shoo in run A
- scripts/count-wiring.ts: an app folder without src/main.ts is not counted (apps/README.md: the entry is src/main.ts). Without this, the logic files alone made a sixth group with 0 lines and broke the wiring tables of the README and integration.md. Once run B adds main.ts, the group appears and those tables need the new row.
- docs/kiro.md: one row for this spec (test A9 lists every spec).
