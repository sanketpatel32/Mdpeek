import { describe, it, expect } from 'vitest';
import { countSyllables, easeLabel, computeReadability } from '../src/lib/readability.js';

describe('countSyllables', () => {
  it('counts a single-syllable word', () => {
    expect(countSyllables('world')).toBe(1);
    expect(countSyllables('the')).toBe(1);
    expect(countSyllables('and')).toBe(1);
  });

  it('counts vowel clusters as one beat', () => {
    expect(countSyllables('tree')).toBe(1); // 'ee' cluster
    expect(countSyllables('boot')).toBe(1);
    expect(countSyllables('rain')).toBe(1);
  });

  it('counts two syllables', () => {
    expect(countSyllables('hello')).toBe(2);
    expect(countSyllables('mother')).toBe(2);
  });

  it('subtracts a trailing silent e', () => {
    expect(countSyllables('name')).toBe(1); // na-me → 1 after silent e
    expect(countSyllables('ate')).toBe(1);
    expect(countSyllables('time')).toBe(1);
  });

  it('does not subtract silent e below 1', () => {
    // 'the' has one vowel group; trailing e shouldn't drop it to 0.
    expect(countSyllables('the')).toBe(1);
  });

  it('counts multi-syllable words', () => {
    expect(countSyllables('banana')).toBe(3);
    expect(countSyllables('extraordinary')).toBeGreaterThanOrEqual(5);
  });

  it('ignores non-alpha characters and case', () => {
    expect(countSyllables('HELLO')).toBe(2);
    expect(countSyllables("don't")).toBe(1); // apostrophe stripped → dont
  });

  it('returns 0 for empty / non-string input', () => {
    expect(countSyllables('')).toBe(0);
    expect(countSyllables(null)).toBe(0);
    expect(countSyllables(undefined)).toBe(0);
    expect(countSyllables('123')).toBe(0); // digits stripped → empty
  });
});

describe('easeLabel', () => {
  it('returns "Very easy" for high scores', () => {
    expect(easeLabel(95)).toBe('Very easy');
    expect(easeLabel(90)).toBe('Very easy');
  });

  it('returns "Easy" for the 70–89 band', () => {
    expect(easeLabel(75)).toBe('Easy');
    expect(easeLabel(70)).toBe('Easy');
  });

  it('returns "Standard" for the 60–69 band', () => {
    expect(easeLabel(65)).toBe('Standard');
    expect(easeLabel(60)).toBe('Standard');
  });

  it('returns "Fairly difficult" for the 50–59 band', () => {
    expect(easeLabel(55)).toBe('Fairly difficult');
    expect(easeLabel(50)).toBe('Fairly difficult');
  });

  it('returns "Difficult" for the 30–49 band', () => {
    expect(easeLabel(40)).toBe('Difficult');
    expect(easeLabel(30)).toBe('Difficult');
  });

  it('returns "Very confusing" for scores below 30', () => {
    expect(easeLabel(20)).toBe('Very confusing');
    expect(easeLabel(0)).toBe('Very confusing');
  });
});

describe('computeReadability', () => {
  it('returns all-zero stats for empty input', () => {
    const r = computeReadability('');
    expect(r.fleschEase).toBe(0);
    expect(r.gradeLevel).toBe(0);
    expect(r.avgSyllables).toBe(0);
    expect(r.complexWords).toBe(0);
    expect(r.sentences).toBe(0);
    expect(r.label).toBe('—');
  });

  it('handles null/undefined input', () => {
    expect(computeReadability(null).fleschEase).toBe(0);
    expect(computeReadability(undefined).fleschEase).toBe(0);
  });

  it('counts words and sentences', () => {
    const r = computeReadability('The cat sat on the mat.');
    expect(r.sentences).toBe(1);
    expect(r.complexWords).toBe(0); // no 3+ syllable words
    expect(r.avgSyllables).toBeGreaterThan(0);
  });

  it('produces a higher ease score for simple text than complex text', () => {
    const simple = computeReadability('The cat sat on the mat. The dog ran fast.');
    const complex = computeReadability(
      'Notwithstanding the aforementioned circumstances, the institutionalized individuals demonstrated extraordinary intellectual capabilities.',
    );
    expect(simple.fleschEase).toBeGreaterThan(complex.fleschEase);
    expect(complex.complexWords).toBeGreaterThan(simple.complexWords);
  });

  it('strips markdown before counting', () => {
    const plain = computeReadability('hello world');
    const withMd = computeReadability('**hello** _world_');
    // Markdown formatting shouldn't change the word/syllable counts.
    expect(withMd.avgSyllables).toBe(plain.avgSyllables);
    expect(withMd.fleschEase).toBe(plain.fleschEase);
  });

  it('ignores fenced code blocks', () => {
    const r = computeReadability('hello world\n\n```\nconst x = function() {}\n```');
    // Only 'hello world' should count; the code block is stripped.
    expect(r.complexWords).toBe(0);
  });

  it('treats CJK ideographs as 1-syllable words', () => {
    const r = computeReadability('你好世界。');
    expect(r.avgSyllables).toBeGreaterThan(0);
    expect(r.label).toBeTruthy();
  });

  it('returns a label from the ease band', () => {
    const r = computeReadability('The cat sat on the mat.');
    // Simple sentence should land in one of the easy/standard bands.
    expect(['Very easy', 'Easy', 'Standard']).toContain(r.label);
  });

  it('returns a finite grade level in a sane range', () => {
    const r = computeReadability('The cat sat. The dog ran. The bird flew. The fish swam.');
    // Very simple text can legitimately score a negative grade level under
    // Flesch-Kincaid (the formula subtracts a constant). Just assert it's a
    // finite, bounded number rather than a specific sign.
    expect(Number.isFinite(r.gradeLevel)).toBe(true);
    expect(r.gradeLevel).toBeGreaterThan(-20);
    expect(r.gradeLevel).toBeLessThan(50);
  });
});
