# Requirements: Task 30, patterns in expectEvents

## Introduction
`expectEvents` checks sound names only. A test that passes `['clap', 'clap']` does not show that the pattern `clap clap` fires, because the grammar can hold a match back (`clap clap` waits while `clap clap clap` can still extend it). The operator's code review asked for a check of the patterns themselves.

## Requirements
1. `expectEvents(wavPath, expected, { sounds, patterns?, matches? })`. Both new fields are optional and a call without them behaves as before.
2. `patterns` is the pattern set of one mode. The recording runs through the engine with exactly this set, so the grammar interplay is the app's.
3. `matches` lists the patterns expected to fire, in order. It is checked only when given. Without `patterns`, the pattern set is `matches` without duplicates, in order.
4. The sound-name check is unchanged. A failure message names the sound lists and the match lists when both differ, and keeps the unknown-time part.
5. `ExpectEventsError` has `expectedMatches` and `actualMatches`. Both are `undefined` when no `matches` was given.
6. An invalid pattern rejects with the grammar's `RangeError` before any check.
7. No new export name. The public types change only by the optional fields. `check:public-api` expectations change only if this spec shows they must (they do not).
8. Tests use the recordings in `cases/slides/recordings`. No new recording.
9. `test/slides-events.test.ts` also passes `patterns` and `matches`. This is a named, later improvement; the measured stage 2 of task 26 stays as committed.
10. `integrate.md`, the integrate skill and the integrator agent prompt say that the test per pattern uses `patterns` and `matches`. The README Node tools section has one short example.
11. `docs/kiro.md` has one row, `docs/devlog.md` one line dated 2026-11-21.
12. Out of scope: `core/` changes, new recordings, `docs/_planning/`.
