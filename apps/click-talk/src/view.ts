// The screen of Click Talk: DOM only, no Tokk. It draws a BoardState (renderBoard), the sound bar, the speaking screen, the
// help screen and the microphone card. The rules are in board.ts; this file decides nothing.
import type { BoardState } from './board';
import { HEARD_SHOW_MS, PREVIEW_PHRASE_COUNT } from './constants';
import { EMPTY_FREQUENT_TEXT, FREQUENT_ID, HELP_ID, LAST_SAID_TITLE, BACK_TITLE } from './phrases';
import type { Category } from './phrases';
import type { Mode } from './patterns';
import type { KeyInput } from './keys';
import { MODE_TEXT, WELCOME_TEXT } from './teach-texts';

export type ScreenName = 'welcome' | 'mode' | 'board' | 'settings';
const SCREENS: readonly ScreenName[] = ['welcome', 'mode', 'board', 'settings'];
const NON_TEXT_INPUT_TYPES = ['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'];
const CATEGORY_CLASS: Record<string, string> = { needs: 'needs', body: 'body', people: 'people', talk: 'talk', [FREQUENT_ID]: 'freq', [HELP_ID]: 'help' };
const SIX_PHRASES = 6;

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (e === null) throw new Error(`The page has no element with the id "${id}".`);
  return e as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className !== '') e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export const categoryClass = (id: string): string => CATEGORY_CLASS[id] ?? 'freq';

// The fixed words of the welcome and mode screens come from teach-texts.ts, so the copy is in one place.
export function initStatic(): void {
  byId('welcome-title').textContent = WELCOME_TEXT.title;
  byId('welcome-lead').textContent = WELCOME_TEXT.lead;
  byId('welcome-setup').textContent = WELCOME_TEXT.setup;
  byId('welcome-privacy').textContent = WELCOME_TEXT.privacy;
  byId('welcome-start').textContent = WELCOME_TEXT.button;
  byId('mode-question').textContent = MODE_TEXT.question;
  byId('mode-two-title').textContent = MODE_TEXT.two.title.replace(' (recommended)', '');
  byId('mode-two-body').textContent = MODE_TEXT.two.body;
  byId('mode-one-title').textContent = MODE_TEXT.one.title;
  byId('mode-one-body').textContent = MODE_TEXT.one.body;
}

// ---- Screens ----
export function showScreen(name: ScreenName): void {
  byId('app').dataset.screen = name;
  for (const s of SCREENS) byId(s).hidden = s !== name;
  byId('top').hidden = name === 'welcome' || name === 'mode';
  byId('sounds').hidden = name !== 'board';
  byId('settings-open').hidden = name !== 'board';
  const focus: Record<ScreenName, string | null> = { welcome: 'welcome-start', mode: 'mode-two', board: null, settings: 'settings-title' };
  const target = focus[name];
  if (target === null) (document.activeElement as HTMLElement | null)?.blur();
  else document.getElementById(target)?.focus();
}

export type ListeningState = 'on' | 'paused' | 'off';
const LISTENING_TEXT: Record<ListeningState, string> = { on: 'Listening', paused: 'Paused while speaking', off: 'Not listening' };
export function setListening(state: ListeningState): void {
  byId('live').dataset.state = state;
  byId('live-text').textContent = LISTENING_TEXT[state];
  byId('app').dataset.listening = state;
}

// ---- The board ----
function previewOf(c: Category, lastSaid: string | null): string {
  if (c.id === HELP_ID) return 'Sounds an alarm';
  if (c.id === FREQUENT_ID) return lastSaid === null ? EMPTY_FREQUENT_TEXT : `${LAST_SAID_TITLE}: ${lastSaid}`;
  return c.phrases.slice(0, PREVIEW_PHRASE_COUNT).map((p) => p.replace(/[.?!]+$/, '')).join(', ');
}

function cueText(mode: Mode, keysMode: boolean): string {
  if (keysMode) return 'Enter to choose';
  return mode === 'two' ? 'pop to choose' : 'click to choose';
}

export interface BoardView { mode: Mode; keysMode: boolean; lastSaid: string | null }

export function renderBoard(s: BoardState, cats: readonly Category[], v: BoardView): void {
  const board = byId('board');
  const cat = cats[s.category];
  board.dataset.level = s.level;
  board.dataset.category = cat.id;
  board.dataset.index = String(s.index);
  const onPhrases = s.level === 'phrases' || s.level === 'speaking' || (s.level === 'help' && s.from === 'phrases');
  const cue = cueText(v.mode, v.keysMode);
  const framed = s.level === 'categories' || s.level === 'phrases';

  const crumb = byId('crumb');
  crumb.hidden = !onPhrases;
  crumb.textContent = cat.title;
  crumb.className = `cat ${categoryClass(cat.id)}`;

  const catsEl = byId('g-cats');
  const phrEl = byId('g-phr');
  catsEl.hidden = onPhrases;
  phrEl.hidden = !onPhrases;
  let current: HTMLElement | null = null;

  if (!onPhrases) {
    catsEl.replaceChildren(...cats.map((c, i) => {
      const on = framed && i === s.category;
      const tile = el('div', `tile ${categoryClass(c.id)}${on ? ' on' : ''}`);
      tile.dataset.id = c.id;
      tile.append(el('strong', '', c.title), el('small', '', previewOf(c, v.lastSaid)));
      if (on) { tile.append(el('span', 'cue', cue)); tile.setAttribute('aria-current', 'true'); current = tile; }
      return tile;
    }));
  } else {
    const back = el('div', `tile back${framed && s.index === 0 ? ' on' : ''}`);
    back.dataset.id = 'back';
    back.append(el('strong', '', BACK_TITLE));
    if (framed && s.index === 0) { back.append(el('span', 'cue', cue)); back.setAttribute('aria-current', 'true'); current = back; }
    const grid = el('div', `grid phr${cat.phrases.length <= SIX_PHRASES ? ' six' : ''}`);
    if (cat.phrases.length === 0) grid.append(el('p', 'empty', EMPTY_FREQUENT_TEXT));
    cat.phrases.forEach((p, i) => {
      const on = framed && s.index === i + 1;
      const tile = el('div', `tile ${categoryClass(cat.id)}${on ? ' on' : ''}`);
      tile.dataset.phrase = p;
      tile.append(el('strong', '', p));
      if (on) { tile.append(el('span', 'cue', cue)); tile.setAttribute('aria-current', 'true'); current = tile; }
      grid.append(tile);
    });
    phrEl.replaceChildren(back, grid);
  }
  // The frame jumps to its cell at once, also when the board scrolls (a narrow window).
  (current as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
}

// ---- The sound bar ----
interface Legend { sound: string; word: string; danger?: boolean; heard?: string }
const LEGEND: Record<Mode, Legend[]> = {
  two: [{ sound: 'click', word: 'next', heard: 'click' }, { sound: 'pop', word: 'choose', heard: 'pop' }, { sound: 'pop pop pop', word: 'help', danger: true }],
  one: [{ sound: 'click', word: 'choose', heard: 'click' }, { sound: 'click click click', word: 'help', danger: true }],
};
const KEYS_HINT: Record<Mode, string> = { two: 'Space next / Enter choose', one: 'Space or Enter choose' };
export const KEYBOARD_MODE_TEXT = 'Keyboard mode';
let heardTimer: ReturnType<typeof setTimeout> | undefined;

export function renderSounds(mode: Mode, keysMode: boolean): void {
  const bar = byId('sounds');
  bar.dataset.mode = mode;
  const items: HTMLElement[] = [];
  if (keysMode) items.push(el('span', 'snd mode', KEYBOARD_MODE_TEXT));
  for (const l of LEGEND[mode]) {
    const item = el('span', `snd${l.danger === true ? ' danger' : ''}`);
    if (l.heard !== undefined) item.dataset.sound = l.heard;
    item.append(el('b', '', l.sound), document.createTextNode(l.word));
    items.push(item);
  }
  if (keysMode) items.push(el('span', 'hint', KEYS_HINT[mode]));
  bar.replaceChildren(...items);
}

// Lights the item of the sound that was just heard for HEARD_SHOW_MS. The count is for the browser tests.
export function showHeard(sound: string): void {
  const bar = byId('sounds');
  bar.dataset.heard = String(Number(bar.dataset.heard ?? '0') + 1);
  bar.dataset.last = sound;
  clearTimeout(heardTimer);
  for (const item of Array.from(bar.querySelectorAll<HTMLElement>('.snd'))) {
    item.classList.toggle('heard', item.dataset.sound === sound);
    item.querySelector('.now')?.remove();
    if (item.dataset.sound === sound) item.append(el('span', 'now', 'heard'));
  }
  heardTimer = setTimeout(() => {
    for (const item of Array.from(bar.querySelectorAll<HTMLElement>('.snd'))) {
      item.classList.remove('heard');
      item.querySelector('.now')?.remove();
    }
  }, HEARD_SHOW_MS);
}

// ---- Speaking, help and the microphone card ----
export function showSpeaking(phrase: string, categoryId: string): void {
  const spoken = byId('spoken');
  byId('say').className = `say ${categoryClass(categoryId)}`;
  byId('say-text').textContent = phrase;
  byId('say-note').hidden = true;
  // Restart the bar: the animation of a shown element runs from its start.
  const bar = byId('say-bar');
  bar.style.animation = 'none';
  void bar.offsetWidth;
  bar.style.animation = '';
  spoken.hidden = false;
}
export function setSpeakNote(text: string | null): void {
  const note = byId('say-note');
  note.hidden = text === null;
  note.textContent = text ?? '';
}
export function hideSpeaking(): void {
  byId('spoken').hidden = true;
}
export function showHelp(on: boolean): void {
  byId('help').hidden = !on;
}

// The card is a dialog before the board is used (`mid` false). In the middle of use it is a banner at the bottom and does not
// take the focus, so the keys keep working.
export function showMic(kind: 'denied' | 'lost' | null, mid: boolean): void {
  const card = byId('mic');
  card.hidden = kind === null;
  if (kind === null) return;
  card.classList.toggle('mid', mid);
  card.dataset.kind = kind;
  byId('mic-title').textContent = kind === 'denied' ? 'Click Talk cannot hear the microphone.' : 'The microphone went quiet.';
  byId('mic-body').textContent = kind === 'denied'
    ? 'Allow microphone access in the address bar, or use keys: Space moves, Enter chooses. Many switch devices send these keys.'
    : 'It may have been unplugged or taken by another app.';
  byId('mic-retry').textContent = kind === 'denied' ? 'Try again' : 'Reconnect';
  if (!mid) byId('mic-retry').focus();
}

// ---- The teach dialog of the library, as a DOM fact ----
const DIALOG_SELECTOR = '[data-tokk-teach]';
export function isDialogOpen(): boolean {
  return document.querySelector(DIALOG_SELECTOR) !== null;
}
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

// A key that a control of the page keeps: a button or a link, anything in the microphone card, anything on the settings screen.
export function keyBelongsToControl(ev: KeyboardEvent): boolean {
  const t = ev.target instanceof HTMLElement ? ev.target : null;
  if (t === null) return false;
  return t.closest('button, a, summary, [role="button"]') !== null || t.closest('#mic, #settings') !== null;
}
