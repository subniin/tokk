// The static site for GitHub Pages (Task 21).
//   npm run build:site [-- --out <folder>] [-- --apps-dir <folder>] [-- --cases-dir <folder>]
// Writes the landing page with its bundle and style (Task 35) and its media folder, teach.html, the hello example, every app, every case (Task 26) and the two dist files they need below one output
// folder (default site/). Every URL in the output is relative, so the site works under /tokk/.
// It writes straight into the output folder and never touches dist/, so a running dev server is not disturbed.
// It reads files and writes below the output folder only, and sends nothing over the network.

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as esbuild } from 'esbuild';
import { appBuildOptions, BROWSER_PACKAGE_OPTIONS, failedApp, findApps, SITE_SRC_DIR, TEACH_PAGE_OPTIONS, workerSourcePlugin } from './build';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT_DIR = join(ROOT, 'site');
const DEFAULT_APPS_DIR = join(ROOT, 'apps');
const DEFAULT_CASES_DIR = join(ROOT, 'cases');
// Links that are not looked up in the output: an anchor in the page and a link to this repository on GitHub.
const GITHUB_REPOSITORY_URL = 'https://github.com/subniin/tokk';
// A case folder never ships its sound model: the model of a case only serves a Node test, and its page teaches the user's own sound.
export const CASE_SKIPPED_FILES = ['sounds.json'];
// The recordings of a case only serve Node tests (privacy rule: recordings stay in local folders), so the folder is not copied, not even empty.
export const CASE_SKIPPED_FOLDERS = ['recordings'];

// What never reaches the site, whatever an app puts beside its index.html (requirement 6.4). One list, one test per entry.
export const SITE_DENY_LIST = {
  folders: ['sounds', 'src', 'dist', 'node_modules', 'extension', 'test'],
  extensions: ['.wav', '.ts', '.tsx', '.map', '.md'],
};
// A file or folder whose name starts with a dot is denied as well.
export function isDenied(name: string, isDirectory: boolean): boolean {
  if (name.startsWith('.')) return true;
  if (isDirectory) return SITE_DENY_LIST.folders.includes(name);
  const dot = name.lastIndexOf('.');
  return dot >= 0 && SITE_DENY_LIST.extensions.includes(name.slice(dot).toLowerCase());
}

export interface SiteFile { path: string; bytes: number }
export interface SiteResult { files: SiteFile[]; warnings: string[]; totalBytes: number }

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// Throws before anything is deleted.
function checkOutDir(outDir: string): void {
  if (isInside(outDir, ROOT)) throw new Error(`The output folder ${outDir} is the repository root or contains it. Refusing to empty it.`);
  if (existsSync(join(outDir, '.git'))) throw new Error(`The output folder ${outDir} holds a .git folder. Refusing to empty it.`);
}

function copyTree(from: string, to: string, skipFiles: string[] = [], skipFolders: string[] = []): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const isDirectory = entry.isDirectory();
    if (isDenied(entry.name, isDirectory)) continue;
    if (isDirectory) { if (!skipFolders.includes(entry.name)) copyTree(join(from, entry.name), join(to, entry.name), skipFiles, skipFolders); }
    else if (entry.isFile() && !skipFiles.includes(entry.name)) copyFileSync(join(from, entry.name), join(to, entry.name));
  }
}

function listOutput(outDir: string): SiteFile[] {
  const files: SiteFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push({ path: relative(outDir, full).split(sep).join('/'), bytes: statSync(full).size });
    }
  };
  walk(outDir);
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

// The href values of the landing page that point to something missing from the output (a warning each, no failure).
function deadLandingLinks(outDir: string): string[] {
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).filter((href) => !href.startsWith('#') && !href.startsWith(GITHUB_REPOSITORY_URL));
  return hrefs.filter((href) => {
    const target = resolve(outDir, href);
    return href.endsWith('/') ? !existsSync(join(target, 'index.html')) : !existsSync(target);
  });
}

// With an appsDir and no casesDir no case is copied (so a test with a fixture appsDir keeps its exact file list).
// With neither, the real apps/ and cases/ folders are used.
export async function buildSite(options: { outDir?: string; appsDir?: string; casesDir?: string; siteSrcDir?: string } = {}): Promise<SiteResult> {
  const outDir = resolve(options.outDir ?? DEFAULT_OUT_DIR);
  const appsDir = resolve(options.appsDir ?? DEFAULT_APPS_DIR);
  const siteSrcDir = resolve(options.siteSrcDir ?? SITE_SRC_DIR);
  const casesDir = options.casesDir !== undefined ? resolve(options.casesDir) : options.appsDir === undefined ? DEFAULT_CASES_DIR : undefined;
  checkOutDir(outDir);
  const apps = findApps(appsDir);
  const cases = casesDir === undefined ? [] : findApps(casesDir);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  copyFileSync(join(siteSrcDir, 'index.html'), join(outDir, 'index.html'));
  // The files of the page's media folder are copied as they are: the deny list is for app folders.
  if (existsSync(join(siteSrcDir, 'media'))) cpSync(join(siteSrcDir, 'media'), join(outDir, 'media'), { recursive: true });
  copyFileSync(join(ROOT, 'teach.html'), join(outDir, 'teach.html'));

  // The plugin instances are made here, so no build shares one by accident.
  await Promise.all([
    esbuild({ ...BROWSER_PACKAGE_OPTIONS, outfile: join(outDir, 'dist', 'tokk.js'), plugins: [workerSourcePlugin(true)] }),
    esbuild({ ...TEACH_PAGE_OPTIONS, outfile: join(outDir, 'dist', 'teach-page.js'), minify: true, plugins: [workerSourcePlugin(true)] }),
    esbuild(appBuildOptions(siteSrcDir, { minify: true, outfile: join(outDir, 'dist', 'landing.js') })),
  ]);
  copyTree(join(ROOT, 'examples', 'hello'), join(outDir, 'examples', 'hello'));
  const groups: { label: string; folder: string; from: string | undefined; names: string[]; skip: string[]; skipFolders: string[] }[] = [
    { label: 'App', folder: 'apps', from: appsDir, names: apps, skip: [], skipFolders: [] },
    { label: 'Case', folder: 'cases', from: casesDir, names: cases, skip: CASE_SKIPPED_FILES, skipFolders: CASE_SKIPPED_FOLDERS },
  ];
  for (const { label, folder, from, names, skip, skipFolders } of groups) {
    for (const name of names) {
      if (from === undefined) continue;
      copyTree(join(from, name), join(outDir, folder, name), skip, skipFolders);
      try {
        await esbuild(appBuildOptions(join(from, name), { minify: true, outfile: join(outDir, folder, name, 'dist', 'app.js') }));
      } catch (e) {
        throw failedApp(name, e, label);
      }
    }
  }

  const warnings = deadLandingLinks(outDir).map((href) => `index.html links to "${href}", which is not in the site. Do not deploy with a dead link.`);
  const files = listOutput(outDir);
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  for (const w of warnings) console.warn(`Warning: ${w}`);
  for (const f of files) console.log(`${String(f.bytes).padStart(9)}  ${f.path}`);
  console.log(`${String(totalBytes).padStart(9)}  total (${files.length} files) in ${outDir}`);
  return { files, warnings, totalBytes };
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  try {
    await buildSite({ outDir: flag('--out'), appsDir: flag('--apps-dir'), casesDir: flag('--cases-dir') });
  } catch (e) {
    console.error(`Site build failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main();
}
