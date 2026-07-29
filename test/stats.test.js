import { describe, it, expect } from 'vitest';
import { computeStats, computeInsights } from '../src/lib/stats.js';

describe('computeStats', () => {
  it('counts words and chars for a simple sentence', () => {
    const s = computeStats('hello world');
    expect(s.words).toBe(2);
    expect(s.chars).toBe(10); // no whitespace
  });

  it('returns zeros for empty input', () => {
    const s = computeStats('');
    expect(s.words).toBe(0);
    expect(s.chars).toBe(0);
    expect(s.paragraphs).toBe(0);
    expect(s.sentences).toBe(0);
    expect(s.readMins).toBe(0);
  });

  it('handles null/undefined input', () => {
    expect(computeStats(null).words).toBe(0);
    expect(computeStats(undefined).words).toBe(0);
  });

  it('counts paragraphs separated by blank lines', () => {
    const s = computeStats('para one\n\npara two\n\npara three');
    expect(s.paragraphs).toBe(3);
  });

  it('counts sentences by terminal punctuation', () => {
    const s = computeStats('One. Two! Three? Four.');
    expect(s.sentences).toBe(4);
  });

  it('counts CJK characters as words', () => {
    const s = computeStats('你好世界');
    expect(s.words).toBe(4);
  });

  it('computes reading and speaking time', () => {
    // 400 words → 2 read min, 4 speak min (at 200 / 130 wpm)
    const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const s = computeStats(text);
    expect(s.words).toBe(400);
    expect(s.readMins).toBe(2);
    expect(s.speakMins).toBe(3); // ceil(400/130)=4 → Math.round = 3 (rounds to nearest)
  });

  it('counts long words (6+ chars)', () => {
    const s = computeStats('a bb ccc dddd eeeee ffffff ggggggg');
    expect(s.longWords).toBe(2); // ffffff, ggggggg
  });

  it('computes average words per sentence', () => {
    // 6 words, 2 sentences → 3.0
    const s = computeStats('one two three. four five six.');
    expect(s.sentences).toBe(2);
    expect(s.avgWordsPerSentence).toBe(3);
  });
});

// ---------- v0.46.0: document insights ----------
describe('computeInsights (v0.46.0)', () => {
  it('counts word frequency, highest first', () => {
    const r = computeInsights('cat dog cat bird cat dog');
    expect(r.topWords[0]).toEqual({ word: 'cat', n: 3 });
    expect(r.topWords[1]).toEqual({ word: 'dog', n: 2 });
    expect(r.topWords[2]).toEqual({ word: 'bird', n: 1 });
  });

  it('filters out common English stopwords', () => {
    // 'the' / 'is' are stopwords; 'guitar' is the real subject.
    const r = computeInsights('the guitar is the best guitar');
    const words = r.topWords.map((t) => t.word);
    expect(words).toContain('guitar');
    expect(words).not.toContain('the');
    expect(words).not.toContain('is');
  });

  it('counts unique words', () => {
    const r = computeInsights('apple banana apple cherry');
    // unique latin words: apple, banana, cherry → 3
    expect(r.uniqueWords).toBe(3);
  });

  it('computes lexical diversity as a 0–1 ratio', () => {
    // 'a a a b' → 2 unique / 4 total = 0.5
    const r = computeInsights('cat cat cat dog');
    expect(r.lexicalDiversity).toBe(0.5);
  });

  it('finds the longest sentence by word count', () => {
    const r = computeInsights('short. this is a longer sentence with more words.');
    expect(r.longestSentence).toBe(8);
  });

  it('handles empty input', () => {
    const r = computeInsights('');
    expect(r.topWords).toEqual([]);
    expect(r.uniqueWords).toBe(0);
    expect(r.lexicalDiversity).toBe(0);
    expect(r.longestSentence).toBe(0);
  });

  it('respects the topN limit', () => {
    const r = computeInsights('cat dog bird fish horse cow', { topN: 3 });
    expect(r.topWords.length).toBe(3);
  });
});
