import { describe, it, expect } from 'vitest';
import { detectTrigger, buildCandidates, acceptSuggestion } from '../src/lib/autocomplete.js';

describe('detectTrigger', () => {
  // ---------- emoji ----------
  it('detects a bare :shortcode trigger', () => {
    expect(detectTrigger('hello :smil')).toEqual({ kind: 'emoji', query: 'smil', start: 6 });
  });

  it('detects : at the very start of the doc', () => {
    expect(detectTrigger(':foo')).toEqual({ kind: 'emoji', query: 'foo', start: 0 });
  });

  it('detects an empty shortcode body (`:` alone)', () => {
    // Body length 0 is allowed so the dropdown can show "all emojis" right
    // after typing the colon.
    expect(detectTrigger('text :')).toEqual({ kind: 'emoji', query: '', start: 5 });
  });

  it('does NOT fire on `http://x` (shortcode body is not contiguous with the colon)', () => {
    // The backward scan from the caret stops at the first non-word char.
    // `http://x` → scan from `x` stops at `/` (index 6), never reaching the
    // `:` at index 4. So no emoji trigger fires — which is the desired
    // behaviour (URLs shouldn't pop an emoji picker).
    expect(detectTrigger('http://x')).toBeNull();
  });

  it('does NOT fire on `a:b` (colon preceded by word char)', () => {
    expect(detectTrigger('time:30')).toBeNull();
  });

  it('does NOT fire on `::` (colon preceded by another colon)', () => {
    expect(detectTrigger('foo ::bar')).toBeNull();
  });

  // ---------- wiki ----------
  it('detects an open [[wiki trigger', () => {
    expect(detectTrigger('see [[not')).toEqual({ kind: 'wiki', query: 'not', start: 4 });
  });

  it('does NOT fire once ]] closes the wiki link', () => {
    expect(detectTrigger('see [[notes]]')).toBeNull();
  });

  it('rejects a wiki query containing whitespace', () => {
    expect(detectTrigger('[[foo bar')).toBeNull();
  });

  it('rejects a wiki query spanning multiple lines', () => {
    expect(detectTrigger('[[foo\nbar')).toBeNull();
  });

  // ---------- tag ----------
  it('detects a #tag at line start', () => {
    expect(detectTrigger('#pro')).toEqual({ kind: 'tag', query: 'pro', start: 0 });
  });

  it('detects a #tag after whitespace', () => {
    expect(detectTrigger('todo #urg')).toEqual({ kind: 'tag', query: 'urg', start: 5 });
  });

  it('does NOT fire on # mid-word (`foo#bar`)', () => {
    expect(detectTrigger('foo#bar')).toBeNull();
  });

  it('returns null when no trigger is active', () => {
    expect(detectTrigger('just some prose')).toBeNull();
    expect(detectTrigger('')).toBeNull();
    expect(detectTrigger(null)).toBeNull();
  });

  it('prefers wiki over emoji when both could match', () => {
    // `[[a:b` — the wiki `[[` is the rightmost opening trigger; emoji `:`
    // would also detect `:b`, but wiki takes priority per the scan order.
    expect(detectTrigger('[[a:b')).toEqual({ kind: 'wiki', query: 'a:b', start: 0 });
  });
});

describe('buildCandidates', () => {
  const emojis = { smile: '😄', smiley: '😃', cat: '🐱', dog: '🐶' };
  const files = ['README', 'notes', 'Notes', 'project-plan'];
  const tags = ['urgent', 'idea', 'later', 'review'];

  it('emoji: prefix matches first, then includes', () => {
    const c = buildCandidates('emoji', 'sm', { emojis });
    expect(c.map((x) => x.value)).toEqual([':smile:', ':smiley:']);
  });

  it('emoji: empty query returns up to `limit` entries', () => {
    const c = buildCandidates('emoji', '', { emojis, limit: 3 });
    expect(c.length).toBe(3);
    expect(c[0]).toMatchObject({ value: ':smile:', hint: '😄' });
  });

  it('emoji: respects the limit', () => {
    const c = buildCandidates('emoji', '', { emojis, limit: 2 });
    expect(c).toHaveLength(2);
  });

  it('wiki: includes the query as a substring', () => {
    const c = buildCandidates('wiki', 'not', { files });
    // Case-insensitive includes → 'notes' and 'Notes'.
    expect(c.map((x) => x.display).sort()).toEqual(['Notes', 'notes']);
    expect(c[0].value).toMatch(/^\[\[.*\]\]$/);
  });

  it('tag: includes the query', () => {
    const c = buildCandidates('tag', 'a', { tags });
    // 'a' matches 'idea' and 'later' (both contain 'a'); 'urgent' does not.
    expect(c.map((x) => x.display)).toContain('#idea');
    expect(c.map((x) => x.display)).toContain('#later');
    expect(c.map((x) => x.display)).not.toContain('#urgent');
  });

  it('returns [] for an unknown kind', () => {
    expect(buildCandidates('unknown', 'x', {})).toEqual([]);
  });

  it('returns [] when sources are empty', () => {
    expect(buildCandidates('emoji', 'sm', {})).toEqual([]);
    expect(buildCandidates('wiki', 'x', { files: [] })).toEqual([]);
  });
});

describe('acceptSuggestion', () => {
  it('splices the value in and places the caret after it', () => {
    const r = acceptSuggestion('hello :smil', 6, 11, ':smile:');
    expect(r.text).toBe('hello :smile:');
    expect(r.caret).toBe(13);
  });

  it('preserves text after the trigger range', () => {
    // `[[not` occupies indices 4–9 (exclusive): `[[`=4-5, `n`=6, `o`=7, `t`=8.
    const r = acceptSuggestion('see [[not here', 4, 9, '[[notes]]');
    expect(r.text).toBe('see [[notes]] here');
    expect(r.caret).toBe(13);
  });

  it('handles a trigger at the start of the doc', () => {
    const r = acceptSuggestion('#pro', 0, 4, '#project');
    expect(r.text).toBe('#project');
    expect(r.caret).toBe(8);
  });
});
