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

Check first that `sounds.json` and the example folders exist. If they do not, stop and tell the user what is missing.

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
A model taught in the dialog is saved under `storageKey` and used on the next run. It is tied to the `sounds` passed to `listen()`. When `sounds.json` changes, the older stored model is ignored with a console warning, and the user teaches again.

## Test with a recording
```ts
import { expectEvents } from 'tokk/node';

await expectEvents('clap-2.wav', ['clap', 'clap'], { sounds });
```

## Common mistakes
- Start the first sound after a quiet 1 s. The first second of a recording is the calibration window, so a sound in it is lost, and `teach` warns `sound-in-calibration`.
- Never name a real sound `background`. The label `background` is reserved for room noise and never produces an event.
- Use `hum.rise` and `hum.fall` alone, not mixed with other sounds in one pattern. They need a `hum` folder in the sounds for the baseline pitch.
- Keep gaps in range. Consecutive sounds are less than 350 ms apart, a rest `_` is 350 to 1000 ms. Both are measured from the start of one sound to the start of the next.
- Expect a late firing for a short pattern that is a prefix of a longer one. The engine waits to see whether the longer pattern continues.

## Project rules
- Write every threshold and time constant in ms, Hz or dB, with the unit in the name. Never hard-code a sample count; derive it from the sample rate.
- Send no audio over the network. `sounds.json` holds feature vectors only. Keep recordings in local `sounds/` folders.

## Teach page
`teach.html` is part of the Tokk repository and is not in the npm package. To use it, clone the repository, run `npm run dev` and open `http://localhost:5173/teach.html`. Without it, record WAV files into `sounds/<name>/` and build `sounds.json` with the `teach` MCP tool.

## MCP note
The `teach`, `listen`, `score` and `spectrogram` MCP tools come from the `tokk-mcp` server of this power. The server works only after `npm publish` of the package `tokk`. Before that, `npx` fails with a not-found error. Pass paths relative to the project root. If a tool reports "outside the working folder", Kiro started the server in another folder.
