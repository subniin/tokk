---
inclusion: fileMatch
fileMatchPattern: ["apps/**/*", "docs/integration.md"]
---

# Integrating sound control into an app

## Order of work
- Teach first: make one folder per sound under `examples/sounds/<label>/` with at least 5 recordings each, 10 recommended. Use the teach page below, or record the WAV files yourself.
- Rebuild `sounds.json` next: run `npm run sounds:rebuild`, or use the MCP `teach` tool. Read the confused pairs and warnings it prints.
- Then connect patterns: `listen({ sounds, on })` for one set of patterns, or `modes` when the patterns change with the state of the app.
- Last, test with recordings: write `expectEvents` tests against WAV files.

## Public API
`listen` and `loadSounds` are in the browser bundle of `tokk`; `expectEvents` is in `tokk/node`. Node code can also use `createEngine` and `runSamples` from `tokk` directly. Call `listen()` after a user gesture (a click) on a page served over HTTPS or from `localhost`, because the browser asks for the microphone then.

Basic use:
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
- `sounds`: the model from `loadSounds(url)` (feature vectors only).
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
A model taught in the dialog is saved under `storageKey` and used on the next run. It is tied to the `sounds` passed to `listen()`: when `sounds.json` changes, the older stored model is ignored with a console warning, and the user teaches again.

Test with a recording (Node, from `tokk/node`):
```ts
import { expectEvents } from 'tokk/node';

await expectEvents('clap-2.wav', ['clap', 'clap'], { sounds });
```
In this repository a recording to try it on is `fixtures/audio/synth/quick/quick-01.wav` with `fixtures/audio/synth/sounds.json`.

## Teach page
`teach.html` is part of the Tokk repository and is not in the npm package. To use it, clone the repository, run `npm run dev` and open `http://localhost:5173/teach.html`. Without it, record WAV files into `sounds/<name>/` and build `sounds.json` with the `teach` MCP tool.
## Common mistakes
- Start the first sound after a quiet 1 s. The first second of a recording is the calibration window, so a sound in it is lost, and `teach` warns `sound-in-calibration`.
- Never name a real sound `background`. The label `background` is reserved for room noise and never produces an event.
- Use `hum.rise` and `hum.fall` alone, not mixed with other sounds in one pattern. They need a `hum` folder in the sounds for the baseline pitch.
- Keep gaps in range. Consecutive sounds are less than 350 ms apart, a rest `_` is 350 to 1000 ms. Both are measured from the start of one sound to the start of the next.
- Expect a late firing for a short pattern that is a prefix of a longer one. The engine waits to see whether the longer pattern continues.

## Project rules
- Follow the units rule: every threshold and time constant is written in ms, Hz or dB, with the unit in the name.
- Follow the privacy rule: no audio over the network, `sounds.json` holds feature vectors only, recordings stay in local `sounds/` folders.
