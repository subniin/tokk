# Design: Task 8, Engine, teachFromDir and expectEvents

## Layer rule
`core/engine.ts`, `core/continuous/tracker.ts` and `core/index.ts` are pure TypeScript: no `fs`, `path`, `node:` modules, DOM or Web Audio, no clock, no `Math.random`. `node/teach.ts`, `node/expect.ts` and `node/index.ts` may use `fs/promises` and `path`, and import from `core/`. Every threshold is in ms, Hz or dB with the unit in its name, every sample count comes from the sample rate and a constant, and every `t` is a cumulative sample count divided by the sample rate. The factor 1000 is a file-local `MS_PER_SECOND`, as in `core/synth.ts` and `core/grammar.ts`.

## Files
```
core/ continuous/tracker.ts   (new)  PitchEvent, ContinuousTracker, noopTracker
core/ engine.ts               (new)  createEngine, runSamples, Handlers, EngineOptions, Engine, RunResult
core/ index.ts                (new)  public API of "tokk"
core/ constants.ts            (edit) three constants
core/ classify/knn.ts         (edit) optional third parameter of trainVectors
node/ teach.ts                (new)  teachFromDir, TeachReport, TeachWarning
node/ expect.ts               (new)  expectEvents, ExpectEventsError
node/ index.ts                (new)  public API of "tokk/node"
package.json                  (edit) "exports" only
test/ engine.test.ts, teach.test.ts, public-api.test.ts   (new)
test/ helpers/engine-fixture.ts                           (new)
.kiro/specs/task-08-engine/
```
`core/continuous/pitch.ts` does not exist yet (Task 6).

## Constants (added to `core/constants.ts`)
| Section | Name | Value | Used by |
|---|---|---|---|
| Engine | `ENGINE_ADVANCE_MARGIN_MS` | `SEGMENT_HOP_MS + ONSET_LEAD_MS` (10) | advance rule |
| Teaching | `LOO_MIN_EXAMPLES_PER_LABEL` | `MIN_EXAMPLES_PER_LABEL - 1` (4) | leave-one-out training |
| Teaching | `CONFUSED_PAIR_MIN_RATE` | 0.1 | `confusedPairs` |

Existing constants used: `SAMPLE_RATE_MIN_HZ`, `SAMPLE_RATE_MAX_HZ`, `BACKGROUND`, `BACKGROUND_WINDOW_MS`, `BACKGROUND_WINDOW_OVERLAP_PERCENT`, `BACKGROUND_MAX_EXAMPLES`, `MIN_EXAMPLES_PER_LABEL`, `NOISE_FLOOR_WARMUP_MS`, `FEATURE_LENGTH` (tests). Test-only values live at the top of the test files: `LEAD_MS` (1200), `P1_MAX_IMPACTS` (5), `P1_GAP_MIN_MS` (210), `P1_GAP_MAX_MS` (600), `P1_SLOW_CLASS_MIN_GAP_MS` (440), `P1_GAIN_MIN_DB` (-20), `P1_GAIN_MAX_DB` (6), `P1_TRAIN_GAIN_DB` (-6), `P1_SNR_MIN_DB` (20), `P1_TRAIN_SNR_MIN_DB` (15), `P1_SNR_MAX_DB` (30), `P1_TRAIN_SNR_MAX_DB` (30), `P1_CASES_DEFAULT` (150), `P1_CASES_FULL` (300), `P1_EXACT_RATE_MIN` (0.98), `P1_CASE_SEED` (8101), `P1B_CASE_SEED` (8202), `TRAIN_SPACING_MS` (700, more than `SEGMENT_MAX_MS` of an impact so that training hits never touch), `TRAIL_MS` (1000).

## Interfaces
```ts
// core/continuous/tracker.ts
export type PitchEvent = Extract<SoundEvent, { kind: 'continuous' }>;
export interface ContinuousTracker {
  push(chunk: Float32Array): PitchEvent[];
  flush(): PitchEvent[];
  voicedRanges(): { start: number; end: number | null }[];   // seconds
}
export function noopTracker(): ContinuousTracker;

// core/engine.ts
export type Handlers = Record<string, (m: MatchEvent) => void>;
export type EngineEvent = SoundEvent | { kind: 'unknown'; t: number; nearest: Nearest };
export interface EngineOptions {
  sounds: SoundModel; sampleRate: number;
  on?: Handlers; modes?: Record<string, Handlers>; mode?: string;
  onEvent?: (e: EngineEvent) => void; classifier?: Classifier;
}
export interface Engine { push(chunk: Float32Array): void; flush(): void; setMode(name: string): void }
export interface RunResult { events: SoundEvent[]; matches: MatchEvent[]; unknowns: number[] }
export function createEngine(o: EngineOptions): Engine;
export function runSamples(samples: Float32Array, sampleRate: number, sounds: SoundModel, patterns?: string[]): RunResult;

// node/teach.ts
export type TeachWarning = { file: string; code: 'shorter-than-calibration' | 'sound-in-calibration' | 'no-sound-found' | 'hum-folder-ignored'; message: string };
export type TeachReport = { labels: { label: string; examples: number; looAccuracy: number }[]; confusedPairs: { a: string; b: string; rate: number }[]; warnings: TeachWarning[] };
export function teachFromDir(dir: string): Promise<{ model: SoundModel; report: TeachReport }>;

// node/expect.ts
export class ExpectEventsError extends Error { expected: string[]; actual: string[] }
export function expectEvents(wavPath: string, expected: string[], o: { sounds: SoundModel }): Promise<void>;
```
`Pattern`, `Segmenter`, `Matcher` and the tracker types stay internal. `createTracker(sampleRate)` is a private function of `engine.ts` and returns `noopTracker()` in this task.

## Engine
State: `segmenter`, `tracker`, `matcher`, `modes`, `modeName`, `totalSamples`.

`createEngine` order: check `sampleRate` (RangeError), resolve `on`/`modes`/`mode` (Requirements 1.3 to 1.5), build one throwaway `Matcher` per mode to validate its patterns (Requirement 1.6), then build the real `Matcher` for the active mode with `sounds.pitch?.baselineHz`. A mode set with a `hum.*` pattern and a model with no `pitch` therefore fails at creation, through the Matcher's own error.

### One `push(chunk)`
1. Return if the chunk is empty. Add its length to `totalSamples`; `now = totalSamples / sampleRate`.
2. `tracker.push(chunk)`: send each pitch event to `onEvent` and to the matcher.
3. `segmenter.push(chunk)`: classify each returned segment (below).
4. Call the handlers of every match, in the order produced. Matches that come from steps 2 and 3 are collected and called after the step they came from, so a handler never runs in the middle of the engine's own work.
5. `matcher.advance(min(now - ENGINE_ADVANCE_MARGIN_MS / 1000, segmenter.openSegmentStart() ?? Infinity))`, and call the handlers of its matches.

### Classifying one segment
```
if overlaps(segment, tracker.voicedRanges(), now)  -> drop (no event)
result = classifier.classify(sounds, segment)
unknown          -> onEvent({ kind: 'unknown', t, nearest })
match background -> drop
match other      -> event = { kind: 'sound', label, t, durationMs, confidence }; onEvent(event); matcher.push(event)
```
`overlaps` uses `[t, t + durationMs / 1000]` against `[range.start, range.end ?? now]`, closed on both sides. `onEvent` runs before the matcher so a caller sees the sound before the pattern it completes.

### flush
`tracker.flush()` first (it closes an open voiced range, so the segments that follow see the final range), then `segmenter.flush()`, the same classification, then `matcher.advance(Infinity)`.

## Why the advance rule still holds with the segmenter lookahead
The engine learns of a sound late, in two ways.

1. **Closing delay.** A segment reaches the engine when it closes. An isolated `low` impact (decay 120 ms, 360 ms long) closes about 390 ms after its onset. While it is open, `openSegmentStart()` returns its start, so `advance` is limited to that time. This is the rule of the plan.
2. **Re-onset delay.** Task 4 keeps the old segment open while a re-onset candidate waits for its 70 ms confirmation, and `openSegmentStart()` keeps returning the old start in that time. The second hit is not yet visible, but the matcher is held back at a time that is earlier than the second hit. When the second hit is confirmed, the old segment is returned and the new one is open at once, so there is no moment with no open segment between two overlapping sounds. The plan's rule is therefore still correct.

**What the plan's rule misses.** A sound whose onset hop has not been analyzed yet is not open anywhere: the segmenter works in whole hops of `SEGMENT_HOP_MS` and starts a segment `ONSET_LEAD_MS` before its onset hop. Its `t` is at least `now - SEGMENT_HOP_MS - ONSET_LEAD_MS` (the unanalyzed partial hop is less than one hop, and the segment starts at most one lead before the first unanalyzed hop). Advancing to `now` could run 10 ms past it and make a pending pattern time out just before that sound arrives (gap 345 ms, advance to 355 ms). The engine therefore subtracts `ENGINE_ADVANCE_MARGIN_MS`. This is an extension of the plan's `advance(min(now, openSegmentStart))`, found while checking it against the Task 4 design.

**Worked example (300 ms), patterns `low` and `low low`.** Impact 1 at T, impact 2 at T + 300 ms. Impact 2's hop becomes a candidate at about T + 300 ms (the old segment is 80 ms or older). It is confirmed 70 ms later, at about T + 370 ms. Only then is segment 1 returned, with `t = T`. Without the rule, `advance(now)` is called at T + 370 ms with `low@T` pending: 370 ms is past the 350 ms limit, so `low` fires, and `low@T+295` then starts a second sequence. With the rule, `openSegmentStart()` is the start of the new segment (about T + 295 ms) and `advance` stops there: 295 ms is under 350 ms. Segment 2 then closes about 390 ms after its onset and joins the pending sequence, and `low low` fires alone. The 250 ms case of the plan is also in the tests, but it is confirmed at about T + 320 ms and does not need the rule. The 300 ms test is the one that fails without it.

## Chunk independence
`totalSamples` is a count, and `now` is derived from it. The engine keeps no other state that depends on chunk boundaries: the tracker and the segmenter are chunk independent (Task 4 P3, Task 6 requirement), and the matcher sees events in the same order with the same `t`. The advance target after each push does depend on the chunking, but only how often `advance` is called, not what it decides: `Matcher.advance` fires only when the elapsed time passes a limit, and the target never passes the next unknown sound (the rule above). A fixed test compares the events and matches for four chunkings.

## runSamples
Builds `handlers` as `Object.fromEntries(patterns.map(p => [p, m => matches.push(m)]))` and an `onEvent` that fills `events` (kinds `sound` and `continuous`) and `unknowns` (the `t` of `unknown`). One `push` of the whole buffer, one `flush`. Duplicate patterns collapse in the object, so they cannot trigger the Matcher's duplicate error.

## teachFromDir
```
readdir(dir)                       -> label folders (directories, not starting with '.'), sorted
for each label (code-unit order)
  if label == 'hum'                -> warning hum-folder-ignored, continue
  for each *.wav file (sorted)     -> readWavFile (errors wrapped with the relative path)
      real = segments of one Segmenter run
      examples += real segments, id "<label>/<file>#<n>"
      if label == 'background'     -> windows (below) added to the same file's candidates
      else                         -> calibration warnings (below)
background: merge, order, cap at 200
counts (zero counts included) -> TooFewExamplesError if any < 5
model  = knnClassifier.train(examples)
report = leave-one-out over the feature vectors + warnings
```
Segments are turned into `Segment` objects by the segmenter already. Windows are built as `{ t: start / sampleRate, durationMs: window * 1000 / sampleRate, samples: slice (copy), sampleRate }`.

**Counts before training.** `trainVectors` counts labels from the examples, so a folder with zero usable examples would not show up in the error. `teachFromDir` therefore builds the counts itself from the folder list and throws `TooFewExamplesError(counts)` before it calls the classifier. With no folders the counts are `{}`.

**Background selection.** Candidates per file are the real segments and the complete windows (non-silent), merged by start time, a segment first on a tie. Files are in code-unit order. When the total `n` is over 200, index `floor(j * n / 200)` is kept for `j = 0..199`; since `n > 200` the indices are distinct. Because windows are 150 ms apart (50% of 300 ms), 30 s of noise gives 199 windows and stays under the cap, and 120 s gives 800 candidates and 200 kept.

**Calibration warnings.** The padded run exists only to find what the real run could not. Given `pad = round(NOISE_FLOOR_WARMUP_MS * sampleRate / MS_PER_SECOND)`:
- file length `< pad` samples: `shorter-than-calibration`.
- `padded = Segmenter run over [pad zeros, samples]`. A padded segment with start sample `s` and `s - pad < pad` (it starts in the first second of the file) is *lost* if no real segment `r` satisfies `r.start <= s - pad < r.end`. One warning per file, using the earliest lost start in the message.
- zero real segments: `no-sound-found`.

The zeros let the noise floor fall to its minimum before the file starts, so onsets in the first second are accepted in the padded run and the real run's rule (no onset before 1000 ms) is the only difference. This reuses the real onset rules and adds no second detector. A steady tone or steady noise from sample 0 is also reported as `sound-in-calibration` in a non-background folder. That is correct for an example folder: such a file is not a good example either.

**Time and units.** The first-second test is done in samples (`s - pad < pad`), which is the same as the segmenter's own rule and avoids comparing floating-point times.

**Hum folder.** Until Task 6 the folder is skipped with warning `hum-folder-ignored`. Task 6 replaces the skip with `medianPitchHz` over all files and sets `model.pitch.baselineHz` after training (the knn classifier knows nothing about pitch).

**Reading errors.** Each file read is wrapped: `new Error(`${relativePath}: ${error.message}`, { cause: error })`. A message from `readWav` such as the 16-bit PCM requirement stays visible (Review Focus 1). A missing `dir` rejects with the original `ENOENT`, since `readdir` is outside the wrap.

## Report: looAccuracy and confusedPairs
The plan says to train without each example and classify it. With the real classifier that has one catch: `trainVectors` throws `TooFewExamplesError` for any label with fewer than 5 examples, and a label with exactly 5 examples (the minimum, which Task 5 accepts) has 4 left in every leave-one-out round.

Options:
| Option | Result |
|---|---|
| Keep the standardization and thresholds of the full model, skip the held-out example in the neighbour search | Cheap. The held-out example leaks into mean, std and the threshold, and the threshold in the full model is based on that example. It is not the rule that classifies a new sound |
| Skip labels with exactly 5 examples | The report has no accuracy for the smallest allowed folder, where it matters most |
| Add an optional parameter to `trainVectors` for the minimum count | Real retraining for every label size. One small change to a finished module |

Chosen: the third option. `trainVectors(examples, sampleRate, options?: { minExamplesPerLabel?: number })`, default `MIN_EXAMPLES_PER_LABEL`. The report passes `LOO_MIN_EXAMPLES_PER_LABEL` (4). The check message of `TooFewExamplesError` keeps naming the real minimum of 5, since the default path is unchanged. The test for the default is part of `test/knn.test.ts` (4 examples still throw by default, 4 pass with the option set to 4).

Procedure: extract all feature vectors once (`extractFeatures` per example, shared with training). For each example `i`: `trainVectors(all but i, sampleRate, { minExamplesPerLabel: 4 })`, then `classifyVector(model_i, v_i)`. Cost for `n` examples is `n` trainings of `O(n^2 d)`; for about 250 examples and `d = 32` that is about 250 x 1M operations, a few seconds at most, and teach is a one-time action. A label that ends with fewer than 4 examples after the held-out one is removed cannot occur, because the minimum of 5 is already checked.

The outcome is correct when `kind == 'match'` and `label == own label`. `unknown` and a match to another label are wrong; only the second counts toward a pair. `looAccuracy = correct / examples`. `pairs[a][b] = count(a classified as b) / examples(a)`, and a pair is reported when `rate >= CONFUSED_PAIR_MIN_RATE`. For the label `background`, a segment of a real sound taught under a mistaken folder shows up as `background -> x`.

## expectEvents
`readWavFile` -> `runSamples(samples, sampleRate, sounds)` -> `labels = events.filter(sound).map(label)`. Equal lists resolve. Otherwise `ExpectEventsError` with message
`Expected events [clap, clap] but got [clap]. 1 unknown at 1.100 s.` The `unknown` part is added only when there are unknowns. Times use `toFixed(3)`.

## Public API and package.json
`core/index.ts` exports exactly the names of Requirement 14.1 and `node/index.ts` those of 14.2. `package.json` gets:
```
"exports": { ".": { "types": "./core/index.ts", "default": "./core/index.ts" },
             "./node": { "types": "./node/index.ts", "default": "./node/index.ts" } }
```
The package runs from source (`tsx`, `vitest`, bundlers). Plan 2 changes the targets to built files when `tokk` is published. `main`, `scripts` and dependencies stay as they are, so `check:public-api` and the hooks keep working. `TooFewExamplesError` is exported only from `tokk/node`, because only `teachFromDir` throws it, and the plan keeps the core API to the listed names.

## Testing
`vitest` and `@fast-check/vitest`. Synthetic input comes from `core/synth.ts` with fixed seeds (`rng`). Property tests use `test.prop` and take the run count from `test/setup.ts` (`PBT_RUNS`). Teach tests write WAV files into a temporary directory made with `mkdtemp` under the system temp folder, and remove it in `afterEach`.

**Fixture helper** `test/helpers/engine-fixture.ts`: `buildModel(classes, sampleRate, gainDb, seed)` places 10 impacts per class at `TRAIN_SPACING_MS` from `LEAD_MS`, runs a `Segmenter` over each class signal, and trains `knnClassifier` on the segments, as `teachFromDir` does. It caches models by `(sampleRate, classes)` for the whole file. Also `makeSignal(...)` (impacts at given times, optional noise), `clip(samples)` and `loudestWindowDb(clip, sampleRate)` (the loudest 10 ms RMS window, for the signal-to-noise ratio).

**Engine tests** (`test/engine.test.ts`):
- Fixed: `sampleRate` 8000, 96001, NaN throw `RangeError`; `on` plus `modes`, unknown `mode`, `modes` without `mode` throw; a bad pattern in an inactive mode throws at creation; `setMode` to an unknown name throws and keeps the mode.
- Review Focus 2: empty buffer, 3 s of zeros, and 3 s of dither at -70 dBFS give no events, matches or unknowns, and no exception.
- `background` handling: a model whose `ring` examples are labelled `background` gives no event and no `unknown` for a ring impact, and still reports `low`.
- `unknown`: a synthetic tone against an impact-only model gives `unknowns` with its `t` and no event.
- Patterns: `low low` fires once for two `low` impacts 200 ms apart, with `t` of the second sound; **the plan's 250 ms test** (`low`, `low low`, only `low low` fires, although the first segment is open when the second impact starts); **the 300 ms test** (same result, and the test that fails without the advance rule); `low` alone fires without `flush` after 1 s of trailing silence, once; `flush` fires a pending `low` at the end of the input.
- `setMode` switches handlers: after `setMode('b')` the same sound calls the other handler, and a pending sequence from mode `a` is dropped.
- Chunk independence: events and matches equal for one call and chunk sizes 1, 441, 4096 and 50000.
- **P1** and **P1b** (Requirement 15). Arbitraries: sample rate (44100, 48000), class, N (1-5), gap (per property), gain (-20 to 6), SNR (15 to 40), seed. The signal is `LEAD_MS` of noise, the impacts at `LEAD_MS + k x gap`, and `TRAIL_MS` of noise, clamped to +/-1. The assertion is `events.length === N`, every `label` equal to the class, `unknowns.length === 0`. Timeout `max(120 s, 1 s x cases)`. (Final form: a statistical acceptance test, see "Risks and rules", seventh round.)
- `test.todo`: an impact during an active hum is not classified; `hum.rise` through the engine; P1 with a hum before the impacts; the `low` class is not a hum (review item 12).

**Teach tests** (`test/teach.test.ts`): folder names become labels and `looAccuracy >= 0.9` for four classes, `confusedPairs` empty; one file with 3 impacts gives 3 examples with ids `low/a.wav#0..2`; ids of several files; only `id`, `label` and `v` in each example, `v.length` of `FEATURE_LENGTH`; a label with 4 examples rejects with `TooFewExamplesError` and `counts`; a label folder with a silent file counts as 0 in `counts`; an empty directory rejects with empty `counts`; a missing directory rejects with `ENOENT`; a single-label folder classifies its sound and rejects a far one (through `runSamples`); a 24-bit file rejects with a message that has the path and `16-bit PCM`; non-wav files and dot folders are ignored; the same folder gives an equal report twice; **a background folder** with 30 s of steady white noise starting at sample 0 gives at least 5 examples, all windows, the first with id `background/<file>#w0`, a silent window is skipped, 120 s of noise gives exactly 200 examples whose ids are the evenly spaced candidates, and the background file gives no calibration warning; **warnings**: an impact at 300 ms gives `sound-in-calibration` with the file name and no example, a 800 ms file gives `shorter-than-calibration`, a file with no sound gives `no-sound-found`, a clean file gives `warnings: []`, an impact at 1050 ms (onset hop after 1000 ms) gives no warning, warnings are sorted; the `hum` folder is skipped with `hum-folder-ignored`, is not in `labels` and `model.pitch` is undefined (this checks the warning, not pitch tracking); `expectEvents` passes for matching labels, its error lists expected and actual, mentions `unknown` sounds, and ignores an `unknown` that is not expected; a file with an unsupported format rejects unchanged. `test.todo`: the `hum` folder sets `pitch.baselineHz` near the tone frequency.

**Public API tests** (`test/public-api.test.ts`): the runtime export names of `core/index.ts` and `node/index.ts` are exactly the lists of Requirement 14; `package.json` has `exports["."]` and `exports["./node"]` whose files exist and whose modules export the same names.

**Knn test** (added to `test/knn.test.ts`): `trainVectors` with 4 examples per label throws by default and trains with `minExamplesPerLabel: 4`.

## Risks and rules
- **P1 and noise.** Noise at 15 dB SNR shifts features away from the noise-free training examples. If P1 fails, the counterexample is evidence about the classifier threshold or the features. Record it in this file and fix the cause. Do not loosen the SNR, the gain range or the model.
- **P1 with clipping.** The +6 dB gain is clamped to +/-1. The Task 4 test clips a `ring` impact, and Task 3 features use peak normalization, so a clipped impact should still be close to its class. A failure here is evidence, as above.
- **P1b bound.** 300 ms is the first value to test. The Task 4 notes give no measured limit for `low` and `ring`, only that 100 ms is unreliable.
- **Review item 12 (the `low` class and a hum).** Not testable before Task 6. The no-op tracker keeps P1 and P1b independent of it. Task 6 turns the `test.todo` into a test, and if the `low` class is taken for a hum, Task 6 either adds a pitch stability condition or P1 runs with the hum path off.
- **P1 and P1b counterexamples (found 2026-11-19, implementation stopped at task 4.8).** Both properties fail at the first runs. The engine is not the cause: a bare `Segmenter` run followed by `knnClassifier.classify` (no engine) gives the same results. Two separate causes, both in finished modules that this task may not change (Requirement 16.4):
  1. **Segmenter onset rule against the 15 dB SNR bound.** Shrunk counterexamples: P1 `[44100, "mid", N=1, gap 100, gain 0 dB, SNR 15 dB, seed 1]` and P1b `[44100, "low", N=1, gap 300, gain 0 dB, SNR 15 dB, seed 1]`. Both give no segment at all. Hop levels for the `mid` case (noise -23.1 dBFS, floor -23.4): 1198 ms -23.0, 1203 ms -12.3, 1208 ms -9.3, 1213 ms -8.8 dBFS. The onset rule needs one hop that is both more than `ONSET_ABOVE_FLOOR_DB` (12) above the floor and `ONSET_RISE_DB` (6) above the previous hop. The 10 ms level window spreads the rise over two hops (+10.7 dB, then +3.0 dB), so no hop meets both conditions. Requirement 15.3 accounts for the 12 dB margin but not for the 6 dB one-hop rise. Single-impact detection rate over 30 seeds (gain -20 to +6 dB, 44.1 kHz): `mid` 3/30 at 15 dB SNR, 21/30 at 18 dB, 30/30 at 20 dB; `low` 7, 19, 25/30; `high` 3, 29, 30/30; `ring` 2, 15, 29/30. All classes reach 30/30 at 25 dB.
  2. **Classifier rejection of noisy impacts.** The model is trained without noise (Requirement 15.2), and noisy impacts are rejected as `unknown` even at high SNR. Examples: `[44100, high, N=1, gain -9, SNR 28, seed 98792]` gives a 105 ms segment (120 ms without noise), nearest `ring` at 7.86, outside the thresholds (`high` 9.92 applies only when `high` wins the vote). `[44100, low, N=1, gain -7, SNR 25, seed 16397]` gives a 356 ms segment (406 ms without noise), nearest `low` at a distance of 5.01 against a threshold of 5.01 (no noise: 3.55). In 120 random runs over the full P1/P1b ranges, 31 failed. Most failures had at least one `unknown`, and they occurred at SNRs up to 28 dB. The noise shortens the segment, because the offset is relative to the higher floor, and it shifts the features beyond the noise-free thresholds.
  Neither cause can be fixed in this task without changing the segmenter, the features or the classifier, or loosening the SNR or gain range of the property, all of which this spec forbids. The owner must decide whether to (a) change the onset rule (Task 4), (b) train P1 models with noise or widen thresholds (Task 5), or (c) revise Requirement 15.
- **Owner decisions and second round (2026-11-19).**
  1. *Onset rise over one level window (Task 4 change).* The onset rule now compares the level with the level two hops back (one `LEVEL_WINDOW_MS`) instead of one hop back. The re-onset candidate rule is unchanged. `test/segment.test.ts` passes at `PBT_RUNS=200` (P2, P3, P4 hold). One fixed segment test encoded the old rule (a 5 dB per hop ramp, now 10 dB per window) and became a 2.5 dB per hop ramp (5 dB per window). Single-impact detection at 15 dB SNR (30 seeds, 44.1 kHz) went from 2 to 7 of 30 to: `low` 25, `ring` 28, `mid` 30, `high` 30.
  2. *Room-noise training.* Why: users teach in the room where they use the app. `buildNoisyModel` in `test/helpers/engine-fixture.ts` trains each P1/P1b example as its own recording with white noise at an SNR drawn from 15 to 30 dB, at the single training gain, with seeds from 2 000 000 up. Thresholds unchanged.
  3. *SNR measured per impact.* With these fixes, P1 found `[44100, "mid", 2, 135, 0, 15, 231959]`: one event for two impacts. This was a test bug. The noise was set from the clip of the first impact only, and each impact has its own seed. The second clip's loudest 10 ms window was about 3 dB lower, so its real SNR was about 12 dB. The noise is now set from the quietest clean clip, so every impact has at least the drawn SNR. After this fix one P1 run passed, but later runs failed (item 5).
  4. *P1b still fails (stopped here).* Shrunk counterexample `[44100, "low", N=1, gap 300, gain 0 dB, SNR 15 dB, seed 1]`: no segment, so no event, no `unknown`. Noise -22.4 dBFS, floor -22.7 dBFS, floor + 12 = -10.7 dBFS. Hop levels from 1198 ms: -22.3, -15.0, -13.1, -10.8, -7.6, -8.1 dBFS. The rise over two hops is 7.3, 9.2, 4.1, 5.5, 2.7 dB. The `low` attack (band-pass at 300 Hz, 150 Hz wide) takes about 20 ms to build. While the level rises fast enough (1203 and 1208 ms) it is still under floor + 12 dB. When it passes floor + 12 dB (1213 ms by 0.1 dB short, 1218 ms) the rise over 10 ms has fallen to 4.1 and 5.5 dB. No hop meets both conditions. This is a limit of the onset rule for slow attacks at 15 dB SNR, not an engine bug. Detection of a single `low` impact: 25/30 at 15 dB, 27/30 at 16 and 17 dB, 29/30 at 18 dB, 30/30 at 20 dB; `ring` 28/30 at 15 dB, 30/30 from 16 dB. Options for the owner: a longer rise span for the onset (for example 20 ms), a P1b SNR floor of 20 dB, or a different onset measure. The bound was not changed.
  5. *P1 still fails in the classifier (stopped here).* Segmentation is correct in all three shrunk counterexamples. The failures are classification, against a model trained with 15 to 30 dB room noise:
     - `[48000, "mid", N=3, gap 100, gain 0, SNR 39, seed 763679]`: 3 segments of 100, 100 and 215 ms; the second is `unknown`, nearest `mid/5.wav#0` at 7.72 against the `mid` threshold 7.68 (0.04 over). A short segment cut by the next hit, at high SNR.
     - `[48000, "high", N=1, gap 100, gain 0, SNR 15, seed 634167]`: 1 segment of 75 ms, classified `mid` (nearest `mid/0.wav#0` at 7.51, `mid` threshold 7.68). A wrong label.
     - `[44100, "high", N=1, gap 100, gain 0, SNR 15, seed 999999]`: 1 segment of 70 ms, `unknown`. The nearest example is `high/3.wav#0` at 7.95, inside the `high` threshold 9.92, but the k = 3 vote went to another label whose own distance is over its threshold.
     At 15 dB SNR a `high` impact (25 ms decay) is cut to 70 to 75 ms, because the offset line is 6 dB above a floor that is 15 dB under the peak. Its features then sit between `high` and `mid`. Fixing this needs a classifier or feature change (Task 3 or Task 5), or a change to the P1 ranges, which this task may not make.
- **Known limits, narrowed P1 ranges (owner decision, third round, 2026-11-19).** The SNR lower bound of P1 and P1b is 20 dB (was 15 dB). Why: a real tap or clap is usually far above room noise, and below 20 dB the onset line and the 9 dB offset span leave too little room. Measured single `low` detection with the two-hop onset rise: 25/30 at 15 dB, 29/30 at 18 dB, 30/30 at 20 dB. Experiment E2 on real recordings checks this bound. The P1 minimum gap is 150 ms (was 100 ms). Why: at 100 ms the tail of the previous impact overlaps the next segment, so its features differ from isolated training examples (see the 100/100/215 ms `mid` case above). Segmentation of 100 ms doubles stays covered by the Task 4 test. P1b stays at 300 to 600 ms. Training noise stays 15 to 30 dB. Thresholds, features and the classifier are unchanged.
- **Third round result (stopped here).** With `PBT_RUNS=200`, P1 passes. P1b fails with the shrunk counterexample `[44100, "low", N=2, gap 300, gain 0 dB, SNR 26 dB, seed 468767]`: one `low` event and one `unknown`.
  - Segments: `t=1.193 s` 241 ms, `match low` (nearest `low/9.wav#0` at 3.55, `low` threshold 6.22); `t=1.433 s` 371 ms, `unknown` (nearest `low/4.wav#0` at 6.23, threshold 6.22, 0.01 over).
  - Cause: the **re-onset rule** (unchanged by this task). Floor -33.8 dBFS. The tail of the first impact rises 4.3 dB in one hop at 1443 ms (one-hop rise >= `REONSET_RISE_DB` 3 dB, segment older than 80 ms), so that hop becomes a re-onset candidate. Its 70 ms confirmation window (about 1438 to 1508 ms) contains the start of the second impact at 1500 ms, so the post/pre energy ratio passes 2.4 dB and the candidate is confirmed. The first segment is cut at 1.433 s, and a new segment starts on the tail, 67 ms before the real hit. When the real hit arrives (one-hop rise 11.9 dB at 1503 ms), the new segment is only about 65 ms old, under `REONSET_MIN_SEGMENT_AGE_MS` (80 ms), so it cannot split again. The second impact is merged into a 371 ms segment that starts in the first one's tail, and its features fall just outside the `low` threshold.
  - Neither onset rule fires in this window (two-hop rises at 1408 to 1453 ms are at most 4.7 dB). So this is not caused by the Task 8 onset change. It is a limit of the Task 4 re-onset confirmation: a tail fluctuation 55 to 70 ms before a real hit borrows the hit's energy. Options for the owner: anchor the new segment at the hop where the confirmed energy actually rises, require the 3 dB candidate to be followed by energy in the first part of the window, or exclude the `low`/`ring` gap range in which this happens. Thresholds, features, the classifier and the P1b gap range were not changed.
- **P2 regression from the two-hop onset rise (stopped here).** A later full `npm test` run (`PBT_RUNS=100`, random seed) failed Task 4 P2 with the shrunk counterexample `["pink", -20 dBFS, 16000 Hz, seed 7]`: one 65 ms segment at `t=3.720 s` in noise only. The earlier `PBT_RUNS=200` run had passed by chance of the seed. At 3.70 s the floor is -24.4 dBFS (floor + 12 = -12.4). Hop levels from 3705 ms: -20.1, -18.5, -18.2, -18.0, -13.9, -11.5, -11.7 dBFS. At 3730 ms the level is 12.9 dB above the floor and 6.4 dB above the level two hops back, so the two-hop rule opens a segment. The one-hop rise there is 2.4 dB, so the old rule would not. A pink-noise swell that climbs over 10 ms now passes the rise test. The two-hop span trades P1 sensitivity against P2 false onsets, and the owner must choose (for example a larger `ONSET_RISE_DB` for the two-hop span, a longer floor-margin, or the old rule with a 20 dB SNR bound).
- **Fourth round: segmenter rules owned by Task 8 (2026-11-19, stopped here, uncommitted).** The owner allowed changes to the onset and re-onset rules and their constants, and nothing else. Final rules (details, margins and counterexamples in `.kiro/specs/task-04-segment/requirements.md`, Requirements 5 and 6):
  - Onset: level > floor + 16 dB, level >= -60 dBFS, a one-hop step of at least 3 dB within the last 60 ms, 80 ms gap. Measured margins: worst impact at 20 dB SNR +1.67 dB (`low`), worst P2 noise -1.97 dB.
  - Re-onset: every qualifying hop is queued; a candidate is confirmed when the 70 ms after it hold 4 dB more energy than the 30 ms before it and the first 15 ms already hold 3 dB more. Isolated tails in noise reached 3.04 dB; real hits in P1/P1b-like input at least 8.87 dB; the fixed 100 ms double test passes up to 4.75 dB.
  - Segmentation targets hold: `test/segment.test.ts` passes at `PBT_RUNS=300` with fast-check seeds 101 and 202 (P2, P3, P4 and all fixed tests). Batches over the P1 and P1b ranges (probe, same signal recipe as the test): P1 3000 runs and P1b 6000 runs gave **0** wrong segment counts.
  - **P1 and P1b still fail, in the classifier.** Same batches: P1 10 of 3000 runs and P1b 11 of 6000 runs had a correctly segmented impact classified `unknown` (about 0.3 % and 0.2 % of runs). At 300 runs a property therefore passes with a probability of roughly 40 to 55 %. `PBT_RUNS=300` runs: seed 101 failed P1 with `[44100, "mid", 3, 150, 0, 29, 274038]` and P1b with `[48000, "ring", 2, 300, 0, 33, 13]`; seed 202 failed P1 with `[44100, "high", 4, 311, 0, 21, 638143]`; the default `npm test` failed with `[44100, "high", 1, 150, 0, 20, 167279]` and `[48000, "ring", 2, 300, 0, 30, 4]`. Probes of these cases:

    | Counterexample | Segments | Failing segment | Nearest, distance vs threshold |
    |---|---|---|---|
    | P1 `[44100, mid, 3, 150, 0, 29, 274038]` | 3 of 3, at 1.193, 1.343, 1.493 s | #1, 150 ms, `unknown` | `mid/6.wav#0` 7.05 vs `mid` 7.04 |
    | P1b `[48000, ring, 2, 300, 0, 33, 13]` | 2 of 2, at 1.195, 1.495 s | #0, 300 ms, `unknown` | `ring/6.wav#0` 4.97 vs `ring` 4.96 |
    | P1 `[44100, high, 4, 311, 0, 21, 638143]` | 4 of 4 | #1, 105 ms, `unknown` | `high/9.wav#0` 7.44 vs `high` 10.57, but the k = 3 vote went to another label |
    | P1 `[44100, high, 1, 150, 0, 20, 167279]` | 1 of 1, at 1.198 s | #0, 85 ms, `unknown` | `high/8.wav#0` 6.65 (`high` 10.57); next `ring/3` 7.62 and `ring/4` 7.94, so `ring` wins the vote and 7.62 > `ring` 5.22 |
    | P1b `[48000, ring, 2, 300, 0, 30, 4]` | 2 of 2 | #0, 300 ms, `unknown` | `ring/2.wav#0` 4.97 vs `ring` 4.96 |

  - Causes: (a) a segment cut by the next hit is shorter than every isolated training example (`ring` lasts about 430 ms, P1b gaps start at 300 ms; `mid` about 205 ms, P1 gaps start at 150 ms), so its features sit at the edge of the class; most P1b failures are such cut `ring` segments; (b) a `high` impact whose two nearest-but-one neighbours are `ring` examples loses the k = 3 vote to `ring` and is then rejected by the tighter `ring` threshold; (c) per-class thresholds come from 10 training examples, so a few percent of new impacts land just outside them. None of these depends on the onset or re-onset rule: with the two-hop onset rule of the second round and the same model recipe, the classification failure rate was similar (2 of 1000 runs for each property).
  - What would fix it is outside the allowed changes: the classifier or its thresholds (Task 5), the features (Task 3), the training set of the P1 fixture (more examples per class, or examples cut by a second hit), or the P1 and P1b gap ranges (gaps that do not cut the first segment).- **Fifth round: narrowed gaps (owner decision, 2026-11-19, stopped here, uncommitted).** P1 gaps 210 to 600 ms, P1b gaps 440 to 600 ms, so that the next hit does not cut the previous segment. At `PBT_RUNS=300`, P1b passes with fast-check seeds 101 and 202. P1 fails with both seeds, on segments that are **not** cut (an isolated `high` impact is 80 to 95 ms long, far under the gap):
  - seed 101, `[48000, "high", 3, 460, 0 dB, 20 dB, 984357]`: 3 of 3 segments; the third (2.115 s, 85 ms) is `unknown`. 3 nearest: `high/2.wav#0` 8.83 (`high` threshold 9.17), `ring/0.wav#0` 9.41, `ring/2.wav#0` 9.57 (`ring` threshold 4.96). `ring` wins the k = 3 vote, and 9.41 > 4.96.
  - seed 202, `[48000, "high", 2, 264, 0 dB, 20 dB, 7]`: 2 of 2 segments; the second (1.460 s, 80 ms) is `unknown`. 3 nearest: `ring/8.wav#0` 7.74, `high/9.wav#0` 8.11, `ring/0.wav#0` 8.32. `ring` wins the vote, and 7.74 > `ring` 4.96. The `high` example at 8.11 is inside the `high` threshold 9.17.
  - Cause: cause (b) above, not truncation. At 20 dB SNR the short `high` segments sit far from all examples, and the nearest ones are a mix of `high` and `ring`. The vote picks `ring`, whose threshold (4.96) is about half of the `high` threshold (9.17), so the sound is rejected although it is within the `high` threshold. Both counterexamples are at 0 dB gain and 20 dB SNR, the lower SNR bound. A fix needs a classifier change (for example, accept the best label whose own threshold the sound passes), more training examples, or features that separate short noisy `high` from `ring`. All of these are outside the allowed changes.- **Sixth round: classifier rule fix (owner decision, Task 5 change, 2026-11-19, stopped here, uncommitted).** `classifyVector` now walks the labels among the k nearest in vote order (ties: the label whose nearest example is closer) and returns the first label whose own nearest example is within its own threshold; unknown if none passes. Exact-copy rule, `background` and `nearest` unchanged. `test/knn.test.ts` passes (34 tests, new hand-made test for this case), and P6, P7, P8 pass at `PBT_RUNS=300` with fast-check seeds 101 and 202. With seed 202, P1 and P1b pass at 300 runs. With seed 101, P1 fails with `[44100, "mid", 2, 214, 0 dB, 28 dB, 274038]`:
  - 2 of 2 segments, both 205 ms (the isolated length of this clip, so not cut). The second (1.408 s) is `unknown`: its 3 nearest are all `mid` (`mid/2.wav#0` 7.05, `mid/5.wav#0` 7.09, `mid/4.wav#0` 7.13) against the `mid` threshold 7.04, so the new vote rule does not apply.
  - The second clip alone, at the same time and in the same noise, gives the same `unknown` at 7.05. The same clip placed 500 ms later (other noise samples) is a `mid` match at 6.42. So it is neither truncation nor the first hit: one noise realization pushes this clip 0.01 past a threshold that comes from 10 noisy training examples per class (cause (c) above). The SNR of 28 dB is well inside the range.
  - This is the remaining rate of "a new impact lands just outside its class threshold". A fix needs the threshold rule, the training size of the P1 fixture, or the features, none of which were in this decision.- **Seventh round: P1 and P1b as a rate (owner decision, 2026-11-19, final).** Why: the classifier is statistical (thresholds learned from 10 noisy examples per class), so zero misses over random noise cannot be guaranteed; the sixth-round counterexample is an uncut `mid` impact 0.01 past the `mid` threshold in one noise realization (Requirement 15.8). The tests draw a fixed set of cases with `rng` (150 by default, 300 when `PBT_RUNS >= 300`) and pass when at least 98 % are exact, no case has more events than N, no case has a wrong label, and every missing event is an `unknown`. Ranges: P1 `mid`/`high`, gaps 210 to 600 ms; P1b `low`/`ring`, gaps 440 to 600 ms; N 1 to 5; gain -20 to +6 dB; SNR 20 to 30 dB. **Measured:** at 300 cases P1 99.7 % and P1b 99.7 % exact (one `unknown` each, listed in Requirement 15.8), 0 over-counts, 0 wrong labels; at 150 cases both 100 %. **Truncation known limit and follow-up:** Requirement 15.9 (a hit before the previous segment ends naturally cuts it; the cut segment can be `unknown`; robustness to truncated segments is decided after experiments E1 and E3).- **Untested path.** The overlap rule against `voicedRanges()` has no test until Task 6, because only the no-op tracker exists. It is a short function and Task 6 adds its test.
