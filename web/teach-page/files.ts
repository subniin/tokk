// Pure helpers of the developer teach page: listing rule, path rule, numbering and names of files, texts.
// No DOM type, no Node module, no network. The listing rule is the one of node/teach.ts (teachFromDir).

import type { SoundModel } from '../../core/types';
import { WEB_TEACH_PAGE_NUMBER_DIGITS, WEB_TEACH_PAGE_SOUNDS_DIR } from '../constants';

export interface DirEntry { name: string; kind: 'file' | 'directory' }
export interface LabelFiles { label: string; files: string[] }
export interface Listing { labels: LabelFiles[]; emptyFolders: string[] }

const WAV_EXTENSION = '.wav';
const PATH_SEPARATOR = '/';
const PATH_DEPTH = 4;   // <picked>/sounds/<label>/<file>

// Plain code-unit comparison, independent of the locale (as in node/teach.ts).
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const isWavName = (name: string): boolean => name.toLowerCase().endsWith(WAV_EXTENSION);

// Label folders are the directories whose name does not start with ".". A label's files are the files whose name ends
// with ".wav" in any letter case. A label folder without such a file is an empty folder.
export function listLabels(top: DirEntry[], childrenOf: (label: string) => DirEntry[]): Listing {
  const folders = top
    .filter((e) => e.kind === 'directory' && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort(compareStrings);
  const labels: LabelFiles[] = [];
  const emptyFolders: string[] = [];
  for (const label of folders) {
    const files = childrenOf(label)
      .filter((e) => e.kind === 'file' && isWavName(e.name))
      .map((e) => e.name)
      .sort(compareStrings);
    if (files.length === 0) emptyFolders.push(label);
    else labels.push({ label, files });
  }
  return { labels, emptyFolders };
}

// `<picked>/sounds/<label>/<file>.wav` to { label, file }, with the same dot and extension rules; anything else is null.
export function parseRelativePath(path: string): { label: string; file: string } | null {
  const parts = path.split(PATH_SEPARATOR);
  if (parts.length !== PATH_DEPTH || parts.some((p) => p === '')) return null;
  const [, dir, label, file] = parts;
  if (dir !== WEB_TEACH_PAGE_SOUNDS_DIR || label.startsWith('.') || !isWavName(file)) return null;
  return { label, file };
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// One more than the highest number among the files named `<label>-<digits>.wav` (lower-case extension), or 1.
export function nextNumber(label: string, files: string[]): number {
  const pattern = new RegExp(`^${escapeForRegExp(label)}-(\\d+)\\.wav$`);
  let highest = 0;
  for (const file of files) {
    const m = pattern.exec(file);
    if (m !== null) highest = Math.max(highest, Number(m[1]));
  }
  return highest + 1;
}

export function fileName(label: string, n: number): string {
  return `${label}-${String(n).padStart(WEB_TEACH_PAGE_NUMBER_DIGITS, '0')}${WAV_EXTENSION}`;
}

// `count` new names after the highest number. A name that is already taken, in any letter case, is skipped.
export function newFileNames(label: string, files: string[], count: number): string[] {
  const taken = new Set(files.map((f) => f.toLowerCase()));
  const names: string[] = [];
  for (let n = nextNumber(label, files); names.length < count; n++) {
    const name = fileName(label, n);
    if (!taken.has(name.toLowerCase())) names.push(name);
  }
  return names;
}

export function relativePath(label: string, file: string): string {
  return `${WEB_TEACH_PAGE_SOUNDS_DIR}${PATH_SEPARATOR}${label}${PATH_SEPARATOR}${file}`;
}

export function rebuildCommand(projectName: string): string {
  return `npm run sounds:rebuild ${projectName}${PATH_SEPARATOR}${WEB_TEACH_PAGE_SOUNDS_DIR}`;
}

// The text that scripts/sounds-rebuild.ts writes.
export function soundsJsonText(model: SoundModel): string {
  return `${JSON.stringify(model, null, 2)}\n`;
}

// The test of isModel in scripts/sounds-rebuild.ts.
export function isSoundsModel(value: unknown): boolean {
  const m = value as { version?: unknown; examples?: unknown } | null;
  return typeof m === 'object' && m !== null && m.version === 1 && Array.isArray(m.examples);
}
