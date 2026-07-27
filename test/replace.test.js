import { describe, it, expect } from 'vitest';
import { findAllMatches, applyReplacements } from '../src/lib/replace.js';

describe('findAllMatches', () => {
  it('returns an empty array for an empty query', () => {
    expect(findAllMatches('hello world', '', { caseSensitive: false })).toEqual([]);
  });

  it('finds a single match', () => {
    expect(findAllMatches('hello', 'ell', { caseSensitive: true }))
      .toEqual([{ start: 1, end: 4 }]);
  });

  it('finds multiple matches on one line', () => {
    expect(findAllMatches('aaa', 'a', { caseSensitive: true }))
      .toEqual([{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }]);
  });

  it('finds matches across multiple lines', () => {
    expect(findAllMatches('foo\nbar\nfoo', 'foo', { caseSensitive: true }))
      .toEqual([{ start: 0, end: 3 }, { start: 8, end: 11 }]);
  });

  it('is case-sensitive when the flag is true', () => {
    expect(findAllMatches('Foo foo FOO', 'foo', { caseSensitive: true }))
      .toEqual([{ start: 4, end: 7 }]);
  });

  it('is case-insensitive when the flag is false', () => {
    expect(findAllMatches('Foo foo FOO', 'foo', { caseSensitive: false }))
      .toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 11 }]);
  });

  it('is overlap-safe (aa in aaaa -> 2 matches, not 3)', () => {
    expect(findAllMatches('aaaa', 'aa', { caseSensitive: true }))
      .toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });

  it('handles multibyte characters by code-point offsets', () => {
    // 'café' — é is one code point (U+00E9). 'é' at index 3.
    expect(findAllMatches('café', 'é', { caseSensitive: true }))
      .toEqual([{ start: 3, end: 4 }]);
  });

  it('handles emoji (astral-plane) offsets', () => {
    // 'a😀b' — 😀 is one code point but two UTF-16 code units (a surrogate
    // pair). JS strings index by code unit, so indexOf/slice use code-unit
    // offsets: 😀 occupies indices 1–2 (end is exclusive → 3).
    expect(findAllMatches('a😀b', '😀', { caseSensitive: true }))
      .toEqual([{ start: 1, end: 3 }]);
  });
});

describe('applyReplacements', () => {
  it('returns the original content and count 0 when there are no matches', () => {
    const r = applyReplacements('hello world', 'xyz', 'abc', { caseSensitive: true });
    expect(r).toEqual({ result: 'hello world', count: 0 });
  });

  it('replaces a single match', () => {
    const r = applyReplacements('hello', 'ell', 'XX', { caseSensitive: true });
    expect(r).toEqual({ result: 'hXXo', count: 1 });
  });

  it('replaces every match on one line', () => {
    const r = applyReplacements('aaa', 'a', 'b', { caseSensitive: true });
    expect(r).toEqual({ result: 'bbb', count: 3 });
  });

  it('replaces matches across multiple lines', () => {
    const r = applyReplacements('foo\nbar\nfoo', 'foo', 'qux', { caseSensitive: true });
    expect(r).toEqual({ result: 'qux\nbar\nqux', count: 2 });
  });

  it('supports an empty replacement (deletion)', () => {
    const r = applyReplacements('a-b-c', '-', '', { caseSensitive: true });
    expect(r).toEqual({ result: 'abc', count: 2 });
  });

  it('does not loop when the replacement contains the query', () => {
    // query "a", replacement "aa" — must not re-match the inserted text.
    const r = applyReplacements('a', 'a', 'aa', { caseSensitive: true });
    expect(r).toEqual({ result: 'aa', count: 1 });
  });

  it('is case-insensitive when the flag is false', () => {
    const r = applyReplacements('Foo foo FOO', 'foo', 'bar', { caseSensitive: false });
    expect(r).toEqual({ result: 'bar bar bar', count: 3 });
  });

  it('inserts the replacement verbatim (no re-casing) in case-insensitive mode', () => {
    const r = applyReplacements('FOO', 'foo', 'Bar', { caseSensitive: false });
    expect(r).toEqual({ result: 'Bar', count: 1 });
  });

  it('is overlap-safe (aa in aaaa -> 2 replacements)', () => {
    const r = applyReplacements('aaaa', 'aa', 'b', { caseSensitive: true });
    expect(r).toEqual({ result: 'bb', count: 2 });
  });

  it('handles multibyte characters', () => {
    const r = applyReplacements('café', 'é', 'e', { caseSensitive: true });
    expect(r).toEqual({ result: 'cafe', count: 1 });
  });

  it('returns count 0 for an empty query', () => {
    const r = applyReplacements('hello', '', 'x', { caseSensitive: true });
    expect(r).toEqual({ result: 'hello', count: 0 });
  });
});
