# Tasks: Task 34, app Click Talk

Test first. English only. Do not push or publish. Do not touch `docs/_planning/`, `core/`, `web/`, other apps or the site. Never send audio over the network. Remove temporary files. Only the boxes of steps that were run are marked.

## Run A: spec, rules and tests
- [x] 1. Read the plan, `redesign.md` 5.2, `click-talk.md`, the mockup, the Shoo! spec and code, `web/listen.ts`, `core/grammar.ts`, `node/expect.ts`.
- [x] 2. Write `.kiro/specs/task-34-click-talk/` (requirements, design, tasks).
- [x] 3. Write the tests and the sound recipe: `test/click-talk-{board,settings,speech,keys,teach,events}.test.ts`, `test/helpers/click-talk-sounds.ts`. Run them and confirm FAIL (six suites, modules missing; the implementation files were first moved aside for this run).
- [x] 4. Implement `apps/click-talk/src/{constants,phrases,board,patterns,settings,speech,keys,teach-texts}.ts`.
- [x] 5. Synthesize `apps/click-talk/sounds/{click,pop}/` with a temporary writer (deleted), build `apps/click-talk/sounds.json` with `npm run sounds:rebuild apps/click-talk/sounds`. The first pop class (`ring`) made the second pop of a burst `unknown`; pop uses the `mid` class (see design.md).
- [x] 6. Run the new tests: 6 files, 103 tests pass.
- [x] 7. Check what the grammar gives for two pops then silence: no match (`matches: []`). The rule that turns it into one choose is `settleBurst`, described in design.md and tested as a pure function.
- [x] 8. One row in `docs/kiro.md` for this spec.
- [x] 9. Run `npm test` (89 files, 1288 passed, 2 todo), `npm run pbt:quick` (4 files, 144 passed, 2 todo) and the three type checks (`tsconfig.json`, `tsconfig.web.json`, `tsconfig.test-web.json`).
- [x] 10. Commit with `feat: add Click Talk board rules`.

## Run B: screen, speech, alarm, caregiver screen, wiring, browser tests
- [x] 11. `apps/click-talk/index.html`, `src/style.css` and `src/view.ts` from the approved mockup (requirement 19).
- [x] 12. `speak()` in `src/speech.ts` and the no-voice notice (requirement 20).
- [x] 13. `src/alarm.ts`: generated repeating alarm (requirement 21).
- [x] 14. `src/caregiver.ts`: the settings screen (requirement 22).
- [x] 15. `src/main.ts` with the tokk block, the `settleBurst` timer, the one-sound tick, the mic card and keys mode (requirement 23).
- [x] 16. `test/web/click-talk.spec.ts` and `test/web/click-talk-fixture.ts` (requirement 24).
- [x] 17. Update `docs/integration.md` and the README wiring counts from `npm run count:wiring`.
- [x] 18. Run all checks of the plan (`npm test`, `npm run test:web` twice, tsc x3, `check:public-api`, `build:site`, `count:wiring`). Commit `feat: add Click Talk app`.

Run B results: npm test 89 files, 1287 passed, 2 todo; pbt:quick 144 passed; test:web 109 passed, 1 skipped (the screenshot test), twice; wiring 27 lines.
