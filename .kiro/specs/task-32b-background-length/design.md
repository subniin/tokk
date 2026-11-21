# Design: Task 32b, background recording of a set length

## Layout
```
web/listen.ts                       TeachOptions.backgroundMs, range check, passed to the dialog   [changed]
web/teach-ui/state.ts               TeachState.fixedMs, countdownSeconds, doneState/done use it    [changed]
web/teach-ui/teach-dialog.ts        countdown line, Done hidden, auto finish on record-progress    [changed]
test/teach-state.test.ts            state tests                                                    [changed]
test/teach-background-ms.test.ts    RangeError test with the fake Worker and microphone            [new]
test/web/teach.spec.ts              one browser test, range check in the bad-arguments test        [changed]
test/web-unit/public-api-types.ts   compile-time check of the new option                           [changed]
tsconfig.json, tsconfig.test-web.json  the new unit test imports listen, so it needs DOM types      [changed]
```

## Behavior
- `teach()` checks `backgroundMs` only for the label `background`, after the `examples` check. The range uses the two existing constants, so no new number appears.
- `initialState({ label, target, backgroundMs })` sets `fixedMs` to `backgroundMs` for the background kind, else `null`. "Record again" keeps it.
- With `fixedMs`, `doneState` and the `done` action become enabled only when `elapsedMs >= fixedMs`, in place of the 10 s minimum. `countdownSeconds(s)` is `ceil((fixedMs - elapsedMs) / 1000)`, at least 0, or `null` without `fixedMs`.
- The dialog adds a `data-role="countdown"` line (`N seconds left`, no live region) and sets `hidden` on the Done button. After each `record-progress`, when `doneState` is enabled it runs the same path as a Done press. The progress bar uses `fixedMs` as its length.
- The clock is the recorder `t` of `record-progress`, so the browser test and the state test need no page timer.

## Tests
The browser test uses `backgroundMs` 10000 (the shortest allowed) with the fake microphone, and waits for the review screen without pressing Done.
