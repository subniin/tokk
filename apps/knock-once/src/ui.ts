// DOM helpers of the page: text, hidden parts, the screens, the captions list, the buttons, the key input and the test
// hooks (data-node on the question, data-effect on the body). Every text is set with textContent.
import type { Caption } from './captions';
import { CAPTION_KEEP } from './constants';
import { allows } from './flow';
import type { FlowState } from './flow';
import type { KeyInput } from './keys';
import { THEME_PROPERTIES } from './teach-texts';

const DIALOG_SELECTOR = '[data-tokk-teach]';
const NON_TEXT_INPUT_TYPES = ['range', 'button', 'checkbox', 'radio', 'submit', 'reset'];
const APP_TITLE = 'Knock Once for Yes';

export const HELP_SUMMON = 'Knock, knock, pause, knock. Summon the spirit.';
export const HELP_QUESTION = 'One knock for yes. Two knocks for no.';
export const HELP_ENDING = 'The spirit has gone. Knock, knock, pause, knock to call it again.';
export const HELP_TEACHING = 'The spirits are learning your knock. Follow the window.';
export const WAITING_TEXT = 'The circle is closed. The spirit waits to be called.';

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (e === null) throw new Error(`The page has no element with the id "${id}".`);
  return e as T;
}

export function setText(id: string, text: string): void {
  const e = byId(id);
  if (e.textContent !== text) e.textContent = text;
}

export function setHidden(id: string, hidden: boolean): void {
  byId(id).hidden = hidden;
}

// A teach dialog is on the page, also on its saved screen.
export function isDialogOpen(): boolean {
  return document.querySelector(DIALOG_SELECTOR) !== null;
}

// Resolves when no teach dialog is on the page (at once if there is none).
export function whenDialogClosed(): Promise<void> {
  return new Promise((resolve) => {
    if (!isDialogOpen()) {
      resolve();
      return;
    }
    const observer = new MutationObserver(() => {
      if (isDialogOpen()) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

export function keyInput(ev: KeyboardEvent): KeyInput {
  const t = ev.target instanceof HTMLElement ? ev.target : null;
  const isText = t !== null && (
    t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
    || (t instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.includes(t.type))
  );
  return { key: ev.key, ctrl: ev.ctrlKey, alt: ev.altKey, meta: ev.metaKey, targetKind: isText ? 'text' : 'other' };
}

// The five --tokk-* properties on :root, so the teach dialog looks like part of the room.
export function applyTheme(): void {
  for (const [name, value] of Object.entries(THEME_PROPERTIES)) document.documentElement.style.setProperty(name, value);
}

// Appends one caption line and drops the oldest beyond CAPTION_KEEP. The list scrolls itself (not the page) to the newest.
export function addCaption(caption: Caption): void {
  const list = byId('caption-list');
  const li = document.createElement('li');
  li.dataset.kind = caption.kind;
  li.textContent = caption.text;
  list.append(li);
  while (list.children.length > CAPTION_KEEP) list.firstElementChild?.remove();
  list.scrollTop = list.scrollHeight;
}

function showScreen(text: string, help: string, node: string | null, title: string): void {
  const q = byId('question');
  if (node === null) q.removeAttribute('data-node');
  else q.dataset.node = node;
  setText('question', text);
  setText('help', help);
  document.title = `${title} - ${APP_TITLE}`;
}
export function showWaiting(): void { showScreen(WAITING_TEXT, HELP_SUMMON, null, 'The circle is closed'); }
export function showTeaching(): void { setText('help', HELP_TEACHING); }
export function showQuestion(id: string, text: string): void { showScreen(text, HELP_QUESTION, id, text); }
export function showEnding(id: string, title: string, text: string): void { showScreen(`${title}. ${text}`, HELP_ENDING, id, title); }

// The test hook of an effect: its name while it plays (the microphone is paused), empty otherwise.
export function setEffectHook(name: string): void {
  if (document.body.dataset.effect !== name) document.body.dataset.effect = name;
}

export interface Controls { state: FlowState; muted: boolean; shortcutsOn: boolean; effectRunning: boolean }

// The buttons follow the flow: each is enabled only where its action is allowed.
export function renderControls(c: Controls): void {
  setHidden('actions', c.state === 'entrance');
  setHidden('entrance', c.state !== 'entrance');
  byId<HTMLButtonElement>('summon').disabled = !allows(c.state, 'summon');
  byId<HTMLButtonElement>('yes').disabled = !allows(c.state, 'answer');
  byId<HTMLButtonElement>('no').disabled = !allows(c.state, 'answer');
  byId<HTMLButtonElement>('teach').disabled = !allows(c.state, 'teach') || c.effectRunning;
  setText('mute', `Sound effects: ${c.muted ? 'off' : 'on'}`);
  setText('shortcuts', `Keyboard shortcuts: ${c.shortcutsOn ? 'on' : 'off'}`);
}
