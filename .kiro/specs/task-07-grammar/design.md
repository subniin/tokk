# Design: Task 7, sound pattern grammar

## Layer rule
`core/grammar.ts` is pure TypeScript. No `fs`, `path`, DOM, or Web Audio. It imports only `core/types.ts` and `core/constants.ts`. No `Math.random`, no clock, no network. Time enters only as the `t` of events (seconds) and the argument of `advance`. The module converts seconds to ms with a file-local `MS_PER_SECOND` (1000) and uses the semitone factor as a file-local `SEMITONES_PER_OCTAVE` (12). Every threshold comes from `core/constants.ts`.

## Interfaces
```ts
// core/grammar.ts
export type PatternToken = { type: 'sound'; label: string } | { type: 'rest' }

export function parsePattern(src: string): PatternToken[]

export class Matcher {
  constructor(patterns: string[], baselineHz?: number)
  push(e: SoundEvent): MatchEvent[]
  advance(t: number): MatchEvent[]
  setPatterns(patterns: string[]): void
}
```
`SoundEvent` and `MatchEvent` are the types in `core/types.ts`. They do not change in this task. `Matcher` is not exported from `core/index.ts` (Task 8 decides the public API).

## Constants
Existing in the Grammar section of `core/constants.ts`: `GAP_CONSECUTIVE_MAX_MS` (350, exclusive), `GAP_REST_MAX_MS` (1000, inclusive), `HUM_DEADZONE_SEMITONES` (2), `HUM_SPEED_MAX_SEMITONES` (6). `BACKGROUND` is in the Classifier section.

**Added by this task:** `GAP_TOLERANCE_MS = 1e-6`. A time `t` is a cumulative sample count divided by the sample rate, so a gap built as exactly 350 ms can come out as 349.99999999999994 ms, and a plain comparison would put it on the wrong side of the border. One millionth of a millisecond is far below one sample at 96 kHz (about 0.0104 ms), so the tolerance cannot admit a gap that is a real sample different.

Test-only values live at the top of `test/grammar.test.ts`: `TEST_SAMPLE_RATE_HZ` (48000), `JITTER_MAX_MS` (30), the generator ranges of P5 (`CONSECUTIVE_NOMINAL_MS` 30 to 319, `REST_NOMINAL_MS` 380 to 969, `BREAK_NOMINAL_MS` 1040 to 3000), the baseline 220 Hz, `SPEED_TIME_BOUND_MS` (500) for the speed test, and the event and pattern counts of the properties.

## Internal data
- `steps` of a sound pattern: `{ label: string; gap: 'consecutive' | 'rest' | null }[]`. Built from the tokens: a sound after a `_` gets `rest`, a sound after another sound gets `consecutive`, the first sound gets `null`.
- `soundPatterns`: `{ src: string; steps }[]`, in the order given.
- `humPatterns`: `{ src: string; dir: 'rise' | 'fall' }[]`.
- `pending`: `{ label: string; t: number }[]`, empty at the start.
- `now`: number, starts at `-Infinity`.
- `baselineHz`: number or undefined.

Nothing else is stored. There is no timer and no queue of deadlines: the deadline of the pending sequence is computed on demand from `pending` and the patterns.

## Helper definitions
```
gapMs(a, b)        = (b.t - a.t) x MS_PER_SECOND

gapOk(kind, g)     = kind == 'consecutive' : g < GAP_CONSECUTIVE_MAX_MS - TOL
                     kind == 'rest'        : GAP_CONSECUTIVE_MAX_MS - TOL <= g <= GAP_REST_MAX_MS + TOL

validPrefix(seq, P) = seq.length <= P.steps.length
                      and for all i: seq[i].label == P.steps[i].label
                      and for all i >= 1: gapOk(P.steps[i].gap, gapMs(seq[i-1], seq[i]))

exact(seq)         = the pattern P with validPrefix(seq, P) and P.steps.length == seq.length   (at most one)
candidates(seq)    = { P : validPrefix(seq, P) and P.steps.length > seq.length }

alive(P, seq, t)   = let e = (t - last(seq).t) x MS_PER_SECOND, kind = P.steps[seq.length].gap
                     kind == 'consecutive' : e < GAP_CONSECUTIVE_MAX_MS - TOL
                     kind == 'rest'        : e <= GAP_REST_MAX_MS + TOL
```
`TOL` is `GAP_TOLERANCE_MS`. `alive` has the same bound as `gapOk`, because a candidate is alive exactly as long as the next sound could still arrive with an acceptable gap. That is the plan's "largest gap a candidate needs": 350 for a sound, 1000 for a rest.

**At exactly 350 ms.** The plan says the pending sound is given up when the time "exceeds" the largest gap. For a consecutive next sound the gap range is open at 350, so a sound at exactly 350 ms is a rest gap and cannot extend a consecutive candidate. Waiting until 350.001 ms would give no benefit and would make `click` late by more than the documented 350 ms. The matcher therefore gives up at 350 ms. For a rest candidate the range is closed at 1000, so the matcher waits until the time is above 1000 ms. Test 2 and test 9 pin both edges.

## State machine
The matcher has two states. The state is just whether `pending` is empty.

| State | Meaning |
|---|---|
| `IDLE` | `pending` is empty |
| `WAIT` | `pending` has one or more sounds, is a valid prefix of at least one pattern, and (after settling) is not fired yet, because some pattern extends it, or because no pattern matches it exactly yet |

| # | State | Input | Condition | Actions | Next state | Output |
|---|---|---|---|---|---|---|
| 1 | any | `push` sound `background` | | none | same | `[]` |
| 2 | any | `push` continuous `start` or `end` | | none | same | `[]` |
| 3 | any | `push` continuous `update` | a matching hum pattern outside the dead zone | none (the sound state is untouched) | same | `[hum match]` |
| 4 | any | `push` continuous `update` | otherwise | none | same | `[]` |
| 5 | `IDLE` | `push` sound S | `[S]` is a valid prefix of some pattern | `pending = [S]`, then SETTLE | `IDLE` if SETTLE fired, else `WAIT` | SETTLE output |
| 6 | `IDLE` | `push` sound S | otherwise | none (S is dropped) | `IDLE` | `[]` |
| 7 | `WAIT` | `push` sound S | `pending + [S]` is a valid prefix of some pattern | `pending = pending + [S]`, then SETTLE | `IDLE` if SETTLE fired, else `WAIT` | SETTLE output |
| 8 | `WAIT` | `push` sound S | otherwise | FIRE(pending), `pending = []`, then apply row 5 or 6 to S | per row 5 or 6 | FIRE output, then row 5 or 6 output |
| 9 | `WAIT` | `advance(t)` | some candidate of `pending` is alive at `max(t, now)` | none | `WAIT` | `[]` |
| 10 | `WAIT` | `advance(t)` | no candidate is alive at `max(t, now)` | FIRE(pending), `pending = []` | `IDLE` | FIRE output |
| 11 | `IDLE` | `advance(t)` | | none | `IDLE` | `[]` |
| 12 | any | `setPatterns(p)` | valid | replace patterns, `pending = []` | `IDLE` | none |
| 13 | any | any call | invalid input (Requirement 8.5), invalid patterns (3.7) | none | same | throws `RangeError` |

```
FIRE(seq)   = the match { pattern: exact(seq).src, t: last(seq).t } if exact(seq) exists, else nothing
SETTLE      = if exact(pending) exists and candidates(pending) is empty:
                  output FIRE(pending); pending = []          // immediate fire, plan rule
              else: output nothing                             // wait; WAIT row 9 or 10 decides later
```
Rows 5 and 7 can end in `WAIT` with no exact match at all (the pattern is longer, such as `"a b c"` after `a`). Rows 9 and 10 then give up silently at the deadline (`FIRE` has nothing to fire).

`now` is updated on rows 5 to 8 (`now = max(now, S.t)`) and on `advance` (`now = max(now, t)`). It is never used except to clamp `advance`. `t` of a match never comes from `now`.

### Pseudocode
```
push(e):
  if e is sound:
    if e.label == BACKGROUND: return []
    check e.t finite; if pending nonempty, check e.t >= last(pending).t       // else RangeError
    now = max(now, e.t)
    out = []
    seq = pending + [e]
    if pending nonempty and anyValidPrefix(seq):
      pending = seq
    else:
      if pending nonempty: out += FIRE(pending)
      pending = anyValidPrefix([e]) ? [e] : []
    if pending nonempty: out += SETTLE()
    return out
  if e is continuous:
    if e.phase != 'update': return []
    check e.t finite and e.value finite and e.value > 0
    s = SEMITONES_PER_OCTAVE x log2(e.value / baselineHz)
    if s >  DEAD and hasHum('rise'): return [{ pattern, t: e.t, speed: min(s - DEAD, MAX) }]
    if s < -DEAD and hasHum('fall'): return [{ pattern, t: e.t, speed: min(-s - DEAD, MAX) }]
    return []

advance(t):
  check t is not NaN
  now = max(now, t)
  if pending empty: return []
  if some P in candidates(pending) has alive(P, pending, now): return []
  out = FIRE(pending); pending = []; return out
```
The checks run before any change, so a thrown error leaves the state as it was. The result of `push` has at most two matches (the old sequence, then the immediate fire of the new one). `FIRE` of the old sequence uses `exact`, which looks at the old sequence only.

### Worked traces
Times are in ms from the first event. `knock` is written `k`.

**A. Patterns `["k", "k k"]`.**

| Call | State after | Output |
|---|---|---|
| `push k @0` | `WAIT [k]` (`k k` extends it) | `[]` |
| `advance 349` | `WAIT` (candidate `k k` needs a gap below 350) | `[]` |
| `advance 350` | `IDLE` | `[{ pattern: 'k', t: 0 }]` |

Two knocks: `push k @0`, `push k @200` gives `pending = [k, k]`, which matches `k k` exactly with nothing longer, so SETTLE fires `[{ pattern: 'k k', t: 0.2 }]` at once and `k` never fires.

**B. Patterns `["k k _ k"]`, gaps 200, 600.** `k @0` WAIT; `k @200` gap 200 is consecutive: ok, WAIT; `k @800` gap 600 is rest: ok, exact and nothing longer, fires `{ pattern: 'k k _ k', t: 0.8 }`. With the last gap 1200: `validPrefix` fails (1200 is above 1000), row 8: no exact pattern for `[k, k]`, so FIRE gives nothing. The new `k` becomes `pending = [k]`, which is a valid prefix, WAIT. `advance(Infinity)` gives it up with no output.

**C. Patterns `["k", "k k"]`, a clap 200 ms after a knock** (plan test). `k @0` WAIT. `clap @200`: `[k, clap]` is a valid prefix of nothing, row 8: FIRE gives `{ pattern: 'k', t: 0 }`. `[clap]` is a prefix of nothing, so `pending = []`. Output `[{ k, t: 0 }]`. If a pattern `clap` also exists, `[clap]` is exact with nothing longer and SETTLE fires it: output `[{ k, t: 0 }, { clap, t: 0.2 }]`.

**D. Patterns `["a", "a b", "a _ c"]`.** After `a @0`, candidates are `a b` (consecutive next) and `a _ c` (rest next). `advance 400`: `a b` is dead, `a _ c` is alive, no output. `advance 1000`: still alive. `advance 1001`: no candidate alive, FIRE `{ a, t: 0 }`.

**E. No backtracking.** Patterns `["a a b"]`, events `a @0`, `a @100`, `a @200`, `b @300`. After two a's `[a, a]` is a valid prefix. The third `a` makes `[a, a, a]` invalid, no exact match for `[a, a]`, restart with `[a]`. Then `b` gives `[a, b]`, invalid, restart `[b]`, nothing. No match, as stated in Requirement 5.4. (A matcher that looked for a suffix would have found `a a b` at 100.)

## Why a sequence is checked from the start
Patterns are short (two to five sounds), and sequences restart on every break. A full prefix check of every pattern on every event is `O(patterns x length)`, which is cheap and has no hidden state. A trie or an automaton would give the same result with more code; the plan asks for neither.

## Advance and the engine
The engine calls `advance(min(now, openSegmentStart ?? now))` after each chunk. The open segment's sound is not classified yet, so time flows only up to its start. Sounds arrive with `t` equal to the segment start, never earlier than an earlier `advance` bound (the segment was open when that bound was set). The matcher accepts a sound whose `t` is below `now` (the engine can hand it a sound whose time is equal to the bound it set earlier), and `now` never moves back. It throws only when a sound is earlier than the previous sound of the pending sequence.

## Review notes, decisions where the plan is silent
| Question | Decision | Reason |
|---|---|---|
| Error type | `RangeError` | Bad input of this kind is a `RangeError` in Tasks 5 and 8 |
| Duplicate patterns | constructor throws | Two bindings on one sequence is a mistake. Also needed so that at most one pattern matches a sequence, which keeps `push` output small and clear |
| `hum.*` token that is not rise or fall | `parsePattern` throws | A typo such as `hum.up` would never fire |
| A label `background` in a pattern | not rejected | The grammar does not know the reserved name list. Task 8 and the teaching step own it |
| A sound label not in any pattern | breaks the pending sequence | Required by the plan test: a clap 200 ms after a knock fires `knock` |
| Hum update with value 0 or negative | `RangeError` | `log2` is undefined. The tracker never produces it, so this is a guard at the boundary |
| Events with decreasing `t` | `RangeError` only against the pending sequence | An out-of-order sound would give a negative gap. After a sequence is fired, an earlier-time sound is not detectable without more state and is not worth it (YAGNI) |
| Match `t` for a hum update | the `t` of the update | Matches the sound rule: the time of the event that caused it |

## Layout of the test file
`test/grammar.test.ts` uses `vitest` for example tests and `test.prop` from `@fast-check/vitest` for P5. It does not set `numRuns`; `test/setup.ts` reads `PBT_RUNS`. Each test name ends with `(Req N.M)`.

### Helpers (in the test file)
- `eventTimeS(cumulativeMs)`: `samples = cumulativeMs x (TEST_SAMPLE_RATE_HZ / MS_PER_SECOND)`, `t = samples / TEST_SAMPLE_RATE_HZ`. At 48000 Hz one ms is 48 samples, so integer ms give integer samples. This gives the same rounding as the engine and lets the boundary tests use exact 350 and 1000 ms.
- `sound(label, cumulativeMs, durationMs = 50)`: a `SoundEvent` `{ kind: 'sound', label, t, durationMs, confidence: 1 }`.
- `pitch(phase, cumulativeMs, valueHz)`: a continuous event.
- `hzAbove(baselineHz, semitones)`: `baselineHz x 2^(semitones / SEMITONES_PER_OCTAVE)`.
- `run(matcher, events)`: calls `push` for each event in order and returns all matches, then `advance(Infinity)`.

### Example tests

| # | Name | Requirement |
|---|---|---|
| 1 | `"knock"` fires immediately when no longer pattern starts with knock, with `t` of the knock | 5.6, 7.1 |
| 2 | with `"knock"` and `"knock knock"`, one knock fires `"knock"` at advance 350 ms and not at 349 ms; two knocks 200 ms apart fire only `"knock knock"` | 5.6, 6.2, 6.3 |
| 3 | `"knock knock _ knock"` matches gaps 200 ms and 600 ms, with `t` of the third knock | 4.2, 5.2, 7.1 |
| 4 | `"knock knock _ knock"` does not match gaps 200 ms and 1200 ms (no output at all, also after flush) | 4.2, 5.4 |
| 5 | `parsePattern` returns the tokens for `"knock"`, `"knock _ knock"`, `"  knock \t knock "` and `"hum.rise"`; label case is kept | 2.1, 2.5 |
| 6 | `parsePattern` rejects `""`, `"   "`, `"_"`, `"_ knock"`, `"knock _"`, `"knock _ _ knock"`, `"hum.rise knock"`, `"knock hum.fall"`, `"hum.rise hum.fall"`, `"hum.rise _"`, `"hum.up"`; the error is a `RangeError` and its message contains the pattern in quotes. `"hum"` and `"humming"` parse as sounds | 2.2 to 2.4 |
| 7 | consecutive and rest boundaries with sample-derived times: for `"a a"` a gap of 349 ms matches and 350 ms does not; for `"a _ a"` 349 ms does not match, 350 ms and 1000 ms match, 1001 ms does not | 4.2, 4.4 |
| 8 | the gap runs from the previous sound's `t`, not its end: with `durationMs` 400 and a gap of 300 ms, `"a a"` matches | 4.3 |
| 9 | waiting time depends on the next token: `"a"` with `"a b"` fires at 350 ms; `"a"` with `"a _ b"` waits at 400 ms and 1000 ms and fires above 1000 ms; with `"a b"` and `"a _ c"` together it waits for the longer deadline; a lone `"a _ b"` gives up silently | 6.2, 6.3 |
| 10 | with `"knock"` and `"knock knock"`, a clap 200 ms after a knock still fires `"knock"` before restarting; when `"clap"` is also a pattern, the output is `["knock", "clap"]` in this order | 5.4, 5.8 |
| 11 | a break fires the exact pattern of the sequence: patterns `"a"`, `"a a"`, `"a a a"`, events a, a, then b: output `"a a"` with `t` of the second a | 5.4, 7.1 |
| 12 | no backtracking: pattern `"a a b"`, events a, a, a, b give no match | 5.4 |
| 13 | match `t` is the last sound's `t`, not the time of `advance`, in the three ways it can fire (immediate, advance, breaking push) | 7.1 |
| 14 | duplicate patterns (`"a b"` and `"a  b"`) throw in the constructor and in `setPatterns`, with both strings in the message | 3.5 |
| 15 | an empty pattern list is valid and never matches | 3.6 |
| 16 | `setPatterns` drops the pending sequence without firing and uses the new patterns; a pending `a` from the old set cannot complete `"a a"` of the new set | 3.8, 10.2 |
| 17 | `setPatterns` with an invalid pattern throws and the old patterns and pending sequence still work | 3.7 |
| 18 | after `setPatterns(["knock"])` a single knock fires at once (no wait for a longer pattern) | 10.1 |
| 19 | a `background` sound is ignored: it does not break a pending sequence (`a`, background, `a` still matches `"a a"`) and returns `[]` | 8.1 |
| 20 | continuous `start` and `end` events are ignored: a pending sequence survives them, and no hum pattern fires on them even when the value is 12 semitones off | 8.2, 9.1 |
| 21 | hum updates do not touch the sound sequence and sounds do not affect hum: updates between two knocks leave `"knock knock"` matching | 8.3 |
| 22 | `hum.rise` fires on an update 4 semitones above the baseline with speed 2 (close to 2) and `t` of the update | 9.1, 9.2, 7.2 |
| 23 | an update 1.5 semitones above the baseline fires nothing, and so does 1.5 below; 2.01 above fires with a tiny positive speed | 9.3 |
| 24 | `hum.fall` fires 5 semitones below the baseline with speed 3 | 9.2 |
| 25 | speed is capped: 20 semitones above gives speed 6, 20 below gives speed 6, 7.5 above gives 5.5, 8.5 above gives 6 | 9.2 |
| 26 | a hum pattern fires on every update outside the dead zone (three updates, three matches, their own `t`) | 9.4 |
| 27 | only the registered direction fires: with only `hum.rise`, a falling update gives nothing; with both, one update gives one match | 9.5, 9.6 |
| 28 | the constructor throws a `RangeError` naming `baselineHz` when a hum pattern exists and no baseline is given; no error without a hum pattern and without a baseline; a baseline of 0, -5, NaN or Infinity throws; `setPatterns` with a hum pattern on a matcher built without a baseline throws | 3.3, 3.4, 3.7 |
| 29 | invalid input throws `RangeError` and leaves the state: sound with `t` NaN, a sound earlier than the pending sound, an update with value 0 or NaN, `advance(NaN)` | 8.5 |
| 30 | `advance` never moves time back: `advance(10)` then `advance(5)` behaves as `advance(10)`; a repeated `advance` returns `[]`; `advance(Infinity)` on an empty sequence returns `[]` | 6.5, 6.7, 8.4 |
| 31 | a sound with a label that is in no pattern breaks the pending sequence and is dropped | 8.7 |
| 32 | the matcher holds `pattern` strings as given: `"knock  knock"` (two spaces) is reported with two spaces; a sound match has no `speed` key (`'speed' in m` is false) | 3.2, 1.4 |
| 33 | 50 patterns and 10 000 events run in under 500 ms | 12.5 |
| 34 | the source of `core/grammar.ts` has no forbidden import, `Math.random`, `fetch`, `Date` or `performance`, and no literal `350`, `1000` outside the file-local `MS_PER_SECOND` line | 12.1, 12.2 |
| 35 | `GAP_TOLERANCE_MS` is exported by `core/constants.ts` and is below 0.001 | 12.2 |

### Property tests

| Property | Name (ends with) | Generates | Asserts |
|---|---|---|---|
| P5a | `P5 identical event sequences give identical matches (Req 11.1, 11.2)` | 1 to 4 distinct sound patterns over labels `a`, `b`, `c` (length 1 to 4, optional single rests inside), 0 to 30 events with gaps from any of the three classes (consecutive, rest, break), arbitrary labels | Two new matchers, and one matcher reused through `setPatterns`, return deep-equal match lists |
| P5b | `P5 jitter of 30 ms inside ranges does not change matches (Req 11.4)` | Same patterns, nominal gaps from the classes of Requirement 11.4, an independent jitter of -30 to +30 ms (integer) per gap, events rebuilt by cumulative sum | The list of `pattern` strings is the same for the nominal and the jittered sequence. The `t` of each match differs by at most the jitter sum |
| P5c | `P5 the placement of advance calls does not change matches (Req 11.3, 6.8)` | Same input as P5a, plus a random subset of the gaps where an `advance` at a random time inside the gap is inserted | Equal match lists, with and without the extra `advance` calls (a final `advance(Infinity)` in both) |

Generator details. A pattern is generated as a list of 1 to 4 labels with a boolean per gap (rest or not), turned into a string. Patterns with equal tokens are removed before use (the constructor rejects duplicates). P5b uses gap classes that keep 30 ms clear of every border: consecutive nominal 30 to 319 ms (jittered 0 to 349), rest nominal 380 to 969 ms (jittered 350 to 999), break nominal 1040 to 3000 ms (jittered at least 1010). In P5b the first event's time is fixed. Times are built through `eventTimeS`, so the jittered sequence has the rounding of real input.

P5b is the only test where a failure would point at the range borders. A counterexample is written into this file (Measured values) and fixes go into the rule, not into the generator ranges (the plan's 30 ms is the figure to meet).

### Runtime target
The whole `test/grammar.test.ts` runs in **under 5 s** at `PBT_RUNS=100` (the default) and in under 3 s at `PBT_RUNS=20` (the default of `pbt:quick`). No audio is processed; the cost is the 10 000 event test and the properties. Property tests get a timeout that grows with `PBT_RUNS`, as in `test/segment.test.ts`.

## Measured values
`test/grammar.test.ts` runs in 0.28 s at `PBT_RUNS=20`, 0.29 s at `PBT_RUNS=100` and 0.39 s at `PBT_RUNS=1000` (vitest wall time including startup). `npm run pbt:quick` (segment, knn and grammar files) takes 14.1 s. P5a, P5b and P5c found no counterexample.

## Behaviour that follows from the rules
- `click` with `click click` in the same mode always fires 350 ms late, and `click` with `click _ click` up to 1000 ms late (when it is the longest wait). That is the cost of a prefix and is why modes exist.
- A pattern of one sound (`knock`) with no longer pattern in the mode is the only case with no delay.
- The engine's `advance` bound at the open segment's start keeps the matcher from firing a pending `click` while the second click is still being segmented.
- Hum matches carry a `speed`; sound matches do not.
