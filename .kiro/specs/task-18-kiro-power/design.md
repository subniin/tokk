# Design: Task 18, Kiro power, custom agents and the `_new-app` spec template

## Layout
```
powers/tokk/
├─ plugin.json                       Agent Plugins 1.0.0 manifest
├─ mcp.json                          starts tokk-mcp through npx (works after npm publish)
└─ skills/
   ├─ integrate/SKILL.md             teach -> sounds.json -> listen()/modes -> expectEvents, API, mistakes, teach page
   ├─ tune-sounds/SKILL.md           MCP teach / score / spectrogram workflow
   └─ new-app/SKILL.md               how to fill the _new-app table and generate the rest
.kiro/agents/sound-tuner.json
.kiro/agents/integrator.json
.kiro/specs/_new-app/{requirements,design,tasks}.md
docs/kiro.md
scripts/build.ts                     + dist/mcp.js in buildBundles()
package.json                         + "bin": { "tokk-mcp": "./dist/mcp.js" }
test/kiro-config.test.ts             new: structure checks
test/build.test.ts                   + dist/mcp.js, bin, pack list, standalone start
test/public-api.test.ts              only if it asserts the whole package.json shape (requirement 1.7)
docs/devlog.md                       one line
.kiro/steering/integrate.md           current browser API (requirement 9)
tools/mcp-ears/server.ts             only if the entry check needs the smallest fix (requirement 1.4)
```
Nothing else changes. `.kiro/settings/mcp.json` stays: inside this repository the server runs through `npm run --silent mcp` with `tsx`.

## Assumptions (this spec was written without a person to ask)
1. **Power version `0.1.0`; author `{ "name": "subniin", "url": "https://github.com/subniin" }`, `repository` and `homepage` `https://github.com/subniin/tokk`, `license` `MIT`.** Given by the operator on 2026-11-20. The repository is not public yet; the URL is where it will be. `package.json` gets its real metadata in Task 19.
2. **`npx` command: `npx -y -p tokk tokk-mcp`.** The `-p` form names the package and the bin separately, so it works even if the bin name differs from the package name. `-y` avoids an install prompt that a stdio client cannot answer.
3. **The server's folder root is the working folder of the process.** `createServer()` uses `process.cwd()` for path access. The design assumes Kiro starts the MCP process in the workspace folder. The `tune-sounds` and `integrate` skills tell the user to pass paths relative to the project root, and to report a "outside the working folder" error as a sign that Kiro started the process elsewhere. This is not checked here (no live Kiro run).
4. **`integrate.md` is updated in this task** (approved change, requirement 9). The "Public API (target)" section becomes the current browser API, with the front matter kept, so the steering file and the `integrate` skill say the same thing. Test A11 compares the API terms.
5. **The agents' `prompt` is inline text.** The documented field accepts text; a `file://` prompt is not in the facts the operator checked, so it is not used.
6. **`shell` in `integrator.tools`.** Permissions limit it to `npm test*` and `npx vitest*`. The task statement lists `tools: read, write, @mcp-ears/listen` and then "shell only for ..." in permissions; a shell rule has no effect when the shell tool is not in `tools`, so `shell` is added to `tools`.
7. **The `mcp` capability match uses the form `mcp-ears/<tool>`.** The operator's facts say the match is `"server/tool"` for MCP. The agent file also lists `@mcp-ears/<tool>` in `tools`. Both name the server `mcp-ears` of `.kiro/settings/mcp.json`, reached by `includeMcpJson: true`.
8. **`sounds.json` written by the `teach` MCP tool is not an `fs_write`.** The tool writes inside the server process. So `sound-tuner` can refresh `sounds.json` even if it is outside `sounds/**`. The path guard of the server (working folder only) is the limit there. The agent's `fs_write` rule covers only what the agent writes itself.

## Findings from reading the code
1. **`server.ts` runs only as the entry file.** `isEntryPoint()` compares `realpathSync(process.argv[1])` with `realpathSync(fileURLToPath(import.meta.url))`. In a bundle, `import.meta.url` is the URL of `dist/mcp.js`, and an `npx` run gives `argv[1]` as the bin link. `realpathSync` follows a symlink, so they match on Linux and macOS. On Windows `npx` runs `node <path>\dist\mcp.js` through a shim, so `argv[1]` is the real file. If a runtime reports an unresolved link, requirement 1.4 allows the smallest fix. The test starts the bundle with `node dist/mcp.js` and a stdio client (real path). The link case is checked by hand in step 3.5: `npm pack`, install the tarball in a temporary folder, `npx tokk-mcp` with a short timeout (npm creates a symlink on Linux and macOS and a `.cmd` shim on Windows, and the entry check must accept both). If that start exits at once, the fix is in `isEntryPoint` (compare real paths with `realpathSync.native`, or accept a bin link whose target is this file).
2. **The SDK and zod are devDependencies.** Bundling them keeps `dependencies` absent. The cost is the size of `dist/mcp.js`. It is a separate file, loaded only by the bin, so `dist/tokk.js` (the browser bundle) does not grow.
3. **A bundled SDK may use `require` of CommonJS code.** With `format: 'esm'` and `platform: 'node'`, esbuild turns a dynamic `require` of a Node built-in into a runtime error unless a `require` exists. The usual fix is a banner that defines `require` with `createRequire(import.meta.url)`. Step 3.3 builds, runs, and adds the banner only if the start test shows the error. The shebang goes first in the banner.
4. **`buildBundles()` runs the browser and node builds in parallel.** `dist/mcp.js` is a third entry in the same `Promise.all`. `build()` removes `dist/` before, so a stale file cannot stay.
5. **The pack test lists files with `npm pack --dry-run --json`.** `bin` needs `dist/mcp.js` in `files`, which `dist` already covers. The executable bit comes from npm at pack time for a `bin` target, not from the file mode on disk (Windows has none), so the test checks only the shebang and the `bin` key.
6. **`.kiro/agents/` and `powers/` do not exist yet** (checked in step 1). `powers/` is not in `files`, so the pack test proves it is not published.

## Decisions

### mcp.json
```
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "mcp-ears": { "type": "stdio", "command": "npx", "args": ["-y", "-p", "tokk", "tokk-mcp"], "env": {} }
  }
}
```
`env` is empty: the server needs no secret and no setting. Kiro namespaces the server name at install, so a project that already has its own `mcp-ears` does not clash. The test builds the expected `args` from `package.json` (`name` and the single `bin` key), so renaming either one fails the test instead of leaving a dead power.

Options for the server command:
| Option | For | Against |
|---|---|---|
| **npx of the published package** | works in any project, nothing to clone | needs `npm publish` first; first start downloads the package |
| Path to a clone of this repository | works now | breaks on other machines; needs tsx and dev dependencies |
| Ship `dist/mcp.js` inside the power folder | no network after install | the power would hold a build artifact that goes stale; a second copy of the server |

Chosen: npx. The docs and skills say plainly that it needs the publish (requirement 2.4).

### Bundling `dist/mcp.js`
- One more `BuildOptions` in `scripts/build.ts`: `SHARED_OPTIONS`, entry `tools/mcp-ears/server.ts`, `platform: 'node'`, `outfile: dist/mcp.js`, `banner.js` with the shebang (and the `createRequire` line when step 3.3 needs it). Packages are not marked external.
- `tsconfig.build.json` (declarations) already covers only the public entries; step 3.1 confirms that `dist/types` gets no `tools/` files. If it does, the declaration config is narrowed, not `exports`.
- Constants: no new ms or Hz value. The only number the tests add is the timeout for starting the child process, a named constant with the unit in its name.

### Skills: content plan
`integrate` (source: `.kiro/steering/integrate.md`, updated to the current API):
1. When to use (the user wants sound control, a clap, a knock or hands-free input in a web app).
2. Order of work (four steps, as in the steering file; the teach step names the teach page and the MCP `teach` tool).
3. API: the `listen` and `modes` samples of design 6, plus `ears.teach`, `exportSounds`, `importSounds`, `source`, `storageKey`, with a note that `listen()` needs a user gesture and HTTPS (or localhost).
4. Test: `expectEvents` from `tokk/node` with a WAV.
5. Common mistakes (the five of the steering file).
6. Project rules (units, privacy).
7. Teach page: the text of requirement 2.6, including that it is not in the npm package.
8. MCP availability note: works after `npm publish`.

`tune-sounds`:
1. Check that the folder layout is one subfolder per sound with WAV files, at least 5, recommended 10, and a `background` folder.
2. `teach` with `dir` (and `out` when the default `dir/../sounds.json` is outside the working folder). Read accuracy, confused pairs, warnings (`sound-in-calibration`, too few examples).
3. `score` with a labelled fixture folder (`x.wav` with `x.json`); read precision, recall, the confusion table and false positives per hour.
4. `spectrogram` on a confusing file, zoom with `startS` and `endS`; the picture is 0 to 8 kHz, about 10 ms per pixel, levels -90 to 0 dB.
5. Propose: examples to record, what to add to `background`, threshold changes in named units. State that a person records the sound.
6. Do not teach and test on the same recordings for `background` (design 8.9).

`new-app`:
1. The table with the four columns and a rule per column: sound name (`^[a-z][a-z0-9-]{0,31}$`, never `background` for a real sound), example folder (relative path with at least 5 WAV files), pattern (grammar of design 5.5), action (one sentence in the app's words).
2. Worked example with two placeholders-free rows that are plainly invented (`clap`, `cup`) so the reader sees the shape; the skill says it is an illustration.
3. Steps: copy the template (the skill carries the full template text, requirement 2.8), fill the table, ask Kiro "generate the requirements, design and tasks from the table".
4. Rules for generated tasks: test-first with `expectEvents`, modes when prefixes clash or screens differ.

Each skill is Markdown only. Descriptions are one or two sentences so activation picks the right skill.

### Agent files
`sound-tuner.json` (field order: name, description, prompt, includeMcpJson, tools, permissions, welcomeMessage):
- `tools`: `["read", "write", "@mcp-ears/teach", "@mcp-ears/score", "@mcp-ears/spectrogram"]`.
- `permissions.rules`:
  1. `fs_read`, match `["**"]`, allow.
  2. `fs_write`, match `["sounds/**", "examples/sounds/**", "docs/experiments.md"]`, allow.
  3. `mcp`, match `["mcp-ears/teach", "mcp-ears/score", "mcp-ears/spectrogram"]`, allow.
- Unmatched capabilities, including `shell`, are not allowed by any rule; in headless mode an unmatched ask is a deny.

`integrator.json`:
- `tools`: `["read", "write", "shell", "@mcp-ears/listen"]`.
- `resources`: `["file://.kiro/steering/integrate.md"]`.
- `permissions.rules`:
  1. `fs_read`, `["**"]`, allow.
  2. `fs_write`, `["**"]`, allow (the user's app can be anywhere; no deny on app folders).
  3. `mcp`, `["mcp-ears/listen"]`, allow.
  4. `shell`, `["npm test*", "npx vitest*"]`, allow.
- `resources` points to this repository's steering file; in another project it is missing, and the prompt tells the agent to use the `integrate` skill of the power then.

Both: `includeMcpJson: true`, `welcomeMessage` one English sentence that says what to give the agent (a scores folder; a sounds list and a pattern table). The tests check shape and names, not the wording of prompts, except that required topics appear as words (see "Tests", row A4).

### Template
First line of each file: `<!-- TEMPLATE: copy this spec into your own project, then replace every <placeholder>. Not a spec of the Tokk repository. -->`. Title `# Requirements: <App name>`.

`requirements.md`:
```
# Requirements: <App name>
(template line above the title)
## How to use this template (instructions for Kiro)
1. Read the table. Each row is one sound with the pattern that triggers one action.
2. Ask only about an empty cell. Do not invent sounds.
3. Write acceptance criteria below the table, one requirement per row, in EARS style.
4. Write design.md and tasks.md from the table. ...
| Sound name | Example folder | Pattern | Action |
|---|---|---|---|
| <sound name> | <examples/sounds/name> | <pattern> | <action> |
| <sound name> | <examples/sounds/name> | <pattern> | <action> |
```
A table cell with a placeholder is `<` words `>`. The test regex: every cell matches `^<[^<>]+>$`.

`design.md` and `tasks.md` hold the template line, the instruction paragraph and a skeleton: sections `Sounds`, `Patterns and modes`, `Wiring`, `Tests` (design) and a test-first checklist with `<N>` placeholders (tasks), ending with a placeholder commit message `<type>: add <app name> sound control`.

### docs/kiro.md
One page, sections in this order: Specs, Hooks, Steering, MCP, Power, Agents, Documentation checked. A table per section: path, what it does. Content is read from the folders in step 1 and written as the folders are. The page lists the four URLs with the check date 2026-11-20. It states: power install steps; `npx` needs the publish; headless run of an agent (`kiro-cli chat --v3 --agent <name> --no-interactive`); `.kiro/settings/mcp.json` stays for in-repo use.

### Tests
| # | Test | Where | Requirement |
|---|---|---|---|
| B1 | `dist/mcp.js` exists after the build, starts with `#!/usr/bin/env node`, has no bare import of the SDK or zod | `test/build.test.ts` | 1.1, 1.3 |
| B2 | `package.json` `bin['tokk-mcp']` points to an existing file, `dependencies` absent | `test/build.test.ts` | 1.2 |
| B3 | a copy of `dist/mcp.js` alone in a temp folder starts, and `tools/list` gives the names in `TOOLS` | `test/build.test.ts` | 1.3 |
| B4 | pack list contains `dist/mcp.js`, nothing under `powers/` or `.kiro/`, nothing outside the allowed set | `test/build.test.ts` | 1.8 |
| B5 | two builds give byte-identical `dist/mcp.js` | `test/build.test.ts` | 1.6 |
| A1 | `plugin.json` fields, kebab-case name, semver, schema URL, keywords, author, repository, homepage, license | `test/kiro-config.test.ts` | 2.2 |
| A2 | `mcp.json` shape and args equal the names in `package.json` | `test/kiro-config.test.ts` | 2.3 |
| A3 | every SKILL.md has front matter `name` (equals folder) and `description`; power holds only the listed files | `test/kiro-config.test.ts` | 2.1, 2.5 |
| A4 | the skills mention required topics as words: `integrate` has `expectEvents`, `listen`, `teach.html`, `npm publish`; `tune-sounds` has `teach`, `score`, `spectrogram`, `background`; `new-app` has the four column names | `test/kiro-config.test.ts` | 2.6 to 2.8 |
| A5 | `sound-tuner.json` fields, tools, permission shapes, `fs_write` matches, no shell allow | `test/kiro-config.test.ts` | 3 |
| A6 | `integrator.json` fields, tools, resources, shell matches | `test/kiro-config.test.ts` | 4 |
| A7 | every `@mcp-ears/x` and `mcp-ears/x` in both agents is in `TOOLS`; server name equals the key in `.kiro/settings/mcp.json` | `test/kiro-config.test.ts` | 3.5, 4.6 |
| A8 | template: three files, template line, one table with the header, all cells placeholders, no real label | `test/kiro-config.test.ts` | 5 |
| A9 | `docs/kiro.md`: four URLs, existing-path rule | `test/kiro-config.test.ts` | 6 |
| A11 | `integrate.md` keeps its front matter, has no "not in the repository" text, and shares the API terms with the `integrate` skill | `test/kiro-config.test.ts` | 9 |
| A10 | negative tests: remove one field from a parsed copy and the validator reports it (one per validator) | `test/kiro-config.test.ts` | 7.3 |

Test mechanics:
- Front matter is parsed by a small function in the test (first `---` block, `key: value` lines), so the project gains no YAML dependency. Values that need more than one line are not used in skill front matter.
- Tool names are imported from `tools/mcp-ears/tools.ts` (`TOOLS.map((t) => t.name)`), so adding a tool does not need a list edit and an agent that names a removed tool fails.
- The existing-path check of `docs/kiro.md` takes every backtick string that contains `/` or ends in `.json`, `.md`, `.ts` or `.js`, strips a trailing `/`, skips strings with `<`, `*`, spaces or `://`, and skips the allow-list `dist/mcp.js` and the `npx` forms. The allow-list is a named constant in the test with a comment per entry.
- B3 copies the built file to `mkdtemp`, spawns it through the SDK's `StdioClientTransport` and `Client`, connects, calls `listTools`, closes, and removes the folder in `finally`. The timeout is `MCP_START_TIMEOUT_MS`.

### Risks and rules
- **Format drift.** Agent Plugins and CLI V3 agents are new. The tests check the fields the operator verified, nothing more, so a schema change shows up as a doc update, not as a false pass. Do not add fields that are not in the facts of the requirements.
- **Dead MCP entry before publish.** The power's `mcp.json` fails until `npm publish`. Every place that mentions it says so. The in-repo `.kiro/settings/mcp.json` is untouched, so nothing in this repository depends on the publish.
- **Bundle size and behaviour.** The bundled server must behave as `npm run mcp` does. B3 lists the tools; the existing mcp-ears tests keep running against `tools/mcp-ears/` source.
- **Over-broad write permission.** `integrator` can write anywhere by design (the user's app can be in any folder). The prompt tells it to change only files for the listed sounds and patterns and to list every file it wrote.
- **Privacy.** No audio leaves the machine in any file of this task. Skills and prompts repeat the two user-facing privacy rules.
- **No live Kiro run.** Everything is checked by structure and by starting the bundled server. Whether Kiro accepts the files is for the operator.

## Measured values
Filled in by the implementer on 2026-11-20.
- Size of `dist/mcp.js`: 1446796 bytes. The `createRequire` banner was not needed: the standalone start (B3) works with the shebang banner alone.
- `isEntryPoint` worked in the bundle without a change, in every start that was run: by real path (`node dist/mcp.js`, B3), through `npx tokk-mcp` (the Windows `.cmd` shim, argv[1] is `node_modules\.bin\..\tokk\dist\mcp.js`) from a temporary folder with the tarball of `npm pack` installed (the server answered `initialize` with the name `mcp-ears`), and through a directory junction (argv[1] unresolved, `import.meta.url` resolved). A file symlink could not be made on this machine (administrator privilege); the code compares `realpathSync` of both sides, which is the case that a symlink needs. The temporary folder was deleted.
- Step 1.3: `test/public-api.test.ts` asserts only `exports` (and the runtime export names), not the whole `package.json`, so it is unchanged.
- Step 1.5: `tsconfig.build.json` includes only `core`, `web` and `node`, so `dist/types` gets no `tools/` files (46 type files in the pack list before and after the change).
- Time of the standalone start test (B3): 126 ms.
- `dist/tokk.js` 188075 bytes before and after; `dist/node.js` 60400 bytes before and after.
- vitest count: 694 passed, 2 todo before; 718 passed, 2 todo after (34 files, 33 before).
- `npm pack --dry-run`: 52 files, the six non-type files are `LICENSE`, `README.md`, `dist/mcp.js`, `dist/node.js`, `dist/tokk.js` and `package.json`; nothing under `powers/` or `.kiro/`.
- Test change named by the spec (requirement 9.5): `test/scripts.test.ts` no longer expects the phrase `plan 2` in `integrate.md`.
- Finding: `npm run test:web` starts `npm run dev`, which empties `dist/` and builds only `tokk.js` and `teach-page.js`. Run `npm run build` again after it before checking the pack list.