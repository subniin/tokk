// Task 25: docs/integration.md keeps measured values only (tests I1 to I5). Reads files; starts no npm and no browser.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectGroups } from '../scripts/count-wiring';
import { REPO_ROOT } from './web/paths';

const DOC_PATH = join(REPO_ROOT, 'docs', 'integration.md');
const NOT_MEASURED = 'not measured yet';
const MIN_HUMAN_CHECK_ROWS = 6;
const PLACEHOLDERS = [/\bN hours\b/, /\bM hours\b/, /\bTBD\b/, /\bTODO\b/];
const APP_ROWS: { group: string; marker: string }[] = [
  { group: 'apps/hands-free', marker: 'Hands-Free' },
  { group: 'apps/knock-once', marker: 'Knock Once' },
];
const COMMITS = ['e7d5083', '2e29c2f', '9bf4b5f', '3a32cf3'];

const doc = (): string => (existsSync(DOC_PATH) ? readFileSync(DOC_PATH, 'utf8') : '');

function section(text: string, heading: string): string {
  const start = text.indexOf(`## ${heading}`);
  if (start < 0) return '';
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

// Rows of the first table in a section, without header and separator, each as trimmed cells.
function tableRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().startsWith('|'));
  return lines.slice(2).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
}

describe('docs/integration.md', () => {
  it('I1: the wiring table equals count:wiring for every group', () => {
    const rows = tableRows(section(doc(), 'Wiring lines'));
    const groups = collectGroups(REPO_ROOT);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      const row = rows.find((r) => r[0].replace(/`/g, '') === g.name);
      expect(row, `no row for ${g.name}`).toBeDefined();
      expect(row![1]).toBe(String(g.lines));
    }
  });

  it('I2: the case rows state the computed line count of their app', () => {
    const rows = tableRows(section(doc(), 'Cases'));
    const groups = collectGroups(REPO_ROOT);
    for (const { group, marker } of APP_ROWS) {
      const row = rows.find((r) => r[0].includes(marker));
      expect(row, `no case row for ${marker}`).toBeDefined();
      const lines = groups.find((g) => g.name === group)!.lines;
      expect(row![2]).toBe(`${lines} lines`);
    }
    expect(rows.some((r) => r.join(' ').includes('not done yet'))).toBe(true);
  });

  it('I3: has no placeholder', () => {
    const text = doc();
    expect(text.length).toBeGreaterThan(0);
    for (const p of PLACEHOLDERS) expect(text).not.toMatch(p);
  });

  it('I4: every human check says "not measured yet"', () => {
    const rows = tableRows(section(doc(), 'Human checks with a real microphone'));
    expect(rows.length).toBeGreaterThanOrEqual(MIN_HUMAN_CHECK_ROWS);
    for (const r of rows) expect(r[r.length - 1]).toBe(NOT_MEASURED);
  });

  it('I5: names the commits and the measurement rules', () => {
    const text = doc();
    for (const c of COMMITS) expect(text).toContain(c);
    const how = section(text, 'How the numbers were measured').toLowerCase();
    for (const word of ['start', 'end', 'run logs', 'git commit times', 'wall-clock']) {
      expect(how).toContain(word);
    }
    expect(text).toContain('synthetic');
  });
});
