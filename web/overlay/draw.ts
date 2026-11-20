// Canvas drawing of the waveform and its marks. No state, no DOM except the context type. This is the only file
// of the overlay that calls the canvas API. Task 16 reuses it for the segment cells with another view.

import { WEB_OVERLAY_FONT_SIZE_PX, WEB_OVERLAY_MARK_MIN_WIDTH_PX } from '../constants';
import type { WaveformView } from './waveform';

export interface DrawColours {
  background: string;
  waveform: string;
  baseline: string;
  unknown: string;
  backgroundMark: string;
  text: string;
  halo: string;
  labelColour(label: string): string;
}

const MARK_FILL_ALPHA = 0.25;
const MARK_LINE_WIDTH_PX = 1.5;
const HALO_WIDTH_PX = 3;
const DASH_PX = [4, 3];
const TEXT_PAD_PX = 2;
const LABEL_BASELINE_PX = 3;     // distance of the text baseline from the top edge, plus the font size

// `widthPx` and `heightPx` are CSS pixels. The caller has already scaled the context for the device pixel ratio.
export function drawWaveform(ctx: CanvasRenderingContext2D, view: WaveformView, colours: DrawColours, widthPx: number, heightPx: number): void {
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.fillStyle = colours.background;
  ctx.fillRect(0, 0, widthPx, heightPx);

  const mid = heightPx / 2;
  ctx.fillStyle = colours.baseline;
  ctx.fillRect(0, Math.floor(mid), widthPx, 1);

  ctx.fillStyle = colours.waveform;
  const binPx = Math.max(1, view.binWidth * widthPx);
  for (const b of view.bins) {
    const x = b.x * widthPx;
    if (x + binPx < 0 || x > widthPx) continue;
    const top = mid - Math.min(1, Math.max(-1, b.max)) * mid;
    const bottom = mid - Math.min(1, Math.max(-1, b.min)) * mid;
    ctx.fillRect(x, top, binPx, Math.max(1, bottom - top));
  }

  ctx.font = `${WEB_OVERLAY_FONT_SIZE_PX}px sans-serif`;
  ctx.textBaseline = 'alphabetic';
  for (const m of view.marks) {
    const x0 = m.x0 * widthPx;
    const w = Math.max(WEB_OVERLAY_MARK_MIN_WIDTH_PX, (m.x1 - m.x0) * widthPx);
    const x = Math.min(x0, widthPx - w);
    const colour = m.kind === 'sound' ? colours.labelColour(m.label) : m.kind === 'unknown' ? colours.unknown : colours.backgroundMark;
    ctx.globalAlpha = MARK_FILL_ALPHA;
    ctx.fillStyle = colour;
    ctx.fillRect(x, 0, w, heightPx);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colour;
    ctx.lineWidth = MARK_LINE_WIDTH_PX;
    ctx.setLineDash(m.kind === 'background' ? DASH_PX : []);
    ctx.strokeRect(x + MARK_LINE_WIDTH_PX / 2, MARK_LINE_WIDTH_PX / 2, Math.max(1, w - MARK_LINE_WIDTH_PX), heightPx - MARK_LINE_WIDTH_PX);
    ctx.setLineDash([]);

    // Text with a dark halo, kept inside the canvas.
    const textWidth = ctx.measureText(m.label).width;
    const tx = Math.max(TEXT_PAD_PX, Math.min(x + w + TEXT_PAD_PX, widthPx - textWidth - TEXT_PAD_PX));
    const ty = WEB_OVERLAY_FONT_SIZE_PX + LABEL_BASELINE_PX;
    ctx.lineJoin = 'round';
    ctx.lineWidth = HALO_WIDTH_PX;
    ctx.strokeStyle = colours.halo;
    ctx.strokeText(m.label, tx, ty);
    ctx.fillStyle = colours.text;
    ctx.fillText(m.label, tx, ty);
  }
}
