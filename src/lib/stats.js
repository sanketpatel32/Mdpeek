// v0.45.0: Document statistics for the stats side panel.
//
// Extends wordCount (which only does words/chars/read-time) with paragraphs,
// sentences, average sentence length, estimated speaking time, and a count of
// "long" words (6+ chars — a rough proxy for reading difficulty). Pure +
// DOM-free so it's unit-testable. Reuses stripMarkdown so the same regex
// pipeline backs wordCount, copy-as-plain-text, and this panel.
import { stripMarkdown } from './strip.js';

// Reading rate (words per minute) for silent reading. Matches the 200 wpm
// used by wordCount so the status-bar chip and this panel agree.
const READ_WPM = 200;
// Speaking rate is slower than reading — presentations, narration, audiobook
// pacing. 130 wpm is the commonly cited average for English aloud.
const SPEAK_WPM = 130;

export function computeStats(text) {
  const src = text || '';
  const stripped = stripMarkdown(src);
  // Latin words = runs of word chars (incl. accented + apostrophes/hyphens).
  // Exclude CJK ranges so each CJK ideograph is counted once (by the cjk
  // branch below), not bundled into a latin word.
  const latin = (stripped.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || [])
    .filter((w) => !/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(w));
  const cjk = (stripped.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) || []);
  const words = latin.length + cjk.length;
  const chars = src.replace(/\s/g, '').length;
  // Paragraphs: non-empty blocks separated by a blank line. Empty input → 0.
  const paragraphs = src.split(/\n\s*\n/).filter((b) => b.trim().length > 0).length;
  // Sentences: count terminal-punctuation runs. Crude but fine for a stat
  // panel (abbreviations like "Dr." will over-count slightly).
  const sentencePunct = (stripped.match(/[.!?]+/g) || []).length;
  const sentences = sentencePunct > 0 ? sentencePunct : (words > 0 ? 1 : 0);
  const avgWordsPerSentence = sentences > 0 ? Math.round((words / sentences) * 10) / 10 : 0;
  // Long words: 6+ chars in the latin word list (CJK ideographs don't apply).
  const longWords = latin.filter((w) => w.length >= 6).length;
  const readMins = words > 0 ? Math.max(1, Math.round(words / READ_WPM)) : 0;
  const speakMins = words > 0 ? Math.max(1, Math.round(words / SPEAK_WPM)) : 0;
  return { words, chars, paragraphs, sentences, avgWordsPerSentence, longWords, readMins, speakMins };
}
