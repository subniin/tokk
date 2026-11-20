// Build and dev server for the npm package (Task 13).
//   npm run build   writes dist/tokk.js, dist/node.js, dist/mcp.js (the tokk-mcp bin, Task 18) and dist/types/**
//   npm run dev     rebuilds dist/tokk.js and dist/teach-page.js (the developer page teach.html, Task 17) on every
//                   save and serves the repository root on localhost. The package build does not write teach-page.js.
// The script writes only below dist/, writes no source maps and sends nothing over the network.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as esbuild, context } from 'esbuild';
import type { BuildOptions, Plugin } from 'esbuild';

export const DEV_SERVER_PORT = 5173;
export const DEV_SERVER_HOST = 'localhost';
const WORKER_SOURCE_MODULE = 'tokk:worker-source';
const WORKER_SOURCE_NAMESPACE = 'tokk-worker-source';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const TSC_BIN = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

const SHARED_OPTIONS: BuildOptions = {
  absWorkingDir: ROOT,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  legalComments: 'none',
  logLevel: 'warning',
  sourcemap: false,
};

// Bundles web/worker.ts to one IIFE string, in memory. `inputs` lists the files it read.
async function bundleWorker(): Promise<{ source: string; inputs: string[] }> {
  const result = await esbuild({
    absWorkingDir: ROOT,
    entryPoints: [join(ROOT, 'web', 'worker.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    legalComments: 'none',
    logLevel: 'warning',
    write: false,
    metafile: true,
    outfile: join(DIST, 'worker.js'),   // names the output only; nothing is written
  });
  if (result.outputFiles.length !== 1) throw new Error('The Worker bundle must be one file.');
  return {
    source: result.outputFiles[0].text,
    inputs: Object.keys(result.metafile.inputs).map((p) => resolve(ROOT, p)),
  };
}

export async function bundleWorkerSource(): Promise<string> {
  return (await bundleWorker()).source;
}

// Resolves the reserved module `tokk:worker-source` to the Worker source as a string.
// The Worker is bundled inside onLoad, so watch mode rebuilds it when a Worker file changes.
export function workerSourcePlugin(): Plugin {
  return {
    name: 'tokk-worker-source',
    setup(b) {
      b.onResolve({ filter: /^tokk:worker-source$/ }, () => ({ path: WORKER_SOURCE_MODULE, namespace: WORKER_SOURCE_NAMESPACE }));
      b.onLoad({ filter: /.*/, namespace: WORKER_SOURCE_NAMESPACE }, async () => {
        const { source, inputs } = await bundleWorker();
        return { contents: `export default ${JSON.stringify(source)};`, loader: 'js', watchFiles: inputs };
      });
    },
  };
}

const BROWSER_OPTIONS: BuildOptions = {
  ...SHARED_OPTIONS,
  entryPoints: [join(ROOT, 'web', 'index.ts')],
  outfile: join(DIST, 'tokk.js'),
  platform: 'browser',
  plugins: [workerSourcePlugin()],
};

// The developer teach page (Task 17). Built by the dev server only: the npm package does not ship teach.html.
const TEACH_PAGE_OPTIONS: BuildOptions = {
  ...SHARED_OPTIONS,
  entryPoints: [join(ROOT, 'web', 'teach-page.ts')],
  outfile: join(DIST, 'teach-page.js'),
  platform: 'browser',
  plugins: [workerSourcePlugin()],
};

const NODE_OPTIONS: BuildOptions = {
  ...SHARED_OPTIONS,
  entryPoints: [join(ROOT, 'node', 'index.ts')],
  outfile: join(DIST, 'node.js'),
  platform: 'node',
};

// The MCP server as the `tokk-mcp` bin (Task 18). The SDK and zod are devDependencies, so they are bundled in and the
// package keeps zero runtime dependencies. Not part of `npm run dev`.
const MCP_OPTIONS: BuildOptions = {
  ...SHARED_OPTIONS,
  entryPoints: [join(ROOT, 'tools', 'mcp-ears', 'server.ts')],
  outfile: join(DIST, 'mcp.js'),
  platform: 'node',
  banner: { js: '#!/usr/bin/env node' },
};

export async function buildBundles(): Promise<void> {
  await Promise.all([esbuild(BROWSER_OPTIONS), esbuild(NODE_OPTIONS), esbuild(MCP_OPTIONS)]);
}

function emitDeclarations(): void {
  const result = spawnSync(process.execPath, [TSC_BIN, '-p', 'tsconfig.build.json'], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Declaration build failed (tsc exit code ${result.status}):\n${result.stdout}${result.stderr}`);
  }
  const typesDir = join(DIST, 'types');
  if (!existsSync(typesDir) || readdirSync(typesDir).length === 0) {
    throw new Error('Declaration build wrote no files below dist/types.');
  }
}

export async function build(): Promise<void> {
  rmSync(DIST, { recursive: true, force: true });
  await buildBundles();
  emitDeclarations();
}

async function dev(): Promise<void> {
  rmSync(DIST, { recursive: true, force: true });
  const ctx = await context(BROWSER_OPTIONS);
  const teachCtx = await context(TEACH_PAGE_OPTIONS);
  const stop = async () => {
    await teachCtx.dispose();
    await ctx.dispose();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await ctx.rebuild();
  await teachCtx.rebuild();
  await ctx.watch();
  await teachCtx.watch();
  const { port } = await ctx.serve({ servedir: ROOT, host: DEV_SERVER_HOST, port: DEV_SERVER_PORT });
  console.log(`Serving ${ROOT} at http://${DEV_SERVER_HOST}:${port}/ (dist/tokk.js and dist/teach-page.js are rebuilt on save). Press Ctrl+C to stop.`);
}

async function main(): Promise<void> {
  try {
    if (process.argv.includes('--dev')) {
      await dev();
    } else {
      await build();
      console.log('Build finished: dist/tokk.js, dist/node.js, dist/mcp.js, dist/types/');
    }
  } catch (e) {
    console.error(`Build failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main();
}
