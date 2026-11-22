# Requirements: Task 36, replace the first two apps

## Introduction
Click Talk (task 34) and Shoo! (task 33) replaced Hands-Free (task 22) and Knock Once for Yes (task 23) on 2026-11-22, because the operator redesigned both apps. Task 36 removes the two old apps and brings the documents up to date. Tasks 33 to 35 are committed.

## Requirements
1. `apps/hands-free/`, `apps/knock-once/`, `test/hands-free-*.test.ts`, `test/knock-once-*.test.ts`, `test/web/hands-free*`, `test/web/knock-once*`, `docs/images/hands-free.png` and `docs/images/knock-once.png` are deleted.
2. The fixture generation of the two apps is removed from `test/web/global-setup.ts` and `test/web/paths.ts`. A helper that only the two apps used is deleted. `speechLikeNoise`, which the Shoo!, Click Talk and site fixtures use, moves to `test/web/speech-noise.ts`.
3. `.kiro/steering/halloween-ui.md` was loaded only for `apps/knock-once/**`. It is deleted, and `ui.md` and `test/halloween-scope.test.ts` stop naming the two apps.
4. `README.md` describes Click Talk, Shoo! and the slides case: the apps table, screenshots (`docs/images/click-talk.png`, `docs/images/shoo.png`), times, credits, the Current status section and every other mention. It stays English and keeps its section numbering.
5. `apps/README.md` lists the new apps.
6. `docs/integration.md` keeps the new rows in the main tables and moves the two old rows to the section "Earlier apps (replaced on 2026-11-22)", with one sentence on why. The wiring table has three app groups plus the hello example. The human checks are: Teaching a new sound, First run setup, Wrong choices while talking, Shoo! to dawn, Sound mix-ups and Double clap, all "not measured yet".
7. `docs/kiro.md` has one row for this spec, and every spec row sits in the Specs table.
8. `site-src/index.html` neither mentions the old apps nor says the slides case has no sound control. It is not changed unless it does.
9. `docs/devlog.md` has one line dated 2026-11-22.
10. The specs `task-22-*` and `task-23-*` stay as history.
11. Out of scope: `core/`, `web/`, the new apps, the site demo, `docs/_planning/`, `node_modules`, any push, publish or deploy.
