// Entry of teach.html, the developer teach page (Task 17). The developer picks the project folder, types a sound name,
// records the sound in the teach dialog, checks the result and saves sounds/<name>/<name>-NN.wav and sounds.json.
// Audio stays in the page: the wav files go to the picked folder or to local downloads. Nothing is sent over the network.
// Every node that this file makes comes from createElement and textContent.

import { BACKGROUND, HUM_LABEL, RECOMMENDED_EXAMPLES_PER_LABEL } from '../core/constants';
import type { Recording } from '../core/teach';
import type { SoundModel } from '../core/types';
import { readWav, writeWav } from '../core/wav';
import {
  WEB_TEACH_PAGE_MODEL_FILE, WEB_TEACH_PAGE_PICKER_ID, WEB_TEACH_PAGE_SOUNDS_DIR, WEB_TEACH_PAGE_TEST_STORAGE_KEY,
} from './constants';
import { listen } from './listen';
import type { Ears } from './listen';
import { openMic } from './mic';
import type { MicHandle } from './mic';
import { sampleRateWarning } from './overlay/format';
import type { MainToWorker, MessagePortLike, WorkerToMain } from './protocol';
import { reportLines } from './teach-ui/format';
import { validateLabel } from './teach-ui/state';
import { mountTeachDialog } from './teach-ui/teach-dialog';
import type { RecordMessage, TeachController } from './teach-ui/teach-dialog';
import { isSoundsModel, listLabels, newFileNames, parseRelativePath, rebuildCommand, relativePath, soundsJsonText } from './teach-page/files';
import type { DirEntry, Listing } from './teach-page/files';
import { createTokkWorker } from './worker-factory';
import type { WorkerHandle } from './worker-factory';

// ---- The parts of the File System Access API that the installed lib.dom does not have ----
interface FsWritable { write(data: Uint8Array): Promise<void>; close(): Promise<void> }
interface FsFile { kind: 'file'; name: string; getFile(): Promise<File>; createWritable(): Promise<FsWritable> }
interface FsDir {
  kind: 'directory';
  name: string;
  entries(): AsyncIterable<[string, FsFile | FsDir]>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDir>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFile>;
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<string>;
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<string>;
}
type Picker = (options: { mode: 'readwrite'; id: string }) => Promise<FsDir>;

const UNKNOWN_PROJECT = '<project folder>';
const WAV_MIME_TYPE = 'audio/wav';
const JSON_MIME_TYPE = 'application/json';
const EMPTY_MODEL: SoundModel = { version: 1, k: 1, sampleRate: 0, mean: [], std: [], examples: [], thresholds: {} };

// ---- Small DOM helpers ----
function byId<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (e === null) throw new Error(`teach.html has no element with the id "${id}".`);
  return e as T;
}

function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

function listOf(ul: HTMLElement, lines: string[]): void {
  ul.replaceChildren(...lines.map((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  }));
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const isNotFound = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'NotFoundError';

// ---- The folder ----
type ModelFile = 'none' | 'model' | 'foreign';

interface Existing {
  name: string;                  // the folder name (a path part)
  listing: Listing;
  recordings: Recording[];
  modelFile: ModelFile;          // sounds.json of the project folder
  soundsDir: FsDir | null;       // null: no sounds folder (or read-only mode)
}

async function listDir(dir: FsDir): Promise<DirEntry[]> {
  const out: DirEntry[] = [];
  for await (const [name, handle] of dir.entries()) out.push({ name, kind: handle.kind });
  return out;
}

async function readRecording(label: string, file: string, bytes: Uint8Array): Promise<Recording> {
  try {
    const { samples, sampleRate } = readWav(bytes);
    return { label, file, samples, sampleRate };
  } catch (e) {
    throw new Error(`${label}/${file} is not a 16-bit PCM wav file: ${messageOf(e)}`, { cause: e });
  }
}

// Reads the sounds folder with the listing rule of teachFromDir, and checks sounds.json.
async function readFolder(project: FsDir): Promise<Existing> {
  let soundsDir: FsDir | null = null;
  try {
    soundsDir = await project.getDirectoryHandle(WEB_TEACH_PAGE_SOUNDS_DIR);
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
  let listing: Listing = { labels: [], emptyFolders: [] };
  const recordings: Recording[] = [];
  if (soundsDir !== null) {
    const top = await listDir(soundsDir);
    const children = new Map<string, DirEntry[]>();
    for (const e of top) if (e.kind === 'directory' && !e.name.startsWith('.')) children.set(e.name, await listDir(await soundsDir.getDirectoryHandle(e.name)));
    listing = listLabels(top, (label) => children.get(label) ?? []);
    for (const { label, files } of listing.labels) {
      const dir = await soundsDir.getDirectoryHandle(label);
      for (const file of files) {
        const bytes = new Uint8Array(await (await (await dir.getFileHandle(file)).getFile()).arrayBuffer());
        recordings.push(await readRecording(label, file, bytes));
      }
    }
  }
  let modelFile: ModelFile = 'none';
  try {
    const text = await (await (await project.getFileHandle(WEB_TEACH_PAGE_MODEL_FILE)).getFile()).text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON: foreign */ }
    modelFile = isSoundsModel(parsed) ? 'model' : 'foreign';
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
  return { name: project.name, listing, recordings, modelFile, soundsDir };
}

async function ensureWritePermission(dir: FsDir): Promise<void> {
  if (typeof dir.queryPermission !== 'function') return;
  let state = await dir.queryPermission({ mode: 'readwrite' });
  if (state !== 'granted' && typeof dir.requestPermission === 'function') state = await dir.requestPermission({ mode: 'readwrite' });
  if (state !== 'granted') throw new Error('The browser did not allow writing to this folder. Pick the folder again and allow editing files.');
}

async function writeBytes(dir: FsDir, name: string, bytes: Uint8Array): Promise<void> {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(bytes);
  await w.close();   // the file changes only when the whole text is written
}

async function exists(dir: FsDir, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

// ---- Training in the page's Worker ----
type Trained =
  | { ok: true; model: SoundModel; report: Extract<WorkerToMain, { type: 'teach-result' }>['report'] }
  | { ok: false; message: string; counts: Record<string, number> | null };

interface NewFile { rec: Recording; bytes: Uint8Array }
interface Take { label: string; sampleRate: number; clips: { id: string; samples: Float32Array }[] }

function main(): void {
  const els = {
    pick: byId<HTMLButtonElement>('pick-folder'),
    create: byId<HTMLButtonElement>('create-sounds'),
    reload: byId<HTMLButtonElement>('reload-folder'),
    fallback: byId<HTMLElement>('fallback'),
    loadFolder: byId<HTMLInputElement>('load-folder'),
    folderStatus: byId<HTMLElement>('folder-status'),
    summary: byId<HTMLElement>('folder-summary'),
    name: byId<HTMLInputElement>('sound-name'),
    alert: byId<HTMLElement>('name-alert'),
    note: byId<HTMLElement>('name-note'),
    existingNote: byId<HTMLElement>('existing-note'),
    rateWarning: byId<HTMLElement>('rate-warning'),
    record: byId<HTMLButtonElement>('record'),
    recordReason: byId<HTMLElement>('record-reason'),
    resultStatus: byId<HTMLElement>('result-status'),
    written: byId<HTMLElement>('written'),
    verify: byId<HTMLElement>('verify'),
    downloadHelp: byId<HTMLElement>('download-help'),
    downloads: byId<HTMLElement>('downloads'),
    testNow: byId<HTMLButtonElement>('test-now'),
    testStop: byId<HTMLButtonElement>('test-stop'),
    testStatus: byId<HTMLElement>('test-status'),
  };

  const picker = (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;
  const canWrite = typeof picker === 'function';

  let project: FsDir | null = null;
  let existing: Existing | null = null;           // the folder as last read (picker mode, or the read-only load)
  let readProblem: string | null = null;          // the folder could not be read or has a bad wav file
  let model: SoundModel | null = null;            // the model of the folder, or the one just saved
  let nameChecked = false;                        // Record was pressed with a bad name: show the rule also for an empty name
  let mic: MicHandle | null = null;
  let dialogOpen = false;
  let ears: Ears | null = null;
  let take: Take | null = null;
  let worker: WorkerHandle | null = null;
  let requestCounter = 0;
  let dialogRequest = 0;
  let recordListener: ((m: RecordMessage) => void) | null = null;
  let downloadUrls: string[] = [];
  const pending = new Map<number, (m: Extract<WorkerToMain, { type: 'teach-result' | 'teach-failed' }>) => void>();

  const projectName = (): string => existing?.name ?? UNKNOWN_PROJECT;
  const labelFiles = (label: string): string[] => existing?.listing.labels.find((l) => l.label === label)?.files ?? [];

  // ---- Worker ----
  const route = (msg: WorkerToMain): void => {
    switch (msg.type) {
      case 'teach-result':
      case 'teach-failed': {
        const done = pending.get(msg.requestId);
        pending.delete(msg.requestId);
        done?.(msg);
        return;
      }
      case 'record-clips':
        onClips(msg);
        return;
      case 'record-progress':
      case 'record-segment':
      case 'record-limit':
      case 'record-trained':
      case 'record-failed':
        recordListener?.(msg);
        return;
      case 'error':
        console.error(`tokk: ${msg.message}`);
        return;
      default:
    }
  };

  const ensureWorker = (): Worker => {
    if (worker === null) {
      worker = createTokkWorker();
      worker.worker.onmessage = (e: MessageEvent<WorkerToMain>) => route(e.data);
      worker.worker.onerror = (e: ErrorEvent) => console.error(`tokk: Worker error: ${e.message || 'The Worker failed.'}`);
    }
    return worker.worker;
  };

  const post = (msg: MainToWorker, transfer: Transferable[] = []): void => ensureWorker().postMessage(msg, transfer);

  // Trains a whole folder with teachFromRecordings in the Worker. The samples are copied, so the page keeps its own.
  const train = (recordings: Recording[], emptyFolders: string[], requestId = ++requestCounter): Promise<Trained> => new Promise((resolve) => {
    const copies = recordings.map((r) => ({ ...r, samples: r.samples.slice() }));
    pending.set(requestId, (m) => resolve(m.type === 'teach-result'
      ? { ok: true, model: m.model, report: m.report }
      : { ok: false, message: m.message, counts: m.counts }));
    post({ type: 'teach-recordings', requestId, recordings: copies, emptyFolders }, copies.map((r) => r.samples.buffer as ArrayBuffer));
  });

  // ---- Texts ----
  const countLines = (counts: Record<string, number>): string[] => Object.entries(counts).map(([label, n]) => `${label}: ${n} examples`);

  const showFolder = async (): Promise<void> => {
    if (existing === null) return;
    const files = existing.listing.labels.reduce((n, l) => n + l.files.length, 0);
    if (readProblem !== null) {
      listOf(els.summary, []);
      model = null;
      return;
    }
    if (files === 0 && existing.listing.emptyFolders.length === 0) {
      listOf(els.summary, ['No sounds in this folder yet.']);
      model = null;
      return;
    }
    const result = await train(existing.recordings, existing.listing.emptyFolders);
    if (result.ok) {
      model = result.model;
      const rate = existing.recordings[0]?.sampleRate;
      const lines = existing.listing.labels.map((l) => {
        const n = result.model.examples.filter((e) => e.label === l.label).length;
        return `${l.label}: ${l.files.length} ${l.files.length === 1 ? 'file' : 'files'}, ${n} examples`;
      });
      for (const label of existing.listing.emptyFolders) lines.push(`${label}: no wav files`);
      lines.push(...reportLines(result.report, result.model));
      if (rate !== undefined) lines.push(`Sample rate of the files: ${rate} Hz`);
      listOf(els.summary, lines);
    } else {
      model = null;
      const lines = result.counts === null ? [result.message] : ['This folder has no model yet.', ...countLines(result.counts), result.message];
      listOf(els.summary, lines);
    }
  };

  const existingText = (label: string): string | null => {
    const files = labelFiles(label);
    if (files.length === 0) return null;
    return `${label} already has ${files.length} ${files.length === 1 ? 'recording' : 'recordings'} (${files[0]} to ${files[files.length - 1]}). `
      + 'New recordings are added after them; no file is deleted. To start over, delete the old files in your file manager and press Reload folder.';
  };

  const nameNote = (name: string): string => {
    if (name === HUM_LABEL) return 'hum: one steady hum for 2 s. It sets the pitch baseline and has no example list.';
    if (name === BACKGROUND) return 'background: the room\'s usual noise for 10 s.';
    return '';
  };

  // ---- Gates ----
  const nameProblem = (): string | null => {
    const name = els.name.value;
    if (name === '') return nameChecked ? validateLabel(name) : 'Type a sound name.';
    return validateLabel(name);
  };

  const recordReason = (): string | null => {
    if (dialogOpen || mic !== null) return 'A recording is open.';
    if (ears !== null) return 'Stop the test first.';
    if (canWrite) {
      if (project === null) return 'Pick the project folder first.';
      if (readProblem !== null) return readProblem;
      if (existing?.soundsDir === null) return 'The folder has no sounds folder. Press Create sounds folder.';
      if (existing?.modelFile === 'foreign') return 'sounds.json exists and is not a sounds model, so this page will not overwrite it.';
    }
    return nameProblem();
  };

  const update = (): void => {
    const name = els.name.value;
    const problem = name === '' && !nameChecked ? null : validateLabel(name);
    setText(els.alert, problem ?? '');
    els.name.setAttribute('aria-invalid', problem === null ? 'false' : 'true');
    setText(els.note, nameNote(name));
    setText(els.existingNote, problem === null ? existingText(name) ?? '' : '');
    const reason = recordReason();
    els.record.setAttribute('aria-disabled', reason === null ? 'false' : 'true');
    setText(els.recordReason, reason ?? '');
    els.create.hidden = !(canWrite && project !== null && existing?.soundsDir === null);
    els.reload.hidden = !(canWrite && project !== null);
    els.testNow.setAttribute('aria-disabled', model !== null && !dialogOpen && ears === null ? 'false' : 'true');
    els.testStop.setAttribute('aria-disabled', ears !== null ? 'false' : 'true');
  };

  // ---- Folder actions ----
  const reloadFolder = async (): Promise<void> => {
    if (project === null) return;
    readProblem = null;
    try {
      existing = await readFolder(project);
    } catch (e) {
      existing = { name: project.name, listing: { labels: [], emptyFolders: [] }, recordings: [], modelFile: 'none', soundsDir: null };
      readProblem = `The folder could not be read: ${messageOf(e)}`;
    }
    let status = `Folder: ${existing.name}`;
    if (readProblem !== null) status += `. ${readProblem} Nothing was trained.`;
    else if (existing.soundsDir === null) {
      status += project.name === WEB_TEACH_PAGE_SOUNDS_DIR
        ? '. You picked a sounds folder. Pick the folder that contains it.'
        : `. It has no ${WEB_TEACH_PAGE_SOUNDS_DIR} folder yet. Press Create sounds folder to make one.`;
    }
    if (existing.modelFile === 'foreign') status += `. ${WEB_TEACH_PAGE_MODEL_FILE} exists and is not a sounds model, so saving is blocked.`;
    setText(els.folderStatus, status);
    await showFolder();
    update();
  };

  els.pick.addEventListener('click', () => {
    void (async () => {
      try {
        const handle = await (picker as Picker)({ mode: 'readwrite', id: WEB_TEACH_PAGE_PICKER_ID });
        await ensureWritePermission(handle);
        project = handle;
        await reloadFolder();
      } catch (e) {
        if ((e as { name?: unknown } | null)?.name === 'AbortError') return;
        setText(els.folderStatus, `The folder could not be opened: ${messageOf(e)}`);
        update();
      }
    })();
  });

  els.create.addEventListener('click', () => {
    void (async () => {
      if (project === null) return;
      try {
        await project.getDirectoryHandle(WEB_TEACH_PAGE_SOUNDS_DIR, { create: true });
        await reloadFolder();
      } catch (e) {
        setText(els.folderStatus, `The sounds folder could not be created: ${messageOf(e)}`);
      }
    })();
  });

  els.reload.addEventListener('click', () => { void reloadFolder(); });

  // Without the picker: the project folder is read through a file input (read only), or not at all.
  const loadReadOnly = async (files: File[]): Promise<void> => {
    const byLabel = new Map<string, { file: string; bytes: File }[]>();
    let root = UNKNOWN_PROJECT;
    for (const f of files) {
      const parsed = parseRelativePath(f.webkitRelativePath);
      if (parsed === null) continue;
      root = f.webkitRelativePath.split('/')[0];
      byLabel.set(parsed.label, [...(byLabel.get(parsed.label) ?? []), { file: parsed.file, bytes: f }]);
    }
    const labels = [...byLabel.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const recordings: Recording[] = [];
    const listingLabels = [];
    try {
      for (const label of labels) {
        const entries = (byLabel.get(label) ?? []).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
        listingLabels.push({ label, files: entries.map((e) => e.file) });
        for (const e of entries) recordings.push(await readRecording(label, e.file, new Uint8Array(await e.bytes.arrayBuffer())));
      }
      readProblem = null;
    } catch (e) {
      readProblem = messageOf(e);
    }
    existing = { name: root, listing: { labels: listingLabels, emptyFolders: [] }, recordings, modelFile: 'none', soundsDir: null };
    const n = recordings.length;
    setText(els.folderStatus, readProblem !== null
      ? `${readProblem} Nothing was trained.`
      : `Loaded ${n} wav ${n === 1 ? 'file' : 'files'} from ${root}/${WEB_TEACH_PAGE_SOUNDS_DIR} (read only). Empty label folders cannot be seen this way.`);
    await showFolder();
    update();
  };

  if (canWrite) {
    els.fallback.hidden = true;
  } else {
    els.pick.remove();
    els.fallback.hidden = false;
    setText(els.folderStatus, 'This browser cannot write to a folder. The page offers the files as downloads instead. Chrome and Edge can write them directly. '
      + `${WEB_TEACH_PAGE_MODEL_FILE} will hold only this sound. If ${WEB_TEACH_PAGE_SOUNDS_DIR}/ already has other sounds, run npm run sounds:rebuild ${UNKNOWN_PROJECT}/${WEB_TEACH_PAGE_SOUNDS_DIR} after copying the files.`);
    els.loadFolder.addEventListener('change', () => { void loadReadOnly(Array.from(els.loadFolder.files ?? [])); });
  }

  // ---- Name ----
  els.name.addEventListener('input', update);

  // ---- Files of a take ----
  const makeNewFiles = (t: Take, ex: Existing | null): NewFile[] => {
    const names = newFileNames(t.label, ex?.listing.labels.find((l) => l.label === t.label)?.files ?? [], t.clips.length);
    return t.clips.map((clip, i) => {
      const bytes = writeWav(clip.samples, t.sampleRate);
      const back = readWav(bytes);   // the model is trained on the samples of the bytes that are written
      return { rec: { label: t.label, file: names[i], samples: back.samples, sampleRate: back.sampleRate }, bytes };
    });
  };

  function onClips(msg: Extract<WorkerToMain, { type: 'record-clips' }>): void {
    take = { label: msg.label, sampleRate: msg.sampleRate, clips: msg.clips };
    const files = makeNewFiles(take, existing);
    const id = ++requestCounter;
    dialogRequest = id;
    void train([...(existing?.recordings ?? []), ...files.map((f) => f.rec)], existing?.listing.emptyFolders ?? [], id).then((r) => {
      if (id !== dialogRequest) return;   // an older result
      recordListener?.(r.ok ? { type: 'record-trained', model: r.model, report: r.report } : { type: 'record-failed', message: r.message });
    });
  }

  const revokeDownloads = (): void => {
    for (const url of downloadUrls) URL.revokeObjectURL(url);
    downloadUrls = [];
    els.downloads.replaceChildren();
    setText(els.downloadHelp, '');
  };

  const rateLine = (micRate: number): string => {
    const fileRate = existing?.recordings[0]?.sampleRate;
    return fileRate === undefined ? '' : sampleRateWarning(micRate, fileRate) ?? '';
  };

  // ---- Save ----
  const showWritten = (paths: string[]): void => listOf(els.written, paths);

  const saveToFolder = async (t: Take): Promise<{ stored: boolean; text: string }> => {
    const written: string[] = [];
    let step = 'reading the folder';
    const dir = project as FsDir;
    try {
      await ensureWritePermission(dir);
      if (ears !== null) await stopTest();
      const fresh = await readFolder(dir);
      if (fresh.modelFile === 'foreign') throw new Error(`${WEB_TEACH_PAGE_MODEL_FILE} exists and is not a sounds model, so it was not overwritten.`);
      if (fresh.soundsDir === null) throw new Error(`The ${WEB_TEACH_PAGE_SOUNDS_DIR} folder is gone.`);
      const files = makeNewFiles(t, fresh);
      const before = fresh.recordings.length === 0 ? 0 : (model?.examples ?? []).filter((e) => e.label === t.label).length;
      step = 'training';
      const trained = await train([...fresh.recordings, ...files.map((f) => f.rec)], fresh.listing.emptyFolders);
      if (!trained.ok) throw new Error(trained.message);
      const text = soundsJsonText(trained.model);
      step = 'writing the wav files';
      const labelDir = await fresh.soundsDir.getDirectoryHandle(t.label, { create: true });
      for (const f of files) {
        if (await exists(labelDir, f.rec.file)) throw new Error(`${f.rec.file} appeared in the folder, and the page never overwrites a wav file.`);
        await writeBytes(labelDir, f.rec.file, f.bytes);
        written.push(relativePath(t.label, f.rec.file));
        showWritten(written);
      }
      step = `writing ${WEB_TEACH_PAGE_MODEL_FILE}`;
      await writeBytes(dir, WEB_TEACH_PAGE_MODEL_FILE, new TextEncoder().encode(text));
      written.push(WEB_TEACH_PAGE_MODEL_FILE);
      showWritten(written);

      step = 'checking the result';
      const command = rebuildCommand(dir.name);
      existing = await readFolder(dir);
      const again = await train(existing.recordings, existing.listing.emptyFolders);
      const same = again.ok && soundsJsonText(again.model) === text;
      model = again.ok ? again.model : trained.model;
      setText(els.verify, same
        ? `${WEB_TEACH_PAGE_MODEL_FILE} matches what ${command} writes.`
        : `${WEB_TEACH_PAGE_MODEL_FILE} differs from what ${command} writes. Run ${command} to build it from the files in the folder.`);
      const gave = trained.model.examples.filter((e) => e.label === t.label).length - before;
      const status = `Saved ${files.length} ${files.length === 1 ? 'recording' : 'recordings'} of "${t.label}" and ${WEB_TEACH_PAGE_MODEL_FILE} in ${dir.name}.`
        + (gave === files.length ? '' : ` Warning: ${files.length} new files gave ${gave} examples.`);
      setText(els.resultStatus, `${status} ${rateLine(t.sampleRate)}`.trim());
      await showFolder();
      return { stored: true, text: `${status} The files are listed under Result.` };
    } catch (e) {
      const list = written.length === 0 ? 'No file was written.' : `Written: ${written.join(', ')}.`;
      const text = `Saving failed while ${step}: ${messageOf(e)} ${list} `
        + `${rebuildCommand(dir.name)} builds ${WEB_TEACH_PAGE_MODEL_FILE} from the files that are there.`;
      setText(els.resultStatus, text);
      return { stored: false, text };
    }
  };

  const saveAsDownloads = async (t: Take): Promise<{ stored: boolean; text: string }> => {
    try {
      const files = makeNewFiles(t, existing);
      const trained = await train([...(existing?.recordings ?? []), ...files.map((f) => f.rec)], existing?.listing.emptyFolders ?? []);
      if (!trained.ok) throw new Error(trained.message);
      model = trained.model;
      revokeDownloads();
      const items: { name: string; bytes: Uint8Array; type: string }[] = [
        ...files.map((f) => ({ name: f.rec.file, bytes: f.bytes, type: WAV_MIME_TYPE })),
        { name: WEB_TEACH_PAGE_MODEL_FILE, bytes: new TextEncoder().encode(soundsJsonText(trained.model)), type: JSON_MIME_TYPE },
      ];
      els.downloads.replaceChildren(...items.map((item) => {
        const url = URL.createObjectURL(new Blob([item.bytes as BlobPart], { type: item.type }));
        downloadUrls.push(url);
        const a = document.createElement('a');
        a.href = url;
        a.download = item.name;
        a.textContent = item.name;
        a.setAttribute('data-download', '');
        const li = document.createElement('li');
        li.append(a);
        return li;
      }));
      const wavs = files.map((f) => f.rec.file);
      const root = projectName();
      setText(els.downloadHelp, `Put ${wavs[0]} to ${wavs[wavs.length - 1]} in ${root}/${WEB_TEACH_PAGE_SOUNDS_DIR}/${t.label}/ and ${WEB_TEACH_PAGE_MODEL_FILE} in ${root}/.`);
      const status = `Made ${files.length} ${files.length === 1 ? 'recording' : 'recordings'} of "${t.label}" and ${WEB_TEACH_PAGE_MODEL_FILE} for download.`;
      setText(els.resultStatus, `${status} ${rateLine(t.sampleRate)}`.trim());
      return { stored: true, text: `${status} The links are listed under Result.` };
    } catch (e) {
      const text = `The files could not be made: ${messageOf(e)}`;
      setText(els.resultStatus, text);
      return { stored: false, text };
    }
  };

  // ---- Record ----
  const controller: TeachController = {
    start: (label, kind) => post({ type: 'record-start', label, kind }),
    stop: (deleted) => post({ type: 'record-stop', deleted, clips: true }),
    end: (m) => post({ type: 'record-end', sounds: m }),
    cancel: () => post({ type: 'record-cancel' }),
    subscribe: (handler) => {
      recordListener = handler;
      return () => { if (recordListener === handler) recordListener = null; };
    },
  };

  els.record.addEventListener('click', () => {
    nameChecked = true;
    update();
    if (els.record.getAttribute('aria-disabled') === 'true') return;
    void (async () => {
      const label = els.name.value;
      dialogOpen = true;
      update();
      revokeDownloads();
      els.written.replaceChildren();
      setText(els.verify, '');
      setText(els.resultStatus, '');
      try {
        mic = await openMic();
      } catch (e) {
        dialogOpen = false;
        update();
        setText(els.recordReason, messageOf(e));
        return;
      }
      const opened = mic;
      setText(els.rateWarning, rateLine(opened.sampleRate));
      post({ type: 'init', sounds: null, sampleRate: opened.sampleRate, patterns: {}, mode: '', recordOnly: true });
      post({ type: 'connect', port: opened.workerPort as unknown as MessagePortLike }, [opened.workerPort]);
      mountTeachDialog({
        label,
        examples: RECOMMENDED_EXAMPLES_PER_LABEL,
        model: model ?? EMPTY_MODEL,
        controller,
        existingLine: existingText(label),
        onSave: () => {
          if (take === null) return Promise.resolve({ stored: false, text: 'There is no recording to save. Record again.' });
          const t = take;
          return (canWrite ? saveToFolder(t) : saveAsDownloads(t)).then((r) => { take = null; return r; });
        },
        onCancel: () => { /* nothing was written */ },
        onClose: () => {
          dialogOpen = false;
          take = null;   // the clips are dropped with the dialog
          recordListener = null;
          dialogRequest = 0;
          const closing = mic;
          mic = null;
          void closing?.close();
          update();
        },
      });
    })();
  });

  // ---- Test now ----
  const stopTest = async (): Promise<void> => {
    const running = ears;
    ears = null;
    await running?.stop();
    setText(els.testStatus, 'Stopped.');
    update();
  };

  els.testNow.addEventListener('click', () => {
    if (els.testNow.getAttribute('aria-disabled') === 'true' || model === null) return;
    void (async () => {
      try {
        ears = await listen({ sounds: model as SoundModel, debug: true, storageKey: WEB_TEACH_PAGE_TEST_STORAGE_KEY });
        setText(els.testStatus, 'Listening. Events appear in the debug panel.');
      } catch (e) {
        ears = null;
        setText(els.testStatus, messageOf(e));
      }
      update();
    })();
  });

  els.testStop.addEventListener('click', () => {
    if (els.testStop.getAttribute('aria-disabled') === 'true') return;
    void stopTest();
  });

  window.addEventListener('pagehide', () => {
    revokeDownloads();
    worker?.dispose();
    void mic?.close();
    void ears?.stop();
  });

  update();
}

main();
