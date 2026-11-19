import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_FILE = 'apps/demo/main.ts';
const UTIL_FILE = 'apps/demo/util.ts';
const FORBIDDEN_LINE = 2;
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-public-api.ts');

const TSX_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

function write(root: string, rel: string, text: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

function runInTempRoot(files: Record<string, string>): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'tokk-scripts-'));
  try {
    for (const [rel, text] of Object.entries(files)) write(root, rel, text);
    const r = spawnSync(process.execPath, ['--import', TSX_URL, SCRIPT], { cwd: root, encoding: 'utf8' });
    return { status: r.status, output: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('scripts', () => {
  it('check-public-api exits 1 and names the file for an app importing core/segment', () => {
    const { status, output } = runInTempRoot({
      [APP_FILE]: "import { x } from 'tokk';\nimport { segment } from '../../core/segment';\n",
    });
    expect(status).toBe(1);
    expect(output).toContain(`${APP_FILE}:${FORBIDDEN_LINE}`);
  }, 30000);

  it('check-public-api exits 0 when apps only import from tokk', () => {
    const { status } = runInTempRoot({
      [APP_FILE]: "import { a } from 'tokk';\nimport { b } from 'tokk/node';\n",
      [UTIL_FILE]: "import { c } from './core-utils';\nexport const d = c;\n",
    });
    expect(status).toBe(0);
  }, 30000);
});
