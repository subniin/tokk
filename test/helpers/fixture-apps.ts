// Makes a temporary apps folder with fixture apps (Task 21). Never uses apps/ of the repository.
// Each app is real source: src/main.ts imports 'tokk' (an alias in the build), index.html loads ./dist/app.js,
// and the folder holds one asset, a sounds/ folder with a .wav, a src/ helper and a notes.md that the site must not contain.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const FIXTURE_PROOF_TEXT = 'tokk import resolved: listen is a function';
export const FIXTURE_ASSET_NAME = 'asset.txt';
export const FIXTURE_APP_NAMES = ['hands-free', 'knock-once'];

function put(path: string, text: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function makeFixtureApps(names: string[] = FIXTURE_APP_NAMES): string {
  const dir = mkdtempSync(join(tmpdir(), 'tokk-apps-'));
  for (const name of names) {
    const app = join(dir, name);
    put(join(app, 'src', 'main.ts'), [
      "import { listen } from 'tokk';",
      "import { label } from './helper';",
      "const out = document.getElementById('out');",
      "if (out) out.textContent = `${label}: listen is a ${typeof listen === 'function' ? 'function' : 'missing'}`;",
      '',
    ].join('\n'));
    put(join(app, 'src', 'helper.ts'), "export const label = 'tokk import resolved';\n");
    put(join(app, 'index.html'), [
      '<!doctype html>', '<html lang="en">', '<head><meta charset="utf-8"><title>Fixture app</title></head>',
      `<body><h1>${name}</h1><p id="out"></p><script type="module" src="./dist/app.js"></script></body>`, '</html>', '',
    ].join('\n'));
    put(join(app, FIXTURE_ASSET_NAME), 'asset\n');
    put(join(app, 'sounds', 'x.wav'), new Uint8Array([82, 73, 70, 70]));
    put(join(app, 'notes.md'), '# notes\n');
  }
  return dir;
}

export function removeFixtureApps(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
