# Tasks: Task 9a, Scoring tool

Order is test-first. Do not write `node/score.ts` or `scripts/score.ts` before their tests fail. The spectrogram and PNG work is Task 9b and is not part of this task.

- [x] 1. Check prerequisites
  - [x] 1.1 Confirm that `node/files.ts` (`readWavFile`, `writeWavFile`), `core/engine.ts` (`runSamples`), `core/synth.ts` (`synthImpact`, `place`, `rng`, `SYNTH_CLASSES`) and `test/helpers/engine-fixture.ts` (`buildModel`) exist and that the tests of Tasks 1 to 5, 7, 8 and 11A pass.
  - [x] 1.2 Confirm that `core/constants.ts` has `MATCH_TOLERANCE_MS`, `REGRESSION_RECALL_DROP`, `REGRESSION_MIN_TRUTHS`, `REGRESSION_TP_DROP_COUNT` and `NOISE_FLOOR_WARMUP_MS`. Do not add `SCORE_EPSILON` yet.
  - [x] 1.3 Confirm that `scripts/score.ts`, `node/score.ts` and `docs/experiments.md` do not exist yet, and that `node/index.ts` and `core/index.ts` stay as they are in this task.

- [x] 2. Write failing tests
  - [x] 2.1 Write `test/helpers/score-fixture.ts`: builds a fixture folder in a temporary directory (WAV from impacts of a taught synthetic class in a quiet noise bed, label JSON with optional overrides). Every normal sound starts at or after `LEAD_MS` (1200, named with its unit at the top of the file). (Req 10.1)
  - [x] 2.2 `test/score.test.ts`, matching: perfect predictions give precision and recall 1 with a diagonal-only confusion table; a label 80 ms off gives one `fp` and one `fn`; 40 ms off matches; `matchEvents` takes nearest first and one-to-one (truths 0.20 and 0.26, prediction 0.24). (Req 4)
  - [x] 2.3 `test/score.test.ts`, report: `falsePositivesPerHour` scales with `totalSeconds`; confusion entries for a wrong label (`[clap][knock]`) and a spurious prediction (`[none][...]`); precision and recall conventions for zero denominators. (Req 5)
  - [x] 2.4 `test/score.test.ts`, **calibration lead**: truth at 0.4 s is in calibration, warned with file and first time, excluded from `truths`, `tp`, `fn` and recall; truth at exactly 1.0 s is scored; a label with only calibration events has `truths` 0 and recall 1; totals and per-label `inCalibration`. (Req 3)
  - [x] 2.5 `test/score.test.ts`, files: wav without json is skipped with `no-labels` and not in `totalSeconds`; json without wav gives `no-recording`; json `sampleRate` different from the header gives `sample-rate-mismatch` and the header value is used; bad JSON, missing `events` and negative `t` reject with the file name; a 24-bit wav rejects with the file name and `16-bit PCM`; a missing directory rejects with `ENOENT`; an empty directory gives an empty report. (Req 1)
  - [x] 2.6 `test/score.test.ts`, `compareToBaseline` on hand-made reports: recall drop of 0.1 at 60 truths is a regression; exactly 0.02 at 50 truths is not; 0.03 is; a label with 20 truths missing one more is not a regression and missing two more is; a new label is not; a lost label with truths is; deltas are correct. (Req 6)
  - [x] 2.7 `test/scripts.test.ts`, `runScore` with an in-memory writer and a temporary project root with `docs/`: exit 0 and a created experiments file with header and one line when there is no baseline; `--update-baseline` writes `docs/scores-<folder>.json` and exits 0; a second run is 0; a baseline of another folder name is ignored; a model that loses hits against that baseline gives 1 and still appends a line; wrong argument count, unknown option, missing `sounds.json`, invalid baseline and an empty fixtures folder give 2 and append nothing; the line format `date | commit | label recall, ... | FP/h`. (Req 7 to 9)
  - [x] 2.8 `test/scripts.test.ts`, `getCommit`: a plain temporary folder gives `uncommitted`; when `git` is installed, a temporary repository with one commit (set up with `-c user.name` and `-c user.email`) gives a short hash and a changed file gives `uncommitted`; skip the git cases when `git` is missing. (Req 8.4)
  - [x] 2.9 Run the new tests and confirm FAIL (modules missing).

- [x] 3. Constant
  - [x] 3.1 Add `SCORE_EPSILON` to the "Scoring" section of `core/constants.ts` with a comment. Change nothing else in `core/`. (Req 10.4)

- [x] 4. Implement `node/score.ts`
  - [x] 4.1 Directory listing, stem pairing, label validation, wrapped read errors, warnings `no-labels`, `no-recording`, `sample-rate-mismatch`. (Req 1)
  - [x] 4.2 Engine run through `runSamples`, `totalSeconds` from sample counts. (Req 2)
  - [x] 4.3 Calibration split with `NOISE_FLOOR_WARMUP_MS`, counts and the `in-calibration` warning. (Req 3)
  - [x] 4.4 `matchEvents` (same label, tolerance, nearest first, one-to-one) and the cross-label pass for the confusion table. (Req 4, 5.5)
  - [x] 4.5 Report assembly: `perLabel`, precision and recall conventions, `falsePositivesPerHour`, fixed ordering. (Req 5)
  - [x] 4.6 `compareToBaseline` with the two-part regression rule. (Req 6)
  - [x] 4.7 Run `test/score.test.ts`. Expect PASS.

- [x] 5. Implement `scripts/score.ts`
  - [x] 5.1 Argument parsing, `sounds.json` check, table and confusion output, warnings to the error stream. (Req 7.1, 7.2)
  - [x] 5.2 `getCommit(folder)` with `execFileSync` and no shell: `git rev-parse --short HEAD`, then `git status --porcelain`, `uncommitted` on any failure or output. No new dependency. (Req 8.4, 8.5)
  - [x] 5.3 Experiments line: create with header, append with the newline rule, UTC date, recall to 3 decimals, FP/h to 1 decimal; append before the regression exit. (Req 8.1 to 8.3)
  - [x] 5.4 Baseline: `--update-baseline` writes `docs/scores-<folder>.json` (folder = last segment of the resolved fixtures path; names with characters outside letters, digits, `-`, `_`, `.` give exit 2); otherwise compare, print deltas, exit 1 on regression; no baseline gives a note and exit 0. (Req 7.3 to 7.5, 9)
  - [x] 5.5 `runScore(argv, env)` with injected root, writers and commit lookup; entry wiring at the bottom of the file; root from `import.meta.url`. (Req 7.7)
  - [x] 5.6 Add `"score": "tsx scripts/score.ts"` to `package.json` `scripts`. Leave the other scripts, `exports` and dependencies unchanged. (Req 7.1)
  - [x] 5.7 Run `test/scripts.test.ts`. Expect PASS.

- [x] 6. Verify and commit
  - [x] 6.1 Run the full test suite and the TypeScript check. All earlier tests still pass, including the public API test of Task 8 (this task adds no export).
  - [x] 6.2 Run `npm run score -- <a temporary fixtures folder> <a temporary sounds.json>` once by hand in a throw-away copy of the project root or with the real `docs/` and then remove the experiments line and any `docs/scores-*.json` it created. Confirm the exit code and that no other file changed. Do not commit a baseline or an experiments line from synthetic data.
  - [x] 6.3 Check that nothing under `core/` imports `fs`, `path`, `node:` modules, DOM or Web Audio, that the only edit under `core/` is `SCORE_EPSILON`, and that no sample count or threshold is a literal number. Run `npm run check:public-api`. (Req 10.4, 10.5)
  - [x] 6.4 Check that no code sends audio over the network, that no report, baseline or experiments line holds samples, and that `sounds.json` is not written by this task. (Req 10.6)
  - [x] 6.5 Confirm no Korean text in tracked files (outside `docs/_planning/`) and that no temporary file or folder remains (test folders are removed in `afterEach`).
  - [x] 6.6 Add a line to `docs/devlog.md`: scoring done, spectrogram and PNG moved to Task 9b.
  - [x] 6.7 Commit with the message `feat: add scoring tool`.
