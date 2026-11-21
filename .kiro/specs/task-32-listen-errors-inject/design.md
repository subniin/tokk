# Design: Task 32, onError, inject and keys mode

## Layout
```
core/engine.ts                    Engine.inject                                  [changed]
web/protocol.ts                   message { type: 'inject' }, handled in handle()  [changed]
web/errors.ts                     TokkError, makeTokkError, keys-mode message      [new]
web/listen.ts                     onError watch, keys clock, Ears.inject           [changed]
web/constants.ts                  WEB_KEYS_SAMPLE_RATE_HZ, WEB_KEYS_MAX_CATCHUP_MS [changed]
web/index.ts                      export type { TokkError }                        [changed]
test/engine-inject.test.ts        engine tests                                     [new]
test/listen-errors.test.ts        fake Worker and fake track                       [new]
test/web/listen.spec.ts, .html    two browser tests, `onerror` page parameter      [changed]
test/web-unit/public-api-types.ts compile-time checks                              [changed]
tsconfig.json, tsconfig.test-web.json  the listen unit test needs DOM types        [changed]
```

## Behavior
- `Engine.inject` builds the event with `now()` (cumulative samples / sample rate), sends it through `feed` (so `onEvent` and the matcher see it), dispatches the matches to the handlers and returns them. A pattern that a longer one could extend is not returned; it fires from `push()` once the gap is over, as for the microphone.
- The Worker handles `inject` like `chunk`: it needs an engine, and it is dropped while a recording is open.
- `listen()` ends an Ears through `fail(kind)`: set `closed`, abort a teach dialog, start the teardown, then call `onError` in `try/catch`. It runs only when `onError` was given, so existing calls are unchanged. Listeners (`ended` on the audio tracks, `statechange` on the context, `pointerdown` and `keydown` on `document`) are added only then, and removed in the teardown.
- Keys mode: `fetchWav` and `openMic` are skipped, the Worker is created. The engine rate is the rate of the stored or given model, else `WEB_KEYS_SAMPLE_RATE_HZ` (16000 Hz, the lowest allowed rate). `createKeysClock` sends `msToSamples(20 ms)` samples of silence per due chunk, paced by `performance.now()` like the WAV pacer. A late timer sends the missed chunks, at most `WEB_KEYS_MAX_CATCHUP_MS` (5000 ms), then the clock restarts from there, so a sleeping page does not flood the Worker. `pause()` and `resume()` stop and restart the clock.
- `TokkError` messages: `mic-ended` "The microphone stopped: ... Reconnect the microphone, then call listen() again."; `worker` "The sound engine failed (<text>). Call listen() again. If it fails again, reload the page."; `audio-closed` "The audio context was closed by the browser. Call listen() again from a click or a key press."

## Known limit
`inject` uses the engine time of the last chunk. A microphone segment is reported when it ends, with its start time `t`. If an inject lands while a microphone segment is still open, the matcher gets the inject first and rejects the older segment with a `RangeError` (the Worker logs it). Apps that mix both inputs should not inject while a sound is sounding.

## Tests
- `engine-inject`: one inject with `['knock', 'knock knock']` fires `knock` once after about 400 ms; inject, 600 ms, inject with `['knock _ knock']` fires once; a synthetic microphone knock plus one inject make `knock knock`; `''` and `'background'` throw `RangeError`; the return value and `onEvent`.
- `listen-errors`: track `ended` gives one `mic-ended` and no later handler; Worker `onerror` gives `worker`; context `closed` gives `audio-closed`; `suspended` is no error and `resume()` runs on the next gesture; an exception in `onError` is logged; without `onError` nothing changes; keys mode never touches `getUserMedia`, two injects fire `knock knock`, `teach()` rejects; inject while paused does nothing; the protocol message.
- `listen.spec`: stopping the fake microphone track calls `onError`; `source: 'keys'` plus inject calls the handler.
