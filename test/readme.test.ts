// Task 27: README.md is the first page. Its numbers, links, headings and third-party table are checked (tests RM1 to RM7).
// Reads files only. Starts no npm and no browser.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { collectGroups } from '../scripts/count-wiring';
import { REPO_ROOT } from './web/paths';

const README_PATH = join(REPO_ROOT, 'README.md');
const INTEGRATION_PATH = join(REPO_ROOT, 'docs', 'integration.md');
const SITE_URL = 'https://subniin.github.io/tokk/';
const DEMO_LINE = 'Demo video: coming with the submission.';
const CASES: { group: string; integrationMarker: string }[] = [
  { group: 'apps/hands-free', integrationMarker: 'Hands-Free' },
  { group: 'apps/knock-once', integrationMarker: 'Knock Once' },
  { group: 'cases/slides', integrationMarker: 'Slide deck' },
];

const readme = (): string => readFileSync(README_PATH, 'utf8');
const withoutFences = (text: string): string => text.replace(/```[\s\S]*?```/g, '');

function cells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

// The first table that follows the heading line `start`, as { header, rows }. Empty when there is none.
function tableAfter(text: string, headerStartsWith: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim().startsWith('|') && cells(l)[0] === headerStartsWith);
  if (at < 0) return { header: [], rows: [] };
  const rows: string[][] = [];
  for (let i = at + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(cells(lines[i]));
  return { header: cells(lines[at]), rows };
}

export function headingProblems(text: string): string[] {
  const problems: string[] = [];
  const lines = withoutFences(text).split(/\r?\n/);
  if (lines[0] !== '# Tokk') problems.push('the first line is not "# Tokk"');
  let h2 = 0;
  let h3 = 0;
  for (const l of lines) {
    if (/^## /.test(l)) {
      h2++; h3 = 0;
      if (!l.startsWith(`## ${h2}. `)) problems.push(`not numbered ${h2}: ${l}`);
    } else if (/^### /.test(l)) {
      h3++;
      if (!l.startsWith(`### ${h2}.${h3} `)) problems.push(`not numbered ${h2}.${h3}: ${l}`);
    } else if (/^#{4,} /.test(l)) problems.push(`heading too deep: ${l}`);
  }
  if (h2 === 0) problems.push('no numbered sections');
  return problems;
}

export function brokenLinks(text: string, exists: (relPath: string) => boolean): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    const path = decodeURIComponent(target.split('#')[0]);
    if (!exists(path)) out.push(target);
  }
  return out;
}

export function wiringProblems(text: string, wiring: Map<string, number>): string[] {
  const problems: string[] = [];
  const measured = tableAfter(text, 'Group');
  const caseTable = tableAfter(text, 'Case');
  const col = caseTable.header.indexOf('Wiring lines');
  if (measured.rows.length === 0) problems.push('no measured-numbers table');
  if (col < 0) problems.push('no Wiring lines column in the case table');
  for (const [name, lines] of wiring) {
    const m = measured.rows.find((r) => r[0].replace(/`/g, '') === name);
    if (!m) problems.push(`measured table has no row for ${name}`);
    else if (m[1] !== String(lines)) problems.push(`measured table says ${m[1]} for ${name}, count:wiring says ${lines}`);
    const c = caseTable.rows.find((r) => r.join(' ').includes(`(${name}/)`));
    if (name.startsWith('examples/')) continue;
    if (!c) problems.push(`case table has no row for ${name}`);
    else if (col >= 0 && c[col] !== String(lines)) problems.push(`case table says ${c[col]} for ${name}, count:wiring says ${lines}`);
  }
  return problems;
}

export function timeProblems(text: string, integration: string): string[] {
  const problems: string[] = [];
  const caseTable = tableAfter(text, 'Case');
  const timeCol = caseTable.header.indexOf('Time');
  const creditCol = caseTable.header.indexOf('Kiro credits');
  const truth = tableAfter(integration, 'Target');
  const tTime = truth.header.indexOf('Time');
  const tCredit = truth.header.indexOf('Kiro credits');
  if (timeCol < 0 || creditCol < 0) return ['no Time or Kiro credits column in the case table'];
  for (const { group, integrationMarker } of CASES) {
    const mine = caseTable.rows.find((r) => r.join(' ').includes(`(${group}/)`));
    const theirs = truth.rows.find((r) => r[0].includes(integrationMarker));
    if (!mine || !theirs) { problems.push(`no row for ${group}`); continue; }
    if (!theirs[tTime].includes(mine[timeCol])) problems.push(`${group}: time "${mine[timeCol]}" is not in docs/integration.md`);
    if (!new RegExp(`${mine[creditCol].replace(/\./g, '\\.')}(?![\\d.])`).test(theirs[tCredit])) {
      problems.push(`${group}: credits "${mine[creditCol]}" are not in docs/integration.md`);
    }
  }
  return problems;
}

interface Pkg { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

export function licenceProblems(text: string, pkg: Pkg): string[] {
  const table = tableAfter(text, 'Component');
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  const problems: string[] = [];
  for (const [name, spec] of Object.entries(all)) {
    const row = table.rows.find((r) => r[0].replace(/`/g, '') === name);
    if (!row) { problems.push(`no licence row for ${name}`); continue; }
    if (row[1] !== spec.replace(/^[\^~]/, '')) problems.push(`${name}: version ${row[1]} is not ${spec}`);
    if (!/^(MIT|Apache-2\.0)$/.test(row[2])) problems.push(`${name}: licence "${row[2]}" is not an SPDX id`);
  }
  return problems;
}

const wiringNow = (): Map<string, number> => new Map(collectGroups(REPO_ROOT).map((g) => [g.name, g.lines]));
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as Pkg;
const integration = readFileSync(INTEGRATION_PATH, 'utf8');
const fileExists = (rel: string): boolean => existsSync(join(REPO_ROOT, rel));

describe('README.md (Task 27)', () => {
  it('RM1: numbered section and sub-section headings, title "# Tokk"', () => {
    expect(headingProblems(readme())).toEqual([]);
    expect(headingProblems('# Tokk\n\n## Status\n').join()).toContain('not numbered 1');
    expect(headingProblems('# Tokk\n\n## 1. A\n### 2.1 B\n').join()).toContain('not numbered 1.1');
    expect(headingProblems('# Other\n\n## 1. A\n').join()).toContain('# Tokk');
  });

  it('RM2: no TODO, no TBD, no e-mail address', () => {
    const text = readme();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\bTODO\b/);
    expect(text).not.toMatch(/\bTBD\b/);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  });

  it('RM3: every relative link and image resolves to an existing file or folder', () => {
    const text = withoutFences(readme());
    expect([...text.matchAll(/\]\(/g)].length).toBeGreaterThan(5);
    expect(brokenLinks(text, fileExists)).toEqual([]);
    expect(brokenLinks('[x](docs/nope.md) [y](https://a.b/c) [z](#top)', fileExists)).toEqual(['docs/nope.md']);
    expect(text).toContain('](docs/images/');
  });

  it('RM4: wiring numbers equal count:wiring', () => {
    const wiring = wiringNow();
    expect(wiring.size).toBe(6);   // Task 34, named update: apps/click-talk is the sixth group
    expect(wiringProblems(readme(), wiring)).toEqual([]);
    const wrong = new Map(wiring).set('apps/hands-free', wiring.get('apps/hands-free')! + 1);
    expect(wiringProblems(readme(), wrong).length).toBeGreaterThan(0);
  });

  it('RM5: time and Kiro credits equal docs/integration.md', () => {
    expect(timeProblems(readme(), integration)).toEqual([]);
    expect(timeProblems(readme().replace('1 h 24 min', '1 h 25 min'), integration).join()).toContain('apps/hands-free');
    expect(timeProblems(readme().replace('about 84', 'about 8'), integration).join()).toContain('apps/knock-once');
  });

  it('RM6: the third-party table lists every package of package.json with its exact version and licence', () => {
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length).toBeGreaterThan(0);
    expect(licenceProblems(readme(), pkg)).toEqual([]);
    expect(licenceProblems(readme(), { devDependencies: { 'made-up': '1.0.0' } })).toEqual(['no licence row for made-up']);
    expect(licenceProblems(readme(), { devDependencies: { esbuild: '0.1.0' } }).join()).toContain('esbuild: version');
  });

  it('RM7: required items are present', () => {
    const text = readme();
    const prose = withoutFences(text);
    expect(text).toMatch(/^## \d+\. Current status$/m);
    for (const w of ['synthetic', "Chrome's fake microphone", 'real-microphone', 'demo video', 'GitHub Pages', 'npm package', 'pending']) {
      expect(text, w).toContain(w);
    }
    expect(text).toContain(DEMO_LINE);
    expect(text).toContain(SITE_URL);
    expect(prose).toMatch(/not deployed yet/);
    expect(prose).toMatch(/npx tokk-mcp[^.]*after publish|after publish[^.]*npx tokk-mcp/);
    for (const w of ['reveal.js', '6.0.2', 'Hakim El Hattab', 'MIT', 'cases/slides/LICENSE-revealjs.txt', '_new-app', 'expectEvents', 'Use this template']) {
      expect(text, w).toContain(w);
    }
    expect(text).not.toMatch(/ya?ml/i);
    expect(text).toContain('# Windows PowerShell');
    expect(text).toContain('# bash');
    for (const folder of ['core/', 'web/', 'node/', 'tools/mcp-ears/', 'apps/', 'cases/', 'examples/', '.kiro/', 'powers/tokk/', 'scripts/', 'test/', 'docs/', 'teach.html']) {
      expect(text, folder).toMatch(new RegExp(`^${folder.replace(/[./]/g, '\\$&')}\\s+#`, 'm'));
    }
    expect(existsSync(join(dirname(README_PATH), 'cases', 'slides', 'LICENSE-revealjs.txt'))).toBe(true);
  });
});
