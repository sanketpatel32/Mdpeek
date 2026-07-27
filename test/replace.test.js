import { describe, it, expect } from 'vitest';
import { findAllMatches } from '../src/lib/replace.js';

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
