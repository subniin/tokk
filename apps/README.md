# Apps

Each app is a small web page that uses Tokk. The two apps of plan 3 are `hands-free` and `knock-once`. The folder rules:

- There is one folder per app, `apps/<name>/`. The name uses lowercase letters, digits and hyphens only, so it is safe in a URL.
- The entry is `src/main.ts`. The build bundles it to `apps/<name>/dist/app.js`.
- `index.html` sits at the folder root and loads the bundle with a relative URL: `<script type="module" src="./dist/app.js"></script>`.
- The Tokk code sits between `// tokk:start` and `// tokk:end`. `npm run count:wiring` counts the lines between the markers, so every "N lines" claim comes from that script.
- The app imports from `'tokk'` only, for example `import { listen } from 'tokk'`. Never import a path into `core/` or `web/` (or `node/` or `tools/`). `npm run check:public-api` fails the save of a file that does.
- Other files the page needs sit beside `index.html`: assets, articles, `story.json`, `sounds.json`. The site build copies them.
- Recordings in `sounds/` and the `src/` folder are not copied to the site. The same holds for `.wav`, `.ts` and `.md` files, `node_modules`, `extension` and `test` folders, and names that start with a dot.
- `dist/` is generated and ignored by Git. Do not edit it.
- `npm run dev` serves the app at `/apps/<name>/index.html` on `http://localhost:5173` and rebuilds it on save. A new app folder needs a restart of the dev server.
- `npm run build:site` puts the app into `site/` (the folder GitHub Pages serves) together with the landing page, `teach.html` and the hello example.
- Every URL in the app is relative (no leading `/`, no scheme), so the page works under `/tokk/` on Pages.
- A case in `cases/<name>/` follows the same rules and is built and checked the same way. See `cases/slides/README.md`.
- A new app must be linked from `site-src/index.html`. Until the folder exists, `npm run build:site` prints a warning for the dead link and still finishes.
