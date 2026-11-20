# Requirements: Task 27, README

## Introduction
Task 27 rewrites `README.md`, the first page a judge reads. The README must say plainly what works and what has not been checked, and every number in it must come from `docs/integration.md` or `npm run count:wiring`. Tasks 25, 26 and 30 are committed.

| Consumer | What it uses from this task |
|---|---|
| Judges, developers | The first page of the repository and of the npm package. |
| Task 28 (submission texts) | Take numbers from the README, which takes them from `docs/integration.md`. |

## Requirements
1. `README.md` is in English. It starts with `# Tokk` and one plain paragraph that says what Tokk is and what it is made of. It has no badge, emoji, logo, third-party logo or marketing word.
2. Every `##` heading is numbered `## N. Title` in order from 1, and every `###` heading is numbered `### N.M Title`.
3. The numbered sections come in this order: 1 Current status, 2 Teach your sounds (the picture and the steps), 3 Hello example, 4 Demo video, 5 Two apps and a third case, 6 How it works, 7 Repository layout (with set-up steps), 8 Make a new app from this template, 9 Node tools and MCP server, 10 Kiro, 11 Third-party components and licences, 12 Privacy, 13 What is next, 14 Known limits and common problems, 15 Licence.
4. Current status says that all recognition tests use synthetic sounds and Chrome's fake microphone, and that real-microphone checks, the demo video, the GitHub Pages site and the npm package are pending.
5. The picture is a file under `docs/images/` that exists. It is the debug overlay and the text says so.
6. The hello example keeps the fenced `tokk:start` / `tokk:end` block equal to `examples/hello/index.html`, the jsDelivr import map block, the sentence "N lines of Tokk code" with N from `count:wiring`, and the sentences that the tests of Tasks 19 and 21 pin.
7. The line "Demo video: coming with the submission." is present. The site URL `https://subniin.github.io/tokk/` is written with the statement that it is not deployed yet. The CDN import map and `npx tokk-mcp` are described as working after publish.
8. A table lists the two apps and the third case with screenshot link, sounds, wiring lines, time and credits. The wiring numbers equal `count:wiring`. Time and credits equal `docs/integration.md`. A measured-numbers table lists the four wiring groups, and says what was not measured.
9. The reveal.js credit names the author, the version, the MIT licence, the home page and `cases/slides/LICENSE-revealjs.txt`.
10. How it works gives the flow microphone, AudioWorklet, Worker, segmenter, features, kNN, matcher, and the pattern rule: wait while a longer pattern can still extend a match, otherwise fire at once.
11. The layout section has one fenced tree of the top-level folders with a comment after each entry, and a list of what each layer may and may not import.
12. The pattern table of an app is a TypeScript object (`on`), never YAML.
13. The third-party table lists every package in `package.json` with its exact version and licence, and says where it ends up (build tool, test tool, bundled in `dist/mcp.js`, bundled in the site).
14. Setup steps are numbered lists. Commands are in their own fenced blocks. Where PowerShell and bash differ, there is one block each, marked `# Windows PowerShell` and `# bash`.
15. The last numbered section lists known limits and common problems: the calibration window, a repeated sound read as unknown, HTTPS and a user gesture for the microphone, and import maps.
16. The README has no `TODO` and no `TBD`, no e-mail address, and every relative link points to an existing file or folder.
17. `test/readme.test.ts` checks requirements 2, 8 (numbers), 13, 16 and the presence of the items of 4, 7, 9 and 12. It runs before the README is rewritten and fails first.
18. `apps/README.md` and `docs/kiro.md` change only where Task 27 requires it. `docs/kiro.md` has one row for this spec. `docs/devlog.md` has one line dated 2026-11-21.
19. Out of scope: code, `docs/_planning/`, other specs, the site landing page, any publish or push.
