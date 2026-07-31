// v0.53.0: Prose-difficulty analysis for the "highlight hard-to-read prose"
// feature. Pure + DOM-free so it can be unit-tested, mirroring readability.js.
// Reuses countSyllables from readability.js so "complex" means the same thing
// here (3+ syllables) as it does in the stats panel.
//
// Two responsibilities: locating complex words in a text string (so the DOM
// pass can wrap them), and deciding whether a whole paragraph is "dense" (so
// the DOM pass can tint it). Both are deliberately conservative — for a
// visual highlight, false positives are more annoying than false negatives.

import { countSyllables } from './readability.js';

// Minimum word count before a paragraph can be considered "dense". Below this,
// even a jargon-heavy paragraph isn't worth tinting (it reads as a label or a
// short note). Tuned to keep headings and bullet fragments clear.
const DENSE_MIN_WORDS = 12;
// A paragraph is dense if it's long-winded OR jargon-heavy (both relative to
// its word count). These thresholds are intentionally high so only genuinely
// hard paragraphs tint.
const DENSE_AVG_WORDS_PER_SENTENCE = 24;
const DENSE_COMPLEX_RATIO = 0.20;

// A Latin-script word token, allowing internal apostrophes/hyphens (so
// "don't", "well-known" count as single words). Matches the extraction in
// readability.js / stats.js.
const WORD_RE = /[A-Za-z]+(?:['-][A-Za-z]+)*/g;

// Does `word` count as complex (hard to read)? 3+ syllables, matching the
// readability panel's "Complex words (3+ syl)" metric. Non-Latin tokens
// (numbers, CJK, punctuation) are never complex here.
export function isComplexWord(word) {
  if (!word) return false;
  const w = String(word);
  // Must be a real Latin word (the syllable counter already strips non-letters,
  // but a bare number like "123" would otherwise count as 1 syllable and slip
  // through if we didn't guard — guard explicitly).
  if (!/^[A-Za-z]+(?:['-][A-Za-z]+)*$/.test(w)) return false;
  return countSyllables(w) >= 3;
}

// Find complex words in a plain-text string. Returns absolute { start, end }
// offsets into the string (half-open end), left-to-right, non-overlapping.
// Non-word characters naturally separate matches. Empty/whitespace → [].
export function findComplexWords(text) {
  const src = text || '';
  const out = [];
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(src)) !== null) {
    if (isComplexWord(m[0])) {
      out.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}

// Is this paragraph dense / hard to read? Conservative: requires a minimum
// word count AND (long average sentence length OR a high complex-word ratio).
// Empty / whitespace / CJK-only text is never dense. Never throws.
export function isDenseParagraph(text) {
  const src = text || '';
  WORD_RE.lastIndex = 0;
  const words = src.match(WORD_RE) || [];
  if (words.length < DENSE_MIN_WORDS) return false;
  let complex = 0;
  for (const w of words) if (isComplexWord(w)) complex += 1;
  // Sentence count: terminal punctuation runs (same crude estimate as the
  // rest of the app). Min 1 if there are words but no terminal punctuation.
  const punct = (src.match(/[.!?]+/g) || []).length;
  const sentences = punct > 0 ? punct : 1;
  const avgWordsPerSentence = words.length / sentences;
  const complexRatio = complex / words.length;
  return avgWordsPerSentence > DENSE_AVG_WORDS_PER_SENTENCE || complexRatio > DENSE_COMPLEX_RATIO;
}
