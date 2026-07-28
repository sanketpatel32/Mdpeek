import { describe, it, expect } from 'vitest';
import { parseImageSize } from '../src/lib/image-size.js';

describe('parseImageSize', () => {
  it('returns no size for a plain image', () => {
    const r = parseImageSize({ href: 'x.png', title: '', text: 'alt' });
    expect(r.width).toBeNull();
    expect(r.height).toBeNull();
    expect(r.alt).toBe('alt');
    expect(r.title).toBe('');
  });

  it('parses GitHub "=WxH" from the title', () => {
    const r = parseImageSize({ href: 'x.png', title: '=200x300', text: 'alt' });
    expect(r.width).toBe(200);
    expect(r.height).toBe(300);
    expect(r.title).toBe(''); // size consumed the title
  });

  it('parses GitHub "=W" (width only)', () => {
    const r = parseImageSize({ href: 'x.png', title: '=200', text: 'alt' });
    expect(r.width).toBe(200);
    expect(r.height).toBeNull();
  });

  it('parses Obsidian "|W" from the alt text', () => {
    const r = parseImageSize({ href: 'x.png', title: '', text: 'alt|300' });
    expect(r.width).toBe(300);
    expect(r.alt).toBe('alt'); // size stripped from alt
  });

  it('does NOT treat a normal title as a size (no leading =)', () => {
    const r = parseImageSize({ href: 'x.png', title: '200x300', text: 'alt' });
    expect(r.width).toBeNull();
    expect(r.title).toBe('200x300');
  });

  it('does NOT treat a | in alt without trailing digits as size', () => {
    const r = parseImageSize({ href: 'x.png', title: '', text: 'a|b|c' });
    expect(r.width).toBeNull();
    expect(r.alt).toBe('a|b|c');
  });

  it('GitHub width takes precedence over Obsidian width', () => {
    const r = parseImageSize({ href: 'x.png', title: '=100', text: 'alt|200' });
    expect(r.width).toBe(100);
    expect(r.alt).toBe('alt');
  });

  it('handles missing args gracefully', () => {
    const r = parseImageSize();
    expect(r.width).toBeNull();
    expect(r.alt).toBe('');
  });
});
