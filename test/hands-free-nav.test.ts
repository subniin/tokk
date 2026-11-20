// Task 22, U4: the article and back navigation state (requirement 8).
import { describe, expect, it } from 'vitest';
import { formatHash, nextArticleId, parentOf, parseHash } from '../apps/hands-free/src/nav';
import type { View } from '../apps/hands-free/src/nav';

// Test-only values.
const IDS = ['bread-rises', 'vanishing-puddles', 'houseplant-basics'];
const JUNK = ['', '#', '#/article', '#/article/', '#/article/nope', '#/article/bread-rises/extra', '#/other', 'article/bread-rises', '#/ARTICLE/bread-rises', '#/article/%20', '#//', '#/article/__proto__'];

describe('navigation (U4)', () => {
  it('the list is #/ and an article is #/article/<id>', () => {
    expect(formatHash({ kind: 'list' })).toBe('#/');
    expect(formatHash({ kind: 'article', id: 'bread-rises' })).toBe('#/article/bread-rises');
  });

  it('a hash round trip for the list and every id', () => {
    const views: View[] = [{ kind: 'list' }, ...IDS.map((id): View => ({ kind: 'article', id }))];
    for (const v of views) expect(parseHash(formatHash(v), IDS)).toEqual({ view: v, notFound: false });
  });

  it('the list is shown for an empty hash and for #/ without the not-found flag', () => {
    expect(parseHash('', IDS)).toEqual({ view: { kind: 'list' }, notFound: false });
    expect(parseHash('#/', IDS)).toEqual({ view: { kind: 'list' }, notFound: false });
    expect(parseHash('#', IDS)).toEqual({ view: { kind: 'list' }, notFound: false });
  });

  it('an unknown id and junk give the list, and the unknown ones set notFound', () => {
    for (const h of JUNK) {
      const r = parseHash(h, IDS);
      expect(r.view, h).toEqual({ kind: 'list' });
    }
    expect(parseHash('#/article/nope', IDS).notFound).toBe(true);
    expect(parseHash('#/other', IDS).notFound).toBe(true);
    expect(parseHash('#/article/__proto__', IDS).notFound).toBe(true);
  });

  it('back from an article is the list, and back from the list is the list', () => {
    expect(parentOf({ kind: 'article', id: 'bread-rises' })).toEqual({ kind: 'list' });
    expect(parentOf({ kind: 'list' })).toEqual({ kind: 'list' });
  });

  it('list to article to list', () => {
    const list: View = { kind: 'list' };
    const article = parseHash('#/article/vanishing-puddles', IDS).view;
    expect(article).toEqual({ kind: 'article', id: 'vanishing-puddles' });
    expect(parentOf(article)).toEqual(list);
    expect(formatHash(parentOf(article))).toBe('#/');
  });

  it('the next article wraps through all three', () => {
    expect(nextArticleId('bread-rises', IDS)).toBe('vanishing-puddles');
    expect(nextArticleId('vanishing-puddles', IDS)).toBe('houseplant-basics');
    expect(nextArticleId('houseplant-basics', IDS)).toBe('bread-rises');
  });

  it('the next article of an unknown id is the first, and of an empty list throws', () => {
    expect(nextArticleId('nope', IDS)).toBe('bread-rises');
    expect(() => nextArticleId('x', [])).toThrow(RangeError);
  });
});
