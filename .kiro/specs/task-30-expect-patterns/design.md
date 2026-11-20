# Design: Task 30, patterns in expectEvents

## Layout
```
node/expect.ts                     options, matches check, error fields   [changed]
test/expect-patterns.test.ts       tests X1 to X6                         [new]
test/slides-events.test.ts         passes patterns and matches            [changed]
integrate.md, SKILL.md, integrator.json, README.md   wording, one example [changed]
docs/kiro.md, docs/devlog.md       one row, one line                      [changed]
```

## Behavior
- `runSamples(samples, sampleRate, sounds, patterns)` already runs the engine with a pattern set and returns `matches`. `expectEvents` passes `patterns ?? unique(matches) ?? []`. `core/` does not change.
- An invalid or duplicate pattern makes `createEngine` throw the grammar's `RangeError`. `expectEvents` builds the engine before it compares anything, so the rejection comes first.
- `actualMatches` is the `pattern` of each `MatchEvent`, in order.
- Message: the sound part `Expected events [..] but got [..].` appears when the sound lists differ. The match part `Expected matches [..] but got [..].` appears when `matches` was given and differs. The unknown part `N unknown at T s.` is added when there are unknowns. `expected` and `actual` stay the sound lists.
- Without `matches` the error and the message are as before.

## Tests (`test/expect-patterns.test.ts`)
- X1: two claps with `['clap clap', 'clap clap clap']` give `['clap clap']`; three claps give `['clap clap clap']` and never `clap clap`.
- X2: a wrong `matches` rejects with `ExpectEventsError`; the message names both match lists; `expectedMatches` and `actualMatches` are set.
- X3: `matches` without `patterns` uses the deduplicated `matches` as the set.
- X4: an invalid pattern rejects with `RangeError`.
- X5: old calls resolve and fail as before; the fields are `undefined`.
- X6: a sound-name failure with `matches` names both pairs of lists.
