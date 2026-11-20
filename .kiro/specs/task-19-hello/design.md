# Design: Task 19, hello example, README and npm package preparation

## Layout
```
examples/hello/index.html        the page, 10 lines of Tokk code between two marker comments
examples/hello/sounds.json       synthetic model (feature vectors only)
README.md                        English, short
package.json                     metadata, prepack, engines
scripts/build.ts                 minify option for the package build (not for dev)
.gitignore                       only if examples/hello/sounds/ is not yet ignored
test/web/hello.spec.ts           Playwright, fake microphone
test/hello-example.test.ts       vitest: marker lines, README match, model checks
test/package-meta.test.ts        vitest: package.json fields, prepack, versions
test/build.test.ts               named updates for minification, examples/ forbidden in the pack list, --ignore-scripts
docs/devlog.md                   one line
```
Nothing else changes. The page imports `/dist/tokk.js`, which `npm run dev` builds and serves from the repository root.

## Assumptions (this spec was written without a person to ask)
1. **The marker comments are `// tokk:start` and `// tokk:end`** inside the module script. A line count between markers is the check design 9 asks for ("lines of connection code").
2. **The import line counts** in the 10 lines. It is the honest count of what a developer writes.
3. **Metadata values come from the request:** `0.1.0`, MIT, author `subniin`, the three GitHub URLs, `engines.node` `>=20`. The description and the keyword list are written here and can be changed by the operator before publish.
4. **`homepage` is the README anchor** `https://github.com/subniin/tokk#readme`, and `bugs.url` is the issues page. Both are standard npm forms.
5. **`teach.html` writes into `<project>/sounds/` and `<project>/sounds.json`** (Task 17, "Where sounds.json goes"). Picking `examples/hello` as the project folder therefore replaces `examples/hello/sounds.json` next to the page, which is what the page loads.
6. **The README is the only place for the CDN form.** The page itself uses the local import.
7. **The two README placeholders and the page notice are plain text lines**, marked `pending`, so no image or video file is needed now.

## Findings from reading the code
1. **`listen()` is the event source.** The page needs recognised sounds and pattern matches as text. Step 1 reads `web/listen.ts`, `web/index.ts` and the `Handlers` type to see which callbacks exist. The design uses `on` handlers only: one handler per single-sound pattern and per chosen pattern, each writing one line. If `on` cannot express "every recognised sound" in 10 lines, a loop over the labels of the loaded model builds the `on` object. Nothing in `web/` changes; if the API lacks what the page needs, stop and report instead of changing `web/`.
2. **A short pattern that is a prefix of a longer one fires late.** The engine waits to see whether the longer pattern continues (integrate steering). With single-sound handlers next to a two-sound pattern, the single-sound line can come after the wait. The Playwright test waits for the pattern line with a named timeout, not for an exact order of lines.
3. **`npm pack` and `npm publish` run `prepack`.** With `"prepack": "npm run build"`, the current pack test (`npm pack --dry-run --json`) would rebuild and empty `dist/` in the middle of a vitest run, while other test files read `dist/`, and build output on the standard output could break `JSON.parse`. The pack test therefore passes `--ignore-scripts`, and a separate test shows that `prepack` exists. `npm publish --dry-run` is run by hand after a clean build.
4. **Minification and the existing build assertions.** esbuild minification does not rename strings or object property names, so the protocol strings, `registerProcessor` and the processor name stay. It can change: the spacing and shape of the Worker IIFE (the regex in the Worker test expects `(() => {` and `})();` with optional spaces, which `(()=>{...})();` fits), local names the Node global scan reads (a minified local named like a Node global is not a use of it; the scan must still catch `process.env.X` and `require(`), and the number of `import` lines (none expected). The implementer runs the suite after the change and updates only what the text change broke, with a named comment and with a check that the guard still fails on a broken input.
5. **Recordings and `.gitignore`.** `teach.html` writes `examples/hello/sounds/<name>/*.wav` when used. Step 1 reads `.gitignore`. If those WAV files would be tracked, an ignore line for `examples/hello/sounds/` is added. This keeps recordings local (privacy rule) and keeps the package list unchanged (`examples/` is not in `files`).
6. **The synthetic model must match the fake microphone's rate.** The Task 14 fake-microphone fixture is a WAV at a fixed rate, and its test builds a model at that rate inside the test (plan 2, Task 14). `fixtures/audio/synth/sounds.json` may be at another rate. Step 1 reads `test/web/paths.ts`, `test/web/fixture.ts` and `test/web/global-setup.ts` to find the rate and the fixture's label sequence. The hello model is built at that rate from the synthetic sound recordings with `teachFromDir` or the same synthesis the global setup uses, written to a temporary folder outside the repository (or `tmp` inside it, deleted afterwards), and only the resulting `sounds.json` is copied to `examples/hello/`.

## Decisions

### Patterns of the example
Step 1 reads the label sequence of the fake-microphone fixture and its spacing. The page uses:
- one single-sound pattern per label of the fixture (the recognised sounds as text);
- one pattern that matches the first part of the sequence with the gap rules of the grammar (gap below 350 ms: sounds joined by a space; rest of 350 to 1000 ms: `_`), so the Playwright test has a match to wait for. The synthetic fixtures use 700 ms spacing, which is a rest, so the pattern is written with `_` (the integrator agent run in `docs/kiro.md` found the same).

The exact text is fixed in step 3 by the first passing test. The design rule is only: at most 10 lines, every handler writes text into one live region, no handler uses colour alone.

### The page
- A heading, one paragraph that says the model is synthetic and how to replace it (requirement 1.5), one `<button>`, one `<ul>` or `<pre>` with `aria-live="polite"` for results, one `<p>` for an error.
- Plain CSS in a `<style>` block: system font, dark text on a light background of at least 4.5 to 1, a visible `:focus-visible` outline, no transition, no animation. The debug panel is mounted by `debug: true` and brings its own Shadow DOM styles.
- The Tokk code, as a sketch of its shape (not code to copy): marker; import `listen` and `loadSounds` from `/dist/tokk.js`; build the `on` object from the labels and the pattern; on the button click, `await listen({ sounds, on, debug: true })`; marker. The error text for a rejection is one more line, or code outside the markers that holds no Tokk call (requirement 1.7).

### Minification
| Option | For | Against |
|---|---|---|
| **Minify `tokk.js` and `mcp.js`, keep `node.js` readable** | `tokk.js` is loaded by browsers from a CDN and `mcp.js` carries the bundled SDK and zod, so both are the large ones and nobody reads them; `node.js` is small and users of `tokk/node` get readable stack traces | `node.js` stays slightly larger than it could be |
| Minify all three | smallest package | readable errors lost where they help most, for little gain on the small file |
| Minify nothing | nothing to update in the tests | the browser file and the SDK file stay large |

Chosen: the first. Mechanism: `scripts/build.ts` gets a `minify` flag on the package build options for the browser bundle, the MCP bundle and the Worker bundle that is put into the browser bundle; the dev options (`dev()`) keep `minify: false`. `legalComments: 'none'` stays. Whether `bundleWorker()` needs a parameter or reads a module-level setting is left to the implementer, with the rule that `bundleWorkerSource()` (used by the tests) and the plugin (used by the build) return the same text for the same mode, so the factory test that compares the Blob content to `bundleWorkerSource()` stays true.

Source maps: not written. The existing test asserts that `dist/tokk.js.map` does not exist and `sourcemap: false` is set. To answer "unless small", step 5 builds once into a temporary folder with an external map, notes the byte size, and deletes it. A map of roughly the size of the bundle or more is not shipped. If the map were small (the operator's rule of thumb: under 10% of the minified file), shipping would still need `files`, `//# sourceMappingURL` lines and a changed test; that is a separate decision for the operator, so this task only records the number.

### package.json
Fields as in requirement 3.1. Field order follows the existing file and npm's usual order (name, version, description, keywords, homepage, bugs, repository, author, license, then the existing fields). `scripts.prepack` goes next to `build`. No other script changes.

### README outline
1. Title and pitch (one line).
2. Example: the 10 lines, a sentence on the CDN form and the local run, the synthetic-model notice.
3. Teach your own sounds: the numbered `teach.html` steps (requirement 4.3).
4. Node and MCP: the `teachFromDir` / `expectEvents` lines and the four MCP tools.
5. Kiro: one sentence and the `docs/kiro.md` link.
6. Privacy.
7. Known limits.
8. Media and measurements: placeholders (GIF, video, teaching time, lines of code), each marked pending.
9. License.
Target length: one screen per section at most; no table beyond the MCP tools if any.

### Tests
| # | Test | Where | Requirement |
|---|---|---|---|
| H1 | fake microphone shows the fixture pattern as text; debug host exists; no request leaves localhost | `test/web/hello.spec.ts` | 1.4, 1.8, 6.1 |
| H2 | markers once each, in order, inside a module script | `test/hello-example.test.ts` | 1.2, 6.2 |
| H3 | at most `HELLO_MAX_TOKK_LINES` non-empty lines; negative copies (11 lines, missing marker) are rejected | `test/hello-example.test.ts` | 1.2, 6.3 |
| H4 | README example equals the page code except the import specifier | `test/hello-example.test.ts` | 4.2 |
| H5 | button text, `synthetic`, `teach.html` in page and README | `test/hello-example.test.ts` | 1.5, 4.9 |
| H6 | `sounds.json`: version accepted, labels in the synthetic set, rate of the fake microphone fixture, no sample or WAV field | `test/hello-example.test.ts` | 2 |
| M1 | metadata fields, `prepack`, `engines`, no `dependencies`, version equals `plugin.json` | `test/package-meta.test.ts` | 3, 6.4 |
| M2 | negative: one field removed from a copy is reported | `test/package-meta.test.ts` | 6.4 |
| B6 | pack list: only the allowed files, `examples/` forbidden, run with `--ignore-scripts` | `test/build.test.ts` | 3.5, 6.5 |
| B7 | named updates for minified output; Node global scan still catches `process.env.X` and `require(`; the Worker shape test and the string checks still pass | `test/build.test.ts` | 5.7 |
| D1 | optional: README has no number before `minute(s)`, `second(s)`, `lines` outside code blocks | `test/hello-example.test.ts` | 6.6 |

Test mechanics:
- The marker function takes the page text and returns the code lines or an error; the real page and the broken copies go through it.
- The README example is read from the first fenced block that contains `tokk:start`; the import line is the only line allowed to differ, and it must be the jsDelivr form.
- Paths and the fixture rate come from `test/web/paths.ts` and `test/web/fixture.ts`, not from copies of numbers.
- The Playwright test waits for the pattern text with a named timeout (`HELLO_PATTERN_WAIT_MS`) and the clicks use the accessible name of the button.
- H6 compares labels with the label set of `fixtures/audio/synth/sounds.json`; it does not regenerate the model (the numbers are the result of the build step, see the cross-engine note of Task 17).

### Risks and rules
- **Ten lines and honesty.** The line count excludes comments of the markers only. A trick such as long lines that hold several statements is not in the spirit; the test counts non-empty lines and the README repeats the same text. Keep one statement per line.
- **Dead links before publish.** The CDN import, `npm install tokk`, the `tokk-mcp` bin and the GitHub URLs do not work yet. Every place that shows them says "after publish" or is a metadata field. The README must not say the package is published.
- **A synthetic model teaches little.** A real microphone will not match synthetic sounds. The page and the README say so and give the way to replace the model.
- **Stale `dist/` before pack or publish.** `prepack` fixes it. The pack test avoids the hook on purpose.
- **Minified output hides a regression.** The Node global scan and the string checks keep running on the minified text; negative checks prove that they still fail.
- **Privacy.** No audio, sample or model leaves the machine in any file of this task. The page requests only its own script and model from the dev server.
- **No live publish.** `npm publish --dry-run` only, output recorded.

## Measured values
Measured while implementing (2026-11-20).

- **Sizes before, in bytes** (unminified, version 1.0.0): `dist/tokk.js` 188075, `dist/node.js` 60400, `dist/mcp.js` 1446796; `npm pack --dry-run` package size 328.0 kB, unpacked 1.7 MB, 52 files.
- **Sizes after, in bytes** (version 0.1.0): `dist/tokk.js` 95859, `dist/node.js` 60400 (unchanged), `dist/mcp.js` 774735; package size 247.7 kB, unpacked size 973.9 kB, 52 files. The file list is unchanged apart from sizes (no `examples/`).
- **External source maps, not shipped** (minified build in a temporary folder, deleted): `tokk.js.map` 352027 bytes (about 3.6 times the minified file of 95859 bytes; the temporary build was 133703 bytes because its Worker source was not minified), `mcp.js.map` 2549675 bytes (about 3.3 times the 774715-byte file). Far above the 10% rule of thumb, so no maps.
- **Fake-microphone fixture** (`test/web/fixture.ts`): sample rate 48000 Hz, labels `low`, `mid`, `high`, `ring` in that order, impacts start 800 ms apart (`WEB_TEST_IMPACT_SPACING_MS`), lead 1000 + margin + 500 ms. With the fixture model the Node engine gives events at 1.70, 2.50, 3.29 and 4.09 s.
- **Patterns of the example:** `low`, `mid`, `high`, `ring` and `low _ mid`. On the fixture the page shows `low _ mid at 2.50 s`, `high at 3.29 s` and `ring at 4.09 s`; `low` and `mid` alone are held back by the longer pattern (finding 2), so they do not appear as separate lines.
- **`examples/hello/sounds.json`:** built with a temporary script (deleted) that wrote 10 synthetic copies per label at 48000 Hz with the same synthesis as `test/web/fixture.ts` (`makeSignal`, seeds 31000 + 1000 per label) into a temporary folder, ran `teachFromDir` and kept only the resulting JSON. 26468 bytes, 40 examples, labels `high`, `low`, `mid`, `ring`, leave-one-out accuracy 1 for each. The path through `fixtures/audio/synth/sounds/` was not used because that set is at 16000 Hz, not the fixture rate.
- **`.gitignore`:** yes, `examples/hello/sounds/` was added.
- **Tokk lines between the markers:** 8 (limit 10).
- **Callbacks of `listen()`:** `on` (one handler per pattern, called with a `MatchEvent` that has `pattern` and `t`), `modes` and `mode`, `source`, `sounds`, `debug`, `storageKey`. The page uses `on` only, built from a list of patterns. Nothing in `web/` changed.
- **`test/build.test.ts` assertions that needed a named update after minification:** none. The Node global scan, the Worker shape test and the string checks passed on the minified output unchanged. Added instead: the `--ignore-scripts` pack test with `examples/` forbidden, and a minification group (`dist/tokk.js` and `dist/mcp.js` under `MINIFIED_MAX_SHARE_OF_UNMINIFIED` of an unminified build, `dist/node.js` equal to an unminified build, a minified Worker source check). The scan itself was not weakened, so its negative cases are the existing ones in `test/helpers`.
- **`bundleWorkerSource(minify = false)` and `workerSourcePlugin(minify = false)`** default to the same mode, so the factory test still compares like with like; the package build passes `true`.
- **Optional README number test (D1):** added; the regular expression is one line.
- **vitest count:** before 717 passed, 1 failed (`test/kiro-config.test.ts` A9, because `docs/kiro.md` did not list the new spec folder), 2 todo; after 732 passed, 2 todo. `docs/kiro.md` got one table row for `task-19-hello` (outside the Layout list, needed for A9). `npm run test:web`: 27 passed, twice. `npm run pbt:quick`: 143 passed, 2 todo.
- **Dev server check:** `npm run dev` started once, `/examples/hello/` answered 200 with the button present and no console error, server stopped.
- **`npm publish --dry-run`** (ran `prepack`, which ran `npm run build`): `tokk@0.1.0`, package size 247.7 kB, unpacked size 973.9 kB, 52 files (LICENSE, README.md 2.9kB, `dist/mcp.js` 774.7kB, `dist/node.js` 60.4kB, `dist/tokk.js` 95.9kB, `dist/types/**`, package.json 2.4kB). Output also had: `npm warn publish npm auto-corrected some errors in your package.json` and `"bin[tokk-mcp]" script name dist/mcp.js was invalid and removed`; and `This command requires you to be logged in` (dry-run, no login done). **Open decision for the operator:** the warning goes away when `bin` is `"dist/mcp.js"` without `./` (checked once, then reverted). Requirement 3.3 and `test/build.test.ts` B2 both fix `bin` as `./dist/mcp.js`, so it was left unchanged; changing it needs those two to change too.