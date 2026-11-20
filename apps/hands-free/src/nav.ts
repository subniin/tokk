// Views, the hash and the parent view (requirement 8). Pure: no DOM, no history, no location.

export type View = { kind: 'list' } | { kind: 'article'; id: string };
export interface ParsedHash { view: View; notFound: boolean }

const LIST_HASH = '#/';
const ARTICLE_PREFIX = '#/article/';
const LIST: View = { kind: 'list' };

// The view of a hash and whether the hash was not a known view. An empty hash, `#` and `#/` are the list, not "not found".
export function parseHash(hash: string, ids: readonly string[]): ParsedHash {
  if (hash === '' || hash === '#' || hash === LIST_HASH) return { view: { kind: 'list' }, notFound: false };
  if (hash.startsWith(ARTICLE_PREFIX)) {
    const id = hash.slice(ARTICLE_PREFIX.length);
    if (ids.includes(id)) return { view: { kind: 'article', id }, notFound: false };
  }
  return { view: { kind: 'list' }, notFound: true };
}

export function formatHash(view: View): string {
  return view.kind === 'list' ? LIST_HASH : `${ARTICLE_PREFIX}${view.id}`;
}

// "Back": an article goes to the list, the list stays the list.
export function parentOf(view: View): View {
  return view.kind === 'article' ? { ...LIST } : view;
}

// The id after `id`, wrapping from the last to the first. An id that is not in the list gives the first.
export function nextArticleId(id: string, ids: readonly string[]): string {
  if (ids.length === 0) throw new RangeError('There is no article.');
  const i = ids.indexOf(id);
  return ids[(i + 1) % ids.length];
}
