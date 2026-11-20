---
name: integrate
description: Use when the user wants sound control, a clap, a knock, a hum or hands-free input in a web app with Tokk. Gives the order of work, the browser API, a test with a recording, the common mistakes and the project rules.
---

# Integrate Tokk sound control into a web app

## Order of work
1. Teach first. Make one folder per sound (`sounds/<name>/`), with at least 5 recordings each and 10 recommended. Use the teach page (see "Teach page") or record the WAV files yourself.
2. Build `sounds.json`. Use the `teach` MCP tool on the sounds folder (see the MCP note), or the teach page. Read the confused pairs and warnings.
3. Connect patterns. Use `listen({ sounds, on })` for one set of patterns, or `modes` when the patterns change with the state of the app.
4. Test last. Write one `expectEvents` test per pattern against a WAV file.

Check first that `sounds.json` and the example folders exist, unless the app teaches every sound on the first run (see "First run without sounds"). If they do not, stop and tell the user what is missing.

## API
`listen` and `loadSounds` are in the browser bundle of `tokk`; `expectEvents` is in `tokk/node`. Call `listen()` after a user gesture (a click) on a page served over HTTPS or from `localhost`, because the browser asks for the microphone then.

```ts
import { listen, loadSounds } from 'tokk';

const ears = await listen({
  sounds: await loadSounds('/sounds.json'),
  on: {
    'clap clap': () => toggleLight(),
    'clap _ clap': () => nextSlide(),
    'hum.rise': (e) => setVolume(e.speed),
  },
  debug: true,
});
ears.teach('clap', { ui: true });
ears.pause();
ears.resume();
await ears.stop();
```

Options of `listen()`:
- `sounds`: the model from `loadSounds(url)` (feature vectors only). Leave it out for a first run (see "First run without sounds").
- `onEvent` and `onEnvelope`: callbacks for every engine event and for the waveform (see "Events, waveform and page time").
- `on`: one set of patterns. `modes` and `mode`: several sets of patterns, and the one that starts active.
- `debug: true`: mounts the debug overlay, a panel with the waveform and the last results.
- `source`: a WAV URL or a `MediaStream`. Leave it out to use the microphone.
- `storageKey`: the `localStorage` key of the personal model taught in the app. Default `tokk:sounds`.

Modes, switched with `ears.setMode(name)`:
```ts
const ears = await listen({
  sounds,
  modes: {
    start: { 'clap clap': () => ears.setMode('question') },
    question: { snap: () => answerYes(), clap: () => answerNo() },
  },
  mode: 'start',
});
```

Teach inside the app, with the dialog:
```ts
const report = await ears.teach('tap', { ui: true, examples: 10 });   // at least 5 examples
const json = ears.exportSounds();   // the current model as JSON text
ears.importSounds(json);            // the same model back
```
A model taught in the dialog is saved under `storageKey` and used on the next run. It is tied to the `sounds` passed to `listen()`. When `sounds.json` changes, the older stored model is ignored with a console warning, and the user teaches again.

## First run without sounds
Leave out `sounds` when the users teach every sound on the first run:
```ts
const ears = await listen({ on: { click: () => next(), 'hum.rise': (e) => up(e.speed) } });
if (!ears.labels.includes('click')) await ears.teach('click', { ui: true });
if (!ears.labels.includes('hum')) await ears.teach('hum', { ui: true });
```
- `listen()` then starts with an empty model at the sample rate of the input. No sound pattern matches until its label is taught.
- `ears.labels` lists the taught labels, sorted, with `hum` when a hum pitch was taught and without `background` (read `ears.sounds.examples` for that). An empty list means a first run.
- The taught model is stored under `storageKey` and comes back on the next visit. A stored first-run model taught at another sample rate (another device) is ignored with a console warning.
- A typical teach order is the sounds first, then `hum`, then `background`.
- Teach several sounds in a row by awaiting `ears.teach()` one after the other. A dialog that shows only its saved screen is closed by the next call, and a dialog that is still recording or reviewing makes the next call reject.

## Events, waveform and page time
```ts
const ears = await listen({
  sounds,
  on: { knock: (m) => pick(ears.toPageTime(m.t)) },
  onEvent: (e) => showText(e),                     // sound, continuous (pitch) and unknown events
  onEnvelope: (env) => draw(env.t0, env.min, env.max),   // bins of env.binMs (10 ms); do not modify the arrays
});
```
- `onEvent` gets every event of the engine. Only `unknown` events carry `nearest`. A segment classified as `background` gives no event.
- `onEnvelope` gets a summary of the waveform, two numbers per 10 ms. Tokk sends it nowhere, and the app must not send or store it either (privacy rule).
- `ears.toPageTime(t)` maps a sound time in s to a `performance.now()` time in ms, also across `pause()` and `resume()`. It is the time the sound reached the page, a little after it was made (measured within 50 ms). A Save, a Cancel or `importSounds` restarts the sound clock, so call it inside the handler.

## Dialog text and theme
```ts
await ears.teach('knock', { ui: true, text: { title: 'Summon {label}', record: 'Knock {count} times', save: 'Bind' } });
```
- Keys of `text`: `title` ({label}), `quiet`, `record` ({count}), `recordHum`, `recordBackground`, `training`, `count` ({heard}, {target}, {kept}), `needMore` ({min}, {kept}), `review`, `failed`, `done`, `save`, `again`, `cancel`, `close`, `saved`, `savedSessionOnly`. An unknown key, an empty text or a placeholder the key does not have rejects with a `RangeError`. The text is shown as plain text, in that dialog only.
- Theme the dialog with five CSS custom properties set on `:root`, `html` or `body`: `--tokk-bg`, `--tokk-fg`, `--tokk-accent`, `--tokk-font` and `--tokk-radius`. Other page styles stay out of the dialog. The focus outline and the warnings are not themable. Check the contrast of your colours yourself: text 4.5 to 1 against `--tokk-bg`, graphics 3 to 1.
## Test with a recording
```ts
import { expectEvents } from 'tokk/node';

await expectEvents('clap-2.wav', ['clap', 'clap'], { sounds });
```

## Common mistakes
- Start the first sound after a quiet 1 s. The first second of a recording is the calibration window, so a sound in it is lost, and `teach` warns `sound-in-calibration`.
- Never name a real sound `background`. The label `background` is reserved for room noise and never produces an event.
- Use `hum.rise` and `hum.fall` alone, not mixed with other sounds in one pattern. They stay silent until a hum is taught: with `ears.teach('hum', { ui: true })`, or with a `hum` folder in the sounds for the baseline pitch.
- Keep gaps in range. Consecutive sounds are less than 350 ms apart, a rest `_` is 350 to 1000 ms. Both are measured from the start of one sound to the start of the next.
- Expect a late firing for a short pattern that is a prefix of a longer one. The engine waits to see whether the longer pattern continues.

## Project rules
- Write every threshold and time constant in ms, Hz or dB, with the unit in the name. Never hard-code a sample count; derive it from the sample rate.
- Send no audio over the network. `sounds.json` holds feature vectors only. Keep recordings in local `sounds/` folders.

## Teach page
`teach.html` is part of the Tokk repository and is not in the npm package. To use it, clone the repository, run `npm run dev` and open `http://localhost:5173/teach.html`. Without it, record WAV files into `sounds/<name>/` and build `sounds.json` with the `teach` MCP tool.

## MCP note
The `teach`, `listen`, `score` and `spectrogram` MCP tools come from the `tokk-mcp` server of this power. The server works only after `npm publish` of the package `tokk`. Before that, `npx` fails with a not-found error. Pass paths relative to the project root. If a tool reports "outside the working folder", Kiro started the server in another folder.
