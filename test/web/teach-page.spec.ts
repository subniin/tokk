import { chromium, expect, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { SoundModel } from '../../core/types';
import { readWav, writeWav } from '../../core/wav';
import { runSoundsRebuild } from '../../scripts/sounds-rebuild';
import { compareModels, describeDifferences } from '../helpers/model-compare';
import { soundsJsonText } from '../../web/teach-page/files';
import { WEB_TEST_SEED_LABELS, WEB_TEST_TEACH_COPIES } from './fixture';
import type { TeachFixtureInfo } from './fixture';
import { DEV_TEACH_PAGE_URL, FIXTURE_TEACH_INFO_PATH, FIXTURE_TEACH_WAV_PATH, TEACH_PAGE_SEED_DIR, fakeMicArgs } from './paths';

// Test-only values.
const WEB_TEST_WAIT_SLACK_MS = 20_000;          // added to the length of a fixture for a wait
const WEB_TEST_SETTLE_MS = 1500;                // wait to show that no extra example arrives
const WEB_TEST_TEACH_TIMEOUT_MS = 120_000;
const WEB_TEST_TRAINING_WAIT_MS = 30_000;
const WEB_TEST_SAVE_WAIT_MS = 30_000;
const WEB_TEST_NO_DIALOG_WAIT_MS = 500;         // wait to show that a click opened nothing
const WEB_TEST_LONG_NAME_LENGTH = 33;           // one more than the longest allowed name
const WEB_TEST_NEW_LABEL = 'tap';
const WEB_TEST_FILE_DIGITS = 2;
const WEB_TEST_PROJECT = 'project';
const WEB_TEST_DOWNLOAD_COUNT = WEB_TEST_TEACH_COPIES + 1;   // the wav files and sounds.json

const HOST = '[data-tokk-teach]';
const EXAMPLES = `${HOST} li[data-example]`;
const action = (name: string): string => `${HOST} [data-action="${name}"]`;
const tapFile = (n: number): string => `${WEB_TEST_NEW_LABEL}-${String(n).padStart(WEB_TEST_FILE_DIGITS, '0')}.wav`;
const TAP_FILES = Array.from({ length: WEB_TEST_TEACH_COPIES }, (_, i) => tapFile(i + 1));

// The test's own folder: the page's own showDirectoryPicker is replaced before the page loads, as a user's browser
// would offer a real folder. The stand-in hands out an OPFS directory (same handle methods as a picked folder).
const PICKER_INIT = `window.showDirectoryPicker = async () => {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('${WEB_TEST_PROJECT}', { create: true });
};`;
// A browser without the folder picker.
const NO_PICKER_INIT = `delete window.showDirectoryPicker;
if (typeof window.showDirectoryPicker === 'function') Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });`;

interface FileDump { path: string; base64: string }

// A test that needs its own fake microphone file gets its own Chrome. It is closed after the test, also when it fails.
const test = base.extend<{ micPage: Page }>({
  micPage: async ({ baseURL }, use) => {
    const browser = await chromium.launch({ channel: 'chrome', args: fakeMicArgs(FIXTURE_TEACH_WAV_PATH) });
    try {
      const context = await browser.newContext({ baseURL });
      await use(await context.newPage());
    } finally {
      await browser.close();
    }
  },
});

async function filesBelow(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await filesBelow(path)));
    else out.push(path);
  }
  return out;
}

// Copies the seed wav files into the OPFS project folder (page.evaluate), before the page picks it.
async function seedOpfs(page: Page): Promise<Map<string, Buffer>> {
  const seed = new Map<string, Buffer>();
  const dumps: FileDump[] = [];
  for (const path of await filesBelow(TEACH_PAGE_SEED_DIR)) {
    const bytes = await readFile(path);
    const rel = relative(TEACH_PAGE_SEED_DIR, path).split('\\').join('/');
    seed.set(rel, bytes);
    dumps.push({ path: rel, base64: bytes.toString('base64') });
  }
  await page.evaluate(async ({ project, files }) => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(project, { recursive: true }).catch(() => undefined);
    let dir = await root.getDirectoryHandle(project, { create: true });
    const base = dir;
    for (const f of files) {
      dir = base;
      const parts = f.path.split('/');
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
      const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const w = await handle.createWritable();
      await w.write(Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)));
      await w.close();
    }
  }, { project: WEB_TEST_PROJECT, files: dumps });
  return seed;
}

// Walks the OPFS project folder and returns every file with its bytes.
async function dumpOpfs(page: Page): Promise<Map<string, Buffer>> {
  const dumps = await page.evaluate(async (project) => {
    const out: { path: string; base64: string }[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      // @ts-expect-error entries() is not in every lib.dom version
      for await (const [name, handle] of dir.entries() as AsyncIterable<[string, FileSystemHandle]>) {
        if (handle.kind === 'directory') {
          await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
        } else {
          const file = await (handle as FileSystemFileHandle).getFile();
          const bytes = new Uint8Array(await file.arrayBuffer());
          let text = '';
          for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          out.push({ path: `${prefix}${name}`, base64: btoa(text) });
        }
      }
    };
    const root = await navigator.storage.getDirectory();
    await walk(await root.getDirectoryHandle(project), '');
    return out;
  }, WEB_TEST_PROJECT);
  return new Map(dumps.map((d) => [d.path, Buffer.from(d.base64, 'base64')]));
}

async function pickFolder(page: Page): Promise<void> {
  await page.click('#pick-folder');
  await expect(page.locator('#folder-status')).toContainText('Folder:');
}

// Records ten sounds from the fake microphone in the dialog, then Done and Save.
async function teachTen(page: Page): Promise<void> {
  const info = JSON.parse(await readFile(FIXTURE_TEACH_INFO_PATH, 'utf8')) as TeachFixtureInfo;
  await page.fill('#sound-name', WEB_TEST_NEW_LABEL);
  await expect(page.locator('#record')).toHaveAttribute('aria-disabled', 'false');
  await page.click('#record');
  await expect(page.locator(HOST)).toHaveCount(1);
  await expect(page.locator(EXAMPLES)).toHaveCount(WEB_TEST_TEACH_COPIES, { timeout: info.teachDurationMs + WEB_TEST_WAIT_SLACK_MS });
  await page.waitForTimeout(WEB_TEST_SETTLE_MS);
  await expect(page.locator(EXAMPLES), 'the dialog must find exactly the copies in the teaching file').toHaveCount(WEB_TEST_TEACH_COPIES);
  await expect(page.locator(action('done'))).toHaveAttribute('aria-disabled', 'false');
  await page.click(action('done'));
  await expect(page.locator(action('save'))).toHaveAttribute('aria-disabled', 'false', { timeout: WEB_TEST_TRAINING_WAIT_MS });
  await page.click(action('save'));
}

test.describe('teach page (Task 17)', () => {
  test.setTimeout(WEB_TEST_TEACH_TIMEOUT_MS);

  test('teaching a new label writes ten wav files and a sounds.json that agrees with sounds:rebuild', async ({ micPage: page }) => {
    await page.addInitScript(PICKER_INIT);
    await page.goto(DEV_TEACH_PAGE_URL);
    const seed = await seedOpfs(page);
    await pickFolder(page);
    for (const label of WEB_TEST_SEED_LABELS) await expect(page.locator('#folder-summary')).toContainText(label);

    await teachTen(page);
    await expect(page.locator(`${HOST} [data-role="saved"]`)).toContainText('sounds.json', { timeout: WEB_TEST_SAVE_WAIT_MS });
    await expect(page.locator('#result [data-role="verify"]')).toContainText('matches');
    const listed = await page.locator('#result [data-role="written"] li').allTextContents();
    expect(listed).toEqual([...TAP_FILES.map((f) => `sounds/${WEB_TEST_NEW_LABEL}/${f}`), 'sounds.json']);

    const written = await dumpOpfs(page);
    for (const f of TAP_FILES) expect(written.has(`sounds/${WEB_TEST_NEW_LABEL}/${f}`), f).toBe(true);
    for (const [path, bytes] of seed) expect(written.get(path)?.equals(bytes), `${path} is unchanged`).toBe(true);
    const pageJson = written.get('sounds.json');
    expect(pageJson, 'the page wrote sounds.json').toBeDefined();

    const temp = await mkdtemp(join(tmpdir(), 'tokk-teach-page-e2e-'));
    try {
      for (const [path, bytes] of written) {
        if (path === 'sounds.json') continue;   // the rebuild must make its own
        await mkdir(dirname(join(temp, path)), { recursive: true });
        await writeFile(join(temp, path), bytes);
      }
      const errors: string[] = [];
      const code = await runSoundsRebuild([join(temp, 'sounds')], { cwd: temp, out: () => undefined, err: (s) => errors.push(s) });
      expect(code, errors.join('')).toBe(0);
      const rebuilt = await readFile(join(temp, 'sounds.json'));
      // Chrome and Node run the same code, but V8's Math functions differ in the last bits between engines, so the two files are
      // not byte-equal (design.md, "Cross-engine numbers"). The structure, the non-float fields, the numbers within a tolerance
      // and the classification of every example vector must agree.
      const pageModel = JSON.parse((pageJson as Buffer).toString('utf8')) as SoundModel;
      const model = JSON.parse(rebuilt.toString('utf8')) as SoundModel;
      const differences = compareModels(model, pageModel);
      expect(differences, describeDifferences(differences)).toEqual([]);
      expect((pageJson as Buffer).toString('utf8'), 'the page writes the text format of sounds:rebuild').toBe(soundsJsonText(pageModel));
      // The wav files are integers and do not depend on the engine: writeWav gives back the same bytes.
      for (const f of TAP_FILES) {
        const bytes = written.get(`sounds/${WEB_TEST_NEW_LABEL}/${f}`) as Buffer;
        const back = readWav(new Uint8Array(bytes));
        expect(Buffer.from(writeWav(back.samples, back.sampleRate)).equals(bytes), `${f} is what writeWav writes`).toBe(true);
      }
      expect(model.examples.filter((e) => e.label === WEB_TEST_NEW_LABEL)).toHaveLength(WEB_TEST_TEACH_COPIES);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  test('an invalid name shows the rule and Record does nothing', async ({ page }) => {
    await page.addInitScript(PICKER_INIT);
    await page.goto(DEV_TEACH_PAGE_URL);
    await page.evaluate(async (project) => {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(project, { recursive: true }).catch(() => undefined);
      await (await root.getDirectoryHandle(project, { create: true })).getDirectoryHandle('sounds', { create: true });
    }, WEB_TEST_PROJECT);
    await pickFolder(page);
    for (const name of ['Tap', '1tap', 'a'.repeat(WEB_TEST_LONG_NAME_LENGTH)]) {
      await page.fill('#sound-name', name);
      await expect(page.locator('#name-alert'), name).toContainText('lower-case');
      await expect(page.locator('#name-alert')).toHaveAttribute('role', 'alert');
      await expect(page.locator('#sound-name')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#sound-name')).toHaveAttribute('aria-describedby', /\bname-alert\b/);
      await expect(page.locator('#record')).toHaveAttribute('aria-disabled', 'true');
      await page.click('#record', { force: true });   // an aria-disabled button must do nothing when it is clicked
      await page.waitForTimeout(WEB_TEST_NO_DIALOG_WAIT_MS);
      await expect(page.locator(HOST)).toHaveCount(0);
    }
  });

  test('without showDirectoryPicker the page offers ten wav downloads and sounds.json', async ({ micPage: page }) => {
    await page.addInitScript(NO_PICKER_INIT);
    await page.goto(DEV_TEACH_PAGE_URL);
    await expect(page.locator('#folder-status')).toContainText('This browser cannot write to a folder.');
    await expect(page.locator('#pick-folder')).toHaveCount(0);

    await teachTen(page);
    await expect(page.locator('#result a[data-download]')).toHaveCount(WEB_TEST_DOWNLOAD_COUNT, { timeout: WEB_TEST_SAVE_WAIT_MS });
    await expect(page.locator('#result [data-role="download-help"]')).toHaveText(
      `Put ${TAP_FILES[0]} to ${TAP_FILES[TAP_FILES.length - 1]} in <project folder>/sounds/${WEB_TEST_NEW_LABEL}/ and sounds.json in <project folder>/.`,
    );
    expect(await page.locator('#result a[data-download]').evaluateAll((as) => as.map((a) => a.getAttribute('download')))).toEqual([...TAP_FILES, 'sounds.json']);
    await page.click(action('close'));
    const downloading = page.waitForEvent('download');
    await page.click(`#result a[download="${TAP_FILES[0]}"]`);
    expect((await downloading).suggestedFilename()).toBe(TAP_FILES[0]);
  });
});
