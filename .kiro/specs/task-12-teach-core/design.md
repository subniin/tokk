# Design: Task 12, move the teaching logic into core

## Layer rule
`core/teach.ts` is pure TypeScript. No `fs`, `path`, DOM or Web Audio. No network, no clock, no `Math.random`. It imports only `core/` modules: `classify/knn` (`knnClassifier`, `trainVectors`, `classifyVector`, `TooFewExamplesError`), `constants`, `continuous/pitch` (`medianPitchHz`), `features` (`extractFeatures`), `segment` (`Segmenter`) and `types`. `node/teach.ts` keeps `fs/promises`, `path` and `node/files`. `web/` (later tasks) imports `core/teach.ts` by its internal path. `core/index.ts` is not touched, so the public API test passes unchanged.

Privacy: a `Recording` holds samples, but only in the caller's memory and inside this module's call stack. The returned model has the keys `id`, `label`, `v` per example and no samples. The report holds numbers and text. Nothing is sent anywhere.

## Interfaces
```ts
// core/teach.ts
export type Recording = { label: string; file: string; samples: Float32Array; sampleRate: number }
export type TeachWarning = { file: string; code: 'shorter-than-calibration' | 'sound-in-calibration'
  | 'no-sound-found' | 'no-pitch-found' | 'sample-rate-mismatch'; message: string }
export type TeachReport = { labels: { label: string; examples: number; looAccuracy: number }[];
  confusedPairs: { a: string; b: string; rate: number }[]; warnings: TeachWarning[] }

export function teachFromRecordings(recs: Recording[], o?: { emptyFolders?: string[] }): { model: SoundModel; report: TeachReport }
export function retrainLabel(model: SoundModel, label: string, recs: Recording[], o?: { keep?: string[] }): { model: SoundModel; report: TeachReport }
export function looReport(model: SoundModel, labels: string[]): Pick<TeachReport, 'labels' | 'confusedPairs'>

// node/teach.ts
export type { TeachReport, TeachWarning } from '../core/teach'
export async function teachFromDir(dir: string): Promise<{ model: SoundModel; report: TeachReport }>
```
`file` in a `Recording` is the plain file name. The label comes from the folder (Node) or from the name the user typed (browser). Everything that needs the path, a warning's `file` or an id prefix, builds `<label>/<file>`.

### One addition to the brief: `emptyFolders`
`teachFromDir` today reports two things that a list of recordings cannot express: an empty `hum` folder gives the warning `no-pitch-found` for `hum`, and an empty label folder counts as a label with 0 examples, so `TooFewExamplesError.counts` has `{ label: 0 }`. The existing tests cover the first (`names the hum folder when it holds no file`). To keep "same results and errors", `teachFromRecordings` takes an optional second argument with the names of folders that exist and hold no recording. The browser never passes it. Alternatives considered: (a) a fake empty `Recording` (breaks the "samples are real" meaning and would be counted as a file); (b) handling it in `teachFromDir` after the call (needs the counts and the sorting of warnings again, which means teaching rules in the reader). The optional argument is the smallest change.

## Constants
All existing from `core/constants.ts`: `BACKGROUND`, `BACKGROUND_MAX_EXAMPLES` (200), `BACKGROUND_WINDOW_MS` (300), `BACKGROUND_WINDOW_OVERLAP_PERCENT` (50), `CONFUSED_PAIR_MIN_RATE`, `LOO_MIN_EXAMPLES_PER_LABEL`, `MIN_EXAMPLES_PER_LABEL` (5), `NOISE_FLOOR_WARMUP_MS` (1000).

**Added by this task:** `HUM_LABEL = 'hum'` in the Teaching section, next to the background constants. `node/teach.ts` had it as a private `HUM_FOLDER`; the web layer and `retrainLabel` need the same name, and the rule says constants live in `core/constants.ts`. File-local in `core/teach.ts`: `MS_PER_SECOND` (1000) and `PERCENT` (100), the same kind of conversion factor `core/synth.ts` and `core/classify/knn.ts` keep local. `WAV_EXTENSION` stays in `node/teach.ts` (it is about files).

The warning code `'sample-rate-mismatch'` is a string in the union, not a constant. No other code in the repository may switch exhaustively over `TeachWarning['code']` without a default. Task 1 of `tasks.md` checks this.

## What moves and what stays
| Piece in `node/teach.ts` now | After the task |
|---|---|
| `TeachWarning`, `TeachReport`, `compareStrings`, `segmentsOf`, `startSample`, `endSample`, `backgroundWindows`, `calibrationWarnings`, `capEvenly`, `looReport`, `median` | moved to `core/teach.ts` unchanged in behaviour |
| The per-label loop (examples, background merge, cap, count check, `knnClassifier.train`, pitch, warning sort, report) | `teachFromRecordings` |
| `humFolderPitches` (reads files, then `medianPitchHz` and warnings) | The file reading stays in `node/teach.ts`; the median and warnings move into `teachFromRecordings` |
| `readLabelled` (wraps a read error with `<label>/<file>:` and `cause`), `readdir` filters, `WAV_EXTENSION` | stay in `node/teach.ts` |

`compareStrings` is also in `knn.ts`, private there. A private copy in `core/teach.ts` (three lines) is kept instead of exporting from `knn.ts`, because `knn.ts` is finished and tested, and the file `node/teach.ts` had its own copy as well.

## `teachFromRecordings` procedure
1. **Duplicates.** Sort a copy of `recs` by `label`, then `file` (code units; the input array and the recordings are not touched). Two neighbours with the same pair throw `RangeError` naming `<label>/<file>`.
2. **Group by label** in that order. Labels except `HUM_LABEL` form `labels`. `emptyFolders` names that are not already present are added as labels with no recordings (and sorted into place), except `HUM_LABEL`.
3. **Per label other than `hum`, per recording in order:** `segmentsOf` (a `Segmenter` run with `push` then `flush`), one candidate per segment with id `<label>/<file>#<n>`. For `background` add `backgroundWindows` and merge by start sample (segment first on a tie), as today. For other labels add `calibrationWarnings`. Background examples are capped with `capEvenly` over the **whole label** (all files together), as today.
4. **Count check.** `counts[label]` for every label, including 0. If there is no label or any count is below `MIN_EXAMPLES_PER_LABEL`, throw `TooFewExamplesError(counts)`.
5. **Train** with `knnClassifier.train(examples)`. The example list is in sorted label and file order, so the first example, and with it `model.sampleRate`, does not depend on the input order. (`trainVectors` sorts by id itself for everything else.)
6. **Hum.** For each `hum` recording in order, `medianPitchHz`; `null` gives a `no-pitch-found` warning with the text of today; the others feed `median`. If `emptyFolders` has `hum` and no `hum` recording exists, the folder warning of today. If any pitch was found, `model.pitch = { baselineHz: median }`.
7. **Sort warnings** by `file`, then `code`, code-unit comparison, and return `{ model, report: { ...looReport(model, labels), warnings } }`.

This is the order of the old function, except that reading is finished before step 1 (see "Risks"). Because nothing in steps 2 to 7 depends on the order of `recs` once step 1 is done, P8 holds for the whole result, report and warnings included.

## `retrainLabel` procedure
1. **Check input.** Every `rec.label === label` (else `RangeError`). Sort `recs` and reject duplicates as in step 1 above.
2. **New examples of `label`**
   - `hum`: no examples (see the rule table below).
   - `background`: candidates exactly as in step 3 above, capped at 200 over all given recordings, no calibration warnings.
   - other: segments with ids `<label>/<file>#<n>`, calibration warnings.
   Then, if `options.keep` is given, filter to the ids in it (a `Set`). The ids come from the same function that the dialog of Task 16 uses to show the segments, so they match by construction. Ids in `keep` that do not exist are ignored.
3. **Sample rate.** One `sample-rate-mismatch` warning per recording with `sampleRate !== model.sampleRate`, naming both rates in Hz. Segments are still made and used. `model.sampleRate` is passed unchanged to `trainVectors`.
4. **Vectors.** `extractFeatures` for each new segment. Other labels: `{ id, label, v }` copied from `model.examples`. For `hum` nothing new is added and the old examples all stay.
5. **Count check** over the new set, before training: counts for every label of the new set, `label` included even at 0. Fewer than `MIN_EXAMPLES_PER_LABEL` for any label throws `TooFewExamplesError(counts)`. (`hum` is exempt: it has no examples.)
6. **Train** with `trainVectors(all, model.sampleRate)`. Then `pitch`: copy the old `model.pitch` if there is one; for `hum`, replace it with the median of the new recordings' pitches when at least one is found, else keep the old one and add the warnings.
7. **Report** with `looReport(newModel, labels)` where `labels` are the labels of the new model in code-unit order. Warnings sorted as in `teachFromRecordings`.

The function never writes to `model` (`trainVectors` copies each `v`, and the unchanged vectors are copied too).

### Decision: how `background` and `hum` behave in `retrainLabel`
The brief asked for the simplest consistent rule. The rule is: **`retrainLabel(model, label, recs)` gives the same examples for `label` that `teachFromRecordings(recs)` would give for that label, then replaces the old ones.** Everything else follows from it.

| Label | In `teachFromRecordings` | In `retrainLabel` | Why this one |
|---|---|---|---|
| ordinary | all segments, calibration warnings | the same, then `keep` filter | the base rule |
| `background` | segments plus 300 ms / 50 % windows, cap 200 | the same, `keep` after the cap | Re-recording background in the dialog gives the same kind of examples as a first teaching. `keep` lists ids the user could see in the dialog, so the cap comes first. The standardisation still ignores background (`trainVectors`), so the other labels' scale does not move |
| `hum` | not an example label, sets `pitch.baselineHz` | not an example label, replaces `pitch.baselineHz`, `keep` ignored, examples untouched | A hum has no examples to keep or delete. A failed hum (no pitch found) must not erase a good baseline, so the old value stays and the warning says so |

Options rejected: (a) forbid `background` and `hum` in `retrainLabel`: the teach dialog (Task 16) and `teach.html` (Task 17) are meant to allow both (Task 17 allows them with a hint), and a special case in each caller would repeat the rule; (b) for `background`, add new windows to the old ones instead of replacing: that breaks "replaces only that label's examples" and lets the 200 cap be exceeded; (c) apply `keep` before the cap: a user could delete examples they cannot see.

### Decision: other points
- **Labels that do not match.** A recording whose `label` differs from the argument is a programming error in the caller. It throws `RangeError` instead of being silently relabelled.
- **Calibration warnings for `retrainLabel`.** Same as the first teaching: the dialog shows a 1 s quiet period (Task 16), and a sound in it is lost, so the warning is useful.
- **Mismatch is a warning, not an error.** The features are rate-independent for 44.1 kHz against 48 kHz, but a 16 kHz recording may be far off. The overlay already warns about the rate of the microphone (Task 15). Refusing here would block a user whose browser gives 48 kHz for a model taught at 44.1 kHz. The model keeps its rate so that the overlay comparison stays meaningful.
- **Kept examples of the label, none left.** Counts show `label: 0`, so the error message says which label is empty. For an existing label this means "you deleted every example", for a new label "you recorded nothing".
- **`looReport` is exported from the module** (plan file structure lists it) but not from `core/index.ts`. Its only caller outside the module is the test.

## `teachFromDir` after the change
1. `readdir(dir)` outside any try, so a missing directory rejects with the original error.
2. Folders: directories not starting with a dot, code-unit order.
3. For each folder, `readdir` again, keep files ending in `.wav` (case-insensitive), code-unit order. No file: the folder name goes to `emptyFolders`. Otherwise each file is read with `readWavFile`, and any error is rethrown as `<label>/<file>: <message>` with `cause`.
4. `teachFromRecordings(recs, { emptyFolders })`.

The `hum` folder is read like any other folder (its files become `Recording`s with the label `hum`). The result of the folder reading is the same, only the files of every folder are now in memory together, not one at a time. A folder has at most a few minutes of 16-bit audio (a 120 s background file is about 23 MB as `Float32Array` at 48 kHz), and teaching already holds each file's segments. Judged acceptable.

## Risks and rules
- **Error order.** Before, a file in the second folder with an unreadable header and a file in the first folder with a sample rate rejected by the `Segmenter` gave the `Segmenter` error first. Now the read error comes first. Each error alone is the same. This is the only observable difference and it needs two different bad files in one folder tree. Recorded here and in `docs/devlog.md`.
- **Equal results.** The proof is a test: `teachFromDir` and `teachFromRecordings` deep-equal on `fixtures/audio/synth/sounds`, plus all of `test/teach.test.ts` unchanged. If deep equality fails, the new code is wrong, not the test.
- **Warning union.** Adding a union member can break a `switch` that has no default. Task 1.4 of `tasks.md` searches for such uses.
- **Timing of LOO.** `looReport` retrains once per example, `O(n^3 d)` overall. At 240 examples it is the same cost as today. `retrainLabel` pays it on every save of the dialog. If Task 16 finds it too slow in the Worker, the report can be made lazy there. This task does not change it.
- **Public API.** `Recording`, `retrainLabel` and `teachFromRecordings` are not in `core/index.ts`. Plan 2 adds them to the browser API through `web/` later. No expectation of `test/public-api.test.ts` changes in this task, and none is changed to make a test pass.

## Tests (`test/teach-core.test.ts`)
Test-only values at the top of the file, not in `core/constants.ts`: sample rates (44100 Hz and 48000 Hz), hits per label, seed bases, gain in dB, the hum tone values (as in `test/teach.test.ts`), the `PBT_RUNS`-scaled timeouts. Recordings are built in memory with the helpers of `test/helpers/engine-fixture` (the same ones `test/teach.test.ts` uses) and `core/synth`. The helper that turns a label and a hit count into a `Recording` is local to the file.

Fixtures: a small set (three impact classes, 6 to 8 hits per file, one or two files per label, one `hum` file and one `background` file of a few seconds) for the property test and the `retrainLabel` tests, so the leave-one-out step stays short. The folder test uses `fixtures/audio/synth/sounds`.

| # | Name | Requirement |
|---|---|---|
| 1 | `teachFromDir` and `teachFromRecordings` give deep-equal model and report for `fixtures/audio/synth/sounds` (the test reads the folder itself into `Recording[]`) | 2.1, 3.1 |
| 2 | recordings in any order, including a reversed list, give the same model and report | 2.8 |
| 3 | the input array and the recordings are not modified | 1.5 |
| 4 | `teachFromRecordings` gives the ids `<label>/<file>#<n>` and `background/<file>#w<w>`, and examples hold only `id`, `label`, `v` | 2.2, 2.3, 1.5 |
| 5 | a `hum` recording sets `pitch.baselineHz` near the tone, is not a label, and does not count toward the minimum | 2.4 |
| 6 | a `hum` recording of noise warns `no-pitch-found` for `hum/<file>` and sets no pitch | 2.4, 2.5 |
| 7 | `emptyFolders` with `hum` warns for `hum`; with another name throws `TooFewExamplesError` with that label at 0 | 2.9, 2.7 |
| 8 | two recordings with the same label and file throw `RangeError` naming them | 2.10 |
| 9 | `retrainLabel` leaves the vectors, ids and labels of every other label equal to `model.examples` (bit for bit) | 4.2 |
| 10 | `retrainLabel` equals `trainVectors` over the unchanged vectors plus the new ones (so `mean`, `std` and `thresholds` cover all labels), and differs from the old model in `mean` or `std` | 4.3 |
| 11 | retraining a label with its own original recordings reproduces the model (deep equal; the old `pitch` is kept) | 4.2, 4.3, 4.11 |
| 12 | `keep` drops the deleted segments: only the listed ids remain for the label, other ids in `keep` are ignored, order and duplicates in `keep` do not matter | 4.6 |
| 13 | a new label is added, with its own threshold, and `report.labels` lists it in code-unit order | 4.4, 4.13 |
| 14 | 4 kept examples reject with `TooFewExamplesError`, `counts` with the label at 4 and the others at their counts; keeping none gives 0 | 4.7 |
| 15 | a 48 kHz recording on a 44.1 kHz model adds one `sample-rate-mismatch` warning per recording, keeps `model.sampleRate`, and still uses the segments | 4.8 |
| 16 | a recording whose `label` differs from the argument throws `RangeError` | 4.5 |
| 17 | `retrainLabel` for `background` makes window examples, caps at 200, and applies `keep` after the cap | 4.9 |
| 18 | `retrainLabel` for `hum` replaces `pitch.baselineHz`, leaves the examples, `mean`, `std` and `thresholds` alone, and ignores `keep`; a noise recording keeps the old pitch and warns | 4.10 |
| 19 | `retrainLabel` leaves the input `model` unchanged (deep-equal to a copy made before) and the result has no `samples` anywhere | 4.1, 1.5 |
| 20 | the source of `core/teach.ts` has no import of `fs`, `path`, `node:`, no `document`, `window`, `AudioContext`, `fetch`, `Math.random`, `Date`, `performance` | 1.4 |

Property test (name ends with `(Req 2.8)`): **P8 extended.** Generates a permutation of the small recordings fixture (`fc.shuffledSubarray` of full length). Asserts that `teachFromRecordings` returns deep-equal model and report to the one computed once from the sorted list. A second property case does the same for `retrainLabel` over a shuffled `recs` of the retrained label.

Existing tests that must still pass without a changed expectation: all of `test/teach.test.ts` (labels from folder names, ids, too few, ENOENT, 24-bit error with `cause`, repeatability, background windows and the 200 cap, warnings and their sort, `expectEvents`, the hum tests), `test/public-api.test.ts`, the sounds-rebuild and MCP tests.

Runtime target: `test/teach-core.test.ts` under 30 s at `PBT_RUNS=100` and under 15 s at `PBT_RUNS=20`, to be measured. The pool is shrunk before the run count is lowered.

## Measured values
Filled in during the work: runtime of `test/teach-core.test.ts` at `PBT_RUNS` 20 and 100, runtime of `test/teach.test.ts` before and after (should be equal within noise), and any difference found by test 1 together with its cause.

Recorded later: with `PBT_RUNS=1000`, `test/teach-core.test.ts` plus `test/teach.test.ts` passed, 47 tests, 224 s (measured 2026-11-20 by the operator).
