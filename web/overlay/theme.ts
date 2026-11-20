// Colours of the overlay. No DOM type, so a vitest test can compute their contrast ratios.
// Every text pair has a contrast of at least 4.5 to 1 and every graphic pair at least 3 to 1 (test/overlay-theme.test.ts).

export const OVERLAY_COLOURS = {
  panelBackground: '#14181f',
  headerBackground: '#232a35',
  text: '#e8ecf1',
  warningBackground: '#4a3a00',
  warningText: '#ffe9a8',
  canvasBackground: '#0d1117',
  waveform: '#8fb8e8',
  baseline: '#5a6472',
  unknownMark: '#b4bcc6',
  backgroundMark: '#9aa4b0',
  focusOutline: '#ffd166',
  halo: '#000000',
} as const;

// Okabe-Ito palette without black (7 colours), in the published order.
export const LABEL_PALETTE: readonly string[] = [
  '#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7',
];
