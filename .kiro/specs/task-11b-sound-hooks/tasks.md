# Tasks: Task 11B, sound and score hooks, MCP registration

Order is test-first. Do not write a script, a hook file or a steering file before the test for it exists and fails. Do not touch `scripts/score.ts`, `node/teach.ts`, `node/score.ts`, `core/index.ts` or `node/index.ts`. Do not start another spec.

- [x] 1. Check prerequisites
  - [x] 1.1 Confirm that `node/teach.ts` (`teachFromDir`, `TeachReport` with warnings), `node/score.ts`, `scripts/score.ts` (`runScore`), `core/synth.ts` (`rng`, `place`, `synthImpact`, `synthNoise`, `SYNTH_CLASSES`), `tools/mcp-ears/server.ts` and `test/scripts.test.ts` exist, and that the full test suite passes.
  - [x] 1.2 Read `.kiro/hooks/pbt-quick.json`, `.kiro/steering/layers.md`, the builders in `test/teach.test.ts` and `test/helpers/`, and the export names and environment shape of `runScore`. Note what can be reused.
  - [x] 1.3 Confirm that none of `scripts/sounds-rebuild.ts`, `scripts/make-synth-fixtures.ts`, `scripts/corpus-score.ts`, `.kiro/settings/mcp.json`, `.kiro/steering/integrate.md`, `docs/experiments.md`, `fixtures/audio/synth/` exists yet, and that `.gitignore` does not ignore `.wav` files or `fixtures/`.

- [x] 2. Write failing tests
  - [x] 2.1 `test/scripts.test.ts`, `sounds-rebuild` cases from `design.md` (Requirement 1, 9.1): model written at `<dir>/../sounds.json`, default folder, confused pairs with exit 0, calibration warning with exit 0, missing folder and folder without subfolders (note, exit 0, nothing written), four examples (counts, exit 0, nothing written, existing file unchanged), 24-bit WAV (exit 1, nothing written), non-model target refused and unchanged, only model keys in the file.
  - [x] 2.2 `test/synth-fixtures.test.ts` (Requirement 2): determinism of two generations, equality with the committed files, size under 2 MB, WAV format and rate, quiet lead with no segment, `t` times rate is an integer, five labels with no warnings and enough examples, score of `quick` at least 0.9 per label with no `inCalibration`, committed `sounds.json` labels and ids match a fresh rebuild. The tests that read committed files stay failing until task 5.
  - [x] 2.3 `test/scripts.test.ts`, `corpus-score` cases (Requirement 3): mode choice in all four situations (real, synthetic, empty real folder, nothing), the note and exit 0 for empty or missing folders, `docs/` untouched in synthetic mode, baseline copy-in and regression exit 1, `--update-baseline` copy-back, temporary folder removed after success and after an error, invalid `sounds.json` keeps exit 2, run time on the committed synthetic set under `CORPUS_SCORE_BUDGET_MS`.
  - [x] 2.4 `test/scripts.test.ts`, files: both hook files (fields, matcher results on the listed paths, one-line command), `.kiro/settings/mcp.json` (exact server entry, `package.json` has the `mcp` script), `integrate.md` (front matter and key phrases), `tsconfig.json` `include` has `tools`, experiments header test (create when missing, one appended line, no repeated header, an existing file unchanged).
  - [x] 2.5 Run the new tests. Confirm FAIL for the right reason (modules and files missing). (Req 9.1)

- [x] 3. Constants and package scripts
  - [x] 3.1 Add the constants of the `design.md` table to `core/constants.ts` with units in the names, under a heading `// Synthetic fixtures and corpus score`. No sample count as a literal.
  - [x] 3.2 Add to `package.json` `scripts`: `sounds:rebuild`, `synth:fixtures`, `corpus-score` (exact strings in the requirements). Leave other scripts and `exports` as they are. (Req 1.1, 2.1, 3.1)

- [x] 4. Implement `sounds-rebuild`
  - [x] 4.1 `scripts/sounds-rebuild.ts`: `runSoundsRebuild(argv, env)` and the direct-run entry, following the flow in `design.md`. Run the tests of 2.1. Expect PASS. (Req 1)
  - [x] 4.2 Check the output text against the MCP `teach` line shapes by reading `tools/mcp-ears/format.ts`. Do not import from it.

- [x] 5. Implement the synthetic set
  - [x] 5.1 `scripts/make-synth-fixtures.ts`: `makeSynthFixtures(outDir)` and the direct-run entry. Build recordings with `place`, convert start times to sample indexes, write label `t` from the index. (Req 2)
  - [x] 5.2 Generate to a temporary folder first. Check the total size and the lead. If the size is above 1.9 MB, reduce spacing or impacts as `design.md` says, then record the final constant values and the measured size in the "Constants" and "Layout and size" tables of `design.md`.
  - [x] 5.3 Generate to `fixtures/audio/synth/` with the `synth:fixtures` script. Build `fixtures/audio/synth/sounds.json` with the `sounds:rebuild` script on `fixtures/audio/synth/sounds`. Check its output: no warning, no confused pair; if there is one, change the generator parameters (not the engine) and repeat.
  - [x] 5.4 Run the tests of 2.2 and expect PASS, including the committed-files tests. Confirm with git that the WAV files are tracked as binary and that a second generation changes nothing.

- [x] 6. Implement `corpus-score`
  - [x] 6.1 `scripts/corpus-score.ts`: `runCorpusScore(argv, env)` and the direct-run entry, following `design.md` (mode choice, temporary root, baseline copy-in and copy-back, cleanup in `finally`, first output line names the mode). It calls `runScore` from `scripts/score.ts` and does not edit that file. (Req 3)
  - [x] 6.2 Create the synthetic baseline with the script's update flag (`fixtures/audio/synth/scores-quick.json`). Check that it holds counts and rates only.
  - [x] 6.3 Run the tests of 2.3 and expect PASS.

- [x] 7. Hooks
  - [x] 7.1 Read the Kiro hook documentation of the installed version and find the v1 trigger name for a created file. Record the finding in `design.md` ("Hooks" section). (Req 4.2)
  - [x] 7.2 Write `.kiro/hooks/corpus-score.json` and `.kiro/hooks/sounds-rebuild.json` in the format of `pbt-quick.json`, with one entry for create if 7.1 found a trigger. (Req 4)
  - [x] 7.3 Run the hook file tests (2.4) and expect PASS.

- [ ] 8. MCP registration
  - [x] 8.1 Create `.kiro/settings/mcp.json` with exactly the JSON in `design.md`. (Req 5)
  - [x] 8.2 Run the MCP file test and expect PASS.
  - [ ] 8.3 Headless verification (manual, Req 6). Open the workspace in Kiro so the server is picked up, or start a Kiro CLI session in the repository root. Run the CLI in non-interactive chat mode with only the `mcp-ears` `listen` tool trusted. Take the flag names from the installed CLI's help output. The prompt asks it to call `listen` on `fixtures/audio/synth/quick/quick-01.wav` with `fixtures/audio/synth/sounds.json` and print the tool output. Pass when the eight event lines match `quick-01.json` in label and order (times within 20 ms) and the summary line is `high x2, low x2, mid x2, ring x2`. Record the CLI version and the result in `docs/devlog.md`. NOT DONE: skipped by request, to be run from outside after the commit.
  - [ ] 8.4 If the server fails to start because `npm` cannot be launched, change `command` to `npm.cmd`, repeat 8.3, and write the reason in `design.md` ("MCP registration"). If the relative path is not found, the working folder is not the repository root: stop and report instead of adding undocumented fields. NOT DONE: depends on 8.3.
  - [x] 8.5 Leave no log, script or temporary file behind. (Req 6.5)

- [x] 9. Steering `integrate.md`
  - [x] 9.1 Write `.kiro/steering/integrate.md` as described in `design.md` and Requirement 7. Keep the status note about plan 2 accurate. Run the `integrate.md` test and expect PASS.

- [x] 10. `tsconfig.json` and experiments header
  - [x] 10.1 Add `"tools"` to `include` in `tsconfig.json`. Change nothing else. Run the TypeScript check. Report any new error that the change exposes. Do not rewrite code beyond what the change causes. (Req 8.1)
  - [x] 10.2 If `docs/experiments.md` does not exist, create it with exactly the title and header lines that `scripts/score.ts` writes. If it exists, leave it. Run the header test and expect PASS. (Req 8.2, 8.3)

- [ ] 11. Verify
  - [x] 11.1 Run the full test suite and the TypeScript check. All earlier tests pass, including the public API test of Task 8.
  - [x] 11.2 Run `npm run corpus-score` as the hook would, from a clean state of the real folders (no `examples/sounds.json`), and confirm the first line says synthetic, the exit code is 0, `docs/experiments.md` is unchanged, and the whole command finishes in under 15 s (measure with a timer). Run `npm run sounds:rebuild` with no `examples/sounds/` folder and confirm the note and exit 0 and no new file.
  - [ ] 11.3 Save a file under `core/` in Kiro and confirm that `corpus-score` runs and its output appears. Add a file under `examples/sounds/` only if a throw-away check is needed, and remove it afterwards. NOT DONE: needs Kiro IDE.
  - [x] 11.4 Run `npm run check:public-api`. Check that nothing under `core/` changed except the new constants, that no threshold or sample count is a literal number in the new scripts, that no code sends audio over the network, and that no sounds file holds samples. (Req 9.2 to 9.5)
  - [x] 11.5 Check that `package.json` changed only in the three scripts, that no temporary folder, script or log remains, and that no Korean text is in tracked files outside `docs/_planning/`.

- [x] 12. Devlog and commit
  - [x] 12.1 Add a line to `docs/devlog.md`: scripts, synthetic set with its measured size, hooks, MCP registration with the CLI version used, `integrate.md`, and the refresh rule for the synthetic `sounds.json`.
  - [x] 12.2 Commit with the message `chore: add sound and score hooks, register MCP`.
