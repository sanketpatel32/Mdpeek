import { describe, it, expect } from 'vitest';
import { stripMarkdown } from '../src/lib/strip.js';

describe('stripMarkdown', () => {
  it('strips fenced code blocks', () => {
    expect(stripMarkdown('before\n```js\nconst x = 1;\n```\nafter')).toBe('before\n \nafter');
  });

  it('strips inline code', () => {
    expect(stripMarkdown('use `map` here')).toBe('use   here');
  });

  it('strips image syntax entirely', () => {
    expect(stripMarkdown('![alt](x.png)')).toBe(' ');
  });

  it('keeps link label text, drops the URL', () => {
    expect(stripMarkdown('see [Google](https://google.com)')).toBe('see Google');
  });

  it('strips heading, list, and emphasis markers', () => {
    const out = stripMarkdown('# Title\n- **bold** and _italic_');
    expect(out).not.toContain('#');
    expect(out).not.toContain('-');
    expect(out).not.toContain('*');
    expect(out).not.toContain('_');
    expect(out).toContain('Title');
    expect(out).toContain('bold');
    expect(out).toContain('italic');
  });

  it('strips raw HTML tags', () => {
    // `<b>` and `</b>` each become a single space.
    expect(stripMarkdown('a <b>bold</b> b')).toBe('a  bold  b');
  });

  it('preserves CJK characters', () => {
    // `**` around 世界 is stripped to spaces; the CJK chars remain.
    expect(stripMarkdown('你好 **世界**')).toBe('你好  世界 ');
  });

  it('handles empty input', () => {
    expect(stripMarkdown('')).toBe('');
    expect(stripMarkdown(null)).toBe('');
    expect(stripMarkdown(undefined)).toBe('');
  });
});
