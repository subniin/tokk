// Task 19: the hello example page, its model and its README copy (tests H2 to H6 and D1).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countWiring } from '../scripts/count-wiring';
import { MODEL_VERSION } from '../core/constants';
import { checkModel } from '../web/model';
import { WEB_TEST_SAMPLE_RATE_HZ } from './web/fixture';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const HELLO_MAX_TOKK_LINES = 10;                 // most non-empty lines of Tokk code between the markers (requirement 1.2)
const HELLO_PAGE_PATH = join(REPO_ROOT, 'examples', 'hello', 'index.html');
const HELLO_MODEL_PATH = join(REPO_ROOT, 'examples', 'hello', 'sounds.json');
const SYNTH_MODEL_PATH = join(REPO_ROOT, 'fixtures', 'audio', 'synth', 'sounds.json');
const README_PATH = join(REPO_ROOT, 'README.md');
const MARKER_START = '// tokk:start';
const MARKER_END = '// tokk:end';
// Task 21 (requirement 4.8): the page imports the bare specifier and resolves it with an import map.
const PAGE_IMPORT = 'tokk';
const IMPORT_MAP_TARGET = '../../dist/tokk.js';
const FORBIDDEN_MODEL_KEYS = ['samples', 'wav', 'audio', 'pcm', 'waveform', 'data', 'buffer'];

export type CodeResult = { ok: true; lines: string[] } | { ok: false; error: string };

// Returns the non-empty lines between the two marker comments inside a module script, or the reason it cannot.
export function extractTokkCode(page: string): CodeResult {
  const scripts = [...page.matchAll(/<script\s+type="module"\s*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const inScript = scripts.filter((s) => s.includes(MARKER_START) || s.includes(MARKER_END));
  if (inScript.length !== 1) return { ok: false, error: `the markers must be in exactly one module script, found ${inScript.length}` };
  const body = inScript[0];
  const count = (marker: string): number => body.split('\n').filter((l) => l.trim() === marker).length;
  if (count(MARKER_START) !== 1) return { ok: false, error: `${MARKER_START} must appear once` };
  if (count(MARKER_END) !== 1) return { ok: false, error: `${MARKER_END} must appear once` };
  const all = body.split('\n').map((l) => l.trim());
  const from = all.indexOf(MARKER_START);
  const to = all.indexOf(MARKER_END);
  if (from > to) return { ok: false, error: 'the start marker must come before the end marker' };
  return { ok: true, lines: all.slice(from + 1, to).filter((l) => l !== '') };
}

// The import map is a separate script before the module script, outside the markers (Task 21, requirement 4.2 and 4.3).
function hasImportMap(text: string): boolean {
  const m = /<script type="importmap">([\s\S]*?)<\/script>/.exec(text);
  if (!m) return false;
  try {
    const imports = (JSON.parse(m[1]) as { imports?: Record<string, string> }).imports;
    return imports?.[PAGE_IMPORT] === IMPORT_MAP_TARGET && m.index < text.indexOf('type="module"');
  } catch { return false; }
}

export function checkTokkCode(page: string, maxLines: number): string[] {
  const r = extractTokkCode(page);
  if (!r.ok) return [r.error];
  const problems: string[] = [];
  if (r.lines.length > maxLines) problems.push(`${r.lines.length} lines of Tokk code, at most ${maxLines}`);
  const text = r.lines.join('\n');
  if (!text.includes('listen(')) problems.push('no listen( call');
  if (!text.includes('debug: true')) problems.push('no debug: true');
  if (!r.lines.some((l) => l.startsWith('import ') && l.includes(`from '${PAGE_IMPORT}'`))) problems.push(`no import from '${PAGE_IMPORT}'`);
  if (!hasImportMap(page)) problems.push('no import map for tokk');
  return problems;
}

function readmeCode(readme: string): string[] {
  const block = [...readme.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => b.includes('tokk:start'));
  if (block === undefined) throw new Error('README has no fenced block with tokk:start');
  const r = extractTokkCode(`<script type="module">\n${block}</script>`);
  if (!r.ok) throw new Error(r.error);
  return r.lines;
}

function proseOf(readme: string): string {
  return readme.replace(/```[\s\S]*?```/g, '');
}

const page = readFileSync(HELLO_PAGE_PATH, 'utf8');

describe('hello page (Task 19)', () => {
  it('H2: the markers are in order, once each, inside a module script', () => {
    const r = extractTokkCode(page);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
  });

  it('H3: at most HELLO_MAX_TOKK_LINES lines, listen(, debug: true and the local import', () => {
    expect(checkTokkCode(page, HELLO_MAX_TOKK_LINES)).toEqual([]);
  });

  it('H3 negative: 11 lines and a missing marker are rejected', () => {
    const r = extractTokkCode(page);
    if (!r.ok) throw new Error(r.error);
    const extra = Array.from({ length: HELLO_MAX_TOKK_LINES + 1 - r.lines.length }, (_, i) => `const filler${i} = ${i};`);
    const eleven = page.replace(MARKER_END, `${extra.join('\n')}\n${MARKER_END}`);
    expect(extractTokkCode(eleven)).toMatchObject({ ok: true });
    expect(checkTokkCode(eleven, HELLO_MAX_TOKK_LINES).join('\n')).toContain(`at most ${HELLO_MAX_TOKK_LINES}`);
    expect(checkTokkCode(page.replace(MARKER_END, ''), HELLO_MAX_TOKK_LINES).join('\n')).toContain(MARKER_END);
    expect(checkTokkCode(page.replace(MARKER_START, ''), HELLO_MAX_TOKK_LINES).join('\n')).toContain(MARKER_START);
    const swapped = page.replace(MARKER_START, '@@').replace(MARKER_END, MARKER_START).replace('@@', MARKER_END);
    expect(checkTokkCode(swapped, HELLO_MAX_TOKK_LINES)).toContain('the start marker must come before the end marker');
    expect(checkTokkCode(page.replace('debug: true', 'debug: false'), HELLO_MAX_TOKK_LINES)).toContain('no debug: true');
  });

  // Task 21 (requirement 4.8): the README block is now the same as the page block, line by line.
  it('H4: the README example equals the page code line by line', () => {
    const fromPage = extractTokkCode(page);
    if (!fromPage.ok) throw new Error(fromPage.error);
    expect(readmeCode(readFileSync(README_PATH, 'utf8'))).toEqual(fromPage.lines);
  });

  it('H5: button text, synthetic and teach.html in the page and in the README', () => {
    expect(page).toContain('Start listening');
    const readme = readFileSync(README_PATH, 'utf8');
    for (const text of [page, readme]) {
      expect(text).toContain('synthetic');
      expect(text).toContain('teach.html');
    }
    expect(readme).toContain('examples/hello');
  });

  it('H6: sounds.json is accepted, uses synthetic labels, the fake-microphone rate and holds no audio', () => {
    const raw = readFileSync(HELLO_MODEL_PATH, 'utf8');
    const model = JSON.parse(raw) as { version: number; sampleRate: number; examples: { label: string; v: number[] }[] };
    const checked = checkModel(model);
    expect(checked.ok).toBe(true);
    expect(model.version).toBe(MODEL_VERSION);
    expect(model.sampleRate).toBe(WEB_TEST_SAMPLE_RATE_HZ);

    const synth = JSON.parse(readFileSync(SYNTH_MODEL_PATH, 'utf8')) as { examples: { label: string; v: number[] }[] };
    const synthLabels = new Set(synth.examples.map((e) => e.label));
    const labels = new Set(model.examples.map((e) => e.label));
    expect(labels.size).toBeGreaterThan(0);
    for (const l of labels) expect(synthLabels.has(l), l).toBe(true);

    const vectorLength = synth.examples[0].v.length;
    for (const e of model.examples) expect(e.v.length).toBe(vectorLength);
    const keys: string[] = [];
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (typeof x === 'object' && x !== null) {
        for (const [k, v] of Object.entries(x)) { keys.push(k.toLowerCase()); walk(v); }
      }
    };
    walk(model);
    expect(keys.filter((k) => FORBIDDEN_MODEL_KEYS.includes(k))).toEqual([]);
    expect(raw).not.toContain('RIFF');
  });

  // Task 21 (requirement 4.8): exactly one "N lines" sentence is allowed, with N measured by countWiring on the example.
  it('D1: the README states no number before minutes, seconds or lines outside code blocks, except the one measured count', () => {
    const NUMBER_BEFORE_UNIT = /\b\d+(?:[.,]\d+)?\s*(?:minutes?|seconds?|lines?)\b/gi;
    const rest = (prose: string, measured: number): string[] => {
      const all = [...prose.matchAll(NUMBER_BEFORE_UNIT)].map((m) => m[0]);
      const at = all.findIndex((x) => x.replace(/\s+/g, ' ') === `${measured} lines`);
      return at < 0 ? all : all.filter((_, i) => i !== at);
    };
    const measured = countWiring(page).lines;
    const prose = proseOf(readFileSync(README_PATH, 'utf8'));
    expect([...prose.matchAll(NUMBER_BEFORE_UNIT)].map((m) => m[0])).toEqual([`${measured} lines`]);
    expect(rest(prose, measured)).toEqual([]);
    expect(rest('Teaching takes 3 minutes.', measured)).not.toEqual([]);
    expect(rest(`The code is ${measured + 1} lines long.`, measured)).not.toEqual([]);
    expect(rest(`${measured} lines. And ${measured} lines again.`, measured)).not.toEqual([]);
    expect(rest('It takes 4 seconds.', measured)).not.toEqual([]);
  });
});
