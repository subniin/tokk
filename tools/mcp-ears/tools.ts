// The tool list. One definition per tool: name, description, zod input shape, handler (Requirements 2, 4 to 6).
// A new tool (spectrogram, Task 9b) is one more entry in TOOLS.

import { stat, writeFile } from 'node:fs/promises';
import { relative, join, sep } from 'node:path';
import { z } from 'zod';
import { createEngine, type EngineEvent } from '../../core/engine';
import { readWavFile } from '../../node/files';
import { scoreDir } from '../../node/score';
import { teachFromDir } from '../../node/teach';
import { ToolError, withArg } from './errors';
import { formatListen, formatScore, formatTeach } from './format';
import type { PathGuard } from './paths';
import { readSoundsFile } from './sounds';

export type Content =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface ToolContext { guard: PathGuard }

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<Content[]>;
}

const DEFAULT_OUT_NAME = 'sounds.json';
const PARENT = '..';
const JSON_INDENT = 2;

const text = (t: string): Content[] => [{ type: 'text', text: t }];

// Defines a tool with typed arguments. The list holds the erased form.
function defineTool<S extends z.ZodRawShape>(def: {
  name: string;
  description: string;
  inputSchema: S;
  run(args: z.infer<z.ZodObject<S>>, ctx: ToolContext): Promise<Content[]>;
}): ToolDefinition {
  return def as unknown as ToolDefinition;
}

async function requireFolder(guard: PathGuard, arg: string, name: string): Promise<string> {
  const real = await guard.resolveExisting(name, arg);
  if (!(await stat(real)).isDirectory()) throw new ToolError(`${name} is not a folder: ${arg}`);
  return real;
}

const teach = defineTool({
  name: 'teach',
  description: 'Learn sounds from a folder of labelled recordings (one subfolder per sound, WAV files inside) and write sounds.json. Returns example counts, leave-one-out accuracy, confused pairs and warnings.',
  inputSchema: {
    dir: z.string().min(1).describe('Folder with one subfolder per sound label, relative to the working folder'),
    out: z.string().min(1).optional().describe('Where to write the sounds model. Default: dir/../sounds.json'),
  },
  async run({ dir, out }, { guard }) {
    const dirReal = await requireFolder(guard, dir, 'dir');
    const realRoot = await guard.root();
    let outReal: string;
    let outArg: string;
    if (out !== undefined) {
      outArg = out;
      outReal = await guard.resolveForWrite('out', out);
    } else {
      const wanted = join(dirReal, PARENT, DEFAULT_OUT_NAME);
      outArg = relative(realRoot, wanted);
      try {
        outReal = await guard.resolveForWrite('out', wanted);
      } catch (e) {
        if (e instanceof ToolError && e.message.includes('outside the working folder')) {
          throw new ToolError(`the default out (${dir}/../${DEFAULT_OUT_NAME}) is outside the working folder; pass out with a file inside it`);
        }
        throw e;
      }
    }
    const existing = await stat(outReal).then((s) => s, () => undefined);
    if (existing) {
      if (!existing.isFile()) throw new ToolError(`out is a folder or not a regular file: ${outArg}`);
      await readSoundsFile(guard, outArg, 'out');
    }
    const { model, report } = await withArg(dir, () => teachFromDir(dirReal));
    await writeFile(outReal, `${JSON.stringify(model, null, JSON_INDENT)}\n`);
    const outRel = relative(realRoot, outReal).split(sep).join('/');
    return text(formatTeach(report.labels.length, model.examples.length, outRel, report));
  },
});

const listen = defineTool({
  name: 'listen',
  description: 'Run a WAV recording through the sound engine with a sounds model and list what it hears: one line per sound or unknown sound, then a summary.',
  inputSchema: {
    wav: z.string().min(1).describe('16-bit PCM WAV recording'),
    sounds: z.string().min(1).describe('sounds.json written by teach'),
  },
  async run({ wav, sounds }, { guard }) {
    const wavPath = await guard.resolveExisting('wav', wav);
    const model = await readSoundsFile(guard, sounds);
    const audio = await withArg(wav, () => readWavFile(wavPath));
    const events: EngineEvent[] = [];
    const engine = createEngine({ sounds: model, sampleRate: audio.sampleRate, onEvent: (e) => events.push(e) });
    engine.push(audio.samples);
    engine.flush();
    return text(formatListen(events));
  },
});

const score = defineTool({
  name: 'score',
  description: 'Score a folder of labelled recordings (x.wav with x.json events) against a sounds model: precision and recall per label, confusion table, false positives per hour. Writes nothing.',
  inputSchema: {
    dir: z.string().min(1).describe('Folder with x.wav and x.json pairs'),
    sounds: z.string().min(1).describe('sounds.json written by teach'),
  },
  async run({ dir, sounds }, { guard }) {
    const dirReal = await requireFolder(guard, dir, 'dir');
    const model = await readSoundsFile(guard, sounds);
    const report = await withArg(dir, () => scoreDir(dirReal, model));
    if (report.perLabel.length === 0 && report.totalSeconds === 0) {
      throw new ToolError(`no labelled recordings found in ${dir}`);
    }
    return text(formatScore(report));
  },
});

export const TOOLS: ToolDefinition[] = [teach, listen, score];