// Counts the Tokk wiring lines of every app and example (Task 21).
//   npm run count:wiring [-- --json]
// The counted lines of a file are the lines strictly between a line that starts with `// tokk:start` and the next line
// that starts with `// tokk:end`, minus blank lines and comment lines. The script reads files only and changes nothing.
// Every "N lines" claim in the repository must come from this script.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER_START = '// tokk:start';
const MARKER_END = '// tokk:end';
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'];
const EXAMPLE_EXTENSIONS = [...CODE_EXTENSIONS, '.html'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'sounds']);

export class WiringError extends Error {
  constructor(message: string, public readonly line: number, public readonly path?: string) {
    super(message);
    this.name = 'WiringError';
  }
}
export interface WiringCount { lines: number; blocks: number }
export interface WiringFile { path: string; lines: number }
export interface WiringGroup { name: string; kind: 'app' | 'example'; lines: number; blocks: number; files: WiringFile[] }

// Reads one line. Tells if it has code outside comments, and whether a block comment is still open at its end.
function scanLine(line: string, startInComment: boolean): { hasCode: boolean; inComment: boolean } {
  let inComment = startInComment;
  let hasCode = false;
  let quote = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];
    if (inComment) {
      const end = line.indexOf('*/', i);
      if (end < 0) break;
      inComment = false;
      i = end + 2;
    } else if (quote) {
      hasCode = true;
      if (ch === '\\') i += 2;
      else { if (ch === quote) quote = ''; i += 1; }
    } else if (ch === '/' && next === '/') {
      break;
    } else if (ch === '/' && next === '*') {
      inComment = true;
      i += 2;
    } else {
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      if (!/\s/.test(ch)) hasCode = true;
      i += 1;
    }
  }
  return { hasCode, inComment };
}

export function countWiring(source: string): WiringCount {
  let lines = 0;
  let blocks = 0;
  let openAt: number | null = null;
  let inComment = false;
  source.split(/\r?\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    const text = raw.trim();
    if (text.startsWith(MARKER_START)) {
      if (openAt !== null) throw new WiringError(`${MARKER_START} while the block opened at line ${openAt} is already open`, lineNo);
      openAt = lineNo;
      blocks += 1;
      inComment = false;
    } else if (text.startsWith(MARKER_END)) {
      if (openAt === null) throw new WiringError(`${MARKER_END} without an open ${MARKER_START}`, lineNo);
      openAt = null;
      inComment = false;
    } else if (openAt !== null) {
      const scanned = scanLine(text, inComment);
      inComment = scanned.inComment;
      if (scanned.hasCode) lines += 1;
    }
  });
  if (openAt !== null) throw new WiringError(`${MARKER_START} is never closed by ${MARKER_END}`, openAt);
  return { lines, blocks };
}

function walkFiles(dir: string, extensions: string[], out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkFiles(full, extensions, out);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
}

const rel = (root: string, full: string): string => relative(root, full).split(sep).join('/');

// Groups: apps/<name> (files below src/) and examples/<name>. Sorted by name; files sorted by path.
export function collectGroups(root: string): WiringGroup[] {
  const groups: WiringGroup[] = [];
  const kinds: { base: string; kind: 'app' | 'example'; sub: string; extensions: string[] }[] = [
    { base: 'apps', kind: 'app', sub: 'src', extensions: CODE_EXTENSIONS },
    { base: 'examples', kind: 'example', sub: '', extensions: EXAMPLE_EXTENSIONS },
  ];
  for (const { base, kind, sub, extensions } of kinds) {
    const baseDir = join(root, base);
    if (!existsSync(baseDir)) continue;
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const start = join(baseDir, entry.name, sub);
      if (!existsSync(start)) continue;
      const found: string[] = [];
      walkFiles(start, extensions, found);
      if (found.length === 0) continue;
      const group: WiringGroup = { name: `${base}/${entry.name}`, kind, lines: 0, blocks: 0, files: [] };
      for (const file of found.map((f) => rel(root, f)).sort()) {
        let count: WiringCount;
        try {
          count = countWiring(readFileSync(join(root, file), 'utf8'));
        } catch (e) {
          if (e instanceof WiringError) throw new WiringError(e.message, e.line, file);
          throw e;
        }
        group.lines += count.lines;
        group.blocks += count.blocks;
        if (count.blocks > 0) group.files.push({ path: file, lines: count.lines });
      }
      groups.push(group);
    }
  }
  return groups.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function formatReport(groups: WiringGroup[], json: boolean): string {
  if (json) return JSON.stringify({ groups }, null, 2);
  const rows = groups.map((g) => `${g.name}  ${g.kind}  ${plural(g.lines, 'line')}${g.blocks === 0 ? '  (no markers)' : ''}`);
  return [...rows, plural(groups.length, 'group')].join('\n');
}

function main(): void {
  const rootAt = process.argv.indexOf('--root');
  const root = rootAt >= 0 ? resolve(process.argv[rootAt + 1]) : ROOT;
  try {
    console.log(formatReport(collectGroups(root), process.argv.includes('--json')));
  } catch (e) {
    if (e instanceof WiringError) {
      console.error(`${e.path ?? '(source)'}:${e.line}  ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
