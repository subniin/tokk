// The two modes, the three patterns and the action of each pattern (design.md "Bindings"). Pure: no DOM, no Tokk.
// The three patterns are never active at once: `knock` is a prefix of `knock knock`, which is a prefix of the summon, so
// with all three the yes would wait 350 ms and the no up to 1000 ms. Each screen listens only for what it needs.

export type ModeName = 'start' | 'question';
export type Answer = 'yes' | 'no';
export type PatternAction = 'summon' | Answer;
export interface Binding { name: PatternAction; pattern: string; mode: ModeName }

export const PATTERN_SUMMON = 'knock knock _ knock';
export const PATTERN_YES = 'knock';
export const PATTERN_NO = 'knock knock';

export const BINDINGS: readonly Binding[] = [
  { name: 'summon', pattern: PATTERN_SUMMON, mode: 'start' },
  { name: 'yes', pattern: PATTERN_YES, mode: 'question' },
  { name: 'no', pattern: PATTERN_NO, mode: 'question' },
];
export const MODE_NAMES: readonly ModeName[] = ['start', 'question'];
const patternsOf = (mode: ModeName): readonly string[] => BINDINGS.filter((b) => b.mode === mode).map((b) => b.pattern);
export const MODE_START_PATTERNS: readonly string[] = patternsOf('start');
export const MODE_QUESTION_PATTERNS: readonly string[] = patternsOf('question');

export function actionOf(pattern: string): PatternAction {
  const b = BINDINGS.find((x) => x.pattern === pattern);
  if (b === undefined) throw new Error(`No binding for the pattern "${pattern}".`);
  return b.name;
}
