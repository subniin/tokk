// Build and dev server for the npm package (Task 13).
//   npm run build   writes dist/tokk.js, dist/node.js, dist/mcp.js (the tokk-mcp bin, Task 18) and dist/types/**
//   npm run dev     rebuilds dist/tokk.js and dist/teach-page.js (the developer page teach.html, Task 17) on every
//                   save and serves the repository root on localhost. The package build does not write teach-page.js.
// The package build (npm run build) minifies dist/tokk.js (with its embedded Worker and worklet) and dist/mcp.js (Task 19).
// dist/node.js stays readable, and npm run dev does not minify. No source maps are shipped.
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
async function bundleWorker(minify: boolean): Promise<{ source: string; inputs: string[] }> {
  const result = await esbuild({
    absWorkingDir: ROOT,
    entryPoints: [join(ROOT, 'web', 'worker.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    legalComments: 'none',
    logLevel: 'warning',
    minify,
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

// minify is false by default, the same default as workerSourcePlugin(), so the two return the same text.
export async function bundleWorkerSource(minify = false): Promise<string> {
  return (await bundleWorker(minify)).source;
}

// Resolves the reserved module `tokk:worker-source` to the Worker source as a string.
// The Worker is bundled inside onLoad, so watch mode rebuilds it when a Worker file changes.
export function workerSourcePlugin(minify = false): Plugin {
  return {
    name: 'tokk-worker-source',
    setup(b) {
      b.onResolve({ filter: /^tokk:worker-source$/ }, () => ({ path: WORKER_SOURCE_MODULE, namespace: WORKER_SOURCE_NAMESPACE }));
      b.onLoad({ filter: /.*/, namespace: WORKER_SOURCE_NAMESPACE }, async () => {
        const { source, inputs } = await bundleWorker(minify);
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
// The package build: the same, minified, with a minified Worker source inside.
export const BROWSER_PACKAGE_OPTIONS: BuildOptions = { ...BROWSER_OPTIONS, minify: true, plugins: [workerSourcePlugin(true)] };

// The developer teach page (Task 17). Built by the dev server only: the npm package does not ship teach.html.
export const TEACH_PAGE_OPTIONS: BuildOptions = {
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
  minify: true,
};

// Apps (Task 21): every apps/<name>/src/main.ts is bundled to apps/<name>/dist/app.js. The alias maps the package name
// `tokk` to web/index.ts, so an app imports exactly what a user of the package imports.
const APPS_DIR = join(ROOT, 'apps');
const APP_NAME_RULE = /^[a-z0-9-]+$/;
const TOKK_ALIAS_TARGET = join(ROOT, 'web', 'index.ts');

// Names of the apps below appsDir, sorted. A missing folder gives []. Files are skipped, a directory without
// src/main.ts is skipped with a warning, and a name outside the rule throws.
export function findApps(appsDir: string = APPS_DIR): string[] {
  if (!existsSync(appsDir)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!existsSync(join(appsDir, entry.name, 'src', 'main.ts'))) {
      console.warn(`Skipping ${join(appsDir, entry.name)}: it has no src/main.ts.`);
      continue;
    }
    if (!APP_NAME_RULE.test(entry.name)) {
      throw new Error(`The app folder name "${entry.name}" is not allowed: use lowercase letters, digits and hyphens only.`);
    }
    names.push(entry.name);
  }
  return names.sort();
}

// The options of one app bundle. appDir is the absolute folder of the app. The result is the same for the package
// build (minify true) and the dev server (minify false), as for dist/tokk.js.
export function appBuildOptions(appDir: string, opts: { minify: boolean; outfile: string }): BuildOptions {
  return {
    ...SHARED_OPTIONS,
    entryPoints: [join(appDir, 'src', 'main.ts')],
    outfile: opts.outfile,
    platform: 'browser',
    alias: { tokk: TOKK_ALIAS_TARGET },
    minify: opts.minify,
    plugins: [workerSourcePlugin(opts.minify)],
  };
}

const appOutfile = (appsDir: string, name: string): string => join(appsDir, name, 'dist', 'app.js');
const failedApp = (name: string, e: unknown): Error => new Error(`App "${name}" failed to build: ${e instanceof Error ? e.message : String(e)}`);

// Builds every app, minified, one after the other. A failure names the app and stops the build.
export async function buildApps(appsDir: string = APPS_DIR): Promise<string[]> {
  const names = findApps(appsDir);
  for (const name of names) {
    rmSync(join(appsDir, name, 'dist'), { recursive: true, force: true });
    try {
      await esbuild(appBuildOptions(join(appsDir, name), { minify: true, outfile: appOutfile(appsDir, name) }));
    } catch (e) {
      throw failedApp(name, e);
    }
  }
  return names;
}

// One context per app, unminified, built once and then rebuilt on save. An app that fails at start fails the call.
export async function watchApps(appsDir: string = APPS_DIR): Promise<{ apps: string[]; dispose(): Promise<void> }> {
  const apps = findApps(appsDir);
  const contexts: { dispose(): Promise<void> }[] = [];
  const dispose = async (): Promise<void> => { await Promise.all(contexts.splice(0).map((c) => c.dispose())); };
  try {
    for (const name of apps) {
      rmSync(join(appsDir, name, 'dist'), { recursive: true, force: true });
      const ctx = await context(appBuildOptions(join(appsDir, name), { minify: false, outfile: appOutfile(appsDir, name) }));
      contexts.push(ctx);
      try {
        await ctx.rebuild();
      } catch (e) {
        throw failedApp(name, e);
      }
      await ctx.watch();
    }
  } catch (e) {
    await dispose();
    throw e;
  }
  return { apps, dispose };
}
export async function buildBundles(): Promise<void> {
  await Promise.all([esbuild(BROWSER_PACKAGE_OPTIONS), esbuild(NODE_OPTIONS), esbuild(MCP_OPTIONS), buildApps()]);
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
  const appsHandle = await watchApps();
  const stop = async () => {
    await appsHandle.dispose();
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
  console.log(`Serving ${ROOT} at http://${DEV_SERVER_HOST}:${port}/ (dist/tokk.js, dist/teach-page.js and ${appsHandle.apps.length} app bundle(s) are rebuilt on save; restart to add an app). Press Ctrl+C to stop.`);
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
