import { describe, it, expect } from 'vitest';
import { extractDocLinks, classifyLinks } from '../src/lib/link-checker.js';

describe('extractDocLinks', () => {
  it('returns empty for empty / null input', () => {
    expect(extractDocLinks('')).toEqual([]);
    expect(extractDocLinks(null)).toEqual([]);
  });

  it('extracts wiki links [[Target]] and [[Target|Display]]', () => {
    const md = 'See [[Foo]] and [[Bar|the bar doc]]';
    const links = extractDocLinks(md);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ target: 'Foo', display: 'Foo', kind: 'wiki', line: 1 });
    expect(links[1]).toMatchObject({ target: 'Bar', display: 'the bar doc', kind: 'wiki', line: 1 });
  });

  it('extracts standard markdown links [text](target)', () => {
    const md = 'Read [the notes](Notes.md) for more.';
    const links = extractDocLinks(md);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ target: 'Notes.md', display: 'the notes', kind: 'md', line: 1 });
  });

  it('skips fenced code blocks', () => {
    const md = '[[Real]]\n\n```\n[[Inside]] a fence\n```\n\n[[After]]';
    const links = extractDocLinks(md);
    const targets = links.map((l) => l.target);
    expect(targets).toEqual(['Real', 'After']);
    expect(targets).not.toContain('Inside');
  });

  it('skips inline code spans', () => {
    const md = 'Type `[`x`](y.md)` but also [real](z.md)';
    const links = extractDocLinks(md);
    expect(links.map((l) => l.target)).toEqual(['z.md']);
  });

  it('ignores external http(s)/mailto/anchor links', () => {
    const md = '[ext](https://example.com) [mail](mailto:a@b.com) [anchor](#section) [file](Foo.md)';
    const links = extractDocLinks(md);
    expect(links.map((l) => l.target)).toEqual(['Foo.md']);
  });

  it('reports 1-indexed line numbers', () => {
    const md = 'intro\n\n[[Target]]';
    const links = extractDocLinks(md);
    expect(links[0].line).toBe(3);
  });

  it('handles angle-bracket wrapped targets with spaces', () => {
    const md = '[a](<My Notes.md>)';
    const links = extractDocLinks(md);
    expect(links[0].target).toBe('My Notes.md');
  });
});

describe('classifyLinks', () => {
  it('partitions links into ok and broken by basename', () => {
    const links = [
      { target: 'Foo', display: 'Foo', kind: 'wiki', line: 1 },
      { target: 'bar.md', display: 'b', kind: 'md', line: 2 },
      { target: 'Missing', display: 'M', kind: 'wiki', line: 3 },
    ];
    const existing = new Set(['Foo', 'Bar']); // note: case differs from 'bar.md'
    const { ok, broken } = classifyLinks(links, existing);
    expect(ok).toHaveLength(2);
    expect(broken).toHaveLength(1);
    expect(broken[0].target).toBe('Missing');
  });

  it('normalizes paths and extensions before matching', () => {
    // A link to 'sub/Foo.md' matches a file named 'Foo' in the folder.
    const links = [{ target: 'sub/Foo.md', display: 'x', kind: 'md', line: 1 }];
    const { ok, broken } = classifyLinks(links, ['Foo']);
    expect(ok).toHaveLength(1);
    expect(broken).toHaveLength(0);
  });

  it('strips anchor/query suffixes before resolving', () => {
    const links = [{ target: 'Foo.md#section', display: 'x', kind: 'md', line: 1 }];
    const { ok } = classifyLinks(links, ['Foo']);
    expect(ok).toHaveLength(1);
  });

  it('accepts an array as well as a Set for existingBasenames', () => {
    const links = [{ target: 'Foo', display: 'F', kind: 'wiki', line: 1 }];
    const { ok, broken } = classifyLinks(links, ['Foo']);
    expect(ok).toHaveLength(1);
    expect(broken).toHaveLength(0);
  });

  it('returns empty partitions for empty input', () => {
    const { ok, broken } = classifyLinks([], new Set());
    expect(ok).toEqual([]);
    expect(broken).toEqual([]);
  });
});
