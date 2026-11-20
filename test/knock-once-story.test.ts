// Task 23, U1: the story validator (requirement 7.5, 7.6), the real story.json (7.1, 7.3, 7.7) and the Edison rule (7.8).
import { describe, expect, it } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextNode, pathLengths, validateStory } from '../apps/knock-once/src/story';
import type { Story, StoryNode } from '../apps/knock-once/src/story';
import { STORY_QUESTION_MAX_CHARS } from '../apps/knock-once/src/constants';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const APP_DIR = join(REPO_ROOT, 'apps', 'knock-once');
const STORY_PATH = join(APP_DIR, 'story.json');
const INDEX_PATH = join(APP_DIR, 'index.html');
const EDGES: Record<string, [string, string]> = {
  q1: ['q2', 'q3'], q2: ['q4', 'q3'], q3: ['q5', 'q6'], q4: ['q7', 'q5'],
  q5: ['q7', 'q6'], q6: ['q8', 'chair'], q7: ['lamp', 'q8'], q8: ['door', 'chair'],
};
const ENDINGS = ['lamp', 'door', 'chair'];
const EDISON_CONTEXT_CHARS = 120;
const QUOTE_MARKS = /["“”„‘’«»]/;
const MARKUP = /[<>&]|\{\{|\}\}/;
const LAYERS_MIN = 3;          // counts of the generated stories
const LAYERS_MAX = 5;
const PER_LAYER_MIN = 2;
const PER_LAYER_MAX = 3;

const readStory = (): unknown => JSON.parse(readFileSync(STORY_PATH, 'utf8'));

// A valid story with the edges of the design, as plain data, for the broken-story tests.
function good(): { version: number; start: string; nodes: Record<string, Record<string, unknown>> } {
  const nodes: Record<string, Record<string, unknown>> = {};
  for (const [id, [yes, no]] of Object.entries(EDGES)) nodes[id] = { type: 'question', text: `Question ${id}?`, yes, no };
  for (const id of ENDINGS) nodes[id] = { type: 'ending', title: `End ${id}`, text: `The end ${id}.` };
  return { version: 1, start: 'q1', nodes };
}
const problemsOf = (raw: unknown): string[] => {
  const r = validateStory(raw);
  return r.ok ? [] : r.problems;
};
const expectProblem = (raw: unknown, pattern: RegExp): void => {
  const problems = problemsOf(raw);
  expect(problems.some((p) => pattern.test(p)), `expected ${String(pattern)} in ${JSON.stringify(problems)}`).toBe(true);
};

describe('the validator with broken stories (U1)', () => {
  it('accepts the outline of the design', () => {
    const r = validateStory(good());
    expect(r.ok).toBe(true);
  });

  it('shape: not an object, a wrong version, nodes missing, a bad id, a bad type, an empty text', () => {
    expectProblem(null, /^story: /);
    expectProblem([], /^story: /);
    expectProblem({ ...good(), version: 2 }, /^story: version/);
    expectProblem({ version: 1, start: 'q1' }, /^story: nodes/);
    const badId = good();
    badId.nodes['Q 9'] = { type: 'ending', title: 'x', text: 'y' };
    expectProblem(badId, /^Q 9: the id/);
    const badType = good();
    badType.nodes.q3.type = 'riddle';
    expectProblem(badType, /^q3: type/);
    const empty = good();
    empty.nodes.q2.text = '  ';
    expectProblem(empty, /^q2: text/);
    const noTitle = good();
    noTitle.nodes.lamp.title = '';
    expectProblem(noTitle, /^lamp: title/);
  });

  it('start: missing, or an ending', () => {
    expectProblem({ ...good(), start: 'q0' }, /^story: the start node, q0, does not exist/);
    expectProblem({ ...good(), start: 'lamp' }, /^story: the start node, lamp, is an ending/);
  });

  it('a target that does not exist names the node, the answer and the target', () => {
    const s = good();
    s.nodes.q4.no = 'q9';
    expect(problemsOf(s)).toContain('q4: the target of no, q9, does not exist.');
  });

  it('a question without a target', () => {
    const s = good();
    delete s.nodes.q5.yes;
    expectProblem(s, /^q5: the question has no yes target/);
  });

  it('too few and too many questions, and the wrong number of endings', () => {
    const few = good();
    for (const id of ['q8', 'q7']) delete few.nodes[id];
    few.nodes.q6.yes = 'door';
    few.nodes.q4.yes = 'lamp';
    few.nodes.q5.yes = 'lamp';
    expectProblem(few, /^story: 6 questions, expected 7 to 10/);
    const many = good();
    for (let i = 9; i <= 11; i++) many.nodes[`q${i}`] = { type: 'question', text: 'More?', yes: 'lamp', no: 'door' };
    many.nodes.q8.yes = 'q9';
    many.nodes.q9.yes = 'q10';
    many.nodes.q10.yes = 'q11';
    expectProblem(many, /^story: 11 questions, expected 7 to 10/);
    const endings = good();
    endings.nodes.void = { type: 'ending', title: 'Void', text: 'Nothing.' };
    endings.nodes.q8.no = 'void';
    expectProblem(endings, /^story: 4 endings, expected exactly 3/);
  });

  it('equal targets', () => {
    const s = good();
    s.nodes.q2.yes = 'q3';
    expect(problemsOf(s)).toContain('q2: yes and no both lead to q3.');
  });

  it('a cycle names the path', () => {
    const s = good();
    s.nodes.q7.no = 'q4';
    expectProblem(s, /^q4: a cycle: q4 -> q7 -> q4\.$/);
  });

  it('an orphan question', () => {
    const s = good();
    s.nodes.q9 = { type: 'question', text: 'Alone?', yes: 'lamp', no: 'door' };
    expect(problemsOf(s)).toContain('q9: the question cannot be reached from the start.');
  });

  it('a dead end: a reachable question from which no ending can be reached', () => {
    const s = good();
    s.nodes.q6 = { type: 'question', text: 'Round?', yes: 'q8', no: 'q6' };
    s.nodes.q8 = { type: 'question', text: 'Again?', yes: 'q6', no: 'q8' };
    s.nodes.q7.no = 'q4';
    expectProblem(s, /^q6: no path from this question reaches an ending\.$/);
  });

  it('an ending that cannot be reached', () => {
    const s = good();
    s.nodes.q7.yes = 'q8';
    s.nodes.q7.no = 'chair';
    expect(problemsOf(s)).toContain('lamp: the ending cannot be reached from the start.');
  });

  it('a path that is too short', () => {
    const s = good();
    s.nodes.q3.no = 'chair';
    expect(problemsOf(s)).toContain('story: the shortest path to an ending has 2 questions, expected at least 3.');
  });

  it('collects every problem and does not stop at the first', () => {
    const s = good();
    s.nodes.q4.no = 'q9';
    s.nodes.q2.yes = 'q3';
    expect(problemsOf(s).length).toBeGreaterThanOrEqual(2);
  });

  it('the walk and the path lengths of the outline', () => {
    const r = validateStory(good());
    if (!r.ok) throw new Error(r.problems.join(' '));
    expect(nextNode(r.story, 'q1', 'yes')).toBe('q2');
    expect(nextNode(r.story, 'q6', 'no')).toBe('chair');
    expect(() => nextNode(r.story, 'lamp', 'yes')).toThrow();
    expect(pathLengths(r.story)).toEqual({ shortest: 3, longest: 6 });
  });
});

// A layered story: every question points yes and no to two different nodes of the next layer, or to two different endings
// from the last layer. Every node of a layer is reached from the layer before, so the story is valid by construction.
const layeredArb = fc.record({
  layers: fc.integer({ min: LAYERS_MIN, max: LAYERS_MAX }),
  perLayer: fc.integer({ min: PER_LAYER_MIN, max: PER_LAYER_MAX }),
  picks: fc.array(fc.nat(), { minLength: 64, maxLength: 64 }),
});
function layered(layers: number, perLayer: number, picks: number[]): { story: Story; ids: string[][] } {
  // The first layer has one question and the second two; later layers have perLayer questions.
  const ids: string[][] = [['l0-0'], ['l1-0', 'l1-1']];
  for (let l = 2; l < layers; l++) ids.push(Array.from({ length: perLayer }, (_, i) => `l${l}-${i}`));
  const nodes: Record<string, StoryNode> = {};
  let k = 0;
  const pick = (n: number): number => picks[k++ % picks.length] % n;
  for (let l = 0; l < layers; l++) {
    const next = l + 1 < layers ? ids[l + 1] : ENDINGS;
    ids[l].forEach((id, i) => {
      // Node i of the layer points to next[i] and to one other: together the layer reaches every node of the next one.
      const yes = next[i % next.length];
      const others = next.filter((n) => n !== yes);
      const no = others[pick(others.length)];
      nodes[id] = { type: 'question', text: `Is ${id} here?`, yes, no };
    });
    if (l + 1 < layers && next.length > ids[l].length) {
      const last = nodes[ids[l][ids[l].length - 1]] as Extract<StoryNode, { type: 'question' }>;
      last.no = next[next.length - 1];
    }
  }
  // Every ending must be reached from the last layer.
  const lastLayer = ids[layers - 1];
  lastLayer.forEach((id, i) => {
    const q = nodes[id] as Extract<StoryNode, { type: 'question' }>;
    q.yes = ENDINGS[i % ENDINGS.length];
    q.no = ENDINGS[(i + 1) % ENDINGS.length];
  });
  for (const e of ENDINGS) nodes[e] = { type: 'ending', title: e, text: `${e}.` };
  return { story: { version: 1, start: 'l0-0', nodes }, ids };
}
const questionCount = (layers: number, perLayer: number): number => 3 + (layers - 2) * perLayer;
function reaches(story: Story, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = story.nodes[id];
    if (n?.type === 'question') stack.push(n.yes, n.no);
  }
  return false;
}
const fits =  (layers: number, perLayer: number): boolean => questionCount(layers, perLayer) >= 7 && questionCount(layers, perLayer) <= 10 && layers >= 3;

describe('layered stories (U1, property)', () => {
  test.prop([layeredArb])('a layered story with 7 to 10 questions is valid', ({ layers, perLayer, picks }) => {
    fc.pre(fits(layers, perLayer));
    const { story } = layered(layers, perLayer, picks);
    const r = validateStory(story);
    expect(r.ok ? [] : r.problems).toEqual([]);
  });

  test.prop([layeredArb, fc.nat(), fc.nat()])('one edge from a later layer back to an earlier one is a cycle', ({ layers, perLayer, picks }, a, b) => {
    fc.pre(fits(layers, perLayer));
    const { story, ids } = layered(layers, perLayer, picks);
    const later = 1 + (a % (layers - 1));
    const from = ids[later][a % ids[later].length];
    // An earlier node that reaches `from` (the start always does), so the new edge closes a cycle.
    const ancestors = ids.slice(0, later).flat().filter((id) => reaches(story, id, from));
    const to = ancestors[b % ancestors.length];
    const q = story.nodes[from] as Extract<StoryNode, { type: 'question' }>;
    q.yes = to;
    expect(problemsOf(story).some((p) => /a cycle/.test(p))).toBe(true);
  });
});

describe('the real story.json (U1)', () => {
  it('exists and is valid, with 8 questions and 3 endings and the edges of the design', () => {
    expect(existsSync(STORY_PATH)).toBe(true);
    const r = validateStory(readStory());
    expect(r.ok ? [] : r.problems).toEqual([]);
    if (!r.ok) return;
    const nodes = Object.entries(r.story.nodes);
    expect(nodes.filter(([, n]) => n.type === 'question')).toHaveLength(8);
    expect(nodes.filter(([, n]) => n.type === 'ending').map(([id]) => id).sort()).toEqual([...ENDINGS].sort());
    expect(r.story.start).toBe('q1');
    for (const [id, [yes, no]] of Object.entries(EDGES)) expect(r.story.nodes[id]).toMatchObject({ type: 'question', yes, no });
    expect(pathLengths(r.story).shortest).toBeGreaterThanOrEqual(3);
  });

  it('every question is short, and no text has a markup character', () => {
    const r = validateStory(readStory());
    if (!r.ok) throw new Error(r.problems.join(' '));
    for (const [id, n] of Object.entries(r.story.nodes)) {
      const texts = n.type === 'question' ? [n.text] : [n.title, n.text];
      if (n.type === 'question') expect(n.text.length, id).toBeLessThanOrEqual(STORY_QUESTION_MAX_CHARS);
      for (const t of texts) expect(MARKUP.test(t), `${id}: ${t}`).toBe(false);
    }
  });

  it('the name Edison is in at most one place of story.json and index.html together, with no quotation marks near it', () => {
    const sources = [readFileSync(STORY_PATH, 'utf8'), readFileSync(INDEX_PATH, 'utf8')];
    const hits = sources.flatMap((s) => [...s.matchAll(/Edison/g)].map((m) => s.slice(Math.max(0, m.index - EDISON_CONTEXT_CHARS), m.index + EDISON_CONTEXT_CHARS)));
    expect(hits.length).toBeLessThanOrEqual(1);
    const inStory = [...sources[0].matchAll(/Edison/g)].length;
    expect(inStory, 'the Edison sentence is on the entrance, not in the story').toBe(0);
    for (const around of hits) {
      const sentence = around.split(/(?<=[.!?])\s|<[^>]+>/).find((x) => x.includes('Edison')) ?? '';
      expect(QUOTE_MARKS.test(sentence), sentence).toBe(false);
    }
  });
});
