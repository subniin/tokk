# Tasks: Task 4, Chunk-invariant onset segmenter

Order is test-first. Do not write `core/segment.ts` before the tests fail.

- [x] 1. Check prerequisites
  - [x] 1.1 Confirm that every Segmenter constant listed in `design.md` exists in `core/constants.ts` with the plan's value. Add nothing unless a value is missing. (Req 13.2)
  - [x] 1.2 Confirm that `test/helpers/resample.ts`, `test/setup.ts` (the `PBT_RUNS` setup) and `core/synth.ts` exist and that the Task 1 to 3 tests pass.

- [x] 2. Write failing tests in `test/segment.test.ts`
  - [x] 2.1 Put the test-only values (`P4_TOLERANCE_S`, `P4_SLACK_S`, `ADAPTATION_S`, chunk size limits) at the top of the file, not in `core/constants.ts`.
  - [x] 2.2 Interface: constructor `RangeError` for bad rates, empty chunk, chunk not retained, segment `t`, `durationMs` and `samples` match the input. (Req 1)
  - [x] 2.3 Level and floor: initial -70, exact levels from alternating +a/-a input, rise at the 100 ms constant during the calibration period and the 1 s constant after it at 16000, 44100 and 48000 Hz, instant fall, clamp at -90, frozen while a segment is open. (Req 3, 4)
  - [x] 2.4 Onset thresholds: absolute -60 dBFS, rise of 6 dB, floor + 12 dB, no onset in the calibration period. The step values in `design.md` were replaced by ramp and steady cases, because the 10 ms window smears a step over two hops. (Req 5)
  - [x] 2.5 Start, end and re-onset: 5 ms lead, offset hold of 30 ms, 70 ms vs 100 ms bursts (79 ms was replaced, it sits one hop from the limit), 3 s tone gives one 1500 ms segment at 16000, 44100 and 48000 Hz. (Req 6, 7)
  - [x] 2.6 `openSegmentStart`, `flush` (open, closed, twice, continue after) and `noiseFloorDb`. (Req 8)
  - [x] 2.7 Fixed inputs: empty and silent input (Review Focus 2), three impacts 300 ms apart within 10 ms, `mid` and `high` impacts 100 ms apart give two segments at all three rates (Review Focus 5), isolated impacts of all four classes never split, clipped 0 dBFS ring gives one segment (Review Focus 4), constant white noise after 1 s, silence then -70 dBFS dither with floor never below -90. Every sound starts at or after 1000 ms. (Req 9)
  - [x] 2.8 P2 with `test.prop` from `@fast-check/vitest`: noise-only input gives no segment. Name the test with its requirement (Req 10). Do not set `numRuns`.
  - [x] 2.9 P3 with `test.prop`: chunk sizes 1-4096 cycled over the fixed signal give the same segments, samples and final floor as one call (Req 11).
  - [x] 2.10 P4 with `test.prop`: signal synthesized at 96000 Hz, resampled to 16000, 44100 and 48000 Hz, same count and `t` within 5 ms plus slack (Req 12). The timeout is at least 120 s and grows with `PBT_RUNS`.
  - [x] 2.11 Run the segment test file and confirm FAIL (module missing).

- [x] 3. Implement `core/segment.ts`
  - [x] 3.1 Constructor: rate check, derived sample counts, `alpha` and `alphaWarmup` from the real hop length. (Req 1.2, 2.1, 2.5, 4.4)
  - [x] 3.2 Internal buffer, complete-hop loop, retention of the samples still needed. (Req 2.2, 2.3)
  - [x] 3.3 Level per hop with the -90 floor, `prevLevel`. (Req 3)
  - [x] 3.4 Idle state: onset test with the four conditions and the gap in samples, no onset in the calibration period, segment start with lead, floor update only when no onset. (Req 4, 5, 6.1)
  - [x] 3.5 Open state: maximum length, offset hold, then the two-stage re-onset (candidate, confirmation from buffered samples), in this order. (Req 6.2 to 6.5, 7)
  - [x] 3.6 `flush`, `openSegmentStart`, `noiseFloorDb`, copy of output samples. (Req 1.4, 1.5, 8)
  - [x] 3.7 Run the segment test file and confirm PASS. P2 and P4 first failed (counterexamples in `design.md`, section "Why"). The rules were changed, not the properties and not the tolerance. Result: 35 of 35 pass, also at `PBT_RUNS=1000`.
  - [x] 3.8 Add the six constants of Requirement 13.3 to `core/constants.ts` and record the measured margins in `design.md`.

- [x] 4. Verify and commit
  - [x] 4.1 Run the full test suite and the TypeScript check. Both pass, including Tasks 1 to 3.
  - [x] 4.2 Run the property tests once with `PBT_RUNS` set to 1000 and confirm PASS.
  - [x] 4.3 Check that `core/segment.ts` imports no `fs`, `path`, DOM or Web Audio API, uses no `Math.random` or clock, and hard-codes no sample counts or thresholds. (Req 13)
  - [x] 4.4 Confirm no Korean text in tracked files (outside `docs/_planning/`).
  - [x] 4.5 Add a line to `docs/devlog.md`.
  - [x] 4.6 Commit with the message `feat: add chunk-invariant onset segmenter`.
