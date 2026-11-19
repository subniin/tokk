# Requirements: Task 8, Engine, teachFromDir and expectEvents

## Introduction
Task 8 joins the finished modules into one engine and adds the Node tools around it. `createEngine` takes audio chunks and calls handlers when a pattern matches. `runSamples` runs a whole buffer through the same engine. `teachFromDir` turns a folder of recordings into a `SoundModel` and a self-check report. `expectEvents` checks a recording against a list of expected sound names. `core/index.ts` and `node/index.ts` are the public entry points, published as `tokk` and `tokk/node`.

The flow is `Segmenter -> classifier -> SoundEvent -> Matcher` (design 4.1). The continuous path (hum pitch) is built in Task 6, which comes later in the execution order (`... 11B -> 6 -> 9`). Until then the engine runs a no-op tracker behind a small internal interface. Every hum-related test is `test.todo` until Task 6 wires the real tracker.

| Consumer | What it uses from this task |
|---|---|
| Task 6 (PitchTracker) | The `ContinuousTracker` interface. It replaces the no-op tracker in one place and turns the hum `test.todo` entries into tests |
| Task 9 (score) | `runSamples`, `readWavFile` |
| Task 10 (MCP) | `teachFromDir`, `runSamples`, the `TeachReport` with its warnings |
| Apps (plan 2 and 3) | `createEngine`, `runSamples`, `knnClassifier`, `readWav`, `writeWav` from `tokk`; `teachFromDir`, `expectEvents` from `tokk/node` |
| Review Focus 2, 3 | Empty and silent input, folders with too few examples, a single-label folder |
| P1 | Count preservation, tested in `test/engine.test.ts` |

## Requirements

### Requirement 1: Engine construction
**User story:** As an app developer, I want one call that wires everything, so that I only supply sounds, handlers and a sample rate.

#### Acceptance Criteria
1. THE `createEngine(o)` function SHALL accept `{ sounds, sampleRate, on?, modes?, mode?, onEvent?, classifier? }` and SHALL return `{ push(chunk), flush(), setMode(name) }`. `Handlers` SHALL be `Record<string, (m: MatchEvent) => void>`.
2. IF `sampleRate` is not finite, or is below `SAMPLE_RATE_MIN_HZ` (16000) or above `SAMPLE_RATE_MAX_HZ` (96000), THEN `createEngine` SHALL throw a `RangeError` that names `sampleRate` and the allowed range.
3. THE option `on` SHALL mean `modes: { default: on }, mode: 'default'`.
4. IF both `on` and `modes` are given, THEN `createEngine` SHALL throw. IF `modes` is given without `mode`, or `mode` names a mode that is not in `modes`, THEN it SHALL throw an error that lists the available mode names.
5. WHEN neither `on` nor `modes` is given, THE engine SHALL work with an empty pattern list. It still reports events through `onEvent`.
6. THE engine SHALL check every pattern of every mode when it is created (by building a `Matcher` for each mode), so that a bad pattern fails at creation and not at `setMode`.
7. THE classifier SHALL default to `knnClassifier`. WHEN `classifier` is given, THE engine SHALL use it with `sounds` unchanged.
8. THE `Matcher` for the active mode SHALL be created with `Object.keys(handlers)` and `sounds.pitch?.baselineHz`.

### Requirement 2: Processing of one chunk
**User story:** As a developer, I want each sound to become exactly one event or one `unknown`, so that handlers see clean events.

#### Acceptance Criteria
1. WHEN `push(chunk)` is called, THE engine SHALL pass the chunk to the segmenter and to the tracker (Requirement 7), classify every segment the segmenter returns, in time order, and pass the resulting events to the matcher.
2. FOR a segment that overlaps a range of `tracker.voicedRanges()`, THE engine SHALL NOT classify it. A range with `end` null SHALL be treated as lasting until the current time. THE segment SHALL produce no event and no `unknown`. (Design 15: a segment during a hum is not classified.)
3. WHEN the result is `unknown`, THE engine SHALL call `onEvent({ kind: 'unknown', t, nearest })` with the `t` of the segment, and SHALL NOT send anything to the matcher.
4. WHEN the result is a match with label `background` (`BACKGROUND`), THE engine SHALL drop the segment: no `onEvent` call and no matcher call.
5. WHEN the result is any other match, THE engine SHALL build `{ kind: 'sound', label, t, durationMs, confidence }` from the segment and the result, call `onEvent`, then pass the event to the matcher.
6. THE engine SHALL call the handler named by `MatchEvent.pattern` of the active mode for every match the matcher returns, in the order returned. A handler error SHALL propagate to the caller of `push` or `flush`.
7. THE engine SHALL compute the current time as the total number of samples pushed divided by `sampleRate`. It SHALL NOT read a clock.
8. WHEN the chunk is empty, THE engine SHALL do nothing. THE engine SHALL NOT modify or keep a pushed chunk.

### Requirement 3: Matcher time follows the segmenter lookahead
**User story:** As a user who knocks twice, I want "knock knock" to fire once, even though the engine learns about each knock late.

#### Acceptance Criteria
1. THE engine SHALL know about a sound only after its segment closes, which is later than the sound itself: an isolated `low` impact closes about 390 ms after its onset, and a re-onset (a fast second hit inside an open segment) is confirmed `REONSET_CONFIRM_MS` (70 ms) after its candidate hop.
2. AT the end of every `push`, THE engine SHALL call `matcher.advance(target)` with `target = min(now - ENGINE_ADVANCE_MARGIN_MS, segmenter.openSegmentStart() ?? Infinity)`, where `now` is the time of Requirement 2.7 in seconds and `ENGINE_ADVANCE_MARGIN_MS` is `SEGMENT_HOP_MS + ONSET_LEAD_MS` (10 ms).
3. THE margin SHALL cover a sound whose onset hop has not been analyzed yet: such a sound has `t` of at least `now - SEGMENT_HOP_MS - ONSET_LEAD_MS`, so the matcher is never advanced past it.
4. WHILE a segment is open, THE segmenter's `openSegmentStart()` SHALL keep reporting the start of the old segment until a pending re-onset is confirmed (Task 4 design). THE engine SHALL rely on this and SHALL NOT keep its own record of candidates.
5. WITH the patterns `low` and `low low`, TWO `low` impacts 250 ms apart SHALL fire only `low low`. TWO `low` impacts 300 ms apart SHALL also fire only `low low`. (At 300 ms the first sound reaches the engine about 370 ms after it began, which is past the 350 ms limit. Only the advance rule of 3.2 keeps `low` from firing too early.)
6. WITH the pattern `low` only, ONE `low` impact followed by silence SHALL fire `low` without `flush`, once 350 ms have passed after the impact `t`, and `MatchEvent.t` SHALL equal the sound's `t`.

### Requirement 4: Modes
**User story:** As an app developer, I want to switch pattern sets by screen.

#### Acceptance Criteria
1. THE `setMode(name)` function SHALL switch the handlers and call `matcher.setPatterns` with the keys of the new mode. It SHALL drop a pending sequence (Task 7 behaviour).
2. IF `name` is not a mode, THEN `setMode` SHALL throw an error that lists the available mode names and SHALL leave the current mode unchanged.

### Requirement 5: flush and chunk independence
**User story:** As a developer, I want a file run and a microphone run to give the same answer.

#### Acceptance Criteria
1. THE `flush()` function SHALL, in this order: flush the tracker and handle its events, flush the segmenter, classify the returned segments, send events to the matcher, then call `matcher.advance(Infinity)` and call the handlers of its matches.
2. AFTER `flush()`, THE engine SHALL accept more `push` calls and continue the same timeline.
3. FOR any chunking of the same samples, THE events passed to `onEvent` and the matches passed to the handlers SHALL be equal, including their `t` values. (The segmenter is chunk independent, Task 4 P3, and the engine adds no state that depends on chunk boundaries.)

### Requirement 6: runSamples
**User story:** As a test author, I want to run a whole buffer in one call.

#### Acceptance Criteria
1. THE `runSamples(samples, sampleRate, sounds, patterns?)` function SHALL create an engine with a handler per pattern, push all samples in one call, call `flush`, and return `{ events: SoundEvent[], matches: MatchEvent[], unknowns: number[] }`.
2. THE `events` list SHALL hold every event given to `onEvent` that is a `SoundEvent` (sound and continuous), in order. THE `unknowns` list SHALL hold the `t` of every `unknown`, in order. THE `matches` list SHALL hold every `MatchEvent`, in order.
3. WHEN `patterns` is missing, THE `matches` list SHALL be empty.
4. WHEN `samples` is empty, or all zeros, THE result SHALL be three empty lists and no exception (Review Focus 2).
5. THE `sampleRate` check of Requirement 1.2 SHALL apply.

### Requirement 7: Continuous tracker interface (before Task 6)
**User story:** As the author of Task 6, I want a clear socket for the pitch tracker, so that wiring it needs no change to the engine rules.

#### Acceptance Criteria
1. THE file `core/continuous/tracker.ts` SHALL export `PitchEvent` (`Extract<SoundEvent, { kind: 'continuous' }>`), the interface `ContinuousTracker` with `push(chunk): PitchEvent[]`, `flush(): PitchEvent[]` and `voicedRanges(): { start: number; end: number | null }[]` (times in seconds), and `noopTracker(): ContinuousTracker` whose three methods return `[]`.
2. THE engine SHALL create its tracker through one internal function `createTracker(sampleRate)` in `core/engine.ts`. IN Task 8 it SHALL return the no-op tracker. Task 6 SHALL change only that function (it makes `new PitchTracker(sampleRate)`, which `implements ContinuousTracker`). The tracker SHALL NOT be an option of `createEngine` and SHALL NOT be exported from `core/index.ts`.
3. THE engine SHALL pass the events a tracker returns to `onEvent` and to the matcher, before the segment events of the same call, and SHALL treat `voicedRanges()` as in Requirement 2.2. With the no-op tracker these paths do nothing.
4. THE following tests SHALL be `test.todo` in Task 8 and SHALL be turned on by Task 6: an impact during an active hum is not classified; `hum.rise` fires through the engine for a rising hum; the P1 variant with a hum before the impacts; the `hum` folder of `teachFromDir` sets `pitch.baselineHz` near the tone frequency; the review item 12 check that the synthetic `low` class is not taken for a hum.

### Requirement 8: teachFromDir, examples
**User story:** As a developer, I want to put recordings in folders and get a model.

#### Acceptance Criteria
1. THE `teachFromDir(dir)` function SHALL read `dir/<label>/*.wav` and return `Promise<{ model: SoundModel, report: TeachReport }>`. THE folder name SHALL be the sound name. Files that do not end in `.wav` (any letter case) and folders that start with `.` SHALL be ignored. Labels and files SHALL be processed in plain code-unit order, so that the result does not depend on the file system order.
2. FOR each file, THE function SHALL read it with `readWavFile`, run a new `Segmenter` over all its samples in one `push` plus `flush`, and use **every** segment as an example (one file may hold several recordings). THE example `id` SHALL be `"<label>/<file name>#<segment number>"`, with segment numbers from 0 in time order.
3. THE segmentation SHALL be the same as the engine sees at run time. THE function SHALL NOT change thresholds or skip the calibration period.
4. IF any label ends with fewer than `MIN_EXAMPLES_PER_LABEL` (5) examples, including a folder with no usable file (0 examples), THEN `teachFromDir` SHALL reject with `TooFewExamplesError` whose `counts` has an entry for every label folder, including zero counts (Review Focus 3).
5. IF `dir` has no label folders, THEN it SHALL reject with `TooFewExamplesError` with empty `counts`. IF `dir` does not exist, THEN it SHALL reject with the file system error unchanged.
6. THE folder with a single label SHALL give a model that classifies its own sound and rejects a far one as `unknown` (Review Focus 3, Task 5 behaviour).
7. IF a file cannot be read as WAV (for example 24-bit PCM), THEN `teachFromDir` SHALL reject with an error whose message starts with the relative file path and contains the `readWav` message (Review Focus 1). THE original error SHALL be its `cause`.
8. THE model SHALL hold feature vectors only: every entry of `model.examples` has exactly the keys `id`, `label`, `v`, and `v.length` is `FEATURE_LENGTH`. THE function SHALL NOT write any file and SHALL NOT use the network. (privacy rule)
9. THE function SHALL train through `knnClassifier.train`.

### Requirement 9: The background folder
**User story:** As a developer, I want steady noise to be taught as background, although it never opens a segment.

#### Acceptance Criteria
1. FOR a folder named `background` (`BACKGROUND`), THE function SHALL use the segments (Requirement 8.2) **and** fixed windows of `BACKGROUND_WINDOW_MS` (300 ms) with `BACKGROUND_WINDOW_OVERLAP_PERCENT` (50%) overlap, taken over the whole file from sample 0. THE window length in samples SHALL be `round(300 x sampleRate / 1000)` and the step SHALL be `round(window x (100 - 50) / 100)`. Only complete windows count.
2. THE windows SHALL NOT depend on onsets or on the calibration period. STEADY noise in the first second of a file SHALL give windows from sample 0.
3. A window whose samples are all exactly 0 SHALL be skipped (digital silence has no peak to normalize and carries no information).
4. THE `id` of a window SHALL be `"background/<file name>#w<window number>"`, numbered from 0 in time order, so that it never equals a segment id.
5. WHEN the segments and windows of all `background` files together are more than `BACKGROUND_MAX_EXAMPLES` (200), THE function SHALL keep exactly 200 of them, chosen evenly: with `n` candidates ordered by file, then by start time within a file (a segment before a window with the same start), keep the candidate at index `floor(j x n / 200)` for `j` from 0 to 199.
6. A `background` file SHALL NOT produce the calibration warnings of Requirement 11.1 and 11.2, because its windows do not depend on the calibration period.

### Requirement 10: The hum folder (before Task 6)
**User story:** As a developer, I do not want a `hum` folder to turn into a fake sound class.

#### Acceptance Criteria
1. UNTIL Task 6, a folder named `hum` SHALL NOT be used as examples and SHALL NOT appear in `report.labels`. THE report SHALL hold one warning with code `hum-folder-ignored`, `file` = `hum`, and a message that says hum teaching is not available yet. `model.pitch` SHALL be undefined.
2. TASK 6 SHALL replace this behaviour: it SHALL set `model.pitch.baselineHz` to the median of `medianPitchHz` over all files of the folder, and SHALL remove the warning. The test for that is `test.todo` in Task 8 (Requirement 7.4).

### Requirement 11: Warnings for sound lost in the calibration period
**User story:** As a user who records examples, I want to be told when a recording is too short or starts too fast, because that sound is lost without any error.

The segmenter accepts no onset in the first `NOISE_FLOOR_WARMUP_MS` (1000 ms) (Task 4 Requirement 5.5). A sound that starts there is not found, and a file shorter than that gives no segment.

#### Acceptance Criteria
1. FOR a file of a non-background folder with fewer samples than `round(NOISE_FLOOR_WARMUP_MS x sampleRate / 1000)`, THE report SHALL hold a warning with code `shorter-than-calibration`, the relative file path in `file`, and a message with the file length and the 1000 ms limit.
2. FOR a file of a non-background folder, THE function SHALL find sound that starts in the first second by a second run: run a `Segmenter` over the samples preceded by `round(NOISE_FLOOR_WARMUP_MS x sampleRate / 1000)` zeros. A segment of that run whose start, after subtracting the padding, is before `NOISE_FLOOR_WARMUP_MS` and which overlaps no segment of the real run at its start SHALL count as lost. WHEN at least one is lost, THE report SHALL hold one warning per file with code `sound-in-calibration`, the file path, and the start time of the first lost sound in the message. A sound whose onset hop ends just after 1000 ms is found by the real run and SHALL NOT be reported.
3. THE padded run SHALL be used for warnings only. Examples come from the real run (Requirement 8.3).
4. FOR a file of a non-background folder with no segment in the real run, THE report SHALL hold a warning with code `no-sound-found` (in addition to 11.1 or 11.2 when those apply).
5. A file that has none of these problems SHALL give no warning. A report with nothing to warn about SHALL have `warnings: []`.
6. THE warnings SHALL be sorted by file path, then by code, in code-unit order.

### Requirement 12: TeachReport, looAccuracy and confusedPairs
**User story:** As a developer, I want to see which sounds the model confuses before I ship it.

#### Acceptance Criteria
1. THE type SHALL be `TeachReport = { labels: { label: string; examples: number; looAccuracy: number }[]; confusedPairs: { a: string; b: string; rate: number }[]; warnings: TeachWarning[] }` with `TeachWarning = { file: string; code: 'shorter-than-calibration' | 'sound-in-calibration' | 'no-sound-found' | 'hum-folder-ignored'; message: string }`. THE `labels` list SHALL be sorted by label in code-unit order and SHALL include `background` when it was taught.
2. FOR every example, THE function SHALL train a model on all other examples with the same training code as the final model (`trainVectors`, with the minimum count lowered by one so that a label with exactly 5 examples can lose one, see design), classify the held-out feature vector with `classifyVector` (k = 3, standardization, threshold, unknown rejection), and record the outcome. THE function SHALL NOT use a nearest-neighbour shortcut.
3. THE outcome SHALL count as correct only when the result is a `match` with the example's own label. An `unknown` SHALL count as wrong and SHALL NOT count for any pair.
4. THE `looAccuracy` of a label SHALL be correct outcomes divided by its example count.
5. THE `confusedPairs` list SHALL hold every ordered pair (`a` = true label, `b` = predicted label, `a != b`) whose `rate` = (examples of `a` classified as `b`) / (examples of `a`) is at least `CONFUSED_PAIR_MIN_RATE` (0.1). IT SHALL be sorted by `rate` descending, then `a`, then `b`.
6. FOR the same folder, THE report SHALL be identical on every run (no randomness, no clock).
7. FOR four well separated synthetic classes with 10 examples each, `looAccuracy` SHALL be at least 0.9 for every label and `confusedPairs` SHALL be empty.

### Requirement 13: expectEvents
**User story:** As a developer, I want to test a recording against a list of sound names.

#### Acceptance Criteria
1. THE `expectEvents(wavPath, expected, { sounds })` function SHALL read the file with `readWavFile`, call `runSamples` with no patterns, take the `label` of every event with `kind: 'sound'` in order, and resolve when the list equals `expected`.
2. IF the lists differ, THEN it SHALL reject with `ExpectEventsError`, which has the properties `expected` and `actual` (arrays of names) and a message that shows both lists. WHEN the run also had `unknown` sounds, THE message SHALL name their count and times, so that the reader sees why a sound is missing.
3. THE `ExpectEventsError` SHALL NOT be thrown for an `unknown` sound that `expected` does not list. Only the sound labels are compared.
4. WHEN the file cannot be read or the sample rate is out of range, THE original error SHALL reject unchanged.

### Requirement 14: Public API and package exports
**User story:** As an app author, I want a small public surface with two entry points.

#### Acceptance Criteria
1. THE file `core/index.ts` SHALL export at runtime exactly: `createEngine`, `runSamples`, `knnClassifier`, `readWav`, `writeWav`. IT SHALL export these types: `Segment`, `SoundEvent`, `SoundModel`, `Nearest`, `ClassifyResult`, `Classifier`, `MatchEvent`, `Handlers`, `EngineOptions`, `Engine`, `RunResult`. IT SHALL NOT export the `Segmenter`, `Matcher`, trackers, constants or `TooFewExamplesError`.
2. THE file `node/index.ts` SHALL export at runtime exactly: `teachFromDir`, `expectEvents`, `ExpectEventsError`, `TooFewExamplesError` (re-exported from `core/classify/knn`), `readWavFile`, `writeWavFile`. IT SHALL export the types `TeachReport` and `TeachWarning`.
3. THE `package.json` SHALL get an `exports` map with `"."` pointing at `./core/index.ts` and `"./node"` pointing at `./node/index.ts`. Each entry SHALL give `types` and `default` the same file, because the package has no build step yet. Switching the targets to built files belongs to the publishing task (plan 2). THE existing `scripts`, `main` and dependencies SHALL stay unchanged.
4. THE test SHALL check the export names of both index files and that both `exports` targets exist.
5. FILES under `core/` SHALL NOT import `fs`, `path`, `node:` modules, DOM or Web Audio APIs (layer rule). FILES under `node/` MAY import from `core/`.

### Requirement 15: P1, count preservation (statistical acceptance)
**User story:** As a developer, I want N taught sounds to give N events, whatever the volume, noise and rhythm, and never an event that did not happen.

#### Acceptance Criteria
1. FOR N from 1 to 5 impacts of one taught synthetic class, with the gap between consecutive impact starts, the gain of each impact between -20 dB and +6 dB (one gain per case), and white background noise at a signal-to-noise ratio from `P1_SNR_MIN_DB` (20 dB) to `P1_SNR_MAX_DB` (30 dB), THE engine (through `runSamples`) SHALL be tested as a **rate** over a fixed set of cases (15.7). A case is **exact** when it returns exactly N events, all with the label of that class.
2. THE model SHALL be trained at one gain only, through the real path (`Segmenter` over isolated impacts, then `knnClassifier.train`), with four classes in the model: `low`, `mid`, `high` and `ring`. EACH training example SHALL be its own recording with white background noise from sample 0 at an SNR drawn from 15 to 30 dB (measured as in 15.3), with seeds different from the test seeds. THE run SHALL be at 44100 or 48000 Hz, with the model trained at the same rate. **Why:** users teach in the room where they use the app. A model trained without noise rejected noisy impacts as `unknown` even at 25 to 28 dB SNR (for example `[44100, high, N=1, gain -9, SNR 28, seed 98792]`: nearest `ring` at 7.86), because noise shortens the segment and shifts the features. The classifier thresholds stay unchanged.
3. THE signal-to-noise ratio SHALL be measured as the loudest `LEVEL_WINDOW_MS` (10 ms) RMS level of the clean impact minus the RMS level of the noise, both in dBFS. WITH several impacts, THE ratio SHALL hold for each of them: the noise level is set from the quietest clean impact. THE ratio SHALL NOT use the sample peak, because the segmenter sees RMS levels (several dB below the peak).
4. THE samples SHALL be clamped to the range -1 to +1 before the run, as a converter would.
5. THE test SHALL be split in two:
   - **P1** draws the class from `mid` and `high` and the gap from `P1_GAP_MIN_MS` (210 ms) to 600 ms.
   - **P1b** draws the class from `low` and `ring` and the gap from `P1_SLOW_CLASS_MIN_GAP_MS` (440 ms) to 600 ms.
   Both use the same gain, noise and N ranges.
6. EVERY sound in P1 and P1b SHALL start at or after 1200 ms. THE noise SHALL run from sample 0, so that the noise floor is calibrated before the first impact.
7. **Acceptance.** EACH test SHALL draw its cases from a fixed seed (`rng` of `core/synth.ts`, no fast-check shrinking): `P1_CASES_DEFAULT` (150) cases in the default `npm test`, and `P1_CASES_FULL` (300) cases WHEN `PBT_RUNS` is at least 300. A test SHALL pass only when (a) the exact rate is at least `P1_EXACT_RATE_MIN` (98 %), (b) no case returns more events than N (an over-count is a false trigger, worse than a miss), and (c) no case returns a wrong label, and every missing event is explained by an `unknown`. ON failure, THE test SHALL report the rate, the counts of over-counts, under-counts and wrong labels, and the first 3 failing cases.
8. **Why a rate (owner decision 2026-11-19).** THE classifier is statistical: its per-label thresholds are learned from 10 noisy examples per class, so a new impact can land just past its class threshold for one noise realization. Example: `[44100, "mid", 2, gap 214, gain 0, SNR 28, seed 274038]`, an uncut 205 ms `mid` segment, nearest `mid` examples at 7.05, 7.09 and 7.13 against the `mid` threshold 7.04; the same clip 500 ms later in other noise samples was a `mid` match at 6.42. Zero misses over random noise cannot be guaranteed, so a shrinking property that requires every case to be exact fails at some seed. What must hold for every case is the safe failure mode: never more events, never a wrong label. **Measured** (2026-11-19, `PBT_RUNS=300`, 300 cases each): P1 exact 99.7 % (299 of 300, one under-count as `unknown`: `[48000, high, N=3, gap 600, gain -9, SNR 20, seed 123181]`), P1b exact 99.7 % (one under-count as `unknown`: `[44100, ring, N=3, gap 540, gain -8, SNR 22, seed 489078]`), 0 over-counts, 0 wrong labels. Default run (150 cases each): both 100 %.
9. **Known limits (narrowed ranges, owner decisions 2026-11-19).**
   - THE SNR lower bound SHALL be 20 dB. **Why:** a real tap or clap is usually far above room noise, and below 20 dB the onset line and the 9 dB span to the offset line leave too little room. Measured single-impact detection for `low` (30 seeds, 44.1 kHz, two-hop onset rise of the second round): 25/30 at 15 dB, 29/30 at 18 dB, 30/30 at 20 dB. Experiment E2 on real recordings SHALL check this bound.
   - **Truncation.** A hit that arrives before the previous impact's segment would naturally end cuts that segment short. The cut segment's features differ from the isolated training examples and it can be classified `unknown` (about 2 per 1,000 cases at the earlier ranges, P1 gaps from 150 ms and P1b gaps from 300 ms). THE gaps therefore start just above the measured length of an uncut segment: about 205 ms for `mid` (P1 from 210 ms) and about 430 ms for `ring` (P1b from 440 ms). Segmentation of 100 ms doubles stays covered by the Task 4 test `two impacts 100 ms apart give two segments`. **Follow-up (not in this task):** make classification robust to truncated segments, for example with a fixed analysis span from the onset or truncation-aware teaching. To be decided after real recordings (experiments E1 and E3).
### Requirement 16: Tests, constants and privacy
**User story:** As a maintainer, I want the rules of the project enforced by tests and by the layout of the files.

#### Acceptance Criteria
1. EVERY sound in every engine and teach test SHALL start at or after 1000 ms. THE tests SHALL use a lead of at least 1200 ms (a test-only constant, named with its unit) before the first sound.
2. EVERY threshold and time constant SHALL be a named constant with its unit in `core/constants.ts`. THIS task SHALL add `ENGINE_ADVANCE_MARGIN_MS` (`SEGMENT_HOP_MS + ONSET_LEAD_MS`), `LOO_MIN_EXAMPLES_PER_LABEL` (`MIN_EXAMPLES_PER_LABEL - 1`) and `CONFUSED_PAIR_MIN_RATE` (0.1). Sample counts SHALL be derived from the sample rate and a constant, never written as numbers. Times `t` SHALL be a cumulative sample count divided by the sample rate, in seconds.
3. NO code of this task SHALL send audio over the network, SHALL write recorded samples into a model, or SHALL write recordings anywhere. Recordings stay in the local `sounds/` folders.
4. THE only change to a finished module SHALL be the optional third parameter of `trainVectors` in `core/classify/knn.ts` (design), with its test. Its default behaviour SHALL stay the same.
