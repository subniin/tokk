# Tokk

Tokk is a sound-event engine that lets an app react to short sounds like a clap, a knock or a whistle, in the browser and in Node.

## Example

7 lines of Tokk code listen to the microphone and write every recognised sound and pattern as text. The page is `examples/hello/index.html`.

The code imports `tokk` the way an app does. A browser needs an import map to find it, and the map is the one extra line. It is not counted:

```html
<script type="importmap">{ "imports": { "tokk": "https://cdn.jsdelivr.net/npm/tokk/+esm" } }</script>
```

```js
// tokk:start
import { listen, loadSounds } from 'tokk';
const show = (m) => results.append(Object.assign(document.createElement('li'), { textContent: `${m.pattern} at ${m.t.toFixed(2)} s` }));
const on = Object.fromEntries(['low', 'mid', 'high', 'ring', 'low _ mid'].map((pattern) => [pattern, show]));
start.onclick = async () => {
  try { await listen({ sounds: await loadSounds('sounds.json'), on, debug: true }); }
  catch (e) { error.textContent = e.message; }
};
// tokk:end
```

The CDN map works after publish. The page in this repository maps `tokk` to the local build instead (`../../dist/tokk.js`). Run `npm run dev` and open `http://localhost:5173/examples/hello/index.html`. The example needs a browser with import maps.

The model in `examples/hello/sounds.json` is synthetic: it was built from synthetic sounds at the sample rate of the test microphone, so your own sounds will not match it. Replace it by teaching real sounds with `teach.html` and picking `examples/hello` as the project folder.

## Teach your own sounds

`teach.html` is part of this repository and is not in the npm package.

1. Run `npm run dev`.
2. Open `http://localhost:5173/teach.html`.
3. Pick the project folder.
4. Type the sound name.
5. Record the sound 10 times.
6. Save.

The result is the same as running `npm run sounds:rebuild`: WAV files in `sounds/<name>/` and a `sounds.json` with feature vectors.

## Node tools and MCP server

`tokk/node` has `teachFromDir`, which teaches from a folder of WAV files, and `expectEvents`, which tests a recording:

```ts
import { expectEvents } from 'tokk/node';

await expectEvents('clap-2.wav', ['clap', 'clap'], { sounds });
```

The MCP server has four tools: `teach`, `listen`, `score` and `spectrogram`. In this repository, run it with `npm run mcp`. After publish, the `tokk-mcp` bin starts it.

## Kiro

`docs/kiro.md` describes the Kiro power and the agents. The MCP part of the power works after publish.

## Privacy

Audio never leaves the device. `sounds.json` holds feature vectors only. Original recordings stay in local `sounds/` folders.

## Known limits

- The first 1000 ms after the microphone opens is the calibration window. A sound inside it is lost, so stay quiet for one second.
- A sound that repeats soon after the previous one can come out as `unknown`.
- Tokk is tested on synthetic sounds and on Chrome's fake microphone. Experiments with real microphones are pending.

## Media and measurements

- GIF of the example: pending.
- Video: pending.
- Measured teaching time and lines of code: pending.

## License

MIT, see `LICENSE`.

## Slide deck case

[`cases/slides/`](cases/slides/) is a third case: a slide deck shown with reveal.js, with sound control added through Tokk (clap twice for the next slide, three times for the previous slide). Its claps for the Node tests are synthetic, and recognition of a real clap is pending. The deck uses [reveal.js](https://revealjs.com) by Hakim El Hattab, version 6.0.2, under the MIT licence (the licence text is in `cases/slides/LICENSE-revealjs.txt`).
