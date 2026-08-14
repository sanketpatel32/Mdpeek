import { describe, it, expect } from 'vitest';
import { extractFrontMatter, renderFrontMatterTable } from '../src/lib/frontmatter.js';

describe('extractFrontMatter', () => {
  it('extracts a leading --- block and returns the rest of the doc', () => {
    const { md, meta } = extractFrontMatter('---\ntitle: My Note\n---\n# Body\n');
    expect(md).toBe('# Body\n');
    expect(meta).toEqual([{ key: 'title', value: 'My Note' }]);
  });

  it('returns input unchanged when there is no front matter', () => {
    const { md, meta } = extractFrontMatter('# Just a doc\n');
    expect(md).toBe('# Just a doc\n');
    expect(meta).toEqual([]);
  });

  it('does not treat a mid-document --- as front matter', () => {
    const { md, meta } = extractFrontMatter('# Title\n\n---\n\nfoo: bar\n');
    expect(md).toBe('# Title\n\n---\n\nfoo: bar\n');
    expect(meta).toEqual([]);
  });

  it('parses booleans, numbers, quoted strings, and inline arrays', () => {
    const { meta } = extractFrontMatter(
      '---\ndraft: false\nreading-time: 12\ntitle: "Quoted"\ntags: [a, b]\n---\n',
    );
    expect(meta).toEqual([
      { key: 'draft', value: 'false' },
      { key: 'reading-time', value: '12' },
      { key: 'title', value: 'Quoted' },
      { key: 'tags', value: 'a, b' },
    ]);
  });

  it('keeps dates verbatim and skips comments/blank lines', () => {
    const { meta } = extractFrontMatter('---\n# a comment\ndate: 2026-08-14\n\nauthor: me\n---\n');
    expect(meta).toEqual([
      { key: 'date', value: '2026-08-14' },
      { key: 'author', value: 'me' },
    ]);
  });

  it('handles CRLF line endings', () => {
    const { md, meta } = extractFrontMatter('---\r\ntitle: x\r\n---\r\nbody');
    expect(md).toBe('body');
    expect(meta).toEqual([{ key: 'title', value: 'x' }]);
  });

  it('preserves duplicate keys and their order', () => {
    const { meta } = extractFrontMatter('---\nauthor: a\nauthor: b\n---\n');
    expect(meta).toEqual([
      { key: 'author', value: 'a' },
      { key: 'author', value: 'b' },
    ]);
  });
});

describe('renderFrontMatterTable', () => {
  it('renders a table with escaped keys and values', () => {
    const html = renderFrontMatterTable([{ key: 'ti<tle', value: 'a&b' }]);
    expect(html).toContain('fm-table');
    expect(html).toContain('ti&lt;tle');
    expect(html).toContain('a&amp;b');
    expect(html).not.toContain('ti<tle');
  });

  it('renders tag-like keys as pills', () => {
    const html = renderFrontMatterTable([{ key: 'tags', value: 'a, b, c' }]);
    expect(html.match(/fm-tag/g).length).toBe(3);
  });

  it('returns empty string for empty meta', () => {
    expect(renderFrontMatterTable([])).toBe('');
  });
});
