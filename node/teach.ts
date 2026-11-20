// teachFromDir: reads dir/<label>/*.wav and teaches from them through core/teach.ts (Task 8, Task 12).
// Reads local files only. Writes nothing and uses no network. The model holds feature vectors only.

import { readdir } from 'fs/promises';
import { join } from 'path';
import type { SoundModel } from '../core/types';
import { teachFromRecordings, type Recording, type TeachReport } from '../core/teach';
import { readWavFile } from './files';

export type { TeachReport, TeachWarning } from '../core/teach';

const WAV_EXTENSION = '.wav';

// Plain code-unit comparison, independent of the locale.
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function readLabelled(dir: string, label: string, file: string): Promise<Recording> {
  try {
    const { samples, sampleRate } = await readWavFile(join(dir, label, file));
    return { label, file, samples, sampleRate };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}/${file}: ${message}`, { cause: error });
  }
}

export async function teachFromDir(dir: string): Promise<{ model: SoundModel; report: TeachReport }> {
  // Outside the wrap, so a missing directory rejects with the file system error unchanged.
  const entries = await readdir(dir, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort(compareStrings);

  const recs: Recording[] = [];
  const emptyFolders: string[] = [];
  for (const label of folders) {
    const files = (await readdir(join(dir, label), { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(WAV_EXTENSION))
      .map((e) => e.name)
      .sort(compareStrings);
    if (files.length === 0) emptyFolders.push(label);
    for (const file of files) recs.push(await readLabelled(dir, label, file));
  }
  return teachFromRecordings(recs, { emptyFolders });
}
