// The screen of Shoo!: DOM only, no Tokk. It draws a GameState (render) and, apart from the state, the hit effect of
// shoo.md 3.1 (showHit). The rules already removed a shooed monster when showHit runs, so the view keeps a separate exit
// sprite for about 1 s. With prefers-reduced-motion monsters still move, but there are no arcs and no exit animation: the
// monster is gone at once and the word and "+1" show for REDUCED_WORD_MS.
import {
  ARC_FLIGHT_MS, ARC_STAGGER_MS, ARC_START_MS, CAPTION_MS, EXIT_AT_MS, EXIT_MS, FLASH_AT_MS, HEARD_GROW_MS, HIT_EFFECT_MS,
  MISS_EFFECT_MS, REDUCED_WORD_MS, START_LIVES, WORD_MS,
} from './constants';
import type { GameState, Hit, Monster } from './game';
import { BOSS_PATTERN, MONSTERS } from './monsters';
import type { Kind, SoundId } from './monsters';
import type { KeyInput } from './keys';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PERCENT = 100;
const PORCH_LEFT_PCT = 50;
const PORCH_TOP_PCT = 104;
const LANES = [-0.55, 0.4, -0.2, 0.65, 0.05, -0.7, 0.25, -0.4, 0.55, -0.05];   // the side of the path, from the id
const PATH_HALF_WIDTH_TOP_PCT = 3;
const PATH_HALF_WIDTH_GROW_PCT = 28;
const NON_TEXT_INPUT_TYPES = ['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'];
const PLURAL: Record<SoundId, string> = { click: 'bats', clap: 'ghosts', knock: 'skeletons', pop: 'pumpkins' };
const SOUND_IDS: readonly string[] = ['click', 'clap', 'knock', 'pop'];
const SYMBOL_VIEWBOX: Record<Kind, string> = { bat: '0 0 100 100', ghost: '0 0 100 120', skeleton: '0 0 100 120', pumpkin: '0 0 100 100', warden: '0 0 120 150' };
const SEED_VECTORS_PX: readonly [number, number][] = [[-46, -30], [44, -34], [-30, 40], [36, 44], [0, -54], [56, 6]];

export type ScreenName = 'title' | 'room' | 'intro' | 'cleared' | 'lost' | 'dawn' | 'paused' | 'settings-card';
const SCREENS: readonly ScreenName[] = ['title', 'room', 'intro', 'cleared', 'lost', 'dawn', 'paused', 'settings-card'];

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (e === null) throw new Error(`The page has no element with the id "${id}".`);
  return e as T;
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function symbol(id: string, viewBox?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  if (viewBox !== undefined) svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

// ---- Position on the path ----
function placeOf(id: number, kind: Kind, y: number): { left: number; top: number } {
  const lane = kind === 'warden' ? 0 : LANES[id % LANES.length];
  return { left: PERCENT / 2 + lane * (PATH_HALF_WIDTH_TOP_PCT + PATH_HALF_WIDTH_GROW_PCT * y), top: y * PERCENT };
}
function put(e: HTMLElement, p: { left: number; top: number }): void {
  e.style.left = `${p.left}%`;
  e.style.top = `${p.top}%`;
}

// ---- Screens ----
export function showScreen(name: ScreenName | null): void {
  for (const s of SCREENS) byId(s).hidden = s !== name;
  if (name !== null && name !== 'intro') byId(name).querySelector<HTMLElement>('button')?.focus();
}

export function showHud(on: boolean): void {
  byId('hud').hidden = !on;
  byId('lines').hidden = !on;
}

export function showBanner(text: string | null): void {
  const b = byId('banner');
  b.hidden = text === null;
  b.textContent = text ?? '';
}

export function setRoom(title: string, body: string, button: string): void {
  byId('room-title').textContent = title;
  byId('room-body').textContent = body;
  byId('room-start').textContent = button;
}

// The intro card: the new monster large, its line, and below it the teach line or "Get ready.".
export function setIntro(kind: Kind, line: string, sub: string): void {
  const art = byId('intro-art');
  art.setAttribute('viewBox', SYMBOL_VIEWBOX[kind]);
  art.querySelector('use')?.setAttribute('href', `#${kind}`);
  const bang = line.indexOf('!');
  byId('intro-title').textContent = bang < 0 ? line : line.slice(0, bang + 1);
  byId('intro-line').textContent = bang < 0 ? '' : line.slice(bang + 1).trim();
  byId('intro-sub').textContent = sub;
}
export function setIntroSub(sub: string): void {
  byId('intro-sub').textContent = sub;
}

const plural = (n: number): string => `${n} ${n === 1 ? 'monster' : 'monsters'}`;
export function setCleared(wave: number, shooed: number): void {
  byId('cleared-title').textContent = `Wave ${wave} cleared.`;
  byId('cleared-body').textContent = `${plural(shooed)} shooed.`;
}
export function setLost(shooed: number): void {
  byId('lost-body').textContent = `You shooed ${plural(shooed)}.`;
}
export function setDawn(shooed: number): void {
  byId('dawn-body').textContent = `You shooed ${plural(shooed)}. The house is safe.`;
}

// The microphone card. `mid` is true in the middle of a game: the card does not dim the field, keys keep working.
export function showMic(kind: 'denied' | 'lost' | null, mid: boolean): void {
  const card = byId('mic');
  card.hidden = kind === null;
  if (kind === null) return;
  card.classList.toggle('mid', mid);
  byId('mic-title').textContent = kind === 'denied' ? 'The house cannot hear you.' : 'The microphone went quiet.';
  byId('mic-body').textContent = kind === 'denied'
    ? 'Microphone access is blocked. Allow it in the address bar, or play with keys: 1 click, 2 clap, 3 knock, 4 pop.'
    : 'It may have been unplugged or taken by another app.';
  byId('mic-retry').textContent = kind === 'denied' ? 'Try again' : 'Reconnect';
  card.dataset.kind = kind;
  byId('mic-retry').focus();
}

export function setSfxLabel(on: boolean): void {
  byId('sfx').textContent = `Sound effects: ${on ? 'on' : 'off'}`;
}
export function setTeachAvailable(on: boolean): void {
  byId('teach-group').hidden = !on;
}
export function setControls(o: { pause: boolean; settings: boolean; pauseLabel: string }): void {
  const p = byId<HTMLButtonElement>('pause');
  p.disabled = !o.pause;
  p.textContent = o.pauseLabel;
  byId<HTMLButtonElement>('settings').disabled = !o.settings;
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

// ---- Drawing the state ----
const monsterEls = new Map<number, HTMLElement>();
let shownLives = -1;
let shownMax = -1;
let heardLabel: HTMLElement | null = null;
let heardCaption: HTMLElement | null = null;
let captionTimer: ReturnType<typeof setTimeout> | undefined;

function makeMonster(m: Monster): HTMLElement {
  const weak = MONSTERS[m.kind].weak;
  const root = el('div', `mon walk${m.kind === 'warden' ? ' big' : ''}`);
  root.dataset.id = String(m.id);
  root.dataset.kind = m.kind;
  const tag = el('span', `tag t-${weak === 'rhythm' ? 'knock' : weak}`);
  if (weak === 'rhythm') {
    const dots = el('span', 'rhythm');
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<b><i></i><i></i></b><b><i></i></b>';
    tag.append(dots, ' knock knock _ knock');
  } else {
    tag.textContent = weak;
  }
  root.append(tag, symbol(m.kind));
  if (m.kind === 'warden') root.append(el('span', 'lantern'));
  if (MONSTERS[m.kind].hp > 1) {
    const hp = el('span', 'hp');
    hp.setAttribute('role', 'img');
    for (let i = 0; i < MONSTERS[m.kind].hp; i++) hp.append(document.createElement('i'));
    root.append(hp);
  }
  return root;
}

function updateHp(root: HTMLElement, m: Monster): void {
  const hp = root.querySelector('.hp');
  if (hp === null) return;
  hp.setAttribute('aria-label', `${m.hp} of ${MONSTERS[m.kind].hp} hit points left`);
  hp.querySelectorAll('i').forEach((cell, i) => cell.classList.toggle('off', i >= m.hp));
}

function renderCandles(lives: number, max: number): void {
  if (lives === shownLives && max === shownMax) return;
  shownLives = lives;
  shownMax = max;
  const box = byId('candles');
  box.dataset.lives = String(lives);
  box.setAttribute('aria-label', `${lives} ${lives === 1 ? 'candle' : 'candles'} left`);
  box.replaceChildren(...Array.from({ length: max }, (_, i) => symbol(i < lives ? 'candle' : 'candle-out')));
}

function heardParts(): { label: HTMLElement; caption: HTMLElement } {
  if (heardLabel === null || heardCaption === null) {
    heardLabel = el('span', 'heard-label');
    heardCaption = el('span', 'caption');
    byId('heard').replaceChildren(heardLabel, heardCaption);
  }
  return { label: heardLabel, caption: heardCaption };
}

let shownHeard: string | null | undefined;
function renderHeard(lastHeard: string | null): void {
  if (shownHeard === lastHeard) return;
  shownHeard = lastHeard;
  const { label } = heardParts();
  if (lastHeard === null) {
    label.replaceChildren();
    return;
  }
  const word = el('b', SOUND_IDS.includes(lastHeard) ? `t-${lastHeard}` : '', lastHeard);
  label.replaceChildren('Heard: ', word);
}

export interface RenderOptions { maxLives: number; listening: string; keysMode: boolean }
export function render(s: GameState, o: RenderOptions): void {
  renderCandles(s.lives, Math.max(o.maxLives, START_LIVES));
  byId('wave').textContent = `Wave ${s.wave}`;
  const alive = new Set<number>();
  for (const m of s.monsters) {
    alive.add(m.id);
    let root = monsterEls.get(m.id);
    if (root === undefined) {
      root = makeMonster(m);
      monsterEls.set(m.id, root);
      byId('field').append(root);
    }
    put(root, placeOf(m.id, m.kind, m.y));
    updateHp(root, m);
  }
  for (const [id, root] of monsterEls) {
    if (!alive.has(id)) {
      root.remove();
      monsterEls.delete(id);
    }
  }
  renderHeard(s.lastHeard);
  byId('listening-text').textContent = o.listening;
  byId('keys-line').hidden = !o.keysMode;
}

// Clears the field and the heard line for a new game.
export function resetField(): void {
  for (const root of monsterEls.values()) root.remove();
  monsterEls.clear();
  byId('field').replaceChildren();
  shownHeard = undefined;
  shownLives = -1;
  heardParts().label.replaceChildren();
  heardParts().caption.textContent = '';
}

// A line in the "Heard" strip, for CAPTION_MS: "[a candle goes out]".
export function caption(text: string): void {
  const { caption: c } = heardParts();
  c.textContent = text;
  if (captionTimer !== undefined) clearTimeout(captionTimer);
  captionTimer = setTimeout(() => { c.textContent = ''; }, CAPTION_MS);
}

// ---- The hit effect ----
const field = (): HTMLElement => byId('field');
let activeEffects = 0;

// Adds an element to the field for lifeMs, and keeps the count in data-effects.
function addEffect(e: HTMLElement, lifeMs: number): HTMLElement {
  field().append(e);
  activeEffects += 1;
  field().dataset.effects = String(activeEffects);
  setTimeout(() => {
    e.remove();
    activeEffects -= 1;
    field().dataset.effects = String(activeEffects);
  }, lifeMs);
  return e;
}

function fly(e: HTMLElement, keyframes: Keyframe[], delayMs: number, durationMs: number): Animation {
  return e.animate(keyframes, { delay: delayMs, duration: durationMs, fill: 'both', easing: 'ease-out' });
}

const colourOf = (label: string | undefined): string => (label === BOSS_PATTERN ? 't-knock' : label !== undefined && SOUND_IDS.includes(label) ? `t-${label}` : '');
const wordOf = (label: string): string => (label === BOSS_PATTERN ? 'KNOCK!' : `${label.toUpperCase()}!`);

function arcs(colour: string, from: { left: number; top: number }, to: { left: number; top: number } | null): void {
  for (let i = 0; i < 3; i++) {
    const a = addEffect(el('span', `arc ${colour}`), HIT_EFFECT_MS);
    a.setAttribute('aria-hidden', 'true');
    const start = { left: `${from.left}%`, top: `${from.top - i * 2}%` };
    const frames: Keyframe[] = to === null
      ? [{ ...start, opacity: 0 }, { ...start, opacity: 0.8, offset: 0.2 }, { left: start.left, top: `${from.top - 14}%`, opacity: 0 }]
      : [{ ...start, opacity: 0 }, { ...start, opacity: 1, offset: 0.12 }, { left: `${to.left}%`, top: `${to.top}%`, opacity: 1, offset: 0.9 }, { left: `${to.left}%`, top: `${to.top}%`, opacity: 0 }];
    fly(a, frames, ARC_START_MS + i * ARC_STAGGER_MS, to === null ? MISS_EFFECT_MS / 2 : ARC_FLIGHT_MS);
  }
}

function exitSprite(m: Monster): { root: HTMLElement; body: SVGElement[]; place: { left: number; top: number } } {
  const place = placeOf(m.id, m.kind, m.y);
  const root = el('div', `exit${m.kind === 'warden' ? ' big' : ''}`);
  put(root, place);
  root.style.transform = 'translate(-50%, -50%)';
  if (m.kind === 'skeleton') {
    const bones = el('span', 'bones');
    const skull = symbol('skeleton', '0 0 100 120');
    skull.style.clipPath = 'inset(0 0 50% 0)';
    const ribs = symbol('skeleton', '0 0 100 120');
    ribs.style.clipPath = 'inset(50% 0 0 0)';
    bones.append(skull, ribs);
    root.append(bones);
    return { root, body: [skull, ribs], place };
  }
  const svg = symbol(m.kind);
  root.append(svg);
  return { root, body: [svg], place };
}

function exitFrames(kind: Kind): Keyframe[][] {
  switch (kind) {
    case 'bat':
      return [[{ transform: 'none', opacity: 1 }, { transform: 'rotate(-14deg) scale(1.15, -1.15)', opacity: 1, offset: 0.25 }, { transform: 'translate(70px, -150px) rotate(-40deg) scale(.4, -.4)', opacity: 0 }]];
    case 'ghost':
      return [[{ transform: 'none', opacity: 1, filter: 'none' }, { transform: 'translateY(-14px) scale(1.7)', opacity: 0, filter: 'blur(9px)' }]];
    case 'skeleton':
      return [
        [{ transform: 'none', opacity: 1 }, { transform: 'translateX(-5px)', offset: 0.1 }, { transform: 'translateX(5px)', offset: 0.2 }, { transform: 'none', offset: 0.3 }, { transform: 'translate(-46px, -40px) rotate(-70deg)', opacity: 0 }],
        [{ transform: 'none', opacity: 1 }, { transform: 'translateX(-5px)', offset: 0.1 }, { transform: 'translateX(5px)', offset: 0.2 }, { transform: 'none', offset: 0.3 }, { transform: 'translate(24px, 70px) rotate(28deg)', opacity: 0 }],
      ];
    case 'pumpkin':
      return [[{ transform: 'none', opacity: 1 }, { transform: 'scale(1.3)', opacity: 1, offset: 0.4 }, { transform: 'scale(.2)', opacity: 0 }]];
    case 'warden':
      return [[{ transform: 'none', opacity: 1, filter: 'none' }, { opacity: 0.6, filter: 'brightness(1.8)', offset: 0.3 }, { transform: 'translateY(40px) scaleY(.15)', opacity: 0, filter: 'blur(8px)' }]];
  }
}

// What one input did to a monster. `before` is the monster as it was before the rules removed or hurt it.
export function showHit(hit: Hit, before: Monster | undefined): void {
  const colour = colourOf(hit.sound);
  const { label } = heardParts();
  if (!reducedMotion()) {
    fly(label, [{ transform: 'scale(1)', textShadow: 'none' }, { transform: 'scale(1.3)', textShadow: '0 0 14px currentColor', offset: 0.5 }, { transform: 'scale(1)', textShadow: 'none' }], 0, HEARD_GROW_MS);
  }
  if (hit.type === 'miss') {
    const at = { left: PORCH_LEFT_PCT, top: PORCH_TOP_PCT };
    if (hit.reason === 'unknown') {
      const puff = addEffect(el('div', 'puff'), CAPTION_MS);
      puff.append(el('b', '', '?'), 'Not a monster sound');
      put(puff, { left: PORCH_LEFT_PCT, top: 80 });
      if (!reducedMotion()) fly(puff, [{ opacity: 0, transform: 'translate(-50%, -30%) scale(.6)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }], 0, HEARD_GROW_MS);
      return;
    }
    const sound = hit.sound ?? '';
    const noun = sound === BOSS_PATTERN ? 'wardens' : PLURAL[sound as SoundId] ?? 'monsters';
    const note = addEffect(el('div', 'note', `No ${noun} here`), CAPTION_MS);
    put(note, { left: PORCH_LEFT_PCT, top: 86 });
    if (!reducedMotion()) arcs(colour, at, null);
    return;
  }
  if (before === undefined) return;
  const place = placeOf(before.id, before.kind, before.y);
  const word = { left: place.left, top: Math.max(4, place.top - 12) };
  if (reducedMotion()) {
    put(addEffect(el('div', `burst ${colour}`, wordOf(hit.sound)), REDUCED_WORD_MS), word);
    if (hit.removed) put(addEffect(el('div', 'plus', '+1'), REDUCED_WORD_MS), { left: place.left, top: place.top + 4 });
    return;
  }
  arcs(colour, { left: PORCH_LEFT_PCT, top: PORCH_TOP_PCT }, place);
  const burst = addEffect(el('div', `burst ${colour}`, wordOf(hit.sound)), HIT_EFFECT_MS);
  put(burst, word);
  fly(burst, [{ opacity: 0, transform: 'translate(-50%, -50%) scale(.4)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1.1)', offset: 0.25 }, { opacity: 1, transform: 'translate(-50%, -80%) scale(1)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%, -80%) scale(1)' }], FLASH_AT_MS, WORD_MS);
  if (!hit.removed) {
    hurt(hit.id, before.kind);
    return;
  }
  const sprite = exitSprite(before);
  addEffect(sprite.root, HIT_EFFECT_MS);
  fly(sprite.root, [{ filter: 'none' }, { filter: 'brightness(2.2)', offset: 0.5 }, { filter: 'none' }], FLASH_AT_MS, EXIT_AT_MS - FLASH_AT_MS);
  const frames = exitFrames(before.kind);
  sprite.body.forEach((svg, i) => fly(svg as unknown as HTMLElement, frames[i] ?? frames[0], EXIT_AT_MS, EXIT_MS));
  if (before.kind === 'pumpkin') {
    SEED_VECTORS_PX.forEach(([dx, dy]) => {
      const seed = addEffect(el('span', 'seed'), HIT_EFFECT_MS);
      put(seed, place);
      fly(seed, [{ opacity: 0, transform: 'translate(0, 0)' }, { opacity: 1, offset: 0.1 }, { opacity: 0, transform: `translate(${dx}px, ${dy}px)` }], EXIT_AT_MS, EXIT_MS);
    });
  }
  const plus = addEffect(el('div', 'plus', '+1'), HIT_EFFECT_MS);
  put(plus, { left: place.left, top: place.top + 4 });
  fly(plus, [{ opacity: 0, transform: 'translate(-50%, 0)' }, { opacity: 1, offset: 0.2 }, { opacity: 0, transform: 'translate(-50%, -34px)' }], EXIT_AT_MS, EXIT_MS);
}

// A monster that took a hit and stays: the skeleton rattles, the warden's lantern flickers.
function hurt(id: number, kind: Kind): void {
  const root = monsterEls.get(id);
  if (root === undefined) return;
  const svg = root.querySelector('svg') as unknown as HTMLElement | null;
  if (svg !== null) {
    fly(svg, [{ transform: 'none', filter: 'none' }, { transform: 'translateX(-5px)', filter: 'brightness(1.8)', offset: 0.25 }, { transform: 'translateX(5px)', offset: 0.5 }, { transform: 'none', filter: 'none' }], FLASH_AT_MS, WORD_MS);
  }
  const lantern = root.querySelector<HTMLElement>('.lantern');
  if (kind === 'warden' && lantern !== null) {
    fly(lantern, [{ opacity: 0.35 }, { opacity: 1, offset: 0.2 }, { opacity: 0.1, offset: 0.4 }, { opacity: 1, offset: 0.6 }, { opacity: 0.35 }], FLASH_AT_MS, WORD_MS + EXIT_MS);
  }
}
