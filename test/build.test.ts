import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { build as esbuild } from 'esbuild';
import { WORKLET_PROCESSOR_NAME } from '../web/worklet-source';
import { appBuildOptions, build, buildApps, buildBundles, bundleWorkerSource, findApps, watchApps, workerSourcePlugin } from '../scripts/build';
import type { BuildOptions } from 'esbuild';
import { TOOLS } from '../tools/mcp-ears/tools';
import { findNodeGlobalUse } from './helpers/node-globals';
import { makeFixtureApps, removeFixtureApps } from './helpers/fixture-apps';
import { mkdirSync } from 'node:fs';
import { vi } from 'vitest';

const BUILD_TEST_TIMEOUT_MS = 120_000;
const PACK_TEST_TIMEOUT_MS = 60_000;
const TSC_TEST_TIMEOUT_MS = 120_000;
const NODE_CHILD_TIMEOUT_MS = 30_000;
const MCP_START_TIMEOUT_MS = 30_000;   // Task 18: time allowed for the bundled server to start and answer
const MCP_TEST_TIMEOUT_MS = 60_000;
const UNSUPPORTED_RATE_HZ = 8000;
// Task 19 (requirement 5): the minified browser and MCP bundles must be at most this share of an unminified build.
const MINIFIED_MAX_SHARE_OF_UNMINIFIED = 0.75;   // ratio, no unit; the measured value is in design.md

const ROOT = resolve('.');
const TOKK_JS = join(ROOT, 'dist', 'tokk.js');
const NODE_JS = join(ROOT, 'dist', 'node.js');
const MCP_JS = join(ROOT, 'dist', 'mcp.js');   // Task 18
const TSC_BIN = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const PROBE_FILE = join(ROOT, 'core', `__dom-probe-${process.pid}.ts`);

// Same list as test/public-api.test.ts.
const NODE_EXPORT_NAMES = [
  'ExpectEventsError', 'TooFewExamplesError', 'expectEvents', 'readWavFile', 'teachFromDir', 'writeWavFile',
];
const TOKK_EXPORT_NAMES = ['createEngine', 'knnClassifier', 'listen', 'loadSounds', 'readWav', 'runSamples', 'writeWav'];

function removeProbe(): void {
  rmSync(PROBE_FILE, { force: true });
}

function runNode(script: string) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT, encoding: 'utf8', timeout: NODE_CHILD_TIMEOUT_MS,
  });
}

beforeAll(async () => {
  await build();
}, BUILD_TEST_TIMEOUT_MS);

afterAll(() => {
  removeProbe();
});

describe('build output', () => {
  it('writes the bundles and type files, and every exports target exists', () => {
    for (const p of [
      'dist/tokk.js', 'dist/node.js',
      'dist/types/web/index.d.ts', 'dist/types/node/index.d.ts', 'dist/types/core/index.d.ts',
    ]) {
      expect(existsSync(join(ROOT, p)), p).toBe(true);
    }
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    for (const entry of Object.values<Record<string, string>>(pkg.exports)) {
      for (const target of Object.values(entry)) expect(existsSync(join(ROOT, target)), target).toBe(true);
    }
    expect(existsSync(join(ROOT, 'dist', 'tokk.js.map'))).toBe(false);
  });

  // Task 15: the check changed from the word `process` to real Node global use. It is stricter about code
  // (`process.env.X` fails) and no longer fails on the Web Audio method name `process(inputs)`.
  it('dist/tokk.js has no Node global use, no fs, path, zlib, node: or require', () => {
    const text = readFileSync(TOKK_JS, 'utf8');
    expect(findNodeGlobalUse(text)).toEqual([]);
  });

  it('dist/tokk.js holds the Worker source and the worklet source', () => {
    const text = readFileSync(TOKK_JS, 'utf8');
    expect(text).toContain('replaceSounds');   // a name only the Worker entry bundle uses
    expect(text).toContain('createObjectURL');
    expect(text).toContain('registerProcessor');
    expect(text).toContain(WORKLET_PROCESSOR_NAME);
  });

  it('dist/tokk.js imports in Node with no DOM and exports the expected names', () => {
    const script = `
      delete globalThis.navigator;
      for (const name of ['document', 'window', 'navigator', 'Worker']) {
        if (typeof globalThis[name] !== 'undefined') throw new Error(name + ' is defined');
      }
      const m = await import(${JSON.stringify(pathToFileURL(TOKK_JS).href)});
      console.log(JSON.stringify(Object.keys(m).sort()));
    `;
    const r = runNode(script);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(TOKK_EXPORT_NAMES);
  });

  it('dist/node.js imports in Node and exports the public API names', () => {
    const r = runNode(`
      const m = await import(${JSON.stringify(pathToFileURL(NODE_JS).href)});
      console.log(JSON.stringify(Object.keys(m).sort()));
    `);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([...NODE_EXPORT_NAMES].sort());
  });

  it('two builds give byte-identical bundles', async () => {
    const before = [readFileSync(TOKK_JS), readFileSync(NODE_JS), readFileSync(MCP_JS)];   // Task 18 (1.6, B5): dist/mcp.js too
    await buildBundles();
    expect(readFileSync(TOKK_JS).equals(before[0])).toBe(true);
    expect(readFileSync(NODE_JS).equals(before[1])).toBe(true);
    expect(readFileSync(MCP_JS).equals(before[2])).toBe(true);
  }, BUILD_TEST_TIMEOUT_MS);
});

// Task 18, requirements 1.1 to 1.3 and 1.8 (tests B1 to B3).
describe('dist/mcp.js (Task 18)', () => {
  // A static import or export line, a side-effect import, or a call of import() or require() with one of the two packages.
  // Comments that show an import in a doc sample do not start a line with `import` and are not matched.
  const PKG = String.raw`["'\`](?:@modelcontextprotocol\/sdk|zod)["'\`/]`;
  const BARE_IMPORT = new RegExp(String.raw`^\s*(?:import|export)\b[^\n]*?\bfrom\s*${PKG}|^\s*import\s*${PKG}|(?<![*\w.])(?:import|require)\s*\(\s*${PKG}`, 'm');

  it('B1: exists after the build, starts with the shebang and has no bare SDK or zod import', () => {
    expect(existsSync(MCP_JS)).toBe(true);
    const text = readFileSync(MCP_JS, 'utf8');
    expect(text.startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(text).not.toMatch(BARE_IMPORT);
    // The check can fail: it catches each form.
    for (const sample of ['import { z } from "zod";', 'import "zod";', 'const m = await import("@modelcontextprotocol/sdk/x.js");', 'const r = require("zod");']) {
      expect(sample, sample).toMatch(BARE_IMPORT);
    }
  });

  it('B2: package.json bin points at an existing file and dependencies stay absent', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.bin).toEqual({ 'tokk-mcp': './dist/mcp.js' });
    expect(existsSync(join(ROOT, pkg.bin['tokk-mcp']))).toBe(true);
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it('B3: a copy of dist/mcp.js alone in a temporary folder starts and lists the tools of TOOLS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokk-mcp-'));
    let client: Client | undefined;
    try {
      const copy = join(dir, 'mcp.js');
      copyFileSync(MCP_JS, copy);
      const transport = new StdioClientTransport({ command: process.execPath, args: [copy], cwd: dir, stderr: 'pipe' });
      client = new Client({ name: 'build-test', version: '1.0.0' });
      await client.connect(transport, { timeout: MCP_START_TIMEOUT_MS });
      const { tools } = await client.listTools(undefined, { timeout: MCP_START_TIMEOUT_MS });
      expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    } finally {
      await client?.close().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  }, MCP_TEST_TIMEOUT_MS);
});

// Task 19 (requirement 5, B7): the browser and MCP bundles are minified, dist/node.js is not.
describe('minification (Task 19)', () => {
  const SHARED: BuildOptions = {
    absWorkingDir: ROOT, bundle: true, format: 'esm', target: 'es2022', legalComments: 'none', logLevel: 'silent', write: false, sourcemap: false,
  };
  const unminified = async (entry: string, platform: 'browser' | 'node', plugins: BuildOptions['plugins'] = []): Promise<string> => {
    const r = await esbuild({ ...SHARED, entryPoints: [join(ROOT, entry)], outfile: join(ROOT, 'dist', 'unminified.js'), platform, plugins });
    return (r.outputFiles ?? [])[0].text;
  };

  it('dist/tokk.js is at most MINIFIED_MAX_SHARE_OF_UNMINIFIED of an unminified build', async () => {
    const plain = await unminified('web/index.ts', 'browser', [workerSourcePlugin()]);
    expect(readFileSync(TOKK_JS, 'utf8').length).toBeLessThan(plain.length * MINIFIED_MAX_SHARE_OF_UNMINIFIED);
  }, BUILD_TEST_TIMEOUT_MS);

  it('dist/mcp.js is at most MINIFIED_MAX_SHARE_OF_UNMINIFIED of an unminified build', async () => {
    const plain = await unminified('tools/mcp-ears/server.ts', 'node');
    expect(readFileSync(MCP_JS, 'utf8').length).toBeLessThan((plain.length + '#!/usr/bin/env node\n'.length) * MINIFIED_MAX_SHARE_OF_UNMINIFIED);
  }, BUILD_TEST_TIMEOUT_MS);

  it('dist/node.js stays readable: it equals an unminified build', async () => {
    expect(readFileSync(NODE_JS, 'utf8')).toBe(await unminified('node/index.ts', 'node'));
  }, BUILD_TEST_TIMEOUT_MS);

  it('the minified Worker source is shorter than the readable one and keeps the protocol strings', async () => {
    const plain = await bundleWorkerSource();
    const small = await bundleWorkerSource(true);
    expect(small.length).toBeLessThan(plain.length * MINIFIED_MAX_SHARE_OF_UNMINIFIED);
    expect(small).toContain('replaceSounds');
    expect(small).not.toMatch(/^\\s*(?:import|export)\\b/m);
  });
});

describe('Worker source', () => {
  function runWorker() {
    const listeners: ((event: { data: unknown }) => void)[] = [];
    const posted: unknown[] = [];
    const scope = {
      addEventListener: (type: string, fn: (event: { data: unknown }) => void) => {
        if (type === 'message') listeners.push(fn);
      },
      postMessage: (message: unknown) => { posted.push(JSON.parse(JSON.stringify(message))); },
    };
    return { scope, listeners, posted };
  }

  it('is an IIFE with no import or export, answers a bad init with an error and attaches a handler to a connected port', async () => {
    const source = await bundleWorkerSource();
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/^\s*export\b/m);
    expect(source).toMatch(/^(?:"use strict";\s*)?\(\(\)\s*=>\s*\{[\s\S]*\}\)\(\);\s*$/);

    const { scope, listeners, posted } = runWorker();
    const context = vm.createContext({ self: scope });
    vm.runInContext(source, context);
    expect(listeners.length).toBe(1);

    const badInit = { type: 'init', sounds: {}, sampleRate: UNSUPPORTED_RATE_HZ, patterns: { default: [] }, mode: 'default' };
    listeners[0]({ data: badInit });
    expect(posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ type: 'error' });
    expect((posted[0] as { message: string }).message).toMatch(/sampleRate/);

    for (const data of [{ type: 'other' }, null, undefined, 'ping', 42, {}]) {
      expect(() => listeners[0]({ data })).not.toThrow();
    }
    expect(posted.every((m) => (m as { type: string }).type === 'error')).toBe(true);

    const port: { onmessage: ((event: { data: unknown }) => void) | null } = { onmessage: null };
    listeners[0]({ data: { type: 'connect', port } });
    expect(typeof port.onmessage).toBe('function');
    const before = posted.length;
    port.onmessage?.({ data: badInit });
    expect(posted.length).toBe(before + 1);
    expect(posted[before]).toMatchObject({ type: 'error' });
  });
  it('is put into a factory bundle by the plugin, and the factory builds a Blob URL Worker', async () => {
    const result = await esbuild({
      entryPoints: [join(ROOT, 'web', 'worker-factory.ts')],
      bundle: true, write: false, format: 'iife', globalName: 'Factory', platform: 'browser', target: 'es2022',
      plugins: [workerSourcePlugin()], logLevel: 'silent',
    });
    const code = result.outputFiles[0].text;
    expect(code).toContain('createObjectURL');
    expect(code).toContain('replaceSounds');

    // Nothing touches Blob, URL or Worker at import time: the context has none of them yet.
    const context: Record<string, unknown> = {};
    vm.createContext(context);
    const factory = vm.runInContext(`${code}\nFactory`, context) as { createTokkWorker(): { worker: unknown; dispose(): void } };

    const log: string[] = [];
    let blobParts: unknown[] = [];
    let blobType = '';
    context.Blob = class { constructor(parts: unknown[], options: { type: string }) { blobParts = parts; blobType = options.type; } };
    context.URL = {
      createObjectURL: () => { log.push('create'); return 'blob:fake'; },
      revokeObjectURL: (u: string) => { log.push(`revoke ${u}`); },
    };
    context.Worker = class {
      constructor(public url: string) { log.push(`worker ${url}`); }
      terminate() { log.push('terminate'); }
    };

    const handle = factory.createTokkWorker();
    expect(blobType).toBe('text/javascript');
    expect(blobParts).toEqual([await bundleWorkerSource()]);
    expect(log).toEqual(['create', 'worker blob:fake']);
    handle.dispose();
    expect(log).toEqual(['create', 'worker blob:fake', 'terminate', 'revoke blob:fake']);
  });
});

describe('package contents', () => {
  // Task 18 (1.8, B4): dist/mcp.js is listed, and nothing under powers/ or .kiro/.
  // Task 19 (B6): --ignore-scripts, so the prepack hook does not rebuild dist/ in the middle of the test run (package-meta.test.ts proves prepack exists); examples/ is forbidden.
  it('npm pack --dry-run lists only dist/**, package.json, README.md and LICENSE', () => {
    const r = spawnSync('npm pack --dry-run --ignore-scripts --json', {
      cwd: ROOT, encoding: 'utf8', shell: true, timeout: PACK_TEST_TIMEOUT_MS,
    });
    expect(r.status, r.stderr).toBe(0);
    const files: string[] = JSON.parse(r.stdout)[0].files.map((f: { path: string }) => f.path.replace(/\\/g, '/'));
    for (const p of files) {
      expect(p === 'package.json' || p === 'README.md' || p === 'LICENSE' || p.startsWith('dist/'), p).toBe(true);
    }
    for (const required of ['dist/tokk.js', 'dist/node.js', 'dist/mcp.js', 'package.json', 'README.md', 'LICENSE']) {
      expect(files, required).toContain(required);
    }
    for (const forbidden of ['test/', 'fixtures/', '.kiro/', 'powers/', 'core/', 'web/', 'node/', 'docs/', 'examples/']) {
      expect(files.filter((p) => p.startsWith(forbidden)), forbidden).toEqual([]);
    }
  }, PACK_TEST_TIMEOUT_MS);
});

describe('base TypeScript configuration', () => {
  it('rejects a core file that uses document', () => {
    try {
      writeFileSync(PROBE_FILE, 'export const probeTitle: string = document.title;\n');
      const r = spawnSync(process.execPath, [TSC_BIN, '--noEmit', '-p', 'tsconfig.json'], {
        cwd: ROOT, encoding: 'utf8', timeout: TSC_TEST_TIMEOUT_MS,
      });
      const output = `${r.stdout}${r.stderr}`;
      expect(r.status).not.toBe(0);
      expect(output).toContain('__dom-probe-');
      expect(output).toContain('document');
    } finally {
      removeProbe();
    }
  }, TSC_TEST_TIMEOUT_MS);
});

// Task 21: app bundles (tests B1 to B6). Every app is a fixture in a temporary folder, never under apps/.
describe('app bundles (Task 21)', () => {
  const APPS_BUILD_TIMEOUT_MS = 120_000;
  const WATCH_REBUILD_TIMEOUT_MS = 20_000;
  const WATCH_POLL_INTERVAL_MS = 100;
  const FIXTURE_NAMES = ['alpha', 'beta-2'];
  const dirs: string[] = [];
  const fixture = (names = FIXTURE_NAMES): string => { const d = makeFixtureApps(names); dirs.push(d); return d; };
  afterAll(() => { for (const d of dirs) removeFixtureApps(d); });

  it('B1: buildApps writes a minified dist/app.js with the Worker source and no bare import, Node global or node: use', async () => {
    const dir = fixture();
    expect(await buildApps(dir)).toEqual(FIXTURE_NAMES);
    for (const name of FIXTURE_NAMES) {
      const text = readFileSync(join(dir, name, 'dist', 'app.js'), 'utf8');
      expect(text).toContain('replaceSounds');
      expect(text).toContain('createObjectURL');
      expect(text).toContain('registerProcessor');
      expect(text).not.toMatch(/from\s*["']tokk["']/);
      expect(text).not.toMatch(/\bimport\s*["']tokk["']/);
      expect(text).not.toMatch(/(?:from|import)\s*\(?\s*["'](?:node:|fs["'/]|path["'/])/);
      expect(text).toContain('tokk import resolved');
      expect(findNodeGlobalUse(text)).toEqual([]);
    }
  }, APPS_BUILD_TIMEOUT_MS);

  it('B2: the app bundle is at most MINIFIED_MAX_SHARE_OF_UNMINIFIED of an unminified build', async () => {
    const dir = fixture(['alpha']);
    await buildApps(dir);
    const plain = await esbuild({ ...appBuildOptions(join(dir, 'alpha'), { minify: false, outfile: join(dir, 'alpha', 'dist', 'plain.js') }), write: false, logLevel: 'silent' });
    const small = readFileSync(join(dir, 'alpha', 'dist', 'app.js'), 'utf8').length;
    expect(small).toBeLessThan(plain.outputFiles[0].text.length * MINIFIED_MAX_SHARE_OF_UNMINIFIED);
  }, APPS_BUILD_TIMEOUT_MS);

  it('B3: two builds of the fixture give byte-identical app.js, and a stale file in dist/ is removed', async () => {
    const dir = fixture(['alpha']);
    await buildApps(dir);
    const first = readFileSync(join(dir, 'alpha', 'dist', 'app.js'));
    writeFileSync(join(dir, 'alpha', 'dist', 'stale.txt'), 'x');
    await buildApps(dir);
    expect(readFileSync(join(dir, 'alpha', 'dist', 'app.js')).equals(first)).toBe(true);
    expect(existsSync(join(dir, 'alpha', 'dist', 'stale.txt'))).toBe(false);
  }, APPS_BUILD_TIMEOUT_MS);

  it('B4: findApps skips a missing folder, files and a directory without main.ts (with a warning), rejects a bad name; a bad import names the app', async () => {
    expect(findApps(join(tmpdir(), 'tokk-does-not-exist-21'))).toEqual([]);
    const dir = fixture(['b', 'a']);
    writeFileSync(join(dir, 'README.md'), '# apps\n');
    mkdirSync(join(dir, 'empty-one'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(findApps(dir)).toEqual(['a', 'b']);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('empty-one');
    } finally { warn.mockRestore(); }
    const bad = fixture(['Bad_Name']);
    expect(() => findApps(bad)).toThrow(/Bad_Name.*lowercase letters, digits and hyphens/);
    const broken = fixture(['broken']);
    writeFileSync(join(broken, 'broken', 'src', 'main.ts'), "import { nothing } from 'tokk/node';\nconsole.log(nothing);\n");
    await expect(buildApps(broken)).rejects.toThrow(/broken/);
  }, APPS_BUILD_TIMEOUT_MS);

  it('B5: watchApps builds once unminified, rebuilds after an edit and disposes', async () => {
    const dir = fixture(['alpha']);
    const handle = await watchApps(dir);
    try {
      expect(handle.apps).toEqual(['alpha']);
      const out = join(dir, 'alpha', 'dist', 'app.js');
      expect(readFileSync(out, 'utf8')).toContain('tokk import resolved');
      expect(readFileSync(out, 'utf8').split('\n').length).toBeGreaterThan(100);   // not minified
      writeFileSync(join(dir, 'alpha', 'src', 'helper.ts'), "export const label = 'edited label';\n");
      const deadline = Date.now() + WATCH_REBUILD_TIMEOUT_MS;
      while (!readFileSync(out, 'utf8').includes('edited label') && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, WATCH_POLL_INTERVAL_MS));
      }
      expect(readFileSync(out, 'utf8')).toContain('edited label');
    } finally {
      await handle.dispose();
    }
  }, APPS_BUILD_TIMEOUT_MS);

  it('B6: .gitignore ignores site/ and apps/*/dist/ but not app sources or apps/README.md', () => {
    const ignored = (p: string): boolean => spawnSync('git', ['check-ignore', '-q', p], { cwd: ROOT }).status === 0;
    expect(ignored('site/index.html')).toBe(true);
    expect(ignored('apps/anything/dist/app.js')).toBe(true);
    expect(ignored('apps/anything/src/main.ts')).toBe(false);
    expect(ignored('apps/README.md')).toBe(false);
  });
});
