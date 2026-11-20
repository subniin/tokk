// The story: its shape, the validator, the walk and the path lengths (design.md "The story", requirement 7.5). Pure.
// validateStory collects every problem it finds, as sentences that name the node, in the order of the rules.
import type { Answer } from './bindings';
import { STORY_ENDING_COUNT, STORY_PATH_MIN_QUESTIONS, STORY_QUESTION_MAX, STORY_QUESTION_MIN } from './constants';

export interface QuestionNode { type: 'question'; text: string; yes: string; no: string }
export interface EndingNode { type: 'ending'; title: string; text: string }
export type StoryNode = QuestionNode | EndingNode;
export interface Story { version: 1; start: string; nodes: Record<string, StoryNode> }
export type Validation = { ok: true; story: Story } | { ok: false; problems: string[] };

const ID = /^[a-z0-9-]+$/;
const ANSWERS: readonly Answer[] = ['yes', 'no'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

// The nodes whose shape is right, and the problems of the others.
function readNodes(raw: Record<string, unknown>, problems: string[]): Record<string, StoryNode> {
  const nodes: Record<string, StoryNode> = {};
  for (const [id, n] of Object.entries(raw)) {
    if (!ID.test(id)) problems.push(`${id}: the id must match [a-z0-9-]+.`);
    if (!isObject(n) || (n.type !== 'question' && n.type !== 'ending')) {
      problems.push(`${id}: type must be "question" or "ending".`);
      continue;
    }
    if (!filled(n.text)) problems.push(`${id}: text must be a non-empty string.`);
    if (n.type === 'ending') {
      if (!filled(n.title)) problems.push(`${id}: title must be a non-empty string.`);
      nodes[id] = { type: 'ending', title: String(n.title ?? ''), text: String(n.text ?? '') };
      continue;
    }
    for (const a of ANSWERS) {
      if (n[a] === undefined) problems.push(`${id}: the question has no ${a} target.`);
      else if (typeof n[a] !== 'string') problems.push(`${id}: ${a} must be a node id.`);
    }
    nodes[id] = { type: 'question', text: String(n.text ?? ''), yes: typeof n.yes === 'string' ? n.yes : '', no: typeof n.no === 'string' ? n.no : '' };
  }
  return nodes;
}

// The targets of a question that exist.
const edges = (nodes: Record<string, StoryNode>, id: string): string[] => {
  const n = nodes[id];
  return n?.type === 'question' ? ANSWERS.map((a) => n[a]).filter((t) => t !== '' && nodes[t] !== undefined) : [];
};

// Every cycle found by a depth-first search with a stack, each as the path from the node where it closes.
function cycles(nodes: Record<string, StoryNode>, start: string): string[][] {
  const found: string[][] = [];
  const done = new Set<string>();
  const roots = [start, ...Object.keys(nodes)].filter((id) => nodes[id] !== undefined);
  for (const root of roots) {
    if (done.has(root)) continue;
    const path: string[] = [];
    const onPath = new Set<string>();
    const stack: { id: string; next: number }[] = [{ id: root, next: 0 }];
    path.push(root);
    onPath.add(root);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const out = edges(nodes, top.id);
      if (top.next >= out.length) {
        stack.pop();
        path.pop();
        onPath.delete(top.id);
        done.add(top.id);
        continue;
      }
      const t = out[top.next++];
      if (onPath.has(t)) {
        found.push([...path.slice(path.indexOf(t)), t]);
      } else if (!done.has(t)) {
        stack.push({ id: t, next: 0 });
        path.push(t);
        onPath.add(t);
      }
    }
  }
  return found;
}

function reachableFrom(nodes: Record<string, StoryNode>, start: string): Set<string> {
  const seen = new Set<string>();
  const stack = nodes[start] === undefined ? [] : [start];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...edges(nodes, id));
  }
  return seen;
}

// The fewest questions from each node to an ending, on an acyclic graph (Infinity when no ending can be reached).
function shortestFrom(nodes: Record<string, StoryNode>, id: string, memo = new Map<string, number>()): number {
  const known = memo.get(id);
  if (known !== undefined) return known;
  memo.set(id, Infinity);   // a guard against a cycle
  const n = nodes[id];
  const v = n === undefined ? Infinity : n.type === 'ending' ? 0 : 1 + Math.min(Infinity, ...edges(nodes, id).map((t) => shortestFrom(nodes, t, memo)));
  memo.set(id, v);
  return v;
}

export function validateStory(raw: unknown): Validation {
  const problems: string[] = [];
  if (!isObject(raw)) return { ok: false, problems: ['story: the story must be an object with version, start and nodes.'] };
  if (raw.version !== 1) problems.push('story: version must be 1.');
  if (!isObject(raw.nodes)) {
    problems.push('story: nodes must be an object that maps node ids to nodes.');
    return { ok: false, problems };
  }
  const nodes = readNodes(raw.nodes, problems);
  const start = typeof raw.start === 'string' ? raw.start : '';

  // The start.
  if (start === '') problems.push('story: start must be a node id.');
  else if (raw.nodes[start] === undefined) problems.push(`story: the start node, ${start}, does not exist.`);
  else if (nodes[start]?.type === 'ending') problems.push(`story: the start node, ${start}, is an ending, not a question.`);

  // The targets.
  for (const [id, n] of Object.entries(nodes)) {
    if (n.type !== 'question') continue;
    for (const a of ANSWERS) if (n[a] !== '' && raw.nodes[n[a]] === undefined) problems.push(`${id}: the target of ${a}, ${n[a]}, does not exist.`);
  }

  // The counts.
  const ids = Object.keys(nodes);
  const questions = ids.filter((id) => nodes[id].type === 'question');
  const endings = ids.filter((id) => nodes[id].type === 'ending');
  if (questions.length < STORY_QUESTION_MIN || questions.length > STORY_QUESTION_MAX) {
    problems.push(`story: ${questions.length} questions, expected ${STORY_QUESTION_MIN} to ${STORY_QUESTION_MAX}.`);
  }
  if (endings.length !== STORY_ENDING_COUNT) problems.push(`story: ${endings.length} endings, expected exactly ${STORY_ENDING_COUNT}.`);

  // Differing targets.
  for (const id of questions) {
    const n = nodes[id] as QuestionNode;
    if (n.yes !== '' && n.yes === n.no) problems.push(`${id}: yes and no both lead to ${n.yes}.`);
  }

  // Cycles.
  const loops = cycles(nodes, start);
  for (const c of loops) problems.push(`${c[0]}: a cycle: ${c.join(' -> ')}.`);

  // Orphans, dead ends, unreachable endings.
  const reached = reachableFrom(nodes, start);
  for (const id of questions) if (!reached.has(id)) problems.push(`${id}: the question cannot be reached from the start.`);
  const memo = new Map<string, number>();
  const reachesEnding = (id: string): boolean => [...reachableFrom(nodes, id)].some((x) => nodes[x].type === 'ending');
  for (const id of questions) if (reached.has(id) && !reachesEnding(id)) problems.push(`${id}: no path from this question reaches an ending.`);
  for (const id of endings) if (!reached.has(id)) problems.push(`${id}: the ending cannot be reached from the start.`);

  // The shortest path.
  if (loops.length === 0 && nodes[start]?.type === 'question') {
    const shortest = shortestFrom(nodes, start, memo);
    if (Number.isFinite(shortest) && shortest < STORY_PATH_MIN_QUESTIONS) {
      problems.push(`story: the shortest path to an ending has ${shortest} questions, expected at least ${STORY_PATH_MIN_QUESTIONS}.`);
    }
  }

  return problems.length === 0 ? { ok: true, story: { version: 1, start, nodes } } : { ok: false, problems };
}

// The walk of the flow: the node that an answer leads to.
export function nextNode(story: Story, id: string, answer: Answer): string {
  const n = story.nodes[id];
  if (n === undefined || n.type !== 'question') throw new Error(`${id} is not a question of the story.`);
  return n[answer];
}

// The fewest and the most questions from the start to an ending (for the tests). The story must be valid.
export function pathLengths(story: Story): { shortest: number; longest: number } {
  const longest = (id: string, memo: Map<string, number>): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    const n = story.nodes[id];
    const v = n.type === 'ending' ? 0 : 1 + Math.max(longest(n.yes, memo), longest(n.no, memo));
    memo.set(id, v);
    return v;
  };
  return { shortest: shortestFrom(story.nodes, story.start), longest: longest(story.start, new Map()) };
}
