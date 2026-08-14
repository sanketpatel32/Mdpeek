import { describe, it, expect } from 'vitest';
import { diffLines, formatDiffStats } from '../src/lib/diff.js';

describe('diffLines', () => {
  it('returns no rows for two empty texts', () => {
    const r = diffLines('', '');
    expect(r.rows).toEqual([]);
    expect(r.stats).toEqual({ added: 0, removed: 0 });
  });

  it('handles null/undefined input without throwing', () => {
    expect(() => diffLines(null, null)).not.toThrow();
    const r = diffLines(undefined, undefined);
    expect(r.rows).toEqual([]);
  });

  it('marks identical text as all-equal', () => {
    const text = 'line one\nline two\nline three';
    const r = diffLines(text, text);
    expect(r.stats).toEqual({ added: 0, removed: 0 });
    expect(r.rows.every((row) => row.type === 'equal')).toBe(true);
    expect(r.rows.map((row) => row.text)).toEqual(['line one', 'line two', 'line three']);
    // Line numbers line up 1:1.
    expect(r.rows[0]).toMatchObject({ oldLine: 1, newLine: 1 });
    expect(r.rows[2]).toMatchObject({ oldLine: 3, newLine: 3 });
  });

  it('detects a pure addition at the end', () => {
    const r = diffLines('a\nb', 'a\nb\nc');
    expect(r.stats).toEqual({ added: 1, removed: 0 });
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ type: 'equal', text: 'a' });
    expect(r.rows[1]).toMatchObject({ type: 'equal', text: 'b' });
    expect(r.rows[2]).toMatchObject({ type: 'add', text: 'c', newLine: 3 });
    expect(r.rows[2].oldLine).toBeUndefined();
  });

  it('detects a pure deletion at the end', () => {
    const r = diffLines('a\nb\nc', 'a\nb');
    expect(r.stats).toEqual({ added: 0, removed: 1 });
    expect(r.rows[2]).toMatchObject({ type: 'del', text: 'c', oldLine: 3 });
    expect(r.rows[2].newLine).toBeUndefined();
  });

  it('detects a changed line in the middle (del then add)', () => {
    const r = diffLines('a\nold\nc', 'a\nnew\nc');
    expect(r.stats).toEqual({ added: 1, removed: 1 });
    // equal a, del old, add new, equal c
    const types = r.rows.map((row) => row.type);
    expect(types).toEqual(['equal', 'del', 'add', 'equal']);
    expect(r.rows[1]).toMatchObject({ type: 'del', text: 'old', oldLine: 2 });
    expect(r.rows[2]).toMatchObject({ type: 'add', text: 'new', newLine: 2 });
  });

  it('detects multiple inserted lines in a block', () => {
    const r = diffLines('a\nc', 'a\nb1\nb2\nc');
    expect(r.stats).toEqual({ added: 2, removed: 0 });
    const addedTexts = r.rows.filter((row) => row.type === 'add').map((row) => row.text);
    expect(addedTexts).toEqual(['b1', 'b2']);
  });

  it('treats a trailing newline the same as no trailing newline', () => {
    // "a\n" and "a" should diff as identical (one line, no change).
    const r = diffLines('a\n', 'a');
    expect(r.stats).toEqual({ added: 0, removed: 0 });
  });

  it('detects a full replacement (no common lines)', () => {
    const r = diffLines('x\ny', 'p\nq');
    expect(r.stats).toEqual({ added: 2, removed: 2 });
    expect(r.rows.filter((row) => row.type === 'del')).toHaveLength(2);
    expect(r.rows.filter((row) => row.type === 'add')).toHaveLength(2);
  });

  it('preserves order across interleaved changes', () => {
    // Change line 1 and line 3, keep line 2.
    const r = diffLines('a1\nkeep\nb1', 'a2\nkeep\nb2');
    expect(r.stats).toEqual({ added: 2, removed: 2 });
    const texts = r.rows.map((row) => `${row.type}:${row.text}`);
    expect(texts).toEqual(['del:a1', 'add:a2', 'equal:keep', 'del:b1', 'add:b2']);
  });

  it('counts additions and removals correctly for a mixed change', () => {
    const r = diffLines('one\ntwo\nthree', 'one\ntwo changed\nthree\nfour');
    expect(r.stats.added).toBe(2);
    expect(r.stats.removed).toBe(1);
  });
});

describe('diffLines — ignoreWhitespace (v0.67.0)', () => {
  it('treats reindented lines as equal when enabled', () => {
    const oldText = 'a\nb\n  c\n';
    const newText = 'a\n    b\nc   \n';
    const plain = diffLines(oldText, newText);
    expect(plain.stats.added + plain.stats.removed).toBeGreaterThan(0);
    const ws = diffLines(oldText, newText, { ignoreWhitespace: true });
    expect(ws.stats.added).toBe(0);
    expect(ws.stats.removed).toBe(0);
  });

  it('still reports real changes with ignoreWhitespace on', () => {
    const ws = diffLines('alpha\nbeta\n', 'alpha\ngamma\n', { ignoreWhitespace: true });
    expect(ws.stats).toEqual({ added: 1, removed: 1 });
  });
});

describe('formatDiffStats', () => {
  it('returns "no changes" for a zero diff', () => {
    expect(formatDiffStats({ added: 0, removed: 0 })).toBe('no changes');
  });

  it('returns "no changes" for null/undefined', () => {
    expect(formatDiffStats(null)).toBe('no changes');
    expect(formatDiffStats(undefined)).toBe('no changes');
  });

  it('formats additions only', () => {
    expect(formatDiffStats({ added: 5, removed: 0 })).toBe('+5');
  });

  it('formats removals only', () => {
    expect(formatDiffStats({ added: 0, removed: 3 })).toBe('\u22123');
  });

  it('formats both additions and removals', () => {
    expect(formatDiffStats({ added: 12, removed: 3 })).toBe('+12 \u22123');
  });
});
