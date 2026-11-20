# Kiro in this repository

One page that lists every Kiro feature used here. Paths are real files and folders. Names marked "after build" or "after publish" do not exist in a clean checkout.

## Specs
Each task has a spec folder with three files: requirements, design and tasks. The folder `_new-app` is a template for another project, not a spec of this repository.

| Path | What it is |
|---|---|
| `.kiro/specs/task-01-wav/` | Task 1, WAV reading and writing |
| `.kiro/specs/task-02-synth/` | Task 2, synthetic test sounds |
| `.kiro/specs/task-03-features/` | Task 3, features |
| `.kiro/specs/task-04-segment/` | Task 4, segmenter |
| `.kiro/specs/task-05-knn/` | Task 5, classifier |
| `.kiro/specs/task-06-pitch/` | Task 6, pitch |
| `.kiro/specs/task-07-grammar/` | Task 7, pattern grammar |
| `.kiro/specs/task-08-engine/` | Task 8, engine |
| `.kiro/specs/task-09a-score/` | Task 9a, scoring |
| `.kiro/specs/task-09b-spectrogram/` | Task 9b, spectrogram |
| `.kiro/specs/task-10-mcp/` | Task 10, MCP server |
| `.kiro/specs/task-11a-quick-hooks/` | Task 11a, quick hooks |
| `.kiro/specs/task-11b-sound-hooks/` | Task 11b, sound hooks |
| `.kiro/specs/task-12-teach-core/` | Task 12, teaching core |
| `.kiro/specs/task-13-build/` | Task 13, build and package |
| `.kiro/specs/task-14-listen/` | Task 14, browser `listen()` |
| `.kiro/specs/task-15-overlay/` | Task 15, debug overlay |
| `.kiro/specs/task-16-teach-dialog/` | Task 16, teach dialog |
| `.kiro/specs/task-17-teach-page/` | Task 17, teach page |
| `.kiro/specs/task-18-kiro-power/` | Task 18, this power, the agents and the template |
| `.kiro/specs/task-19-hello/` | Task 19, hello example, README and package metadata |
| `.kiro/specs/task-20-app-support/` | Task 20, first run without sounds, event hooks, `toPageTime` and dialog theming |
| `.kiro/specs/task-21-site/` | Task 21, app bundles, static site and wiring line count |
| `.kiro/specs/task-22-hands-free/` | Task 22, the Hands-Free app (apps/hands-free) |
| `.kiro/specs/task-23-knock-once/` | Task 23, the Knock Once for Yes app (apps/knock-once) and the Hands-Free "Heard:" fix |
| `.kiro/specs/_new-app/` | Template: fill one table, Kiro writes the spec |

## Hooks
Files in `.kiro/hooks/`:

| Path | What it does |
|---|---|
| `.kiro/hooks/corpus-score.json` | Scores the best labelled set when a file under `core/` is saved |
| `.kiro/hooks/pbt-quick.json` | Runs the quick property tests when the segmenter, the grammar or the classifier is saved |
| `.kiro/hooks/public-api-only.json` | Fails when a file in an app folder imports from `core/` instead of the public API |
| `.kiro/hooks/sounds-rebuild.json` | Rebuilds the sounds model when a recording is saved |
| `.kiro/hooks/web-smoke.json` | Runs the browser smoke test when a file below `web/` is saved |

## Steering
Files in `.kiro/steering/`:

| Path | What it holds |
|---|---|
| `.kiro/steering/halloween-ui.md` | Halloween look, story voice, captions, motion, contrast and effects of app 2, loaded only for `apps/knock-once/**` |
| `.kiro/steering/integrate.md` | How to integrate sound control into an app: order of work, browser API, mistakes, rules |
| `.kiro/steering/layers.md` | Which layer may import which |
| `.kiro/steering/privacy.md` | Privacy rules |
| `.kiro/steering/ui.md` | UI rules |
| `.kiro/steering/units.md` | Unit rules |
| `.kiro/steering/web-audio.md` | Web Audio rules |

## MCP
| Path | What it is |
|---|---|
| `.kiro/settings/mcp.json` | Starts the server `mcp-ears` inside this repository with `npm run --silent mcp` |
| `tools/mcp-ears/` | Source of the server and its four tools: `teach`, `listen`, `score`, `spectrogram` |
| `dist/mcp.js` (after build) | The server as one file with the SDK bundled in, started by the bin `tokk-mcp` |

## Power
The folder `powers/tokk` is a Kiro power in the Agent Plugins 1.0.0 format.

| Path | What it is |
|---|---|
| `powers/tokk/plugin.json` | Manifest (name, version, author, keywords) |
| `powers/tokk/mcp.json` | Starts the `tokk-mcp` bin through `npx` |
| `powers/tokk/skills/integrate/SKILL.md` | Add Tokk to a web app |
| `powers/tokk/skills/tune-sounds/SKILL.md` | Tune sounds with the MCP tools |
| `powers/tokk/skills/new-app/SKILL.md` | Fill the table of the `_new-app` template |

Install: open the Powers panel, choose Add Custom Power, then Import from folder (folder `powers/tokk`) or from GitHub.

The MCP part of the power works only after `npm publish` of the package `tokk`. Before that, `npx` fails with a not-found error. The `npx` start is therefore an "after publish" feature. Inside this repository the power is not needed: `.kiro/settings/mcp.json` runs the server from source.

## Agents
Workspace agents in `.kiro/agents/`:

| Path | What it does |
|---|---|
| `.kiro/agents/sound-tuner.json` | Reads scores, teach reports and spectrograms and proposes what to record next. It cannot run shell commands or use the web. |
| `.kiro/agents/integrator.json` | Wires Tokk into an app from a sounds list and a pattern table. It runs only `npm test` and `npx vitest` in the shell. |

Run an agent without a person at the keyboard:

```
kiro-cli chat --v3 --agent <name> --no-interactive --trust-workspace --require-mcp-startup
```

In this mode a permission that needs a question counts as denied. `--require-mcp-startup` is required: without it the first run of `sound-tuner` answered that the `mcp-ears` tools were not available, because the MCP servers had not started yet.

## Agent runs
The operator ran both agents headless (date in `docs/devlog.md`).

- `sound-tuner` (0.24 credits): called `score` on `fixtures/audio/synth/quick` with `fixtures/audio/synth/sounds.json`, and `spectrogram` on `quick-01.wav` from 1.0 to 3.5 s. Precision and recall were 1.000 for `high`, `low`, `mid` and `ring` (4 true positives each, 0 false positives, 0 false negatives). False positives per hour: 0.0 over 13.8 s. The spectrogram showed four broadband bursts up to about 8 kHz. It proposed no threshold change because nothing was confused. It could not cite `nearest.id`, because `score` does not print ids and `teach` had not run. It also noted that a perfect synthetic score says nothing about real recordings.
- `integrator` (0.18 credits): called `listen` on `quick-01.wav` and got `mid`, `high`, `low`, `ring`, `ring`, `low`, `high`, `mid` at 700 ms spacing. It wrote the `listen()` wiring and an `expectEvents` line. It pointed out that 700 ms gaps are rests (350 to 1000 ms), so the pattern `ring ring` would not fire on that file and `ring _ ring` would.
- Third case (`cases/slides`): the operator ran `integrator` headless on the slide deck with a sound list and a pattern table. It wrote only the start button, the marked wiring in the case's main source file and `test/slides-events.test.ts`, and ran only `npx vitest run test/slides-events.test.ts`. The caption and the styling were added afterwards in a normal run (see `docs/integration.md`).

## Documentation checked
The operator checked these pages on 2026-11-20:

| URL | Used for |
|---|---|
| https://kiro.dev/docs/powers/create/ | Power folder and manifest |
| https://kiro.dev/blog/powers-supports-plugins/ | Agent Plugins format for powers |
| https://kiro.dev/docs/custom-agents/configuration-reference/ | Agent fields |
| https://kiro.dev/docs/permissions/ | Permission rules |
| `.kiro/specs/task-25-integration-doc/` | Task 25, `docs/integration.md` with the measured development values |
| `.kiro/specs/task-26-slides-case/` | Task 26, the third case, a reveal.js slide deck (cases/slides) with sound control |
