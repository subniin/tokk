// Every caption text, the kinds, and the rolling list (design.md "Captions", requirement 10). Pure. Every mark is paired
// with a word. A knock made while the microphone is paused is never heard, so it has no caption.
import type { Answer } from './bindings';
import { CAPTION_KEEP } from './constants';
import { CANCEL_TEXT } from './teach-texts';

export type CaptionKind = 'heard' | 'action' | 'spirit' | 'effect' | 'system';
export interface Caption { kind: CaptionKind; text: string }
export type EffectName = 'summon' | 'between' | 'ending';
export type Via = { by: 'knock' } | { by: 'button' } | { by: 'key'; key: string };

const EFFECT_TEXTS: Readonly<Record<EffectName, string>> = {
  summon: '[a low hum rises from the table]',
  between: '[a cold breath passes over the candle]',
  ending: '[the sound sinks into the floor]',
};
const KNOCK_WORDS: Readonly<Record<Answer, string>> = { yes: 'one knock', no: 'two knocks' };
const MIC_UNAVAILABLE = 'The microphone is not available. You can still play with the keyboard and the buttons.';

const c = (kind: CaptionKind, text: string): Caption => ({ kind, text });
const viaText = (via: Via, knock: string): string => (via.by === 'knock' ? knock : via.by === 'key' ? `key ${via.key.toUpperCase()}` : 'button');

export function heardKnock(): Caption { return c('heard', 'Heard: knock ✓'); }
export function heardUnknown(): Caption { return c('heard', 'Heard: unknown sound ?'); }
export function summoned(via: Via): Caption {
  return c('action', via.by === 'knock' ? 'The circle is open: knock, knock, pause, knock.' : `The circle is open (${viaText(via, '')}).`);
}
export function newGame(): Caption { return c('action', 'A new séance begins.'); }
export function answered(answer: Answer, via: Via): Caption {
  return c('action', `You answered: ${answer} (${viaText(via, KNOCK_WORDS[answer])})`);
}
export function spiritAsks(text: string): Caption { return c('spirit', `The spirit asks: ${text}`); }
export function spiritEnds(title: string, text: string): Caption { return c('spirit', `The spirit says: ${title}. ${text}`); }
export function effectCaption(name: EffectName): Caption { return c('effect', EFFECT_TEXTS[name]); }
export function taught(): Caption { return c('system', 'The spirits know your knock.'); }
export function teachCancelled(): Caption { return c('system', CANCEL_TEXT); }
export function teachFailed(message: string): Caption { return c('system', `Teaching did not finish: ${message} Press Teach again to try once more.`); }
export function micUnavailable(message: string): Caption { return c('system', `${message} ${MIC_UNAVAILABLE}`); }
export function effectFailed(): Caption { return c('system', 'The sound effect could not play. The game goes on.'); }
export function effectsSwitched(on: boolean): Caption { return c('system', `Sound effects are ${on ? 'on' : 'off'}.`); }
export function effectsUnavailable(): Caption { return c('system', 'Sound effects are not available in this browser, so they are off.'); }

// A new list with the caption at the end and at most `keep` lines.
export function pushCaption(list: readonly Caption[], caption: Caption, keep: number = CAPTION_KEEP): Caption[] {
  const next = [...list, caption];
  return next.length > keep ? next.slice(next.length - keep) : next;
}
