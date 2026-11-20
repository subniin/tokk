// The patterns of the app, the two modes and the action of each pattern, in one table (requirement 5.5, 6.1).
// Pure: no DOM, no Tokk import. The wiring in main.ts builds `modes` from these lists.

export type ModeName = 'on' | 'off';
export type ActionName = 'activate' | 'back' | 'toggle' | 'scrollUp' | 'scrollDown';
export interface Binding { pattern: string; action: ActionName; modes: readonly ModeName[] }

export const BINDINGS: readonly Binding[] = [
  { pattern: 'click', action: 'activate', modes: ['on'] },
  { pattern: 'click click', action: 'back', modes: ['on'] },
  { pattern: 'click click click', action: 'toggle', modes: ['on', 'off'] },
  { pattern: 'hum.rise', action: 'scrollUp', modes: ['on'] },
  { pattern: 'hum.fall', action: 'scrollDown', modes: ['on'] },
];

const patternsOf = (mode: ModeName): readonly string[] => BINDINGS.filter((b) => b.modes.includes(mode)).map((b) => b.pattern);

export const MODE_ON_PATTERNS: readonly string[] = patternsOf('on');
export const MODE_OFF_PATTERNS: readonly string[] = patternsOf('off');

export function actionOf(pattern: string): ActionName {
  const found = BINDINGS.find((b) => b.pattern === pattern);
  if (found === undefined) throw new RangeError(`No action for the pattern "${pattern}".`);
  return found.action;
}
