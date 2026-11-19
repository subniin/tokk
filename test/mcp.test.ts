import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from '../tools/mcp-ears/server';
import { call, connect, type Connected } from './helpers/mcp-client';
import {
  LEAD_MS, MS_PER_SECOND, listTree, makeSandbox, putSignal, removeSandboxes, writeModel, writeRecording, writeTaughtFolder,
  type Sandbox,
} from './helpers/mcp-fixture';
import { removeTempDirs, wav24Bytes, writeFixture, FIXTURE_SAMPLE_RATE_HZ } from './helpers/score-fixture';
import { makeSignal } from './helpers/engine-fixture';

// Test-only values.
const TIME_TOLERANCE_MS = 20;
const SECOND_HIT_MS = LEAD_MS + 1200;
const UNKNOWN_HIT_MS = LEAD_MS + 2400;
const UNSUPPORTED_RATE_HZ = 8000;
const FEW_EXAMPLES = 4;
const EARLY_SOUND_MS = 300;
const STACK_LINE = /\n\s+at /;
const WAV_24_FRAMES = 1000;

let sb: Sandbox;
let conn: Connected | undefined;

async function setup(): Promise<Connected> {
  sb = await makeSandbox();
  conn = await connect(sb.root);
  return conn;
}

afterEach(async () => {
  await conn?.close();
  conn = undefined;
  await removeSandboxes();
  await removeTempDirs();
});

const timesOf = (text: string): number[] => [...text.matchAll(/@ (\d+\.\d{3})s/g)].map((m) => Number(m[1]));

describe('tool list (Req 1.6)', () => {
  it('lists exactly listen, score, spectrogram and teach with a description and an input schema', async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['listen', 'score', 'spectrogram', 'teach']);
    for (const t of tools) {
      expect(t.description && t.description.length > 0).toBe(true);
      expect(t.inputSchema.type).toBe('object');
      expect(Object.keys(t.inputSchema.properties ?? {}).length).toBeGreaterThan(0);
    }
  });

  it('createServer does not start a transport when imported', () => {
    expect(typeof createServer).toBe('function');
  });
});

describe('path guard (Req 3)', () => {
  it('rejects an absolute path outside the root and a ../ path', async () => {
    const { client } = await setup();
    await writeModel(join(sb.parent, 'outside.json'), ['low', 'mid']);
    await writeRecording(join(sb.root, 'rec.wav'), [{ atMs: LEAD_MS, cls: 'low', gainDb: -6 }], 1);
    for (const arg of [join(sb.parent, 'outside.json'), '../outside.json']) {
      const r = await call(client, 'listen', { wav: 'rec.wav', sounds: arg });
      expect(r.isError).toBe(true);
      expect(r.text).toContain('outside the working folder');
      expect(r.text).toContain(arg);
      expect(r.text).not.toContain(sb.root);
    }
  });

  it('rejects the sibling-prefix folder for a read and for out, and writes nothing there', async () => {
    const { client } = await setup();
    await writeTaughtFolder(join(sb.root, 'taught'), ['low', 'mid']);
    const before = await listTree(sb.evil);
    const read = await call(client, 'teach', { dir: '../tokk-evil' });
    expect(read.isError).toBe(true);
    expect(read.text).toContain('outside the working folder');
    const write = await call(client, 'teach', { dir: 'taught', out: '../tokk-evil/x.json' });
    expect(write.isError).toBe(true);
    expect(write.text).toContain('outside the working folder');
    expect(write.text).toContain('../tokk-evil/x.json');
    expect(await listTree(sb.evil)).toEqual(before);
  });

  it('refuses an out whose parent is missing or outside, and creates nothing', async () => {
    const { client } = await setup();
    await writeTaughtFolder(join(sb.root, 'taught'), ['low', 'mid']);
    const missing = await call(client, 'teach', { dir: 'taught', out: 'nope/sounds.json' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('parent folder not found');
    await expect(stat(join(sb.root, 'nope'))).rejects.toThrow();
    const outside = await call(client, 'teach', { dir: 'taught', out: '../sounds.json' });
    expect(outside.isError).toBe(true);
    expect(outside.text).toContain('outside the working folder');
    await expect(stat(join(sb.parent, 'sounds.json'))).rejects.toThrow();
  });

  it('rejects a link inside the root that points outside', async (ctx) => {
    const { client } = await setup();
    await writeModel(join(sb.evil, 'sounds.json'), ['low', 'mid']);
    await writeRecording(join(sb.root, 'rec.wav'), [{ atMs: LEAD_MS, cls: 'low', gainDb: -6 }], 1);
    try {
      await symlink(sb.evil, join(sb.root, 'link'), 'junction');
    } catch (e) {
      ctx.skip(`cannot create a directory link here: ${(e as Error).message}`);
    }
    const r = await call(client, 'listen', { wav: 'rec.wav', sounds: 'link/sounds.json' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('outside the working folder');
  });

  it('accepts a file named ..notes.json and the root itself as dir', async () => {
    const { client } = await setup();
    await writeFile(join(sb.root, '..notes.json'), '{"version":1,"examples":"no"}');
    await writeRecording(join(sb.root, 'rec.wav'), [{ atMs: LEAD_MS, cls: 'low', gainDb: -6 }], 1);
    const notes = await call(client, 'listen', { wav: 'rec.wav', sounds: '..notes.json' });
    expect(notes.text).not.toContain('outside the working folder');
    await writeFixture(sb.root, [{ name: 'a', totalMs: LEAD_MS + 500, hits: [], seed: 1 }]);
    await writeModel(join(sb.root, 'sounds.json'), ['low', 'mid']);
    const r = await call(client, 'score', { dir: '.', sounds: 'sounds.json' });
    expect(r.text).not.toContain('outside the working folder');
  });

  it('gives the pass-out hint when dir is the root', async () => {
    const { client } = await setup();
    await writeTaughtFolder(sb.root, ['low', 'mid']);
    const r = await call(client, 'teach', { dir: '.' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('pass out');
  });

  it('refuses an out that is not a sounds model, or a folder, and leaves it unchanged', async () => {
    const { client } = await setup();
    await writeTaughtFolder(join(sb.root, 'taught'), ['low', 'mid']);
    const pkg = '{"name":"x","version":"1.0.0"}';
    await writeFile(join(sb.root, 'package.json'), pkg);
    await mkdir(join(sb.root, 'folder'));
    const a = await call(client, 'teach', { dir: 'taught', out: 'package.json' });
    expect(a.isError).toBe(true);
    expect(await readFile(join(sb.root, 'package.json'), 'utf8')).toBe(pkg);
    const b = await call(client, 'teach', { dir: 'taught', out: 'folder' });
    expect(b.isError).toBe(true);
  });
});

describe('teach (Req 4)', () => {
  it('writes sounds.json at dir/../sounds.json and reports labels', async () => {
    const { client } = await setup();
    await writeTaughtFolder(join(sb.root, 'examples', 'taught'), ['low', 'mid']);
    const r = await call(client, 'teach', { dir: 'examples/taught' });
    expect(r.isError).toBe(false);
    const lines = r.text.split('\n');
    expect(lines[0]).toMatch(/^taught 2 sounds, 20 examples -> examples\/sounds\.json$/);
    expect(lines[1]).toMatch(/^low: 10 examples, LOO accuracy \d\.\d\d$/);
    expect(lines[2]).toMatch(/^mid: 10 examples, LOO accuracy \d\.\d\d$/);
    expect(lines.some((l) => l.startsWith('confused:'))).toBe(true);
    const model = JSON.parse(await readFile(join(sb.root, 'examples', 'sounds.json'), 'utf8'));
    expect(Object.keys(model).sort()).toEqual(['examples', 'k', 'mean', 'sampleRate', 'std', 'thresholds', 'version']);
    for (const e of model.examples) expect(Object.keys(e).sort()).toEqual(['id', 'label', 'v']);
    expect((await readFile(join(sb.root, 'examples', 'sounds.json'), 'utf8')).endsWith('}\n')).toBe(true);
  });

  it('writes at an explicit out and gives the same text and file on a second run', async () => {
    const { client } = await setup();
    await writeTaughtFolder(join(sb.root, 'taught'), ['low', 'mid']);
    const a = await call(client, 'teach', { dir: 'taught', out: 'm.json' });
    const file1 = await readFile(join(sb.root, 'm.json'), 'utf8');
    const b = await call(client, 'teach', { dir: 'taught', out: 'm.json' });
    expect(a.text).toContain('-> m.json');
    expect(b.text).toBe(a.text);
    expect(await readFile(join(sb.root, 'm.json'), 'utf8')).toBe(file1);
  });

  it('warns about a sound in the first second', async () => {
    const { client } = await setup();
    await writeTaughtFolder(join(sb.root, 'taught'), ['low', 'mid']);
    const early = makeSignal({
      sampleRate: FIXTURE_SAMPLE_RATE_HZ, totalMs: LEAD_MS + 1000, seed: 5,
      hits: [{ atMs: EARLY_SOUND_MS, cls: 'low', gainDb: -6 }, { atMs: LEAD_MS, cls: 'low', gainDb: -6 }],
    });
    await putSignal(join(sb.root, 'taught', 'low', 'early.wav'), early);
    const r = await call(client, 'teach', { dir: 'taught' });
    expect(r.text).toMatch(/warning \[sound-in-calibration\] low\/early\.wav: /);
  });

  it('too few examples is a tool error with counts and writes nothing', async () => {
    const { client } = await setup();
    await writeTaughtFolder(join(sb.root, 'taught'), ['low', 'mid']);
    await writeRecording(join(sb.root, 'few', 'low', 'a.wav'), Array.from({ length: FEW_EXAMPLES }, (_, i) => ({ atMs: LEAD_MS + i * 700, cls: 'low' as const, gainDb: -6 })), 3);
    await writeRecording(join(sb.root, 'few', 'mid', 'a.wav'), Array.from({ length: FEW_EXAMPLES }, (_, i) => ({ atMs: LEAD_MS + i * 700, cls: 'mid' as const, gainDb: -6 })), 4);
    await call(client, 'teach', { dir: 'taught', out: 'sounds.json' });
    const before = await readFile(join(sb.root, 'sounds.json'), 'utf8');
    const r = await call(client, 'teach', { dir: 'few', out: 'sounds.json' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/low 4 \(too few\)/);
    expect(await readFile(join(sb.root, 'sounds.json'), 'utf8')).toBe(before);
    const fresh = await call(client, 'teach', { dir: 'few', out: 'other.json' });
    expect(fresh.isError).toBe(true);
    await expect(stat(join(sb.root, 'other.json'))).rejects.toThrow();
  });
});

describe('listen (Req 5)', () => {
  async function prepare(): Promise<void> {
    await writeModel(join(sb.root, 'sounds.json'), ['low', 'mid']);
    await writeRecording(join(sb.root, 'rec.wav'), [
      { atMs: LEAD_MS, cls: 'low', gainDb: -6 },
      { atMs: SECOND_HIT_MS, cls: 'low', gainDb: -6 },
      { atMs: UNKNOWN_HIT_MS, cls: 'ring', gainDb: -6 },
    ], 11);
  }

  it('prints sound lines, an unknown line with a model id, time order and the summary', async () => {
    const { client } = await setup();
    await prepare();
    const model = JSON.parse(await readFile(join(sb.root, 'sounds.json'), 'utf8')) as { examples: { id: string }[] };
    const r = await call(client, 'listen', { wav: 'rec.wav', sounds: 'sounds.json' });
    expect(r.isError).toBe(false);
    const lines = r.text.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^low @ \d+\.\d{3}s conf \d\.\d\d$/);
    expect(lines[1]).toMatch(/^low @ \d+\.\d{3}s conf \d\.\d\d$/);
    const unknown = lines[2].match(/^unknown @ (\d+\.\d{3})s nearest (.+)$/);
    expect(unknown).not.toBeNull();
    expect(model.examples.map((e) => e.id)).toContain(unknown![2]);
    expect(lines[3]).toBe('low x2, unknown x1');
    const t = timesOf(r.text);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    [LEAD_MS, SECOND_HIT_MS, UNKNOWN_HIT_MS].forEach((ms, i) => {
      expect(Math.abs(t[i] * MS_PER_SECOND - ms)).toBeLessThanOrEqual(TIME_TOLERANCE_MS);
    });
    expect((await call(client, 'listen', { wav: 'rec.wav', sounds: 'sounds.json' })).text).toBe(r.text);
  });

  it('gives no unknown in the summary when only taught sounds are heard', async () => {
    const { client } = await setup();
    await writeModel(join(sb.root, 'sounds.json'), ['low', 'mid']);
    await writeRecording(join(sb.root, 'rec.wav'), [{ atMs: LEAD_MS, cls: 'mid', gainDb: -6 }], 12);
    const r = await call(client, 'listen', { wav: 'rec.wav', sounds: 'sounds.json' });
    expect(r.text.split('\n').pop()).toBe('mid x1');
  });

  it('gives "no sounds found" for a silent and an empty recording', async () => {
    const { client } = await setup();
    await writeModel(join(sb.root, 'sounds.json'), ['low', 'mid']);
    await putSignal(join(sb.root, 'silent.wav'), new Float32Array(FIXTURE_SAMPLE_RATE_HZ * 3));
    await putSignal(join(sb.root, 'empty.wav'), new Float32Array(0));
    for (const wav of ['silent.wav', 'empty.wav']) {
      const r = await call(client, 'listen', { wav, sounds: 'sounds.json' });
      expect(r).toEqual({ isError: false, text: 'no sounds found' });
    }
  });

  it('a sample rate of 8000 Hz is a tool error with the supported range', async () => {
    const { client } = await setup();
    await writeModel(join(sb.root, 'sounds.json'), ['low', 'mid']);
    await putSignal(join(sb.root, 'slow.wav'), new Float32Array(UNSUPPORTED_RATE_HZ), UNSUPPORTED_RATE_HZ);
    const r = await call(client, 'listen', { wav: 'slow.wav', sounds: 'sounds.json' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/sampleRate must be between \d+ and \d+ Hz/);
  });
});

describe('score (Req 6)', () => {
  it('prints the table, the confusion and the totals, and writes nothing', async () => {
    const { client } = await setup();
    await writeModel(join(sb.root, 'sounds.json'), ['low', 'mid']);
    const hits = [
      { atMs: LEAD_MS, cls: 'low' as const, gainDb: -6 },
      { atMs: SECOND_HIT_MS, cls: 'mid' as const, gainDb: -6 },
    ];
    await mkdir(join(sb.root, 'fix'));
    await writeFixture(join(sb.root, 'fix'), [
      { name: 'a', totalMs: LEAD_MS + 3000, hits, seed: 21 },
      { name: 'loose', totalMs: LEAD_MS + 1000, hits: [], seed: 22, labelFile: false },
    ]);
    const before = await listTree(sb.root);
    const r = await call(client, 'score', { dir: 'fix', sounds: 'sounds.json' });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/^label\s+truths\s+tp\s+fp\s+fn\s+calib\s+precision\s+recall/);
    expect(r.text).toMatch(/^low\s+1\s+1\s+0\s+0\s+0\s+1\.000\s+1\.000$/m);
    expect(r.text).toMatch(/^mid\s+1\s+1\s+0\s+0\s+0\s+1\.000\s+1\.000$/m);
    expect(r.text).toContain('confusion (truth rows, predicted columns):');
    expect(r.text).toMatch(/false positives per hour \d+\.\d, total seconds \d+\.\d, in calibration 0/);
    expect(r.text).toMatch(/^warning \[no-labels\] loose\.wav: /m);
    expect(await listTree(sb.root)).toEqual(before);
    expect((await call(client, 'score', { dir: 'fix', sounds: 'sounds.json' })).text).toBe(r.text);
  });

  it('an empty folder and a folder with only unlabelled recordings are tool errors', async () => {
    const { client } = await setup();
    await writeModel(join(sb.root, 'sounds.json'), ['low', 'mid']);
    await mkdir(join(sb.root, 'empty'));
    await mkdir(join(sb.root, 'bare'));
    await writeFixture(join(sb.root, 'bare'), [{ name: 'x', totalMs: LEAD_MS + 500, hits: [], seed: 1, labelFile: false }]);
    for (const dir of ['empty', 'bare']) {
      const r = await call(client, 'score', { dir, sounds: 'sounds.json' });
      expect(r.isError).toBe(true);
      expect(r.text).toBe(`no labelled recordings found in ${dir}`);
    }
  });
});

describe('errors (Req 7)', () => {
  it('reports a missing WAV with the path as given and no stack', async () => {
    const { client } = await setup();
    await writeModel(join(sb.root, 'sounds.json'), ['low', 'mid']);
    const r = await call(client, 'listen', { wav: 'missing.wav', sounds: 'sounds.json' });
    expect(r.isError).toBe(true);
    expect(r.text).toBe('not found: missing.wav');
  });

  it('reports a 24-bit WAV by naming 16-bit PCM', async () => {
    const { client } = await setup();
    await writeModel(join(sb.root, 'sounds.json'), ['low', 'mid']);
    await writeFile(join(sb.root, 'deep.wav'), wav24Bytes(FIXTURE_SAMPLE_RATE_HZ, WAV_24_FRAMES));
    const r = await call(client, 'listen', { wav: 'deep.wav', sounds: 'sounds.json' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('16-bit PCM');
  });

  it('reports an invalid sounds file by name', async () => {
    const { client } = await setup();
    await writeRecording(join(sb.root, 'rec.wav'), [{ atMs: LEAD_MS, cls: 'low', gainDb: -6 }], 1);
    await writeFile(join(sb.root, 'bad.json'), '{not json');
    await writeFile(join(sb.root, 'noex.json'), '{"version":1}');
    for (const s of ['bad.json', 'noex.json']) {
      const r = await call(client, 'listen', { wav: 'rec.wav', sounds: s });
      expect(r.isError).toBe(true);
      expect(r.text).toContain(s);
      expect(r.text).not.toMatch(STACK_LINE);
    }
  });

  it('fails on a missing argument or a wrong type and still answers the next call', async () => {
    const { client } = await setup();
    await writeModel(join(sb.root, 'sounds.json'), ['low', 'mid']);
    await writeRecording(join(sb.root, 'rec.wav'), [{ atMs: LEAD_MS, cls: 'low', gainDb: -6 }], 1);
    expect((await call(client, 'listen', { wav: 'rec.wav' })).isError).toBe(true);
    expect((await call(client, 'listen', { wav: 5, sounds: 'sounds.json' })).isError).toBe(true);
    expect((await call(client, 'score', { dir: '', sounds: 'sounds.json' })).isError).toBe(true);
    const ok = await call(client, 'listen', { wav: 'rec.wav', sounds: 'sounds.json' });
    expect(ok.isError).toBe(false);
    expect(ok.text).toContain('low x1');
  });

  it('never prints a stack line', async () => {
    const { client } = await setup();
    const r = await call(client, 'score', { dir: 'nope', sounds: 'nope.json' });
    expect(r.isError).toBe(true);
    expect(r.text).not.toMatch(STACK_LINE);
  });
});

describe('spectrogram (Req 3, 4.3)', () => {
  const RATE_HZ = 16000;
  const DURATION_S = 1.5;
  const EXPECTED_WIDTH_PX = 150;
  const HEIGHT_PX = 256;
  const TOO_LONG_S = 61;
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const TONE_HZ = 1000;

  const tone = (): Float32Array => {
    const out = new Float32Array(Math.round(DURATION_S * RATE_HZ));
    for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin(2 * Math.PI * TONE_HZ * (i / RATE_HZ));
    return out;
  };

  interface ImageResult { isError: boolean; content: { type: string; data?: string; mimeType?: string; text?: string }[] }
  async function shoot(client: Connected['client'], args: Record<string, unknown>): Promise<ImageResult> {
    return (await client.callTool({ name: 'spectrogram', arguments: args })) as unknown as ImageResult;
  }
  const decode = (r: ImageResult): Buffer => Buffer.from(r.content[0].data ?? '', 'base64');
  const widthOf = (png: Buffer): number => png.readUInt32BE(16);
  const heightOf = (png: Buffer): number => png.readUInt32BE(20);

  it('returns one image item that decodes to a PNG of the expected size', async () => {
    const { client } = await setup();
    await putSignal(join(sb.root, 'rec.wav'), tone(), RATE_HZ);
    const r = await shoot(client, { wav: 'rec.wav' });
    expect(r.isError).not.toBe(true);
    expect(r.content.length).toBe(1);
    expect(r.content[0].type).toBe('image');
    expect(r.content[0].mimeType).toBe('image/png');
    const png = decode(r);
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(widthOf(png)).toBe(EXPECTED_WIDTH_PX);
    expect(heightOf(png)).toBe(HEIGHT_PX);
  });

  it('changes the width with startS and endS', async () => {
    const { client } = await setup();
    await putSignal(join(sb.root, 'rec.wav'), tone(), RATE_HZ);
    const r = await shoot(client, { wav: 'rec.wav', startS: 0.5, endS: 1 });
    expect(widthOf(decode(r))).toBe(50);
  });

  it('reports an empty range with the duration and the arguments as given', async () => {
    const { client } = await setup();
    await putSignal(join(sb.root, 'rec.wav'), tone(), RATE_HZ);
    const r = await call(client, 'spectrogram', { wav: 'rec.wav', startS: 9, endS: 10 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('no samples in the selected range');
    expect(r.text).toContain('1.500');
    expect(r.text).toContain('9');
    expect(r.text).toContain('10');
  });

  it('rejects a range longer than the limit and accepts it when narrowed', async () => {
    const { client } = await setup();
    await putSignal(join(sb.root, 'long.wav'), new Float32Array(TOO_LONG_S * RATE_HZ), RATE_HZ);
    const r = await call(client, 'spectrogram', { wav: 'long.wav' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('range is longer than 60 s');
    expect(r.text).toContain('startS');
    expect(r.text).toContain('endS');
    const ok = await shoot(client, { wav: 'long.wav', startS: 0, endS: 2 });
    expect(ok.isError).not.toBe(true);
    expect(widthOf(decode(ok))).toBe(200);
  });

  it('reports a missing file and a 24-bit WAV, and answers the next call', async () => {
    const { client } = await setup();
    const missing = await call(client, 'spectrogram', { wav: 'missing.wav' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toBe('not found: missing.wav');
    await writeFile(join(sb.root, 'deep.wav'), wav24Bytes(FIXTURE_SAMPLE_RATE_HZ, WAV_24_FRAMES));
    const deep = await call(client, 'spectrogram', { wav: 'deep.wav' });
    expect(deep.isError).toBe(true);
    expect(deep.text).toContain('16-bit PCM');
    expect(deep.text).not.toMatch(STACK_LINE);
    await putSignal(join(sb.root, 'rec.wav'), tone(), RATE_HZ);
    expect((await shoot(client, { wav: 'rec.wav' })).isError).not.toBe(true);
  });

  it('rejects wav outside the working folder, in the sibling-prefix folder and behind a link', async (ctx) => {
    const { client } = await setup();
    await putSignal(join(sb.parent, 'outside.wav'), tone(), RATE_HZ);
    await putSignal(join(sb.evil, 'rec.wav'), tone(), RATE_HZ);
    for (const arg of [join(sb.parent, 'outside.wav'), '../outside.wav', '../tokk-evil/rec.wav']) {
      const r = await call(client, 'spectrogram', { wav: arg });
      expect(r.isError).toBe(true);
      expect(r.text).toContain('outside the working folder');
    }
    try {
      await symlink(sb.evil, join(sb.root, 'link'), 'junction');
    } catch (e) {
      ctx.skip(`cannot create a directory link here: ${(e as Error).message}`);
    }
    const linked = await call(client, 'spectrogram', { wav: 'link/rec.wav' });
    expect(linked.isError).toBe(true);
    expect(linked.text).toContain('outside the working folder');
  });

  it('writes no file', async () => {
    const { client } = await setup();
    await putSignal(join(sb.root, 'rec.wav'), tone(), RATE_HZ);
    const before = await listTree(sb.parent);
    await shoot(client, { wav: 'rec.wav' });
    await call(client, 'spectrogram', { wav: 'nope.wav' });
    expect(await listTree(sb.parent)).toEqual(before);
  });
});