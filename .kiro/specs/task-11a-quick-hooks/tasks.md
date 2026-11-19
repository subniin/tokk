# Tasks: Task 11A, Steering and quick hooks

Order is test-first. Do not write `scripts/check-public-api.ts` before its tests fail.

- [x] 1. Check prerequisites
  - [x] 1.1 Confirm that Tasks 1 to 4 are committed, that `test/segment.test.ts`, `test/setup.ts` and `vitest.config.ts` exist, and that `npm test` passes.
  - [x] 1.2 Confirm that `scripts/`, `.kiro/hooks/` and `test/scripts.test.ts` do not exist yet, and that `.kiro/steering/` holds only `.gitkeep`. If any of the four steering files exists, read it and merge instead of overwriting.
  - [x] 1.3 Confirm that `.gitignore` does not list `.kiro`. (Requirement 4.5)

- [x] 2. Public API check, test first
  - [x] 2.1 Create `test/scripts.test.ts` with the two tests of Requirement 2 and the temporary-folder helper (create outside the repository, remove in `finally`, child process with the `tsx` loader). Put the test-only values at the top of the file. (Req 2)
  - [x] 2.2 Run `test/scripts.test.ts` and confirm FAIL because the script does not exist.
  - [x] 2.3 Create `scripts/check-public-api.ts` as in `design.md`: skip when `apps/` is missing, walk `apps/`, check the four import forms, apply the whole-segment rule, print `file:line  specifier`, exit 1 or 0. (Req 1)
  - [x] 2.4 Add the npm script `check:public-api`.
  - [x] 2.5 Run `test/scripts.test.ts` and confirm PASS.
  - [x] 2.6 Run `npm run check:public-api` in the repository, where `apps/` does not exist, and confirm exit code 0.

- [x] 3. Quick property tests
  - [x] 3.1 Create `scripts/pbt-quick.ts` as in `design.md`: candidate list, keep existing files, exit 0 when none, start vitest with the compact reporter and `PBT_RUNS=20` unless already set, return the exit code. (Req 3.1 to 3.5)
  - [x] 3.2 Add the npm script `pbt:quick`.
  - [x] 3.3 Run `npm run pbt:quick` and confirm that it runs `test/segment.test.ts` only, that the test output shows 20-case runs (not 100), and that the exit code is 0. Run it with a missing file in the list (the two that do not exist yet) and confirm there is no error.
  - [x] 3.4 Measure the time of a complete `npm run pbt:quick` start to finish. Target: **under 20 seconds**. If it is 20 seconds or more, lower the case count to 10 and measure again. Do not raise a timeout. Keep the number for step 7. (Req 3.6)
  - [x] 3.5 Run `PBT_RUNS=100` through the same script (set the variable in the way of your shell) and confirm that the value is kept. (Req 3.4)
  - [x] 3.6 Confirm that `npm test` still runs all tests at 100 cases. (Req 3.8)

- [x] 4. Steering files
  - [x] 4.1 Create `.kiro/steering/web-audio.md` with `inclusion: fileMatch` and the patterns `web/**/*` and `teach.html`, then the rules listed in `design.md`.
  - [x] 4.2 Create `.kiro/steering/layers.md` with `inclusion: fileMatch` and the patterns `core/**/*`, `web/**/*` and `node/**/*`, then its rules.
  - [x] 4.3 Create `.kiro/steering/units.md` with `inclusion: always` and its rules.
  - [x] 4.4 Create `.kiro/steering/privacy.md` with `inclusion: always` and its three rules.
  - [x] 4.5 Check each file: front matter on line 1, written in English, imperative sentences, fewer than 25 lines of rules, no rule that is not in design 8.3 or the plan's Global Constraints. (Req 4.1 to 4.3)
  - [ ] 4.6 Open the Steering section of the Kiro IDE panel and confirm that the four files are listed with the inclusion modes of the table in Requirement 4.

- [x] 5. Hook files
  - [x] 5.1 Create `.kiro/hooks/pbt-quick.json` with the fields of the schema table in `design.md`: `version` `v1`, one hook, trigger `PostFileSave`, the matcher of the `pbt-quick` row (backslashes doubled for JSON), command action `npm run pbt:quick`, timeout 60, enabled. (Req 5.1, 5.2, 5.4, 5.6)
  - [x] 5.2 Create `.kiro/hooks/public-api-only.json` the same way with the `public-api-only` matcher, command `npm run check:public-api`, timeout 30. (Req 5.3, 5.4, 5.6)
  - [x] 5.3 Parse both files as JSON and confirm they are valid.
  - [x] 5.4 Test both matcher expressions with the six paths of each row in the `design.md` table, plus a Windows-style path, using a one-off check in a scratch session. Confirm every "matches" path matches and every "does not match" path does not, then delete anything you created for it. (Req 5.5)
  - [x] 5.5 Confirm that no hook uses an agent prompt action. (Req 5.4)

- [ ] 6. Manual step for the project owner (Kiro IDE)
  - [ ] 6.1 Open the repository folder in Kiro IDE.
  - [ ] 6.2 Open the Agent Hooks panel. Confirm that `pbt-quick` and `public-api-only` are listed and enabled, and that opening one shows the trigger, matcher and command as written. (Req 6.2)
  - [ ] 6.3 Open `core/segment.ts` and save it. Confirm that the `pbt-quick` hook starts, runs `npm run pbt:quick`, and that its result is visible in Kiro. (Req 6.1)
  - [ ] 6.4 Write what was seen (worked, or what happened instead) for the devlog line. If the hook did not start on your own save, stop here: record it in the "Risks and open point" section of `design.md`, change the trigger or matcher, and repeat 6.3. (Req 6.3, 6.4)

- [x] 7. Verify and commit
  - [x] 7.1 Run the full test suite and the TypeScript check. Both pass, with the same earlier tests plus the two new ones. (Req 7.4)
  - [x] 7.2 Check that `core/`, `node/`, `web/`, `tools/` and the earlier tests have no change, and that the new scripts import nothing from `core/`. (Req 7.1, 7.3)
  - [x] 7.3 Confirm no Korean text in tracked files outside `docs/_planning/`. (Req 7.2)
  - [x] 7.4 Confirm that no temporary file or folder from steps 2 to 5 is left in the repository or in the system temp directory.
  - [x] 7.5 Add a line to `docs/devlog.md`: the two hooks and the four steering files, the measured `pbt:quick` time from 3.4, and the manual result from 6.4.
  - [x] 7.6 Commit with the message `chore: add steering and quick hooks`.
