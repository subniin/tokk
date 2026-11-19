# Requirements: Task 5, kNN classifier with unknown rejection

## Introduction
Task 5 adds `core/classify/knn.ts`. It is the default `Classifier` (design section 3, choice B): it learns from example segments, standardizes their feature vectors, and names the sound of a new segment by a vote of its nearest examples. A new segment that is far from every example of the winning label is `unknown` (design 5.3), so that speech, typing and other sounds do not trigger actions.

The classifier is a pure function of its inputs. The same `sounds.json` must give the same answer in the browser and in Node, and the order in which examples were recorded must not matter (P8).

| Consumer | What it uses from this task |
|---|---|
| Task 8 (engine, `teachFromDir`) | `knnClassifier.train` and `classify`, `TooFewExamplesError` (reported to the user), `BACKGROUND` (the engine drops `background` results), `nearest` (shown by the overlay and in `listen` output) |
| Task 8 (`looAccuracy`, `confusedPairs`) | `train` and `classify` called repeatedly with one example left out |
| Task 10 (`mcp-ears`) | `nearest.id` in `unknown @ 1.100s nearest clap/03.wav#0` |
| P6, P7, P8 | Self-consistency, unknown sounds, example order |
| Review Focus 3 | Fewer than 5 examples, and a model with one label only |
| Review item 11 | Background examples outnumber the other labels up to 20 times |

The plan's rules are copied here without change, except one deliberate decision about which examples feed the standardization (Requirement 3.5 and 3.6, explained in `design.md`).

## Requirements

### Requirement 1: Interface and output
**User story:** As a developer of the engine, I want a classifier that follows the `Classifier` interface, so that I can swap it for another one later (design choice C).

#### Acceptance Criteria
1. THE module `core/classify/knn.ts` SHALL export `knnClassifier` (an object of type `Classifier`), `TooFewExamplesError`, and `BACKGROUND`. `BACKGROUND` SHALL equal `'background'` and SHALL be defined in `core/constants.ts` and re-exported by `knn.ts`.
2. THE `knnClassifier.train(examples)` method SHALL take `{ id, label, segment }[]`, extract each feature vector with `extractFeatures`, and return a `SoundModel` with `version` 1, `k` equal to `KNN_K` (3), `sampleRate`, `mean`, `std`, `examples` and `thresholds`. It SHALL NOT set `pitch`.
3. THE `knnClassifier.classify(model, segment)` method SHALL return a `ClassifyResult` as defined in `core/types.ts`. It SHALL NOT modify `model` or `segment`.
4. THE module SHALL also export two helpers that work on feature vectors instead of segments: `trainVectors(examples: { id; label; v }[], sampleRate)` and `classifyVector(model, v)`. `train` and `classify` SHALL be the feature extraction step followed by these helpers, so that the vector helpers and the segment methods cannot disagree. THE helpers are for tests and for Task 8; they SHALL NOT be exported from `core/index.ts`.
5. THE `model.examples` entries SHALL be `{ id, label, v }`, where `v` is the feature vector before standardization (the shape in `core/types.ts`). THE model SHALL NOT contain samples (Requirement 8).
6. THE `train` method SHALL accept a label of any name. The label `background` is the only reserved name (Requirement 5.8).

### Requirement 2: Training input checks
**User story:** As a user who recorded too few sounds, I want an error that tells me which label has how many, so that I know what to record.

#### Acceptance Criteria
1. THE class `TooFewExamplesError` SHALL extend `Error`, SHALL set `name` to `'TooFewExamplesError'`, and SHALL have a `counts: Record<string, number>` field with the number of examples of every label in the input.
2. IF any label (including `background`) has fewer than `MIN_EXAMPLES_PER_LABEL` (5) examples, THEN `train` SHALL throw `TooFewExamplesError`. THE message SHALL list every label with its count and SHALL mark the labels below the minimum, for example `Too few examples (minimum 5): clap 4 (too few), knock 12`. THE labels SHALL appear in alphabetical order.
3. IF `train` receives an empty list, THEN it SHALL throw `TooFewExamplesError` with `counts` equal to `{}`.
4. WHEN a label has exactly 5 examples, THE system SHALL train without error. A model with a single label SHALL train and SHALL be usable (Review Focus 3).
5. IF two examples have the same `id`, THEN `train` SHALL throw a `RangeError` that names the id. Ids are unique by construction (`<label>/<file>#<segment index>`), and the model sorts by id (Requirement 7).
6. IF the feature vectors do not all have the same length, or contain a value that is not finite, THEN `trainVectors` SHALL throw a `RangeError`. (`extractFeatures` never returns such vectors, Task 3. The check protects `sounds.json` files edited by hand.)
7. THE check of 2.2 SHALL run before any other work, so that the error does not depend on the contents of the vectors.

### Requirement 3: Standardization
**User story:** As a developer, I want every feature to count by how much it varies between examples, so that no feature wins only because of its unit. A feature that is almost constant must not make the same sound look strange.

#### Acceptance Criteria
1. FOR each dimension `j`, `model.mean[j]` SHALL be the arithmetic mean, and the raw standard deviation SHALL be the population standard deviation (divide by `n`), over the **statistics set** defined in 3.5.
2. FOR each dimension `j`, `floor[j]` SHALL be `max(STD_FLOOR_RANGE_FRACTION x range[j], STD_FLOOR_ABSOLUTE)`, that is `max(0.05 x range, 0.01)`, where `range[j]` is the largest minus the smallest value of dimension `j` over the statistics set. THE value `model.std[j]` SHALL be `max(raw std, floor[j])`. THE stored `std` is the value after the floor (plan: "std, floor applied").
3. THE standardized vector SHALL be `(v[j] - mean[j]) / std[j]`, and the distance between two vectors SHALL be the Euclidean distance between their standardized vectors. THE distance SHALL NOT be divided by the number of dimensions.
4. WHEN a dimension is constant over the statistics set, THE stored `std` of that dimension SHALL be `STD_FLOOR_ABSOLUTE` (0.01), and a new vector that differs by 0.005 in that dimension SHALL be 0.5 away in it, not infinitely far (no division by zero, no `NaN`, no `Infinity`).
5. **Statistics set.** THE statistics set SHALL be all examples whose label is not `BACKGROUND`. WHEN every example is `background`, THE statistics set SHALL be all examples. (The reason is review item 11, see Requirement 6 and `design.md`.)
6. THE `mean`, `std` and the `v` of the background examples SHALL still be stored and used. Background examples are standardized with the same `mean` and `std` as every other example and take part in the nearest-example search, the vote and the thresholds.

### Requirement 4: Distance thresholds
**User story:** As a user, I want a sound that is clearly unlike my examples to be rejected, with a limit set automatically from my own examples.

#### Acceptance Criteria
1. FOR each label, THE system SHALL collect, for every example of that label, the standardized distance to the nearest **other** example of the same label (leave-one-out). Examples of other labels SHALL NOT count.
2. THE collected distances SHALL be reduced to one value by the 95th percentile (`THRESHOLD_PERCENTILE`) with linear interpolation between sorted values (the method often called type 7, the default of NumPy and Excel `PERCENTILE.INC`): sort the `n` distances ascending as `d[0..n-1]`, let `r = 0.95 x (n - 1)`, `lo = floor(r)`, `hi = ceil(r)`, and the result is `d[lo] + (r - lo) x (d[hi] - d[lo])`. For `n` = 5, `r` is 3.8.
3. `model.thresholds[label]` SHALL be that percentile multiplied by `DISTANCE_THRESHOLD_FACTOR` (1.5). THERE SHALL be one entry for every label in the model, including `background`.
4. THE threshold SHALL be in standardized space and in the unit of the distance of Requirement 3.3 (no unit name is needed because the value has no physical unit).
5. WHEN all collected distances are 0 (duplicate examples), THE threshold SHALL be 0 and `train` SHALL NOT throw.

### Requirement 5: Classification
**User story:** As a user, I want a sound to get the name of its nearest examples, and unlike-everything sounds to be refused.

#### Acceptance Criteria
1. THE `classify` method SHALL extract the features of the segment with `extractFeatures`, standardize them with `model.mean` and `model.std`, and compute the distance to every example in the model.
2. **Vote.** THE system SHALL take the `min(model.k, number of examples)` nearest examples and choose the label with the most of them (majority of k = 3).
3. **Tie.** WHEN labels are tied for the most votes (one vote each among three labels), THE winner SHALL be the label of the nearest example overall.
4. **Equal distances.** WHEN two examples have exactly the same distance, THE example with the smaller `id` (compared as plain strings by code unit) SHALL come first.
5. **Unknown.** LET `d` be the distance from the segment to the nearest example **of the winning label**, anywhere in the model, and `T` the threshold of that label. WHEN `d > T`, THE result SHALL be `{ kind: 'unknown', nearest }`.
6. **Match.** OTHERWISE THE result SHALL be `{ kind: 'match', label, confidence, nearest }` with `confidence = max(0, 1 - d / T)`. WHEN `T` is 0, THE confidence SHALL be 1 if `d` is 0 and 0 otherwise (a `d` above 0 is already `unknown`). THE confidence SHALL never be `NaN`, below 0 or above 1.
7. **Nearest.** THE `nearest` field SHALL be `{ id, label, distance }` of the example nearest to the segment among **all** examples, whatever the winning label, with the standardized distance.
8. **Background.** WHEN the winning label is `background`, THE result SHALL be returned as it is, a `match` with `label: 'background'`. The classifier SHALL NOT drop it; the engine does (Task 8). A background winner whose nearest background example is beyond the background threshold is `unknown` by 5.5, and both results give no event.
9. THE classifier SHALL NOT use the segment's `t`, `durationMs` or `sampleRate`. A segment at a sample rate other than `model.sampleRate` is classified the same way (the overlay warns, design 4.1).
10. **Exact copy.** WHEN the distance to the nearest example overall is exactly 0 (the vector is identical to a stored one), THE winning label SHALL be the label of that example, whatever the vote says. Rule added after property P6 found a counterexample (see design.md, Measured values).
11. **Own threshold per label (changed in Task 8).** THE system SHALL rank the labels among the k nearest examples by their number of votes, and on equal votes by the distance of their nearest example (closer first). IT SHALL walk this ranking and return a `match` for the first label whose own nearest example is within that label's own threshold, with the confidence of 5.6 from that distance and threshold. WHEN no label in the ranking passes, THE result SHALL be `unknown` with the globally nearest example. This replaces 5.2, 5.3 and 5.5 for the choice of the label: the vote still decides the order, but a label that fails its own threshold no longer makes the result `unknown` when another label among the k nearest passes. 5.7, 5.8 (a `background` that passes first is returned as `background`) and 5.10 are unchanged.

**Why (own threshold per label).** Task 8 property P1 found two impacts of class `high` (decay 25 ms) at 20 dB SNR that were rejected although they were within the `high` threshold: `[48000, "high", 3, 460, 0, 20, 984357]` (third segment: nearest `high` at 8.83, then `ring` at 9.41 and 9.57) and `[48000, "high", 2, 264, 0, 20, 7]` (second segment: `ring` 7.74, `high` 8.11, `ring` 8.32). In both, `ring` won the vote 2 to 1 and failed its own limit of 4.96, while `high` passed its limit of 9.17. With the first rule the result was `unknown`. The labels have very different spreads (the `ring` threshold is about half of the `high` threshold), so the label with the most nearby examples is not always the one whose threshold accepts the sound.

### Requirement 6: Dense background examples (review item 11)
**User story:** As a user with 200 background windows and 10 examples per sound, I want my sounds to be recognized as well as without the background examples.

#### Acceptance Criteria
1. THE standardization SHALL use the statistics set of Requirement 3.5, so that the background examples do not move the mean and the standard deviation, and neither the `std` floor.
2. THE vote SHALL remain the plain k = 3 majority of Requirement 5.2, with no weights by label size.
3. GIVEN a model with 10 examples per label of four synthetic classes and 200 background windows, THE classifier SHALL classify at least 95 % of held-out examples of the four classes (20 per class, other seeds) as their own label. A result of `unknown` or `background` SHALL count as an error.
4. THE same held-out examples SHALL reach at least 95 % on the model without the background examples, and THE background model SHALL NOT be worse than that model by more than 5 percentage points. (This documents what the background costs; the first criterion is the pass line.)
5. THE held-out background windows (other seeds) SHALL NOT be classified as one of the four classes (`background` and `unknown` are both fine) in at least 90 % of the cases. (This shows that the background examples still do their work.)
6. IF these criteria fail, THEN the rule SHALL be changed and `design.md` updated with the counterexample. THE thresholds of the test SHALL NOT be lowered.

### Requirement 7: Order independence (P8)
**User story:** As a developer, I want the same recordings to give the same `sounds.json`, whatever order the files were read in.

#### Acceptance Criteria
1. THE `trainVectors` method SHALL sort the examples by `id` (plain string comparison) before it computes anything. THE `model.examples` array SHALL be in that order.
2. THE `mean`, `std`, `thresholds` and `examples` of a model SHALL be identical (deep equality, bit for bit) for any order of the same examples. This follows from 7.1: sums are taken in the same order.
3. THE `model.sampleRate` SHALL be the `sampleRate` of the first example **in the input order**, before sorting (plan). WHEN all examples share one sample rate, the model is order independent as in 7.2. WHEN they do not, the model is not rejected, and `sampleRate` follows the input order.
4. FOR any shuffle of the training examples, THE classification of any test vector SHALL be identical (`kind`, `label`, `confidence`, `nearest`). Property P8.

### Requirement 8: JSON round trip and privacy
**User story:** As a developer, I want `sounds.json` to be a small file of numbers that gives the same answers after saving and loading, and never holds a recording.

#### Acceptance Criteria
1. FOR a model `m` from `train`, `JSON.parse(JSON.stringify(m))` SHALL classify every test segment with a result deep-equal to the one from `m`.
2. THE model SHALL contain only numbers, strings and arrays and objects of them. Every entry of `model.examples` SHALL have exactly the keys `id`, `label` and `v`. THE model SHALL NOT contain `Float32Array`, sample data or the key `samples` (privacy rule: feature vectors only).
3. THE model SHALL NOT contain `NaN` or `Infinity`, which JSON turns into `null`.
4. THE module SHALL NOT call the network, `fetch`, `XMLHttpRequest` or `WebSocket` (privacy rule).

### Requirement 9: Self-consistency (P6)
**User story:** As a user, I want every example I recorded to be recognized as the label I gave it.

#### Acceptance Criteria
1. FOR 2 to 4 labels (each a different synthetic class) with 5 to 20 examples each, every training example, classified again, SHALL give `kind: 'match'` with its own label, `nearest.id` equal to its own `id`, and `nearest.distance` equal to 0.
2. THE examples of one label SHALL differ by seed only, so that the labels are separable.

### Requirement 10: Unknown sounds (P7)
**User story:** As a user, I want a sustained harmonic sound (a hum, a whistle) not to be taken for one of my impact sounds.

#### Acceptance Criteria
1. GIVEN a model trained only on impact classes (2 to 4 of `low`, `mid`, `high`, `ring`, 10 examples each, no background), THE classifier SHALL return `kind: 'unknown'` for a synthetic tone (`synthTone`, harmonic and sustained) for any `f0Hz` 100 to 800 Hz, duration 300 to 1500 ms, gain -20 to 0 dB, with or without vibrato.
2. THE unknown result SHALL carry a `nearest` with a finite distance.

### Requirement 11: Layer rule, constants and speed
**User story:** As a maintainer, I want `core/` to stay portable and tunable from one file.

#### Acceptance Criteria
1. THE file `core/classify/knn.ts` SHALL NOT import `fs`, `path`, DOM or Web Audio APIs, SHALL have no runtime dependencies other than `core/` modules, SHALL NOT call `Math.random`, and SHALL NOT read the clock.
2. THE system SHALL use the existing constants `KNN_K`, `DISTANCE_THRESHOLD_FACTOR`, `THRESHOLD_PERCENTILE`, `MIN_EXAMPLES_PER_LABEL`, `STD_FLOOR_RANGE_FRACTION` and `STD_FLOOR_ABSOLUTE`. THIS task SHALL add `BACKGROUND` (`'background'`) to the Classifier section of `core/constants.ts`. THE file SHALL NOT hard-code a threshold, a count or a factor. THE conversion from percent to a fraction uses a file-local `PERCENT_DIVISOR` (100), as `core/synth.ts` uses `MS_PER_SECOND`.
3. THE file SHALL NOT compute or store a time. (The classifier works on a segment that already has its `t`.)
4. THE `train` method SHALL need time proportional to `n^2 x d` for `n` examples of `d` dimensions (each pair distance once) and `classify` SHALL need time proportional to `n x d`. FOR 240 examples of 32 dimensions, `trainVectors` SHALL take under 500 ms (a loose bound that only catches an accidental `n^3` loop).
