// Reads a sounds file and checks that it is a sounds model (the same check as scripts/score.ts).

import { readFile } from 'node:fs/promises';
import type { SoundModel } from '../../core/types';
import { ToolError } from './errors';
import type { PathGuard } from './paths';

const MODEL_VERSION = 1;

export function isSoundModel(x: unknown): x is SoundModel {
  const m = x as { version?: unknown; examples?: unknown } | null;
  return typeof m === 'object' && m !== null && m.version === MODEL_VERSION && Array.isArray(m.examples);
}

export async function readSoundsFile(guard: PathGuard, arg: string, name = 'sounds'): Promise<SoundModel> {
  const path = await guard.resolveExisting(name, arg);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    throw new ToolError(`${name} file ${arg} cannot be read (${(e as { code?: string }).code ?? 'error'})`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ToolError(`${name} file ${arg} is not valid JSON`);
  }
  if (!isSoundModel(data)) {
    throw new ToolError(`${name} file ${arg} is not a sounds model (needs version ${MODEL_VERSION} and an examples array)`);
  }
  return data;
}