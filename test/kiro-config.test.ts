// Task 18: structure checks of the Kiro power, the two agents, the _new-app template, docs/kiro.md and the
// steering file integrate.md. Nothing here starts Kiro or touches the network.
// Each area has a plain validator function that returns a list of problems. The negative tests (A10) call the same
// validator with a copy of the data that lacks one field and expect problems.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TOOLS } from '../tools/mcp-ears/tools';

const ROOT = resolve('.');
const POWER_DIR = 'powers/tokk';
const AGENTS_DIR = '.kiro/agents';
const TEMPLATE_DIR = '.kiro/specs/_new-app';

// ---- constants (each with its reason) ----

// Requirement 2.2: the keywords of design 8.5 plus the six more of this task.
const REQUIRED_KEYWORDS = [
  'sound control', 'clap', 'knock', 'hands-free', 'teach sound',
  'whistle', 'hum', 'microphone', 'sound detection', 'audio events', 'tokk',
];
// Requirement 2.2 (approved change of 2026-11-20): fixed power metadata.
const EXPECTED_AUTHOR = { name: 'subniin', url: 'https://github.com/subniin' };
const EXPECTED_REPOSITORY_URL = 'https://github.com/subniin/tokk';
const EXPECTED_LICENSE = 'MIT';
const PLUGIN_SCHEMA_URL = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA_URL = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// Requirement 2.1: the files of the power, and nothing else.
const POWER_FILES = [
  'mcp.json', 'plugin.json',
  'skills/integrate/SKILL.md', 'skills/new-app/SKILL.md', 'skills/tune-sounds/SKILL.md',
];
const SKILL_NAMES = ['integrate', 'new-app', 'tune-sounds'];

// Requirements 3.4 and 4.5: the allowed `fs_write` and `shell` matches.
const TUNER_FS_WRITE_MATCHES = ['sounds/**', 'examples/sounds/**', 'docs/experiments.md'];
const TUNER_MCP_MATCHES = ['mcp-ears/teach', 'mcp-ears/score', 'mcp-ears/spectrogram'];
const TUNER_TOOLS = ['read', 'write', '@mcp-ears/teach', '@mcp-ears/score', '@mcp-ears/spectrogram'];
const INTEGRATOR_SHELL_MATCHES = ['npm test*', 'npx vitest*'];
const INTEGRATOR_MCP_MATCHES = ['mcp-ears/listen'];
const INTEGRATOR_TOOLS = ['read', 'write', 'shell', '@mcp-ears/listen'];
const INTEGRATOR_RESOURCES = ['file://.kiro/steering/integrate.md'];
const EFFECTS = ['allow', 'ask', 'deny'];
const ALL_PATHS = ['**'];
const SERVER_NAME = 'mcp-ears';
const AGENT_BASE_FIELDS = ['name', 'description', 'prompt', 'tools', 'permissions', 'includeMcpJson', 'welcomeMessage'];

// Requirement 5: template line, table header and sizes.
const TEMPLATE_LINE_START = '<!-- TEMPLATE:';
const TABLE_HEADER = ['Sound name', 'Example folder', 'Pattern', 'Action'];
const MIN_EXAMPLE_ROWS = 2;
const MAX_INSTRUCTION_LINES = 15;
const PLACEHOLDER_CELL = /^<[^<>]+>$/;
// Words that name a real sound of this repository. The stub files must not use them (requirement 5.4).
const REAL_LABEL_WORDS = ['clap', 'snap', 'knock', 'whistle', 'tap', 'cup'];

// Requirement 6: documentation URLs, the check date and the paths that do not exist yet on a clean checkout.
const DOC_URLS = [
  'https://kiro.dev/docs/powers/create/',
  'https://kiro.dev/blog/powers-supports-plugins/',
  'https://kiro.dev/docs/custom-agents/configuration-reference/',
  'https://kiro.dev/docs/permissions/',
];
const DOC_CHECK_DATE = '2026-11-20';
const DOC_PATH_ALLOW_LIST = [
  'dist/mcp.js',   // "after build": written by npm run build
];
const HEADLESS_LINE = 'kiro-cli chat --v3 --agent <name> --no-interactive';

// Requirement 9: terms that the steering file and the integrate skill must both name.
const SHARED_API_TERMS = [
  'listen', 'loadSounds', 'modes', 'setMode', 'debug', 'ears.teach', 'exportSounds', 'importSounds',
  'source', 'storageKey', 'teach.html', 'npm run dev', 'http://localhost:5173/teach.html',
];
const STEERING_FRONT_MATTER_LINES = ['inclusion: fileMatch', 'fileMatchPattern: ["apps/**/*", "docs/integration.md"]'];

// ---- helpers ----

type Json = Record<string, unknown>;

const readText = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const readJson = (p: string): Json => JSON.parse(readText(p)) as Json;
const TOOL_NAMES = TOOLS.map((t) => t.name);

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...listFiles(rel, base));
    else out.push(rel.slice(base.length + 1));
  }
  return out.sort();
}

// Front matter: the first `---` block, `key: value` lines. Quoted values lose their quotes.
export function parseFrontMatter(text: string): Record<string, string> | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const out: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

function without(obj: Json, key: string): Json {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
const sameList = (a: unknown, b: string[]): boolean => isStringArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

// ---- validators ----

export function validatePlugin(p: Json): string[] {
  const problems: string[] = [];
  if (p.$schema !== PLUGIN_SCHEMA_URL) problems.push('$schema');
  if (typeof p.name !== 'string' || !KEBAB_CASE.test(p.name)) problems.push('name');
  if (typeof p.version !== 'string' || !SEMVER.test(p.version)) problems.push('version');
  if (typeof p.description !== 'string' || p.description.trim() === '') problems.push('description');
  if (JSON.stringify(p.author) !== JSON.stringify(EXPECTED_AUTHOR)) problems.push('author');
  if (p.repository !== EXPECTED_REPOSITORY_URL) problems.push('repository');
  if (p.homepage !== EXPECTED_REPOSITORY_URL) problems.push('homepage');
  if (p.license !== EXPECTED_LICENSE) problems.push('license');
  if (!isStringArray(p.keywords)) problems.push('keywords');
  else {
    const missing = REQUIRED_KEYWORDS.filter((k) => !(p.keywords as string[]).includes(k));
    if (missing.length > 0) problems.push(`keywords missing: ${missing.join(', ')}`);
  }
  return problems;
}

export function validateMcpJson(m: Json, pkg: Json): string[] {
  const problems: string[] = [];
  if (m.$schema !== MCP_SCHEMA_URL) problems.push('$schema');
  const servers = m.mcpServers as Record<string, Json> | undefined;
  if (!servers || typeof servers !== 'object') return [...problems, 'mcpServers'];
  const names = Object.keys(servers);
  if (names.length !== 1 || names[0] !== SERVER_NAME) problems.push('one server named mcp-ears');
  const s = servers[SERVER_NAME];
  if (!s) return [...problems, 'server'];
  if (s.type !== 'stdio') problems.push('type');
  if (s.command !== 'npx') problems.push('command');
  const binNames = Object.keys((pkg.bin as Record<string, string> | undefined) ?? {});
  const expectedArgs = ['-y', '-p', String(pkg.name), binNames[0] ?? ''];
  if (binNames.length !== 1 || !sameList(s.args, expectedArgs)) problems.push('args');
  return problems;
}

export function validateSkill(folder: string, text: string): string[] {
  const fm = parseFrontMatter(text);
  if (!fm) return ['front matter'];
  const problems: string[] = [];
  if (fm.name !== folder) problems.push('name');
  if (!fm.description || fm.description.trim() === '') problems.push('description');
  return problems;
}

interface Rule { capability: unknown; match: unknown; effect: unknown }

function allowMatches(rules: Rule[], capability: string): string[] {
  return rules.filter((r) => r.capability === capability && r.effect === 'allow').flatMap((r) => r.match as string[]);
}

function validateRuleShapes(rules: unknown): string[] {
  if (!Array.isArray(rules)) return ['permissions.rules'];
  const problems: string[] = [];
  rules.forEach((r: Rule, i) => {
    if (typeof r?.capability !== 'string' || !isStringArray(r.match) || !EFFECTS.includes(r.effect as string)) {
      problems.push(`rule ${i} shape`);
    }
  });
  return problems;
}

// MCP names in `tools` (`@server/tool`) and in rules (`server/tool`).
function mcpNames(agent: Json): string[] {
  const names: string[] = [];
  if (isStringArray(agent.tools)) for (const t of agent.tools) if (t.startsWith('@')) names.push(t.slice(1));
  const rules = (agent.permissions as { rules?: Rule[] } | undefined)?.rules;
  if (Array.isArray(rules)) {
    for (const r of rules) if (r.capability === 'mcp' && isStringArray(r.match)) names.push(...r.match);
  }
  return names;
}

export function validateMcpNames(agent: Json, serverNames: string[]): string[] {
  const problems: string[] = [];
  for (const n of mcpNames(agent)) {
    const [server, tool, ...rest] = n.split('/');
    if (rest.length > 0 || !serverNames.includes(server)) problems.push(`server of ${n}`);
    else if (!TOOL_NAMES.includes(tool)) problems.push(`tool of ${n}`);
  }
  return problems;
}

function validateAgentBase(a: Json, name: string, extra: string[]): string[] {
  const problems: string[] = [];
  for (const f of [...AGENT_BASE_FIELDS, ...extra]) if (!(f in a)) problems.push(`missing ${f}`);
  if (a.name !== name) problems.push('name');
  if (typeof a.description !== 'string' || a.description.trim() === '') problems.push('description');
  if (typeof a.prompt !== 'string' || a.prompt.trim() === '') problems.push('prompt');
  if (a.includeMcpJson !== true) problems.push('includeMcpJson');
  if (typeof a.welcomeMessage !== 'string' || a.welcomeMessage.trim() === '') problems.push('welcomeMessage');
  const rules = (a.permissions as { rules?: unknown } | undefined)?.rules;
  problems.push(...validateRuleShapes(rules));
  return problems;
}

export function validateTuner(a: Json): string[] {
  const problems = validateAgentBase(a, 'sound-tuner', []);
  if (!sameList(a.tools, TUNER_TOOLS)) problems.push('tools');
  const rules = (a.permissions as { rules?: Rule[] } | undefined)?.rules;
  if (Array.isArray(rules) && validateRuleShapes(rules).length === 0) {
    if (!sameSet(allowMatches(rules, 'fs_read'), ALL_PATHS)) problems.push('fs_read');
    if (!sameSet(allowMatches(rules, 'fs_write'), TUNER_FS_WRITE_MATCHES)) problems.push('fs_write');
    if (!sameSet(allowMatches(rules, 'mcp'), TUNER_MCP_MATCHES)) problems.push('mcp');
    if (allowMatches(rules, 'shell').length > 0) problems.push('shell allow');
    const others = rules.filter((r) => r.effect === 'allow' && !['fs_read', 'fs_write', 'mcp'].includes(r.capability as string));
    if (others.length > 0) problems.push('other allow');
  }
  return problems;
}

export function validateIntegrator(a: Json): string[] {
  const problems = validateAgentBase(a, 'integrator', ['resources']);
  if (!sameList(a.tools, INTEGRATOR_TOOLS)) problems.push('tools');
  if (!sameList(a.resources, INTEGRATOR_RESOURCES)) problems.push('resources');
  const rules = (a.permissions as { rules?: Rule[] } | undefined)?.rules;
  if (Array.isArray(rules) && validateRuleShapes(rules).length === 0) {
    if (!sameSet(allowMatches(rules, 'fs_read'), ALL_PATHS)) problems.push('fs_read');
    if (!sameSet(allowMatches(rules, 'fs_write'), ALL_PATHS)) problems.push('fs_write');
    if (!sameSet(allowMatches(rules, 'mcp'), INTEGRATOR_MCP_MATCHES)) problems.push('mcp');
    if (!sameSet(allowMatches(rules, 'shell'), INTEGRATOR_SHELL_MATCHES)) problems.push('shell');
    const others = rules.filter((r) => r.effect === 'allow' && !['fs_read', 'fs_write', 'mcp', 'shell'].includes(r.capability as string));
    if (others.length > 0) problems.push('other allow');
  }
  return problems;
}

// Words that the prompts must contain (design, "Tests": the topics, not the wording).
export function validatePromptTopics(a: Json, words: string[]): string[] {
  const prompt = String(a.prompt ?? '');
  return words.filter((w) => !prompt.includes(w)).map((w) => `prompt lacks ${w}`);
}

const TUNER_PROMPT_WORDS = ['score', 'teach', 'spectrogram', 'background', 'docs/experiments.md', 'nearest.id', 'ms', 'Hz', 'dB'];
const INTEGRATOR_PROMPT_WORDS = ['sounds.json', 'listen()', 'modes', 'expectEvents', 'bindings.yaml', 'integrate'];

function tableRows(text: string): string[][] {
  return text.replace(/\r\n/g, '\n').split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
}

export function validateTemplate(files: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const name of ['requirements.md', 'design.md', 'tasks.md']) {
    const text = files[name];
    if (text === undefined) { problems.push(`${name} missing`); continue; }
    if (!text.split(/\r?\n/)[0].startsWith(TEMPLATE_LINE_START)) problems.push(`${name} template line`);
  }
  const req = files['requirements.md'] ?? '';
  const rows = tableRows(req);
  const separators = rows.filter((r) => r.every((c) => /^:?-+:?$/.test(c)));
  const [header, , ...body] = rows;
  if (!header || header.join('|') !== TABLE_HEADER.join('|') || separators.length !== 1) problems.push('table header');
  if (body.length < MIN_EXAMPLE_ROWS) problems.push('example rows');
  for (const row of body) {
    if (row.length !== TABLE_HEADER.length || !row.every((c) => PLACEHOLDER_CELL.test(c))) problems.push(`row not placeholders: ${row.join(' | ')}`);
  }
  // exactly one table: the table lines must be one block
  const lines = req.replace(/\r\n/g, '\n').split('\n');
  const tableLineIdx = lines.map((l, i) => (l.trim().startsWith('|') ? i : -1)).filter((i) => i >= 0);
  if (tableLineIdx.some((v, i) => i > 0 && v !== tableLineIdx[i - 1] + 1)) problems.push('more than one table');
  if (!/^# .*<[^<>]+>/m.test(req)) problems.push('title placeholder');
  // instruction length: the lines between the first heading after the title and the table
  const firstTable = tableLineIdx[0] ?? lines.length;
  const titleIdx = lines.findIndex((l) => l.startsWith('# '));
  const instructions = lines.slice(titleIdx + 1, firstTable).filter((l) => l.trim() !== '');
  if (instructions.length > MAX_INSTRUCTION_LINES + 1) problems.push('instructions too long');   // + the heading line
  for (const name of ['design.md', 'tasks.md']) {
    const text = files[name] ?? '';
    if (/\bTasks? \d+\b/i.test(text) || text.includes('core/')) problems.push(`${name} refers to this repository`);
    for (const w of REAL_LABEL_WORDS) if (new RegExp(`\\b${w}\\b`, 'i').test(text)) problems.push(`${name} names ${w}`);
  }
  for (const text of Object.values(files)) {
    if (/\d+(?:\.\d+)?\s*%/.test(text)) problems.push('measured value');
  }
  return problems;
}

export function docPaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const s = m[1];
    if (/[<*\s]/.test(s) || s.includes('://')) continue;
    if (!(s.includes('/') || /\.(json|md|ts|js)$/.test(s))) continue;
    out.push(s.replace(/\/$/, ''));
  }
  return out;
}

export function validateDocs(text: string, exists: (p: string) => boolean, mustList: string[]): string[] {
  const problems: string[] = [];
  for (const u of DOC_URLS) if (!text.includes(u)) problems.push(`url ${u}`);
  if (!text.includes(DOC_CHECK_DATE)) problems.push('date');
  if (!text.includes(HEADLESS_LINE)) problems.push('headless line');
  if (!text.includes('npm publish')) problems.push('npm publish');
  if (!text.includes('Add Custom Power')) problems.push('install steps');
  for (const p of docPaths(text)) {
    if (!DOC_PATH_ALLOW_LIST.includes(p) && !exists(p)) problems.push(`missing path ${p}`);
  }
  for (const name of mustList) if (!text.includes(name)) problems.push(`not listed: ${name}`);
  return problems;
}

export function validateSteering(steering: string, skill: string): string[] {
  const problems: string[] = [];
  const lines = steering.replace(/\r\n/g, '\n').split('\n');
  const end = lines.indexOf('---', 1);
  const front = lines[0] === '---' && end > 0 ? lines.slice(1, end) : [];
  for (const l of STEERING_FRONT_MATTER_LINES) if (!front.includes(l)) problems.push(`front matter ${l}`);
  if (/not in the repository/i.test(steering)) problems.push('stale text');
  for (const term of SHARED_API_TERMS) {
    if (!steering.includes(term)) problems.push(`steering lacks ${term}`);
    if (!skill.includes(term)) problems.push(`skill lacks ${term}`);
  }
  return problems;
}

// ---- data ----

const pkg = readJson('package.json');
const skillText = (name: string): string => readText(`${POWER_DIR}/skills/${name}/SKILL.md`);

describe('plugin.json (A1)', () => {
  it('has the required fields, the fixed metadata and the keywords', () => {
    expect(validatePlugin(readJson(`${POWER_DIR}/plugin.json`))).toEqual([]);
  });
  it('A10: fails when a field is removed', () => {
    const p = readJson(`${POWER_DIR}/plugin.json`);
    for (const key of Object.keys(p)) expect(validatePlugin(without(p, key)), key).not.toEqual([]);
    expect(validatePlugin({ ...p, keywords: (p.keywords as string[]).slice(1) })).not.toEqual([]);
  });
});

describe('mcp.json (A2)', () => {
  it('starts the bin of this package through npx', () => {
    expect(validateMcpJson(readJson(`${POWER_DIR}/mcp.json`), pkg)).toEqual([]);
  });
  it('A10: fails when a field is removed or the bin name changes', () => {
    const m = readJson(`${POWER_DIR}/mcp.json`);
    expect(validateMcpJson(without(m, '$schema'), pkg)).not.toEqual([]);
    expect(validateMcpJson(without(m, 'mcpServers'), pkg)).not.toEqual([]);
    const s = (m.mcpServers as Record<string, Json>)[SERVER_NAME];
    for (const key of ['type', 'command', 'args']) {
      expect(validateMcpJson({ ...m, mcpServers: { [SERVER_NAME]: without(s, key) } }, pkg), key).not.toEqual([]);
    }
    expect(validateMcpJson(m, { ...pkg, bin: { other: './dist/mcp.js' } })).not.toEqual([]);
  });
});

describe('skills (A3, A4)', () => {
  it('the power holds exactly the listed files', () => {
    expect(listFiles(POWER_DIR)).toEqual(POWER_FILES);
  });
  it('every SKILL.md has front matter with name equal to its folder and a description', () => {
    for (const name of SKILL_NAMES) expect(validateSkill(name, skillText(name)), name).toEqual([]);
  });
  it('A10: a skill without name or description fails', () => {
    const text = skillText('integrate');
    expect(validateSkill('integrate', text.replace(/^name:.*\n/m, ''))).not.toEqual([]);
    expect(validateSkill('integrate', text.replace(/^description:.*\n/m, ''))).not.toEqual([]);
    expect(validateSkill('other', text)).not.toEqual([]);
    expect(validateSkill('integrate', text.replace(/^---\r?\n/, ''))).not.toEqual([]);
  });
  it('the skills name their required topics', () => {
    const need: Record<string, string[]> = {
      integrate: ['expectEvents', 'listen', 'teach.html', 'npm publish', 'loadSounds', 'storageKey'],
      'tune-sounds': ['teach', 'score', 'spectrogram', 'background', 'startS', 'endS', 'npm publish'],
      'new-app': [...TABLE_HEADER, 'expectEvents'],
    };
    for (const [name, words] of Object.entries(need)) {
      const text = skillText(name);
      for (const w of words) expect(text, `${name} lacks ${w}`).toContain(w);
    }
  });
  it('no skill states a measured accuracy or line count, and all are English ASCII text', () => {
    for (const name of SKILL_NAMES) {
      const text = skillText(name);
      expect(text, name).not.toMatch(/\d\s*%/);
      expect(text, name).not.toMatch(/\b\d+\s+lines\b/i);
      expect(text, name).not.toMatch(/[^\x09\x0a\x0d\x20-\x7e\u2013\u2192]/);
    }
  });
});

describe('agents (A5, A6, A7)', () => {
  const tuner = (): Json => readJson(`${AGENTS_DIR}/sound-tuner.json`);
  const integrator = (): Json => readJson(`${AGENTS_DIR}/integrator.json`);
  const serverNames = (): string[] => Object.keys((readJson('.kiro/settings/mcp.json').mcpServers as Json));

  it('sound-tuner.json is valid', () => {
    expect(validateTuner(tuner())).toEqual([]);
    expect(validatePromptTopics(tuner(), TUNER_PROMPT_WORDS)).toEqual([]);
  });
  it('integrator.json is valid', () => {
    expect(validateIntegrator(integrator())).toEqual([]);
    expect(validatePromptTopics(integrator(), INTEGRATOR_PROMPT_WORDS)).toEqual([]);
  });
  it('every MCP name in both agents is a tool of TOOLS on a server of .kiro/settings/mcp.json', () => {
    expect(serverNames()).toContain(SERVER_NAME);
    expect(validateMcpNames(tuner(), serverNames())).toEqual([]);
    expect(validateMcpNames(integrator(), serverNames())).toEqual([]);
    expect(mcpNames(tuner()).length).toBeGreaterThan(0);
  });
  it('sound-tuner has no shell and no web tool; integrator has no web and no teach, score or spectrogram', () => {
    expect(tuner().tools).not.toContain('shell');
    expect(tuner().tools).not.toContain('web');
    expect(tuner().tools).not.toContain('@mcp-ears/listen');
    for (const t of ['web', '@mcp-ears/teach', '@mcp-ears/score', '@mcp-ears/spectrogram']) expect(integrator().tools).not.toContain(t);
  });
  it('A10: removing a field, adding shell, or naming an unknown tool fails', () => {
    for (const key of Object.keys(tuner())) expect(validateTuner(without(tuner(), key)), key).not.toEqual([]);
    for (const key of Object.keys(integrator())) expect(validateIntegrator(without(integrator(), key)), key).not.toEqual([]);
    const t = tuner();
    const rules = (t.permissions as { rules: Rule[] }).rules;
    expect(validateTuner({ ...t, permissions: { rules: [...rules, { capability: 'shell', match: ['**'], effect: 'allow' }] } })).not.toEqual([]);
    expect(validateTuner({ ...t, permissions: { rules: [...rules, { capability: 'fs_write', match: ['src/**'], effect: 'allow' }] } })).not.toEqual([]);
    expect(validateTuner({ ...t, permissions: { rules: [{ capability: 'fs_read', match: ['**'] }] } })).not.toEqual([]);
    expect(validateMcpNames({ tools: ['@mcp-ears/nope'] }, [SERVER_NAME])).not.toEqual([]);
    expect(validateMcpNames({ tools: ['@other/teach'] }, [SERVER_NAME])).not.toEqual([]);
    expect(validatePromptTopics({ prompt: '' }, TUNER_PROMPT_WORDS)).not.toEqual([]);
    const i = integrator();
    const irules = (i.permissions as { rules: Rule[] }).rules;
    expect(validateIntegrator({ ...i, permissions: { rules: [...irules, { capability: 'shell', match: ['rm *'], effect: 'allow' }] } })).not.toEqual([]);
  });
});

describe('_new-app template (A8)', () => {
  const load = (): Record<string, string> => Object.fromEntries(
    ['requirements.md', 'design.md', 'tasks.md'].map((n) => [n, readText(`${TEMPLATE_DIR}/${n}`)]),
  );
  it('has three files, the template line, one table of placeholders and no real label', () => {
    expect(listFiles(TEMPLATE_DIR)).toEqual(['design.md', 'requirements.md', 'tasks.md']);
    expect(validateTemplate(load())).toEqual([]);
  });
  it('A10: breaking the template fails', () => {
    const files = load();
    const req = files['requirements.md'];
    expect(validateTemplate({ ...files, 'design.md': files['design.md'].split('\n').slice(1).join('\n') })).not.toEqual([]);
    expect(validateTemplate({ ...files, 'requirements.md': req.replace('Sound name', 'Name') })).not.toEqual([]);
    expect(validateTemplate({ ...files, 'requirements.md': req.replace(/<sound name>/, 'clap') })).not.toEqual([]);
    expect(validateTemplate({ ...files, 'requirements.md': `${req}\n\n| a | b |\n|---|---|\n| <x> | <y> |\n` })).not.toEqual([]);
    expect(validateTemplate({ ...files, 'tasks.md': `${files['tasks.md']}\nTask 7 clap\n` })).not.toEqual([]);
    const { 'tasks.md': _omitted, ...rest } = files;
    expect(validateTemplate(rest)).not.toEqual([]);
  });
});

describe('docs/kiro.md (A9)', () => {
  const exists = (p: string): boolean => existsSync(join(ROOT, p));
  const mustList = (): string[] => [
    ...readdirSync(join(ROOT, '.kiro/hooks')),
    ...readdirSync(join(ROOT, '.kiro/steering')).filter((n) => n !== '.gitkeep'),
    ...readdirSync(join(ROOT, '.kiro/agents')),
    ...readdirSync(join(ROOT, '.kiro/specs')),
  ];
  it('lists the URLs, the install steps, the headless run and only existing paths', () => {
    expect(validateDocs(readText('docs/kiro.md'), exists, mustList())).toEqual([]);
  });
  it('A10: a missing URL, date, path or entry fails', () => {
    const text = readText('docs/kiro.md');
    for (const u of DOC_URLS) expect(validateDocs(text.replace(u, ''), exists, mustList()), u).not.toEqual([]);
    expect(validateDocs(text.replace(DOC_CHECK_DATE, ''), exists, mustList())).not.toEqual([]);
    expect(validateDocs(`${text}\n\`docs/does-not-exist.md\`\n`, exists, mustList())).not.toEqual([]);
    expect(validateDocs(text, exists, [...mustList(), 'no-such-file.json'])).not.toEqual([]);
  });
  it('docPaths skips placeholders, globs, URLs and commands', () => {
    expect(docPaths('`a/b.md` `x/<y>` `s/**` `https://x.y/z` `npm run dev` `dir/`')).toEqual(['a/b.md', 'dir']);
  });
});

describe('integrate.md and the integrate skill (A11)', () => {
  it('say the same about the browser API, and the steering keeps its front matter', () => {
    expect(validateSteering(readText('.kiro/steering/integrate.md'), skillText('integrate'))).toEqual([]);
  });
  it('A10: stale text, lost front matter or a missing term fails', () => {
    const steering = readText('.kiro/steering/integrate.md');
    const skill = skillText('integrate');
    expect(validateSteering(`${steering}\nThe browser layer is not in the repository.\n`, skill)).not.toEqual([]);
    expect(validateSteering(steering.replace('inclusion: fileMatch', 'inclusion: always'), skill)).not.toEqual([]);
    expect(validateSteering(steering, skill.replaceAll('storageKey', ''))).not.toEqual([]);
    expect(validateSteering(steering.replaceAll('exportSounds', ''), skill)).not.toEqual([]);
  });
});
