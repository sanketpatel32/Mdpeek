// v0.50.0: Readability scoring for the stats panel.
//
// Computes the Flesch Reading Ease + Flesch-Kincaid Grade Level scores from a
// markdown string. Pure + DOM-free so it can be unit-tested, mirroring
// computeStats / computeInsights in stats.js. Reuses stripMarkdown so the same
// regex pipeline backs every text-analysis feature.
//
// The one genuinely new tokenizer is syllable counting (countSyllables), which
// uses the well-established vowel-cluster + silent-e heuristic. CJK ideographs
// contribute 1 syllable each (they're counted as one word each by computeStats,
// and each represents a spoken morpheme), matching how the rest of the app
// treats CJK. Non-throwing on empty / malformed input.

import { stripMarkdown } from './strip.js';

// Count vowel groups in a lowercased word as a syllable estimate. The classic
// heuristic: each run of consecutive vowels is one syllable, a trailing silent
// "e" doesn't count, and every word has at least one syllable.
//
//   countSyllables('hello')   → 2
//   countSyllables('world')   → 1
//   countSyllables('ate')     → 1   (trailing e is silent)
//   countSyllables('tree')    → 1   (vowel cluster 'ee' = one beat)
//   countSyllables('')        → 0
export function countSyllables(word) {
  if (!word) return 0;
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  // Each run of vowels is one syllable beat.
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 0;
  // Subtract a trailing silent 'e' (e.g. "name" → 1, not 2), but never below 1.
  if (n > 1 && w.endsWith('e')) n -= 1;
  return Math.max(1, n);
}

// Map a Flesch Reading Ease score (0–100, higher = easier) to a qualitative
// label using the standard Flesch bands. Exported for unit testing.
export function easeLabel(ease) {
  if (ease >= 90) return 'Very easy';
  if (ease >= 70) return 'Easy';
  if (ease >= 60) return 'Standard';
  if (ease >= 50) return 'Fairly difficult';
  if (ease >= 30) return 'Difficult';
  return 'Very confusing';
}

// Compute Flesch Reading Ease + Flesch-Kincaid Grade Level for a markdown doc.
//
// Returns { fleschEase, gradeLevel, avgSyllables, complexWords, sentences, label }:
//   - fleschEase    : Flesch Reading Ease (0–100, rounded). Higher = easier.
//   - gradeLevel    : Flesch-Kincaid U.S. grade level (rounded to 1 dp).
//   - avgSyllables  : average syllables per word (1 dp).
//   - complexWords  : count of 3+ syllable words (a difficulty proxy).
//   - sentences     : sentence count (terminal punctuation; min 1 if any words).
//   - label         : qualitative ease band (easeLabel).
//
// Returns all-zero stats for empty / whitespace-only input (never throws).
export function computeReadability(text) {
  const src = text || '';
  const stripped = stripMarkdown(src);
  // Latin words — same CJK-aware extraction as computeStats. CJK ideographs are
  // counted separately and contribute 1 syllable each.
  const latin = (stripped.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || [])
    .filter((w) => !/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(w));
  const cjk = (stripped.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) || []);
  const words = latin.length + cjk.length;
  if (words === 0) {
    return { fleschEase: 0, gradeLevel: 0, avgSyllables: 0, complexWords: 0, sentences: 0, label: '—' };
  }
  // Syllables: sum over latin words + 1 per CJK ideograph.
  let syllables = 0;
  let complexWords = 0;
  for (const w of latin) {
    const s = countSyllables(w);
    syllables += s;
    if (s >= 3) complexWords += 1;
  }
  syllables += cjk.length;
  // Sentences: terminal punctuation runs (same crude estimate as computeStats).
  const sentencePunct = (stripped.match(/[.!?]+/g) || []).length;
  const sentences = sentencePunct > 0 ? sentencePunct : 1;
  const wordsPerSentence = words / sentences;
  const syllablesPerWord = syllables / words;
  // Flesch Reading Ease: 206.835 − 1.015×(words/sentences) − 84.6×(syllables/words)
  const fleschEase = Math.round((206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord) * 10) / 10;
  // Flesch-Kincaid Grade Level: 0.39×(words/sentences) + 11.8×(syllables/words) − 15.59
  const gradeLevel = Math.round((0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59) * 10) / 10;
  const avgSyllables = Math.round(syllablesPerWord * 100) / 100;
  return { fleschEase, gradeLevel, avgSyllables, complexWords, sentences, label: easeLabel(fleschEase) };
}
