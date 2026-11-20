import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TooFewExamplesError } from '../core/classify/knn';
import { writeWav } from '../core/wav';
import { teachFromDir } from '../node/teach';
import { runSoundsRebuild } from '../scripts/sounds-rebuild';
import { WEB_TEACH_PAGE_MODEL_FILE, WEB_TEACH_PAGE_NUMBER_DIGITS, WEB_TEACH_PAGE_SOUNDS_DIR } from '../web/constants';
import {
  fileName, isSoundsModel, listLabels, newFileNames, nextNumber, parseRelativePath, rebuildCommand, relativePath, soundsJsonText,
} from '../web/teach-page/files';
import type { DirEntry } from '../web/teach-page/files';
import { LEAD_MS, TRAIL_MS, TRAIN_GAIN_DB, TRAIN_PER_CLASS, TRAIN_SPACING_MS, makeSignal } from './helpers/engine-fixture';
import type { ImpactName } from './helpers/engine-fixture';
import { SYNTH_FIXTURE_LEAD_NOISE_DBFS } from '../core/constants';

// The files that teachFromDir really reads, recorded here so test 3 compares the choice of files and not a copy of the rule.
const readCalls: string[] = [];
vi.mock('../node/files', async (importOriginal) => {
  const original = await importOriginal<typeof import('../node/files')>();
  return {
    ...original,
    readWavFile: async (path: string) => {
      readCalls.push(path);
      return original.readWavFile(path);
    },
  };
});

// Test-only values.
const RATE_HZ = 48000;
const SILENCE_MS = 100;
const SEED_BASE = 61000;
const SEED_STEP = 1000;
const SYNTH_LABELS: ImpactName[] = ['low', 'mid'];
const MS_PER_SECOND = 1000;

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tokk-teach-page-'));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  readCalls.length = 0;
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

const silence = (): Uint8Array => writeWav(new Float32Array((SILENCE_MS * RATE_HZ) / MS_PER_SECOND), RATE_HZ);

// <dir>/sounds/<label>/<label>-01.wav with TRAIN_PER_CLASS synth impacts for each label.
async function writeSynthSounds(dir: string): Promise<string> {
  const sounds = join(dir, 'sounds');
  for (const [i, cls] of SYNTH_LABELS.entries()) {
    const hits = Array.from({ length: TRAIN_PER_CLASS }, (_, k) => ({ atMs: LEAD_MS + k * TRAIN_SPACING_MS, cls, gainDb: TRAIN_GAIN_DB }));
    const samples = makeSignal({
      sampleRate: RATE_HZ, totalMs: LEAD_MS + TRAIN_PER_CLASS * TRAIN_SPACING_MS + TRAIL_MS, hits, seed: SEED_BASE + i * SEED_STEP,
      noiseRmsDb: SYNTH_FIXTURE_LEAD_NOISE_DBFS,
    });
    await mkdir(join(sounds, cls), { recursive: true });
    await writeFile(join(sounds, cls, `${cls}-01.wav`), writeWav(samples, RATE_HZ));
  }
  return sounds;
}

describe('numbering (requirement 6.2)', () => {
  it('gives 1 when the label folder has no numbered file', () => {
    expect(nextNumber('tap', [])).toBe(1);
    expect(nextNumber('tap', ['notes.txt'])).toBe(1);
  });

  it('continues after the highest number, also with gaps', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `tap-${String(i + 1).padStart(2, '0')}.wav`);
    expect(nextNumber('tap', ten)).toBe(11);
    expect(nextNumber('tap', ['tap-01.wav', 'tap-07.wav', 'tap-03.wav'])).toBe(8);
    expect(nextNumber('tap', ['tap-100.wav'])).toBe(101);
  });

  it('ignores other names', () => {
    expect(nextNumber('tap', ['tap.wav', 'tap-1a.wav', 'TAP-12.WAV', 'tip-40.wav', 'tap-05.wav.bak', 'tap--3.wav', 'tap-07.WAV'])).toBe(1);
    expect(nextNumber('tap', ['tap-02.wav', 'TAP-12.WAV'])).toBe(3);
  });

  it('does not treat regular expression characters in a label as a pattern', () => {
    expect(nextNumber('a-b', ['axb-09.wav'])).toBe(1);
  });
});

describe('file names (requirements 6.1 and 6.3)', () => {
  it('pads to the digits of the constant and grows after that', () => {
    expect(WEB_TEACH_PAGE_NUMBER_DIGITS).toBe(2);
    expect(fileName('tap', 1)).toBe('tap-01.wav');
    expect(fileName('tap', 10)).toBe('tap-10.wav');
    expect(fileName('tap', 99)).toBe('tap-99.wav');
    expect(fileName('tap', 100)).toBe('tap-100.wav');
  });

  it('names ten new files from 1 and continues after existing ones', () => {
    expect(newFileNames('tap', [], 10)).toEqual(Array.from({ length: 10 }, (_, i) => `tap-${String(i + 1).padStart(2, '0')}.wav`));
    expect(newFileNames('tap', ['tap-01.wav', 'tap-02.wav'], 3)).toEqual(['tap-03.wav', 'tap-04.wav', 'tap-05.wav']);
  });

  it('skips a name that exists in any letter case', () => {
    // `TAP-03.WAV` does not count for the numbering, but its name is taken (a case-insensitive file system).
    expect(newFileNames('tap', ['tap-02.wav', 'TAP-03.WAV'], 2)).toEqual(['tap-04.wav', 'tap-05.wav']);
    expect(newFileNames('tap', ['tap-01.wav', 'Tap-02.wav', 'tap-02.WAV'], 1)).toEqual(['tap-03.wav']);
    expect(newFileNames('tap', [], 0)).toEqual([]);
  });
});

describe('listLabels against teachFromDir (requirement 2.3)', () => {
  it('chooses the same label folders, files and empty folders', async () => {
    const dir = await tempDir();
    const sounds = join(dir, 'sounds');
    const layout: Record<string, string[]> = {
      zeta: ['b.wav', 'a.WAV', '.hidden.wav', 'notes.txt', 'c.Wav'],
      alpha: ['x.wav'],
      empty: [],
      textonly: ['readme.txt'],
      '.git': ['ignored.wav'],
      nested: ['n.wav'],
    };
    for (const [label, files] of Object.entries(layout)) {
      await mkdir(join(sounds, label), { recursive: true });
      for (const f of files) await writeFile(join(sounds, label, f), f.toLowerCase().endsWith('.wav') ? silence() : 'text');
    }
    await mkdir(join(sounds, 'nested', 'sub.wav'), { recursive: true });   // a folder named like a wav is not a file
    await writeFile(join(sounds, 'loose.wav'), silence());                  // a file next to the label folders is not a label

    const entriesOf = async (path: string): Promise<DirEntry[]> =>
      (await readdir(path, { withFileTypes: true })).map((e) => ({ name: e.name, kind: e.isDirectory() ? 'directory' as const : 'file' as const }));
    const top = await entriesOf(sounds);
    const children = new Map<string, DirEntry[]>();
    for (const e of top) if (e.kind === 'directory') children.set(e.name, await entriesOf(join(sounds, e.name)));
    const listing = listLabels(top, (label) => children.get(label) ?? []);

    let counts: Record<string, number> = {};
    try {
      await teachFromDir(sounds);
    } catch (e) {
      expect(e).toBeInstanceOf(TooFewExamplesError);
      counts = (e as TooFewExamplesError).counts;
    }
    const read = readCalls.map((p) => p.slice(sounds.length + 1).split(/[\\/]/).join('/'));
    const listed = listing.labels.flatMap((l) => l.files.map((f) => `${l.label}/${f}`));
    expect(listed).toEqual(read);
    expect(listing.emptyFolders).toEqual(['empty', 'textonly']);
    expect(Object.keys(counts).sort()).toEqual([...listing.labels.map((l) => l.label), ...listing.emptyFolders].sort());
    expect(listing.labels.map((l) => l.label)).toEqual(['alpha', 'nested', 'zeta']);
    expect(listing.labels.find((l) => l.label === 'zeta')?.files).toEqual(['.hidden.wav', 'a.WAV', 'b.wav', 'c.Wav']);
  });
});

describe('parseRelativePath (requirement 7.2)', () => {
  it('accepts <root>/sounds/<label>/<file>.wav only', () => {
    expect(parseRelativePath('hello/sounds/tap/tap-01.wav')).toEqual({ label: 'tap', file: 'tap-01.wav' });
    expect(parseRelativePath('hello/sounds/tap/TAP-01.WAV')).toEqual({ label: 'tap', file: 'TAP-01.WAV' });
    expect(parseRelativePath('hello/sounds/tap/.x.wav')).toEqual({ label: 'tap', file: '.x.wav' });
  });

  it('ignores other depths, other folders, dot folders and other extensions', () => {
    for (const path of [
      'hello/sounds/tap-01.wav', 'hello/sounds/tap/deep/tap-01.wav', 'hello/other/tap/tap-01.wav', 'sounds/tap/tap-01.wav',
      'hello/sounds/.git/x.wav', 'hello/sounds/tap/notes.txt', 'hello/sounds.json', 'hello/sounds/tap/', 'hello/sounds//x.wav', '',
    ]) {
      expect(parseRelativePath(path), path).toBeNull();
    }
  });
});

describe('texts (requirements 4.7 and 4.8)', () => {
  it('builds the relative path and the rebuild command', () => {
    expect(relativePath('tap', 'tap-01.wav')).toBe(`${WEB_TEACH_PAGE_SOUNDS_DIR}/tap/tap-01.wav`);
    expect(rebuildCommand('hello')).toBe('npm run sounds:rebuild hello/sounds');
    expect(WEB_TEACH_PAGE_MODEL_FILE).toBe('sounds.json');
  });
});

describe('soundsJsonText (requirement 4.6)', () => {
  it('is byte-equal to the file that sounds:rebuild writes for the same folder', async () => {
    const dir = await tempDir();
    const sounds = await writeSynthSounds(dir);
    const { model } = await teachFromDir(sounds);
    expect(await runSoundsRebuild([sounds], { cwd: dir, out: () => undefined, err: (s) => { throw new Error(s); } })).toBe(0);
    const written = await readFile(join(dir, 'sounds.json'));
    expect(Buffer.from(new TextEncoder().encode(soundsJsonText(model))).equals(written)).toBe(true);
    expect(soundsJsonText(model).endsWith('}\n')).toBe(true);
  });
});

describe('isSoundsModel (requirement 2.6)', () => {
  const INPUTS: [string, string][] = [
    ['a model', JSON.stringify({ version: 1, examples: [] })],
    ['a wrong version', JSON.stringify({ version: 2, examples: [] })],
    ['no examples', JSON.stringify({ version: 1 })],
    ['examples that are not an array', JSON.stringify({ version: 1, examples: {} })],
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"x"'],
  ];

  it.each(INPUTS)('agrees with the refusal of sounds:rebuild for %s', async (_name, text) => {
    const dir = await tempDir();
    const sounds = await writeSynthSounds(dir);
    await writeFile(join(dir, 'sounds.json'), text);
    const errors: string[] = [];
    const code = await runSoundsRebuild([sounds], { cwd: dir, out: () => undefined, err: (s) => errors.push(s) });
    const refused = code !== 0 && errors.join('').includes('not a sounds model');
    expect(isSoundsModel(JSON.parse(text))).toBe(!refused);
  });
});
