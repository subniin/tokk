# Design: Task 21, app bundles, static site and wiring line count

## Layout
```
scripts/build.ts              + findApps(appsDir), appBuildOptions(app, minify), buildApps(appsDir), watchApps(appsDir);
                                buildBundles() and build() also build apps; dev() also watches apps
                              + site build options: exported teachPageOptions, browserPackageOptions (outfile overridable)
scripts/build-site.ts         buildSite({ outDir, appsDir }): the static site                                  [new]
scripts/count-wiring.ts       countWiring(source), collectGroups(root), formatReport(groups, json), main      [new]
scripts/check-public-api.ts   path-resolved internal-folder rule, bare tokk/* rule, .mjs and inline html scripts
site-src/index.html           the landing page                                                                 [new]
teach.html                    relative script URL
examples/hello/index.html     import map + `from 'tokk'`
README.md                     jsDelivr import map, same block as hello, measured line count
apps/README.md                the folder rules of an app                                                       [new]
.github/workflows/pages.yml   Pages deploy                                                                     [new]
.gitignore                    + site/, apps/*/dist/
package.json                  + build:site, count:wiring
tsconfig.web.json             + include apps/*/src, paths tokk -> web/index.ts
.kiro/hooks/public-api-only.json   description only
test/build.test.ts            + app bundle tests (fixture app in a temp folder)
test/build-site.test.ts       site content, relative URLs, landing page, guards                                [new]
test/count-wiring.test.ts     unit tests on small strings, group walk, CLI                                     [new]
test/check-public-api.test.ts the script as a child process on temp trees (or the existing file, see step 1)
test/pages-workflow.test.ts   line-based checks of pages.yml                                                    [new]
test/apps-readme.test.ts      required phrases of apps/README.md and the README/hello block                    [new]
test/helpers/static-site-server.ts + test/static-site-server.test.ts   tiny static server under /tokk/          [new]
test/helpers/fixture-apps.ts  makes the temp apps folder with two fixture apps                                  [new]
test/web/hello-check.ts       shared body of the hello check (moved out of hello.spec.ts)                      [new]
test/web/hello.spec.ts        calls the helper, same title and expectations
test/web/site.spec.ts         E1 to E5 under /tokk/                                                            [new]
docs/devlog.md                one entry
```

## Assumptions (this spec was written without a person to ask)
1. **The hello example imports `tokk` through an import map** (next section). The plan leaves the choice to this spec.
2. **`build:site` does not fail on a landing link to an app that is missing.** The landing page names both apps, as the plan says, and the apps come in Tasks 22 and 23. A hard failure would make `build:site` unusable now, and the plan's completion check needs it to run. The warning (requirement 6.6) and the completion check ("four screens work") keep the dead link from being deployed unnoticed. If the reader wants a hard failure after Task 23, a `--strict` flag is a four-line change, not built now.
3. **`site/` is written directly, not copied from `dist/`.** `npm run test:web` and `npm run dev` empty `dist/`, and `build:site` must not depend on, or disturb, a running dev server. So `build:site` runs esbuild with `outfile` set below the output folder and never touches `dist/`.
4. **Pinned actions use full commit SHAs with the tag in a comment.** "Pinned versions" is the plan's wording. A SHA cannot be moved by the action's owner, a tag can. The implementer must look the values up (no value is guessed here; the web was not reachable when this spec was written).
5. **The names of the task-19 spec folder were not found, so the style is taken from the task-20 spec** (`.kiro/specs/task-20-app-support/`), which the task also named.
6. **The new constants live in `scripts/build.ts` and the tests, not in `core/constants.ts`.** The units rule says to keep thresholds and time constants in `core/constants.ts`. These are not engine values: a port, a name pattern, a timeout of a test. Task 13 put the dev server's host and port in `scripts/build.ts`, and Task 19 kept test timeouts in the tests. This task follows that precedent and names every one with its unit.
7. **A fixture app is real source in a temp folder, not a string in memory.** esbuild reads files, and the test must prove that the alias resolves `tokk` for a file outside the repository.

## How the hello example imports Tokk
The page must load Tokk (a) under `npm run dev` at `/examples/hello/`, (b) under `/tokk/examples/hello/` on Pages, and (c) the README must show the same code with the jsDelivr URL, so the "N lines" claim is about code a reader can paste.

| Option | Under dev and under `/tokk/` | README and the jsDelivr form | Wiring count | Cost |
|---|---|---|---|---|
| A. Relative path in the import line, `../../dist/tokk.js` | Works | The page's line differs from the README's line, so the README block is no longer the page's block. | Counts the path | Two forms of the same line to keep equal by hand. |
| **B. Import map `tokk` -> `../../dist/tokk.js`, import line `from 'tokk'`** | Works (the map's relative URL resolves against the document) | The module block is identical in the page and in the README. Only the one-line map differs (local path versus jsDelivr). | The import line counts. The map is one setup line outside the markers. | The reader sees one extra line. Import maps need Chrome 89, Firefox 108, Safari 16.4. The site targets Chrome, as the plan's tests do. |
| C. A build step that rewrites the import | Works | README and page can differ, and the page in the repo is not what runs | Counts the rewritten line | A transform step for one example, and the dev server serves the source file, so dev needs it too. |

Choice: **B**. The import line reads `from 'tokk'`, exactly as in an app and as with a bundler, and the README's jsDelivr form reads naturally: a one-line import map, then the block. The map is not counted, and the README says so in one sentence. This is also an honest count: a reader who copies the block and the map gets a working page. A test compares the module block of the page and of the README line by line, and a second test reads the count from `countWiring` and checks that the README states it.

An import map must come before the first module script that uses it, and cannot be added after a module has loaded. Both are true on the page: the map is a separate `<script type="importmap">` in the head.

## Findings from reading the code
1. **The dev server builds `dist/tokk.js` for the hello page, and the apps bundle their own copy.** An app's `app.js` contains Tokk, so an app page needs no `dist/tokk.js`. Only `examples/hello/` needs `site/dist/tokk.js`, and only `teach.html` needs `site/dist/teach-page.js`.
2. **esbuild `alias` also rewrites `tokk/<path>`.** `tokk` as an alias key matches `tokk` and `tokk/anything`, so `tokk/node` in a browser app is rewritten to `web/index.ts/node` and fails to resolve. That is the right outcome for a browser app (the Node tools are not for it), and the error names the import. `apps/README.md` says apps import `'tokk'` only. The `check:public-api` rule still allows `tokk/node` because the Node tools of an app (a build script, not the browser bundle) may use it.
3. **`check:public-api` has a bypass.** An app that writes `import { x } from '../../../web/listen'` is bundled without error, and the current script does not see it, because it looks for `core` only. With the alias the app bundle and the library share one source tree, so this is the line the check exists for.
4. **`check:public-api` has a false positive.** A path segment named `core` inside an app's own folder is rejected today. The new rule resolves the path and compares with the repository's top-level folders.
5. **`.gitignore`'s `dist` already ignores `apps/*/dist/`.** The explicit line is documentation, and the `git check-ignore` test proves both.
6. **`examples/hello/sounds/` can hold recordings on the author's machine.** A recursive copy of `examples/hello/` would publish them. The copy uses a deny list, a test puts a `sounds/x.wav` in the fixture and proves it is absent, and E5 checks the real build output tree.
7. **A directory URL needs a trailing slash for relative URLs to work.** `examples/hello/` is correct and `examples/hello` is not (the page's `sounds.json` would resolve to `examples/sounds.json`). GitHub Pages redirects a folder URL without a slash, and the dev server (esbuild) too, but the landing links carry the slash so no redirect is needed. The static test server answers a folder URL without a slash with a redirect, as Pages does, and the test follows it.
8. **Relative URLs in the app bundle.** `tokk.js` makes the Worker and the worklet from Blob URLs built from strings (`web-audio.md`), so the bundle has no URL to a file. The relative-URL test proves it for each built file.
9. **The `webServer` of Playwright starts before the global setup, and `reuseExistingServer` is on.** The site test does not use it. It starts its own server inside the spec, on a free port, so a developer's running `npm run dev` does not matter.
10. **Playwright's Chrome fake microphone plays the fixture WAV once from the moment a stream opens.** The hello check does not depend on the URL, so it works under `/tokk/` as under `/`.
11. **TypeScript 7 `paths` without `baseUrl`.** `paths` entries are relative to the tsconfig, so the mapping `tokk` -> `./web/index.ts` is enough. If the installed compiler does not accept it, step 4 adds `baseUrl` and records why.

## Decisions

### Building apps (`scripts/build.ts`)
- `findApps(appsDir)` lists directories of `appsDir` with a `src/main.ts` and returns their names sorted. It applies the name rule (requirement 1.4), warns for a directory without `src/main.ts`, and returns an empty list for a missing folder. Sorting makes the output order, and the byte-identical test, stable.
- `appBuildOptions(app, { minify, outfile })` returns the shared options of the file, the entry `apps/<name>/src/main.ts`, `platform: 'browser'`, `format: 'esm'`, `alias: { tokk: <absolute web/index.ts> }`, and `plugins: [workerSourcePlugin(minify)]`. `absWorkingDir` stays the repository root, so a fixture app outside the repository resolves `tokk` through the alias and nothing else.
- `buildApps(appsDir)` builds all found apps with `minify` on to `<appsDir>/<name>/dist/app.js`, after removing that `dist/`. It is called by `buildBundles()` in parallel with the existing builds, so `npm run build` stays one step and the two-build byte test of `test/build.test.ts` also covers it.
- `watchApps(appsDir)` creates a context per app (no minify), builds once, starts `watch`, and returns `{ apps, dispose }`. `dev()` calls it after the two existing contexts and before `serve`, and disposes it in `stop`. An app that fails at start fails `dev()` with its name.
- To share the options with `build-site.ts` without a second copy, the existing `BROWSER_PACKAGE_OPTIONS` and `TEACH_PAGE_OPTIONS` are exported, and `build-site.ts` overrides `outfile` and, for the teach page, sets `minify: true`. The plugin instances are made by the functions, so nothing is shared by accident.

### The static site (`scripts/build-site.ts`)
Order of work in `buildSite({ outDir, appsDir })`:
1. Check the guards of requirement 6.2 (resolved paths, no deletion before they pass).
2. Remove `outDir` and create it.
3. Copy `site-src/index.html` and `teach.html`.
4. Build `dist/tokk.js` and `dist/teach-page.js` into `outDir/dist/` (in parallel).
5. Copy `examples/hello/` with the deny list.
6. For each app: copy its folder with the deny list, then build `src/main.ts` to `outDir/apps/<name>/dist/app.js` minified.
7. Check the landing links against the output tree, print warnings, print the file list.

The deny list is one exported constant, with names and extensions: folders `sounds`, `src`, `dist`, `node_modules`, `extension`, `test`; extensions `.wav`, `.ts`, `.tsx`, `.map`, `.md`; any name that starts with a dot. A wav, a TypeScript source and a source map can never reach the site, whatever an app puts beside its `index.html`. `extension` is the Task 24 Chrome extension folder (`apps/hands-free/extension/`), which is not a site file.

The landing check reads the `href` values of `outDir/index.html` and tests that each target folder has an `index.html` (or the file exists). It uses the same simple attribute scan as the relative-URL test, kept in one helper that the test imports.

### The landing page
One file, no script, one inline `<style>` block (the same approach as `examples/hello` and `teach.html`, so there is no second request and no external stylesheet). Colours: text `#1a1a1a` on `#fafafa` (about 16 to 1), links `#1d4ed8` (about 6 to 1), visited `#5b21b6` (about 8 to 1). The focus outline is 3 px `#1a1a1a` with an offset, as on the hello page. No `transition`, no `animation`, `max-width` text column, `padding` in `rem` so 200 per cent zoom and 320 px width do not scroll sideways.

Text:
- `<h1>`: "Tokk".
- Pitch: "Tokk lets a web page react to short sounds, such as a clap, a knock or a tongue click, with the sound model and every recording kept on your device."
- Privacy: "Audio stays on your device. Each page below asks for the microphone only after you press its button."
- Four links with descriptions: "Teach a sound (a developer page that records a sound ten times and writes a sound model)", "Hello example (listen to the microphone and read every sound and pattern as text)", "Hands-Free (browse the web with mouth sounds)", "Knock Once for Yes (answer a ghost's questions by knocking)". The last description is neutral text; the landing page has no Halloween styling (`ui.md`).

The facts in the pitch are the README's. The exact words may be tuned by the implementer within requirement 5, and must stay English.

### Counting wiring (`scripts/count-wiring.ts`)
`countWiring(source)` is a single pass over the lines with three states: outside, inside a block, and inside a block comment (nested inside a block, since a block comment can sit between the markers). Each line is trimmed first. Marker lines are tested before the comment rules, so a marker line is never a "comment line to skip", and is not counted. Rules for a counted line follow requirement 8.3. The result is `{ lines, blocks }`. The error class carries the 1-based line, and the CLI prints `path:line  message`.

`collectGroups(root)` walks `apps/*/src/**` and `examples/**`. The group of a file is `apps/<name>` or `examples/<name>` from its path. A folder that is not a directory, or a file directly in `apps/` or `examples/`, is not a group. The report object is plain data, and `formatReport(groups, json)` returns the text, so tests assert on a string and not on the console. `--json` prints `JSON.stringify` of `{ groups }` with two-space indentation and nothing else, so another script can parse standard output.

A group with no marker block is reported with 0 lines and the text "no markers". This is how the Task 22 and 23 specs will notice a forgotten marker, and why it is not an error: apps exist before they are wired.

### `check:public-api`
The script keeps its shape. Changes:
- `isForbidden(spec, fileDir, root)` replaces `isForbidden(spec)`. A relative specifier is resolved with `path.resolve(fileDir, spec)`, then made relative to `root`; the first path segment is compared with `INTERNAL_DIRS` (`core`, `web`, `node`, `tools`). A specifier that resolves outside `root` is not internal. An absolute specifier (`/...`) is resolved against `root`, not the file system, as the apps' URLs are, so `/core/x` is internal and `/apps/x/y` is not. A Windows drive-letter path is treated as not internal (it is not portable, and the check cannot know).
- Bare specifiers: allowed are `tokk` and `tokk/node`. A `tokk/` followed by anything else is forbidden, as are `core/...`, `web/...`, `node/...` and `tools/...` as bare names. Other packages (a library an app uses, if one ever is) are allowed.
- File types: `.mjs` and `.html` are added. For `.html` only the text inside `<script type="module">` and `</script>` is scanned (a small scanner, no HTML parser). The line number reported is the line in the HTML file.
- Output and exit code unchanged.

Why path resolution and not a regex on segments: a regex on `web` would reject `./web/panel` in an app that has a `web/` folder of its own (a likely name), and would accept `../../../web/listen` only if it looked for `web`. Resolving gives the exact answer in both cases.

### The workflow (`pages.yml`)
Two jobs, `build` and `deploy`. Top-level `permissions` of `contents: read`, `pages: write` and `id-token: write`. Top-level `concurrency` group `pages`, `cancel-in-progress: false`. Triggers `push` to `main` and `workflow_dispatch`.

`build` (runs on `ubuntu-latest`): checkout, setup-node (Node 22 and `cache: npm`), `npm ci`, `npm run build:site`, upload-pages-artifact with `path: site`.
`deploy` (needs `build`): environment `github-pages` with `url: ${{ steps.deployment.outputs.page_url }}`, one step with `actions/deploy-pages` and the id `deployment`.

No test step. Reason, from the plan: tests run locally, and a failure that only happens on Linux CI must not block a deploy close to the judging deadline. The tests that matter for the deploy (the site under `/tokk/`) run locally in `npm run test:web`. `npm ci` needs `package-lock.json` to be committed (step 1 checks; if it is not, stop and report, since `npm ci` fails without it and the fix is the operator's decision).

The deploy needs the repository setting "Pages source: GitHub Actions". **The user switches this on at push time** (Settings, Pages, Build and deployment, Source). Until then, a push runs the build job and the deploy job fails with a message from `actions/deploy-pages`, which does no harm. This task does not push, does not run the workflow and does not change settings. The file is inert before the first push.

Pinned values: the implementer reads the latest release of `actions/checkout`, `actions/setup-node`, `actions/upload-pages-artifact` and `actions/deploy-pages`, copies each full commit SHA, and writes the tag after it as a comment. `upload-pages-artifact` and `deploy-pages` must be a compatible pair (the artifact format changed between major versions), which the implementer checks from their release notes. The values and the date go into "Measured values".

### The static test server (`test/helpers/static-site-server.ts`)
`startSiteServer(rootDir, prefix)` returns `{ url, port, close }`. It uses `node:http`, binds to `DEV_SERVER_HOST` on port 0, maps `prefix + rel` to `rootDir/rel`, answers a folder with its `index.html` (a folder URL without a trailing slash gets a 301 to the slash form), sets `Content-Type` for `.html`, `.js`, `.json`, `.css`, answers `404` for every other path including `/`, rejects a path with `..` after decoding, and records every requested URL path in a list that the test can read. It reads files only and sends nothing off the machine.

### The spec's E2E flow
`site.spec.ts` builds once in `beforeAll` (with a timeout of its own), starts the server, runs E1 to E5, and in `afterAll` closes the server and deletes the temp folders. One Chrome context per test, with the fake microphone arguments of the config. Requests are recorded with `page.on('request')` and compared with the prefix.

## Tests
| Id | File | What it proves |
|---|---|---|
| B1 | `test/build.test.ts` | `buildApps` on a fixture app (temp folder, imports `tokk`) writes `dist/app.js` with the Worker source (`replaceSounds`), `createObjectURL`, `registerProcessor`, no bare `tokk` import, no Node global use |
| B2 | same | the app bundle is at most `MINIFIED_MAX_SHARE_OF_UNMINIFIED` of an unminified build of the same app |
| B3 | same | two builds of the fixture give byte-identical `app.js` |
| B4 | same | missing apps folder gives `[]`; `README.md` and a directory without `main.ts` are skipped (the second with a warning); a bad name throws and names the rule; an unresolved import fails with the app name |
| B5 | same | `watchApps` on a fixture builds once, unminified, rebuilds after an edit (polled with a named timeout), and disposes |
| B6 | `test/build.test.ts` | `git check-ignore` for the four paths of requirement 3.1 |
| S1 | `test/build-site.test.ts` | the output file list equals the expected list exactly (fixture apps, real `examples/hello`, `teach.html`, `site-src`) |
| S2 | same | the deny list: `sounds/x.wav`, `src/main.ts`, `notes.md`, `.hidden`, `extension/` in the fixture are absent; each entry of the list has a case |
| S3 | same | relative-URL scan finds nothing in the output, and finds each bad form in the samples first |
| S4 | same | the landing page: `lang`, title, one `h1`, exactly the four hrefs, no script, no `http`, contrast of the colours in the style block at least 4.5 to 1 (the test parses the hex values), a `:focus-visible` rule, no `transition` or `animation` |
| S5 | same | `hello` and `teach.html` sources: import map to `../../dist/tokk.js`, import line `from 'tokk'` inside the markers, relative script URL, no absolute URL |
| S6 | same | the guards: the repository root, its parent and a folder with `.git` are refused before any deletion; a stale file in the output folder is removed |
| S7 | same | a landing link to a missing app gives one warning and no failure; two builds are byte-identical |
| C1 to C8 | `test/count-wiring.test.ts` | `countWiring` on small strings: plain lines; blank and `//` lines skipped; block comments skipped; trailing comment counts; several blocks add up; CRLF equals LF; each malformed form throws with its line; marker with indentation and trailing text |
| C9 | same | `collectGroups` on a temp tree: kinds, names, sort order, skipped folders and extensions, a group without markers, html inside `examples/` |
| C10 | same | the CLI as a child process: text output; `--json` prints parseable JSON only; a malformed file exits 1 with `path:line` |
| C11 | same | the real repository: `examples/hello` has the count that `countWiring` gives for its text |
| P1 | `test/pages-workflow.test.ts` | triggers, permissions, concurrency, the step order, `path: site`, the deploy environment, no test step, each `uses:` with a 40-hex SHA and a tag comment; each rule fails on a broken sample first |
| A1 | `test/check-public-api.test.ts` | the child-process cases of requirement 11.6 |
| R1 | `test/apps-readme.test.ts` | each required phrase of `apps/README.md`; the README block equals the hello block; the README states the measured count |
| T1 | same or `build.test.ts` | `tsconfig.web.json` includes `apps/*/src` and maps `tokk` |
| H1 | `test/static-site-server.test.ts` | traversal refused, 404 outside the prefix and at `/`, folder index, redirect for a folder without a slash, content types |
| E1 to E5 | `test/web/site.spec.ts` | requirement 12 |

## Changed tests
- `test/check-public-api.test.ts` (or the file that tests the script; step 1 finds it): the case that expected a path segment `core` inside an app's own folder to fail changes to the new rule (resolved path). Any case that expected `../../core/x` to fail stays and still fails, because that path resolves to the repository's `core/` when the app is at `apps/<name>/src/`. A case that has a different depth is rewritten with its resolved target in the title.
- `test/web/hello.spec.ts`: the body moves to `test/web/hello-check.ts`. Title and expectations stay.
- `test/hello-example.test.ts` (named by requirement 4.8, approved by the operator on 2026-11-20; these three tests conflict with requirements 4.2, 4.4 and 13.2 and could not stay unchanged):
  - H3: `PAGE_IMPORT` changes from the path `/dist/tokk.js` to the specifier `tokk`; the check now expects an import line `from 'tokk'` inside the markers and, outside them, an import map `tokk` -> `../../dist/tokk.js`.
  - H4: the README block and the page block are now expected to be equal line by line (before: equal except the import specifier).
  - D1: the README prose may contain exactly one match of "N lines" where N equals `countWiring` of `examples/hello/index.html`; every other number before minutes, seconds or lines is still rejected (the check still fails on its two bad samples, and on a wrong N).
- `docs/kiro.md` got one table row for this spec, because `test/kiro-config.test.ts` (A9) fails when a spec folder is not listed (the same cause as in Task 20). The test is unchanged.
- No other existing test changes. The hello example's change is covered by `hello.spec.ts` as it is.

## Risks
- **A dead landing link can be deployed** until Tasks 22 and 23 are done. Mitigated by the warning and by the plan's completion check. The operator should read the `build:site` output before the first push.
- **Pinned SHAs go stale.** Intended. A later task can update them.
- **Import maps** need a current browser. The README says the example needs a browser with import maps.
- **`site/` and `apps/*/dist/` can hold large files after Task 22 and 23** if an app puts big assets beside `index.html`. The file list with sizes printed by `build:site` makes this visible.
- **Dev server and `build:site` at the same time** do not interfere (no shared output).

## Measured values (the implementer fills these in)
- Facts of the Introduction that differed from the code, if any.
- `package-lock.json` present: yes or no.
- Size of `site/` built with the two fixture apps and without apps, in bytes, and the size of `dist/tokk.js` and `dist/teach-page.js` in the site.
- Time of `npm run build:site` in seconds, with and without apps.
- The minified share of the fixture app against an unminified build, as a ratio.
- The wiring count of `examples/hello`, and the number that the README states.
- The four action tags and SHAs, and the date they were read.
- Whether `paths` needed `baseUrl` (finding 11).
- The vitest count and the Playwright count before and after.

## Measured values (filled in 2026-11-20)
- **Facts of the Introduction that differed:** none that changed the design. `git check-ignore -v apps/x/dist/app.js` matched `.gitignore:2 dist`. `site/index.html` was not ignored before step 4.3. `apps/` and `site-src/` did not exist. `teach.html` had `src="/dist/teach-page.js"` and the hello page imported `'/dist/tokk.js'`. A search of `web/teach-page.ts`, `web/teach-ui/` and `web/overlay/` for a string that starts with `/` or a scheme found only comments and no URL, so requirement 7 needed no source change there.
- **`package-lock.json` present:** yes, and tracked.
- **Before values (step 1.1):** `npm test` 777 passed, 1 failed (`test/kiro-config.test.ts` A9: `docs/kiro.md` did not list `task-21-site`, the same cause as in Task 20, fixed by one table row in `docs/kiro.md`), 2 todo, 74 s; `npm run test:web` 39 passed, 4.1 min; the three type checks, `npm run build` and `npm run check:public-api` passed. **After:** `npm test` 842 passed, 2 todo (46 files), 68 s, and 842 passed with `PBT_RUNS=1000` (605 s); `npm run pbt:quick` 144 passed, 2 todo; `npm run test:web` 44 passed, twice (4.2 min each); the three type checks and `npm run check:public-api` clean.
- **Site size (the default build, no apps):** 6 files, 249196 bytes: `dist/tokk.js` 100497, `dist/teach-page.js` 114336, `teach.html` 4620, `examples/hello/index.html` 1946, `examples/hello/sounds.json` 26468, `index.html` 1329. With the two fixture apps: 447498 bytes.
- **Time of `npm run build:site`:** 0.67 s with no apps (wall time of the npm command), 101 ms inside `buildSite` with the two fixture apps.
- **Minified share of the fixture app against an unminified build:** 98942 / 194082 = 0.510 (limit in the test: 0.75).
- **Wiring count:** `npm run count:wiring` gives 7 lines for `examples/hello` (one block). The README states "7 lines of Tokk code". The Task 19 devlog said 8 lines; the script is the only source now and gives 7 (the import line, `show`, `on`, `start.onclick`, `try`, `catch` and `};`).
- **Pinned actions (operator-supplied, not looked up or verified by the implementer).** The operator ran `git ls-remote --tags https://github.com/actions/<name>` for each action on 2026-11-20 and gave these values; the implementer was told not to fetch them. The implementer did not check the release notes, so the compatibility of the `upload-pages-artifact` v5.0.0 and `deploy-pages` v5.0.1 pair is the operator's statement, not a check made here. `actions/configure-pages` is not used.

  | Action | Tag | Commit SHA |
  |---|---|---|
  | actions/checkout | v7.0.1 | 3d3c42e5aac5ba805825da76410c181273ba90b1 |
  | actions/setup-node | v7.1.0 | 949feb2413d6458794dcd2491c4babbbce0c15c1 |
  | actions/upload-pages-artifact | v5.0.0 | fc324d3547104276b827a68afc52ff2a11cc49c9 |
  | actions/deploy-pages | v5.0.1 | 368f82528645a54fb793d4d04e342629a3f51346 |

  Lookup command: `git ls-remote --tags https://github.com/actions/checkout` (and the same for the other three), then the commit that the tag points to (the `^{}` line for an annotated tag). `test/pages-workflow.test.ts` pins the table above, so a changed SHA fails the test.
- **`paths` needed `baseUrl`:** no. `"paths": { "tokk": ["./web/index.ts"] }` in `tsconfig.web.json` resolves `import { listen } from 'tokk'` in a file outside the repository (checked with a temporary tsconfig that extends it, deleted afterwards).

## Differences from the spec as written (found while implementing)
- **The favicon.** Chrome asks for `/favicon.ico` by itself on the first page of a context. The static test server first answered 404 (as the spec says for every path outside `/tokk/`), which logged a console error on every page. esbuild's dev server answers that request, which is why the existing hello test never saw it. The test server now answers `/favicon.ico` with 204 and the E-tests ignore that one path (`FAVICON_PATH`). Every other path outside the prefix still gives 404. No page of the site was changed for this.
- **Existing tests changed**, as named in "Changed tests": `H3`, `H4`, `D1` of `test/hello-example.test.ts` (approved by the operator on 2026-11-20), and `test/web/hello.spec.ts` (body moved). `test/scripts.test.ts` needed no change: its two `check-public-api` cases still pass, and the new cases are in `test/check-public-api.test.ts`.
- **New test names added beyond the table:** `M3` in `test/package-meta.test.ts` (the scripts and the unchanged `files` list).
- **`check-public-api` rule for a drive-letter path** (`C:/core/x`) is "not internal", as designed; it has no test because the bare-name rule never matches it either.
