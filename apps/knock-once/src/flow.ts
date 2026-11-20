// The state table of the game (design.md "The flow", requirement 8). Pure. The story position is kept apart from the
// state: advance() walks the story, transition() moves the state. A refused move returns null.
import { MODE_QUESTION_PATTERNS, MODE_START_PATTERNS } from './bindings';
import type { Answer, ModeName } from './bindings';
import { nextNode } from './story';
import type { Story } from './story';

export type FlowState = 'entrance' | 'teaching' | 'waiting' | 'between' | 'asking' | 'ending';
export type FlowEvent = 'begin' | 'needsTeaching' | 'taught' | 'summon' | 'answer' | 'shown' | 'reachedEnding';
export type UserAction = 'summon' | 'answer' | 'teach' | 'mute';

export const FLOW_STATES: readonly FlowState[] = ['entrance', 'teaching', 'waiting', 'between', 'asking', 'ending'];

// state -> event -> next state. Teach again is allowed where the game waits for the player, and ends at the start screen.
const TABLE: Readonly<Record<FlowState, Partial<Record<FlowEvent, FlowState>>>> = {
  entrance: { begin: 'waiting', needsTeaching: 'teaching' },
  teaching: { taught: 'waiting' },
  waiting: { summon: 'between', needsTeaching: 'teaching' },
  between: { shown: 'asking', reachedEnding: 'ending' },
  asking: { answer: 'between', needsTeaching: 'teaching' },
  ending: { summon: 'between', needsTeaching: 'teaching' },
};

const MODES: Readonly<Record<FlowState, ModeName | null>> = {
  entrance: null, teaching: null, waiting: 'start', between: null, asking: 'question', ending: 'start',
};

export function transition(state: FlowState, event: FlowEvent): FlowState | null {
  return TABLE[state][event] ?? null;
}

// The engine mode of a state; null where no handler may change the story.
export function modeOf(state: FlowState): ModeName | null {
  return MODES[state];
}

export function activePatterns(state: FlowState): readonly string[] {
  const mode = modeOf(state);
  return mode === 'start' ? MODE_START_PATTERNS : mode === 'question' ? MODE_QUESTION_PATTERNS : [];
}

export function allows(state: FlowState, action: UserAction): boolean {
  switch (action) {
    case 'summon': return transition(state, 'summon') !== null;
    case 'answer': return transition(state, 'answer') !== null;
    case 'teach': return transition(state, 'needsTeaching') !== null && state !== 'entrance';
    case 'mute': return state !== 'entrance';
  }
}

export function advance(story: Story, nodeId: string, answer: Answer): string {
  return nextNode(story, nodeId, answer);
}
