import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const APPS_DIR = 'apps';
const EXTENSIONS = ['.ts', '.tsx', '.js'];
const SKIP_DIRS = new Set(['node_modules', 'dist']);

const SPEC = String.raw`(['"\x60])([^'"\x60]+)\1`;
const PATTERNS = [
  new RegExp(String.raw`\bfrom\s*${SPEC}`, 'g'),
  new RegExp(String.raw`\bimport\s*${SPEC}`, 'g'),
  new RegExp(String.raw`\bimport\s*\(\s*${SPEC}`, 'g'),
  new RegExp(String.raw`\brequire\s*\(\s*${SPEC}`, 'g'),
];

function isForbidden(spec: string): boolean {
  if (spec === 'tokk/core' || spec.startsWith('tokk/core/')) return true;
  if (spec.startsWith('.') || spec.startsWith('/')) return spec.split('/').includes('core');
  return false;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
}

const root = process.cwd();
const appsPath = join(root, APPS_DIR);

if (!existsSync(appsPath)) {
  console.log('public API check: no apps/ folder');
  process.exit(0);
}

const files: string[] = [];
walk(appsPath, files);

let found = 0;
for (const file of files) {
  const rel = relative(root, file).split('\\').join('/');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    const seen = new Set<string>();
    for (const pattern of PATTERNS) {
      for (const m of line.matchAll(pattern)) {
        const spec = m[2];
        if (isForbidden(spec) && !seen.has(spec)) {
          seen.add(spec);
          found++;
          console.log(`${rel}:${i + 1}  ${spec}`);
        }
      }
    }
  });
}

if (found > 0) {
  console.log(`${found} forbidden import(s) found. Apps must import from 'tokk' only.`);
  process.exit(1);
}
process.exit(0);
