import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { build as esbuild } from 'esbuild';
import { build, buildBundles, bundleWorkerSource, workerSourcePlugin } from '../scripts/build';

const BUILD_TEST_TIMEOUT_MS = 120_000;
const PACK_TEST_TIMEOUT_MS = 60_000;
const TSC_TEST_TIMEOUT_MS = 120_000;
const NODE_CHILD_TIMEOUT_MS = 30_000;

const ROOT = resolve('.');
const TOKK_JS = join(ROOT, 'dist', 'tokk.js');
const NODE_JS = join(ROOT, 'dist', 'node.js');
const TSC_BIN = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const PROBE_FILE = join(ROOT, 'core', `__dom-probe-${process.pid}.ts`);

// Same list as test/public-api.test.ts.
const NODE_EXPORT_NAMES = [
  'ExpectEventsError', 'TooFewExamplesError', 'expectEvents', 'readWavFile', 'teachFromDir', 'writeWavFile',
];
// Task 14 adds `listen` here and to web/index.ts.
const TOKK_EXPORT_NAMES = ['createEngine', 'knnClassifier', 'loadSounds', 'readWav', 'runSamples', 'writeWav'];

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

  it('dist/tokk.js has no fs, path, zlib, process, node: or require', () => {
    const text = readFileSync(TOKK_JS, 'utf8');
    expect(text).not.toMatch(/\bprocess\b/);
    expect(text).not.toMatch(/\brequire\s*\(/);
    expect(text).not.toMatch(/["']node:/);
    const specifiers = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of specifiers) expect(spec).not.toMatch(/^(fs|path|zlib)(\/|$)/);
    expect(text).not.toMatch(/\b(?:fs|path|zlib)\b\s*["']\s*[;)]/);
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
    const before = [readFileSync(TOKK_JS), readFileSync(NODE_JS)];
    await buildBundles();
    expect(readFileSync(TOKK_JS).equals(before[0])).toBe(true);
    expect(readFileSync(NODE_JS).equals(before[1])).toBe(true);
  }, BUILD_TEST_TIMEOUT_MS);
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

  it('is an IIFE with no import or export, and answers ping with pong', async () => {
    const source = await bundleWorkerSource();
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/^\s*export\b/m);
    expect(source).toMatch(/^(?:"use strict";\s*)?\(\(\)\s*=>\s*\{[\s\S]*\}\)\(\);\s*$/);

    const { scope, listeners, posted } = runWorker();
    const context = vm.createContext({ self: scope });
    vm.runInContext(source, context);
    expect(listeners.length).toBe(1);

    listeners[0]({ data: { type: 'ping' } });
    expect(posted).toEqual([{ type: 'pong' }]);

    for (const data of [{ type: 'other' }, null, undefined, 'ping', 42, {}]) {
      expect(() => listeners[0]({ data })).not.toThrow();
    }
    expect(posted).toEqual([{ type: 'pong' }]);
  });

  it('is put into a factory bundle by the plugin, and the factory builds a Blob URL Worker', async () => {
    const result = await esbuild({
      entryPoints: [join(ROOT, 'web', 'worker-factory.ts')],
      bundle: true, write: false, format: 'iife', globalName: 'Factory', platform: 'browser', target: 'es2022',
      plugins: [workerSourcePlugin()], logLevel: 'silent',
    });
    const code = result.outputFiles[0].text;
    expect(code).toContain('createObjectURL');
    expect(code).toContain('pong');

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
  it('npm pack --dry-run lists only dist/**, package.json, README.md and LICENSE', () => {
    const r = spawnSync('npm pack --dry-run --json', {
      cwd: ROOT, encoding: 'utf8', shell: true, timeout: PACK_TEST_TIMEOUT_MS,
    });
    expect(r.status, r.stderr).toBe(0);
    const files: string[] = JSON.parse(r.stdout)[0].files.map((f: { path: string }) => f.path.replace(/\\/g, '/'));
    for (const p of files) {
      expect(p === 'package.json' || p === 'README.md' || p === 'LICENSE' || p.startsWith('dist/'), p).toBe(true);
    }
    for (const required of ['dist/tokk.js', 'dist/node.js', 'package.json', 'README.md', 'LICENSE']) {
      expect(files, required).toContain(required);
    }
    for (const forbidden of ['test/', 'fixtures/', '.kiro/', 'core/', 'web/', 'node/', 'docs/']) {
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
