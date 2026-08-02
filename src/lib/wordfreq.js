// v0.55.0: Word-frequency analysis — surfaces a document's vocabulary. A
// distinct axis from prose.js: prose highlights mark *hard* (3+-syllable)
// words; this marks *repetitive* words (used 5+ times). The underline pass in
// renderer.js (enhanceWordFreq) consumes overusedWords; the popover view
// consumes topWords.
//
// Pure + DOM-free so it's unit-testable, mirroring prose.js / readability.js.
// The code-skip is STRING-LEVEL here (fenced blocks and inline code are
// stripped before tokenizing) so the underline pass and the popover — which
// both run off the doc's raw markdown — agree on the same word set. The DOM
// pass additionally skips code/tables/callouts at the DOM level so it never
// wraps inside a <pre>.

// A small English stopword list. Intentionally short — we want common glue
// words out of the frequency ranking, but we don't ship a full NLP list.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'in', 'on',
  'at', 'to', 'for', 'with', 'without', 'as', 'by', 'from', 'into', 'onto',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'has', 'have', 'had', 'will', 'would', 'can', 'could', 'should', 'shall',
  'may', 'might', 'must', 'this', 'that', 'these', 'those', 'it', 'its',
  'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'our', 'their', 'so', 'not', 'no', 'yes', 'too', 'very',
  'just', 'also', 'than', 'only', 'any', 'all', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'own', 'same', 'about', 'above', 'below', 'up',
  'down', 'out', 'over', 'under', 'again', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'what', 'which', 'who', 'whom',
]);

// Latin-script word token, allowing internal apostrophes/hyphens (matches the
// extraction in prose.js / readability.js so "well-known" / "don't" stay whole).
const WORD_RE = /[A-Za-z]+(?:['-][A-Za-z]+)*/g;

// Strip fenced code blocks (``` or ~~~) and inline code (`...`) from a markdown
// string. fenced: a run starting at line-start with 3+ backticks/tilde runs to
// the matching closing fence. inline: ` ... ` with no newlines. Both are
// replaced with a single space so word boundaries on either side don't merge.
function stripCode(md) {
  if (!md) return '';
  let s = String(md);
  // Fenced blocks: a line beginning with ``` or ~~~ (with optional language)
  // opens; the next line beginning with the same marker closes. Non-greedy by
  // walking line by line.
  const lines = s.split('\n');
  const out = [];
  let fenceMarker = null;
  for (const ln of lines) {
    if (fenceMarker) {
      if (new RegExp('^\\s*' + fenceMarker + '{3,}').test(ln)) fenceMarker = null;
      continue; // skip block body
    }
    const open = ln.match(/^\s*(`{3,}|~{3,})/);
    if (open) { fenceMarker = open[1][0]; continue; }
    out.push(ln);
  }
  s = out.join('\n');
  // Inline code: ` ... ` (no newline inside). Replaced with a space.
  s = s.replace(/`[^`\n]*`/g, ' ');
  return s;
}

// Strip the markdown syntax characters that would otherwise pollute the tokens
// (heading hashes, emphasis, list markers, link URLs, etc.). Leaves the words
// behind. Conservative — operates on the already-code-stripped string.
function stripMarkdownSyntax(md) {
  if (!md) return '';
  let s = String(md);
  // Reference-style links/images [text][ref] / ![alt][ref] → keep text/alt.
  s = s.replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1');
  // Inline links/images [text](url) / ![alt](url) → keep text/alt.
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Reference definitions [ref]: url "title" → drop entirely.
  s = s.replace(/^\[[^\]]*\]:\s*\S+.*$/gm, '');
  // ATX heading hashes, blockquote markers, list markers, horizontal rules.
  s = s.replace(/^[\s#>]+/gm, '');
  s = s.replace(/^\s*([-*+]|\d+\.)\s+/gm, '');
  s = s.replace(/^[-*_]{3,}\s*$/gm, '');
  // Emphasis/strong markers ** _ ` ~ (the inline-code backticks already went).
  s = s.replace(/[*_~]+/g, '');
  // Emoji shortcodes :name: → drop (so they don't count as words).
  s = s.replace(/:[A-Za-z0-9_+-]+:/g, ' ');
  // Wiki-link [[Target|alias]] / [[Target]] → keep alias or target.
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
    const i = inner.indexOf('|');
    return i >= 0 ? inner.slice(i + 1) : inner;
  });
  // HTML tags → drop.
  s = s.replace(/<[^>]+>/g, ' ');
  return s;
}

// Tokenize a markdown string into lowercased word tokens, ignoring code and a
// stopword list. Returns string[] in document order (so callers can count,
// rank, or scan). CJK-safe: only Latin-script words tokenize, so a CJK-only
// doc returns []. Never throws.
export function tokenize(text) {
  if (!text) return [];
  const cleaned = stripMarkdownSyntax(stripCode(text));
  const out = [];
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(cleaned)) !== null) {
    const w = m[0].toLowerCase();
    if (w.length < 2) continue;           // drop single letters
    if (STOPWORDS.has(w)) continue;       // drop glue words
    out.push(w);
  }
  return out;
}

// Count word frequencies. Returns a Map<word, count> sorted descending by count
// (ties broken alphabetically so output is deterministic). `min` filters out
// words used fewer than `min` times.
export function wordFrequencies(text, { min = 1 } = {}) {
  const tokens = tokenize(text);
  const counts = new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  const entries = [...counts.entries()].filter(([, c]) => c >= min);
  entries.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return new Map(entries);
}

// Words used `threshold` or more times. Returns a Set<string>. Drives the
// underline pass — these are the repetitive words worth flagging.
export function overusedWords(text, { threshold = 5 } = {}) {
  const freq = wordFrequencies(text, { min: threshold });
  return new Set([...freq.keys()]);
}

// Top-N words by frequency, as [{ word, count }]. For the popover. Caps at
// `limit`; default 20. Empty array for empty/code-only docs.
export function topWords(text, { limit = 20 } = {}) {
  const freq = wordFrequencies(text);
  const n = Math.max(0, Math.floor(Number(limit) || 0));
  return [...freq.entries()].slice(0, n).map(([word, count]) => ({ word, count }));
}

// Find whole-word, case-insensitive occurrences in `text` of any word in
// `wordSet`. Returns [{ start, end }] offsets (half-open), left-to-right,
// non-overlapping. Matches must sit on word boundaries (a-z only at edges) so
// "exception" doesn't match inside "exceptionally". Powers the underline DOM
// pass — kept pure + DOM-free so the matching is unit-testable.
export function findWordsInText(text, wordSet) {
  if (!text || !wordSet || wordSet.size === 0) return [];
  const out = [];
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(text)) !== null) {
    if (wordSet.has(m[0].toLowerCase())) {
      out.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}
