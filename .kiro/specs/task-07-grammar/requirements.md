# Requirements: Task 7, sound pattern grammar

## Introduction
Task 7 adds `core/grammar.ts`. It turns the stream of `SoundEvent` values into `MatchEvent` values by comparing it with patterns such as `"knock knock _ knock"` (design 5.5). It does not know what a sound is. It knows labels, times, and two kinds of gap.

The grammar has two independent halves:
- **Sound sequences.** Sound events are collected into a pending sequence and compared with patterns made of sound names and rests (`_`).
- **Hum patterns.** `hum.rise` and `hum.fall` are compared with every pitch update. They are always a pattern of their own and never share a sequence with a sound.

The matcher is a pure state machine. The same events and the same calls to `advance` give the same matches (P5). It reads no clock and no random source. Time comes only from the `t` of events and the argument of `advance`.

| Consumer | What it uses from this task |
|---|---|
| Task 8 (engine) | `new Matcher(Object.keys(handlers), sounds.pitch?.baselineHz)`, `push` for every `SoundEvent` that is not `unknown`, `advance(min(now, openSegmentStart ?? now))` at the end of every `push`, `advance(Infinity)` in `flush`, `setPatterns` in `setMode`. The engine already drops `unknown` and `background` results, so the matcher sees them only if a caller passes them in (Requirement 8) |
| Task 10 (`mcp-ears`) | `runSamples` from Task 8, which uses the matcher when patterns are given |
| Apps (plan 2 and 3) | Pattern strings written by the developer, for example `"click click"` and `"hum.rise"` |
| P5 | Determinism and tolerance to timing jitter |

The plan's rules are copied here without change. Where the plan is silent, this document decides and says so: duplicate patterns (3.5), the exact moment a waiting sequence gives up (6.2), invalid times (8.5), and the error type (2.2).

## Requirements

### Requirement 1: Module and exports
**User story:** As the author of the engine, I want a small module with a fixed interface.

#### Acceptance Criteria
1. THE module `core/grammar.ts` SHALL export `PatternToken`, `parsePattern` and `Matcher`. `PatternToken` SHALL be `{ type: 'sound'; label: string } | { type: 'rest' }`, as in the plan.
2. THE module SHALL use `SoundEvent` and `MatchEvent` from `core/types.ts`. Those types SHALL NOT change in this task.
3. THE module SHALL NOT be re-exported from `core/index.ts` in this task. (The engine imports it from `core/grammar.ts`. The public API is decided in Task 8.)
4. THE `MatchEvent` SHALL be produced as `{ pattern, t }` for a sound pattern and as `{ pattern, t, speed }` for a hum pattern. THE key `speed` SHALL be absent, not `undefined`, in a sound match.

### Requirement 2: `parsePattern`
**User story:** As a developer, I want a wrong pattern string to fail at once with a message that names the problem, so that a pattern table with a typo does not silently match nothing.

#### Acceptance Criteria
1. THE function `parsePattern(src)` SHALL split `src` on runs of whitespace (spaces, tabs, line breaks), ignoring whitespace at the start and the end. THE token `_` SHALL become `{ type: 'rest' }`. EVERY other token SHALL become `{ type: 'sound', label: token }`, so `hum.rise` becomes `{ type: 'sound', label: 'hum.rise' }`. Labels are case sensitive and are not changed.
2. IF the pattern is invalid, THEN `parsePattern` SHALL throw a `RangeError`. THE message SHALL contain the pattern as written, in double quotes, and the reason. (Assumption: the plan names no error type. `RangeError` is the type used for bad input in Tasks 5 and 8.)
3. THE following SHALL throw: an empty string or a string of only whitespace; a pattern whose first token is `_`; a pattern whose last token is `_`; a pattern with two `_` tokens next to each other; a pattern that contains a `hum.*` token together with any other token (a sound, a rest, or another hum token).
4. A token that starts with `hum.` but is not exactly `hum.rise` or `hum.fall` (for example `hum.up`) SHALL throw, whether it stands alone or not. A label such as `hum` or `humming` (no dot) SHALL be a normal sound label.
5. THE following SHALL parse: `"knock"`, `"knock knock"`, `"knock _ knock"`, `"  knock \t knock  "` (the same tokens as `"knock knock"`), `"hum.rise"`, `"hum.fall"`. A single `_` token SHALL throw by 2.3 (it is both first and last).
6. THE parser SHALL NOT check that a label exists in a `SoundModel`, and SHALL NOT reject the label `background`. (Reserved names are the concern of Task 8 and of the teaching step.)

### Requirement 3: Matcher construction and `setPatterns`
**User story:** As a developer, I want a matcher that is built once from the patterns of the current mode and can be switched to another mode.

#### Acceptance Criteria
1. THE constructor `new Matcher(patterns: string[], baselineHz?: number)` SHALL parse every pattern with `parsePattern`. A parse error SHALL propagate unchanged.
2. THE matcher SHALL keep each pattern string exactly as given. `MatchEvent.pattern` SHALL be that string, not a normalized form.
3. IF at least one pattern is a hum pattern and `baselineHz` is `undefined`, THEN the constructor SHALL throw a `RangeError` whose message names the hum pattern and `baselineHz`. (Plan: an error, not a warning, and only when a hum pattern exists without a baseline.)
4. IF `baselineHz` is given and is not a finite number above 0, THEN the constructor SHALL throw a `RangeError`, whether or not a hum pattern exists. (Assumption: the semitone formula needs a positive finite baseline.) IF `baselineHz` is given and no hum pattern exists, THEN it SHALL be ignored.
5. IF two patterns have the same tokens (for example `"knock knock"` and `"knock  knock"`), THEN the constructor SHALL throw a `RangeError` that names both strings. (Assumption: two bindings for one sequence is a mistake. This also guarantees that at most one sound pattern can match a sequence.)
6. AN empty `patterns` array SHALL be valid. THE matcher SHALL then never return a match.
7. THE method `setPatterns(patterns)` SHALL apply 3.1 to 3.5 with the `baselineHz` given to the constructor. IF it throws, THEN the previous patterns and the pending sequence SHALL stay unchanged (all checks run before any change).
8. WHEN `setPatterns` succeeds, THE matcher SHALL discard the pending sequence without firing anything and SHALL use the new patterns from the next call on (plan: mode switch). THE matcher's idea of the current time (Requirement 8.4) SHALL NOT be reset.
9. THE method `setPatterns` SHALL return nothing.

### Requirement 4: Gap kinds and how a gap is measured
**User story:** As a user who knocks, I want the rhythm I feel to be the rhythm that is matched.

#### Acceptance Criteria
1. FOR a sound pattern, EVERY sound token after the first SHALL have a gap kind: `rest` if the token before it is `_`, otherwise `consecutive`. THE first sound token SHALL have no gap. A `_` SHALL NOT be a step of its own; it only sets the gap kind of the next sound.
2. A **consecutive** gap SHALL be a gap below `GAP_CONSECUTIVE_MAX_MS` (350 ms). A **rest** gap SHALL be a gap from `GAP_CONSECUTIVE_MAX_MS` up to and including `GAP_REST_MAX_MS` (1000 ms). So 349.9 ms is consecutive, 350 ms is rest, 1000 ms is rest, and 1000.1 ms matches neither kind. A gap below 0 SHALL be an error (Requirement 8.3).
3. THE gap between two sounds SHALL be `(t of the later sound - t of the earlier sound)` converted to ms, measured from the **`t` of the earlier sound**, not from `t + durationMs`. THE field `durationMs` SHALL NOT take part in any decision of the grammar.
4. THE comparison SHALL allow `GAP_TOLERANCE_MS` (a new constant, 1e-6 ms, Requirement 12.2) for the rounding error of `t`, which is a cumulative sample count divided by a sample rate and is not exactly representable. WHEN the tolerance is applied: a gap is consecutive if it is below `GAP_CONSECUTIVE_MAX_MS - GAP_TOLERANCE_MS`, and a gap is rest if it is at least `GAP_CONSECUTIVE_MAX_MS - GAP_TOLERANCE_MS` and at most `GAP_REST_MAX_MS + GAP_TOLERANCE_MS`. THE effect is that a gap built as exactly 350 ms or exactly 1000 ms from sample counts is classified as the plan says.
5. THE gap SHALL be taken between neighbouring sounds of the pending sequence. A rest SHALL NOT require that something was heard "during" it; it is only a longer gap.

### Requirement 5: Sequence matching
**User story:** As a developer, I want `click` and `click click` to both work, with `click` firing late only when it has to.

#### Acceptance Criteria
1. THE matcher SHALL keep one **pending sequence**: the sound events (label and `t`) that have been accepted since the last restart. It SHALL be empty at the start.
2. A sequence of `n` sounds is a **valid prefix** of a sound pattern when the pattern has at least `n` sounds, the labels of the first `n` pattern sounds equal the sequence labels in order, and for every `i` from 1 to `n - 1` the gap between sound `i - 1` and sound `i` of the sequence is of the kind of pattern sound `i` (Requirement 4.2). A pattern **matches exactly** when the sequence is a valid prefix and the pattern has exactly `n` sounds. A pattern **extends** the sequence when it has more than `n` sounds and the sequence is a valid prefix of it. Hum patterns SHALL take no part in this check.
3. WHEN a sound event arrives and the pending sequence is not empty, THE matcher SHALL form the sequence with the event added. IF that sequence is a valid prefix of at least one sound pattern, THEN the event SHALL be added to the pending sequence.
4. OTHERWISE (the event breaks every prefix), THE matcher SHALL first fire the pattern that matches the **old** sequence exactly, if there is one, and SHALL then restart: the pending sequence becomes this event alone, if that one-sound sequence is a valid prefix of at least one sound pattern, and becomes empty if it is not. THE restart SHALL NOT look for a shorter suffix of the old sequence that would match (no backtracking).
5. WHEN a sound event arrives and the pending sequence is empty, THE matcher SHALL apply the restart step of 5.4 without firing anything first.
6. AFTER 5.3 or 5.4 or 5.5, IF the pending sequence is matched exactly by a pattern and no other pattern extends it, THEN THE matcher SHALL fire that pattern at once and empty the pending sequence. (Plan: immediate fire when no longer pattern extends it.)
7. IF a pattern matches exactly and another pattern extends the sequence, THEN THE matcher SHALL wait (Requirement 6). IF no pattern matches exactly but some pattern extends the sequence, THEN THE matcher SHALL also wait, and SHALL fire nothing if the wait ends without a further sound.
8. THE result of one `push` SHALL be an array in the order of firing: the match of the old sequence (5.4) first, then the immediate match of the new sequence (5.6). The array SHALL be empty when nothing fires. At most one match per sequence can occur (Requirement 3.5), so the array has at most two entries.
9. THE sequence SHALL be checked as a whole. A pattern is never matched from a middle position of the pending sequence.

### Requirement 6: Waiting and `advance`
**User story:** As the engine, I want a pending `click` to fire exactly when no later sound can extend it, without the grammar reading a clock.

#### Acceptance Criteria
1. THE method `advance(t)` SHALL tell the matcher that time has reached `t` seconds, meaning that no sound with an earlier `t` will arrive later. IT SHALL return the matches that fire because of this.
2. FOR a pending sequence of `n` sounds whose last sound has time `tLast`, EVERY pattern that extends it is a **candidate** and needs the next sound with a gap of the kind of its next sound. THE candidate is **alive** at time `t` when the elapsed time `e = (t - tLast)` in ms is still inside the range of that kind: for a `consecutive` next sound while `e < GAP_CONSECUTIVE_MAX_MS - GAP_TOLERANCE_MS`; for a `rest` next sound while `e <= GAP_REST_MAX_MS + GAP_TOLERANCE_MS`. (The plan states it as the largest gap a candidate needs: 350 ms if the next token is a sound, 1000 ms if it is a rest. At exactly 350 ms no consecutive sound can follow any more, so the matcher gives up at 350 ms and not after it. At exactly 1000 ms a rest gap is still valid, so the matcher waits until above 1000 ms.)
3. WHEN no candidate is alive, THE matcher SHALL fire the pattern that matches the pending sequence exactly, if there is one, and SHALL empty the pending sequence. THE matcher SHALL give up when the **last** candidate dies, so with candidates of both kinds it waits for the rest candidate (1000 ms).
4. WHEN a candidate is alive, THE `advance` call SHALL return nothing and change nothing.
5. THE call `advance(Infinity)` SHALL kill every candidate (flush). THE call on an empty pending sequence SHALL return an empty array.
6. THE value of `t` in `advance(t)` SHALL NOT go into `MatchEvent.t` (Requirement 7).
7. THE method `advance` SHALL be idempotent in effect: calling it twice with the same `t` gives the second time an empty array.
8. THE order of calls SHALL NOT change which matches occur or their `t`. A sequence that would have been broken by the next `push` (5.4) gives the same match whether `advance` fired it before or `push` fires it later, because a sequence that is not alive cannot be extended (property P5, Requirement 11.3).

### Requirement 7: Content of a match
**User story:** As an app author, I want the match time to be the time of my last sound, so that I know what was on screen when the sound happened (design 7.1).

#### Acceptance Criteria
1. FOR a sound pattern, `MatchEvent.t` SHALL be the `t` of the **last sound of the matched sequence**, whether the match fires immediately, at `advance`, or at a later breaking `push`.
2. FOR a hum pattern, `MatchEvent.t` SHALL be the `t` of the pitch `update` event that caused it.
3. `MatchEvent.pattern` SHALL be the pattern string as given (Requirement 3.2).
4. THE matcher SHALL NOT include the confidence, the duration or the labels in the match.

### Requirement 8: Which events reach the sequence logic
**User story:** As the engine author, I want the matcher to be safe even if I pass it more than I should.

#### Acceptance Criteria
1. A `SoundEvent` of kind `sound` with the label `background` SHALL be ignored completely: `push` returns an empty array, the pending sequence is unchanged and it is not broken, and the matcher's time does not move. (`BACKGROUND` from `core/constants.ts` is used; the engine already drops these events, the matcher only protects itself.)
2. A `SoundEvent` of kind `continuous` with `phase` `'start'` or `'end'` SHALL be ignored completely in the same way, whatever its `value`. A hum pattern fires only on `'update'` (Requirement 9.1).
3. A `continuous` `'update'` event SHALL go to the hum logic only (Requirement 9). IT SHALL NOT be added to, break, or fire the pending sound sequence, and a sound event SHALL NOT affect hum matching.
4. THE matcher SHALL keep `now`, the latest time it has seen: the largest of every `t` of an accepted sound event and every `t` given to `advance`. THE value `now` SHALL be used for nothing except that `advance(t)` with `t` below `now` behaves as `advance(now)`, so that time never goes back.
5. THE following SHALL throw a `RangeError`: a sound event or a continuous `update` whose `t` is not a finite number; a sound event whose `t` is below the `t` of the last sound in the pending sequence (events must arrive in time order); a continuous `update` whose `value` is not a finite number above 0; `advance(t)` with `t` that is `NaN`. (`Infinity` is valid for `advance` only.) The matcher SHALL be unchanged after a throw.
6. THE value `durationMs` and `confidence` of a sound event SHALL NOT be validated or used.
7. A sound event whose label is not in any pattern SHALL be treated as any other sound: it breaks a pending sequence (Requirement 5.4) and then is dropped by the restart step.

### Requirement 9: Hum patterns
**User story:** As a user who hums, I want a rising hum to scroll up and a falling hum to scroll down, faster the further I go from my comfortable pitch.

#### Acceptance Criteria
1. FOR every `continuous` event with `name: 'pitch'` and `phase: 'update'`, THE matcher SHALL compute `s = 12 x log2(value / baselineHz)`, the distance from the baseline in semitones (positive above). THE constant 12 SHALL be a file-local `SEMITONES_PER_OCTAVE`.
2. IF `s > HUM_DEADZONE_SEMITONES` (2) and a `hum.rise` pattern exists, THEN THE matcher SHALL return `{ pattern, t, speed }` for it with `speed = min(s - HUM_DEADZONE_SEMITONES, HUM_SPEED_MAX_SEMITONES)`. IF `s < -HUM_DEADZONE_SEMITONES` and a `hum.fall` pattern exists, THEN it SHALL do the same with `speed = min(-s - HUM_DEADZONE_SEMITONES, HUM_SPEED_MAX_SEMITONES)`. (`HUM_SPEED_MAX_SEMITONES` is 6, so `speed` is in the range above 0 and up to 6.)
3. IF `-HUM_DEADZONE_SEMITONES <= s <= HUM_DEADZONE_SEMITONES`, THEN nothing SHALL fire. THE comparison SHALL be strict (above 2, below -2) and SHALL use no tolerance. (A pitch exactly 2 semitones off cannot be produced from real input; tests stay clear of the edge.)
4. THE match SHALL fire on **every** update that is outside the dead zone, not once per excursion. (Plan: the handler is called on every pitch update.)
5. IF the direction has no hum pattern (only `hum.rise` is registered and the pitch falls), THEN nothing SHALL fire.
6. ONE update SHALL fire at most one match, because rise and fall exclude each other.
7. THE hum logic SHALL read the baseline given at construction. THE matcher SHALL NOT estimate or update it.
8. THE speed SHALL be a number of semitones, not a ratio and not Hz. THE name of the unit SHALL be in the code through the constant names (`..._SEMITONES`).

### Requirement 10: Modes
**User story:** As the author of the Knock Once app, I want a long pattern that is not active on this screen not to delay a short one (design 7.2).

#### Acceptance Criteria
1. WHEN `setPatterns` replaces `["knock", "knock knock _ knock"]` by `["knock"]`, THEN a single `knock` pushed afterwards SHALL fire immediately, because no longer pattern exists any more.
2. A sequence that was pending at the switch SHALL NOT fire, and SHALL NOT be completed by later sounds (Requirement 3.8).
3. THE method `setPatterns` SHALL NOT need a new matcher object; the engine holds one matcher for its lifetime.

### Requirement 11: Determinism and tolerance (P5)
**User story:** As a developer, I want the same sounds to give the same actions, and a small difference in my rhythm not to change them.

#### Acceptance Criteria
1. FOR any pattern set and any event sequence, TWO new matchers given the same calls in the same order SHALL return identical match arrays (same patterns, same `t`, same `speed` if any, same order). Property P5.
2. THE same SHALL hold when the matcher is reused through `setPatterns` with the same patterns: the result of the later run SHALL equal the first run.
3. THE result SHALL NOT depend on where `advance` calls are placed, provided each `advance(t)` has `t` not later than the `t` of the next event and a final `advance(Infinity)` is made at the end. (Requirement 6.8.)
4. FOR a sequence in which every gap is far enough from a boundary of the gap ranges, ADDING to each gap an independent jitter of at most 30 ms SHALL NOT change the list of matched pattern strings and their order. "Far enough" means at least 30 ms inside the range: consecutive gaps between 30 ms and 319 ms, rest gaps between 380 ms and 969 ms, and gaps that break every sequence of at least 1040 ms. The `t` of matches MAY differ by the sum of the jitters before them.
5. THE properties SHALL use `test.prop` of `@fast-check/vitest`, SHALL NOT set `numRuns` (the `PBT_RUNS` setup of `test/setup.ts` does), and SHALL end their test names with the requirement they cover.

### Requirement 12: Layer rule, constants, units and speed
**User story:** As a maintainer, I want `core/` to stay portable and every time value to carry its unit.

#### Acceptance Criteria
1. THE file `core/grammar.ts` SHALL NOT import `fs`, `path`, DOM or Web Audio APIs, SHALL import only `core/` modules, SHALL NOT call `Math.random`, SHALL NOT read the clock (`Date`, `performance`), and SHALL NOT call the network.
2. THE system SHALL use the existing constants `GAP_CONSECUTIVE_MAX_MS`, `GAP_REST_MAX_MS`, `HUM_DEADZONE_SEMITONES`, `HUM_SPEED_MAX_SEMITONES` and `BACKGROUND`. THIS task SHALL add `GAP_TOLERANCE_MS = 1e-6` to the Grammar section of `core/constants.ts` (comment: rounding allowance for `t = samples / sampleRate`). THE file SHALL NOT contain the literals 350, 1000, 2 or 6 as thresholds. File-local `MS_PER_SECOND` (1000) and `SEMITONES_PER_OCTAVE` (12) are conversion factors, as `core/synth.ts` has `MS_PER_SECOND`.
3. THE file SHALL NOT compute a time `t`. It receives `t` in seconds from the segmenter, the pitch tracker and the engine, which compute it as a cumulative sample count divided by the sample rate. THE grammar SHALL convert seconds to ms only to compare with the ms constants. THE file SHALL NOT contain a sample count or a sample rate.
4. THE tests SHALL build every event time as a cumulative sample count divided by a sample rate, with the sample count derived from a time in ms and the rate (no literal sample counts), so that the tests see the same rounding as the engine does.
5. THE method `push` and `advance` SHALL take time proportional to the number of patterns times the length of the longest pattern. FOR 50 patterns and 10 000 events, the whole run SHALL take under 500 ms (a loose bound that only catches a quadratic bug in the sequence).
