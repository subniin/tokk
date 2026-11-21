# Tasks: Task 33, app Shoo!

Test first. English only. Do not push or publish. Do not touch `docs/_planning/`, `core/`, `web/`, other apps or the site. Never send audio over the network. Remove temporary files. Only the boxes of steps that were run are marked.

## Run A: spec, rules and tests
- [x] 1. Read the plan, `redesign.md` 5.3, `shoo.md`, the task 30 and 32 specs, `web/listen.ts`, `apps/knock-once`. Run `npm test` for the baseline (75 files, 1106 passed).
- [x] 2. Write `.kiro/specs/task-33-shoo/` (requirements, design, tasks).
- [x] 3. Write the tests and the sound recipe: `test/shoo-{monsters,waves,game,keys,teach,events}.test.ts`, `test/helpers/shoo-sounds.ts`. Run them and confirm FAIL (six suites, modules missing).
- [x] 4. Implement `apps/shoo/src/{constants,monsters,waves,game,keys,teach-texts}.ts`.
- [x] 5. Synthesize `apps/shoo/sounds/{click,clap,knock,pop}/` with a temporary writer (deleted), build `apps/shoo/sounds.json` with `npm run sounds:rebuild apps/shoo/sounds`.
- [x] 6. Run the new tests: 6 files, 65 tests pass.
- [x] 7. Fix what the full run showed: `scripts/count-wiring.ts` skips an app folder without `src/main.ts`; one row in `docs/kiro.md`.
- [x] 8. Run `npm test`, `npm run pbt:quick`, the three type checks and `npm run check:public-api`.
- [x] 9. Commit with `feat: add Shoo! game rules`.

## Run B: screen, audio, wiring, browser tests
- [x] 10. `apps/shoo/index.html`, `src/style.css` and `src/view.ts` from the approved mockup, with the four-step hit effect from `Hit` and the reduced-motion rule.
- [x] 11. `src/audio.ts`: generated effects, `ears.pause()` and `ears.resume()` around them.
- [x] 12. `src/main.ts` with the tokk block (requirement 18), the mic card, keys mode, the `modeFor` switch.
- [x] 13. `test/web/shoo.spec.ts` and `test/web/shoo-fixture.ts`: first run, a full wave, a missed monster, boss rhythm, game over and again, `keys-only`, `mic-lost`, `returning`, widths 320 and 1280 px.
- [x] 14. Tune counts, speeds and spawn intervals by play; record them in `design.md`. Nobody could play in this run: the start values stay and design.md says so. Tuning by play is open.
- [x] 15. (The link from `site-src/index.html` was not made: the task forbids touching it.) Update `docs/integration.md` and the README wiring counts from `npm run count:wiring`.
- [x] 16. Run all checks of the plan (`npm test`, `npm run test:web` twice, tsc x3, `check:public-api`, `build:site`, `count:wiring`). Commit `feat: add Shoo! sound defense game`.

## Fix run (2026-11-22)
- [x] 17. Fix two bugs found by the operator after f14cf7e: `shooABat()` in `test/web/shoo.spec.ts` pressed '1' on every poll, so two bats could be shooed before the Worker counted the first (strict mode violation on `.plus`); it now presses once and waits for `data-shooed` to grow (no other test relied on the repeated press). The HUD grid stretched `#candles` to 453 px; `.candles` is now `width: max-content; max-width: 100%`, the grid columns are `minmax(0, ...)` so the corner wraps instead of overflowing, and a browser check (1024 x 768, 320 and 1280 px, 3 and 9 lives) tests that every HUD box is inside the window.
