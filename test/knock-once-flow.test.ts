// Task 23, U3 (requirement 8, 6.1, 6.3): the state table, the mode of every state, and every path of the real story.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { activePatterns, advance, allows, FLOW_STATES, modeOf, transition } from '../apps/knock-once/src/flow';
import type { FlowEvent, FlowState } from '../apps/knock-once/src/flow';
import { MODE_QUESTION_PATTERNS, MODE_START_PATTERNS, PATTERN_NO, PATTERN_SUMMON, PATTERN_YES } from '../apps/knock-once/src/bindings';
import type { Answer } from '../apps/knock-once/src/bindings';
import { validateStory } from '../apps/knock-once/src/story';
import type { Story } from '../apps/knock-once/src/story';
import { REPO_ROOT } from './web/paths';

const EVENTS: FlowEvent[] = ['begin', 'needsTeaching', 'taught', 'summon', 'answer', 'shown', 'reachedEnding'];
const ALLOWED: Record<string, FlowState> = {
  'entrance begin': 'waiting',
  'entrance needsTeaching': 'teaching',
  'teaching taught': 'waiting',
  'waiting needsTeaching': 'teaching',
  'asking needsTeaching': 'teaching',
  'ending needsTeaching': 'teaching',
  'waiting summon': 'between',
  'ending summon': 'between',
  'asking answer': 'between',
  'between shown': 'asking',
  'between reachedEnding': 'ending',
};

function realStory(): Story {
  const r = validateStory(JSON.parse(readFileSync(join(REPO_ROOT, 'apps', 'knock-once', 'story.json'), 'utf8')));
  if (!r.ok) throw new Error(r.problems.join(' '));
  return r.story;
}

describe('the state table (U3)', () => {
  it('every allowed move and every refused move', () => {
    for (const s of FLOW_STATES) {
      for (const e of EVENTS) expect(transition(s, e), `${s} ${e}`).toBe(ALLOWED[`${s} ${e}`] ?? null);
    }
  });

  it('summon only in waiting and ending, an answer only in asking, nothing that changes the story in between', () => {
    expect(FLOW_STATES.filter((s) => allows(s, 'summon'))).toEqual(['waiting', 'ending']);
    expect(FLOW_STATES.filter((s) => allows(s, 'answer'))).toEqual(['asking']);
    expect(FLOW_STATES.filter((s) => allows(s, 'teach'))).toEqual(['waiting', 'asking', 'ending']);
    expect(allows('between', 'mute')).toBe(true);
    expect(allows('entrance', 'mute')).toBe(false);
  });

  it('the first answer locks the state: a second answer is refused', () => {
    const locked = transition('asking', 'answer');
    expect(locked).toBe('between');
    expect(transition(locked as FlowState, 'answer')).toBeNull();
    expect(allows(locked as FlowState, 'answer')).toBe(false);
  });

  it('the mode of every state, and never all three patterns at once', () => {
    expect(FLOW_STATES.map((s) => modeOf(s))).toEqual([null, null, 'start', null, 'question', 'start']);
    expect([...activePatterns('waiting')]).toEqual([...MODE_START_PATTERNS]);
    expect([...activePatterns('ending')]).toEqual([...MODE_START_PATTERNS]);
    expect([...activePatterns('asking')]).toEqual([...MODE_QUESTION_PATTERNS]);
    for (const s of FLOW_STATES) {
      const active = activePatterns(s);
      expect([PATTERN_SUMMON, PATTERN_YES, PATTERN_NO].every((p) => active.includes(p)), s).toBe(false);
    }
  });
});

describe('every path of the real story (U3)', () => {
  it('ends in an ending, with the right states on the way, and a new game starts at the first question', () => {
    const story = realStory();
    const endings = new Set<string>();
    const walk = (nodeId: string, answers: Answer[]): void => {
      const node = story.nodes[nodeId];
      if (node.type === 'ending') {
        endings.add(nodeId);
        return;
      }
      for (const a of ['yes', 'no'] as Answer[]) walk(advance(story, nodeId, a), [...answers, a]);
    };
    walk(story.start, []);
    expect([...endings].sort()).toEqual(['chair', 'door', 'lamp']);

    // One game through the table: summon, the questions, the ending, then a new game.
    let state: FlowState = transition('entrance', 'begin') as FlowState;
    expect(state).toBe('waiting');
    let node = story.start;
    state = transition(state, 'summon') as FlowState;
    expect(state).toBe('between');
    state = transition(state, 'shown') as FlowState;
    let questions = 0;
    while (story.nodes[node].type === 'question') {
      expect(state).toBe('asking');
      expect(modeOf(state)).toBe('question');
      questions++;
      node = advance(story, node, 'no');
      state = transition(state, 'answer') as FlowState;
      expect(state).toBe('between');
      state = transition(state, story.nodes[node].type === 'ending' ? 'reachedEnding' : 'shown') as FlowState;
    }
    expect(state).toBe('ending');
    expect(modeOf(state)).toBe('start');
    expect(questions).toBeGreaterThanOrEqual(3);
    expect(transition(state, 'summon')).toBe('between');
  });
});
