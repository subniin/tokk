# Design: Task 9a, Scoring tool

## Layer rule
`node/score.ts` and `scripts/score.ts` may use `fs/promises`, `path`, `child_process` and import from `core/`. Nothing under `core/` changes except one constant. Every threshold is in ms, Hz or dB with the unit in its name, every sample count comes from the sample rate and a constant, and every `t` is a cumulative sample count divided by the sample rate. The factor 1000 is a file-local `MS_PER_SECOND`, as in the other modules. No audio is sent anywhere or stored in a report, a baseline or the experiments file.

## Files
```
node/ score.ts                    (new)  scoreDir, compareToBaseline, matchEvents, ScoreReport and related types
scripts/ score.ts                 (new)  runScore (testable), commit lookup, entry wiring
core/ constants.ts                (edit) SCORE_EPSILON
package.json                      (edit) scripts.score only
docs/ experiments.md              (created by the first run of the script)
docs/ scores-<folder>.json        (created by --update-baseline, one per fixtures folder, e.g. scores-quick.json; committed by the user)
docs/ devlog.md                   (edit) one line
test/ score.test.ts, scripts.test.ts (add)
test/ helpers/score-fixture.ts    (new)  writes a synthetic fixture folder
.kiro/specs/task-09a-score/
```
`node/index.ts` and `core/index.ts` are not edited. Task 10 imports `node/score.ts` by relative path. The existing constants `MATCH_TOLERANCE_MS`, `REGRESSION_RECALL_DROP`, `REGRESSION_MIN_TRUTHS`, `REGRESSION_TP_DROP_COUNT` and `NOISE_FLOOR_WARMUP_MS` are used as they are.

## Constants
| Section | Name | Value | Used by |
|---|---|---|---|
| Scoring | `SCORE_EPSILON` | 1e-9 | tolerance comparison, recall drop comparison |

## Types (described, not code)
- `ScoreWarning`: file name, code (`no-labels`, `no-recording`, `sample-rate-mismatch`, `in-calibration`), message.
- `LabelScore`: label, truths, tp, fp, fn, inCalibration, precision, recall.
- `ScoreReport`: perLabel (list of `LabelScore`), falsePositivesPerHour, totalSeconds, inCalibration, confusion (map of truth-or-`none` to map of predicted label to count), warnings.
- `LabelComparison`: label, recallDelta, precisionDelta, tpDelta, baselineTruths, regression.
- `matchEvents(truths, predictions)`: pure function on two time-ordered lists of `{ label, t }` for one file. It returns the matched pairs (as indexes), the unmatched truth indexes and the unmatched prediction indexes. It is exported from `node/score.ts` for tests, not from `node/index.ts`.

## scoreDir flow
```
list dir (code-unit order) -> stems with wav and/or json
for each stem
  wav only   -> warning no-labels, skip
  json only  -> warning no-recording, skip
  both       -> parse labels (validate) ; read wav (wrap errors with file name)
                warn if json sampleRate differs from header (use header)
                totalSeconds += samples.length / sampleRate
                split truths: t < NOISE_FLOOR_WARMUP_MS / 1000  -> in calibration (counted, warned)
                predictions = runSamples(...).events of kind 'sound'
                matchEvents per label, then cross-label pairing for the confusion table
                accumulate tp, fp, fn, inCalibration per label and confusion counts
build perLabel (sorted), falsePositivesPerHour, sorted warnings
```
Both validation errors and read errors reject the whole call, so a half-read folder never gives a score that looks complete.

## Matching
Per file and per label: build all pairs `(truth i, prediction j)` with equal labels and `|t_j - t_i| * MS_PER_SECOND <= MATCH_TOLERANCE_MS + SCORE_EPSILON`. Sort by `|dt|`, then `i`, then `j`. Walk the list and take each pair whose two sides are free. This is the greedy nearest-first one-to-one rule of the plan. It is not the optimal assignment, but with a 50 ms window and sounds at least 80 ms apart (the segmenter's minimum gap) the two give the same answer in practice, and the rule is easy to explain.

Calibration events are removed from the truth list before matching, so they can neither match nor become `fn`. A prediction in the first second is matched like any other and counts as `fp` if no truth is near.

Confusion table, after the same-label pass: leftover predictions and leftover truths (of any label, not in calibration) go through the same sort-and-take procedure with the label condition reversed (labels must differ). Each such pair adds one at `[truth label][predicted label]`. The predictions that are still left add one at `['none'][label]`. Matched pairs add one at `[label][label]`, so the diagonal shows the hits and a row total is the number of truths that something answered. The table does not change `tp`, `fp` or `fn`.

Why a separate pass: a clap predicted as `knock` 20 ms after a truth `clap` is an `fp` for `knock` and an `fn` for `clap`. The confusion entry names the pair so that `sound-tuner` can see which sounds are mixed up.

## Calibration lead
`NOISE_FLOOR_WARMUP_MS` is the segmenter's first second, in which no onset is accepted (Task 4). The rule is on the label times, so a recording with a sound at 0.4 s is reported even when the engine happens to find nothing there. One warning per file names the count and the first time. The report keeps both a total and a per-label count, so a table can show why a label has fewer truths than the author labelled.

A truth at exactly 1.0 s is scored. An onset hop of a sound at 1.0 s ends after the warm-up, and Task 8 found the segmenter accepts it (see the Task 8 requirement 11.2 note). The `t < 1.0` comparison uses `SCORE_EPSILON` so that a time computed as `1000 / 1000` is not lost to rounding.

## compareToBaseline
For each label of the union, sorted: take the report entry and the baseline entry. A label absent from the report is read as tp 0, fp 0, fn 0, recall 0 when the baseline had truths. A label absent from the baseline is new and never a regression. Then:

- `baselineTruths = baseline.tp + baseline.fn`
- if `baselineTruths >= REGRESSION_MIN_TRUTHS`: `regression` is true when the recall drop is larger than `REGRESSION_RECALL_DROP` by more than `SCORE_EPSILON`, so a drop of exactly 0.02 passes
- else: `regression = tpDelta <= -REGRESSION_TP_DROP_COUNT`

Why two rules: with 20 truths one miss moves recall by 0.05, which is more than the 0.02 limit, and a single hit more or less is noise at that size. With 50 or more truths a recall change of 0.02 is one or more hits and is worth a look.

If the fixture set changes between baseline and report (more truths), recall is compared as a rate for 50 or more truths and `tp` as a count for fewer. The count rule then only fires on a real loss. This is why `baselineTruths` is read from the baseline and not from the report.

## Script
`runScore(argv, env)` returns the exit code and takes everything it needs from `env`: the project root, the output and error writers, and a commit lookup function. The file's bottom wires real values (`import.meta.url` for the root, `process.stdout`, `process.stderr`, the real lookup) and calls `process.exit` with the code. Tests call `runScore` with temporary folders, so they never touch the real `docs/`.

Order inside `runScore`:
1. Parse arguments: two positional values and the optional `--update-baseline`. Anything else is exit 2 with a usage line.
2. Read and check `sounds.json` (exit 2 on failure).
3. `scoreDir` (exit 2 on any rejection, with the message).
4. If the report has no labels and no scored file: exit 2.
5. Print the table, the confusion table and the totals. Print warnings to the error stream.
6. Compute the commit, append the experiments line (create the file if needed).
7. If `--update-baseline`: write `docs/scores-<name>.json`, print where, exit 0.
8. Else if `docs/scores-<name>.json` exists: read it (exit 2 if bad), compare, print deltas, exit 1 if any regression, else 0.
9. Else print that there is no baseline, exit 0.

Step 6 comes before steps 7 and 8, so the experiments line is written for every successful run, including a regression. It records what happened, which is the purpose of the file.

Output of a label row: `label  truths tp fp fn calib precision recall`, columns padded with spaces, numbers to 3 decimals. The format is for people. The experiments line is the only format that other tools might read.

## Experiments line
`2026-11-19 | a1b2c3d | clap 0.950, knock 0.900 | 1.2`

Header on creation: a title line, an empty line, then `date | commit | recall per label | FP/h` and a separator row. These are Markdown table rows, so the file reads as a table. Appended lines are table rows without edits to earlier text. When the file does not end in a newline, one is added first.

## Commit hash
`getCommit(folder)` runs two commands with `execFileSync('git', [...], { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })`:
1. `git rev-parse --short HEAD`. A failure (git missing, not a repository, no commit) returns `uncommitted`.
2. `git status --porcelain`. Any output returns `uncommitted`. A failure returns `uncommitted`.

Otherwise it returns the trimmed output of step 1. The arguments are fixed, nothing from the command line or a file reaches them, and no shell runs, so there is nothing to escape. `child_process` is a Node built-in, so no dependency is added. The folder is the project root, found from the script's own location, so the answer does not depend on where the command was started.

Dirty means any change or untracked file in the working tree, which includes the files a developer just edited. That is the intended meaning: the score belongs to the working tree and not to the last commit. The line is appended after this check, so the append itself does not make the hash `uncommitted`.

## Exit codes
| Code | Meaning |
|---|---|
| 0 | scored; no regression, no baseline, or baseline written |
| 1 | scored; at least one label regressed |
| 2 | wrong use, unreadable or invalid input, nothing to score, any unexpected error |

Warnings never change the code. A regression is printed with its label, truths, tp before and after, recall before and after.

## Tests
`test/helpers/score-fixture.ts` builds a fixture folder in a temporary directory: it takes a list of recordings (name, impacts with class and time, optional json overrides such as `sampleRate`), mixes impacts of a taught synthetic class into a quiet noise bed with `place` and `synthImpact`, writes WAV with `writeWavFile` and the label file with `JSON.stringify`. The model comes from the Task 8 helper `buildModel`, so the engine does real work. Folders are made with `mkdtemp` in the OS temp directory and removed in `afterEach`.

`test/score.test.ts`:
- perfect predictions: two recordings, precision and recall 1 for every label, `confusion` has only diagonal entries.
- 80 ms offset in the label file gives one `fp` and one `fn`; 40 ms gives a match.
- `matchEvents` with truths 0.20 and 0.26 and one prediction at 0.24 gives the pair (0.26, 0.24) and leaves truth 0.20 unmatched (nearest first).
- `falsePositivesPerHour`: the same spurious prediction in a recording twice as long gives half the rate (computed from `totalSeconds`).
- confusion: a `clap` truth answered as `knock` goes to `[clap][knock]`; a spurious prediction goes to `[none][...]`.
- calibration: a truth at 0.4 s is in calibration, warned, not in `truths`, not an `fn`; a truth at exactly 1.0 s is scored; a label with only calibration events has `truths` 0 and recall 1.
- skipped files: wav without json gives `no-labels` and is not in `totalSeconds`; json without wav gives `no-recording`.
- `sampleRate` in the json that differs from the header gives `sample-rate-mismatch`; the header value is the one used (the run still scores as expected).
- invalid label file (bad JSON, no `events`, negative `t`) and a 24-bit wav reject with the file name in the message; a missing directory rejects with `ENOENT`.
- `compareToBaseline` on hand-made reports: recall drop of 0.1 at 60 truths is a regression; exactly 0.02 at 50 truths is not; 0.03 is; 20 truths with one more miss is not; two more is; a new label is not; a lost label with truths is.

`test/scripts.test.ts` (added to the existing file) calls `runScore` with an in-memory writer and a temporary project root that has a `docs/` folder:
- no baseline gives 0 and creates `docs/experiments.md` with its header and one line.
- `--update-baseline` writes `docs/scores-<name>.json`; a second run on the same fixtures gives 0.
- a model that loses hits (for example trained on a different class) against that baseline gives 1; the experiments file has two lines.
- wrong argument count, unknown option, missing `sounds.json`, invalid baseline, an empty fixtures folder: 2, and no line is appended.
- `getCommit`: a plain temporary folder gives `uncommitted`; when `git --version` works, a temporary repository with one commit gives a hex string of 7 or more characters, and after a file is changed gives `uncommitted`. The repository is set up with `git -c user.name=test -c user.email=test@example.com`, so no global configuration is needed. The test is skipped when `git` is not installed.

Every sound in a normal fixture starts at or after a test-only lead of 1200 ms (`LEAD_MS`).

## Risks and rules
- **Baseline per fixtures folder.** The baseline file is `docs/scores-<name>.json`, where `<name>` is the last path segment of the resolved `fixturesDir` (`quick` gives `docs/scores-quick.json`, `full` gives `docs/scores-full.json`). Each set compares only with its own baseline, so recall rates and small-label `tp` counts are never mixed between sets. A folder name with characters outside letters, digits, `-`, `_` and `.` is exit 2, so the name cannot escape `docs/`. The hook task (11B) decides which set runs.
- **Greedy matching.** It can differ from an optimal assignment when two truths are within 100 ms of each other. The segmenter does not produce sounds closer than 80 ms, and a case like that is a fixture design problem. The rule is deterministic, which matters more here.
- **Calibration rule by label time.** A fixture whose labels are wrong by a few hundred ms can silently move events into or out of the first second. The warning lists the file and the first time so the author can check.
- **No recording and no labels.** An empty folder is an error for the script and an empty report for `scoreDir`, so that the MCP tool of Task 10 can decide how to show it.
- **Dirty tree.** A dev who scores before committing always gets `uncommitted`. The line still carries date, recall and FP/h. This is accepted.
- **Rounding.** All time comparisons use `SCORE_EPSILON`. Recall is stored unrounded in the baseline and rounded only in text output, so printing cannot create a false regression.
