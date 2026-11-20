# Requirements: Task 18, Kiro power, custom agents and the `_new-app` spec template

## Introduction
Task 18 is the seventh task of plan 2 (browser layer). It lets Kiro work with Tokk in other projects. It adds:
- a Kiro power `tokk` in the Agent Plugins 1.0.0 format, at `powers/tokk/`, with three skills (`integrate`, `tune-sounds`, `new-app`) and an `mcp.json` that starts the `mcp-ears` server from the published npm package;
- an npm bin `tokk-mcp`, built by `scripts/build.ts` into `dist/mcp.js` with the MCP SDK and zod bundled in, so that the package keeps zero runtime dependencies and `mcp.json` can start the server outside this repository;
- two workspace custom agents, `.kiro/agents/sound-tuner.json` and `.kiro/agents/integrator.json` (design 8.7);
- the spec template `.kiro/specs/_new-app/` (design 8.4): one table "Sound name | Example folder | Pattern | Action" from which Kiro generates requirements, design and tasks for a new app;
- `docs/kiro.md`, one page that lists every Kiro feature used in this repository, with paths and documentation URLs;
- one vitest file that checks all of these files by structure. No test starts Kiro. The operator runs the agents afterwards.

This task writes configuration, Markdown and build code only. It changes no behaviour of `core/`, `web/` or `node/`, and no public export.

| Consumer | What it uses from this task |
|---|---|
| A developer with another web app | The power: skills, and the MCP server through `npx` after `npm publish` |
| The operator | The two agents, run with the Kiro CLI after this task |
| Task 19 (README, package metadata) | The `tokk-mcp` bin and `docs/kiro.md` for the README section on MCP and Kiro |
| Kiro usage write-up (design 16.4) | `docs/kiro.md` as the index of features and evidence |

Facts checked by the operator on 2026-11-20 against the current Kiro documentation (do not guess other formats; the URLs go into `docs/kiro.md`):
- Powers, https://kiro.dev/docs/powers/create/ and https://kiro.dev/blog/powers-supports-plugins/. New powers use the Agent Plugins 1.0.0 format. A power folder holds a required `plugin.json`, an optional `mcp.json` and optional `skills/<skill>/SKILL.md` (front matter `name`, `description`; optional `scripts/` and `references/` subfolders). `plugin.json` required fields: `$schema` (`https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`), `name` (kebab-case), `version` (semver), `description`, `author` (`name`, optional `url`), `keywords` (array, used for activation). Optional: `homepage`, `repository`, `license`. `mcp.json` is `{ "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", "mcpServers": { "<name>": { "type": "stdio", "command", "args", "env" } } }`. Kiro namespaces server names at install. A power can live in any folder of a repository and is installed from Powers panel, Add Custom Power, Import from folder or from GitHub. The docs do not say that steering files fit this format, so guidance goes into skills.
- Custom agents (CLI V3), https://kiro.dev/docs/custom-agents/configuration-reference/ and https://kiro.dev/docs/permissions/. Workspace agents live in `.kiro/agents/` as JSON (or Markdown with YAML front matter). Fields: `name`, `description`, `prompt`, `mcpServers`, `tools`, `permissions`, `resources`, `hooks`, `includeMcpJson`, `model`, `welcomeMessage`. `tools` takes built-in names or categories (`read`, `write`, `shell`, `web`) and MCP entries as `@server` or `@server/tool`. `permissions` is `{ "rules": [{ "capability": "fs_read" | "fs_write" | "shell" | "mcp" | ..., "match": [globs or "server/tool"], "effect": "allow" | "ask" | "deny" }] }`; deny wins; headless treats ask as deny. `resources` takes `file://path` or `skill://path/SKILL.md`. `includeMcpJson: true` adds the servers of the workspace `.kiro/settings/mcp.json`. Headless run: `kiro-cli chat --v3 --agent <name> --no-interactive`.

Facts read from this repository before this spec was written (step 1 of the tasks checks them again):
- `.kiro/settings/mcp.json` defines the server `mcp-ears` as `npm run --silent mcp` with `autoApprove` `listen` and `score`. It stays as it is.
- `tools/mcp-ears/tools.ts` exports `TOOLS` with four tools: `teach` (`dir`, optional `out`), `listen` (`wav`, `sounds`), `score` (`dir`, `sounds`), `spectrogram` (`wav`, optional `startS`, `endS`). `server.ts` names the server `mcp-ears`, roots path access at `process.cwd()` and starts only when it is the entry file (`isEntryPoint`).
- `scripts/build.ts` has `buildBundles()` (browser and node bundles with esbuild) and `build()` (clean, bundles, declarations). `test/build.test.ts` checks the bundle files, a byte-identical second build, and `npm pack --dry-run` (only `dist/**`, `package.json`, `README.md`, `LICENSE`).
- `package.json` has no `bin`, no `dependencies`; `@modelcontextprotocol/sdk` 1.32.2 and `zod` 4.6.7 are devDependencies; `files` is `dist`, `README.md`, `LICENSE`.
- `.kiro/steering/integrate.md` holds the integration order, the API samples, the common mistakes and the project rules. Its note "`listen`, `loadSounds` and the teach UI are not in the repository yet" was out of date after Tasks 14 to 17; this task replaces it (requirement 9).
- The npm name `tokk` was free on 2026-11-20 and nothing is published yet.
- Approved changes to this spec (2026-11-20): the power metadata is fixed (author `subniin`, repository and homepage `https://github.com/subniin/tokk`, which is not public yet); `.kiro/steering/integrate.md` is updated in this task; the `dist/mcp.js` entry check is tested through a real path, an `npm exec` start from an installed tarball, and the bin link.

## Glossary
- **Power**: the folder `powers/tokk/` in the Agent Plugins format.
- **Skill**: a `skills/<name>/SKILL.md` file inside the power.
- **Agent file**: a JSON file in `.kiro/agents/`.
- **Template**: the three files in `.kiro/specs/_new-app/`.

## Requirements

### Requirement 1: The `tokk-mcp` bin and `dist/mcp.js`
**User story:** As a developer in another project, I want the Tokk MCP server to start with `npx`, without cloning this repository.

#### Acceptance Criteria
1. `scripts/build.ts` SHALL bundle `tools/mcp-ears/server.ts` into `dist/mcp.js` (Node ESM, `platform: 'node'`), with `@modelcontextprotocol/sdk` and `zod` bundled in, in `buildBundles()` so `npm run build` and the build tests cover it. The file SHALL start with the line `#!/usr/bin/env node`.
2. `package.json` SHALL get `"bin": { "tokk-mcp": "./dist/mcp.js" }`. `files`, `exports`, `dependencies` and `peerDependencies` SHALL NOT change; `dependencies` stays absent, so the package keeps zero runtime dependencies.
3. `dist/mcp.js` SHALL contain no bare import of `@modelcontextprotocol/sdk` or `zod`. It MAY import Node built-ins. WHEN it is copied alone to an empty temporary folder with no `node_modules`, it SHALL start, answer the MCP `initialize` request and list the tools of `TOOLS`.
4. THE server SHALL start when `dist/mcp.js` is run through the bin link of `npx` (symlink on Linux and macOS, `.cmd` shim on Windows), not only when run by its real path. THE start SHALL be tested by the real path (`node dist/mcp.js`) and by `npx tokk-mcp` run from a temporary folder in which the tarball from `npm pack` is installed (a short timeout, no startup crash). If the `isEntryPoint` check fails in the bundle, through a link or a shim, the change SHALL be the smallest one in `tools/mcp-ears/server.ts` that makes the server start both when run directly and through an npm bin link, and keeps `npm run mcp` and the existing tests working. The temporary folder SHALL be deleted afterwards.
5. THE server SHALL write only protocol messages to the standard output, as now. NO code of this task SHALL send audio, a sample or a model over the network.
6. Two builds SHALL still give byte-identical `dist/tokk.js`, `dist/node.js` and `dist/mcp.js`. `npm run dev` SHALL NOT build `dist/mcp.js`. The type declarations SHALL NOT change for the new file.
7. `test/public-api.test.ts` SHALL keep its export expectations (no export changes). IF it asserts the whole `package.json` shape and fails on `bin`, THE expected value SHALL get the `bin` key as a named requirement of this task (this is a requirement-driven update, not a change to pass a bug).
8. `test/build.test.ts` SHALL be updated as named requirements of this task: `dist/mcp.js` exists after the build; it starts with the shebang; it has no bare SDK or zod import; `npm pack --dry-run` lists `dist/mcp.js`, still lists nothing outside `dist/**`, `package.json`, `README.md`, `LICENSE`, and in particular nothing under `powers/` or `.kiro/`; `package.json` `bin` points at an existing file; a copy of `dist/mcp.js` alone in a temporary folder answers `tools/list` with the names in `TOOLS`; the byte-identical second build includes `dist/mcp.js`.

### Requirement 2: The power `powers/tokk/`
**User story:** As a developer with another web app, I want to install one power and then ask Kiro for sound control.

#### Acceptance Criteria
1. THE power SHALL hold exactly: `plugin.json`, `mcp.json`, `skills/integrate/SKILL.md`, `skills/tune-sounds/SKILL.md`, `skills/new-app/SKILL.md`. No steering file, no other folder.
2. `plugin.json` SHALL have `$schema` `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`, `name` `tokk`, a semver `version`, a one-sentence English `description`, `author` `{ "name": "subniin", "url": "https://github.com/subniin" }`, `repository` `https://github.com/subniin/tokk`, `homepage` the same URL, `license` `MIT`, and `keywords` that include the five of design 8.5 (`sound control`, `clap`, `knock`, `hands-free`, `teach sound`) plus `whistle`, `hum`, `microphone`, `sound detection`, `audio events`, `tokk`. THE repository is not public yet; the URL is where it will be (design.md, "Assumptions").
3. `mcp.json` SHALL have `$schema` `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json` and one server `mcp-ears` with `type` `stdio`, `command` `npx` and `args` that run the bin `tokk-mcp` of the package `tokk` (design.md, "mcp.json"). THE package name and bin name in `args` SHALL equal `name` and the `bin` key in `package.json`; the test checks it.
4. THE power docs and skills SHALL say that the MCP server works only after `npm publish` of the package `tokk`. Before that, `npx` fails with a not-found error. Inside this repository `.kiro/settings/mcp.json` stays as it is and the power is not needed.
5. EVERY `SKILL.md` SHALL start with front matter that holds `name` equal to its folder name and a non-empty `description` that says when to use it. Body text SHALL be English, imperative and short. THE skills SHALL NOT use the optional `scripts/` or `references/` folders.
6. THE `integrate` skill SHALL carry the content of `.kiro/steering/integrate.md` in this order: teach first (folder per sound, at least 5 and recommended 10 recordings), `sounds.json`, then `listen()` or `modes`, then an `expectEvents` test; the public API with the browser samples (`loadSounds`, `listen`, `ears.teach`, pause, resume, stop, `setMode`, `exportSounds`, `importSounds`, `debug`, `source`, `storageKey`); the common mistakes; the project rules (units, privacy); and the teach page. Where `integrate.md` says the browser layer is not in the repository, the skill SHALL say it exists. The teach page text SHALL say: `teach.html` is part of the Tokk repository and is not in the npm package; to use it, clone the repository, run `npm run dev` and open `http://localhost:5173/teach.html`; without it, record WAV files into `sounds/<name>/` and build `sounds.json` with the `teach` MCP tool.
7. THE `tune-sounds` skill SHALL describe the MCP workflow with the exact tool names and inputs of `tools/mcp-ears/tools.ts`: `teach` on a sounds folder, read the leave-one-out accuracy, confused pairs and warnings; `score` on a labelled folder; `spectrogram` on a confusing recording (with `startS` and `endS`; the axes of the tool description); then the three proposals: which examples to record, what to put in `background`, which threshold to change. It SHALL say that Kiro cannot record sound, so a person records new files.
8. THE `new-app` skill SHALL explain how to fill the `_new-app` table (one row per sound and pattern, rules for each column, a worked example) and how to start from the template: copy the three files of `.kiro/specs/_new-app/` into a new spec folder of the user's project, fill the table, and ask Kiro to generate the rest. The template files are not inside the power folder, so the skill SHALL carry the table format in full and SHALL NOT depend on the repository path.
9. NO skill SHALL promise a measured time, accuracy or line count (design 9: only measured values).

### Requirement 3: The agent `sound-tuner`
**User story:** As a developer, I want an agent that reads scores and spectrograms and tells me what to record next, without touching my code.

#### Acceptance Criteria
1. `.kiro/agents/sound-tuner.json` SHALL be valid JSON with `name` `sound-tuner`, an English `description`, a `prompt`, `tools`, `permissions`, `includeMcpJson` `true`, and a `welcomeMessage`.
2. THE prompt SHALL say: read the `score` confusion table and the `teach` report, look at a `spectrogram` of the confusing recording, then propose (a) which examples to record next, (b) what to put into `background`, (c) threshold changes (in ms, Hz or dB with the unit named; `core/constants.ts` is changed by a person, not by this agent); never claim to have recorded sound; write results to `docs/experiments.md` only as a dated entry; cite example ids (`nearest.id`).
3. `tools` SHALL be exactly `read`, `write`, `@mcp-ears/teach`, `@mcp-ears/score`, `@mcp-ears/spectrogram`. It SHALL NOT have `shell`, `web` or `@mcp-ears/listen`.
4. `permissions.rules` SHALL allow: `fs_read` (all paths); `fs_write` only for `sounds/**`, `examples/sounds/**` and `docs/experiments.md`; `mcp` only for `mcp-ears/teach`, `mcp-ears/score` and `mcp-ears/spectrogram`. THE file SHALL have no rule that allows `shell` and no `fs_write` allow outside the three matches.
5. EVERY MCP name in `tools` and in `permissions` SHALL be a tool defined in `tools/mcp-ears/tools.ts`, and its server name SHALL be `mcp-ears`, the name in `.kiro/settings/mcp.json`.

### Requirement 4: The agent `integrator`
**User story:** As a developer, I want an agent that adds Tokk to my web app from a list of sounds and patterns.

#### Acceptance Criteria
1. `.kiro/agents/integrator.json` SHALL be valid JSON with `name` `integrator`, an English `description`, a `prompt`, `tools`, `permissions`, `resources`, `includeMcpJson` `true` and a `welcomeMessage`.
2. THE prompt SHALL say: take a sounds list (sound name and example folder) and a pattern table (pattern and action); check that `sounds.json` and the example folders exist, and stop with a clear message when they do not; write the `listen()` wiring (or `modes` when the table has screens), an optional `bindings.yaml` only when the user asks for it, and an `expectEvents` test per pattern; run the tests; report the number of lines of Tokk code that were added; never send audio over the network and never put recordings into `sounds.json`.
3. `tools` SHALL be exactly `read`, `write`, `@mcp-ears/listen`, plus `shell` because the agent runs the tests. It SHALL NOT have `web`, `@mcp-ears/teach`, `@mcp-ears/score` or `@mcp-ears/spectrogram`.
4. `resources` SHALL be `["file://.kiro/steering/integrate.md"]`.
5. `permissions.rules` SHALL allow `fs_read` and `fs_write` for all paths (no deny rule on the folders of the user's app), `mcp` for `mcp-ears/listen` only, and `shell` only for the matches `npm test*` and `npx vitest*`. THE file SHALL have no other `shell` allow.
6. THE name checks of requirement 3.5 SHALL hold for this file too.

### Requirement 5: The `_new-app` spec template
**User story:** As a developer, I want to fill one table and get a spec for my sound-controlled app.

#### Acceptance Criteria
1. `.kiro/specs/_new-app/requirements.md`, `design.md` and `tasks.md` SHALL exist. The folder name starts with `_` so it is never taken for a spec of this repository, and every file SHALL start with a first line that says it is a template (design.md, "Template").
2. `requirements.md` SHALL hold, in order: a title with a placeholder (`<App name>`), short instructions (at most 15 lines) that tell Kiro to read the table and generate the rest, and exactly one table with the header `Sound name | Example folder | Pattern | Action` and two example rows made of placeholders only. THE instructions SHALL cover: fill the table, ask Kiro to generate acceptance criteria below the table, `design.md` and `tasks.md` from it; use the pattern grammar of design 5.5 (`click click`, `_` for a rest, `hum.rise`, `hum.fall`, gaps below 350 ms and rests 350 to 1000 ms); name the `integrate` guidance; use modes when two patterns share a prefix and the screens differ; tasks are test-first with `expectEvents`; ask a question only about an empty cell.
3. EVERY cell of the example rows SHALL be a placeholder in angle brackets (`<sound name>`, `<examples/sounds/name>`, `<pattern>`, `<action>`), so no row can be read as a real binding.
4. `design.md` and `tasks.md` SHALL be stubs: the template line, a one-paragraph instruction ("Kiro generates this file from the table in requirements.md; replace everything below"), and a section skeleton with placeholders. They SHALL NOT mention Tasks 1 to 19 of this repository, `core/` internals or any real label name of `examples/sounds`.
5. THE template SHALL NOT claim any measured value.

### Requirement 6: `docs/kiro.md`
**User story:** As a judge or a new contributor, I want one page that shows how Kiro is used in this repository.

#### Acceptance Criteria
1. `docs/kiro.md` SHALL list every Kiro feature used here, one section each, with the real paths: specs (`.kiro/specs/`, including the `_new-app` template), hooks (`.kiro/hooks/`), steering (`.kiro/steering/`), MCP (`.kiro/settings/mcp.json`, `tools/mcp-ears/`, `dist/mcp.js` and the `tokk-mcp` bin), the power (`powers/tokk/`), and the agents (`.kiro/agents/`). Each entry SHALL give the file names that exist at the time of writing (read from the folders in step 1, not from memory).
2. THE page SHALL state how to install the power (Add Custom Power, Import from folder or from GitHub, folder `powers/tokk`), that the MCP part works only after `npm publish`, and how to run an agent headless (`kiro-cli chat --v3 --agent <name> --no-interactive`).
3. THE page SHALL record these four documentation URLs, with the date 2026-11-20 on which the operator checked them: https://kiro.dev/docs/powers/create/, https://kiro.dev/blog/powers-supports-plugins/, https://kiro.dev/docs/custom-agents/configuration-reference/, https://kiro.dev/docs/permissions/.
4. THE page SHALL be one page in English with a table of paths and no measured claims. Every path in backticks that names a repository file or folder SHALL exist, except the names that are explicitly marked "after publish" (`npx` usage) or "after build" (`dist/mcp.js`).

### Requirement 7: Tests
**User story:** As a maintainer, I want a failing test when a Kiro file loses a field or names a tool that does not exist.

#### Acceptance Criteria
1. `test/kiro-config.test.ts` SHALL be one vitest file that reads the files from disk and checks, without starting Kiro or a network call:
   - `plugin.json`: the required fields and their types, `name` in kebab-case, `version` as semver, the `$schema` URL, the keyword list of requirement 2.2, no unknown required field missing;
   - `mcp.json`: the `$schema` URL, one server, `type` `stdio`, `command` `npx`, `args` equal to the package and bin names of `package.json`;
   - every `SKILL.md` in the power: front matter with `name` (equal to the folder) and `description`; the three skill folders exist and no other file is in the power;
   - both agent files: valid JSON, the field set of requirements 3 and 4, `tools` as specified, every `@mcp-ears/<tool>` is a name in `TOOLS` of `tools/mcp-ears/tools.ts`, the permission rules have the shape `{ capability, match: string[], effect }` with `effect` in `allow`, `ask`, `deny`, the `fs_write` and `shell` matches are exactly as specified, and the file has no `shell` allow in `sound-tuner`;
   - the template: three files, the template first line, exactly one table with the specified header, every cell of its rows a placeholder, no mention of a real label of `examples/sounds`;
   - `docs/kiro.md`: the four URLs exist, and the existing-path rule of requirement 6.4.
2. `test/build.test.ts` SHALL be extended as named in requirement 1.8. THE start test of the bundled server SHALL use the SDK client with a stdio transport in a temporary folder, with a named timeout constant with its unit in the name (for example `MCP_START_TIMEOUT_MS`), and SHALL remove the temporary folder in `finally`.
3. A negative test per area SHALL show the check can fail: a copy of each parsed structure with one field removed fails the validator function (the validators are plain functions in the test file, called with the real data and with the broken copy).
4. No existing test SHALL be weakened. NO time or count in a new test SHALL be a bare number: use named constants with units in the name.
5. `npm test`, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npm run build`, `npm run check:public-api` and `npm run test:web` SHALL pass at the end.

### Requirement 8: Privacy, units and scope
**User story:** As a maintainer, I want this task to keep the project rules.

#### Acceptance Criteria
1. THE privacy rules SHALL hold: no code that sends audio over the network; `sounds.json` holds feature vectors only; recordings only in local `sounds/` folders. The skills and agent prompts SHALL repeat the two rules that matter for a user's app.
2. EVERY threshold or time constant that a skill or prompt names SHALL be written in ms, Hz or dB. NO sample count SHALL be hard-coded in code of this task.
3. THIS task SHALL NOT change `core/`, `web/`, `node/`, `.kiro/settings/mcp.json`, hooks, `docs/_planning/` or other specs. The one allowed change to `tools/mcp-ears/server.ts` is the entry check of requirement 1.4, and the one allowed change to existing steering is requirement 9.
4. NO live Kiro run SHALL be part of the tests or of the commit. The operator runs both agents afterwards and records the output in `docs/devlog.md` (not part of this task).

### Requirement 9: `.kiro/steering/integrate.md` matches the skill
**User story:** As a developer, I want the steering file and the `integrate` skill to say the same thing about the browser API.

#### Acceptance Criteria
1. `.kiro/steering/integrate.md` SHALL keep its front matter (`inclusion: fileMatch` and the same `fileMatchPattern`).
2. THE section "Public API (target)" SHALL be replaced by the current browser API: `listen` and `loadSounds` exist; `modes` and `setMode`; the debug overlay (`debug: true`); `ears.teach(label, { ui: true, examples })`; `exportSounds` and `importSounds`; `source`; `storageKey` (default `tokk:sounds`); the teach page `teach.html` through `npm run dev` (text of requirement 2.6). THE text "not in the repository" SHALL be gone.
3. THE steering file SHALL say that a stored personal model is tied to the `sounds` passed to `listen()` (a changed `sounds.json` hides an older stored model, with a console warning), as recorded in the devlog of Task 16.
4. THE sections "Order of work", "Common mistakes" and "Project rules" SHALL stay in substance. `test/kiro-config.test.ts` SHALL check that the steering file and the `integrate` skill both name the same API terms (`listen`, `loadSounds`, `modes`, `setMode`, `debug`, `ears.teach`, `exportSounds`, `importSounds`, `source`, `storageKey`, `teach.html`, `npm run dev`) and that the steering file keeps its front matter and has no "not in the repository" text.
5. 	est/scripts.test.ts checks key phrases of integrate.md. THE phrase plan 2 (from the stale text) SHALL be removed from its list as a named requirement of this task. Every other phrase of that list stays and SHALL still be found (ears.teach('clap', { ui: true }), createEngine and unSamples stay in the file).