---
inclusion: fileMatch
fileMatchPattern: ["apps/**/*", "docs/integration.md"]
---

# Integrating sound control into an app

## Order of work
- Teach first: make one folder per sound under `examples/sounds/<label>/` with at least 5 recordings each, 10 recommended.
- Rebuild `sounds.json` next: run `npm run sounds:rebuild`, or use the MCP `teach` tool. Read the confused pairs and warnings it prints.
- Then connect patterns: `listen({ sounds, on })` for one set of patterns, or `modes` when the patterns change with the state of the app.
- Last, test with recordings: write `expectEvents` tests against WAV files.

## Public API (target)
`listen`, `loadSounds` and the teach UI belong to the browser layer of plan 2 and are not in the repository yet. A Node integration today uses `createEngine`, `runSamples` and `expectEvents` from `tokk` and `tokk/node`. The samples below show the target API.

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
ears.stop();
```

Modes:
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

Test with a recording (Node, from `tokk/node`):
```ts
import { expectEvents } from 'tokk/node';

await expectEvents('clap-2.wav', ['clap', 'clap'], { sounds });
```
In this repository a recording to try it on is `fixtures/audio/synth/quick/quick-01.wav` with `fixtures/audio/synth/sounds.json`.

## Common mistakes
- Start the first sound after a quiet 1 s. The first second of a recording is the calibration window, so a sound in it is lost, and `teach` warns `sound-in-calibration`.
- Never name a real sound `background`. The label `background` is reserved for room noise and never produces an event.
- Use `hum.rise` and `hum.fall` alone, not mixed with other sounds in one pattern. They need a `hum` folder in the sounds for the baseline pitch.
- Keep gaps in range. Consecutive sounds are less than 350 ms apart, a rest `_` is 350 to 1000 ms. Both are measured from the start of one sound to the start of the next.
- Expect a late firing for a short pattern that is a prefix of a longer one. The engine waits to see whether the longer pattern continues.

## Project rules
- Follow the units rule: every threshold and time constant is written in ms, Hz or dB, with the unit in the name.
- Follow the privacy rule: no audio over the network, `sounds.json` holds feature vectors only, recordings stay in local `sounds/` folders.
