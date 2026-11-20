import { describe, expect, it } from 'vitest';
import { LABEL_PALETTE, OVERLAY_COLOURS as C } from '../web/overlay/theme';

// Test-only values (WCAG 2.x).
const TEXT_CONTRAST_MIN = 4.5;
const GRAPHIC_CONTRAST_MIN = 3;
const SRGB_LINEAR_KNEE = 0.04045;
const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 };

function channel(v: number): number {
  const s = v / 255;
  return s <= SRGB_LINEAR_KNEE ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return LUMA.r * channel((n >> 16) & 255) + LUMA.g * channel((n >> 8) & 255) + LUMA.b * channel(n & 255);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [string, string, string][] = [
  ['text on panel', C.text, C.panelBackground],
  ['text on header', C.text, C.headerBackground],
  ['text on canvas', C.text, C.canvasBackground],
  ['warning text on warning background', C.warningText, C.warningBackground],
];

const GRAPHIC_PAIRS: [string, string, string][] = [
  ['unknown mark on canvas', C.unknownMark, C.canvasBackground],
  ['background mark on canvas', C.backgroundMark, C.canvasBackground],
  ['waveform on canvas', C.waveform, C.canvasBackground],
  ['baseline on canvas', C.baseline, C.canvasBackground],
  ['focus outline on header', C.focusOutline, C.headerBackground],
  ['focus outline on panel', C.focusOutline, C.panelBackground],
  ...LABEL_PALETTE.map((c): [string, string, string] => [`label colour ${c} on canvas`, c, C.canvasBackground]),
];

describe('overlay colours', () => {
  it.each(TEXT_PAIRS)('%s has a contrast of at least 4.5 to 1', (_n, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
  });

  it.each(GRAPHIC_PAIRS)('%s has a contrast of at least 3 to 1', (_n, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST_MIN);
  });

  it('has the 7 colours of the Okabe-Ito palette without black', () => {
    expect(LABEL_PALETTE.length).toBe(7);
    expect(new Set(LABEL_PALETTE).size).toBe(7);
  });
});
