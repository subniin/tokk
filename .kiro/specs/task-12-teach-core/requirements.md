# Requirements: Task 12, move the teaching logic into core

## Introduction
Task 12 is the first task of plan 2 (browser layer). Today the whole teaching procedure lives in `node/teach.ts` and is mixed with reading folders and `.wav` files. The browser (`teach.html`, `ears.teach`) has no folders: it has recordings in memory. So the procedure moves to a new pure module `core/teach.ts` that works on recordings, and `node/teach.ts` shrinks to reading folders and calling it. A browser model and a `npm run sounds:rebuild` model then come from the same code and are the same model (plan 2, architecture).

The task also adds `retrainLabel`, the operation behind the teach dialog of Task 16: replace the examples of one label with the segments of new recordings, keep every other label's feature vectors as they are, and retrain the whole model (design 5.1). It needs no recordings of the other labels, because `sounds.json` holds feature vectors only.

| Consumer | What it uses from this task |
|---|---|
| `node/teach.ts` (`teachFromDir`) | `teachFromRecordings`, and the types `TeachReport` and `TeachWarning` (re-exported, names unchanged) |
| `scripts/sounds-rebuild.ts`, the MCP `teach` tool | `teachFromDir` and `TeachReport` through `node/teach.ts`. They do not change |
| Task 14 (Worker, tests) | `teachFromRecordings` to build a 48 kHz model inside a browser test |
| Task 16 (`ears.teach`) | `retrainLabel`, `keep` for deleted examples, `sample-rate-mismatch` for the overlay and dialog |
| Task 17 (`teach.html`) | `teachFromRecordings` on a whole folder, deep-equal to `teachFromDir` on the same folder |
| P8 (order independence) | Extended from examples to whole recordings |

The rules of `teachFromDir` are moved without change. The only new behaviour is `retrainLabel` and the warning code `sample-rate-mismatch`. `core/index.ts` and `test/public-api.test.ts` do not change: `web/` imports `core/teach.ts` by its internal path, and no runtime name is added to the public API.

## Requirements

### Requirement 1: The pure module `core/teach.ts`
**User story:** As a developer of the browser layer, I want the teaching rules in one portable module, so that the browser and Node cannot disagree.

#### Acceptance Criteria
1. THE module `core/teach.ts` SHALL export the type `Recording` with the fields `label` (string), `file` (string, the file name inside the label folder, without the folder), `samples` (`Float32Array`) and `sampleRate` (number, Hz).
2. THE module SHALL export the types `TeachReport` and `TeachWarning`, with the same fields as today. `TeachWarning.code` SHALL be the four existing codes plus `'sample-rate-mismatch'`.
3. THE module SHALL export `teachFromRecordings`, `retrainLabel` and `looReport` (the leave-one-out report moved from `node/teach.ts`). THE names SHALL NOT be exported from `core/index.ts`.
4. THE module SHALL NOT import `fs`, `path`, DOM or Web Audio APIs, SHALL NOT call the network, `Math.random`, the clock or `performance`, and SHALL have no imports except `core/` modules (layer rule).
5. THE module SHALL NOT keep, return or log any sample. THE model it returns SHALL hold feature vectors only: every entry of `model.examples` has exactly the keys `id`, `label` and `v`, and neither the model nor the report contains a `Float32Array` or the key `samples` (privacy rule). The `Recording` objects belong to the caller and SHALL NOT be modified.
6. THE name of the hum label SHALL be a constant `HUM_LABEL` (`'hum'`) in `core/constants.ts`. THE labels `background` and `hum` are the only reserved names.

### Requirement 2: `teachFromRecordings` keeps every rule of `teachFromDir`
**User story:** As a user, I want the same recordings to give the same model whether they were read from a folder or recorded in the browser.

#### Acceptance Criteria
1. THE function SHALL take `Recording[]` and return `{ model: SoundModel; report: TeachReport }`. THE result for the recordings of a folder SHALL be deep-equal (model and report, bit for bit) to the result `teachFromDir` gave for that folder before this task.
2. **All segments are examples.** FOR each recording of a label other than `background` and `hum`, THE function SHALL run the `Segmenter` over the whole recording and use every segment as an example with the id `<label>/<file>#<n>`, `n` counted from 0 per file.
3. **Background.** FOR the label `background`, THE function SHALL use the segments of each file and, in addition, fixed windows over the whole file from sample 0: `BACKGROUND_WINDOW_MS` (300 ms) long, a step of `100 - BACKGROUND_WINDOW_OVERLAP_PERCENT` percent of the window (50 % overlap), window and step counted in samples from the sample rate and the constants, never hard-coded. A window with only zero samples SHALL be skipped. THE window id SHALL be `background/<file>#w<w>`, with `w` the index of the window before the skipping, and its `t` SHALL be its start sample divided by the sample rate. THE candidates of a file SHALL be ordered by start sample, a segment before a window that starts at the same sample. WHEN the label has more than `BACKGROUND_MAX_EXAMPLES` (200) candidates, THE function SHALL keep exactly 200 at the indices `floor(j x count / 200)`.
4. **Hum.** THE recordings with the label `hum` SHALL NOT become examples and SHALL NOT appear in `report.labels` or `report.confusedPairs`, and SHALL NOT count toward `MIN_EXAMPLES_PER_LABEL`. FOR each, THE function SHALL take `medianPitchHz(samples, sampleRate)`. WHEN at least one gives a pitch, THE model SHALL get `pitch: { baselineHz }` with `baselineHz` the median of those values (the mean of the two middle values for an even count), and `pitch` SHALL have no other key. WHEN none gives a pitch, THE model SHALL have no `pitch`.
5. **Warnings.** FOR each recording of a label other than `background` and `hum`, THE function SHALL add the calibration warnings exactly as before: `shorter-than-calibration`, `sound-in-calibration` (found with a second run over the samples preceded by `NOISE_FLOOR_WARMUP_MS` of zeros, for warnings only) and `no-sound-found`, with the same texts. FOR each `hum` recording without a pitch, THE function SHALL add `no-pitch-found` with the same text. THE field `file` of a warning SHALL be `<label>/<file>`. THE warnings SHALL be sorted by `file`, then by `code`, by code-unit comparison.
6. **Report.** `report.labels` SHALL list every label except `hum` in code-unit order with its example count and its leave-one-out accuracy, and `report.confusedPairs` SHALL list the pairs at or above `CONFUSED_PAIR_MIN_RATE`, sorted by rate descending, then by `a`, then by `b`. THE report SHALL be computed with `looReport`, which trains with `LOO_MIN_EXAMPLES_PER_LABEL` as before.
7. **Errors.** WHEN there is no label, or any label has fewer than `MIN_EXAMPLES_PER_LABEL` examples after the rules above, THE function SHALL throw `TooFewExamplesError` with `counts` holding the example count of every label, including labels with 0 examples (a silent file). A label other than `hum` that appears only in `emptyFolders` (Requirement 2.9) counts 0.
8. **Order independence.** THE function SHALL sort the recordings by `label`, then by `file`, with plain code-unit comparison (not the locale), before it does anything else. FOR any permutation of the same recordings, THE model and the report SHALL be deep-equal (P8 extended). `model.sampleRate` SHALL be the sample rate of the first example in that sorted order.
9. **Folders without files.** THE function SHALL accept an optional second argument `{ emptyFolders?: string[] }`, the names of label folders that exist and hold no recording. THE `hum` entry SHALL give the warning `no-pitch-found` with `file` `hum` and the text used today ("The hum folder has no .wav file ..."). ANOTHER name SHALL count as a label with 0 examples (Requirement 2.7). This argument exists only so that `teachFromDir` can keep its results and errors for empty folders. THE browser does not use it.
10. WHEN two recordings have the same `label` and `file`, THE function SHALL throw a `RangeError` that names `<label>/<file>`, before any other work. (Example ids would collide, and the sorted order would be ambiguous.)
11. ERRORS from the `Segmenter` (a sample rate outside 16 kHz to 96 kHz) and from `medianPitchHz` SHALL pass through unchanged. THE function SHALL NOT add a file name to them.

### Requirement 3: `teachFromDir` becomes a thin reader
**User story:** As a user of `npm run sounds:rebuild` and the MCP `teach` tool, I want nothing to change.

#### Acceptance Criteria
1. THE function `teachFromDir(dir)` SHALL list the label folders (directories not starting with a dot, code-unit order), list the `.wav` files of each (extension compared without case, code-unit order), read each with `readWavFile`, build the `Recording[]` with `file` the plain file name, and call `teachFromRecordings`. IT SHALL NOT contain any teaching rule.
2. THE folders without a `.wav` file SHALL be passed as `emptyFolders`.
3. THE results and the errors SHALL be the same as before: a missing directory rejects with the file system error unchanged (`ENOENT`); a file that cannot be read rejects with an error whose message starts with `<label>/<file>:` and whose `cause` is the original error (for example a 24-bit file, message containing `16-bit PCM`); `TooFewExamplesError` has the same `counts`. Where a folder holds two different kinds of error, which one is reported first MAY change (all files are read before the teaching starts); each kind alone is unchanged.
4. THE module `node/teach.ts` SHALL keep exporting the types `TeachReport` and `TeachWarning` (re-exported from `core/teach.ts`). `node/index.ts`, `core/index.ts`, `scripts/sounds-rebuild.ts` and `test/public-api.test.ts` SHALL NOT change. The runtime names of the public API stay exactly as listed in that test.
5. `node/teach.ts` SHALL NOT write any file and SHALL NOT use the network.

### Requirement 4: `retrainLabel`
**User story:** As a user who teaches one sound again in the running app, I want only that sound's examples replaced, and the other sounds left as they were.

#### Acceptance Criteria
1. THE function SHALL take `(model, label, recs, options?)`, with `options.keep` an optional list of example ids, and return `{ model: SoundModel; report: TeachReport }`. IT SHALL NOT modify `model` or `recs`.
2. **Only this label changes.** THE new model SHALL hold, for every label other than `label`, exactly the entries `{ id, label, v }` of `model.examples` (same ids, same vectors, no new feature extraction). THE examples of `label` in `model.examples` SHALL be dropped completely and replaced by the examples made from `recs`.
3. **Whole model retrained.** THE new model SHALL be the result of `trainVectors` over all kept vectors, so `mean`, `std` and `thresholds` are computed again over all labels (the standardisation covers all labels). THE model SHALL be deep-equal to what `trainVectors` gives for the same vector set. `version`, `k` and the example order follow `trainVectors`.
4. **New label.** WHEN `label` is not in the model, THE function SHALL add it.
5. **Recordings.** EVERY entry of `recs` SHALL have `rec.label` equal to `label`, OTHERWISE the function SHALL throw a `RangeError` naming the recording. THE segments and ids of a recording SHALL be made with the same rules as in Requirement 2 (ids `<label>/<file>#<n>`), the recordings sorted as in Requirement 2.8, and duplicates rejected as in Requirement 2.10.
6. **keep.** `keep` is a list of ids of the examples made from `recs` (after the background cap of Requirement 4.9). WHEN it is given, only those examples SHALL be used. Ids not in the list of new examples SHALL be ignored. WHEN `keep` is not given, all SHALL be kept. THE order of `keep` and duplicates in it SHALL NOT matter.
7. **Too few.** WHEN `label` has fewer than `MIN_EXAMPLES_PER_LABEL` examples after `keep`, THE function SHALL throw `TooFewExamplesError` whose `counts` has every label of the new model, including `label` with 0. THE check SHALL come before the training, as in `teachFromRecordings`.
8. **Sample rate.** FOR each recording whose `sampleRate` differs from `model.sampleRate`, THE function SHALL add a warning with the code `sample-rate-mismatch`, `file` equal to `<label>/<file>`, and a message with both rates in Hz. THE recording SHALL still be used. THE new `model.sampleRate` SHALL equal the old one.
9. **Background.** WHEN `label` is `background`, THE function SHALL make the candidates exactly as `teachFromRecordings` does (segments plus windows, Requirement 2.3, capped at 200), and apply `keep` after the cap, so that `keep` lists ids the user could see.
10. **Hum.** WHEN `label` is `HUM_LABEL`, THE function SHALL NOT change any example, and `keep` SHALL be ignored. THE medians of the recordings SHALL be computed as in Requirement 2.4. WHEN at least one gives a pitch, `pitch.baselineHz` SHALL be their median. WHEN none does, THE old `pitch` SHALL stay, and the `no-pitch-found` warnings SHALL be added. THE mean, standard deviation and thresholds SHALL be unchanged in value, because the vectors are unchanged. No `TooFewExamplesError` is raised for `hum`.
11. **Pitch kept.** FOR every label other than `hum`, THE new model SHALL keep `model.pitch` of the old model unchanged (`trainVectors` does not set it).
12. **Warnings.** FOR a label other than `background` and `hum`, THE function SHALL add the calibration warnings of Requirement 2.5 for the new recordings only. THE warnings SHALL be sorted as in Requirement 2.5.
13. **Report.** THE report SHALL be computed by `looReport` over the new model, with the labels of the new model in code-unit order (`hum` is not a label).

### Requirement 5: Behaviour that must not change
**User story:** As a maintainer, I want this refactor to be invisible except for the new function.

#### Acceptance Criteria
1. ALL tests in `test/teach.test.ts` SHALL pass without any change to their expectations. THE same holds for every other existing test, including `test/public-api.test.ts`.
2. THE constants in `core/teach.ts` SHALL be taken from `core/constants.ts` (`BACKGROUND`, `BACKGROUND_MAX_EXAMPLES`, `BACKGROUND_WINDOW_MS`, `BACKGROUND_WINDOW_OVERLAP_PERCENT`, `CONFUSED_PAIR_MIN_RATE`, `LOO_MIN_EXAMPLES_PER_LABEL`, `MIN_EXAMPLES_PER_LABEL`, `NOISE_FLOOR_WARMUP_MS`) plus the new `HUM_LABEL`. No threshold, count or time constant SHALL be written in the file without a name, a unit in the name and a place in `core/constants.ts`. Only unit conversion factors (`MS_PER_SECOND`, `PERCENT`) stay file-local, as in `core/synth.ts` and `core/classify/knn.ts`.
3. EVERY time SHALL be computed as a cumulative sample count divided by the sample rate, in seconds. NO sample count SHALL be hard-coded: window, step and calibration padding come from the sample rate and the millisecond constants.
4. `node/teach.ts` SHALL keep `HUM_FOLDER` only as an alias of `HUM_LABEL`, or use `HUM_LABEL` directly. THE strings `'hum'` and `'background'` SHALL NOT be repeated as literals in new code.
5. THE `.kiro` hooks, `npm run sounds:rebuild` and the MCP `teach` tool SHALL give the same text output for the same folder as before.

### Requirement 6: Tests
**User story:** As a maintainer, I want the new behaviour fixed by tests that fail first.

#### Acceptance Criteria
1. THE new file `test/teach-core.test.ts` SHALL hold the tests of Requirements 1 to 4, listed in `design.md`. THE existing `test/teach.test.ts` SHALL stay as it is.
2. THE property test for order independence SHALL end its name with `(Req 2.8)` and use `test.prop` from `@fast-check/vitest` without setting `numRuns` (`test/setup.ts` reads `PBT_RUNS`).
3. THE tests SHALL build recordings in memory from the synthetic sounds. THE one test that reads a folder SHALL read `fixtures/audio/synth/sounds`. NO test SHALL write outside the temporary directory of the test, and no test SHALL need the network.
