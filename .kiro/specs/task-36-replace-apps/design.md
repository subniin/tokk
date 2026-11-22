# Design: Task 36, replace the first two apps

## Order
1. Tests first: `test/readme.test.ts`, `test/integration-doc.test.ts` and `test/apps-readme.test.ts` change to the new app set (Click Talk, Shoo!, the slides case, 3 wiring groups plus hello) and fail against the old documents.
2. Delete the old apps, their tests, fixtures and pictures. Move `speechLikeNoise` to `test/web/speech-noise.ts` first, so the three new fixtures keep compiling.
3. Update the documents until the tests pass.

## Test changes
- `readme.test.ts`: `CASES` becomes `apps/click-talk`, `apps/shoo`, `cases/slides`. RM4 expects 4 groups in total. RM5 breaks a Shoo! and a Click Talk number. A new check says the README names no old app and does name Click Talk, Shoo! and the slides case.
- `integration-doc.test.ts`: `APP_ROWS` becomes Click Talk and Shoo!. New checks: the section "Earlier apps (replaced on 2026-11-22)" holds the two old rows, the main tables hold no old row, and the six human checks are present.
- `apps-readme.test.ts`: the required phrases `click-talk` and `shoo` replace `hands-free` and `knock-once`.
- `halloween-scope.test.ts`: scans `web/`, `teach.html` and `examples/` only.

## Documents
`README.md` sections 1, 5, 7 and 10 change. Section 5.1 has three rows. Section 5.2 has the three groups and the hello example. The pending checks match the new human checks. `docs/kiro.md` moves the spec rows that sit under "Documentation checked" into Specs and drops the Halloween steering row.

## Check
`git grep -n -E "hands-free|knock-once|Hands-Free|Knock Once"` lists only the earlier-apps section, the devlog, the kept specs and other dated history.
