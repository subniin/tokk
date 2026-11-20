// The teach dialog: a <dialog> in a Shadow DOM that shows the state of state.ts and talks to its engine through a
// controller. It sends nothing over the network and stores nothing. Every node is built with createElement and
// textContent. It does not import listen.ts, mic.ts or the overlay's mount function.

import type { TeachReport } from '../../core/teach';
import type { SoundModel } from '../../core/types';
import {
  WEB_TEACH_BACKGROUND_RECORD_MS, WEB_TEACH_FONT_SIZE_PX, WEB_TEACH_FOCUS_OUTLINE_PX, WEB_TEACH_HUM_RECORD_MS,
  WEB_TEACH_THUMBNAIL_HEIGHT_PX, WEB_TEACH_THUMBNAIL_WIDTH_PX, WEB_TEACH_WIDTH_PX, WEB_TEACH_Z_INDEX,
} from '../constants';
import { drawWaveform } from '../overlay/draw';
import type { DrawColours } from '../overlay/draw';
import { OVERLAY_COLOURS as C } from '../overlay/theme';
import type { WaveformView } from '../overlay/waveform';
import type { WorkerToMain } from '../protocol';
import type { RecordKind } from '../record-kind';
import { countLine, exampleLine, limitLine, replaceLine, reportLines, savedLine, stepText } from './format';
import { doneState, initialState, quietProgress, reduce, saveState, shouldUpdateProgress } from './state';
import type { TeachAction, TeachExample, TeachState } from './state';

export type RecordMessage = Extract<WorkerToMain, { type: 'record-progress' | 'record-segment' | 'record-limit' | 'record-trained' | 'record-failed' }>;

// The seam to the engine. listen() posts to its Worker. teach.html (Task 17) posts to a Worker without patterns.
export interface TeachController {
  start(label: string, kind: RecordKind): void;
  stop(deleted: string[]): void;
  end(model: SoundModel): void;
  cancel(): void;
  subscribe(handler: (msg: RecordMessage) => void): () => void;
}

export interface TeachDialogOptions {
  label: string;
  examples: number;                 // the number of sounds asked for
  model: SoundModel;                // the current model: tells how many examples the label has now
  controller: TeachController;
  onSave(model: SoundModel, report: TeachReport): { stored: boolean };
  onCancel(): void;                 // the user cancelled (button or Esc) before saving
  onClose?(): void;                 // the dialog is gone, whatever the way it closed
}

export interface TeachDialogHandle {
  destroy(): void;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const TITLE_ID = 'tokk-teach-title';
const REASON_ID = 'tokk-teach-reason';
const DEFAULT_PIXEL_RATIO = 1;

const STYLE = `
:host { all: initial; display: block; position: fixed; z-index: ${WEB_TEACH_Z_INDEX};
  font-family: system-ui, sans-serif; font-size: ${WEB_TEACH_FONT_SIZE_PX}px; line-height: 1.4; font-weight: 400;
  color: ${C.text}; text-align: left; }
* { box-sizing: border-box; transition: none; animation: none; }
dialog { width: min(${WEB_TEACH_WIDTH_PX}px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 16px;
  background: ${C.panelBackground}; color: ${C.text}; border: 1px solid ${C.backgroundMark}; border-radius: 4px; }
dialog::backdrop { background: rgba(0, 0, 0, 0.6); }
h2 { margin: 0 0 8px; font-size: 1.25em; font-weight: 700; }
p { margin: 8px 0; }
ul, ol { margin: 8px 0; padding-left: 20px; }
ol.examples { list-style: none; padding: 0; max-height: 240px; overflow-y: auto; }
li.example { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; border-top: 1px solid ${C.headerBackground}; }
li.example .text { flex: 1 1 160px; }
canvas { display: block; width: ${WEB_TEACH_THUMBNAIL_WIDTH_PX}px; height: ${WEB_TEACH_THUMBNAIL_HEIGHT_PX}px; background: ${C.canvasBackground}; }
progress { width: 100%; accent-color: ${C.waveform}; }
.footer { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.reason { margin: 8px 0 0; }
.error { margin: 8px 0; padding: 4px 8px; background: ${C.warningBackground}; color: ${C.warningText}; }
button { font: inherit; color: ${C.text}; background: ${C.headerBackground}; border: 1px solid ${C.text}; border-radius: 4px;
  padding: 4px 12px; min-height: 32px; cursor: pointer; }
button[aria-disabled="true"] { border-style: dashed; cursor: not-allowed; }
button:focus-visible, h2:focus-visible { outline: ${WEB_TEACH_FOCUS_OUTLINE_PX}px solid ${C.focusOutline}; outline-offset: 2px; }
[hidden] { display: none; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className !== undefined) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(action: string, text: string): HTMLButtonElement {
  const b = el('button', undefined, text);
  b.type = 'button';
  b.setAttribute('data-action', action);
  return b;
}

const THUMB_COLOURS: DrawColours = {
  background: C.canvasBackground, waveform: C.waveform, baseline: C.baseline, unknown: C.unknownMark, backgroundMark: C.backgroundMark,
  text: C.text, halo: C.halo, labelColour: () => C.waveform,
};

// The min and max of one segment, scaled to the segment's own peak, drawn once.
function thumbnailView(e: TeachExample): WaveformView {
  const n = e.min.length;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(e.min[i]), Math.abs(e.max[i]));
  const scale = peak > 0 ? 1 / peak : 1;
  return {
    startS: 0, endS: 0, binWidth: n > 0 ? 1 / n : 1, marks: [],
    bins: Array.from({ length: n }, (_, i) => ({ x: i / n, min: e.min[i] * scale, max: e.max[i] * scale })),
  };
}

function thumbnail(e: TeachExample): HTMLCanvasElement {
  const canvas = el('canvas');
  const dpr = typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0 ? window.devicePixelRatio : DEFAULT_PIXEL_RATIO;
  canvas.width = Math.round(WEB_TEACH_THUMBNAIL_WIDTH_PX * dpr);
  canvas.height = Math.round(WEB_TEACH_THUMBNAIL_HEIGHT_PX * dpr);
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Waveform of example ${e.number}`);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWaveform(ctx, thumbnailView(e), THUMB_COLOURS, WEB_TEACH_THUMBNAIL_WIDTH_PX, WEB_TEACH_THUMBNAIL_HEIGHT_PX);
  }
  return canvas;
}

type View = 'live' | 'review' | 'saved';

export function mountTeachDialog(o: TeachDialogOptions): TeachDialogHandle {
  let state: TeachState = initialState({ label: o.label, target: o.examples });
  const kind = state.kind;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let destroyed = false;
  let view: View | null = null;
  let reducedMotion = false;
  let lastProgressMs: number | null = null;
  let lastProgressValue = -1;
  let mql: MediaQueryList | null = null;

  const host = el('div');
  host.setAttribute('data-tokk-teach', '');
  const root = host.attachShadow({ mode: 'open' });
  const style = el('style');
  style.textContent = STYLE;
  const dialog = el('dialog');
  dialog.setAttribute('aria-labelledby', TITLE_ID);
  const title = el('h2', undefined, `Teach "${o.label}"`);
  title.id = TITLE_ID;
  title.tabIndex = -1;
  const status = el('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('data-role', 'step');
  const body = el('div');
  const footer = el('div', 'footer');
  dialog.append(title, status, body, footer);
  root.append(style, dialog);

  // Parts of the current view, set by build().
  let progress: HTMLProgressElement | null = null;
  let count: HTMLElement | null = null;
  let list: HTMLOListElement | null = null;
  let limit: HTMLElement | null = null;
  let reason: HTMLElement | null = null;
  let doneButton: HTMLButtonElement | null = null;
  let saveButton: HTMLButtonElement | null = null;
  const items = new Map<string, HTMLLIElement>();   // one cell per example, built once so its thumbnail is drawn once

  const setText = (e: HTMLElement, text: string): void => { if (e.textContent !== text) e.textContent = text; };

  const setGate = (b: HTMLButtonElement, r: HTMLElement, gate: { enabled: boolean; reason: string }): void => {
    b.setAttribute('aria-disabled', gate.enabled ? 'false' : 'true');
    setText(r, gate.reason);
  };

  const makeReason = (): HTMLElement => {
    const r = el('p', 'reason');
    r.id = REASON_ID;
    r.setAttribute('data-role', 'reason');
    return r;
  };

  const requiredMs = (): number => (kind === 'hum' ? WEB_TEACH_HUM_RECORD_MS : WEB_TEACH_BACKGROUND_RECORD_MS);

  const buildLive = (): void => {
    const notice = replaceLine({ label: o.label, kind, model: o.model });
    const parts: HTMLElement[] = [];
    if (notice !== null) {
      const p = el('p', undefined, notice);
      p.setAttribute('data-role', 'replace');
      parts.push(p);
    }
    progress = el('progress');
    progress.max = 1;
    progress.value = 0;
    progress.setAttribute('aria-label', kind === 'sound' ? 'Quiet second' : 'Recording time');
    parts.push(progress);
    if (kind === 'sound') {
      count = el('p');
      count.setAttribute('data-role', 'count');
      list = el('ol', 'examples');
      list.setAttribute('aria-label', 'Examples heard');
      parts.push(count, list);
    }
    limit = el('p', undefined, limitLine());
    limit.hidden = true;
    limit.setAttribute('data-role', 'limit');
    reason = makeReason();
    parts.push(limit, reason);
    body.replaceChildren(...parts);
    doneButton = button('done', 'Done');
    doneButton.setAttribute('aria-describedby', REASON_ID);
    const cancel = button('cancel', 'Cancel (Esc)');
    footer.replaceChildren(doneButton, cancel);
    saveButton = null;
  };

  const lines = (): HTMLElement => {
    const ul = el('ul');
    ul.setAttribute('data-role', 'report');
    const report = state.report;
    if (report !== null) for (const line of reportLines(report, state.model)) ul.append(el('li', undefined, line));
    return ul;
  };

  const buildReview = (): void => {
    const parts: HTMLElement[] = [];
    if (state.error !== null) {
      const e = el('p', 'error', state.error);
      e.setAttribute('data-role', 'error');
      parts.push(e);
    } else {
      parts.push(lines());
    }
    reason = makeReason();
    parts.push(reason);
    body.replaceChildren(...parts);
    const again = button('again', 'Record again');
    const cancel = button('cancel', 'Cancel (Esc)');
    if (state.error !== null) {
      footer.replaceChildren(again, cancel);
      saveButton = null;
    } else {
      saveButton = button('save', 'Save');
      saveButton.setAttribute('aria-describedby', REASON_ID);
      footer.replaceChildren(saveButton, again, cancel);
    }
    doneButton = null;
  };

  const buildSaved = (): void => {
    const saved = el('p', undefined, savedLine(state.saveStored));
    saved.setAttribute('data-role', 'saved');
    body.replaceChildren(lines(), saved);
    footer.replaceChildren(button('close', 'Close'));
    reason = null;
    saveButton = null;
    doneButton = null;
  };

  const exampleItem = (e: TeachExample): HTMLLIElement => {
    const li = el('li', 'example');
    li.setAttribute('data-example', e.id);
    const del = button('delete', 'Delete');
    del.setAttribute('aria-label', `Delete example ${e.number}`);
    li.append(el('span', 'text', exampleLine(e)), thumbnail(e), del);
    return li;
  };

  const syncList = (): void => {
    if (list === null) return;
    for (const e of state.examples) {
      const existing = items.get(e.id);
      if (e.deleted) {
        existing?.remove();
        items.delete(e.id);
      } else if (existing === undefined) {
        const li = exampleItem(e);
        items.set(e.id, li);
        list.append(li);
      }
    }
  };

  const refreshProgress = (): void => {
    if (progress === null) return;
    const value = kind === 'sound' ? quietProgress(state) : Math.min(1, state.elapsedMs / requiredMs());
    progress.hidden = kind === 'sound' && state.phase !== 'quiet';
    if (value >= 1 || value < lastProgressValue || shouldUpdateProgress({ reducedMotion, nowMs: performance.now(), lastUpdateMs: lastProgressMs })) {
      progress.value = value;
      lastProgressValue = value;
      lastProgressMs = performance.now();   // paces this display only, never a shown time
    }
  };

  const refresh = (): void => {
    if (view === 'live') {
      setText(status, stepText(state));
      refreshProgress();
      if (count !== null) setText(count, countLine(state));
      syncList();
      if (limit !== null) limit.hidden = !state.limitReached;
      if (doneButton !== null && reason !== null) setGate(doneButton, reason, doneState(state));
    } else if (view === 'review') {
      setText(status, state.error !== null ? 'Training failed.' : 'Check the result, then save it.');
      if (saveButton !== null && reason !== null) setGate(saveButton, reason, saveState(state));
      else if (reason !== null) setText(reason, '');
    } else if (view === 'saved') {
      setText(status, savedLine(state.saveStored));
    }
  };

  const viewOf = (s: TeachState): View | null => {
    if (s.phase === 'quiet' || s.phase === 'recording') return 'live';
    if (s.phase === 'review') return 'review';
    if (s.phase === 'saved') return 'saved';
    return null;
  };

  const render = (): void => {
    const next = viewOf(state);
    if (next === null) return;
    if (next !== view) {
      view = next;
      if (next === 'live') buildLive();
      else if (next === 'review') buildReview();
      else buildSaved();
      items.clear();
      refresh();
      title.focus();   // the old controls are gone, so the focus goes to the heading
      return;
    }
    refresh();
    if (view === 'saved') {
      const saved = body.querySelector('[data-role="saved"]');
      if (saved instanceof HTMLElement) setText(saved, savedLine(state.saveStored));
    }
  };

  const apply = (a: TeachAction): void => {
    const next = reduce(state, a);
    if (next === state) return;
    state = next;
    render();
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    unsubscribe();
    mql?.removeEventListener('change', onMotionChange);
    dialog.removeEventListener('cancel', onEsc);
    footer.removeEventListener('click', onFooterClick);
    body.removeEventListener('click', onBodyClick);
    if (dialog.open) dialog.close();
    host.remove();
    items.clear();
    state = initialState({ label: o.label, target: o.examples });   // no example, thumbnail or model stays referenced
    progress = count = list = limit = reason = doneButton = saveButton = null;
    body.replaceChildren();
    footer.replaceChildren();
    if (previousFocus?.isConnected) previousFocus.focus();
    o.onClose?.();
  };

  const cancelRecording = (): void => {
    o.controller.cancel();
    apply({ type: 'cancel' });
    o.onCancel();
    destroy();
  };

  const onEsc = (e: Event): void => {
    e.preventDefault();   // one close path with one cleanup
    if (state.phase === 'saved') destroy();
    else cancelRecording();
  };

  const isDisabled = (b: HTMLElement): boolean => b.getAttribute('aria-disabled') === 'true';

  const onDone = (): void => {
    const before = state;
    apply({ type: 'done' });
    if (state !== before && state.finishing) {
      o.controller.stop(state.examples.filter((e) => e.deleted).map((e) => e.id));
    }
  };

  const onSave = (): void => {
    const { model, report } = state;
    apply({ type: 'save' });
    if (state.phase !== 'saved' || model === null || report === null) return;
    o.controller.end(model);
    let stored = false;
    try {
      stored = o.onSave(model, report).stored;
    } catch (e) {
      console.error('tokk: saving the taught model failed:', e);
    }
    apply({ type: 'stored', ok: stored });
  };

  const onAgain = (): void => {
    o.controller.cancel();
    apply({ type: 'again' });
    o.controller.start(o.label, kind);
  };

  const onDelete = (li: HTMLElement): void => {
    const id = li.getAttribute('data-example');
    if (id === null) return;
    const index = state.examples.findIndex((e) => e.id === id);
    apply({ type: 'delete', id });
    const nextExample = state.examples.slice(index + 1).find((e) => !e.deleted);
    const target = nextExample === undefined ? doneButton : items.get(nextExample.id)?.querySelector<HTMLButtonElement>('[data-action="delete"]');
    target?.focus();
  };

  function onFooterClick(e: Event): void {
    const b = (e.target as HTMLElement).closest('button');
    if (b === null) return;
    switch (b.getAttribute('data-action')) {
      case 'done': if (!isDisabled(b)) onDone(); return;
      case 'save': if (!isDisabled(b)) onSave(); return;
      case 'again': onAgain(); return;
      case 'cancel': cancelRecording(); return;
      case 'close': destroy(); return;
      default:
    }
  }

  function onBodyClick(e: Event): void {
    const b = (e.target as HTMLElement).closest('button');
    const li = b?.closest('li[data-example]');
    if (b?.getAttribute('data-action') === 'delete' && li instanceof HTMLElement) onDelete(li);
  }

  function onMotionChange(e: MediaQueryListEvent): void {
    reducedMotion = e.matches;
  }

  const unsubscribe = o.controller.subscribe((m) => {
    if (destroyed) return;
    switch (m.type) {
      case 'record-progress': apply({ type: 'progress', t: m.t }); return;
      case 'record-segment': apply({ type: 'segment', id: m.id, t: m.t, durationMs: m.durationMs, min: m.min, max: m.max }); return;
      case 'record-limit': apply({ type: 'limit' }); return;
      case 'record-trained': apply({ type: 'trained', model: m.model, report: m.report }); return;
      case 'record-failed': apply({ type: 'failed', message: m.message }); return;
    }
  });

  if (typeof window.matchMedia === 'function') {
    mql = window.matchMedia(REDUCED_MOTION_QUERY);
    reducedMotion = mql.matches;
    mql.addEventListener('change', onMotionChange);
  }
  dialog.addEventListener('cancel', onEsc);
  footer.addEventListener('click', onFooterClick);
  body.addEventListener('click', onBodyClick);

  document.body.append(host);
  render();
  dialog.showModal();
  title.focus();
  o.controller.start(o.label, kind);

  return { destroy };
}
