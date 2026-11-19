# Design: Task 5, kNN classifier with unknown rejection

## Layer rule
`core/classify/knn.ts` is pure TypeScript. No `fs`, `path`, DOM, or Web Audio. No dependencies except `core/` modules (`features.ts`, `types.ts`, `constants.ts`). No `Math.random`, no clock, no network. All factors and counts come from `core/constants.ts`. The percent conversion is a file-local `PERCENT_DIVISOR` (100). The module neither reads nor writes a time; the `t` of a segment is set by the segmenter (cumulative sample count / sample rate) and passes through untouched.

## Interfaces
```ts
// core/classify/knn.ts
export const knnClassifier: Classifier
export class TooFewExamplesError extends Error { counts: Record<string, number> }
export { BACKGROUND }                       // defined in core/constants.ts

// vector-level helpers (tests and Task 8; not exported from core/index.ts)
export function trainVectors(
  examples: { id: string; label: string; v: number[] }[],
  sampleRate: number,
): SoundModel
export function classifyVector(model: SoundModel, v: number[]): ClassifyResult
```
`SoundModel`, `ClassifyResult`, `Nearest` and `Classifier` are the types in `core/types.ts`. They do not change in this task.

`knnClassifier.train` maps each example with `extractFeatures(segment)`, takes `sampleRate` from the first example's segment in input order, and calls `trainVectors`. `knnClassifier.classify` calls `extractFeatures(segment)` and `classifyVector`. The split exists for two reasons: tests can build exact vectors by hand (the vote, the tie, the percentile and the threshold edge cannot be set up with real sounds), and the property tests run fast, because `extractFeatures` is the slow part and can be done once per pooled example.

## Constants
Existing in the Classifier section of `core/constants.ts`: `KNN_K` (3), `DISTANCE_THRESHOLD_FACTOR` (1.5), `THRESHOLD_PERCENTILE` (95), `MIN_EXAMPLES_PER_LABEL` (5), `STD_FLOOR_RANGE_FRACTION` (0.05), `STD_FLOOR_ABSOLUTE` (0.01). `RECOMMENDED_EXAMPLES_PER_LABEL` (10) and the three background constants of the Teaching section are used by Task 8 and by the tests, not by `knn.ts`.

**Added by this task:** `BACKGROUND = 'background'` in the Classifier section. The plan lists `BACKGROUND` among the products of `knn.ts`, and the unit rule asks for constants in `core/constants.ts`. So the value lives in `constants.ts` and `knn.ts` re-exports it (`export { BACKGROUND } from '../constants'`), which keeps the plan's import path working.

Test-only values live at the top of `test/knn.test.ts`: `TEST_SAMPLE_RATE_HZ` (44100), `TRAIN_SEED_BASE` and `HELDOUT_SEED_BASE` (far apart so the seeds never overlap), `TRAIN_GAIN_DB` (-6, one gain for training and test, as in P1), `HELDOUT_PER_CLASS` (20), `ACCURACY_MIN` (0.95), `BACKGROUND_REJECT_MIN` (0.9), `BACKGROUND_COST_MAX` (0.05), `BACKGROUND_COUNT` (`BACKGROUND_MAX_EXAMPLES`, 200), `POOL_SEEDS_PER_CLASS` (40), `TRAIN_TIME_MAX_MS` (500), and the timeouts.

## Training procedure (`trainVectors`)
1. **Check counts.** Count examples per label. If the list is empty or any count is below `MIN_EXAMPLES_PER_LABEL`, throw `TooFewExamplesError(counts)`. The message is `Too few examples (minimum 5): ` followed by `label count` entries in alphabetical order, separated by commas, with ` (too few)` after each label below the minimum. Counts are checked first so the error never depends on vector contents.
2. **Check ids and vectors.** Duplicate id: `RangeError`. Different vector lengths or a non-finite value: `RangeError`.
3. **Sort by id** with plain `<` comparison (code units, locale independent). All following sums run in this order, so the result is bit-identical for any input order (P8). `sampleRate` is read before this step, from the first example in the input order.
4. **Statistics set.** The examples whose label is not `BACKGROUND`. If that set is empty, all examples.
5. **mean, raw std, range** per dimension over the statistics set: one pass for the mean, one for the sum of squared deviations (two-pass, so no cancellation), divide by `n`, square root. `range` is max minus min.
6. **std** = `max(rawStd, max(STD_FLOOR_RANGE_FRACTION x range, STD_FLOOR_ABSOLUTE))`.
7. **Standardize every example** (background included): `z[j] = (v[j] - mean[j]) / std[j]`. Keep `z` in memory only. `model.examples` keeps `v`.
8. **Pairwise distances.** For every pair `(i, j)` compute the Euclidean distance once, and keep for each example its nearest same-label distance (`min` over the other examples of its label). The cost is `n^2 / 2` distances of `d` dimensions. At `n` = 240 and `d` = 32 that is about 920,000 multiply-adds, a few milliseconds. No spatial index is needed (YAGNI).
9. **Thresholds.** Per label, `percentile(sorted LOO distances, 95) x DISTANCE_THRESHOLD_FACTOR`.
10. Return `{ version: 1, k: KNN_K, sampleRate, mean, std, examples (sorted), thresholds }`.

### Percentile method (defined)
Linear interpolation between order statistics (type 7). With `d` sorted ascending, `n = d.length`, `p = THRESHOLD_PERCENTILE / PERCENT_DIVISOR`:
```
r  = p x (n - 1)
lo = floor(r), hi = ceil(r)
result = d[lo] + (r - lo) x (d[hi] - d[lo])
```
Why this one: it is continuous in the data, it is the default of the common tools (NumPy `linear`, Excel `PERCENTILE.INC`), so a user can reproduce a threshold in a spreadsheet, and it works for the minimum `n` of 5. "Nearest rank" would jump by a whole distance when one example is added. With 5 examples, `r` is 3.8, so the result sits 80 % of the way from the 4th to the 5th smallest distance: one outlying example is largely, not entirely, included. That fits the design intent (the threshold must tolerate the worst example, and the factor 1.5 adds room).

## Classification procedure (`classifyVector`)
1. `z = (v - mean) / std`.
2. Distance to every example. Sort by `(distance, id)`. The id tie-break makes equal distances deterministic.
3. `take = min(model.k, n)`. Count votes in the first `take` examples.
4. Exact copy: if the nearest example is at distance exactly 0, its label is the winner (Requirement 5.10). Otherwise the winner is the label with the most votes. If several labels share the maximum, the winner is the label of the first example in the sorted list (the nearest overall) among them. With k = 3 this is the case 1-1-1. If exactly two labels tie, which cannot happen at k = 3, the same rule applies, and it also covers a hand-made model with another `k`.
5. `d` = distance to the nearest example of the winner (scan the sorted list for the first example of that label). `T = thresholds[winner]`.
6. `d > T` gives `unknown`. Otherwise `match` with `confidence = T > 0 ? max(0, 1 - d / T) : 1`. The `T = 0` case with `d = 0`: confidence 1. With `T = 0` and `d > 0` the result is already `unknown`.
7. `nearest` = first example in the sorted list, with its distance.

The distance to every example is needed for the nearest-of-winner lookup anyway, so a full sort is used: at `n` = 240 it costs microseconds, and a partial selection would add code without an observable gain.

A segment whose features have the wrong length for the model (a model from an older feature set) throws a `RangeError` in `classifyVector`, instead of returning a distance computed from `undefined`.

## Review item 11: dense background examples
**The problem.** `teachFromDir` (Task 8) keeps up to 200 `background` examples (300 ms windows, 50 % overlap) next to about 10 examples per real sound. The review (item 11) names two risks: (1) mean and std are pulled toward the background distribution; (2) in the k = 3 vote near a boundary, background examples crowd out the real ones.

**Risk 1, the standardization.** Three options:

| Option | What it does | For | Against |
|---|---|---|---|
| A. Statistics from non-background examples only | `mean`, `std`, `range` over the real examples. Background is standardized with them | The scale describes the sounds the user wants to tell apart. 200 background windows cannot move it. No extra parameter. One more `if` | Background examples can land far from the origin in some dimensions, which is fine: they are meant to be elsewhere. If there is no real label, falls back to all examples |
| B. Weighted statistics | Each example gets weight `1 / (count of its label)`, so every label counts equally | Background still takes part, with the weight of one label | Needs weighted mean and weighted variance, and the floor range still needs a rule. More to explain and test. The background distribution still shapes the scale by one label's worth, which is not wanted |
| C. Cap the background at 50 | The review's second idea | Simple | Changes the teaching rule of plan and design (max 200) and throws examples away. Does not fix the std even at 50 vs 10 |

**Decision: A.** Reason: standardization answers the question "how much does a feature vary between the sounds I want to recognize?". The background is, by definition, everything else (typing, speech, a chair), and varies in every direction. Mixing it in raises the `std` of the dimensions where the background spreads, and the nearest-neighbour distances between the real examples shrink in exactly those dimensions, so the real sounds become harder to tell apart and the thresholds, built from those distances, change with how much background was recorded. With A, the real sounds are scaled by their own spread; recording more background cannot change the scale or the thresholds of the real labels. The only place where background touches the real labels is the vote, which is the intended place.

The background thresholds and distances are computed in the same space (Requirement 3.6). The background threshold may be large, since the background is spread out. This is consistent: a sound near some background example is rejected as `background`, and a sound far from all of them is `unknown` (also no event).

**One deliberate difference from the plan.** The plan says the std floor uses "the range of that dimension over all examples". With A, the floor uses the range over the statistics set. If the floor used all examples, the background range (often 10 times the real range) would make `0.05 x range` larger than the real std in many dimensions, and A would be undone by the floor. This is the only wording of the plan that is changed. It is recorded in the devlog.

**Risk 2, the k = 3 vote.** Plain majority, no weights. Why this is enough:
- A real example near its cluster has its two other same-label neighbours closer than any background window, because the real clusters are tight in the real-sound scale, and background windows sit away from them (continuous noise windows have different decay, attack and band-ratio features than an impact).
- Where a real sound lies at the edge between its own cluster and a dense background cloud, the background does win. That is correct: such a sound is more like the background than like the examples.
- A weighted vote (say by label size) would cancel the 20-fold difference, but it would also make the real labels beat the background on sounds that look like background, and the cost (a false event) is worse than a missed one in the app (design 1, "wrong action in the demo"). Weights can be added later behind the `Classifier` interface.
- The `unknown` check uses the winning label only, so background density does not change a real label's threshold (Requirement 4).

**The test.** `test/knn.test.ts` includes `10 examples per label plus 200 background examples still classify held-out examples of the real labels at >= 95 % (Req 6.3)`. It is the acceptance gate of this decision. If it fails, the rule is revisited (candidate next step: option B for the vote only, or the 50-example cap in Task 8) and the counterexample goes into this document. The threshold stays at 95 %.

How the background is made in the test: 200 windows of `BACKGROUND_WINDOW_MS` (300 ms), made of `synthNoise` (white and pink alternately), and of a soft `synthTone` for every fourth window (speech-like, sustained), with gains between -50 and -20 dB, one seed per window. These are not impacts, so a real impact classifier should separate them. This is a stand-in for typing and speech; the real check is experiment E2.

## Layout of the test file
`test/knn.test.ts` uses `vitest` for example tests and `test.prop` from `@fast-check/vitest` for P6, P7 and P8. It does not set `numRuns`; `test/setup.ts` reads `PBT_RUNS`. Each property test name ends with `(Req N.M)`, and a comment above it names the property (P6, P7, P8) and the requirement.

### Fixtures (built once, in `beforeAll`)
- **Class pool.** For each of the four `SYNTH_CLASSES` and each seed in `TRAIN_SEED_BASE ... + POOL_SEEDS_PER_CLASS - 1`, build a `Segment` with `synthImpact` at `TEST_SAMPLE_RATE_HZ` and `TRAIN_GAIN_DB` (parameters from `SYNTH_CLASSES`, `durationMs` = decay x `SYNTH_DURATION_DECAY_MULTIPLE` capped at `SYNTH_MAX_DURATION_MS`, `t` = 0). Extract the features once and keep `{ id: '<class>/<seed>#0', label: '<class>', v }`. That is 160 extractions.
- **Held-out pool.** The same for seeds from `HELDOUT_SEED_BASE`, `HELDOUT_PER_CLASS` per class (80 segments).
- **Background pool.** 200 training windows and 40 held-out windows as described above.
- **Hand-made models** for the vote, tie, threshold and floor tests: one dimension, five examples per label at given positions, built with `trainVectors`. The test computes expected distances from the returned `model.std` and `model.mean`, so it does not need to know the standardization by heart.

Segment-level tests (`train`, `classify`) use the pools' segments. Property tests use the pools' vectors with `trainVectors` and `classifyVector`, except P7, which classifies a freshly synthesized tone with `knnClassifier.classify` (one extraction per case).

### Runtime target
The whole `test/knn.test.ts` runs in **under 20 s** at `PBT_RUNS=100` (the default) and in **under 10 s** at `PBT_RUNS=20` (the default of `pbt:quick`). Expected cost: about 480 feature extractions in `beforeAll` (160 + 80 impacts, 200 + 40 background windows) (about 4 s at 44100 Hz, to be measured and recorded in this file), P6 and P8 each 100 cases of vector work (milliseconds each), P7 100 extractions of one tone each. Heavy tests get a timeout of 60 s via the third argument, scaled with `PBT_RUNS` as in `test/segment.test.ts`. If the budget is exceeded, shrink the pools (not the number of runs) first.

### Tests (all in `test/knn.test.ts`)
Example tests:

| # | Name | Requirement |
|---|---|---|
| 1 | classifies held-out examples of 4 synth classes with at least 95 % accuracy (10 train, 20 test per class, other seeds) | 5.1 to 5.6, plan |
| 2 | throws TooFewExamplesError listing counts when a label has 4 examples | 2.1, 2.2 (Review Focus 3) |
| 3 | the error message marks labels below 5 and lists labels alphabetically; a `background` label with 4 examples also throws; an empty list throws with `{}` | 2.2, 2.3 |
| 4 | trains with exactly 5 examples per label | 2.4 |
| 5 | a single-label model classifies its own sound and rejects a far one as unknown (a different synth class, and a tone) | 2.4, 5.5 (Review Focus 3) |
| 6 | model JSON round-trips through JSON.stringify and parse with identical results on all held-out segments | 8.1 |
| 7 | model has no samples: examples have exactly the keys id, label, v; no NaN or Infinity; no Float32Array anywhere | 8.2, 8.3 |
| 8 | a dimension that is constant in training does not make a slightly different example unknown (std equals 0.01, standardized offset 0.5) | 3.4, 3.2 |
| 9 | std floor: with range 10 and raw std 0.2, std is 0.5 (0.05 x range); with range 0.1 and raw std 0.001, std is 0.01 (the absolute floor wins over 0.05 x 0.1 = 0.005); with range 10 and raw std 3, std stays 3 | 3.2 |
| 10 | mean and std use the population formula (dimension values 1, 2, 3, 4, 5 give raw std sqrt(2)) | 3.1 |
| 11 | classify returns the id of the nearest training example (end to end, a copy of a training segment gives distance 0 and its own id; `nearest` equals the brute-force nearest from `model.examples`) | 5.7, 1.4 |
| 12 | threshold equals 1.5 x the 95th percentile (type 7) of the LOO distances: one label at 0, 1, 2, 3, 10 gives LOO 1, 1, 1, 1, 7, percentile 1 + 0.8 x 6 = 5.8, threshold 8.7 in raw units divided by `std` | 4.1 to 4.3 |
| 13 | LOO ignores other labels: a close example of another label does not shrink the threshold | 4.1 |
| 14 | identical examples give threshold 0, no throw; a query equal to them is a match with confidence 1; a different query is unknown | 4.5, 5.6 |
| 15 | majority 2-1 beats the nearest example of the minority label, and `nearest` still names the minority example | 5.2, 5.7 |
| 16 | 1-1-1 tie goes to the label of the nearest example | 5.3 |
| 17 | equal distances order by id (two examples of different labels at the same distance) | 5.4 |
| 18 | unknown when the distance to the winning label's nearest example is just above its threshold, match (confidence 0) at exactly the threshold, and each side uses the winner's threshold, not another label's | 5.5, 5.6 |
| 19 | confidence is 1 at distance 0, 0.5 at half the threshold, and never below 0 | 5.6 |
| 20 | `background` as winner is returned as a match with label `background`; far from everything is unknown | 5.8 |
| 21 | `model.sampleRate` is the sample rate of the first example in the input order, and the model is unchanged by sorting | 7.3, 1.2 |
| 22 | statistics exclude background: adding 200 background examples leaves mean, std, and the real labels' thresholds unchanged; with only background labels, statistics use all examples | 3.5, 3.6, 6.1 |
| 23 | a segment at another sample rate than the model's is classified without error | 5.9 |
| 24 | duplicate ids throw RangeError; vectors of different length or with NaN throw RangeError; a query vector of the wrong length throws RangeError | 2.5, 2.6 |
| 25 | 10 examples per label plus 200 background examples still classify held-out examples of the real labels at >= 95 % | 6.3 |
| 26 | the background model is not more than 5 points worse than the model without background; held-out background windows are not classified as a real label in at least 90 % | 6.4, 6.5 |
| 27 | trainVectors for 240 examples of 32 dimensions takes under 500 ms | 11.4 |
| 28 | the source of `core/classify/knn.ts` has no forbidden import, `Math.random`, `fetch`, `Date` or `performance` | 11.1, 8.4 |

Property tests:

| Property | Name (ends with) | Generates | Asserts |
|---|---|---|---|
| P6 | `P6 self-consistency: every training example classifies as its own label (Req 9.1)` | Label count 2 to 4 (a subset of the four classes), example count 5 to 20 per label, drawn from the pool seeds, in any order | Each training vector gives `match`, own label, own id, distance 0 |
| P7 | `P7 a synth tone is unknown to an impact-only model (Req 10.1)` | Label subset (2 to 4 classes, 10 examples each), `f0Hz` 100 to 800, `durationMs` 300 to 1500, `gainDb` -20 to 0, vibrato 0 or 30 cents, seed | `classify` of the tone segment is `unknown`, and `nearest.distance` is finite |
| P8 | `P8 shuffling training examples does not change the model or any classification (Req 7.2, 7.4)` | A label subset, example counts, and a shuffle of the training list (`fc.shuffledSubarray` of full length) | Deep-equal models (except for `sampleRate`, identical here), and equal results for all held-out vectors |

P6 uses the guarantee of 9.2 (labels from distinct classes). P8 also checks 7.2 on the model itself, so that a platform where float summation order matters would be caught.

## Behaviour that follows from the rules
- **A sound that looks like two of my labels.** The vote decides. With 1-1-1 the nearest wins. If its distance is above that label's threshold, the result is `unknown`, even if another label is only slightly farther.
- **Few examples.** At 5 examples per label the threshold uses the 80 % interpolation of the largest of 5 LOO distances. With a label that has one outlier example, the threshold becomes wide. The teaching report (Task 8) shows `looAccuracy` so the user can delete the outlier.
- **One label.** The vote is trivial. Everything rests on the threshold: a far sound is `unknown`. The 95th percentile x 1.5 is the only guard.
- **Mixed sample rates.** Features are rate-independent by Task 3's design (within 5 %), so classification works across 44.1 and 48 kHz. The model stores only the first rate for the overlay warning. 16 kHz segments lose high-band content and may be `unknown`; this is the documented design behaviour.
- **Retraining one label (design 5.1).** `trainVectors` takes vectors, so Task 8 or the web UI can replace one label's vectors and call it again without any recording. No new interface is needed for this task.
- **Cost.** `train` is `O(n^2 d)`, `classify` `O(n d + n log n)`. At 240 examples both are far below a hop of audio (5 ms), so a segment is classified immediately.

## Measured values
Filled in during the work (Task 4 followed the same practice): feature extraction time per segment, the whole test file at `PBT_RUNS` 20 and 100, accuracy numbers of tests 1, 25 and 26, and any counterexample found by P6 to P8 together with the rule change it caused.

### Results (2026-11-19)
- Fixture build (480 feature extractions: 160 + 80 impacts, 200 + 40 background windows): about 1.7 s.
- Accuracy on 80 held-out impacts: test 1 (10 per class, no background) 0.975; test 25 (with 200 background windows) 0.975; test 26: without background 0.975, with 0.975, held-out background windows not taken for a real label 1.0.
- 	est/knn.test.ts runtime: 6.9 s at PBT_RUNS=20, 13.1 s at PBT_RUNS=100, 95.5 s at PBT_RUNS=1000 (all pass). 
pm run pbt:quick (segment and knn files): 14.1 s.

### Counterexamples found by P6 and the rule change
P6 failed in two runs with the first draft (pure k = 3 vote). Example 1: labels ing, high, low, 5 examples each, example high/1003#0. Its two nearest other examples were ing/1001#0 (7.36) and ing/1003#0 (7.52), so ing won 2-1. The ing threshold is 4.91, so the result was unknown, although the example is a stored high example at distance 0 (high is spread out, threshold 11.87). A first fix (fall back to the nearest example's label when the winner is too far) did not hold: example 2 (mid, low, high, counts 5, 6, 5) was outvoted by a mid pair that was within the wide mid threshold, so the result was a match with the wrong label. Final rule: a vector identical to a stored example (distance exactly 0) takes that example's label (Requirement 5.10). The fallback was removed again, so the unknown rule of 5.5 is unchanged. The property and the limits were not changed.