# Slides case

A deck of six slides about Tokk, shown with reveal.js. This is the third integration case: an open-source app that we did not write, which later gets sound control.

**Stage 1 (this state) is a plain deck with no sound.** It has no Tokk code, no microphone and no sound button. Arrow keys and the on-screen controls move the slides.

## Credit

- Framework: [reveal.js](https://revealjs.com), version 6.0.2.
- Author: Hakim El Hattab (<https://hakim.se>), and the reveal.js contributors.
- Licence: MIT. The licence text is in `LICENSE-revealjs.txt` in this folder, copied byte for byte from the package. It is also part of the site output, because the bundle contains reveal.js code.
- Home page, as the package states it: <https://revealjs.com>.

reveal.js is a build-time dependency (`devDependency`, exact version). The case calls only its public API and never edits it. The theme is the stock `serif` theme, which needs no font file. No reveal.js logo or image is used.

## What this case adds

A deck of our own, with original text, and (in a later stage) sound control.

## Files

- `index.html`: the slides.
- `src/main.ts`: starts the deck. The deck object is the module-level constant `deck`.
- `src/constants.ts`: the numbers of the deck, with units in the names.
- `src/style.css`: turns off every CSS transition and animation, and adds a focus outline to the controls.
