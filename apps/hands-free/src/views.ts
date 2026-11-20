// The views (DOM): the list and one article, rendered with DOM calls and textContent only (requirement 8.7).
import { ARTICLES } from './articles';
import { formatHash, nextArticleId } from './nav';
import type { View } from './nav';

const LIST_TITLE = 'Reading list';
const LIST_INTRO = 'Three short articles. A frame moves over the links. Click when the frame is on the one you want.';
const NOT_FOUND_TEXT = 'That article was not found.';
const BACK_TEXT = 'Back to the list';
const NEXT_PREFIX = 'Read next: ';

function make<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
}

function link(href: string, text: string, title?: string): HTMLAnchorElement {
  const a = make('a', text);
  a.href = href;
  if (title !== undefined) a.dataset.title = title;
  return a;
}

function paragraphOf(child: HTMLElement): HTMLParagraphElement {
  const p = make('p');
  p.append(child);
  return p;
}

function heading(text: string): HTMLHeadingElement {
  const h = make('h2', text);
  h.tabIndex = -1;
  return h;
}

// Fills `root` with the view. Returns the heading (focus goes there) and the page title.
export function renderView(root: HTMLElement, view: View, notFound: boolean): { heading: HTMLElement; title: string } {
  const ids = ARTICLES.map((a) => a.id);
  const article = view.kind === 'article' ? ARTICLES.find((a) => a.id === view.id) : undefined;
  if (view.kind === 'article' && article !== undefined) {
    const h = heading(article.title);
    const next = ARTICLES.find((a) => a.id === nextArticleId(article.id, ids)) ?? article;
    root.replaceChildren(
      paragraphOf(link(formatHash({ kind: 'list' }), BACK_TEXT)),
      h,
      ...article.paragraphs.map((p) => make('p', p)),
      paragraphOf(link(formatHash({ kind: 'article', id: next.id }), `${NEXT_PREFIX}${next.title}`, next.title)),
    );
    root.dataset.view = article.id;
    return { heading: h, title: article.title };
  }
  const h = heading(LIST_TITLE);
  const list = make('ul');
  for (const a of ARTICLES) {
    const li = make('li');
    li.append(link(formatHash({ kind: 'article', id: a.id }), a.title, a.title), make('span', ` ${a.summary}`));
    list.append(li);
  }
  root.replaceChildren(h, ...(notFound ? [make('p', NOT_FOUND_TEXT)] : []), make('p', LIST_INTRO), list);
  root.dataset.view = 'list';
  return { heading: h, title: LIST_TITLE };
}
