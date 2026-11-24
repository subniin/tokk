// Task 38: the "Built with Tokk" link of each app must match its main.ts: the line count of count:wiring and the line range of
// the tokk:start and tokk:end markers.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectGroups, countWiring } from '../scripts/count-wiring';

const ROOT = resolve(__dirname, '..');
const REPO_BLOB = 'https://github.com/subniin/tokk/blob/main/apps';

function markerLines(source: string): { start: number; end: number } {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().startsWith('// tokk:start')) + 1;
  const end = lines.findIndex((l) => l.trim().startsWith('// tokk:end')) + 1;
  return { start, end };
}

describe.each(['click-talk', 'shoo'])('the Built with Tokk link of %s', (app) => {
  const main = readFileSync(resolve(ROOT, 'apps', app, 'src', 'main.ts'), 'utf8');
  const html = readFileSync(resolve(ROOT, 'apps', app, 'index.html'), 'utf8');
  const tag = /<a\b[^>]*\bid="built-with-tokk"[^>]*>([^<]*)<\/a>/.exec(html);

  it('exists in index.html', () => {
    expect(tag).not.toBeNull();
  });

  it('has the line count of count:wiring in its text', () => {
    const counted = collectGroups(ROOT).find((g) => g.name === `apps/${app}`)?.lines;
    expect(counted).toBe(countWiring(main).lines);
    expect(tag?.[1]).toBe(`Built with Tokk \u00b7 ${counted} lines`);
  });

  it('points at the lines of the tokk:start and tokk:end markers, and opens in a new tab with noopener', () => {
    const { start, end } = markerLines(main);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const open = (tag?.[0] ?? '');
    expect(open).toContain(`href="${REPO_BLOB}/${app}/src/main.ts#L${start}-L${end}"`);
    expect(open).toContain('target="_blank"');
    expect(open).toContain('rel="noopener"');
  });
});
