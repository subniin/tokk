# Requirements: Task 20, template additions for the apps

## Introduction
Task 20 is the first task of plan 3 (two apps). The apps (Task 22 Hands-Free, Task 23 Knock Once for Yes) import only the public API `tokk`. Several things they need are missing from the template, and the plan says to add them to the template as general features, not to work around them inside an app. This task adds, in one change:

1. Starting `listen()` without a sound model, and teaching the first label into an empty model.
2. `hum.*` patterns that wait quietly until a hum is taught, instead of throwing.
3. `listen({ onEvent, onEnvelope })`.
4. `ears.toPageTime(t)`, which maps a sound time in seconds to a `performance.now()` time in ms.
5. `ears.labels`, so an app can tell a first run.
6. `TeachOptions.text` (text overrides) and theming of the teach dialog with CSS custom properties.

Existing behaviour does not change, except where this document names the change (requirement 11.1).

Task 16 and Task 19 left these files and facts that this task builds on: `web/listen.ts` (`listen`, `Ears`, `route`, `adopt`, `teach`, `importSounds`, the stored-model rule with the `base` fingerprint), `web/protocol.ts` (the message unions, `buildEngine`, the `event`, `segment` and `envelope` messages, `replaceSounds`, `record-end`, `record-cancel`), `web/recorder.ts`, `web/teach-ui/` (`state.ts`, `format.ts`, `storage.ts`, `teach-dialog.ts`), `web/overlay/`, `web/model.ts` (`checkModel`), `core/grammar.ts`, `core/engine.ts`, `core/teach.ts` (`retrainLabel`), `core/classify/knn.ts` (`trainVectors`), `test/public-api.test.ts`, `.kiro/steering/integrate.md` and `powers/tokk/skills/integrate/SKILL.md`.

| Consumer | What it uses from this task |
|---|---|
| Task 21 (app build, site) | Nothing new. It builds on the public API as it is after this task. |
| Task 22 (Hands-Free) | Start without sounds, `ears.labels` (first run), teach of `click`, `hum` and `background`, inert `hum.*` before the hum is taught, `toPageTime` (which element was highlighted when the sound was made), `onEvent` (text of what was heard), `onEnvelope` (waveform in the page) |
| Task 23 (Knock Once for Yes) | `ears.teach('knock', { text })` with the `--tokk-*` theme, `onEnvelope` (the waveform as ectoplasm), `toPageTime` after `pause()` and `resume()` (sound effects pause the microphone), start without sounds |
| `integrate.md`, the power's integrate skill | The new public names (requirement 10) |

Facts checked before this spec was written (step 1 of the tasks checks them again):
- `listen()` takes `sounds` as a required field. `createEngine` builds a `Matcher` for each mode and, for a model without `pitch.baselineHz`, `compile()` in `core/grammar.ts` throws a `RangeError` for any `hum.rise` or `hum.fall` pattern. `listen()` runs a throwaway engine at `SAMPLE_RATE_MIN_HZ` (16000 Hz) before it opens anything, and again for a stored model and for `importSounds`, so today a first-run app with a hum pattern cannot start.
- `Matcher.pushContinuous` already returns no match when `baselineHz` is undefined. The `Matcher` takes the baseline once, at construction. The Worker builds a new engine (and so a new `Matcher`) on `init`, `replaceSounds`, `record-end` and `record-cancel`, so a baseline that appears in a new model reaches the grammar through the rebuild without a new method.
- `classifyVector` in `core/classify/knn.ts` reads `ranked[0]` and checks the vector length against `model.mean.length`. With a model that has no examples it throws a `TypeError` (or a `RangeError` for the vector length). `trainVectors` throws `TooFewExamplesError` for an empty list of examples. `retrainLabel` calls `trainVectors` with the old and the new vectors of the whole model, also for the label `hum`, so a first `hum` on a model without examples ends in `TooFewExamplesError`.
- `checkModel` in `web/model.ts` accepts a model whose `mean`, `std` and `examples` are empty arrays (it checks the shape and `version` only).
- The Worker already sends one `event` message per `EngineEvent` (a `sound`, a `continuous` pitch event, or an `unknown` with `nearest`), one `segment` message per classified segment (with `nearest`, also for `background`) and one `envelope` message per chunk that completes bins (`t0`, `min`, `max`, bins of `WEB_ENVELOPE_RESOLUTION_MS`, 10 ms). `route` in `listen.ts` ignores `event`; `segment` and `envelope` go to the overlay only. A `sound` event has no `nearest`, and a `background` segment gives no event.
- In the Worker, `record-end` and `record-cancel` restart the envelope counters together with the new engine. `replaceSounds` restarts the engine clock but not the envelope counters (a Task 14 test, `test/protocol.test.ts`, "replaceSounds", states this). So after `importSounds` the envelope time axis and the engine time axis differ.
- The microphone is paused in the AudioWorklet (`pause` message): the worklet stops sending chunks, so the engine's clock stops while `performance.now()` runs on. In `process`, chunk samples go straight to the Worker through a `MessageChannel`, so the page does not see a chunk. The page sees the Worker's messages, which arrive in order.
- The teach dialog's style is one string in `teach-dialog.ts` built from `OVERLAY_COLOURS` and the `WEB_TEACH_*` constants, with `all: initial` on the host. `all` does not reset CSS custom properties, so a custom property set on the page inherits into the Shadow DOM.
- The `Ears.sounds` property and `exportSounds()` return the current model. `loadStoredModel` compares the stored `base` with the fingerprint of the model passed to `listen()`.

## Requirements

### Requirement 1: Start without sounds
**User story:** As an app developer, I want `listen()` to start with no sound model, so that an app whose users teach every sound on the first run needs no shipped `sounds.json`.

#### Acceptance Criteria
1. `ListenOptions.sounds` SHALL become optional. WHEN it is omitted, `listen()` SHALL start with an empty model: version `MODEL_VERSION`, `k` `KNN_K`, no examples, empty `mean` and `std`, no thresholds, no `pitch`, and `sampleRate` equal to the sample rate of the microphone (or of the WAV given as `source`). This task SHALL NOT add a runtime export name (design.md, "Why an optional `sounds`").
2. THE empty model SHALL be made by a helper `emptyModel(sampleRate)` in `core/classify/knn.ts`. It SHALL NOT be exported from `core/index.ts` or `web/index.ts`. THE model it returns SHALL be accepted by `checkModel` and SHALL survive `JSON.stringify` and `JSON.parse` unchanged.
3. THE rest of the start sequence SHALL work with the empty model as with any model: the throwaway-engine check of the handlers (at `SAMPLE_RATE_MIN_HZ` and at the WAV rate) SHALL use an empty model of that rate, the `init` message SHALL carry the empty model with the real rate, `ears.sounds` SHALL return it, `exportSounds()` SHALL return its JSON text, and the debug overlay SHALL mount with it. The overlay SHALL show no sample-rate warning for it, because the model rate equals the input rate.
4. WHILE the model has no examples (an empty model, or a model that has only the `pitch` of a taught hum), THE engine SHALL NOT classify segments: it SHALL call neither `onSegment` nor `onEvent` with an `unknown`, and no sound pattern SHALL match. The pitch tracker SHALL keep running and SHALL keep sending its `continuous` events. No error SHALL be thrown or logged. The change is in `core/engine.ts`.
5. WHEN `sounds` is given, THE behaviour SHALL be exactly the behaviour before this task, including a given model that has no examples.
6. THE doc comment of `listen()` SHALL say that omitting `sounds` starts with an empty model, that no sound pattern matches until a label is taught, and that the first teach decides nothing about the sample rate (the rate is the input's).

### Requirement 2: Teaching the first label into an empty model
**User story:** As an end user, I want to teach the first sound of an app that knows none, and have it recognised right after.

#### Acceptance Criteria
1. `retrainLabel(model, label, recs, options)` SHALL accept a model with no examples for every label. FOR a label other than `hum`, THE result SHALL be a trained model with the examples of `label` only (and the existing minimum `MIN_EXAMPLES_PER_LABEL`, with `TooFewExamplesError` as before), the `sampleRate` of the given model, and a report with one label. FOR `background`, THE result SHALL be a model with background examples only.
2. FOR the label `hum`, WHEN the given model has no examples and the recordings give a pitch, THE result SHALL be a model with the given model's version, `k`, `sampleRate`, empty `mean` and `std`, no examples, no thresholds and `pitch.baselineHz` set from the recordings; its report SHALL have no labels, no confused pairs and the warnings of the recordings. WHEN the recordings give no pitch, the result SHALL keep the old pitch as before (none), with the `no-pitch-found` warning as before.
3. `trainVectors` SHALL NOT change: an empty list of examples still throws `TooFewExamplesError`. The hum case of 2.2 is handled in `retrainLabel`, which skips training when there are no vectors and the label is `hum`.
4. A model made by 2.1 or 2.2 SHALL be accepted by `checkModel`, and `classifyVector` SHALL work on a model made by 2.1 as on any trained model.
5. THE flow SHALL work through the Worker and the dialog: `ears.teach('click', { ui: true })` on an engine started without sounds SHALL train through `record-stop`, SHALL give `record-trained` with a model that has the label `click`, and after Save the new engine SHALL fire a `click` pattern for a click sound. THE same SHALL hold for `ears.teach('hum', { ui: true })` first, and for `background` first.
6. WHEN the dialog is opened for a label on the empty model, the line about existing examples SHALL be absent (nothing exists).
7. THE existing tests of `retrainLabel` and `trainVectors` SHALL pass unchanged.

### Requirement 3: Stored model and fingerprint when `sounds` is omitted
**User story:** As an end user, I want the sounds I taught on the first run to be there on the next visit.

#### Acceptance Criteria
1. WHEN `sounds` is omitted, THE `base` of the storage entry SHALL be the fingerprint of `emptyModel(SAMPLE_RATE_MIN_HZ)`. This is one fixed value that does not depend on the microphone (the rate is not known when the stored model is read). The implementer SHALL record its 8 hex digits in design.md, "Measured values", and a test SHALL pin it.
2. THE rule of Task 16 SHALL stay for a given `sounds`: `base` is the fingerprint of the `sounds` passed to `listen()`. A stored entry with another `base` is ignored with a `console.warn`.
3. WHEN a stored entry has the base of 3.1, a valid model, and a `sampleRate` equal to the input rate, THE model SHALL replace the empty model for this run, and `ears.sounds` and `ears.labels` SHALL show it from the start.
4. WHEN a stored entry has the base of 3.1 but a `sampleRate` different from the input rate (another device, another browser), THE entry SHALL be ignored with one `console.warn` that names the key, the stored rate and the input rate, and the run SHALL start with the empty model. The entry SHALL NOT be deleted. This rule applies only when `sounds` is omitted. A given `sounds` keeps the Task 16 behaviour, whose rate mismatch is shown by the overlay.
5. WHEN the user saves a taught label (or `importSounds` succeeds) in a run that started without `sounds`, THE model SHALL be stored under `storageKey` with the base of 3.1, as in Task 16 requirement 6.5 and 6.8.
6. THE `storageKey` option and its default SHALL not change.

### Requirement 4: `hum.*` patterns without a baseline are inert
**User story:** As an app developer, I want to write `hum.rise` in my patterns from the start, and have it work once the user has taught a hum.

#### Acceptance Criteria
1. `compile()` in `core/grammar.ts` SHALL NOT throw for `hum.rise` or `hum.fall` when `baselineHz` is undefined. The pattern SHALL be kept, and `Matcher.push` for a `continuous` event SHALL return no match while `baselineHz` is undefined (it already does). Every other check of `compile()` and `parsePattern` SHALL stay: invalid patterns, duplicate patterns, and a `baselineHz` that is given but not a finite number above 0 still throw `RangeError`.
2. WHEN a model with a `pitch.baselineHz` replaces a model without one (Save of a taught `hum` through `record-end`, and `importSounds` through `replaceSounds`), THE engine built in the Worker SHALL fire `hum.rise` and `hum.fall` from then on. No new method on the `Matcher` or the engine SHALL be added: the existing rebuild is the mechanism (design.md, "Inert hum patterns").
3. WHILE no baseline exists, `onEvent` (requirement 5) SHALL still receive the `continuous` pitch events, so an app can show that a hum was heard.
4. THE throwaway-engine checks in `listen()` (start, stored model, `importSounds`) SHALL stay as they are. They can no longer fail because of a missing baseline.
5. The property P9 (`test/pitch.test.ts`, glide direction) SHALL pass unchanged. No change SHALL be made to `core/continuous/`. A new test SHALL check that, for the same rising hum, a model without a baseline gives no match and a model with one gives `hum.rise` matches, while the sequence of `continuous` events is equal in both runs.
6. THE test whose expectation changes SHALL be named: `test/grammar.test.ts`, `'28 checks baselineHz (Req 3.3, 3.4, 3.7)'`, its first two expectations (a `Matcher` for `hum.rise` without a baseline throws a `RangeError` that mentions `baselineHz`) become: it does not throw, and it returns no match for a `continuous` event. Its third-from-last expectation (`setPatterns(['hum.rise'])` on a `Matcher` without a baseline throws a `RangeError`) changes for the same reason: it does not throw, and the test sets the patterns back to `['a']` before its last expectation (found in step 2.3: `setPatterns` uses the same `compile()`). Its other expectations (a pattern `'a'` does not throw, `0`, `-5`, `NaN` and `Infinity` as a baseline throw, a sound `a` matches) stay. THE test `test/web/teach.spec.ts`, `'importSounds of invalid text throws and changes nothing; a valid text replaces, stores and survives a reload'`, uses a hum pattern to show the handler check; its premise (the engine rejects a hum pattern for a model without a baseline) is gone, so its expectations change as design.md, "Changed tests" says. These changes are requirements of this task and not a way to pass a bug.
7. THE sentence in `integrate.md` and in the power's integrate skill that says `hum.rise` and `hum.fall` need a `hum` folder SHALL say instead that they stay silent until a hum is taught, and keep the words "`hum` folder" for the folder-based teach.

### Requirement 5: `onEvent` and `onEnvelope`
**User story:** As an app developer, I want to see what the engine heard (as text) and the waveform (as a picture) in my own UI.

#### Acceptance Criteria
1. `ListenOptions` SHALL get `onEvent?: (e: EngineEvent) => void` and `onEnvelope?: (env: Envelope) => void`. `EngineEvent` SHALL be the type of `core/engine.ts` (a `sound` event, a `continuous` pitch event, or `{ kind: 'unknown', t, nearest }`). It SHALL be exported as a type from `web/index.ts`, together with the new type `Envelope`.
2. `Envelope` SHALL have `t0` (the sound time in seconds of the first bin), `binMs` (`WEB_ENVELOPE_RESOLUTION_MS`), `min` and `max` (`Float32Array`, one value per bin). `t0` SHALL be a cumulative sample count divided by the sample rate, as the Worker computes it. THE arrays SHALL be the ones the overlay also reads; the doc comment SHALL say that the callback must not modify them.
3. `route` SHALL call `onEvent` for each `event` message and `onEnvelope` for each `envelope` message, in the order the Worker sent them. No new Worker message SHALL be added.
4. `onEvent` SHALL receive: every `sound` event, every `continuous` event, and every `unknown` with its `nearest`. It SHALL receive nothing for a segment that the classifier gives `background`, because the engine makes no event for it (this is the engine's rule: `background` never produces an event). The doc comment SHALL say that `nearest` is on `unknown` events only.
5. WHILE a teach dialog is open, neither callback SHALL be called for a message that was already in flight (as for `match` in Task 16 requirement 6.4). While the microphone is paused, no message arrives, so no call happens.
6. A callback that throws SHALL NOT stop listening. An error in `onEvent` SHALL be rethrown in a later task as pattern handlers do (`rethrowLater`). An error in `onEnvelope` SHALL be written with `console.error`, because it can repeat every 20 ms.
7. The overlay (`debug: true`) and the callbacks SHALL work together: each gets the messages independently.
8. THE doc comment SHALL say that the envelope is a summary (two numbers per 10 ms), that Tokk sends it nowhere, and that the app's own code must follow the privacy rule too.

### Requirement 6: `ears.toPageTime(t)`
**User story:** As an app developer, I want to know at which `performance.now()` time a sound was made, so that I can pick the page element that was highlighted then.

#### Acceptance Criteria
1. `Ears` SHALL get `toPageTime(t: number): number`. `t` is a sound time in seconds, as in `MatchEvent.t`. THE result SHALL be a time in ms on the clock of `performance.now()`.
2. THE mapping SHALL be estimated from the time at which the page receives the `envelope` messages (which come at least once per chunk of `WEB_CHUNK_MS`) and the sound time at the end of each message (`t0` plus the bins times `binMs`). For each message the page SHALL compute the page time of arrival minus that sound time in ms. THE estimate SHALL be the smallest such value among the messages received in the last `WEB_TO_PAGE_TIME_WINDOW_MS`. The smallest value is the one with the least delay between the audio and the page, so queueing delay in the page does not enter the estimate. The page time of `t` SHALL be `t` times 1000 plus the estimate.
3. THE mapping SHALL be correct across `pause()` and `resume()`. While the microphone is paused, no chunk arrives, the engine's clock stands still and the page's clock runs on. THE page SHALL therefore keep one mapping per stretch of listening: `resume()` ends the stretch before it and starts a new one. A time `t` SHALL use the mapping of the stretch that contains it (the last stretch that starts at or before `t`). WHEN `resume()` was called and no `envelope` message of the new stretch has arrived yet, THE mapping of the new stretch SHALL be provisional: the page time of the `resume()` call stands for the sound time at which the previous stretch ended. The first `envelope` message of the stretch replaces it.
4. THE engine clock restarts at 0 when the Worker builds a new engine (Save of a teach, Cancel of a teach, `importSounds`). THE Worker SHALL restart the envelope counters in `replaceSounds` too, as it does for `record-end` and `record-cancel`, so the envelope time axis and the engine time axis stay equal (requirement 11.1 names the test this changes). WHEN the engine is rebuilt, the page SHALL drop its stretches and start new ones. The doc comment SHALL say that `toPageTime` is for the times of the current engine, that a time from before a rebuild cannot be mapped, and that the call belongs inside the handler or soon after it.
5. WHEN there is no mapping at all (no `envelope` message has arrived since the start or the last rebuild, and no `resume()` provisional exists), `toPageTime` SHALL throw an `Error` whose message says that no audio has arrived yet. It SHALL NOT return `NaN`. WHEN `t` is not a finite number, it SHALL throw a `RangeError`. After `stop()`, it SHALL still work with the last mapping.
6. THE implementation SHALL be a pure module without DOM types and without a clock (`web/page-time.ts`): the caller passes the arrival time in ms of every message. A sound time SHALL be a cumulative sample count divided by the sample rate, as before, and SHALL be computed from the message, not from a clock.
7. THE error SHALL be measured in an E2E test with a stream whose start in page time is known, and the bound SHALL be written in design.md, "Measured values", for the stream as it is (requirement 11.3). The target is 50 ms. IF the measured error is above 50 ms, the implementer SHALL stop and report the evidence before the bound or the design is changed.
8. THE doc comment SHALL give the sources of the error: the delay of the input device and the audio graph (not known to the page), up to one bin (`binMs`) of rounding, and the jitter that the smallest-value rule removes only partly. It SHALL say that the page time is the time when the sound reached the page, not when the person made it.

### Requirement 7: `ears.labels`
**User story:** As an app developer, I want to know which sounds the engine has been taught, so that my app can tell a first run.

#### Acceptance Criteria
1. `Ears` SHALL get `readonly labels: string[]`, a getter that returns a new array each time, with: the labels of the current model's examples, without `background`, sorted by plain code-unit order, plus `hum` when the current model has `pitch.baselineHz`. A model with no examples and no pitch gives an empty array.
2. THE array SHALL follow the current model: it changes after a Save in the dialog, after `importSounds`, and at the start when a stored model is used.
3. THE doc comment SHALL say that `background` is not listed and that an app which needs to know whether a background was taught can read `ears.sounds.examples`.
4. THE function that computes the list SHALL be pure and live in `web/model.ts`.

### Requirement 8: `TeachOptions.text`
**User story:** As an app developer, I want the dialog to speak in the voice of my app.

#### Acceptance Criteria
1. `TeachOptions` SHALL get `text?: TeachText`, where `TeachText` is an exported type: a partial object of strings with these keys, each replacing the default text of the same place in the dialog (defaults are today's texts, unchanged):

| Key | Where it shows | Default | Placeholders |
|---|---|---|---|
| `title` | the heading | `Teach "{label}"` | `{label}` |
| `quiet` | the status line in the quiet second | `Stay quiet for 1 second` | none |
| `record` | the status line while sounds are collected (a label other than `hum` and `background`) | `Make the sound {count} times` (the default says `time` for 1) | `{count}` |
| `recordHum` | the status line while the hum is recorded | `Hum one steady note, then press Done.` | none |
| `recordBackground` | the status line while the background is recorded | `Let the room make its usual noise, then press Done.` | none |
| `training` | the status line while the model is trained | `Training...` | none |
| `count` | the count line | `{heard} of {target} heard, {kept} kept` | `{heard}`, `{target}`, `{kept}` |
| `needMore` | the reason text next to a disabled Done button, for too few examples | `Keep at least {min} examples. You have {kept}.` | `{min}`, `{kept}` |
| `review` | the status line when the result is shown | `Check the result, then save it.` | none |
| `failed` | the status line when training failed | `Training failed.` | none |
| `done` | the Done button | `Done` | none |
| `save` | the Save button | `Save` | none |
| `again` | the Record again button | `Record again` | none |
| `cancel` | the Cancel button | `Cancel (Esc)` | none |
| `close` | the Close button of the saved screen | `Close` | none |
| `saved` | the status line and text of the saved screen | `Saved.` | none |
| `savedSessionOnly` | the same, when the browser did not allow storing | `Saved for this session only. The browser did not allow storing it.` | none |

2. THESE texts SHALL stay default and SHALL NOT be overridable: the Delete buttons and every accessible name (the dialog has the heading as its name; the labels of the progress bar, the list and the thumbnails), the example lines, the other reasons next to Done and Save, the report lines and warnings, the line about existing examples, the limit line, and the saving line of the teach page. THE reason is that they carry measured numbers or diagnostics, or that an accessible name must contain the visible text of its control. The doc comment SHALL list the keys.
3. `ears.teach()` SHALL validate `text` before it opens anything. It SHALL reject with a `RangeError` that names the problem and the allowed keys or placeholders when: `text` is not a plain object, a key is unknown, a value is not a string or is empty after trimming, or a value uses a placeholder that its key does not allow. It SHALL reject the same way, before opening the dialog, as the other argument errors of Task 16 requirement 6.3.
4. A placeholder `{name}` in a value SHALL be replaced by the value (a number as plain text). A `{` that does not start an allowed placeholder SHALL be an error as in 3. THE result SHALL be set with `textContent`, never as HTML. A key that is absent SHALL keep the default.
5. THE pure functions in `format.ts` and `state.ts` that make these texts SHALL take the resolved texts as an optional last argument, whose default is the table's defaults, so every existing test of them passes unchanged.
6. THE override SHALL apply to this dialog only. It SHALL NOT be stored, and the next `ears.teach()` without `text` SHALL show the defaults.
7. THE texts SHALL be English where this repository supplies them (`ui.md`). An override is the app's text; this task adds no translation feature and no language option.

### Requirement 9: Theming with CSS custom properties
**User story:** As an app developer, I want the dialog to match my page, without it taking styles from the page.

#### Acceptance Criteria
1. THE dialog's style SHALL use these CSS custom properties, read through `var()` inside the Shadow DOM, each with a fallback equal to today's value: `--tokk-bg` (background of the dialog and of its buttons), `--tokk-fg` (text and the border of the buttons), `--tokk-accent` (the progress bar and the waveform of the thumbnails), `--tokk-font` (font family), `--tokk-radius` (corner radius of the dialog and the buttons). THE fallbacks SHALL be the current values: `OVERLAY_COLOURS.panelBackground` for the dialog background, `OVERLAY_COLOURS.headerBackground` for the buttons' background when `--tokk-bg` is not set, `OVERLAY_COLOURS.text`, `OVERLAY_COLOURS.waveform`, `system-ui, sans-serif` and 4 px.
2. THE only way to theme the dialog SHALL be inheritance: the app sets these properties on any ancestor of the dialog host (the host is a child of `document.body`, so on `body`, `html` or `:root`), and the Shadow DOM takes them. No `part`, no `::part()`, no `adoptedStyleSheets` from the page, no option object for colours and no other property name SHALL be added.
3. THE page's other styles SHALL stay out of the dialog (Task 16 requirement 4.1). `all: initial` on the host SHALL stay. The style of a page rule on `h1`, `body` or `button` SHALL NOT reach the dialog.
4. THE focus outline (`OVERLAY_COLOURS.focusOutline`, 2 px), the warning colours, the thumbnail canvas background and the backdrop SHALL NOT be themable, so a theme cannot remove a visible focus or the contrast of the warnings.
5. WHEN `--tokk-accent` is set, THE thumbnails SHALL be drawn with it (read once when the thumbnail is drawn, with the default as fallback), and a thumbnail already drawn SHALL NOT be redrawn.
6. THE default look SHALL be unchanged: with none of the properties set, every computed colour, font and radius of the dialog SHALL equal the value before this task. THE existing contrast tests (`test/overlay-theme.test.ts`) SHALL pass unchanged. THE style string SHALL be built from the same constants, so no new colour constant is added to `web/overlay/theme.ts`.
7. THE doc comment and `integrate.md` SHALL say that the app is responsible for the contrast of its own colours: text 4.5 to 1 against `--tokk-bg`, graphics 3 to 1 (`ui.md`). Tokk SHALL NOT check them.
8. No Halloween element SHALL be added to the dialog or to `web/`. The theme is the app's.

### Requirement 10: Public names and documents
**User story:** As an app developer and as a user of the Kiro power, I want the documents and the API test to match the code.

#### Acceptance Criteria
1. `web/index.ts` SHALL export the new types `EngineEvent`, `Envelope` and `TeachText`. No runtime export name SHALL be added or removed. `ListenOptions`, `Ears` and `TeachOptions` are already exported as types and SHALL carry the new members.
2. `test/public-api.test.ts` SHALL be extended without changing its existing assertions. It SHALL check (a) that `web/index.ts` exports exactly the runtime names `createEngine`, `knnClassifier`, `listen`, `loadSounds`, `readWav`, `runSamples` and `writeWav` (so the decision of requirement 1.1, no `emptySounds`, is pinned), and (b) with compile-time checks in `test/web-unit/public-api-types.ts`, which a test in `test/public-api.test.ts` type-checks by running `tsc` with `test/web-unit/tsconfig.public-api.json` (changed in step 2.8: `tsconfig.json` has no DOM types, so `npx tsc --noEmit` cannot check `web/listen.ts`, and `tsconfig.test-web.json` inherits the exclusion of `test/web-unit`; runtime part (a) reads `web/index.ts` as text, because vitest cannot import it): `ListenOptions` has an optional `sounds`, `onEvent` and `onEnvelope`; `Ears` has `labels` and `toPageTime`; `TeachOptions` has `text`; the three new types can be imported from the package entry.
3. `.kiro/steering/integrate.md` and `powers/tokk/skills/integrate/SKILL.md` SHALL describe: starting without sounds and the first run (`ears.labels`), the inert `hum.*` rule (replacing the sentence of requirement 4.7), `onEvent` and `onEnvelope`, `toPageTime` (with the one-sentence limits of requirement 6), `TeachOptions.text` with its keys, the five CSS custom properties, and the privacy sentence of requirement 5.8. They SHALL keep every phrase that `test/scripts.test.ts` and `test/kiro-config.test.ts` check. Both documents SHALL agree with each other for the shared parts, as they do today.
4. THE devlog (`docs/devlog.md`) SHALL get one entry.
5. THE `README.md` SHALL NOT change in this task (plan 4 owns the README).

### Requirement 11: Tests
**User story:** As a maintainer, I want the new behaviour and the new failure paths tested, and every changed test named.

#### Acceptance Criteria
1. THE existing tests whose expectation changes SHALL be exactly these (a requirement of this task, each reason in design.md, "Changed tests"): `test/grammar.test.ts` test 28 (requirement 4.6); `test/web/teach.spec.ts` import test (requirement 4.6); `test/protocol.test.ts` describe `replaceSounds`, test `'uses the new model, restarts the engine clock and keeps envelope times continuous'` (requirement 6.4: the envelope times now restart together with the engine clock). No other existing test SHALL change. `test/public-api.test.ts` SHALL be extended only.
2. THE vitest tests SHALL cover at least: `emptyModel`; the engine with an empty model and with a hum-only model (no event, no `onSegment`, no throw, `continuous` events still sent); `retrainLabel` on an empty model for a sound label, `hum` and `background`, with too few examples; `trainVectors` of an empty list still throwing; hum patterns without a baseline (inert, no throw, bad baselines and duplicates still throw, same `continuous` events with and without a baseline, matches only with one); P9 unchanged; the Worker with an empty model (`init`, no `segment` message for a sound, `record-start` to `record-trained` for a first label, hum first); the page-time module (the table of design.md); `labelsOf`; the text resolver (defaults equal today's strings, each key, every error path, placeholders); the style string (defaults equal the old style); the pinned base of an omitted `sounds`; the extended `public-api` test.
3. THE Playwright tests SHALL be the eight tests of the plan (listed in design.md with the titles of the plan) and the further tests listed there. The tests with the fake microphone use the same method as the Task 16 tests (a WAV `source`, or Chrome launched with its own fake-microphone file). The error of `toPageTime` SHALL be measured, and its value written to design.md.
4. No test SHALL be weakened or deleted to pass. IF a test shows that a rule of design.md is wrong, requirements.md and design.md SHALL be changed first and the reason written to `docs/devlog.md`.
5. EVERY new test with a time, a rate or a count SHALL use named constants with the unit in the name. EVERY sound time `t` in a test SHALL be a cumulative sample count divided by the sample rate.
6. THE existing E2E tests and property tests SHALL pass unchanged apart from requirement 11.1.

### Requirement 12: Constants, privacy, layers
**User story:** As a maintainer, I want the project rules kept.

#### Acceptance Criteria
1. THE new constants SHALL have their unit in the name: `WEB_TO_PAGE_TIME_WINDOW_MS` (2000, the span over which the smallest delay is searched) and `WEB_TEACH_RADIUS_PX` (4, the corner radius that is a literal in the dialog style today), both in `web/constants.ts` (the file where the Task 14 to 16 constants are). No sample count SHALL be hard-coded. Existing constants (`WEB_ENVELOPE_RESOLUTION_MS`, `WEB_CHUNK_MS`, `SAMPLE_RATE_MIN_HZ`, `KNN_K`, `MODEL_VERSION`, `MIN_EXAMPLES_PER_LABEL`) SHALL be imported, not copied. The style fallbacks SHALL come from `OVERLAY_COLOURS` and the existing `WEB_TEACH_*` constants.
2. `core/` SHALL stay pure. THE `core/` changes SHALL be only: `core/grammar.ts` (requirement 4), `core/engine.ts` (requirement 1.4), `core/classify/knn.ts` (`emptyModel`) and `core/teach.ts` (requirement 2.2). `core/index.ts` SHALL NOT change.
3. No code of this task SHALL send audio, a sample, an envelope, a model or a thumbnail over the network, or write a sample to storage. Searching the files this task adds or changes in `web/` for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `indexedDB`, `Image` and `src =` SHALL give no new hit. THE only storage SHALL be the feature-vector model in `localStorage` through `storage.ts`.
4. No new motion SHALL be added. The dialog's rules of Task 16 (no transition or animation, a determinate progress element, no `requestAnimationFrame`) SHALL hold with the theme and the text overrides.
5. `npm test`, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc -p tsconfig.test-web.json --noEmit`, `npm run build`, `npm run test:web` and `npm run check:public-api` SHALL pass at the end, and `PBT_RUNS=1000 npm test` SHALL pass once.
