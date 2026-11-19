# Requirements: Task 9a, Scoring tool

## Introduction
Task 9 of the plan is split. This spec covers the scoring half only: `node/score.ts` (`scoreDir`, `ScoreReport`, `compareToBaseline`) and `scripts/score.ts` (`npm run score -- <fixturesDir> <sounds.json>`). The spectrogram and PNG half (`core/spectrogram.ts`, `node/png.ts`) becomes a separate later spec, `task-09b`, and is not part of this task.

A fixture is a recording `x.wav` with a label file `x.json` (design 8.9). `scoreDir` runs every labelled recording through the engine and compares the sounds the engine found with the labels. The script prints the result, appends one line to `docs/experiments.md`, compares with a stored baseline in `docs/scores-<folder name>.json` (one baseline per fixtures folder, for example `docs/scores-quick.json`, so the quick and full sets never compare against each other), and exits with 1 on a regression (design 8.2, hook `corpus-score`).

| Consumer | What it uses from this task |
|---|---|
| Task 10 (MCP `score`) | `scoreDir`, `ScoreReport`, imported from `node/score.ts` (it is not added to the public `tokk/node` API) |
| Task 11B (hook `corpus-score`) | `npm run score` on `fixtures/audio/quick/`, its exit codes, the experiments line |
| Task 9b (spectrogram) | Nothing. The two halves share no code |
| Experiments E1 to E5 | The report, the confusion table and false positives per hour |

Out of scope: `fixtures/audio/quick/` and `full/` themselves, the hook file, the MCP tool, spectrogram, PNG.

## Requirements

### Requirement 1: Fixture format and file discovery
**User story:** As a developer, I want to put a recording and its labels side by side and have both read without extra configuration.

#### Acceptance Criteria
1. THE `scoreDir(dir, sounds)` function SHALL read the files directly inside `dir` (no subfolders), in plain code-unit order. A file name ending in `.wav` or `.json` in any letter case counts. THE stem (name without extension) pairs `x.wav` with `x.json`.
2. THE label file SHALL be a JSON object with `events`, an array of `{ label: string, t: number }` (`t` in seconds from the start of the recording, finite and not negative), and the fields `device` (string), `room` (string) and `sampleRate` (number, the real `AudioContext.sampleRate` of the recording). Only `events` is required for scoring. `device` and `room` are not used by scoring.
3. IF a `.wav` has no `.json`, THEN `scoreDir` SHALL skip it, SHALL NOT count its duration, and SHALL add a warning with code `no-labels` and the file name.
4. IF a `.json` has no `.wav`, THEN `scoreDir` SHALL ignore it and add a warning with code `no-recording`.
5. IF a label file is not valid JSON, has no `events` array, or has an entry with a missing `label`, a non-string `label`, or a `t` that is not a finite number of at least 0, THEN `scoreDir` SHALL reject with an error whose message starts with the file name and says what is wrong. IF a `.wav` cannot be read (for example 24-bit PCM), THEN it SHALL reject with an error whose message starts with the file name and contains the `readWav` message, with the original error as `cause`. No partial report SHALL be returned.
6. IF the label file has a `sampleRate` that differs from the sample rate in the WAV header, THEN `scoreDir` SHALL add a warning with code `sample-rate-mismatch` naming both values, and SHALL use the header value. A missing `sampleRate` SHALL give no warning.
7. IF no recording with labels is found, THEN `scoreDir` SHALL return a report with `totalSeconds` 0 and no labels. THE script treats this as an error (Requirement 9.5).
8. IF `dir` does not exist, THEN `scoreDir` SHALL reject with the file system error unchanged.

### Requirement 2: Running the engine
**User story:** As a developer, I want the score to describe what the real engine does.

#### Acceptance Criteria
1. FOR each labelled recording, `scoreDir` SHALL read the file with `readWavFile` and call `runSamples(samples, sampleRate, sounds)` with no patterns. THE predictions SHALL be the events of `kind: 'sound'`, with their `label` and `t`. Sounds reported as `unknown` SHALL NOT be predictions.
2. THE `totalSeconds` of the report SHALL be the sum, over the scored recordings, of the sample count divided by the sample rate of that file. Skipped recordings SHALL NOT count.
3. THE function SHALL NOT write any file, SHALL NOT use the network, and SHALL NOT keep audio in the report. (privacy rule)

### Requirement 3: Calibration lead
**User story:** As a person who records fixtures, I want to be told when a labelled sound is in the first second, because the engine cannot hear it.

The segmenter accepts no onset in the first `NOISE_FLOOR_WARMUP_MS` (1000 ms). A fixture therefore needs at least 1 s of calibration lead before its first sound. A sound in that second is lost without any error, and it must not count as a miss of the engine.

#### Acceptance Criteria
1. A labelled event with `t < NOISE_FLOOR_WARMUP_MS / 1000` seconds SHALL be counted as **in calibration**. It SHALL be left out of matching, out of `tp` and `fn`, and out of recall. An event at exactly 1.0 s is not in calibration.
2. THE report SHALL hold the number of in-calibration events, in total (`inCalibration`) and per label (`perLabel[].inCalibration`).
3. FOR each file with at least one in-calibration event, THE report SHALL hold one warning with code `in-calibration`, the file name, the number of events and the `t` of the first one, and a message that says the recording needs 1 s of lead.
4. THE rule SHALL depend only on the labelled `t`, not on what the engine found. A prediction in the first second (from a sound the engine did hear) SHALL be matched like any other prediction and, with no truth to match, count as a false positive.
5. A label with all its events in calibration SHALL have `tp + fn` of 0 for that label (see Requirement 5.3 for its recall).

### Requirement 4: Matching
**User story:** As a developer, I want a clear rule for what counts as a hit, a miss and a false alarm.

#### Acceptance Criteria
1. WITHIN one file, A prediction and a truth SHALL match when they have the same label and `|t_prediction - t_truth| * 1000 <= MATCH_TOLERANCE_MS` (50 ms, inclusive; computed with a rounding allowance of `SCORE_EPSILON`).
2. MATCHING SHALL be one-to-one and nearest first: collect all candidate pairs, sort by time difference ascending (ties by truth index, then prediction index, both in time order), and take a pair when neither side is already taken.
3. EVERY matched pair SHALL count as a `tp` of its label. EVERY prediction without a match SHALL count as an `fp` of its predicted label. EVERY truth (not in calibration) without a match SHALL count as an `fn` of its label. A prediction 80 ms from a truth of the same label SHALL therefore be one `fp` and one `fn`.
4. MATCHING SHALL never cross files.

### Requirement 5: ScoreReport
**User story:** As a developer, I want numbers per sound, a confusion table and a false alarm rate.

#### Acceptance Criteria
1. THE type `ScoreReport` SHALL hold: `perLabel` (list of `{ label, truths, tp, fp, fn, inCalibration, precision, recall }`), `falsePositivesPerHour`, `totalSeconds`, `inCalibration`, `confusion`, and `warnings` (list of `{ file, code, message }`, codes `no-labels`, `no-recording`, `sample-rate-mismatch`, `in-calibration`). THE report SHALL be plain JSON data (numbers, strings, arrays, objects), so that it can be stored as the baseline.
2. THE `perLabel` list SHALL hold every label that appears as a truth or as a prediction, sorted by label in code-unit order. FOR each: `truths = tp + fn` (without in-calibration events).
3. THE `precision` SHALL be `tp / (tp + fp)`, and 1 when `tp + fp` is 0. THE `recall` SHALL be `tp / (tp + fn)`, and 1 when `tp + fn` is 0.
4. THE `falsePositivesPerHour` SHALL be the sum of `fp` over all labels divided by `totalSeconds`, times 3600, and 0 when `totalSeconds` is 0.
5. THE `confusion` table SHALL be keyed `confusion[truthOrNone][predicted]` with counts, built in two steps. (a) Every matched pair adds 1 at `[label][label]`. (b) The predictions left over after matching are matched, nearest first and one-to-one under the same 50 ms rule, against the truths left over (not in calibration) that have a **different** label. Such a pair adds 1 at `[truth label][predicted label]`. (c) Each prediction still left adds 1 at `['none'][predicted label]`. A truth that nothing matched appears only as `fn`, not in the table.
6. STEP 5.5(b) SHALL NOT change `tp`, `fp` or `fn`. A prediction with the wrong label is an `fp` of the predicted label and the truth is an `fn` of its own label, in addition to the confusion entry.
7. THE report SHALL be identical on every run for the same files and model (no clock, no randomness, files in code-unit order).
8. THE `perLabel`, `confusion` keys and `warnings` SHALL be written in a fixed order (sorted by code-unit order; warnings by file, then code) so that a stored baseline gives stable diffs.

### Requirement 6: compareToBaseline and the regression rule
**User story:** As a developer who edits `core/`, I want to be told when a change makes recognition worse, and not be bothered by noise.

#### Acceptance Criteria
1. THE `compareToBaseline(report, baseline)` function SHALL return one entry per label that is in the baseline or in the report, sorted by label: `{ label, recallDelta, precisionDelta, tpDelta, baselineTruths, regression }`. A label that is in the baseline and missing from the report SHALL be read as `tp 0` and, when the baseline has truths for it, `recall 0` (the label was lost). A label that is only in the report is covered by criterion 4.
2. `recallDelta = report.recall - baseline.recall`, `precisionDelta` likewise, `tpDelta = report.tp - baseline.tp`.
3. **Regression rule (design 8.2).** THE `baselineTruths` is `tp + fn` of the baseline. IF `baselineTruths >= REGRESSION_MIN_TRUTHS` (50), THEN `regression` SHALL be true when the recall dropped by more than `REGRESSION_RECALL_DROP` (0.02), that is `recallDelta < -0.02`. OTHERWISE it SHALL be true when `tp` dropped by `REGRESSION_TP_DROP_COUNT` (2) or more, that is `tpDelta <= -2`. A drop of exactly 0.02 is not a regression. A drop of exactly 2 hits is.
4. A label that is only in the report (new) SHALL have `regression` false.
5. PRECISION and `falsePositivesPerHour` SHALL be reported but SHALL NOT decide a regression. (The design's rule covers recall only.)
6. A baseline with 20 truths, scored again with one more miss, SHALL NOT be a regression. Scored with two more misses it SHALL be.

### Requirement 7: Script, output and options
**User story:** As a developer, I want one command that prints the result and tells me whether I broke something.

#### Acceptance Criteria
1. THE command `npm run score -- <fixturesDir> <sounds.json>` SHALL be defined by a `score` entry in `package.json` `scripts` that runs `scripts/score.ts` with `tsx`. THE option `--update-baseline` MAY follow the two paths. Other `scripts`, `exports` and dependencies SHALL stay unchanged.
2. THE script SHALL read `sounds.json`, check that it is an object with `version` 1 and an `examples` array, and run `scoreDir`. It SHALL print a table to the standard output: one row per label with `truths`, `tp`, `fp`, `fn`, `inCalibration`, `precision`, `recall` (3 decimals), then the confusion table, then `falsePositivesPerHour`, `totalSeconds` and the in-calibration total. Warnings SHALL be printed to the standard error, one per line, with the file name.
3. WHEN a baseline for the fixtures folder exists (`docs/scores-<name>.json`, where `<name>` is the last path segment of the resolved `fixturesDir`) and `--update-baseline` is not given, THE script SHALL call `compareToBaseline`, print one line per label with its deltas and mark each regression, and print the verdict.
4. IF the baseline file of the fixtures folder does not exist and `--update-baseline` is not given, THEN the script SHALL print a note that there is no baseline and exit 0.
5. THE `--update-baseline` option SHALL write the report as `docs/scores-<name>.json` (2-space JSON, a final newline, replacing the file), and SHALL skip the comparison.
6. THE script SHALL contain no audio: the baseline and the experiments line hold counts and rates only. (privacy rule)
7. THE script SHALL take the project root from the location of the script file, not from the working directory, so that `docs/` is found whichever folder the command runs in. Paths given on the command line are resolved against the working directory.

### Requirement 8: Experiments line and commit hash
**User story:** As a maintainer, I want every score run recorded, so that the experiment log fills itself.

#### Acceptance Criteria
1. AFTER a successful scoring (before the regression exit), THE script SHALL append one line to `docs/experiments.md`: `<date> | <commit> | <recall per label> | <FP/h>`. THE date SHALL be the UTC date as `YYYY-MM-DD`. THE recall list SHALL be `label recall` pairs separated by commas, in label order, recall with 3 decimals. THE FP/h SHALL be `falsePositivesPerHour` with 1 decimal.
2. IF `docs/experiments.md` does not exist, THEN the script SHALL create it with a one-line title, a header row for the four columns, and then the line. IF it exists, THE script SHALL only append, with a newline before the line when the file does not end in one, and SHALL NOT change earlier text.
3. THE script SHALL append the line also when a regression is found and also with `--update-baseline`. It SHALL NOT append when the input is invalid (exit 2).
4. THE commit SHALL come from `git rev-parse --short HEAD`, run with Node's built-in `child_process` (`execFileSync`, no shell, fixed arguments) in the project root. THE value SHALL be `uncommitted` when the working tree is dirty (`git status --porcelain` prints anything, untracked files included), when `git` is not installed, when the folder is not a git repository, or when there is no commit yet. No dependency SHALL be added.
5. THE commit lookup SHALL be a small function that takes the folder as an argument, so that tests can point it at a temporary folder.

### Requirement 9: Exit codes
**User story:** As a hook author, I want exit codes that separate a regression from a broken command.

#### Acceptance Criteria
1. EXIT 0: the score ran, and there is no regression, or there is no baseline, or `--update-baseline` wrote it.
2. EXIT 1: the score ran and at least one label has `regression` true (Requirement 6.3). THE script SHALL name the labels.
3. EXIT 2: the command is used wrongly (missing or extra argument, unknown option), `sounds.json` cannot be read or is not a model, a fixture or WAV file is invalid (Requirement 1.5), `fixturesDir` does not exist, a `fixturesDir` whose last path segment has characters outside letters, digits, `-`, `_` and `.` (the baseline name must stay inside `docs/`), or any other unexpected error. THE script SHALL print the reason to the standard error and print a usage line for wrong use.
4. THE baseline `docs/scores-<name>.json`, if present but not valid JSON or not a report, SHALL give exit 2.
5. IF no recording with labels is found in `fixturesDir`, THEN the script SHALL print an error and exit 2 (a score of nothing must not look like a pass).
6. THE script SHALL not exit 1 for warnings.

### Requirement 10: Tests, constants, layers and privacy
**User story:** As a maintainer, I want the rules enforced by tests and by the layout.

#### Acceptance Criteria
1. THE tests SHALL write synthetic fixtures (WAV from `writeWavFile`, labels as JSON) into a temporary folder made per test and removed in `afterEach`. EVERY labelled sound in a normal fixture SHALL start at or after 1200 ms (test-only constant with its unit in the name), except in the tests of Requirement 3.
2. THE tests SHALL cover: perfect predictions give precision and recall 1; a prediction 80 ms off counts as one `fp` and one `fn`; a prediction 40 ms off matches; one-to-one nearest-first matching with two close truths; `falsePositivesPerHour` scales with `totalSeconds`; the confusion table with a correct, a wrong-label and a spurious prediction; `compareToBaseline` reports a recall drop of 0.1 as a regression for a label with 50 truths or more; a label with 20 truths missing one more is not a regression and two more is; a drop of exactly 0.02 at 50 or more truths is not a regression; the calibration lead rule (event at 0.4 s is counted as in calibration, excluded from recall, warned; event at 1.0 s is not); a wav without json is skipped with a warning; a json `sampleRate` that differs from the header gives a warning and the header value is used; invalid label files and unreadable wav files reject with the file name.
3. THE script tests SHALL cover: exit 0 without a baseline; `--update-baseline` writes `docs/scores-<name>.json` and exits 0; a baseline of one folder is not used for another folder; a worse model against that baseline exits 1; usage errors and an unreadable `sounds.json` exit 2; the experiments line is created and appended; the line is appended also on exit 1; the commit lookup gives `uncommitted` outside a git repository and, when `git` is available, a short hash for a clean temporary repository and `uncommitted` once a file is changed.
4. EVERY threshold and time constant SHALL be a named constant with its unit in `core/constants.ts`, which already holds `MATCH_TOLERANCE_MS`, `REGRESSION_RECALL_DROP`, `REGRESSION_MIN_TRUTHS`, `REGRESSION_TP_DROP_COUNT` and `NOISE_FLOOR_WARMUP_MS`. THIS task SHALL add only `SCORE_EPSILON` (a rounding allowance for comparisons, unitless). Sample counts SHALL be derived from the sample rate. Times `t` SHALL be a cumulative sample count divided by the sample rate, in seconds. The factor 1000 is a file-local `MS_PER_SECOND`.
5. `node/score.ts` MAY import `fs/promises`, `path` and `core/`. Nothing under `core/` SHALL change except the constants file. `core/index.ts` and `node/index.ts` SHALL NOT change, so the public API test of Task 8 stays valid.
6. NO code of this task SHALL send audio over the network or store recorded samples in `sounds.json`, the baseline or the experiments file.
