# Requirements: Task 21, app bundles, static site and wiring line count

## Introduction
Task 21 is the second task of plan 3 (two apps). Task 22 (Hands-Free) and Task 23 (Knock Once for Yes) will live in `apps/<name>/`, import only the public API `tokk`, and ship as a static site on GitHub Pages under `https://subniin.github.io/tokk/`. This task builds the frame they are made in, before the first app exists, so that both apps are built, measured and published the same way from their first commit:

1. A build step that bundles every `apps/<name>/src/main.ts` to `apps/<name>/dist/app.js` with the alias `tokk` to `web/index.ts`, minified like `dist/tokk.js`, and a dev server that serves the apps the same way.
2. `npm run build:site`, which assembles the static site in `site/`: a landing page, `teach.html`, `examples/hello/`, every app and the `dist` files they need. Every URL is relative, so the site works under `/tokk/`.
3. `npm run count:wiring`, which counts the Tokk wiring lines of every app and example between `// tokk:start` and `// tokk:end`.
4. `.github/workflows/pages.yml`, which deploys `site/` to GitHub Pages. It does nothing until the operator pushes.
5. `apps/README.md`, the folder rules of an app.
6. A stronger `check:public-api`, so that it still rejects internal imports now that apps are bundled against `web/index.ts`.

No app exists yet. Every test of this task uses a fixture app in a temporary folder or a test folder and never writes under `apps/`.

| Consumer | What it uses from this task |
|---|---|
| Task 22 (Hands-Free) | `apps/hands-free/src/main.ts` and `index.html` are bundled and served by `npm run dev`, listed on the landing page, copied by `build:site`, and counted by `count:wiring`. |
| Task 23 (Knock Once for Yes) | The same for `apps/knock-once/`. |
| Plan 3 completion check | `npm run count:wiring` gives the measured wiring lines. `build:site` served under `/tokk/` opens the four screens. |
| The operator (push, Pages) | `pages.yml` and the Pages setting. Pushing and deploying are the operator's, not this task's. |
| README, `docs/integration.md` (later) | The hello example and the README snippet that say "ten lines" stay true (requirement 4). |

Facts checked before this spec was written (step 1 of the tasks checks them again):
- `scripts/build.ts` exports `DEV_SERVER_HOST` and `DEV_SERVER_PORT`, bundles `web/index.ts` to `dist/tokk.js` (minified in `npm run build`, with the Worker source embedded by `workerSourcePlugin`), bundles `node/index.ts` and `tools/mcp-ears/server.ts`, and emits declarations with `tsc`. `npm run dev` removes `dist/`, runs one esbuild context for `dist/tokk.js` and one for `dist/teach-page.js`, both in watch mode and not minified, and serves the repository root with `ctx.serve`. The package build does not write `teach-page.js`. The script writes below `dist/` only.
- `.gitignore` lists `dist` without a leading slash, which Git matches at every depth, so `apps/*/dist/` is probably ignored already. It does not list `site/`. `package.json` `files` is a whitelist (`dist`, `README.md`, `LICENSE`), and `test/build.test.ts` checks `npm pack --dry-run`, so neither `apps/` nor `site/` can enter the package.
- `examples/hello/index.html` has its Tokk code between `// tokk:start` and `// tokk:end` inside a module script, imports `from '/dist/tokk.js'` (an absolute path, which fails under `/tokk/`), and loads `loadSounds('sounds.json')` (relative, fine). `README.md` shows the same block with the import `from 'https://cdn.jsdelivr.net/npm/tokk/+esm'` and says "Ten lines of Tokk code". `examples/hello/sounds/` is git-ignored and may hold local recordings.
- `teach.html` loads `<script type="module" src="/dist/teach-page.js">` (absolute). `paths.ts` has `DEV_TEACH_PAGE_URL` `/teach.html`. `test/web/hello.spec.ts` opens `/examples/hello/index.html` on the dev server and expects the pattern `low _ mid` and the sound `ring` as text, the debug overlay, no error and no request that leaves the origin.
- `playwright.config.ts` starts `npm run dev` as its web server on `localhost:5173`, with `workers: 1`, Chrome's fake microphone and the fixture WAV from `test/web/generated/`.
- `scripts/check-public-api.ts` scans `apps/` for `.ts`, `.tsx` and `.js` files (skipping `node_modules` and `dist`). It forbids `tokk/core` and `tokk/core/...`, and a relative or absolute specifier that has a path segment `core`. It does not forbid a path into `web/`, which was harmless before and is a bypass now that an app is bundled against `web/index.ts`. A relative path through an app's own folder named `core` is a false positive. The hook `.kiro/hooks/public-api-only.json` runs the check on save for files under `apps/`.
- `ui.md` applies to the landing page: English text, a visible focus outline, contrast of at least 4.5 to 1, no animation or transition, every result as text.
- `apps/` and `site-src/` do not exist yet (step 1 confirms).

## Requirements

### Requirement 1: App bundles in the build
**User story:** As an app developer, I want my app's source to import exactly `'tokk'`, as a user of the package does, and still be bundled against this repository's source.

#### Acceptance Criteria
1. `scripts/build.ts` SHALL find every folder `apps/<name>/` that has a file `src/main.ts` and bundle that file to `apps/<name>/dist/app.js` as one ES module for the browser. THE esbuild option `alias` SHALL map the package name `tokk` to `web/index.ts` (an absolute path). The app source SHALL NOT need a relative path or a path option to reach Tokk.
2. THE package build (`npm run build`) SHALL bundle the apps minified, in the same way as `dist/tokk.js`: `minify` on, `workerSourcePlugin(true)` (so the Worker and the worklet sources are inside the file and minified), the shared options of the file (`target`, `legalComments`, no source map). The result SHALL NOT contain a bare import of `tokk`, a Node global use (`findNodeGlobalUse`), `node:`, `fs` or `require`.
3. THE two builds of the same sources SHALL give byte-identical `app.js` files, as for `dist/tokk.js`.
4. THE function that builds apps SHALL take the folder that holds the apps as an argument with the default `apps/` of the repository, and SHALL return the list of apps it built. A missing folder SHALL give an empty list and no error. A folder entry that is not a directory (such as `apps/README.md`), or a directory without `src/main.ts`, SHALL be skipped, and the second case SHALL write one warning that names the directory. An app directory name SHALL match lowercase letters, digits and hyphens only, so it is safe in a URL and a path. Another name SHALL throw an `Error` that names it and the rule.
5. WHEN `npm run build` runs with no `apps/` folder, it SHALL behave and print as it does today, and every existing test of `test/build.test.ts` SHALL pass unchanged.
6. `npm run build` SHALL remove the `dist/` of each app it is about to build before writing it, as it does for the repository's `dist/`, so no stale file stays.
7. A build error in an app (for example an import that cannot be resolved) SHALL fail the build with a message that names the app, as the existing `Build failed:` line does. THE build SHALL NOT continue to the next app silently.
8. THE build SHALL write only below `dist/`, `apps/<name>/dist/` and (requirement 6) `site/`, and SHALL send nothing over the network.
9. THE source of an app SHALL be type-checked with the same alias: `tsconfig.web.json` SHALL include `apps/*/src/**/*.ts` and SHALL map `tokk` to `web/index.ts` with `paths`, so `import ... from 'tokk'` has types from the first app on. THE three type checks (`tsconfig.json`, `tsconfig.web.json`, `tsconfig.test-web.json`) SHALL pass with no app present.

### Requirement 2: The dev server serves apps
**User story:** As an app developer, I want `npm run dev` to rebuild and serve my app on every save, in the same shape as the site.

#### Acceptance Criteria
1. `npm run dev` SHALL, for each app found at start, run an esbuild context with the same options as requirement 1 except `minify` (off, as for `dist/tokk.js` in dev), write `apps/<name>/dist/app.js`, and rebuild on save. The existing two contexts and the server on `localhost:5173` with the repository root as `servedir` SHALL stay. An app page is then at `http://localhost:5173/apps/<name>/index.html`, and loads `./dist/app.js` relative to itself.
2. THE function that starts the app contexts SHALL take the apps folder as an argument (default `apps/`) and SHALL return an object with a way to stop them, so a test can start it for a fixture folder.
3. THE dev server SHALL NOT notice an app folder that is created while it runs. The start message SHALL say so ("restart to add an app").
4. WHEN a context fails to build at start, `npm run dev` SHALL print the error with the app name and exit with a non-zero code, as it does for the repository's contexts.
5. The stop path (SIGINT and SIGTERM) SHALL dispose the app contexts too.

### Requirement 3: Ignored folders
**User story:** As a developer, I want build output out of Git, whatever its depth.

#### Acceptance Criteria
1. `.gitignore` SHALL list `site/` and, for clarity, `apps/*/dist/`, next to the existing `dist`. A test SHALL check with `git check-ignore` that `site/index.html` and `apps/anything/dist/app.js` are ignored, and that `apps/anything/src/main.ts` and `apps/README.md` are not.
2. `npm pack --dry-run` SHALL stay as the existing test requires: no `apps/`, `site/`, `site-src/`, `examples/` or `scripts/` file.

### Requirement 4: The hello example and `teach.html` work under any path
**User story:** As a visitor of the Pages site, I want the example and the teach page to open under `/tokk/`, and as a developer I want them to open under `npm run dev` too.

#### Acceptance Criteria
1. `teach.html` SHALL load its script with the relative URL `dist/teach-page.js`. It SHALL contain no URL that starts with `/` or with a scheme. Under `npm run dev` it SHALL still open at `/teach.html` and work as before (the existing teach tests pass unchanged).
2. `examples/hello/index.html` SHALL import Tokk with the bare specifier `tokk`, exactly as an app and a user of the package write it, and SHALL resolve the specifier with an import map in a separate `<script type="importmap">` before the module script. THE map SHALL point `tokk` to the relative URL `../../dist/tokk.js`. THIS choice and its alternatives are in design.md, "How the hello example imports Tokk".
3. THE import line SHALL stay inside the `// tokk:start` and `// tokk:end` markers, and the import map SHALL stay outside them. THE wiring count of the example SHALL therefore count the import line, and the import map is the one setup line that is not counted. README.md SHALL say this in one sentence (requirement 13).
4. THE module code between the markers SHALL be identical to the block in `README.md`, line by line, because the README shows the same block with the jsDelivr map (requirement 13.1). A test SHALL compare the two.
5. Under `npm run dev` the hello example SHALL work as before: `test/web/hello.spec.ts` SHALL pass with the same expectations.
6. Under `/tokk/` the same page SHALL work: the import map resolves to `site/dist/tokk.js`, and `loadSounds('sounds.json')` resolves to `site/examples/hello/sounds.json` (requirement 12).
7. THE text of the page that tells how to teach real sounds SHALL stay as it is, except that a mention of an absolute path, if any, is made relative.
8. (Named change, approved by the operator on 2026-11-20.) THE three existing tests of `test/hello-example.test.ts` that conflict with 4.2, 4.4 and 13.2 SHALL change minimally, and each change SHALL be recorded in design.md, "Changed tests": H3 expects the import line `from 'tokk'` and the import map; H4 expects the README block and the page block to be identical; D1 allows exactly one sentence of the README prose that states "N lines" where N equals the count that `countWiring` gives for `examples/hello`, and still rejects every other number before minutes, seconds or lines.

### Requirement 5: The landing page
**User story:** As a visitor, I want a first page that says what Tokk is in one line and leads to the four things I can open.

#### Acceptance Criteria
1. `site-src/index.html` SHALL be the first page of the site. It SHALL have `lang="en"`, a `<title>`, the viewport meta tag, one `<h1>`, one line that says what Tokk is, and a list of exactly four links with these relative targets and a text that says what each opens: `teach.html` (teach a sound, a developer page), `examples/hello/` (the hello example), `apps/hands-free/` (app 1, Hands-Free) and `apps/knock-once/` (app 2, Knock Once for Yes). Each link text SHALL state, in plain words, what it is, not only a name.
2. THE page SHALL be plain: no script, no external font, image, stylesheet or script, no animation or transition, no Halloween element, no tracking and no cookie. It SHALL follow `ui.md`: English; the `:focus-visible` outline of at least 2 px on every link; text and link colours with a contrast of at least 4.5 to 1 against the background, including the visited link colour; it SHALL be readable at 320 px width without horizontal scrolling and at 200 per cent zoom.
3. THE page SHALL say in one sentence that audio stays on the device and that the example and the apps ask for the microphone when a button is pressed. It SHALL NOT claim anything that is not true of the site (no measured numbers, no claim of recognition quality).
4. EVERY URL on the page SHALL be relative and SHALL NOT start with `/` or with a scheme (requirement 7). The links to folders SHALL end with `/`, so relative URLs inside the target page resolve to the folder.
5. `site-src/` SHALL hold this one file. THE page SHALL NOT be a copy of the README.

### Requirement 6: `npm run build:site`
**User story:** As the operator, I want one command that makes the folder GitHub Pages serves.

#### Acceptance Criteria
1. `package.json` SHALL get the script `build:site`, run with `tsx` like the other scripts, from a new file `scripts/build-site.ts`. THE file SHALL export a function that takes an options object (the output folder, default `site/`; the apps folder, default `apps/`) and SHALL accept the flags `--out <folder>` and `--apps-dir <folder>` on the command line, so tests and the operator can use other folders. It SHALL be started only when the file is the entry point, as `scripts/build.ts` is.
2. THE function SHALL empty the output folder first, with these guards. The output folder SHALL NOT be the repository root, SHALL NOT contain the repository root, and SHALL NOT be a folder that holds `.git`. IF it is, the function SHALL throw before it deletes anything. A missing output folder SHALL be created.
3. THE output SHALL be exactly this, below the output folder `O`:
   - `O/index.html` from `site-src/index.html`.
   - `O/teach.html` from `teach.html`, and `O/dist/teach-page.js`, built from `web/teach-page.ts` with the options of the existing `TEACH_PAGE_OPTIONS`, minified.
   - `O/dist/tokk.js`, built from `web/index.ts` with the options of the package build (minified, Worker source embedded). THE hello example needs it.
   - `O/examples/hello/`: `index.html`, `sounds.json`, and any other file of `examples/hello/` that is not excluded by 6.4.
   - for each app `<name>` found as in requirement 1.4: `O/apps/<name>/` with the app's `index.html`, the files and folders the app needs (assets, articles, `story.json`, `sounds.json`, and so on), not excluded by 6.4, and `O/apps/<name>/dist/app.js`, minified as in requirement 1.2.
4. THE copy SHALL NOT include: a folder named `sounds` (the original recordings stay in the local `sounds/` folders, `privacy.md`), any file with the extension `.wav`, `.ts`, `.tsx`, `.map` or `.md`, a folder named `src`, `dist` (the built `app.js` is written separately), `node_modules`, `extension` or `test`, and a file or folder whose name starts with a dot. THE rule SHALL be one list of names and extensions in the script, with a test that proves each entry.
5. THE site SHALL NOT contain `dist/node.js`, `dist/mcp.js` or `dist/types/`. `build:site` SHALL NOT call `npm run build` or write to the repository's `dist/`. `build:site` SHALL NOT depend on a previous build and SHALL NOT disturb a running dev server.
6. WHEN a link of `site-src/index.html` points to a folder that does not exist in the output (for example an app that is not written yet), the function SHALL print one warning per link and SHALL NOT fail. THE warning is the reminder that the page must not be deployed with a dead link.
7. THE function SHALL print the files it wrote in a short list with their sizes in bytes, and a total. It SHALL send nothing over the network and SHALL write nothing outside the output folder and the apps' `dist/` folders (none, since 6.3 builds `app.js` straight into the output).
8. `build:site` SHALL produce the same bytes on two runs from the same sources.

### Requirement 7: Relative URLs only
**User story:** As the operator, I want the site to work at any path, so a deploy to `/tokk/` or to a local folder behaves the same.

#### Acceptance Criteria
1. IN every `.html` file of the site, no attribute value (`href`, `src`, `action`, `poster`, `srcset`, `content` of a refresh) and no import map value SHALL start with `/` or `//`, or contain a scheme (`http:`, `https:`, `ws:`, `wss:`, `file:`). THE `data:` and `blob:` schemes SHALL be allowed in an attribute value only for images and other inline data, not for scripts.
2. IN every `.css` and `.js` file of the site, no `url(...)`, `@import`, static `import ... from`, dynamic `import(...)`, `fetch(...)`, `new Worker(...)` or `new URL(...)` SHALL take a first argument that is a string literal starting with `/` or `//`, or containing `localhost`. THE test SHALL give a list of what it matched, so a failure names the file and the text.
3. THE check SHALL be able to fail: the test SHALL run it first on samples that have each bad form and prove that each is found.
4. THE site SHALL contain no link or request to a third-party host. The only requests a page makes are to its own folders.
5. `examples/hello/index.html` and `teach.html` of the repository (the sources, not only the site) SHALL pass 7.1 and 7.2.

### Requirement 8: `npm run count:wiring`
**User story:** As the author, I want to measure the Tokk wiring of each app and example by script, so that numbers in the documents are measured.

#### Acceptance Criteria
1. `package.json` SHALL get the script `count:wiring`, run with `tsx`, from the new file `scripts/count-wiring.ts`.
2. THE script SHALL export a pure function `countWiring(source: string)` that takes the text of one file and returns the number of counted lines and the number of marker blocks. THE counted lines of a block are the lines strictly between a line with `// tokk:start` and the next line with `// tokk:end`, minus blank lines and comment lines. A marker line is a line whose text, after trimming, starts with `// tokk:start` or `// tokk:end`. THE marker lines themselves SHALL NOT be counted. THE sum over all blocks of the file SHALL be returned.
3. A line SHALL be blank when it is empty after trimming. A line SHALL be a comment line when, after trimming, it starts with `//`, or it is part of a block comment (a line that starts with `/*`, the lines up to and including the one with `*/`, and any line inside that starts with `*`). A line that has code and a trailing comment SHALL count. A line that has code after a closing `*/` SHALL count. An HTML comment is not special-cased.
4. CRLF and LF line endings SHALL give the same count. Indentation and trailing spaces SHALL NOT matter.
5. A malformed file SHALL make `countWiring` throw an error class that names the problem and the 1-based line: an `end` with no open block, a second `start` while a block is open, and a `start` that is never closed. THE script SHALL print the error with the file path and exit with code 1.
6. THE script's main function SHALL walk, in the repository (or a given root, for tests): `apps/*/src/**` (files with the extensions `.ts`, `.tsx`, `.js`, `.mjs`) and `examples/**` (the same extensions and `.html`). It SHALL skip folders named `node_modules`, `dist` and `sounds`, and files with other extensions. It SHALL group the files per app (`apps/<name>`) and per example (`examples/<name>`), and report the group name, the kind (`app` or `example`), the sum of counted lines, the number of marker blocks, and the files with their own counts (files with no marker block are left out of the files list). Groups SHALL be sorted by name, and files by path, so the output is stable.
7. A group that has files but no marker block SHALL be reported with 0 lines and 0 blocks, and the text output SHALL say "no markers" for it. It SHALL NOT be an error (the apps are built before they are wired).
8. THE default text output SHALL be one line per group with the name, the kind and the counted lines, followed by one line with the number of groups. WITH `--json` it SHALL print one JSON document on standard output and nothing else: an object with the field `groups` (a list of objects with `name`, `kind`, `lines`, `blocks` and `files`, where `files` is a list of objects with `path` and `lines`). Paths use `/` on every platform.
9. THE script SHALL read files only and SHALL NOT change anything.
10. THE numbers SHALL be the only source for any "N lines" claim in the repository (the README, `docs/integration.md`). A test SHALL check the README's claim for the hello example against the script (requirement 13.2).

### Requirement 9: The Pages workflow
**User story:** As the operator, I want a workflow that publishes the site when I push to `main`, and that does nothing before.

#### Acceptance Criteria
1. `.github/workflows/pages.yml` SHALL run on `push` to the branch `main` and on `workflow_dispatch`. It SHALL have no other trigger (no pull request, no schedule).
2. THE workflow SHALL have the permissions block that Pages deploys need, at the top level or on the jobs: `contents: read`, `pages: write` and `id-token: write`, and no other permission.
3. THE workflow SHALL have a `concurrency` group for Pages with `cancel-in-progress` false, so a deploy in progress is not cut off.
4. THE build job SHALL run these steps in this order: check out (`actions/checkout`), set up Node (`actions/setup-node`, with a Node version at or above the `engines` field of `package.json`, and the npm cache), `npm ci`, `npm run build:site`, upload the artifact with `actions/upload-pages-artifact` with `path: site`. A second job that needs the first SHALL deploy with `actions/deploy-pages`, in the environment `github-pages` whose URL is the output of the deploy step.
5. THE workflow SHALL have no test step: no `npm test`, no `test:web`, no Playwright, no `check:public-api`, no `tsc`. THE reason, from the plan, is that tests run locally, and a failure that happens only on Linux CI must not block a deploy near the deadline. The design says this in one paragraph, and the file says it in one comment line.
6. EVERY `uses:` line SHALL pin the action to a full 40-character commit SHA, with the release tag in a comment on the same line (for example the tag `v4.2.2` after the SHA). The implementer SHALL look up each SHA and tag from the action's release page at the time of writing, and SHALL record the four tags and the date in design.md, "Measured values". IF a SHA cannot be verified, the implementer SHALL stop and report, and SHALL NOT write a guessed value.
7. A test SHALL read the file as text (no YAML dependency is added) and check items 1 to 6 with line-based checks, and SHALL be able to fail (it runs the checks first on samples that break each rule).
8. THE file is inert until pushed. This task SHALL NOT push, run the workflow, or change repository settings.
9. THE repository setting "Pages source: GitHub Actions" SHALL be switched on by the operator at push time. THE design says so, and so does the devlog entry (requirement 13.4). The workflow file does not need to say it.

### Requirement 10: `apps/README.md`
**User story:** As the author of an app, I want the folder rules on one page.

#### Acceptance Criteria
1. `apps/README.md` SHALL be one page in English that states these rules: one folder per app, named with lowercase letters, digits and hyphens; the entry is `src/main.ts`; `index.html` at the folder root loads `./dist/app.js` with a relative URL; the Tokk code is between `// tokk:start` and `// tokk:end`, and `npm run count:wiring` counts it; the app imports from `'tokk'` only (never a path to `core/` or `web/`; `check:public-api` fails the save); other files the page needs sit beside `index.html` (assets, articles, `story.json`, `sounds.json`) and are copied to the site; `sounds/` recordings and `src/` are not copied; `dist/` is generated and ignored by Git; `npm run dev` serves the app at `/apps/<name>/index.html` and a new app needs a restart; `npm run build:site` includes it; every URL in the app is relative.
2. THE page SHALL also say that a new app must be linked from `site-src/index.html` and that the two apps of plan 3 are `hands-free` and `knock-once`.
3. THE file SHALL NOT be listed in the site (it is a `.md` file, excluded by requirement 6.4) and SHALL NOT be in the npm package.
4. A test SHALL check that every rule of 10.1 has a phrase in the file (a list of required phrases), as `test/scripts.test.ts` does for `integrate.md`.

### Requirement 11: `check:public-api` stays meaningful
**User story:** As an app author, I want the check to catch an import that skips the public API, now that the bundle resolves `tokk` to the source.

#### Acceptance Criteria
1. THE script SHALL keep its output format (`path:line  specifier`, the summary line, exit code 1 on a hit and 0 otherwise), and SHALL keep its current rejections.
2. A relative or absolute specifier SHALL be forbidden when, resolved against the folder of the importing file, it points into one of the repository's internal top-level folders `core`, `web`, `node` or `tools`. THE resolution SHALL be by path, with the repository root as the root, and SHALL NOT need the target to exist. A specifier with the segment `core` or `web` inside an app's own folder (for example `./web/panel`) SHALL NOT be forbidden. This replaces the rule "any path segment `core`", which gave that false positive. A specifier that leaves the app's folder and lands in `apps/<other>/` SHALL be allowed by this rule (the plan does not forbid it).
3. A bare specifier SHALL be allowed only when it is `tokk`, `tokk/node`, or not a Tokk path. THE forbidden bare specifiers SHALL be `tokk/core`, `tokk/web` and `tokk/node/` with a further path, `tokk/dist/...`, any other `tokk/<path>`, and the bare names `core`, `web`, `node` or `tools` followed by `/` and a path.
4. THE script SHALL scan `.ts`, `.tsx`, `.js`, `.mjs` and `.html` files below `apps/` (the HTML files because an inline module script is an import site), skipping `node_modules` and `dist` as now. In an `.html` file only the contents of `<script type="module">` blocks SHALL be scanned, so the text of a page is not.
5. A comment line SHALL be skipped as now.
6. THE tests SHALL run the script as a child process with `cwd` set to a temporary folder that has an `apps/` tree, and SHALL cover: a clean fixture app passes; each forbidden form fails and names the file and line; the allowed forms pass (the app's own `./web/panel` and `./core-utils`, `tokk`, `tokk/node`); an inline module script that imports `../../../web/listen` fails; a missing `apps/` folder passes. THE existing tests of the script SHALL pass unchanged except where a changed rule of this requirement requires a named change (design.md, "Changed tests").
7. `.kiro/hooks/public-api-only.json` SHALL keep its trigger, matcher, command and timeout. ONLY its description SHALL change, to name `core/`, `web/`, `node/` and `tools/`, and the existing test of the hook (if any) SHALL pass.

### Requirement 12: E2E under `/tokk/`
**User story:** As the operator, I want to know that the site works under the sub-path before I push.

#### Acceptance Criteria
1. `test/web/site.spec.ts` SHALL build a site into a temporary folder with `buildSite`, with a fixture apps folder in a temporary folder that holds two fixture apps named `hands-free` and `knock-once` (so the landing page has no dead link), and SHALL serve the output folder with a small static server started inside the test on a free port of `DEV_SERVER_HOST`. THE server SHALL serve files only below the URL prefix `/tokk/`, answer a folder URL with its `index.html`, answer every other path with 404 (so a root-absolute URL fails the test), refuse a path that leaves the folder, and set content types for `.html`, `.js`, `.json`, `.css`. It SHALL live in `test/helpers/static-site-server.ts` and have its own unit test (traversal, 404 outside the prefix, folder index, content types).
2. THE fixture apps SHALL each have `src/main.ts`, which imports from `'tokk'` and writes a text line into the page that proves the import resolved (for example that `listen` is a function), `index.html` with the relative script `./dist/app.js`, and one asset, plus one `sounds/` folder with a `.wav` file that the site must not contain. THE fixture SHALL NOT be under `apps/`.
3. Test E1: the landing page at `/tokk/` opens, has the `<h1>`, and the four links of requirement 5.1. Following each link opens a page with a 200 status. THE test SHALL list every request of every page it opens, and SHALL fail on a request whose path does not start with `/tokk/`, on a request to another origin, on a failed request, and on a console error or page error.
4. Test E2: the hello example at `/tokk/examples/hello/` with the fake microphone: after the click on "Start listening", the pattern `low _ mid` and the sound `ring` appear as text, the debug overlay is mounted, no request leaves the origin, and no error is logged. THE body of the check SHALL be the one of `hello.spec.ts`, moved to a shared helper `test/web/hello-check.ts` with the same expectations, so the two tests cannot drift. THE title of the existing test SHALL NOT change.
5. Test E3: a fixture app page opens under `/tokk/apps/<name>/` and shows its proof text, with the rules of 12.3.
6. Test E4: `teach.html` at `/tokk/teach.html` opens, its heading is visible, `dist/teach-page.js` loads with status 200, and the rules of 12.3 hold.
7. Test E5: the site folder holds no `.wav` file and no `sounds` folder (a file-system check after the build, not a page).
8. THE E2E tests SHALL NOT use `npm run dev`'s server for the site and SHALL NOT change `playwright.config.ts`'s web server. THE tests of the dev server's own behaviour (Task 20's and the existing hello and teach tests) SHALL pass unchanged and prove that `npm run dev` still works with the relative URLs.
9. THE Chrome launch arguments of the fake microphone SHALL be those of the existing config (`fakeMicArgs`). The microphone works on `localhost` without HTTPS (`web-audio.md`). The real site is HTTPS on Pages.

### Requirement 13: README and documents
**User story:** As a reader of the README, I want the example claim to be true and to read naturally.

#### Acceptance Criteria
1. `README.md` SHALL keep the example block and SHALL show, before it, the one-line import map that points `tokk` to the jsDelivr URL `https://cdn.jsdelivr.net/npm/tokk/+esm`, with a sentence that says that the block imports `tokk` as an app does, that the map is the one extra line, and that the page in this repository maps `tokk` to the local build instead. THE module block SHALL be the same as the one in `examples/hello/index.html` between the markers (requirement 4.4), and its import line SHALL read `from 'tokk'`.
2. THE sentence "Ten lines of Tokk code" SHALL be replaced by a sentence that states the number that `npm run count:wiring` gives for `examples/hello` (as digits, followed by the word "lines"). A test SHALL read the number from `countWiring` on the example and SHALL check that the README contains it. THE README SHALL NOT claim a number for the apps (they do not exist yet; "pending" stays).
3. THE README SHALL say how to open the built site locally in one sentence only if it can be done without a command that this task does not provide. Otherwise it SHALL say nothing about it. (The site is for Pages.)
4. `docs/devlog.md` SHALL get one entry: what was added, the choice of the import map, the measured values of design.md, and the reminder that the operator turns on "Pages source: GitHub Actions" and pushes.
5. THE plan, other specs, `docs/_planning/` and `docs/integration.md` SHALL NOT be changed.

### Requirement 14: Quality gates
**User story:** As the author, I want this task to break nothing.

#### Acceptance Criteria
1. `npm test`, `npm run test:web`, the three type checks, `npm run check:public-api` and `npm run build` SHALL pass. THE existing tests pass unchanged, apart from the changes named in design.md, "Changed tests".
2. NO file SHALL be created under `apps/` by this task except `apps/README.md`. No test SHALL write under `apps/`. THE `apps/` folder SHALL hold `README.md` only.
3. NO runtime export name SHALL be added to `web/index.ts`, `core/index.ts` or `node/index.ts`. NO new dependency SHALL be added to `package.json`.
4. THE new constants (ports, timeouts, names) SHALL be named with their unit and SHALL sit next to `DEV_SERVER_HOST` and `DEV_SERVER_PORT` in `scripts/build.ts` or in the test that uses them, as Task 13 and Task 19 did. They are not engine thresholds, so they do not go in `core/constants.ts` (design.md says so). No sample count is hard-coded and no time `t` is computed.
5. NO audio SHALL be sent anywhere by any file of this task, and the site SHALL contain no recording (`privacy.md`).
6. THE temporary folders that tests create SHALL be removed in `afterAll` or `finally`. After the task no temporary file or folder SHALL remain in the repository, and `git status` SHALL show only the intended changes.
