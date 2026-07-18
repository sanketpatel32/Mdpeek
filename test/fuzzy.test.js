import { describe, it, expect } from 'vitest';
import { fuzzyMatch } from '../src/lib/fuzzy.js';

describe('fuzzyMatch', () => {
  it('returns null when the query chars are not all present in order', () => {
    expect(fuzzyMatch('xyz', 'apple')).toBeNull();
    expect(fuzzyMatch('ba', 'ab')).toBeNull(); // not in order
  });

  it('returns a zero-score match for an empty query', () => {
    const m = fuzzyMatch('', 'anything');
    expect(m).toEqual({ score: 0, indices: [] });
  });

  it('matches a prefix with a high score', () => {
    const m = fuzzyMatch('op', 'Open file');
    expect(m.indices).toEqual([0, 1]);
    expect(m.score).toBeGreaterThanOrEqual(8); // prefix bonus
  });

  it('matches scattered chars as a subsequence', () => {
    const m = fuzzyMatch('otf', 'open the file');
    expect(m).not.toBeNull();
    expect(m.indices.length).toBe(3);
  });

  it('scores contiguous matches higher than scattered ones', () => {
    const contiguous = fuzzyMatch('save', 'Save file');
    const scattered = fuzzyMatch('sve', 'Save file');
    expect(contiguous.score).toBeGreaterThan(scattered.score);
  });

  it('rewards word-boundary matches (camelCase / spaces)', () => {
    // "tf" matches at start of "the" and "file" — both at word boundaries.
    const boundary = fuzzyMatch('tf', 'open the file');
    // Same chars scattered mid-word would score worse; here we just sanity
    // check that boundary matches outscore a non-boundary alternative.
    const midWord = fuzzyMatch('he', 'the'); // 'h' and 'e' inside 'the'
    expect(boundary.score).toBeGreaterThan(midWord.score);
  });

  it('is case-insensitive', () => {
    const lower = fuzzyMatch('mdf', 'Markdown File');
    const upper = fuzzyMatch('MDF', 'markdown file');
    expect(lower).toEqual(upper);
  });
});
