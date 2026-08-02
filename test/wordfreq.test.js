import { describe, it, expect } from 'vitest';
import {
  tokenize,
  wordFrequencies,
  overusedWords,
  topWords,
  findWordsInText,
} from '../src/lib/wordfreq.js';

describe('tokenize', () => {
  it('returns [] for empty / whitespace / non-string input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
    expect(tokenize('   \n\n')).toEqual([]);
  });

  it('lowercases tokens', () => {
    expect(tokenize('Hello WORLD Foo')).toEqual(['hello', 'world', 'foo']);
  });

  it('strips markdown punctuation and syntax', () => {
    // heading hashes, emphasis, list marker → plain words remain.
    expect(tokenize('# Heading\n\n- **bold** and _italic_')).toEqual(['heading', 'bold', 'italic']);
  });

  it('drops the stopword list (the, a, and, is, …)', () => {
    const out = tokenize('the cat and the dog are friends');
    expect(out).toEqual(['cat', 'dog', 'friends']);
  });

  it('drops single letters (length < 2)', () => {
    expect(tokenize('a x y z real words')).toEqual(['real', 'words']);
  });

  it('keeps hyphenated and apostrophe words whole', () => {
    expect(tokenize("well-known don't state-of-the-art")).toEqual(['well-known', "don't", 'state-of-the-art']);
  });

  it('skips fenced code blocks entirely', () => {
    const md = 'prose words\n\n```js\nconst utilized = "code word";\n```\n\nextra prose';
    const out = tokenize(md);
    expect(out).toEqual(['prose', 'words', 'extra', 'prose']);
  });

  it('skips tildes fenced blocks too', () => {
    const md = 'prose\n~~~\ncode word\n~~~\nprose';
    expect(tokenize(md)).toEqual(['prose', 'prose']);
  });

  it('skips inline code spans', () => {
    expect(tokenize('the `codeword` visible words')).toEqual(['visible', 'words']);
  });

  it('keeps link text but drops the URL', () => {
    expect(tokenize('[link text](http://example.com/page)')).toEqual(['link', 'text']);
  });

  it('keeps image alt text', () => {
    expect(tokenize('![alt words](img.png)')).toEqual(['alt', 'words']);
  });

  it('keeps wiki-link alias (or target when no alias)', () => {
    expect(tokenize('[[Some Note|display words]]')).toEqual(['display', 'words']);
    expect(tokenize('[[Target Note]]')).toEqual(['target', 'note']);
  });

  it('drops HTML tags', () => {
    expect(tokenize('<p class="x">real words</p>')).toEqual(['real', 'words']);
  });

  it('drops emoji shortcodes', () => {
    expect(tokenize(':smile: happy thoughts')).toEqual(['happy', 'thoughts']);
  });

  it('is CJK-safe (returns [] for CJK-only prose)', () => {
    expect(tokenize('这是一些中文没有拉丁词')).toEqual([]);
  });

  it('keeps document order', () => {
    expect(tokenize('alpha beta gamma delta')).toEqual(['alpha', 'beta', 'gamma', 'delta']);
  });
});

describe('wordFrequencies', () => {
  it('counts occurrences and sorts descending by count', () => {
    const freq = wordFrequencies('apple apple apple banana banana cherry');
    expect([...freq.entries()]).toEqual([
      ['apple', 3],
      ['banana', 2],
      ['cherry', 1],
    ]);
  });

  it('breaks count ties alphabetically (deterministic)', () => {
    const freq = wordFrequencies('zebra mango mango zebra');
    // Both count 2; alphabetical → mango first.
    expect([...freq.entries()]).toEqual([['mango', 2], ['zebra', 2]]);
  });

  it('honors the `min` filter', () => {
    const freq = wordFrequencies('solo solo solo once twice twice', { min: 2 });
    expect([...freq.entries()]).toEqual([['solo', 3], ['twice', 2]]);
  });

  it('lowercases before counting (Apple/apple/APPLE merge)', () => {
    const freq = wordFrequencies('Apple apple APPLE');
    expect(freq.get('apple')).toBe(3);
  });

  it('returns an empty map for empty input', () => {
    expect(wordFrequencies('').size).toBe(0);
  });
});

describe('overusedWords', () => {
  it('returns the set of words at/above the threshold', () => {
    const md = 'alpha alpha alpha alpha alpha beta beta beta gamma';
    expect(overusedWords(md)).toEqual(new Set(['alpha']));
  });

  it('threshold is inclusive (exactly N counts)', () => {
    const md = 'alpha alpha alpha alpha alpha'; // 5 occurrences
    expect(overusedWords(md, { threshold: 5 })).toEqual(new Set(['alpha']));
  });

  it('respects a custom threshold', () => {
    const md = 'apple apple apple banana banana';
    expect(overusedWords(md, { threshold: 2 })).toEqual(new Set(['apple', 'banana']));
    expect(overusedWords(md, { threshold: 3 })).toEqual(new Set(['apple']));
  });

  it('returns an empty set when nothing reaches the threshold', () => {
    expect(overusedWords('alpha beta gamma').size).toBe(0);
  });

  it('ignores code-block repetitions', () => {
    const md = '```\nrepeat repeat repeat repeat repeat\n```\nprose here';
    // The 5x "repeat" is inside a fence → ignored.
    expect(overusedWords(md).size).toBe(0);
  });
});

describe('topWords', () => {
  it('returns [{word, count}] ranked, capped at limit', () => {
    const md = 'one one one two two two two three three';
    expect(topWords(md, { limit: 2 })).toEqual([
      { word: 'two', count: 4 },
      { word: 'one', count: 3 },
    ]);
  });

  it('default limit is 20', () => {
    // 30 distinct all-letter words (digits would be stripped, collapsing them).
    const md = Array.from({ length: 30 }, (_, i) => 'w' + 'a'.repeat(i + 1)).join(' ');
    expect(topWords(md).length).toBe(20);
  });

  it('returns [] for empty / code-only docs', () => {
    expect(topWords('')).toEqual([]);
    expect(topWords('```\ncode only\n```')).toEqual([]);
  });

  it('does not include stopwords', () => {
    const md = 'the the the the the the apple';
    // "the" is a stopword even though it's the most frequent.
    expect(topWords(md)).toEqual([{ word: 'apple', count: 1 }]);
  });
});

describe('findWordsInText', () => {
  it('returns [] for empty text or empty set', () => {
    expect(findWordsInText('', new Set(['x']))).toEqual([]);
    expect(findWordsInText('words', new Set())).toEqual([]);
    expect(findWordsInText(null, new Set(['x']))).toEqual([]);
  });

  it('finds whole-word matches (case-insensitive)', () => {
    expect(findWordsInText('Apple apple APPLE banana', new Set(['apple'])))
      .toEqual([{ start: 0, end: 5 }, { start: 6, end: 11 }, { start: 12, end: 17 }]);
  });

  it('does NOT match inside a larger word (word-boundary guard)', () => {
    // "exception" should not match inside "exceptionally".
    expect(findWordsInText('exceptionally exceptional', new Set(['exception'])))
      .toEqual([]); // "exceptionally" and "exceptional" are different whole words
  });

  it('returns offsets left-to-right, non-overlapping', () => {
    // 'cat dog cat bird cat' → cat@0-3, cat@8-11, cat@17-20
    const out = findWordsInText('cat dog cat bird cat', new Set(['cat']));
    expect(out).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
      { start: 17, end: 20 },
    ]);
  });

  it('matches multiple distinct words in the set', () => {
    const out = findWordsInText('cat dog bird', new Set(['cat', 'bird']));
    expect(out).toEqual([{ start: 0, end: 3 }, { start: 8, end: 12 }]);
  });

  it('handles hyphenated/apostrophe words exactly as tokenized', () => {
    expect(findWordsInText("well-known and don't", new Set(["well-known", "don't"])))
      .toEqual([{ start: 0, end: 10 }, { start: 15, end: 20 }]);
  });
});
