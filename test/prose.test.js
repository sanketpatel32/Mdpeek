import { describe, it, expect } from 'vitest';
import { isComplexWord, findComplexWords, isDenseParagraph } from '../src/lib/prose.js';
import { countSyllables } from '../src/lib/readability.js';

describe('isComplexWord', () => {
  it('flags 3+ syllable words', () => {
    expect(isComplexWord('utilization')).toBe(true); // u-ti-li-za-tion (5)
    expect(isComplexWord('significant')).toBe(true); // sig-nif-i-cant (4)
    expect(isComplexWord('beautiful')).toBe(true); // beau-ti-ful (3)
  });

  it('does not flag short words', () => {
    expect(isComplexWord('the')).toBe(false);
    expect(isComplexWord('cat')).toBe(false);
    expect(isComplexWord('running')).toBe(false); // run-ning (2)
  });

  it('handles hyphenated / apostrophe words as single tokens', () => {
    expect(isComplexWord('well-established')).toBe(true); // es-tab-lished
    expect(isComplexWord("don't")).toBe(false);
  });

  it('rejects non-word tokens (numbers, CJK, punctuation)', () => {
    expect(isComplexWord('123')).toBe(false);
    expect(isComplexWord('---')).toBe(false);
    expect(isComplexWord('日本語')).toBe(false);
    expect(isComplexWord('!')).toBe(false);
  });

  it('is safe on empty / non-string input', () => {
    expect(isComplexWord('')).toBe(false);
    expect(isComplexWord(null)).toBe(false);
    expect(isComplexWord(undefined)).toBe(false);
  });
});

describe('findComplexWords', () => {
  it('returns offsets of complex words in a sentence', () => {
    const text = 'The utilization was significant.';
    const r = findComplexWords(text);
    expect(r).toEqual([
      { start: text.indexOf('utilization'), end: text.indexOf('utilization') + 'utilization'.length },
      { start: text.indexOf('significant'), end: text.indexOf('significant') + 'significant'.length },
    ]);
  });

  it('returns no matches for simple prose', () => {
    expect(findComplexWords('The cat sat on the mat.')).toEqual([]);
  });

  it('skips numbers and CJK', () => {
    const r = findComplexWords('123 456 日本語');
    expect(r).toEqual([]);
  });

  it('handles empty / whitespace / non-string safely', () => {
    expect(findComplexWords('')).toEqual([]);
    expect(findComplexWords('   ')).toEqual([]);
    expect(findComplexWords(null)).toEqual([]);
  });

  it('returns non-overlapping left-to-right ranges', () => {
    const text = 'organization organization';
    const r = findComplexWords(text);
    expect(r.length).toBe(2);
    expect(r[0].end).toBeLessThanOrEqual(r[1].start);
  });

  it('is consistent with isComplexWord', () => {
    const text = 'The methodology was nevertheless complicated.';
    const r = findComplexWords(text);
    for (const { start, end } of r) {
      const word = text.slice(start, end);
      expect(isComplexWord(word)).toBe(true);
      expect(countSyllables(word)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('isDenseParagraph', () => {
  it('flags a long, jargon-heavy paragraph', () => {
    // Long sentence + many complex words.
    const dense = 'The implementation of the methodology necessitated a comprehensive examination of the organizational infrastructure, which consequently facilitated the optimization of numerous operational procedures and administrative functionalities throughout the enterprise.';
    expect(isDenseParagraph(dense)).toBe(true);
  });

  it('does not flag a short paragraph (under the word floor)', () => {
    expect(isDenseParagraph('Utilization necessitated comprehensive examination.')).toBe(false);
  });

  it('does not flag long-but-simple prose (low complex ratio, short sentences)', () => {
    const simple = Array.from({ length: 14 }, (_, i) => `The cat ran fast and the dog ran fast too in the park number ${i}.`).join(' ');
    // Many short sentences, simple words → not dense.
    expect(isDenseParagraph(simple)).toBe(false);
  });

  it('flags a paragraph that is long-winded (high avg words/sentence) even without extreme jargon', () => {
    // One giant run-on sentence of simple words, above the sentence-length threshold.
    const runon = Array.from({ length: 30 }, () => 'the quick brown fox jumps over the lazy dog').join(' and ');
    // >24 words/sentence, and >= 12 words.
    expect(isDenseParagraph(runon)).toBe(true);
  });

  it('is safe on empty / whitespace / CJK-only input', () => {
    expect(isDenseParagraph('')).toBe(false);
    expect(isDenseParagraph('   ')).toBe(false);
    expect(isDenseParagraph(null)).toBe(false);
    expect(isDenseParagraph('日本語の文章です。これは短いです。')).toBe(false);
  });
});
