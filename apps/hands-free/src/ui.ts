// Small DOM helpers of the page: text, hidden parts, the key listener input, the progress and the state banner.
import type { KeyInput } from './keys';
import { progressItems, progressLine, stateText } from './text';
import type { ListeningState } from './text';

const DIALOG_SELECTOR = '[data-tokk-teach]';
const NON_TEXT_INPUT_TYPES = ['range', 'button', 'checkbox', 'radio', 'submit', 'reset'];

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

// A text field, a select, a textarea or an editable element keeps its letters. A range input does not take letters.
export function keyInput(ev: KeyboardEvent): KeyInput {
  const t = ev.target instanceof HTMLElement ? ev.target : null;
  const isText = t !== null && (
    t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
    || (t instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.includes(t.type))
  );
  return { key: ev.key, ctrl: ev.ctrlKey, alt: ev.altKey, meta: ev.metaKey, targetKind: isText ? 'text' : 'other' };
}

export function renderState(state: ListeningState): void {
  const { title, line } = stateText(state);
  setText('state-title', title);
  setText('state-line', line);
}

// The teaching progress as text, with a word for each step (done, now, next). `index` null hides it.
export function renderProgress(index: number | null): void {
  setHidden('progress', index === null);
  if (index === null) return;
  setText('progress-line', progressLine(index));
  byId('progress-steps').replaceChildren(...progressItems(index).map((item) => {
    const li = document.createElement('li');
    li.textContent = `${item.name}: ${item.mark}`;
    return li;
  }));
}
