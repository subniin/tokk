// DOM: the ectoplasm canvas. Flowing: a requestAnimationFrame loop (the browser stops it in a hidden tab). Reduced motion:
// one still image, drawn again only on a resize or a change of the setting, at most once per ECTO_RESIZE_DEBOUNCE_MS, and
// nothing scheduled in between. The envelope is only drawn: the history keeps one number per bin for ECTO_HISTORY_MS.
import {
  COLOR_ECTO, ECTO_CANVAS_MAX_WIDTH_PX, ECTO_GLOW_PX, ECTO_LAYER_COUNT, ECTO_LEVEL_WINDOW_MS, ECTO_RESIZE_DEBOUNCE_MS, ECTO_STROKE_PX,
} from './constants';
import { createHistory, fold, levelOf, ribbonPoints, settleFactor, shownLevel, stillRibbonPoints } from './ectoplasm';
import type { EnvelopeLike, History, Point } from './ectoplasm';

const LABEL_FLOWING = 'A pale glowing ribbon that moves with the sounds in the room';
const LABEL_STILL = 'A still pale glowing ribbon';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
const LEVEL_DIGITS = 2;
const GLOW_ALPHA = 0.18;
const LAYER_ALPHAS = [1, 0.7, 0.5];

export interface Ectoplasm { onEnvelope(env: EnvelopeLike): void }

export function startEctoplasm(canvas: HTMLCanvasElement): Ectoplasm {
  const ctx = canvas.getContext('2d');
  const media = window.matchMedia(REDUCED_QUERY);
  let history: History | null = null;
  let lastEnvelopeMs = Number.NEGATIVE_INFINITY;
  let frame: number | null = null;
  let lastStillDrawMs = Number.NEGATIVE_INFINITY;
  let stillTimer: ReturnType<typeof setTimeout> | null = null;

  const setAttr = (name: string, value: string): void => {
    if (canvas.getAttribute(name) !== value) canvas.setAttribute(name, value);
  };

  // The drawing size follows the element, at most ECTO_CANVAS_MAX_WIDTH_PX wide.
  const fit = (): void => {
    const w = Math.max(1, Math.min(ECTO_CANVAS_MAX_WIDTH_PX, Math.round(canvas.clientWidth)));
    const h = Math.max(1, Math.round(canvas.clientHeight));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  };

  const stroke = (points: Point[], alpha: number): void => {
    if (ctx === null || points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = COLOR_ECTO;
    ctx.globalAlpha = alpha * GLOW_ALPHA;
    ctx.lineWidth = ECTO_GLOW_PX;
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = ECTO_STROKE_PX;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  const draw = (layers: (layer: number) => Point[]): void => {
    if (ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineJoin = 'round';
    for (let l = ECTO_LAYER_COUNT - 1; l >= 0; l--) stroke(layers(l), LAYER_ALPHAS[l] ?? 1);
  };

  const flowingFrame = (nowMs: number): void => {
    frame = null;
    fit();
    const settle = settleFactor(nowMs - lastEnvelopeMs);
    const h = history ?? createHistory(1);
    draw((l) => ribbonPoints(h, canvas.width, canvas.height, nowMs, l, settle));
    setAttr('data-level', shownLevel(history === null ? 0 : levelOf(history, ECTO_LEVEL_WINDOW_MS), settle).toFixed(LEVEL_DIGITS));
    frame = requestAnimationFrame(flowingFrame);
  };

  const drawStill = (): void => {
    stillTimer = null;
    lastStillDrawMs = performance.now();
    fit();
    draw((l) => stillRibbonPoints(canvas.width, canvas.height, l));
  };
  // A still redraw at most once per ECTO_RESIZE_DEBOUNCE_MS; only a resize or a change of the setting asks for one.
  const requestStill = (): void => {
    if (stillTimer !== null) return;
    const waitMs = lastStillDrawMs + ECTO_RESIZE_DEBOUNCE_MS - performance.now();
    if (waitMs <= 0) drawStill();
    else stillTimer = setTimeout(drawStill, waitMs);
  };

  const apply = (): void => {
    if (media.matches) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      setAttr('data-mode', 'still');
      setAttr('aria-label', LABEL_STILL);
      canvas.removeAttribute('data-level');
      requestStill();
    } else {
      setAttr('data-mode', 'flowing');
      setAttr('aria-label', LABEL_FLOWING);
      if (frame === null) frame = requestAnimationFrame(flowingFrame);
    }
  };

  media.addEventListener('change', apply);
  window.addEventListener('resize', () => { if (media.matches) requestStill(); });
  apply();

  return {
    onEnvelope(env: EnvelopeLike): void {
      lastEnvelopeMs = performance.now();
      if (history === null || history.binMs !== env.binMs) history = createHistory(env.binMs);
      history = fold(history, env);
    },
  };
}
