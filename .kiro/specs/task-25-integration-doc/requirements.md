# Requirements: Task 25, integration measurements

## Introduction
Task 25 is the first task of plan 4. It writes `docs/integration.md`, the one place where the measured development values of the two apps are kept, and a test that keeps the document honest. The document uses only measured numbers. A value that has not been measured says "not measured yet". The two apps and their wiring line counts exist (Tasks 22 and 23); the third case is task 26.

| Consumer | What it uses from this task |
|---|---|
| Task 26 | Fills the third-case row. |
| Task 27 (README), Task 28 (submission texts) | Take times, credits and line counts from this document. |

## Requirements
1. `docs/integration.md` is in English and has five parts: how the numbers were measured; one table with one row per case; the shared template work; the human checks with a real microphone; a note on synthetic sounds.
2. Measurement rules (part 1): start is the Kiro run that wrote the app's spec; end is the commit whose tests met the app's completion criteria; times come from Kiro run logs and git commit times; times are Kiro wall-clock time with no manual coding.
3. Case table columns: target, sounds taught, wiring lines, time, Kiro credits, what Kiro did, what the orchestrator corrected. Rows: Hands-Free (task 22), Knock Once for Yes (task 23), and a third row that says "not done yet".
4. The wiring lines are the numbers that `scripts/count-wiring.ts` computes. The document also lists the count of every group (`apps/hands-free`, `apps/knock-once`, `examples/hello`).
5. Shared template work (tasks 20 and 21) is listed apart and is not counted in either app.
6. The human-check table has one row per check, each with what to measure, the target as the design states it, and the value "not measured yet".
7. The document has no placeholder (`N hours`, `M hours`, `TBD`, `TODO`) and uses no number other than the ones the operator gave.
8. `test/integration-doc.test.ts` checks requirements 4, 6 and 7 by calling `collectGroups` from `scripts/count-wiring.ts` (it does not start npm).
9. `docs/kiro.md` has one row for this spec, because `test/kiro-config.test.ts` lists the spec folders. `docs/devlog.md` has one line for task 25 dated 2026-11-20.
10. Out of scope: any change to code, `README.md`, `docs/_planning/`, other specs or the third case.
