// Task 19: package.json metadata, prepack, engines and the power's version (tests M1 and M2).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './web/paths';

const REQUIRED_KEYWORDS = ['sound', 'audio', 'microphone', 'sound control', 'clap', 'whistle', 'sound detection', 'audio events', 'web audio', 'tokk', 'mcp'];

type Json = Record<string, unknown>;

function readJson(...parts: string[]): Json {
  return JSON.parse(readFileSync(join(REPO_ROOT, ...parts), 'utf8')) as Json;
}

// Returns one problem text per missing or wrong field.
export function validateMeta(pkg: Json, pluginVersion: string): string[] {
  const p: string[] = [];
  if (pkg.name !== 'tokk') p.push('name');
  if (pkg.version !== '0.1.0') p.push('version');
  if (pkg.version !== pluginVersion) p.push('version differs from plugin.json');
  if (typeof pkg.description !== 'string' || pkg.description.trim() === '') p.push('description');
  const kw = Array.isArray(pkg.keywords) ? pkg.keywords : [];
  for (const k of REQUIRED_KEYWORDS) if (!kw.includes(k)) p.push(`keyword ${k}`);
  if (JSON.stringify(pkg.repository) !== JSON.stringify({ type: 'git', url: 'git+https://github.com/subniin/tokk.git' })) p.push('repository');
  if (pkg.homepage !== 'https://github.com/subniin/tokk#readme') p.push('homepage');
  if (JSON.stringify(pkg.bugs) !== JSON.stringify({ url: 'https://github.com/subniin/tokk/issues' })) p.push('bugs');
  if (pkg.license !== 'MIT') p.push('license');
  if (pkg.author !== 'subniin') p.push('author');
  if (JSON.stringify(pkg.engines) !== JSON.stringify({ node: '>=20' })) p.push('engines');
  if ((pkg.scripts as Json | undefined)?.prepack !== 'npm run build') p.push('scripts.prepack');
  if (pkg.dependencies !== undefined) p.push('dependencies present');
  if (pkg.peerDependencies !== undefined) p.push('peerDependencies present');
  return p;
}

describe('package.json metadata (Task 19)', () => {
  const pkg = readJson('package.json');
  const plugin = readJson('powers', 'tokk', 'plugin.json');

  it('M1: every field of requirement 3.1, prepack, engines, no dependencies, same version as plugin.json', () => {
    expect(validateMeta(pkg, String(plugin.version))).toEqual([]);
  });

  it('M1: the fields that must not change are unchanged', () => {
    expect(pkg.main).toBe('./dist/tokk.js');
    expect(pkg.types).toBe('./dist/types/web/index.d.ts');
    expect(pkg.bin).toEqual({ 'tokk-mcp': './dist/mcp.js' });
    expect(pkg.files).toEqual(['dist', 'README.md', 'LICENSE']);
    expect(pkg.sideEffects).toBe(false);
  });

  it('M2: removing or changing one field is reported', () => {
    const version = String(plugin.version);
    for (const field of ['description', 'keywords', 'repository', 'homepage', 'bugs', 'license', 'author', 'engines']) {
      const copy = { ...pkg };
      delete copy[field];
      expect(validateMeta(copy, version), field).toContain(field === 'keywords' ? 'keyword sound' : field);
    }
    const noPrepack = { ...pkg, scripts: { ...(pkg.scripts as Json), prepack: undefined } };
    expect(validateMeta(noPrepack, version)).toContain('scripts.prepack');
    expect(validateMeta({ ...pkg, dependencies: { x: '1' } }, version)).toContain('dependencies present');
    expect(validateMeta(pkg, '9.9.9')).toContain('version differs from plugin.json');
  });
});
