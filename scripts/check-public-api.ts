import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

// The folders whose files are scanned (Task 21: apps, Task 26: cases). A missing folder is skipped.
const SCANNED_DIRS = ['apps', 'cases'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.html'];
// Folders of this repository that an app must reach only through 'tokk' (Task 21: apps are bundled against web/index.ts).
const INTERNAL_DIRS = ['core', 'web', 'node', 'tools'];
const SKIP_DIRS = new Set(['node_modules', 'dist']);

const SPEC = String.raw`(['"\x60])([^'"\x60]+)\1`;
const PATTERNS = [
  new RegExp(String.raw`\bfrom\s*${SPEC}`, 'g'),
  new RegExp(String.raw`\bimport\s*${SPEC}`, 'g'),
  new RegExp(String.raw`\bimport\s*\(\s*${SPEC}`, 'g'),
  new RegExp(String.raw`\brequire\s*\(\s*${SPEC}`, 'g'),
];

// A relative specifier is resolved against the folder of the importing file, an absolute one against the repository root
// (apps use root-relative URLs). Forbidden when the result is inside core/, web/, node/ or tools/. The target need not exist.
function isForbidden(spec: string, fileDir: string, root: string): boolean {
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const target = spec.startsWith('/') ? resolve(root, `.${spec}`) : resolve(fileDir, spec);
    const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) return false;
    return INTERNAL_DIRS.includes(rel.split(sep)[0]);
  }
  if (spec === 'tokk' || spec === 'tokk/node') return false;
  if (spec.startsWith('tokk/')) return true;
  return spec.includes('/') && INTERNAL_DIRS.includes(spec.split('/')[0]);
}

// Keeps only the text of <script type="module"> blocks. Everything else becomes spaces, so line numbers stay the same.
function moduleScriptsOnly(html: string): string {
  const keep = Array.from(html, (c): string => (c === '\n' || c === '\r' ? c : ' '));
  for (const m of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const start = m.index + m[0].length - '</script>'.length - m[1].length;
    for (let i = 0; i < m[1].length; i++) keep[start + i] = m[1][i];
  }
  return keep.join('');
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
const present = SCANNED_DIRS.filter((d) => existsSync(join(root, d)));

if (present.length === 0) {
  console.log(`public API check: ${SCANNED_DIRS.map((d) => `no ${d}/ folder`).join(' and ')}`);
  process.exit(0);
}

const files: string[] = [];
for (const d of present) walk(join(root, d), files);

let found = 0;
for (const file of files) {
  const rel = relative(root, file).split('\\').join('/');
  const source = readFileSync(file, 'utf8');
  const lines = (file.endsWith('.html') ? moduleScriptsOnly(source) : source).split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    const seen = new Set<string>();
    for (const pattern of PATTERNS) {
      for (const m of line.matchAll(pattern)) {
        const spec = m[2];
        if (isForbidden(spec, dirname(file), root) && !seen.has(spec)) {
          seen.add(spec);
          found++;
          console.log(`${rel}:${i + 1}  ${spec}`);
        }
      }
    }
  });
}

if (found > 0) {
  console.log(`${found} forbidden import(s) found. Apps and cases must import from 'tokk' only.`);
  process.exit(1);
}
process.exit(0);
