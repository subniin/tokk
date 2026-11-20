// The debug panel: one host element with an open shadow root, a header, a waveform canvas and the last rows of results.
// It sends nothing over the network and stores nothing. Rows are built with createElement and textContent.

import type { SegmentReport } from '../../core/engine';
import type { MatchEvent, SoundModel } from '../../core/types';
import {
  WEB_OVERLAY_FONT_SIZE_PX, WEB_OVERLAY_MARGIN_PX, WEB_OVERLAY_MAX_ROWS, WEB_OVERLAY_ROWS_MAX_HEIGHT_PX,
  WEB_OVERLAY_WAVEFORM_HEIGHT_PX, WEB_OVERLAY_WIDTH_PX, WEB_OVERLAY_Z_INDEX,
} from '../constants';
import type { WorkerToMain } from '../protocol';
import { drawWaveform } from './draw';
import type { DrawColours } from './draw';
import { formatEventRow, formatMatchRow, sampleRateWarning, stateLabel } from './format';
import type { OverlayState } from './format';
import { LABEL_PALETTE, OVERLAY_COLOURS as C } from './theme';
import { createWaveformModel, nextRedraw } from './waveform';

export interface OverlayHandle {
  onEnvelope(msg: Extract<WorkerToMain, { type: 'envelope' }>): void;
  // The input is a segment report (the only message that has the nearest example and the distance).
  onEvent(report: SegmentReport): void;
  onMatch(pattern: string, match: MatchEvent): void;
  setState(state: OverlayState): void;
  destroy(): void;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const BODY_ID = 'tokk-overlay-body';
const ROW_SEPARATOR = '  ';
const CANVAS_LABEL = 'Waveform of the last 5 seconds, with a mark for every classified sound.';
const DEFAULT_PIXEL_RATIO = 1;

const STYLE = `
:host { all: initial; display: block; position: fixed; right: ${WEB_OVERLAY_MARGIN_PX}px; bottom: ${WEB_OVERLAY_MARGIN_PX}px;
  z-index: ${WEB_OVERLAY_Z_INDEX}; width: min(${WEB_OVERLAY_WIDTH_PX}px, calc(100vw - ${2 * WEB_OVERLAY_MARGIN_PX}px));
  font-family: system-ui, sans-serif; font-size: ${WEB_OVERLAY_FONT_SIZE_PX}px; line-height: 1.4; font-weight: 400;
  color: ${C.text}; text-align: left; }
* { box-sizing: border-box; transition: none; animation: none; }
.panel { background: ${C.panelBackground}; border: 1px solid ${C.baseline}; border-radius: 4px; overflow: hidden; }
.header { display: flex; align-items: center; gap: 8px; padding: 4px 8px; background: ${C.headerBackground}; }
.title { font-weight: 700; flex: 1; }
.badge { padding: 0 6px; border: 1px solid ${C.text}; border-radius: 8px; }
button { font: inherit; color: inherit; background: transparent; border: 1px solid ${C.text}; border-radius: 4px; padding: 0 8px; cursor: pointer; }
button:focus-visible, .rows:focus-visible { outline: 2px solid ${C.focusOutline}; outline-offset: 2px; }
.warning { margin: 0; padding: 4px 8px; background: ${C.warningBackground}; color: ${C.warningText}; }
.body[hidden] { display: none; }
canvas { display: block; width: ${WEB_OVERLAY_WIDTH_PX}px; max-width: 100%; height: ${WEB_OVERLAY_WAVEFORM_HEIGHT_PX}px; background: ${C.canvasBackground}; }
.rows { list-style: none; margin: 0; padding: 0; max-height: ${WEB_OVERLAY_ROWS_MAX_HEIGHT_PX}px; overflow-y: auto; }
.row { padding: 2px 8px; border-top: 1px solid ${C.headerBackground}; white-space: pre-wrap; overflow-wrap: anywhere; font-weight: 400; }
.row.match { font-weight: 700; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className !== undefined) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountOverlay(o: { sounds: SoundModel; sampleRate: number }): OverlayHandle {
  const labels = Object.keys(o.sounds.thresholds).sort();
  const colours: DrawColours = {
    background: C.canvasBackground, waveform: C.waveform, baseline: C.baseline, unknown: C.unknownMark,
    backgroundMark: C.backgroundMark, text: C.text, halo: C.halo,
    labelColour: (label) => LABEL_PALETTE[Math.max(0, labels.indexOf(label)) % LABEL_PALETTE.length],
  };
  const model = createWaveformModel({ sampleRate: o.sampleRate });

  const host = el('div');
  host.setAttribute('data-tokk-overlay', '');
  const root = host.attachShadow({ mode: 'open' });
  const style = el('style');
  style.textContent = STYLE;
  const panel = el('section', 'panel');
  const header = el('header', 'header');
  const title = el('span', 'title', 'Tokk debug');
  const badge = el('span', 'badge', stateLabel('listening'));
  badge.setAttribute('role', 'status');
  const button = el('button', undefined, 'Collapse');
  button.type = 'button';
  button.setAttribute('aria-label', 'Collapse debug panel');
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-controls', BODY_ID);
  header.append(title, badge, button);
  panel.append(header);

  const warningText = sampleRateWarning(o.sampleRate, o.sounds.sampleRate);
  if (warningText !== null) {
    const warning = el('p', 'warning', warningText);
    warning.setAttribute('role', 'status');
    panel.append(warning);
  }

  const body = el('div', 'body');
  body.id = BODY_ID;
  const canvas = el('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', CANVAS_LABEL);
  const rows = el('ol', 'rows');
  rows.tabIndex = 0;   // the list scrolls, so a keyboard user must be able to focus it
  rows.setAttribute('aria-label', 'Recent results, newest first');
  body.append(canvas, rows);
  panel.append(body);
  root.append(style, panel);

  let destroyed = false;
  let collapsed = false;
  let dirty = true;
  let lastDrawMs: number | null = null;
  let frameId: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let reducedMotion = false;
  let mql: MediaQueryList | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let waitingForBody = false;

  const pixelRatio = (): number => (typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0 ? window.devicePixelRatio : DEFAULT_PIXEL_RATIO);

  const setupCanvas = (): void => {
    const dpr = pixelRatio();
    canvas.width = Math.round(WEB_OVERLAY_WIDTH_PX * dpr);
    canvas.height = Math.round(WEB_OVERLAY_WAVEFORM_HEIGHT_PX * dpr);
    ctx = canvas.getContext('2d');
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  setupCanvas();

  const cancelSchedule = (): void => {
    if (frameId !== null) { cancelAnimationFrame(frameId); frameId = null; }
    if (timerId !== null) { clearTimeout(timerId); timerId = null; }
  };

  const draw = (): void => {
    frameId = null;
    timerId = null;
    if (destroyed || collapsed || ctx === null) return;
    dirty = false;
    lastDrawMs = performance.now();   // schedules the next redraw only, never a shown time
    drawWaveform(ctx, model.view(), colours, WEB_OVERLAY_WIDTH_PX, WEB_OVERLAY_WAVEFORM_HEIGHT_PX);
  };

  const schedule = (): void => {
    if (destroyed || collapsed || frameId !== null || timerId !== null) return;
    const next = nextRedraw({ reducedMotion, dirty, nowMs: performance.now(), lastDrawMs });
    if (next.action === 'frame') frameId = requestAnimationFrame(draw);
    else if (next.action === 'timer') timerId = setTimeout(draw, next.delayMs);
  };

  const markDirty = (): void => {
    dirty = true;
    schedule();
  };

  const onMotionChange = (e: MediaQueryListEvent): void => {
    reducedMotion = e.matches;
    cancelSchedule();
    schedule();
  };
  if (typeof window.matchMedia === 'function') {
    mql = window.matchMedia(REDUCED_MOTION_QUERY);
    reducedMotion = mql.matches;
    mql.addEventListener('change', onMotionChange);
  }

  const toggle = (): void => {
    collapsed = !collapsed;
    body.hidden = collapsed;
    button.textContent = collapsed ? 'Expand' : 'Collapse';
    button.setAttribute('aria-label', collapsed ? 'Expand debug panel' : 'Collapse debug panel');
    button.setAttribute('aria-expanded', String(!collapsed));
    if (collapsed) cancelSchedule();
    else markDirty();
  };
  button.addEventListener('click', toggle);

  const attach = (): void => {
    waitingForBody = false;
    if (!destroyed) document.body.append(host);
  };
  if (document.body) attach();
  else {
    waitingForBody = true;
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  }

  const addRow = (className: string, text: string): void => {
    const li = el('li', `row ${className}`);
    li.setAttribute('aria-label', text);
    text.split(ROW_SEPARATOR).forEach((part, i) => {
      if (i > 0) li.append(document.createTextNode(ROW_SEPARATOR));
      li.append(el('span', 'cell', part));
    });
    rows.insertBefore(li, rows.firstChild);
    while (rows.childElementCount > WEB_OVERLAY_MAX_ROWS) rows.lastElementChild?.remove();
  };

  return {
    onEnvelope(msg) {
      if (destroyed) return;
      model.pushEnvelope(msg.t0, msg.min, msg.max);
      markDirty();
    },
    onEvent(report) {
      if (destroyed) return;
      model.pushSegment(report);
      const row = formatEventRow(report, o.sounds.thresholds);
      addRow(`event ${row.kind}`, row.text);
      markDirty();
    },
    onMatch(pattern, match) {
      if (destroyed) return;
      addRow('match', formatMatchRow(pattern, match).text);
    },
    setState(state) {
      if (destroyed) return;
      badge.textContent = stateLabel(state);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelSchedule();
      mql?.removeEventListener('change', onMotionChange);
      button.removeEventListener('click', toggle);
      if (waitingForBody) document.removeEventListener('DOMContentLoaded', attach);
      host.remove();
      canvas.width = 0;
      canvas.height = 0;
      ctx = null;
    },
  };
}
