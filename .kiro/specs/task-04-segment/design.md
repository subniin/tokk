# Design: Task 4, Chunk-invariant onset segmenter

## Layer rule
`core/segment.ts` is pure TypeScript. No `fs`, `path`, DOM, or Web Audio. No dependencies, no `Math.random`, no clock. All thresholds are in ms and dB. Sample counts come from the sample rate and the constants, never from literals. The unit conversion factor 1000 is a file-local `MS_PER_SECOND`, as in `core/synth.ts`.

## Interfaces
```ts
// core/segment.ts
export class Segmenter {
  constructor(sampleRate: number)
  push(chunk: Float32Array): Segment[]
  flush(): Segment[]
  noiseFloorDb(): number
  openSegmentStart(): number | null     // seconds, null when no segment is open
}
```
`Segment` is the type from `core/types.ts` (`t`, `durationMs`, `samples`, `sampleRate`).

## Constants
All values already exist in the Segmenter section of `core/constants.ts`: `SEGMENT_HOP_MS` (5), `LEVEL_WINDOW_MS` (10), `SILENCE_LEVEL_DBFS` (-90), `NOISE_FLOOR_INITIAL_DBFS` (-70), `NOISE_FLOOR_MIN_DBFS` (-90), `NOISE_FLOOR_RISE_TIME_CONSTANT_MS` (1000), `ONSET_ABOVE_FLOOR_DB` (12), `ONSET_MIN_LEVEL_DBFS` (-60), `ONSET_RISE_DB` (6), `ONSET_MIN_GAP_MS` (80), `ONSET_LEAD_MS` (5), `REONSET_MIN_SEGMENT_AGE_MS` (80), `OFFSET_ABOVE_FLOOR_DB` (6), `OFFSET_HOLD_MS` (30), `SEGMENT_MAX_MS` (1500). **This task adds six constants** to the same section (values in Requirement 13.3): `REONSET_RISE_DB` (3), `REONSET_CONFIRM_MS` (70), `REONSET_CONFIRM_BEFORE_MS` (30), `REONSET_CONFIRM_DB` (2.4), `NOISE_FLOOR_WARMUP_MS` (1000) and `NOISE_FLOOR_WARMUP_RISE_MS` (100). If implementation shows another value is missing, it goes in the Segmenter section of `core/constants.ts` with a unit in its name.

Test-only values (`P4_TOLERANCE_S` 0.005, `P4_SLACK_S` 0.0001, `ADAPTATION_S` 1.0, `LEAD_MS` 1000, the chunk size range 1-4096, the re-onset example gains and seeds, the timeout floor and per-run timeout costs) live at the top of `test/segment.test.ts`.

## Derived sample counts
Computed once in the constructor from `sampleRate`, each as `round(ms x sampleRate / MS_PER_SECOND)`:

| Name | From | 16000 Hz | 44100 Hz | 48000 Hz |
|---|---|---|---|---|
| `hop` | `SEGMENT_HOP_MS` | 80 | 221 | 240 |
| `window` | `LEVEL_WINDOW_MS` | 160 | 441 | 480 |
| `lead` | `ONSET_LEAD_MS` | 80 | 221 | 240 |
| `gap`, `age` | `ONSET_MIN_GAP_MS`, `REONSET_MIN_SEGMENT_AGE_MS` | 1280 | 3528 | 3840 |
| `hold` | `OFFSET_HOLD_MS` | 480 | 1323 | 1440 |
| `confirmPost` | `REONSET_CONFIRM_MS` | 1120 | 3087 | 3360 |
| `confirmPre` | `REONSET_CONFIRM_BEFORE_MS` | 480 | 1323 | 1440 |
| `warmupEnd` | `NOISE_FLOOR_WARMUP_MS` | 16000 | 44100 | 48000 |
| `maxLen` | `SEGMENT_MAX_MS` | 24000 | 66150 | 72000 |

`hopSeconds = hop / sampleRate` is the real hop length (5.011 ms at 44100 Hz). The floor rise coefficient is `alpha = 1 - exp(-hopSeconds / (NOISE_FLOOR_RISE_TIME_CONSTANT_MS / 1000))`, and `alphaWarmup` is the same with `NOISE_FLOOR_WARMUP_RISE_MS`. `confirmRatio = 10^(REONSET_CONFIRM_DB / 10)`. The constructor throws `RangeError('sampleRate ...')` when `sampleRate` is not positive and finite or when `hop` rounds to 0 (below 100 Hz).

Why integers: a comparison such as "16 hops x 5 ms >= 80 ms" in floating point can fail by one ULP at 48000 Hz. Comparing sample counts (`16 x 240 = 3840 >= 3840`) cannot.

## Streaming and chunk independence
- **Buffer.** `push` appends the chunk to an internal buffer, then analyzes every hop that is now complete: hop `h` covers samples `[h x hop, (h + 1) x hop)`. The remainder stays in the buffer for the next `push`. Which hops are analyzed, and in which order, depends only on the total sample count, so any chunking gives the same sequence of hops (P3).
- **Retention.** The buffer keeps the samples from `min(open segment start, nextHopStart - max(window, lead))` onward. Older samples are dropped, so memory stays near the longest open segment (1.5 s) and does not grow with the input. A segment is copied out when it closes.
- **Time.** All positions are absolute sample indices counted from the first sample pushed. `t = startSample / sampleRate`.
- **Level, no running sums.** Each hop computes the sum of squares over its window directly, in `float64`, from the buffer. A running sum would carry rounding error that depends on where the stream started, and would still be the same for every chunking, but direct computation is simpler to reason about and costs one window per 5 ms.

## Per-hop procedure
State: `floor`, `prevLevel` (starts at -90), `lastOnsetHop` (none), `lastEnd` (0), and the open segment (`start` sample, `onsetHop`, `belowCount`) or none. For hop `h` with end sample `e = (h + 1) x hop`:

1. **Level.** `level = max(SILENCE_LEVEL_DBFS, 20 log10(rms))` over `[max(0, e - window), e)`, with `rms` 0 giving -90.
2. **No segment open.** If all four hold **and the hop ends after `warmupEnd`**, open a segment:
   - `level > floor + ONSET_ABOVE_FLOOR_DB`
   - `level >= ONSET_MIN_LEVEL_DBFS`
   - `level - prevLevel >= ONSET_RISE_DB`
   - `lastOnsetHop` is none, or `(h - lastOnsetHop) x hop >= gap`

   Opening sets `start = max(h x hop - lead, lastEnd)` (not below 0 because `lastEnd` starts at 0), `onsetHop = h`, `belowCount = 0`, `lastOnsetHop = h`. The floor is not updated on this hop. If the hop is not an onset (including every hop inside the calibration period), update the floor: `level < floor` sets `floor = max(level, NOISE_FLOOR_MIN_DBFS)`, `level > floor` sets `floor += a x (level - floor)`, where `a` is `alphaWarmup` if `e <= warmupEnd` and `alpha` otherwise.
3. **Segment open** (the hop is later than `onsetHop`). The floor is not updated. In this order:
   1. **Maximum.** If `e - start >= maxLen`: emit `[start, start + maxLen)`, set `lastEnd = start + maxLen`, close, drop any pending candidate.
   2. **Offset.** Else if `level < floor + OFFSET_ABOVE_FLOOR_DB`: `belowCount += 1`; otherwise `belowCount = 0`. When `belowCount x hop >= hold`, emit `[start, e)`, set `lastEnd = e`, close, drop any pending candidate.
   3. **Re-onset (two stages), only if the segment is still open.**
      - *Candidate.* If no candidate is pending, `(h - onsetHop) x hop >= age`, and `level - prevLevel >= REONSET_RISE_DB`: the hop becomes the pending candidate. It remembers its hop index and starts a list of levels.
      - *Decision.* If a candidate is pending, add this hop's level to its list. When `e >= c + confirmPost`, with `c = candidate hop x hop`, decide and clear the candidate: `post` = mean of squares over `[c, c + confirmPost)`, `pre` = mean of squares over `[c - confirmPre, c)`. Confirm if `post > 0` and `post >= pre x confirmRatio`.
      - *Confirmed.* Let `newStart = c - lead` (greater than `start` because `age > confirmPre + lead`). Emit `[start, newStart)`. Open a new segment at `newStart` with `onsetHop` = the candidate hop and `belowCount` = the number of trailing hops in the candidate's level list that are below `floor + OFFSET_ABOVE_FLOOR_DB`. Set `lastOnsetHop` to the candidate hop and `lastEnd = newStart`.
4. `prevLevel = level`.

The maximum and offset rules run first and keep the old segment's own end rules until a re-onset is confirmed. If the old segment closes while a candidate is pending, the candidate is dropped (a hit that arrives in the last 70 ms of a maximum-length segment is merged into the cut; this is rare and follows from the rule order). Both windows lie inside the buffer: `c - confirmPre >= start` because the candidate is at least `age` (80 ms) after the segment start, and the buffer keeps everything from the open segment start.

Why the maximum is checked before the offset: both close the segment, and the maximum end `start + maxLen` is never later than `e`. A segment never exceeds 1500 ms.

## Behaviour that follows from the rules
- **Fast knocks.** Segment `A` is open when knock `B` arrives 100 ms later. `B`'s hop is at least `age` after `A`'s onset hop, and the level rises, so the hop becomes a candidate. The 70 ms after it hold much more energy than the 30 ms before it (the decaying tail of `A`), so `B` is confirmed, `A` is cut at `B`'s start (lead before the candidate hop) and `B` opens. The cut is made about 70 ms after `B` began, but its position is the candidate hop, so `t` stays precise. With 80 ms or less between the onsets, the candidate rule does not apply and `B` is merged into `A`. This is the plan's behaviour (minimum gap 80 ms).
- **Isolated impact with a fluctuating tail.** The tail of a `low` impact (narrowband noise) rises 3 dB or more in one hop at ages above 80 ms, so it becomes a candidate. The confirmation finds no lasting extra energy (at most 1.29 dB in the measurements), so the candidate is dropped.
- **Clipped impact with ring.** A 0 dBFS impact rings with a decaying level. Level only falls, so no hop rises by 6 dB after the first, and the segment ends 30 ms below the offset line. One segment.
- **Steady tone, 3 s.** The onset at the start opens a segment. At 1500 ms it is cut. The floor was frozen at its pre-onset value, then rises slowly (1 s constant) toward the tone level. The level never rises 6 dB over the previous hop, so no new segment opens.
- **Dither at -70 dBFS.** Never reaches -60 dBFS, so no onset. The floor falls to -90 during digital silence, then rises toward -70 with the 1 s constant.
- **Constant noise.** Noise from sample 0 never opens a segment, because no onset is accepted in the first 1000 ms and the floor follows the noise with the 100 ms constant during that time (about 10 time constants, so it ends within about 0.1 dB of a steady level). After the calibration period the level fluctuates less than 6 dB per hop above the floor + 12 dB test, so nothing opens later. P2 therefore asserts no segment at all.
- **Offset line vs. a noisy room.** The floor is frozen while a segment is open. If the room is above `floor + 6 dB` at the end of a sound (floor still at the -70 default), the segment runs to the 1.5 s maximum. This is the plan's behaviour. The teach page will tell the user to record one second of silence first (design 5.1).

## `flush`
If a segment is open, emit `[start, min(totalSamples, start + maxLen))` and close it. The partial hop at the end of the stream is not analyzed, which keeps the result independent of chunking: the same total input always gives the same hops. After a flush the object keeps `floor`, `prevLevel`, `lastOnsetHop` and the timeline. A pending re-onset candidate is dropped by `flush`. A second flush returns `[]`.

## `openSegmentStart` and `noiseFloorDb`
`openSegmentStart()` returns `start / sampleRate` of the open segment, or `null`. A segment becomes open only when its onset hop has been analyzed, so the answer can lag the real sound by up to one hop plus the 10 ms window. A re-onset becomes visible about 70 ms later (the confirmation window), so while a candidate is pending the method still reports the start of the old segment. That start is earlier than the pending hit, so the matcher in Task 8 is never advanced past a sound that is still open. The engine in Task 8 relies on this: it advances the pattern matcher only to this time, so a still-open segment cannot be overtaken. `noiseFloorDb()` returns `floor`.

## Output copy
When a segment closes, `samples` is `Float32Array.from` the buffer range (a copy). A chunk the caller passed is only read from, never stored. The segment can be longer than one chunk, so it is assembled from the buffer, not from chunk slices.

## Test helper use
`test/helpers/resample.ts` (from Task 3) is used by the P4 test only. The 96000 Hz signal is built with `synthImpact`, `synthNoise` and `place` from `core/synth.ts` and a seeded `rng`.

## File layout (created by Task 4)
```
core/ segment.ts          (new)
test/ segment.test.ts     (new)
.kiro/specs/task-04-segment/
```
`core/constants.ts` is not edited.

## Testing
`test/segment.test.ts` (vitest and `@fast-check/vitest`). Synthetic input comes from `core/synth.ts` with fixed seeds. Property tests use `test.prop` and take the number of runs from `fc.configureGlobal` in `test/setup.ts` (`PBT_RUNS`, default 100). They do not set `numRuns` themselves. Each property test name starts with its property number and names the requirement.

Fixed tests:
- Interface (Req 1): constructor `RangeError` for 0, negative, NaN, Infinity and 50 Hz; `push` of an empty chunk returns `[]`; changing a chunk after `push` does not change later segments; `samples` equals the input slice at `round(t x sampleRate)` for the given length; `t` and `durationMs` match start sample and length.
- Level and floor (Req 3, 4): `noiseFloorDb()` is -70 before data. Alternating +a/-a samples have RMS exactly `a`, which gives exact levels. During the calibration period at -65 dBFS the floor equals `-65 - 5 exp(-elapsed / 0.1)` and after it `-65 - d1 exp(-elapsed)`, where `d1` is the gap left at 1 s, both within 0.01 dB at 16000, 44100 and 48000 Hz and `elapsed = hops x hop / sampleRate`. A drop lowers the floor to the new level once the 10 ms window is fully inside it (six hops of 5 ms). Silence lowers it to -90 and no further. While a segment is open at -30 dBFS (after 1 s of silence), the floor stays at its value from before the onset.
- Onset thresholds (Req 5): the 10 ms window spreads a step over two hops, so single steps with a few dB of margin do not give the per-hop rise they appear to have. The tests use steady levels and ramps with a known rise per hop instead. -61 dBFS steady gives no segment and -50 dBFS steady gives one (absolute level). A ramp of 5 dB per hop gives none, 9 dB per hop gives one. After 5 s at -62 dBFS (floor close to -62), a ramp that stops at -55 dBFS gives none and one that reaches -40 dBFS gives one (floor + 12 binds). A burst that ends inside the calibration period gives no segment (Req 5.5).
- Start and end (Req 6, 7): a 100 ms burst at -30 dBFS gives a segment that starts 5 ms before the onset hop and ends between 30 and 55 ms after the burst end. A 3 s steady tone gives exactly one segment of 1500 ms with `round(1500 x sampleRate / 1000)` samples at 16000, 44100 and 48000 Hz. After the cut, no second segment opens. Re-onset: a louder burst 70 ms after the first merges (the 79 ms of the first draft sits one hop from the 80 ms limit and can fall on either side), one 100 ms after it makes two.
- `openSegmentStart` (Req 8): `null` before data; equal to the later `t` while a segment is open; `null` after it closes; `null` after `flush`. `flush` of an open segment returns it with length at most 1500 ms; a second `flush` returns `[]`; pushing more data after `flush` keeps the floor.
- Inputs (Req 9): empty and 1 s of zeros give no segments and no exception. Three `mid` impacts 300 ms apart at 48000 Hz give three segments, each `t` within 10 ms of the impact. Two `mid` or two `high` impacts 100 ms apart give two segments at 16000, 44100 and 48000 Hz, for gains -20, -6 and 0 dB and 40 seeds each (Review Focus 5). A single impact of each of the four classes gives exactly one segment at all three rates, for the same gains and seeds. A `ring` impact at +6 dB hard-clipped to +/-1, with its 200 ms ring, gives exactly one segment (Review Focus 4). White noise at -30 dBFS for 3 s gives no segment starting at or after 1 s. 1 s of digital silence followed by white dither at -70 dBFS gives no segment, and `noiseFloorDb()` is at least -90 after every hop-sized push. Every sound in these tests starts at or after 1000 ms.

Property tests:
- **P2** (Req 10): kind (`white` or `pink`), level -60 to -20 dB, sample rate (16000, 44100, 48000), seed. 4 s of noise. No segment is returned at all.
- **P3** (Req 11): `fc.array(fc.integer({ min: 1, max: 4096 }), { minLength: 1 })` gives the chunk sizes, cycled. The signal and its one-call result are built once: 4.2 s at 44100 Hz with 1 s of lead-in, a `mid` impact at 1.2 s, a `low` impact at 1.8 s and a `high` impact at 1.9 s (re-onset), a 1.7 s `synthTone` from 2.3 s (maximum cut), and white noise at -80 dBFS. The test compares the chunked result with the one-call result: `t`, `durationMs`, `sampleRate`, all samples, and the final `noiseFloorDb()`. Its timeout is `max(120 s, 50 ms x PBT_RUNS)`.
- **P4** (Req 12): number of impacts (1-2), classes, gains, gap (500-800 ms), noise level (-90 to -70 dBFS, or none), seed. The first impact is at 1200 ms and the signal is 3 s long at 96000 Hz, then resampled to 16000, 44100 and 48000 Hz. The test compares segment counts and, pairwise, `t` within `P4_TOLERANCE_S + P4_SLACK_S`. The timeout is `max(120 s, 2 s x PBT_RUNS)`, because the windowed-sinc resampler costs about 0.6 s per run (570 s for 1000 runs).

Assumption: the P4 slack of 0.1 ms is added because the hop at 44100 Hz is 221 samples, which is 5.011 ms. When the onset lands near a hop boundary, 44100 Hz can detect it one hop later than 16000 Hz or 48000 Hz, and the difference is then 5.011 ms, not 5 ms. The 5 ms limit of the plan is otherwise kept. If a property run fails by more than the slack, find the cause in the segmenter. Do not raise the tolerance.

Risk and rule: the thresholds are the plan's defaults, and the 11/19 experiment may change them in `core/constants.ts`. The tests above use levels with margin (at least 3 dB from every threshold) so that a small change in constants does not break them. A test that fails after a constants change is a sign to read the experiment record, not to loosen the test.

## Why: two rule bugs found by the property tests

Both bugs were found by fast-check in this task and fixed in the rules, not in the properties.

**1. Floor too slow at the start of the stream (P2).** Counterexamples: `["pink", -20, 16000, seed 3]` gave a segment at 1.795 s, and `["pink", -20, 44100, seed 477378]` gave one at 3.07 s. Noise from sample 0 opened a segment at once. The floor is frozen while a segment is open (Req 4.5), so it stayed at -70 dBFS for the whole 1.5 s of that segment. A trace of the first case showed the floor at -57.2 dBFS at 1.795 s, 13 dB above its start but about 37 dB under the noise, and a 6 dB fluctuation then passed "level > floor + 12". Fix: a calibration period of 1000 ms in which the floor rises with a 100 ms time constant and no onset is accepted. The rule that the floor does not change in an open segment is unchanged. A short alternative (let the floor update in segments older than 200 ms) was tried and rejected: the floor then follows a sustained tone, the tone drops below floor + 6 dB, and the offset rule cuts a 3 s steady tone at 435 ms (Req 7.4).

**2. Re-onset splits the tail of an isolated impact (P4).** Counterexamples: `[1, "low", "low", 0, 0, 500, no noise, seed 450386]` gave 2 segments at 16000 and 48000 Hz and 1 at 44100 Hz (the 10 ms level rose 6.33 dB between hops 85 and 86, 0.425 s to 0.430 s). `[2, "low", "low", 0, 0, 571, no noise, seed 19]` followed after a "level within 10 dB of the running peak" check was added. The `low` class is noise through a 300 Hz band-pass of 150 Hz bandwidth, so its envelope has a correlation time near 1 / 150 Hz = 7 ms and a 10 ms level moves by several dB from hop to hop. A one-hop rise cannot tell this from a real second hit.

Measured with a temporary script (since deleted) on single and double impacts at 16000, 44100 and 48000 Hz, gains -20, -6 and 0 dB, 60 seeds each (180 isolated impacts per class and rate, 180 double hits 100 ms apart per class and rate), candidates found after 80 ms of segment age:

| Rule tried | Isolated `low` impacts (must not split) | Real second hit, `mid` (must split) | Result |
|---|---|---|---|
| One-hop rise >= 6 dB, running-peak margin | `low` fluctuation up to 7.76 dB and 1.62 dB below the peak (16 kHz) | 10.99 dB rise and 3.22 dB below the peak (16 kHz); 44.1 kHz had no 6 dB candidate in 48 of 180 trials | No peak margin separates them |
| One-hop rise >= 9 dB | cleared all isolated impacts | 7.23 dB at 48 kHz, so missed | Fails the 100 ms test at 48 kHz |
| One-hop rise >= 3 dB, then energy confirmation (chosen) | see below | see below | Passes |

Confirmation statistic: `10 log10(mean energy over the next W_post ms / mean energy over the previous W_pre ms)`, measured at each candidate hop (rise >= 3 dB). Largest value over isolated impacts against smallest value over real second hits, for the pairs tried (gap = real minimum - isolated maximum):

| W_post / W_pre (ms) | Isolated maximum (dB) | Real `mid` minimum (dB) | Gap (dB) |
|---|---|---|---|
| 20 / 20 | 5.76 | 6.33 | 0.57 |
| 30 / 30 | 3.63 | 5.27 | 1.64 |
| 40 / 40 | 2.32 | 4.04 | 1.72 |
| 50 / 30 | 2.53 | 4.56 | 2.03 |
| 60 / 30 | 1.89 | 3.95 | 2.06 |
| **70 / 30** | **1.29** | **3.50** | **2.21** |
| 80 / 30 | 0.86 | 3.08 | 2.22 |

The chosen pair is 70 ms after and 30 ms before. By class and rate the isolated maxima are: `low` 1.15 dB (16 kHz), 1.29 dB (44.1 kHz), 0.62 dB (48 kHz); `mid` -5.4 to -5.8 dB (one candidate); `ring` -0.15 dB (16 kHz, 4 candidates); `high` no candidates. The real minima are: `mid` 4.50, 3.50 and 4.88 dB at 16, 44.1 and 48 kHz; `high` 32.2, 25.5 and 30.6 dB. `REONSET_CONFIRM_DB` = 2.4 dB sits in the middle: **1.11 dB above the largest isolated value (1.29 dB) and 1.10 dB below the smallest real value (3.50 dB)**. A candidate rise of 3 dB (`REONSET_RISE_DB`) gives a candidate in all 1080 `mid` and `high` double-hit trials (2 classes x 3 rates x 180); a rise of 6 dB missed 48 of 180 `mid` trials at 44.1 kHz and a rise of 4 dB missed 6. The pair 80 / 30 is 0.01 dB wider than 70 / 30, and 70 / 30 was chosen because its confirmation delay is 10 ms shorter.

Limits of the rule, accepted: second hits of the classes `low` and `ring` 100 ms after the first are not reliably separated. At 30 / 30 their real minima are 0.8 to 3.7 dB, near or below the isolated maxima, and many trials have no candidate at all (up to 111 of 180). The acceptance targets are therefore stated for `mid` and `high` only. A hit that arrives while the old segment closes by offset or maximum within the 70 ms decision delay is dropped with the candidate. The margins are over 60 seeds and three gains. Runs of P2, P3 and P4 at `PBT_RUNS=1000` and the fixed 40-seed tests all pass.
