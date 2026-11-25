// The style of the teach dialog (moved out of teach-dialog.ts in Task 20). An app themes the dialog only through five
// CSS custom properties set on an ancestor of the dialog host (body, html or :root): --tokk-bg, --tokk-fg,
// --tokk-accent, --tokk-font and --tokk-radius. Custom properties inherit into the Shadow DOM, while `all: initial`
// keeps every other page style out. Each var() falls back to the value before Task 20, so the default look is unchanged.
// The focus outline, the warning colours, the canvas background and the backdrop are not themable. The app is
// responsible for the contrast of its own colours (text 4.5 to 1 against --tokk-bg, graphics 3 to 1).

import {
  WEB_TEACH_FOCUS_OUTLINE_PX, WEB_TEACH_FONT_SIZE_MAX_PX, WEB_TEACH_FONT_SIZE_PX, WEB_TEACH_RADIUS_PX, WEB_TEACH_THUMBNAIL_HEIGHT_PX,
  WEB_TEACH_THUMBNAIL_WIDTH_PX, WEB_TEACH_WIDTH_MAX_PX, WEB_TEACH_WIDTH_PX, WEB_TEACH_Z_INDEX,
} from '../constants';
import { fluidPx } from '../fluid';
import { OVERLAY_COLOURS as C } from '../overlay/theme';

const FG = `var(--tokk-fg, ${C.text})`;
const RADIUS = `var(--tokk-radius, ${WEB_TEACH_RADIUS_PX}px)`;

export const TEACH_DIALOG_STYLE = `
:host { all: initial; display: block; position: fixed; z-index: ${WEB_TEACH_Z_INDEX};
  font-family: var(--tokk-font, system-ui, sans-serif); font-size: ${fluidPx(WEB_TEACH_FONT_SIZE_PX, WEB_TEACH_FONT_SIZE_MAX_PX)}; line-height: 1.4; font-weight: 400;
  color: ${FG}; text-align: left; }
* { box-sizing: border-box; transition: none; animation: none; }
dialog { width: min(${fluidPx(WEB_TEACH_WIDTH_PX, WEB_TEACH_WIDTH_MAX_PX)}, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 16px;
  background: var(--tokk-bg, ${C.panelBackground}); color: ${FG}; border: 1px solid ${C.backgroundMark}; border-radius: ${RADIUS}; }
dialog::backdrop { background: rgba(0, 0, 0, 0.6); }
h2 { margin: 0 0 8px; font-size: 1.25em; font-weight: 700; }
p { margin: 8px 0; }
ul, ol { margin: 8px 0; padding-left: 20px; }
ol.examples { list-style: none; padding: 0; max-height: 240px; overflow-y: auto; }
li.example { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; border-top: 1px solid ${C.headerBackground}; }
li.example .text { flex: 1 1 160px; }
canvas { display: block; width: ${WEB_TEACH_THUMBNAIL_WIDTH_PX}px; height: ${WEB_TEACH_THUMBNAIL_HEIGHT_PX}px; background: ${C.canvasBackground}; }
progress { width: 100%; accent-color: var(--tokk-accent, ${C.waveform}); }
.footer { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.reason { margin: 8px 0 0; }
.error { margin: 8px 0; padding: 4px 8px; background: ${C.warningBackground}; color: ${C.warningText}; }
button { font: inherit; color: ${FG}; background: var(--tokk-bg, ${C.headerBackground}); border: 1px solid ${FG}; border-radius: ${RADIUS};
  padding: 4px 12px; min-height: 32px; cursor: pointer; }
button[aria-disabled="true"] { border-style: dashed; cursor: not-allowed; }
button:focus-visible, h2:focus-visible { outline: ${WEB_TEACH_FOCUS_OUTLINE_PX}px solid ${C.focusOutline}; outline-offset: 2px; }
[hidden] { display: none; }
`;
