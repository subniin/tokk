// Task 21: apps/README.md, the README example and tsconfig.web.json (tests R1 and T1).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countWiring } from '../scripts/count-wiring';
import { REPO_ROOT } from './web/paths';

const APPS_README = join(REPO_ROOT, 'apps', 'README.md');
const MARKER_START = '// tokk:start';
const MARKER_END = '// tokk:end';
const JSDELIVR_MAP = '<script type="importmap">{ "imports": { "tokk": "https://cdn.jsdelivr.net/npm/tokk/+esm" } }</script>';

// One phrase for each rule of requirement 10.1 and 10.2.
export const REQUIRED_PHRASES = [
  'one folder per app', 'lowercase letters, digits and hyphens', 'src/main.ts', 'index.html', './dist/app.js',
  MARKER_START, MARKER_END, 'npm run count:wiring', "from 'tokk'", 'check:public-api', 'core/', 'web/',
  'story.json', 'sounds.json', 'sounds/', 'not copied', 'generated', 'ignored by Git', 'npm run dev', '/apps/<name>/index.html',
  'restart', 'npm run build:site', 'relative', 'site-src/index.html', 'click-talk', 'shoo',
];

export function missingPhrases(text: string): string[] {
  return REQUIRED_PHRASES.filter((p) => !text.includes(p));
}

function blockLines(text: string): string[] {
  const all = text.split(/\r?\n/).map((l) => l.trim());
  const from = all.indexOf(MARKER_START);
  const to = all.indexOf(MARKER_END);
  if (from < 0 || to < from) throw new Error('no marker block');
  return all.slice(from + 1, to).filter((l) => l !== '');
}

describe('apps/README.md and the README example (Task 21)', () => {
  it('R1: the phrase check fails on a text without phrases and on a text that lacks one', () => {
    expect(missingPhrases('')).toEqual(REQUIRED_PHRASES);
    const full = REQUIRED_PHRASES.join('\n');
    expect(missingPhrases(full)).toEqual([]);
    expect(missingPhrases(full.replace('shoo', ''))).toEqual(['shoo']);
  });

  it('R1: apps/README.md has a phrase for each rule', () => {
    expect(existsSync(APPS_README)).toBe(true);
    const text = readFileSync(APPS_README, 'utf8');
    expect(missingPhrases(text)).toEqual([]);
    expect(text).not.toMatch(/hands-free|knock-once/);   // Task 36: the two replaced apps are gone
  });

  it('R1: the README module block equals the hello block, shows the jsDelivr import map, and states the measured count', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    const hello = readFileSync(join(REPO_ROOT, 'examples', 'hello', 'index.html'), 'utf8');
    const fenced = [...readme.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
    const code = fenced.find((b) => b.includes(MARKER_START));
    expect(code).toBeDefined();
    expect(blockLines(code as string)).toEqual(blockLines(hello));
    expect(fenced.some((b) => b.includes(JSDELIVR_MAP))).toBe(true);
    expect(readme).toContain("from 'tokk'");
    expect(readme).toContain('not counted');
    const measured = countWiring(hello).lines;
    expect(readme).toContain(`${measured} lines of Tokk code`);
  });

  it('T1: tsconfig.web.json includes apps/*/src and maps tokk to web/index.ts', () => {
    const cfg = JSON.parse(readFileSync(join(REPO_ROOT, 'tsconfig.web.json'), 'utf8')) as {
      include: string[]; compilerOptions: { paths?: Record<string, string[]> };
    };
    expect(cfg.include).toContain('apps/*/src/**/*.ts');
    expect(cfg.compilerOptions.paths?.tokk).toEqual(['./web/index.ts']);
  });
});
