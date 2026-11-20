---
inclusion: fileMatch
fileMatchPattern: ["apps/knock-once/**"]
---

# Halloween UI rules (app 2, Knock Once for Yes)

These rules add to `ui.md`, `web-audio.md` and `privacy.md` and weaken none of them. Follow those three files for the shared rules.

## Look
- Draw a dark room: candlelight (warm amber light) on near-black, a séance table drawn with CSS, and a pale ectoplasm waveform on a canvas.
- Use system fonts only, a serif stack such as `Georgia, "Times New Roman", serif`.
- Load no image, font, stylesheet or script from outside. The page has no image file.
- Show no face, skull, blood colour or gore image.

## Story voice
- Write the spirit's questions as text on the page. Use no speech synthesis and no voice recording.
- Keep the tone eerie and never gory: no violence, injury, body or blood.
- Name no real person, brand or place, and use no quotation. The inventor Edison and his "spirit phone" idea may appear once, as a light reference in plain words, never as a quote.

## Captions
- Keep the captions always on. Write every recognised knock, every question and every effect as text.
- Add no setting that turns the captions off or hides the list.

## Motion
- Respect `prefers-reduced-motion`: with `reduce`, show a still ectoplasm, no flicker, no flowing, no fade and no animation, and draw the canvas at most once per second.
- Put the candle flicker inside `@media (prefers-reduced-motion: no-preference)` only, and never change its brightness more than three times a second.

## Contrast
- Give text at least 4.5 to 1 and graphics at least 3 to 1 against the dark background.
- The same holds for the themed teach dialog: check the `--tokk-*` colours (`--tokk-fg` on `--tokk-bg`, `--tokk-accent` against `--tokk-bg`).

## Sound effects
- Synthesise every effect with Web Audio only: oscillators, filtered noise and gain envelopes. Ship no audio file and no `<audio>` element.
- Keep each effect short and quiet, under a named peak level in dBFS, faded in and out, never on a loop, and never speech.
- Play an effect only between questions, while `ears.pause()` holds the microphone, and call `ears.resume()` after it in every case.
- Never play a sudden loud sound or a flash. No jump scare.

## Scope
- Keep every Halloween element in `apps/knock-once/` only.
- Never put one in `web/`, `teach.html`, `examples/`, `apps/hands-free/` or the `core/` code.
