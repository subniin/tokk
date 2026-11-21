// Task 34 (requirements 3 to 6): the rules of the board. Pure, no DOM.
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../apps/click-talk/src/phrases';
import { INITIAL_BOARD, reduce } from '../apps/click-talk/src/board';
import type { BoardInput, BoardState } from '../apps/click-talk/src/board';

const NEEDS = 0;
const FREQUENT = 4;
const HELP = 5;

function run(inputs: BoardInput[], from: BoardState = INITIAL_BOARD): BoardState {
  return inputs.reduce((s, i) => reduce(s, i, CATEGORIES), from);
}
const next = (n: number): BoardInput[] => Array.from({ length: n }, () => ({ type: 'next' }));
const NEXT: BoardInput = { type: 'next' };
const CHOOSE: BoardInput = { type: 'choose' };
const TICK: BoardInput = { type: 'tick' };

describe('the category board', () => {
  it('starts on the first category', () => {
    expect(INITIAL_BOARD).toMatchObject({ level: 'categories', category: 0, index: 0, said: null });
  });

  it('next six times comes back to the start, and visits every category once', () => {
    const seen: number[] = [];
    let s = INITIAL_BOARD;
    for (let i = 0; i < 6; i++) { seen.push(s.category); s = reduce(s, NEXT, CATEGORIES); }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
    expect(s).toEqual(INITIAL_BOARD);
  });

  it('choose opens the phrase board with the frame on Back', () => {
    const s = run([NEXT, NEXT, CHOOSE]);
    expect(s).toMatchObject({ level: 'phrases', category: 2, index: 0, said: null });
  });

  it('tick moves like next', () => {
    expect(run([TICK])).toEqual(run([NEXT]));
    expect(run([TICK, TICK, TICK, TICK, TICK, TICK])).toEqual(INITIAL_BOARD);
  });
});

describe('a phrase board', () => {
  it('scans Back first, then every phrase, then wraps', () => {
    const phrases = CATEGORIES[NEEDS].phrases.length;
    let s = run([CHOOSE]);
    const seen: number[] = [];
    for (let i = 0; i < phrases + 1; i++) { seen.push(s.index); s = reduce(s, NEXT, CATEGORIES); }
    expect(seen).toEqual(Array.from({ length: phrases + 1 }, (_, i) => i));
    expect(s.index).toBe(0);
    expect(s.level).toBe('phrases');
  });

  it('choosing Back returns to the category board on the same category', () => {
    const s = run([NEXT, NEXT, NEXT, CHOOSE, CHOOSE]);
    expect(s).toMatchObject({ level: 'categories', category: 3, index: 0, said: null });
  });

  it('choosing a phrase speaks it', () => {
    const s = run([NEXT, CHOOSE, NEXT, NEXT, CHOOSE]);   // Body, Back, phrase 1, phrase 2
    expect(s).toMatchObject({ level: 'speaking', category: 1, said: CATEGORIES[1].phrases[1] });
  });

  it('the last phrase can be chosen after a full pass', () => {
    const n = CATEGORIES[0].phrases.length;
    const s = run([CHOOSE, ...next(n), CHOOSE]);
    expect(s).toMatchObject({ level: 'speaking', said: CATEGORIES[0].phrases[n - 1] });
  });

  it('a 6-phrase category scans Back and six phrases', () => {
    const s = run([NEXT, NEXT, CHOOSE, ...next(7)]);   // People has 6
    expect(s).toMatchObject({ level: 'phrases', category: 2, index: 0 });
  });
});

describe('speaking (Review Focus 3)', () => {
  const speaking = run([CHOOSE, NEXT, CHOOSE]);

  it('is entered with the phrase', () => {
    expect(speaking.level).toBe('speaking');
    expect(speaking.said).toBe(CATEGORIES[0].phrases[0]);
  });

  it('ignores choose, next and tick', () => {
    for (const i of [CHOOSE, NEXT, TICK]) expect(reduce(speaking, i, CATEGORIES), i.type).toEqual(speaking);
    expect(run([NEXT, CHOOSE, TICK, NEXT, CHOOSE], speaking)).toEqual(speaking);
  });

  it('spoken returns to the category board', () => {
    expect(reduce(speaking, { type: 'spoken' }, CATEGORIES)).toMatchObject({ level: 'categories', category: 0, index: 0, said: null });
  });

  it('spoken does nothing outside speaking', () => {
    expect(run([{ type: 'spoken' }])).toEqual(INITIAL_BOARD);
    const phrases = run([CHOOSE, NEXT]);
    expect(reduce(phrases, { type: 'spoken' }, CATEGORIES)).toEqual(phrases);
  });
});

describe('help', () => {
  const HELP_INPUT: BoardInput = { type: 'help' };
  const STOP: BoardInput = { type: 'stopHelp' };

  it('choosing the Help category gives help, and stopHelp returns to the category board on Help', () => {
    const s = run([...next(HELP), CHOOSE]);
    expect(s.level).toBe('help');
    const back = reduce(s, STOP, CATEGORIES);
    expect(back).toMatchObject({ level: 'categories', category: HELP, index: 0 });
  });

  it('the help input from the category board returns to the same frame', () => {
    const before = run([NEXT, NEXT]);
    const s = reduce(before, HELP_INPUT, CATEGORIES);
    expect(s.level).toBe('help');
    expect(reduce(s, STOP, CATEGORIES)).toEqual(before);
  });

  it('the help input from a phrase board returns to the same phrase board and frame', () => {
    const before = run([NEXT, CHOOSE, NEXT, NEXT]);
    expect(before.level).toBe('phrases');
    const s = reduce(before, HELP_INPUT, CATEGORIES);
    expect(s.level).toBe('help');
    expect(reduce(s, STOP, CATEGORIES)).toEqual(before);
  });

  it('the help input while speaking gives help and the board returns to the categories', () => {
    const speaking = run([CHOOSE, NEXT, CHOOSE]);
    const s = reduce(speaking, HELP_INPUT, CATEGORIES);
    expect(s.level).toBe('help');
    expect(reduce(s, STOP, CATEGORIES)).toMatchObject({ level: 'categories', said: null });
  });

  it('ignores next, choose, tick, help and spoken during help', () => {
    const s = reduce(run([NEXT]), HELP_INPUT, CATEGORIES);
    for (const i of [NEXT, CHOOSE, TICK, HELP_INPUT]) expect(reduce(s, i, CATEGORIES), i.type).toEqual(s);
    // spoken may arrive late after the user asked for help: it must not leave help.
    expect(reduce(s, { type: 'spoken' }, CATEGORIES).level).toBe('help');
  });

  it('a late spoken during help from speaking does not bring the said phrase back', () => {
    const speaking = run([CHOOSE, NEXT, CHOOSE]);
    const s = reduce(reduce(speaking, HELP_INPUT, CATEGORIES), { type: 'spoken' }, CATEGORIES);
    expect(reduce(s, STOP, CATEGORIES)).toMatchObject({ level: 'categories', said: null });
  });

  it('stopHelp outside help does nothing', () => {
    expect(run([STOP])).toEqual(INITIAL_BOARD);
  });
});

describe('purity and the other categories', () => {
  it('does not change its input', () => {
    const s = run([NEXT, CHOOSE, NEXT]);
    const copy = JSON.stringify(s);
    reduce(s, CHOOSE, CATEGORIES);
    expect(JSON.stringify(s)).toBe(copy);
  });

  it('Frequent opens a phrase board of the phrases it is given, and with none only Back is scanned', () => {
    const cats = CATEGORIES.map((c, i) => (i === FREQUENT ? { ...c, phrases: [] } : c));
    let s = [...next(FREQUENT), CHOOSE].reduce<BoardState>((st, i) => reduce(st, i as BoardInput, cats), INITIAL_BOARD);
    expect(s).toMatchObject({ level: 'phrases', category: FREQUENT, index: 0 });
    s = reduce(s, NEXT, cats);
    expect(s.index).toBe(0);
    s = reduce(s, CHOOSE, cats);
    expect(s).toMatchObject({ level: 'categories', category: FREQUENT });
  });

  it('Frequent with phrases speaks the one chosen', () => {
    const cats = CATEGORIES.map((c, i) => (i === FREQUENT ? { ...c, phrases: ['Yes.', 'No.'] } : c));
    const inputs: BoardInput[] = [...next(FREQUENT), CHOOSE, NEXT, NEXT, CHOOSE];
    const s = inputs.reduce<BoardState>((st, i) => reduce(st, i, cats), INITIAL_BOARD);
    expect(s).toMatchObject({ level: 'speaking', said: 'No.' });
  });
});
