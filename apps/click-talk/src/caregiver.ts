// The caregiver screen (click-talk.md section 5): mode, scan speed, teaching again, voice, speaking speed, online voices,
// phrase lists, the alarm test and the note that Click Talk is not a medical device. DOM only, no Tokk. It never changes the
// settings itself: every change goes through api.change(), which saves it.
import {
  MS_PER_SECOND, RATE_FACTOR_MAX, RATE_FACTOR_MIN, RATE_STEP_FACTOR, SCAN_MS_MAX, SCAN_MS_MIN, SCAN_STEP_MS,
} from './constants';
import { FREQUENT_ID, HELP_ID } from './phrases';
import { editPhrases } from './settings';
import type { Settings } from './settings';
import { NO_VOICE_TEXT, voiceLabel } from './speech';
import type { VoiceLike } from './speech';
import { byId, el } from './view';

export const EMPTY_PHRASE_MESSAGE = 'A phrase cannot be empty.';
const ONLINE_EXPLANATION = 'Online voices send the text, not the audio, to the browser\'s speech service.';
const ABOUT_TEXT = 'Click Talk is not a medical device. Do not rely on it in an emergency.';

export interface CaregiverApi {
  settings(): Settings;
  change(next: Settings): void;                           // saves, and applies the mode, the scan speed and the voice
  voices(): (VoiceLike & { voiceURI: string })[];         // every voice of the browser; the screen lists the allowed ones
  canTeach(): boolean;                                    // false without a microphone (keys mode)
  teachAgain(): void;
  testAlarm(): void;
  back(): void;
}

// What the screen remembers between two drawings. A list that is not valid stays here as a draft (the board keeps the last
// valid list in the settings) until the caregiver leaves.
interface View {
  tab: string;
  drafts: Record<string, string[]>;
  messages: Record<string, string>;
  editing: number | null;
  adding: boolean;
  focus: string | null;
}
let view: View = { tab: '', drafts: {}, messages: {}, editing: null, adding: false, focus: null };

export function resetCaregiver(): void {
  view = { tab: '', drafts: {}, messages: {}, editing: null, adding: false, focus: null };
}

function button(label: string, className: string, onClick: () => void, focusKey?: string): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  if (focusKey !== undefined) b.dataset.focus = focusKey;
  b.addEventListener('click', onClick);
  return b;
}

function panel(title: string, wide: boolean): HTMLElement {
  const p = el('div', wide ? 'panel wide' : 'panel');
  p.append(el('h2', '', title));
  return p;
}

function field(): HTMLElement {
  return el('div', 'field');
}

function range(id: string, label: string, min: number, max: number, step: number, value: number, text: (v: number) => string, commit: (v: number) => void): HTMLElement {
  const f = field();
  const l = el('label', '', label);
  l.htmlFor = id;
  const input = el('input');
  input.type = 'range';
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const out = el('p', 'help-t', text(value));
  out.id = `${id}-text`;
  input.addEventListener('input', () => { out.textContent = text(Number(input.value)); });
  input.addEventListener('change', () => commit(Number(input.value)));
  f.append(l, input, out);
  return f;
}

export function renderCaregiver(api: CaregiverApi): void {
  const root = byId('settings');
  const s = api.settings();
  const editable = s.phrases.filter((c) => c.id !== FREQUENT_ID && c.id !== HELP_ID);
  if (view.tab === '' || !editable.some((c) => c.id === view.tab)) view.tab = editable[0].id;
  const change = (patch: Partial<Settings>): void => api.change({ ...api.settings(), ...patch });
  const redraw = (focus: string | null = null): void => { view.focus = focus; renderCaregiver(api); };

  const head = el('div', 'set-head');
  const title = el('div');
  const h1 = el('h1', '', 'Settings');
  h1.id = 'settings-title';
  h1.tabIndex = -1;
  title.append(h1, el('p', 'sub', 'For the caregiver'));
  head.append(title, button('Back to the board', 'primary', () => api.back()));

  // Sounds
  const sounds = panel('Sounds', false);
  const modeField = field();
  modeField.append(el('label', '', 'Mode'));
  const seg = el('span', 'seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Mode');
  for (const [mode, label] of [['two', 'Two sounds'], ['one', 'One sound']] as const) {
    const b = button(label, s.mode === mode ? 'sel' : '', () => { if (s.mode !== mode) { change({ mode }); redraw(`mode-${mode}`); } }, `mode-${mode}`);
    b.setAttribute('aria-pressed', String(s.mode === mode));
    seg.append(b);
  }
  modeField.append(seg);
  sounds.append(
    modeField,
    range('scan', 'Scan speed', SCAN_MS_MIN, SCAN_MS_MAX, SCAN_STEP_MS, s.scanMs, (v) => `${(v / MS_PER_SECOND).toFixed(1)} s per step. Used in One sound mode.`, (v) => change({ scanMs: v })),
    button('Teach the sounds again', 'secondary', () => api.teachAgain()),
  );
  if (!api.canTeach()) {
    const again = sounds.querySelector<HTMLButtonElement>('button.secondary');
    if (again !== null) again.disabled = true;
    sounds.append(el('p', 'help-t', 'Teaching needs the microphone.'));
  }

  // Voice
  const voicePanel = panel('Voice', false);
  const allowed = api.voices().filter((v) => v.localService || s.onlineVoices);
  const voiceField = field();
  const vl = el('label', '', 'Voice');
  vl.htmlFor = 'voice';
  const select = el('select');
  select.id = 'voice';
  select.append(new Option('Automatic', ''));
  for (const v of allowed) select.append(new Option(voiceLabel(v), v.voiceURI));
  select.value = allowed.some((v) => v.voiceURI === s.voiceURI) ? (s.voiceURI as string) : '';
  select.addEventListener('change', () => { change({ voiceURI: select.value === '' ? null : select.value }); redraw('voice'); });
  voiceField.append(vl, select);
  if (api.voices().length === 0) voiceField.append(el('p', 'help-t', NO_VOICE_TEXT));
  const online = field();
  const ol = el('label', 'toggle');
  const box = el('input');
  box.type = 'checkbox';
  box.id = 'online';
  box.checked = s.onlineVoices;
  box.addEventListener('change', () => { change({ onlineVoices: box.checked }); redraw('online'); });
  ol.append(box, document.createTextNode(`Online voices: ${s.onlineVoices ? 'On' : 'Off'}`));
  online.append(ol, el('p', 'help-t', ONLINE_EXPLANATION));
  voicePanel.append(
    voiceField,
    range('rate', 'Speaking speed', RATE_FACTOR_MIN, RATE_FACTOR_MAX, RATE_STEP_FACTOR, s.rate, (v) => `${v.toFixed(1)} times the normal speed`, (v) => change({ rate: v })),
    online,
  );

  // Phrases
  const phrases = panel('Phrases', true);
  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Category');
  for (const c of editable) {
    const b = button(c.title, c.id === view.tab ? 'sel' : '', () => { view.tab = c.id; view.editing = null; view.adding = false; redraw(`tab-${c.id}`); }, `tab-${c.id}`);
    b.setAttribute('aria-pressed', String(c.id === view.tab));
    tabs.append(b);
  }
  const id = view.tab;
  const saved = editable.find((c) => c.id === id)?.phrases ?? [];
  const list = view.drafts[id] ?? [...saved];
  const commit = (next: string[], focus: string | null): void => {
    if (next.some((p) => p.trim() === '')) { view.messages[id] = EMPTY_PHRASE_MESSAGE; redraw(focus); return; }
    view.drafts[id] = next;
    const r = editPhrases(api.settings(), id, next);
    if (r.error === null) { delete view.messages[id]; api.change(r.settings); } else view.messages[id] = r.error;
    view.editing = null;
    view.adding = false;
    redraw(focus);
  };
  const grid = el('div', 'phrase-grid');
  list.forEach((p, i) => {
    const row = el('div', 'phrase-row');
    row.dataset.phrase = p;
    if (view.editing === i) {
      const input = el('input');
      input.type = 'text';
      input.value = p;
      input.setAttribute('aria-label', `Edit phrase ${i + 1}`);
      input.dataset.focus = 'edit';
      const done = (): void => commit(list.map((x, k) => (k === i ? input.value.trim() : x)), `edit-${i}`);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); done(); }
        if (ev.key === 'Escape') { ev.preventDefault(); view.editing = null; redraw(`edit-${i}`); }
      });
      row.append(input, button('Save', '', done), button('Cancel', '', () => { view.editing = null; redraw(`edit-${i}`); }));
    } else {
      row.append(el('span', '', p), button('Edit', '', () => { view.editing = i; view.adding = false; redraw('edit'); }, `edit-${i}`), button('Remove', '', () => commit(list.filter((_, k) => k !== i), 'add'), `remove-${i}`));
    }
    grid.append(row);
  });
  phrases.append(tabs, grid);
  if (view.adding) {
    const row = el('div', 'phrase-row adding');
    const input = el('input');
    input.type = 'text';
    input.setAttribute('aria-label', 'New phrase');
    input.dataset.focus = 'edit';
    const done = (): void => commit([...list, input.value.trim()], 'add');
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); done(); }
      if (ev.key === 'Escape') { ev.preventDefault(); view.adding = false; redraw('add'); }
    });
    row.append(input, button('Add', '', done), button('Cancel', '', () => { view.adding = false; redraw('add'); }));
    phrases.append(row);
  } else {
    const p = el('p', 'actions');
    p.append(button('Add phrase', 'secondary', () => { view.adding = true; view.editing = null; redraw('edit'); }, 'add'));
    phrases.append(p);
  }
  const message = el('p', 'message', view.messages[id] ?? '');
  message.id = 'phrase-message';
  message.setAttribute('role', 'alert');
  message.hidden = view.messages[id] === undefined;
  phrases.append(message);

  // Alarm and about
  const alarm = panel('Alarm', false);
  alarm.append(button('Test the alarm', 'secondary', () => api.testAlarm()));
  const about = panel('About', false);
  about.append(el('p', 'note', ABOUT_TEXT));

  const grid2 = el('div', 'set-grid');
  grid2.append(sounds, voicePanel, phrases, alarm, about);
  const wrap = el('div', 'set');
  wrap.append(head, grid2);
  root.replaceChildren(wrap);

  const target = view.focus;
  view.focus = null;
  if (target !== null) {
    const found = root.querySelector<HTMLElement>(`[data-focus="${target}"], #${target}`) ?? root.querySelector<HTMLElement>('[data-focus="edit"]');
    found?.focus();
  }
}
