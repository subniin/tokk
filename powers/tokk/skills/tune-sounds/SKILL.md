---
name: tune-sounds
description: Use when Tokk confuses two sounds, misses a sound or fires on noise. Runs the teach, score and spectrogram MCP tools and proposes which examples to record, what to put in background and which threshold to change.
---

# Tune sounds with the Tokk MCP tools

The tools come from the `mcp-ears` server (the `tokk-mcp` bin). It works only after `npm publish` of the package `tokk`. Before that, `npx` fails with a not-found error. Pass paths relative to the project root. If a tool reports "outside the working folder", Kiro started the server in another folder.

Kiro cannot record sound. A person records every new WAV file.

## Steps
1. Check the folder layout: one subfolder per sound, WAV files inside, at least 5 files per sound and 10 recommended, and a `background` folder with room noise.
2. Run `teach` with `dir` set to the sounds folder. Pass `out` when the default (`dir/../sounds.json`) is outside the working folder. Read the leave-one-out accuracy, the confused pairs and the warnings (for example `sound-in-calibration` and too few examples).
3. Run `score` with `dir` (a folder of labelled recordings: `x.wav` with `x.json` events) and `sounds` (the `sounds.json` from `teach`). Read precision and recall per label, the confusion table and the false positives per hour. `score` writes nothing.
4. For a recording that is confused, run `spectrogram` with `wav`, and `startS` and `endS` in seconds to zoom in. The picture shows time from left to right, 0 to 8 kHz from bottom to top, and level from -90 dB (black) to 0 dB (white).
5. Propose, and name the example ids (`nearest.id`) that led to each proposal:
   - which examples to record next, and for which sound;
   - what to put into `background` (room noise, keyboard, speech);
   - which threshold to change, in ms, Hz or dB with the unit named. A person changes `core/constants.ts`; do not edit it.

## Rules
- Never use the same recordings to teach `background` and to test it.
- Never claim to have recorded sound.
- Send no audio over the network. `sounds.json` holds feature vectors only. Keep recordings in local `sounds/` folders.
