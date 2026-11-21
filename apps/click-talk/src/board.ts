// The rules of the board. Pure: no DOM, no Web Audio, no speech, no Tokk.
import { HELP_ID } from './phrases';
import type { Category } from './phrases';

export type Level = 'categories' | 'phrases' | 'speaking' | 'help';

// category: the frame on the category board, and the open category on a phrase board.
// index: 0 on the category board; on a phrase board 0 is Back and n is phrase n - 1.
// said: the phrase being spoken, only in 'speaking'.
// from: the screen to return to when help ends, only in 'help'.
export type BoardState = {
  level: Level;
  category: number;
  index: number;
  said: string | null;
  from: 'categories' | 'phrases' | null;
};

export type BoardInput =
  | { type: 'next' }
  | { type: 'choose' }
  | { type: 'tick' }
  | { type: 'help' }
  | { type: 'spoken' }
  | { type: 'stopHelp' };

export const INITIAL_BOARD: BoardState = { level: 'categories', category: 0, index: 0, said: null, from: null };

function phraseCells(s: BoardState, cats: readonly Category[]): number {
  return (cats[s.category]?.phrases.length ?? 0) + 1;   // Back, then the phrases
}

function move(s: BoardState, cats: readonly Category[]): BoardState {
  if (s.level === 'categories') return { ...s, category: (s.category + 1) % cats.length };
  if (s.level === 'phrases') return { ...s, index: (s.index + 1) % phraseCells(s, cats) };
  return s;
}

function choose(s: BoardState, cats: readonly Category[]): BoardState {
  if (s.level === 'categories') {
    if (cats[s.category]?.id === HELP_ID) return { ...s, level: 'help', from: 'categories' };
    return { ...s, level: 'phrases', index: 0 };
  }
  if (s.level === 'phrases') {
    if (s.index === 0) return { ...s, level: 'categories', index: 0 };
    const phrase = cats[s.category]?.phrases[s.index - 1];
    return phrase === undefined ? s : { ...s, level: 'speaking', said: phrase };
  }
  return s;
}

export function reduce(s: BoardState, i: BoardInput, cats: readonly Category[]): BoardState {
  switch (i.type) {
    case 'next':
    case 'tick':
      return move(s, cats);
    case 'choose':
      return choose(s, cats);
    case 'help':
      if (s.level === 'help') return s;
      // Help while speaking returns to the category board (the speech is cancelled by the app).
      if (s.level === 'speaking') return { ...s, level: 'help', index: 0, said: null, from: 'categories' };
      return { ...s, level: 'help', from: s.level };
    case 'spoken':
      return s.level === 'speaking' ? { ...s, level: 'categories', index: 0, said: null } : s;
    case 'stopHelp':
      return s.level === 'help' ? { ...s, level: s.from ?? 'categories', from: null } : s;
  }
}
