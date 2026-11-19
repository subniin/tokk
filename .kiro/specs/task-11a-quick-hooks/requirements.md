# Requirements: Task 11A, Steering and quick hooks

## Introduction
Task 11A turns the rules of design sections 8.2 (hooks) and 8.3 (steering) into files that Kiro reads. It runs right after Task 4, so the hooks are on for the rest of the development and leave a record of Kiro use (plan, "Execution order"). It adds four things:

1. `scripts/check-public-api.ts` (`npm run check:public-api`), which fails when an app imports from `core/` directly (design 9, "public API only").
2. The npm script `pbt:quick`, which runs only the property-test files that exist, with 20 cases per property, so a save-triggered hook ends in seconds.
3. Four steering files: `web-audio.md`, `units.md`, `privacy.md`, `layers.md`.
4. Two hook files: `pbt-quick` and `public-api-only`. Both run a shell command, not an agent prompt, so they use no credits.

Only Task 4 has produced a property-test file so far (`test/segment.test.ts`). `test/knn.test.ts` (Task 5) and `test/grammar.test.ts` (Task 7) do not exist yet, and `apps/` does not exist until plan 3. Everything here must work in that state and keep working when those files appear.

| Consumer | What it uses from this task |
|---|---|
| Tasks 5 and 7 | `pbt:quick` and the `pbt-quick` hook pick up `knn.test.ts` and `grammar.test.ts` without a change |
| Plan 3 (apps) | `public-api-only` and `check:public-api` start to matter when `apps/` is created |
| Task 11B | Adds the `sounds-rebuild` and `corpus-score` hooks and `integrate.md` next to these files. It does not change them |
| Every later task | Steering files are read by Kiro in each session. Hooks run on each save |

## Requirements

### Requirement 1: Public API check
**User story:** As a maintainer, I want a command that fails when an app reaches into `core/`, so that apps depend only on the public API.

#### Acceptance Criteria
1. THE npm script `check:public-api` SHALL run `scripts/check-public-api.ts` with `tsx`. THE script SHALL use the current working directory as the repository root.
2. THE script SHALL scan every file under `apps/` whose extension is `.ts`, `.tsx` or `.js`. It SHALL skip `node_modules` and `dist` folders.
3. THE script SHALL treat an import specifier as forbidden WHEN it is `tokk/core`, starts with `tokk/core/`, or is a relative or absolute path that has `core` as a whole path segment (for example `../../core/segment` or `../core`). A specifier such as `./core-utils`, `tokk` or `tokk/node` SHALL be allowed.
4. THE script SHALL check static imports, `export ... from`, side-effect imports, dynamic `import()` and `require()`. It SHALL ignore lines that start with `//` or `*` after leading spaces.
5. FOR each forbidden specifier, THE script SHALL print one line `<file>:<line>` followed by the specifier, with `/` as the path separator and the path relative to the repository root. WHEN a multi-line import is flagged, THE line SHALL be the one that holds the specifier.
6. WHEN at least one forbidden specifier is found, THE script SHALL exit with code 1. WHEN none is found, or `apps/` does not exist, THE script SHALL exit with code 0 and print at most one short line.
7. THE script SHALL NOT read any file outside `apps/` and SHALL NOT write any file.

### Requirement 2: Tests for the public API check
**User story:** As a maintainer, I want the check itself tested, so that a hook cannot pass by accident.

#### Acceptance Criteria
1. THE file `test/scripts.test.ts` SHALL contain a test named `check-public-api exits 1 and names the file for an app importing core/segment`. It SHALL build a temporary repository root with one app file that imports `core/segment` by a relative path, run the script in it, and expect exit code 1 and the file and line in the output.
2. THE same file SHALL contain a test named `check-public-api exits 0 when apps only import from tokk`. It SHALL use an app file that imports from `tokk` and `tokk/node` only, and expect exit code 0.
3. THE tests SHALL create the temporary folder outside the repository and remove it afterwards, also when an assertion fails.
4. THE tests SHALL run the script in a child process, so that exit code and output are the real ones.
5. Task 11B adds its tests to the same file. THIS task SHALL NOT create them.

### Requirement 3: Quick property tests
**User story:** As a developer, I want a very short run of the property tests on each save, so that a regression shows up before I go on.

#### Acceptance Criteria
1. THE npm script `pbt:quick` SHALL run the test files `test/segment.test.ts`, `test/knn.test.ts` and `test/grammar.test.ts` with `PBT_RUNS=20`.
2. THE script SHALL run only the files in that list that exist. A missing file SHALL NOT cause an error. WHEN none of them exists, THE script SHALL exit with code 0 and say so.
3. THE script SHALL work on Windows, macOS and Linux without a new dependency. It SHALL NOT rely on shell syntax for setting an environment variable.
4. WHEN `PBT_RUNS` is already set in the environment, THE script SHALL keep that value. This lets a developer use `PBT_RUNS=100` for a deeper run through the same command.
5. THE script SHALL use the compact reporter (as `test:quick` does) and SHALL return the exit code of the test run. Output goes to the agent when a hook runs it, so it SHALL stay short.
6. **Time target:** with only `test/segment.test.ts` present, `npm run pbt:quick` SHALL finish in **under 20 seconds** on the development machine, from command start to exit. Reference: the full segment suite takes about 60 seconds at 100 cases, mostly P4, so 20 cases should take about 12 seconds plus start-up. THE measured time SHALL be written to `docs/devlog.md`. IF the time is 20 seconds or more, THEN the fix SHALL be a lower case count or fewer files in the list, not a longer hook timeout.
7. THE `PBT_RUNS=20` setting SHALL only change the number of cases. It SHALL NOT change a property, a tolerance or a test timeout. (The P4 timeout already grows with `PBT_RUNS`, with a floor of 120 seconds, so a lower count cannot cause a timeout.)
8. THE full test script `test` SHALL keep its meaning (all tests, 100 cases).

### Requirement 4: Steering files
**User story:** As a developer who works with Kiro, I want the project rules loaded into every session, so that generated code follows them without being told.

#### Acceptance Criteria
1. THE directory `.kiro/steering/` SHALL contain `web-audio.md`, `units.md`, `privacy.md` and `layers.md`. Each file SHALL start with YAML front matter at the very first line, between two `---` lines.
2. EACH file SHALL be written in English as short imperative rules (one rule per line, a verb first, no explanations inside the rule). EACH file SHALL stay under 25 lines of rules, because steering is read in every matching session.
3. THE rules SHALL come from design section 8.3 and the plan's Global Constraints. They SHALL NOT add a new rule. THE list per file is in `design.md`.
4. THE inclusion mode of each file SHALL be the one in the table below. `design.md` explains each choice.

| File | Front matter |
|---|---|
| `web-audio.md` | `inclusion: fileMatch` with patterns for `web/**` and `teach.html` |
| `layers.md` | `inclusion: fileMatch` with patterns for `core/**`, `web/**`, `node/**` |
| `units.md` | `inclusion: always` |
| `privacy.md` | `inclusion: always` |

5. THE existing placeholder `.kiro/steering/.gitkeep` MAY stay. THE steering files SHALL NOT be listed in `.gitignore` (plan, Global Constraints).
6. `integrate.md`, `ui.md` and `halloween-ui.md` SHALL NOT be created by this task.

### Requirement 5: Hook files
**User story:** As a developer, I want two checks to run on their own when I save a file, at no credit cost.

#### Acceptance Criteria
1. THE directory `.kiro/hooks/` SHALL contain `pbt-quick.json` and `public-api-only.json`. Each file SHALL be a standalone hook definition in the format that Kiro IDE 1.x and Kiro CLI 3.x both read: `version` `"v1"` and a `hooks` array. The exact fields are in `design.md`.
2. THE `pbt-quick` hook SHALL use the trigger `PostFileSave`, a matcher that matches the paths `core/segment.ts`, `core/grammar.ts` and everything under `core/classify/`, and the command action `npm run pbt:quick`.
3. THE `public-api-only` hook SHALL use the trigger `PostFileSave`, a matcher that matches every path under `apps/`, and the command action `npm run check:public-api`.
4. BOTH hooks SHALL use the action type `command`. NEITHER hook SHALL use an agent prompt action.
5. THE matchers SHALL accept both `/` and `\` as path separators and SHALL NOT depend on whether Kiro passes a relative or an absolute path. THE matchers SHALL NOT match `test/segment.test.ts`, so that saving a test file does not start the run twice in a loop of edits.
6. THE `pbt-quick` hook SHALL set `timeout` to 60 seconds. THE `public-api-only` hook SHALL set `timeout` to 30 seconds. BOTH SHALL have `enabled` set to `true` and a `description`.
7. THE hook files SHALL be valid JSON and SHALL be committed (`.kiro/` is not ignored).
8. THE hooks SHALL NOT need a change when `knn.test.ts`, `grammar.test.ts` or `apps/` appear later.

### Requirement 6: Confirmation in Kiro IDE (manual)
**User story:** As the project owner, I want to see the hook run once, so that I know it works in the real tool.

#### Acceptance Criteria
1. THE owner SHALL open the repository in Kiro IDE, open `core/segment.ts`, save it (a change is not needed), and confirm that the `pbt-quick` hook starts, runs `npm run pbt:quick`, and shows a result in Kiro.
2. THE owner SHALL confirm that the hooks appear in the Agent Hooks panel of the IDE with the names `pbt-quick` and `public-api-only`.
3. THE result of this step SHALL be written to `docs/devlog.md` (worked, or what was seen instead).
4. IF the hook does not start on a save made by the user, THEN the cause SHALL be recorded in `design.md` ("Open point", Risks) and the matcher or trigger SHALL be fixed before the commit. A hook that starts only on saves made by the agent does not meet the plan.

### Requirement 7: Constraints that stay true
**User story:** As a maintainer, I want this task to change nothing in the engine.

#### Acceptance Criteria
1. THIS task SHALL NOT edit `core/`, `node/`, `web/` or `tools/`, and SHALL NOT edit existing tests.
2. ALL new files that are tracked SHALL be in English. No Korean text outside `docs/_planning/`.
3. THE new script SHALL NOT import from `core/`. It reads files and prints lines.
4. `npm test` SHALL still pass after the change, with no change in the number of earlier tests.
5. THE final commit message SHALL be `chore: add steering and quick hooks`.
