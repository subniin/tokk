import { describe, expect, it } from 'vitest';
import { build as esbuild } from 'esbuild';
import { findNodeGlobalUse } from './helpers/node-globals';

// findNodeGlobalUse is a text check, not a parser. It cannot see a trick such as `const g = globalThis; g['pro' + 'cess']`.
// The build test guards against accidents, not against a determined workaround.
// The text `"process.env"` inside a string is flagged on purpose: it is the safer side.

const FLAGGED: [name: string, snippet: string][] = [
  ['process.env', 'const a = process.env.X;'],
  ['process.nextTick', 'process.nextTick(f);'],
  ['process.platform', 'if (process.platform === "win32") run();'],
  ['process?.', 'const e = process?.env;'],
  ['process[', 'const e = process["env"];'],
  ['typeof process', 'if (typeof process !== "undefined") run();'],
  ['globalThis.process', 'const p = globalThis.process;'],
  ['window.process', 'const p = window.process;'],
  ['self.process', 'const p = self.process;'],
  ['require(', 'const fs = require("x");'],
  ['require (', 'const fs = require ("x");'],
  ['__dirname', 'const d = __dirname;'],
  ['__filename', 'const f = __filename;'],
  ['module.exports', 'module.exports = { a: 1 };'],
  ['exports.x =', 'exports.a = 1;'],
  ['import from node:', 'import { x } from "node:fs";'],
  ['import side effect node:', 'import "node:fs";'],
  ['dynamic import node:', 'const m = await import("node:fs");'],
  ['from bare fs', "import fs from 'fs';"],
  ['from fs subpath', 'import { readFile } from "fs/promises";'],
  ['from bare path', 'import { join } from "path";'],
  ['from path subpath', 'import posix from "path/posix";'],
  ['from bare zlib', 'import z from "zlib";'],
  ['export from fs', 'export { readFileSync } from "fs";'],
  ['dynamic import fs', 'const m = await import("fs");'],
  ['process.env in a string', 'const s = "process.env";'],
];

const NOT_FLAGGED: [name: string, snippet: string][] = [
  ['method definition', 'process(inputs) { return true; }'],
  ['class with a process method', 'class X extends AudioWorkletProcessor { process(inputs) { return true; } }'],
  ['call of a method named process', 'this.process(x); processor.process([[1]], [[]]);'],
  ['property read after a dot', 'const f = this.process.bind(this);'],
  ['registerProcessor', 'registerProcessor("tokk-capture", TokkCapture);'],
  ['processorOptions', 'const n = options.processorOptions.chunkFrames;'],
  ['AudioWorkletProcessor', 'class A extends AudioWorkletProcessor {}'],
  ['English comment', '// we process the samples in the Worker.\nconst a = 1;'],
  ['English comment with a full stop', '// Nothing is stored after the process. Then it ends.'],
  ['sentence in a string', 'const s = "the process takes a while";'],
  ['processing', 'const processing = 1; processing.x = 2;'],
  ['subprocess', 'const subprocess = 1; subprocess.kill();'],
  ['a word that ends in fs', 'const tfs = 1; const paths = "a";'],
  ['relative import', 'import { a } from "./path";'],
  ['package that only starts with fs', 'import x from "fsevents-like";'],
  ['exports as a word', 'const text = "exports are listed below";'],
];

describe('findNodeGlobalUse', () => {
  it.each(FLAGGED)('flags %s', (_name, snippet) => {
    expect(findNodeGlobalUse(snippet).length, snippet).toBeGreaterThan(0);
  });

  it.each(NOT_FLAGGED)('does not flag %s', (_name, snippet) => {
    expect(findNodeGlobalUse(snippet), snippet).toEqual([]);
  });

  it('returns the offending snippets, one entry per hit', () => {
    const hits = findNodeGlobalUse('const a = process.env.X;\nconst b = __dirname;');
    expect(hits.length).toBe(2);
    expect(hits[0]).toContain('process');
    expect(hits[1]).toContain('__dirname');
  });
});

describe('findNodeGlobalUse on bundler output', () => {
  async function bundle(contents: string): Promise<string> {
    const result = await esbuild({
      stdin: { contents, loader: 'ts', resolveDir: process.cwd() },
      bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
    });
    return result.outputFiles[0].text;
  }

  it('flags a bundle that contains process.env.X', async () => {
    const text = await bundle('export const x = process.env.X;');
    expect(findNodeGlobalUse(text).length).toBeGreaterThan(0);
  });

  it('does not flag a bundle of a class with a process(inputs) method', async () => {
    const text = await bundle('export class P { process(inputs: number[]) { return inputs.length > 0; } }\nexport const ok = new P().process([1]);');
    expect(findNodeGlobalUse(text)).toEqual([]);
  });
});
