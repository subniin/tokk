---
name: new-app
description: Use when the user plans a new sound-controlled app and wants a spec. Explains the table Sound name, Example folder, Pattern, Action and how to get requirements, design and tasks from it.
---

# Plan a sound-controlled app from one table

## Steps
1. Create a spec folder in the user's project, with three files: `requirements.md`, `design.md` and `tasks.md`. Start each file with the line `<!-- TEMPLATE: copy this spec into your own project, then replace every <placeholder>. Not a spec of the Tokk repository. -->` and remove that line once the file is filled.
2. In `requirements.md`, write the title `# Requirements: <App name>` and the table below. Fill it.
3. Ask Kiro: "Generate acceptance criteria below the table, then design.md and tasks.md, from the table."

## The table
```
| Sound name | Example folder | Pattern | Action |
|---|---|---|---|
| <sound name> | <path/to/sounds/name> | <pattern> | <action> |
```
One row per sound and pattern. Rules for each column:
- **Sound name**: a label that matches `^[a-z][a-z0-9-]{0,31}$`. Never use `background` for a real sound.
- **Example folder**: a path relative to the project, with at least 5 WAV files of that sound (10 recommended).
- **Pattern**: the grammar of Tokk. Sound names separated by a space (`click click`), `_` for a rest, and `hum.rise` or `hum.fall` for a rising or falling hum. Consecutive sounds are less than 350 ms apart. A rest is 350 to 1000 ms.
- **Action**: one sentence in the words of the app, for example "turn the light on".

Worked example. It is invented, to show the shape. Replace it with the sounds of the user's app:

| Sound name | Example folder | Pattern | Action |
|---|---|---|---|
| clap | sounds/clap | clap clap | Turn the lamp on or off |
| cup | sounds/cup | cup _ cup | Go to the next slide |

## Rules for the generated spec
- Ask a question only about an empty cell. Do not invent sounds.
- Use `modes` when two patterns share a prefix and the screens of the app differ.
- Write tasks test-first, with an `expectEvents` test per pattern. Use the `integrate` skill for the wiring.
- Write every threshold and time in ms, Hz or dB. Do not state a measured time or accuracy before it is measured.
- Send no audio over the network. `sounds.json` holds feature vectors only. Keep recordings in local `sounds/` folders.
