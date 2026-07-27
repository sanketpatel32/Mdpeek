import { describe, it, expect } from 'vitest';
import { docBasename, backlinkQueries, formatBacklinkItems } from '../src/lib/backlinks.js';

describe('docBasename', () => {
  it('strips a Windows absolute path + .md', () => {
    expect(docBasename('C:\\Users\\me\\notes\\Foo.md')).toBe('Foo');
  });

  it('strips a Unix absolute path + .md', () => {
    expect(docBasename('/home/me/notes/bar.md')).toBe('bar');
  });

  it('strips .markdown and .mdx (case-insensitive)', () => {
    expect(docBasename('Notes/Baz.MARKDOWN')).toBe('Baz');
    expect(docBasename('Notes/Qux.MDX')).toBe('Qux');
  });

  it('handles a bare filename with no extension', () => {
    expect(docBasename('Untitled')).toBe('Untitled');
  });

  it('does not strip non-markdown extensions', () => {
    // A .pdf or .txt doc isn't a wiki target; the basename keeps its ext so
    // the search query stays unambiguous.
    expect(docBasename('C:\\notes\\image.png')).toBe('image.png');
  });

  it('returns null for empty / null / undefined input', () => {
    expect(docBasename(null)).toBeNull();
    expect(docBasename(undefined)).toBeNull();
    expect(docBasename('')).toBeNull();
  });
});

describe('backlinkQueries', () => {
  it('returns both the wiki-link and standard-link forms', () => {
    expect(backlinkQueries('Foo')).toEqual(['[[Foo', 'Foo.md']);
  });

  it('returns an empty array for an empty basename', () => {
    expect(backlinkQueries('')).toEqual([]);
    expect(backlinkQueries(null)).toEqual([]);
  });

  it('strips double quotes defensively (crafted name can\'t break the query)', () => {
    expect(backlinkQueries('a"b')).toEqual(['[[ab', 'ab.md']);
  });
});

describe('formatBacklinkItems', () => {
  it('returns an empty array for empty input', () => {
    expect(formatBacklinkItems([], 'C:\\a.md')).toEqual([]);
    expect(formatBacklinkItems(null, 'C:\\a.md')).toEqual([]);
  });

  it('dedupes by path', () => {
    const hits = [
      { path: 'C:\\b.md', matches: [{ text: '[[A]]' }] },
      { path: 'C:\\b.md', matches: [{ text: 'A.md' }] },
    ];
    const items = formatBacklinkItems(hits, 'C:\\a.md');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('b.md');
  });

  it('excludes the active doc (no self-backlinks)', () => {
    const hits = [
      { path: 'C:\\a.md', matches: [{ text: '[[A]]' }] },
      { path: 'C:\\b.md', matches: [{ text: '[[A]]' }] },
    ];
    const items = formatBacklinkItems(hits, 'C:\\a.md');
    expect(items.map((i) => i.label)).toEqual(['b.md']);
  });

  it('uses the first match text as the hint', () => {
    const hits = [{ path: 'C:\\b.md', matches: [{ text: 'see [[A]] for context' }] }];
    const items = formatBacklinkItems(hits, 'C:\\a.md');
    expect(items[0].hint).toBe('see [[A]] for context');
  });

  it('truncates preview text longer than 60 chars with an ellipsis', () => {
    const long = 'x'.repeat(80);
    const hits = [{ path: 'C:\\b.md', matches: [{ text: long }] }];
    const items = formatBacklinkItems(hits, 'C:\\a.md');
    // slice(0,57) + '…' (1 code unit) = 58 chars total.
    expect(items[0].hint).toBe('x'.repeat(57) + '…');
    expect(items[0].hint.length).toBe(58);
  });

  it('handles a hit with no matches array (defensive)', () => {
    const hits = [{ path: 'C:\\b.md' }];
    const items = formatBacklinkItems(hits, 'C:\\a.md');
    expect(items[0].hint).toBe('');
  });

  it('sorts items alphabetically by label', () => {
    const hits = [
      { path: 'C:\\zeta.md', matches: [{ text: 'A' }] },
      { path: 'C:\\alpha.md', matches: [{ text: 'A' }] },
      { path: 'C:\\mid.md', matches: [{ text: 'A' }] },
    ];
    const items = formatBacklinkItems(hits, 'C:\\a.md');
    expect(items.map((i) => i.label)).toEqual(['alpha.md', 'mid.md', 'zeta.md']);
  });

  it('includes the path in keywords for fuzzy matching', () => {
    const hits = [{ path: 'C:\\sub\\dir\\b.md', matches: [{ text: 'x' }] }];
    const items = formatBacklinkItems(hits, 'C:\\a.md');
    expect(items[0].keywords).toContain('C:\\sub\\dir\\b.md');
    expect(items[0].keywords).toContain('b.md');
  });

  it('carries the path through for the onSelect handler', () => {
    const hits = [{ path: 'C:\\sub\\b.md', matches: [{ text: 'x' }] }];
    const items = formatBacklinkItems(hits, 'C:\\a.md');
    expect(items[0].path).toBe('C:\\sub\\b.md');
  });
});
