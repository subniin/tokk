// The categories and their default phrases (click-talk.md section 5). Pure.
import { FREQUENT_MAX_PHRASES, VALID_PHRASE_COUNTS } from './constants';

export type Category = { id: string; title: string; phrases: string[] };

export const FREQUENT_ID = 'frequent';
export const HELP_ID = 'help';

export const PHRASE_COUNT_MESSAGE = 'Each category holds 6 or 8 phrases. Add one more or remove one.';
export const EMPTY_FREQUENT_TEXT = 'Phrases you use often will show here.';
export const LAST_SAID_TITLE = 'Last said';
export const BACK_TITLE = 'Back';

// Order is fixed: a person who scans learns the place of each cell. Frequent is built from counts, Help starts the alarm.
export const CATEGORIES: Category[] = [
  {
    id: 'needs', title: 'Needs', phrases: [
      'I\'m thirsty.', 'I\'m hungry.', 'I need the toilet.', 'I\'m too hot.', 'I\'m too cold.', 'Please move me.',
      'Turn the light off.', 'Turn the light on.',
    ],
  },
  {
    id: 'body', title: 'Body', phrases: [
      'I\'m in pain.', 'My head hurts.', 'My back hurts.', 'I feel sick.', 'I feel dizzy.', 'I\'m tired.',
      'I can\'t breathe well.', 'I\'m OK.',
    ],
  },
  {
    id: 'people', title: 'People', phrases: [
      'Please call my family.', 'I want to see the nurse.', 'Who is there?', 'Please stay with me.', 'I want to be alone.',
      'Thank you.',
    ],
  },
  {
    id: 'talk', title: 'Talk', phrases: [
      'Yes.', 'No.', 'I don\'t know.', 'Please wait.', 'Say that again, please.', 'I love you.', 'Good morning.', 'Good night.',
    ],
  },
  { id: FREQUENT_ID, title: 'Frequent', phrases: [] },
  { id: HELP_ID, title: 'Help', phrases: [] },
];

export function validPhraseCount(n: number): boolean {
  return VALID_PHRASE_COUNTS.includes(n);
}

// The Frequent board: the last said phrase first, then the most used, at most FREQUENT_MAX_PHRASES in all, each once.
// Ties go in alphabetical order so the board does not shuffle between visits.
export function frequentPhrases(counts: Readonly<Record<string, number>>, lastSaid: string | null): string[] {
  const used = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort(([a, na], [b, nb]) => nb - na || (a < b ? -1 : a > b ? 1 : 0))
    .map(([phrase]) => phrase);
  const list = lastSaid === null ? used : [lastSaid, ...used.filter((p) => p !== lastSaid)];
  return list.slice(0, FREQUENT_MAX_PHRASES);
}

// The categories with the Frequent phrases filled in. Every other category is returned as it is.
export function withFrequent(cats: readonly Category[], counts: Readonly<Record<string, number>>, lastSaid: string | null): Category[] {
  return cats.map((c) => (c.id === FREQUENT_ID ? { ...c, phrases: frequentPhrases(counts, lastSaid) } : c));
}
