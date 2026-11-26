# Slides case

A deck of six slides about Tokk, shown with reveal.js. This is the third integration case: an open-source app that we did not write, which later gets sound control.

The deck has sound control: after a click on **Start sound control** you teach the page your own clap, then two claps go to the next slide and three claps go to the previous slide. Without the button the deck is a plain deck. Arrow keys and the on-screen controls always work.

## Credit

- Framework: [reveal.js](https://revealjs.com), version 6.0.2.
- Author: Hakim El Hattab (<https://hakim.se>), and the reveal.js contributors.
- Licence: MIT. The licence text is in `LICENSE-revealjs.txt` in this folder, copied byte for byte from the package. It is also part of the site output, because the bundle contains reveal.js code.
- Home page, as the package states it: <https://revealjs.com>.

reveal.js is a build-time dependency (`devDependency`, exact version). The case calls only its public API and never edits it. The theme is the stock `serif` theme, which needs no font file. No reveal.js logo or image is used.

## What this case adds

A deck of our own, with original text, and sound control with Tokk: a start button, two clap patterns bound to the slide controls, and a caption that writes down what was heard. The Tokk code sits between the `// tokk:start` and `// tokk:end` markers in `src/main.ts`.

## Files

- `index.html`: the slides, the start button and the caption.
- `src/main.ts`: starts the deck. The deck object is the module-level constant `deck`.
- `src/caption.ts`: the caption texts, as one pure function.
- `src/constants.ts`: the numbers of the deck, with units in the names.
- `src/style.css`: turns off every CSS transition and animation, adds a focus outline to the controls, and styles the caption and the start button.

## The synthetic claps

The claps in `sounds/clap/`, the recordings in `recordings/` and `sounds.json` are synthetic. A program made them with `core/synth`. They are not recorded from a hand.

Why: the Node tests need sound that is the same on every machine. They exist only so that those tests can run. The page does not load them. In the browser each user teaches the app their own claps on the first run.

What they are for: `sounds.json` is the model for the tests, `sounds/clap/clap-01.wav` holds the ten teaching claps, and `recordings/clap-x2.wav` and `recordings/clap-x3.wav` hold two and three claps for the tests of the two patterns.

The recipe, in words (the constants are in `test/helpers/slides-claps.ts`): each clap is an impact of the class `mid` of `core/synth` (a burst centred near 1200 Hz that decays within tens of milliseconds), at -6 dB, over a white-noise bed at -75 dBFS, with its own seed. The sample rate is 48000 Hz. A quiet lead of 1200 ms comes before the first clap, so the noise floor can calibrate. The ten teaching claps start 800 ms apart. The claps of a pattern start 250 ms apart, which is inside the gap of consecutive sounds.

These files test the wiring. Real claps were checked by hand: see the Double clap row in [docs/integration.md](../../docs/integration.md).

## When `clap clap` fires

The patterns are `clap clap` and `clap clap clap`, in one set. After the second clap the engine waits to see whether a third one follows, so `clap clap` fires about a third of a second after the second clap, because of `clap clap clap`.

## How to run it

1. Run `npm run dev` and open <http://localhost:5173/cases/slides/index.html>. Use Chrome. The page must be served from `localhost` or over HTTPS.
2. Press **Start sound control** (with the mouse, or with Tab and Enter or Space). Allow the microphone.
3. The first time, a dialog asks you to clap about ten times. Stay quiet for the first second. Press Done, then Save, then Close. The model is stored in your browser under the key `tokk:slides`, so the next visit starts at once.
4. Clap twice for the next slide. Clap three times for the previous slide. One clap does nothing.

The two patterns are in one set, and `clap clap` is a prefix of `clap clap clap`. After your second clap the engine waits about a third of a second to see whether a third clap follows, so the slide moves a little after the second clap. A three-clap sequence never shows `clap clap`.

What the caption shows, in the bottom-left corner: "Sound control is off. Press Start sound control." before the start, "Teach your clap in the dialog." during the teaching, "Listening. Clap twice for the next slide, three times for the previous slide." afterwards, and "Heard: clap clap. Next slide." or "Heard: clap clap clap. Previous slide." after each pattern. A microphone error is written out with the text "The keyboard still works." If the microphone is refused, the deck works with the keyboard as before.

Where the data stays: the taught model (feature numbers, no audio) is kept in your browser's storage under `tokk:slides`. Nothing is sent anywhere, and the page keeps no recording.

reveal.js takes the Space key on a focused button as "next slide" and cancels the key. The case stops that key at the start button, so Space and Enter start the sound control and do not move a slide.
