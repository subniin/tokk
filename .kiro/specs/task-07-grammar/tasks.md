# Tasks: Task 7, sound pattern grammar

Order is test-first. Do not write `core/grammar.ts` before the tests fail. Runtime target for `test/grammar.test.ts`: under 5 s at `PBT_RUNS=100`, under 3 s at `PBT_RUNS=20` (see `design.md`).

- [x] 1. Check prerequisites
  - [x] 1.1 Confirm that `GAP_CONSECUTIVE_MAX_MS` (350), `GAP_REST_MAX_MS` (1000), `HUM_DEADZONE_SEMITONES` (2), `HUM_SPEED_MAX_SEMITONES` (6) and `BACKGROUND` exist in `core/constants.ts`. `GAP_TOLERANCE_MS` is the only constant this task adds (step 3.1). (Req 12.2)
  - [x] 1.2 Confirm that `core/types.ts` has `SoundEvent` and `MatchEvent` and that `test/setup.ts` reads `PBT_RUNS`. Confirm that `@fast-check/vitest` is installed.
  - [x] 1.3 Confirm that `scripts/pbt-quick.ts` lists `test/grammar.test.ts` among its candidate files, and that the Tasks 1 to 5 and 11A tests pass.

- [x] 2. Write failing tests in `test/grammar.test.ts`
  - [x] 2.1 Put the test-only values at the top of the file, not in `core/constants.ts`: `TEST_SAMPLE_RATE_HZ`, `JITTER_MAX_MS`, the gap class ranges of P5, the baseline, the counts of the properties, the 500 ms bound of test 33, and the timeouts that grow with `PBT_RUNS`.
  - [x] 2.2 Write the helpers `eventTimeS`, `sound`, `pitch`, `hzAbove` and `run` of `design.md`. Build every event time as a sample count divided by the sample rate, with the sample count derived from ms and the rate. No literal sample counts. (Req 12.4)
  - [x] 2.3 Write example tests 1 to 4 (the plan's four sequence tests) and 5 to 6 (`parsePattern`, ok cases and every rejected case). Test names carry their requirement. (Req 2, 4, 5)
  - [x] 2.4 Write tests 7 to 13 (gap borders at 349, 350, 1000 and 1001 ms; gap from the previous `t`; waiting time by next token and the mixed case; the clap-after-knock case; break fires the exact pattern; no backtracking; match `t` in the three ways to fire). (Req 4, 5, 6, 7)
  - [x] 2.5 Write tests 14 to 18 (duplicate patterns, empty list, `setPatterns` drops and replaces, `setPatterns` with an invalid pattern keeps the old state, mode switch removes the wait). (Req 3, 10)
  - [x] 2.6 Write tests 19 to 21 and 31 (`background` ignored, continuous `start` and `end` ignored, hum and sound logic independent, unknown label breaks a sequence). (Req 8)
  - [x] 2.7 Write tests 22 to 28 (hum rise, dead zone, fall, speed cap, every update, only the registered direction, constructor and `setPatterns` errors for the baseline). (Req 3, 9)
  - [x] 2.8 Write tests 29, 30 and 32 (invalid input throws and leaves the state, `advance` rules, pattern strings as given and no `speed` key on sound matches). (Req 1.4, 3.2, 6, 8)
  - [x] 2.9 Write tests 33 to 35 (speed bound, source scan, constant exists). (Req 12)
  - [x] 2.10 Write the three properties with `test.prop` from `@fast-check/vitest`: P5a, P5b, P5c (Req 11). Put a comment above each with the property number and the requirement and end each name with the requirement. Do not set `numRuns`. Remove duplicate patterns in the generator before building a matcher.
  - [x] 2.11 Run the grammar test file and confirm FAIL (module missing).

- [x] 3. Implement `core/grammar.ts`
  - [x] 3.1 Add `GAP_TOLERANCE_MS = 1e-6` to the Grammar section of `core/constants.ts` with a one-line comment. (Req 4.4, 12.2)
  - [x] 3.2 `PatternToken` and `parsePattern` with every error of Requirement 2. (Req 2)
  - [x] 3.3 Pattern compilation: steps with gap kinds, hum patterns, duplicate detection, baseline checks, all-or-nothing validation shared by the constructor and `setPatterns`. (Req 3, 4.1)
  - [x] 3.4 Helpers `gapOk`, `validPrefix`, `exact`, `candidates`, `alive` as defined in `design.md`, using the constants and the file-local `MS_PER_SECOND`. (Req 4, 5.2, 6.2)
  - [x] 3.5 `push` for sounds: rows 1 and 5 to 8 of the state table, `FIRE` and `SETTLE`, output order, input checks before any change. (Req 5, 7, 8)
  - [x] 3.6 `push` for continuous events: start and end ignored, update to the hum logic with the dead zone and the speed cap. (Req 8.2, 9)
  - [x] 3.7 `advance` with the clamp to `now`, the alive check and the flush with `Infinity`. (Req 6, 8.4)
  - [x] 3.8 `setPatterns`: validate first, then replace patterns and clear the pending sequence. (Req 3.7, 3.8, 10)
  - [x] 3.9 Run the grammar test file and confirm PASS. If P5 fails, write the counterexample into the "Measured values" section of `design.md` and change the rule, not the property and not the 30 ms jitter or the ranges.
  - [x] 3.10 Record the measured run time at `PBT_RUNS` 20 and 100 in the "Measured values" section of `design.md`. If the target is exceeded, shrink the event counts of the properties first, not the number of runs.

- [x] 4. Check the quick hook
  - [x] 4.1 Run `pbt:quick` once and confirm that it now includes `test/grammar.test.ts` and passes. The script already filters by existence, so no change is needed.
  - [x] 4.2 Confirm that saving `core/grammar.ts` is covered by the `pbt-quick` hook trigger (File Save on `core/grammar.ts`). Do not change the hook in this task.

- [x] 5. Verify and commit
  - [x] 5.1 Run the full test suite and the TypeScript check. Both pass, including Tasks 1 to 5 and 11A.
  - [x] 5.2 Run the property tests once with `PBT_RUNS` set to 1000 and confirm PASS.
  - [x] 5.3 Check that `core/grammar.ts` imports only `core/` modules, uses no `fs`, `path`, DOM, Web Audio, `Math.random`, clock or network, contains no sample count and no literal threshold (350, 1000, 2, 6), and computes no time `t`. Check that `core/index.ts` does not export `Matcher` or `parsePattern`. (Req 12, privacy and units rules)
  - [x] 5.4 Confirm no Korean text in tracked files outside `docs/_planning/`.
  - [x] 5.5 Add a line to `docs/devlog.md` with the decisions where the plan was silent: gap tolerance, giving up at 350 ms and above 1000 ms, `RangeError` for pattern errors, duplicate patterns rejected, start and end events and `background` ignored.
  - [x] 5.6 Commit with the message `feat: add sound pattern grammar`.
