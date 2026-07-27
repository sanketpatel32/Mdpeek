// Editor autocomplete helpers (v0.41.0). Pure functions — no DOM, no IPC.
// The dropdown view (autocomplete-dropdown.js) calls detectTrigger on every
// input event; if a trigger is active it calls buildCandidates async (sources
// fetched by main.js) and renders the results; on accept it calls
// acceptSuggestion to splice the chosen value into the text.
//
// Three trigger kinds, each fired by a leading character:
//   :foo    → emoji shortcode (matches the EMOJI map keys)
//   [[foo   → wiki-link target (basenames of .md files in the folder)
//   #foo    → tag (free-form; sourced from existing #tags in the workspace)

// Word chars for trigger boundaries. Underscore included so `foo_bar` is one
// token; digits so `#2026` works; `+`/`-` included for emoji like `:+1:`.
const WORD = /[\w+-]/;

// Given the text up to the caret, detect an active trigger. Returns
// { kind, query, start } where `start` is the offset of the trigger char
// (the `:` / `[[` / `#`), or null if no trigger is active.
//
// Rules:
//   emoji: a `:` NOT preceded by a word char or another `:` (so `http://`,
//          `a:b`, and `::` don't fire), followed by 1–60 shortcode chars.
//   wiki:  `[[` with no closing `]]` yet; query is whatever's after `[[`.
//   tag:   `#` at line start or after whitespace, followed by word chars.
export function detectTrigger(textBeforeCaret) {
  if (!textBeforeCaret) return null;
  const caret = textBeforeCaret.length;

  // --- wiki: highest priority, scanned last (rightmost trigger wins below) ---
  // Find the last unclosed `[[`.
  const lastOpen = textBeforeCaret.lastIndexOf('[[');
  if (lastOpen !== -1) {
    const after = textBeforeCaret.slice(lastOpen);
    if (!after.includes(']]')) {
      const query = after.slice(2);
      // Reject if the query contains a newline (multi-line `[[` is malformed)
      // or whitespace (wiki targets don't contain spaces when bare).
      if (!query.includes('\n') && !/\s/.test(query)) {
        return { kind: 'wiki', query, start: lastOpen };
      }
    }
  }

  // --- emoji: scan back from caret for a `:` not preceded by word/`:` ---
  // The shortcode body is `[A-Za-z0-9_+-]`; we walk back until we hit the `:`.
  let i = caret - 1;
  // Skip trailing shortcode chars (the part the user has typed so far).
  while (i >= 0 && WORD.test(textBeforeCaret[i])) i--;
  // `i` now points just before the shortcode body. Need a `:` right there,
  // and that `:` must NOT be preceded by a word char or another `:`.
  if (i >= 0 && textBeforeCaret[i] === ':') {
    const before = textBeforeCaret[i - 1];
    if (i === 0 || (!WORD.test(before) && before !== ':')) {
      const body = textBeforeCaret.slice(i + 1, caret);
      // Body length cap avoids firing on absurdly long runs.
      if (body.length >= 0 && body.length <= 60) {
        return { kind: 'emoji', query: body, start: i };
      }
    }
  }

  // --- tag: `#` at line start or after whitespace, followed by word chars ---
  // Scan back for the `#`.
  let j = caret - 1;
  while (j >= 0 && /\w/.test(textBeforeCaret[j])) j--;
  if (j >= 0 && textBeforeCaret[j] === '#') {
    const beforeHash = textBeforeCaret[j - 1];
    // `#` must be at line start or preceded by whitespace (not `]#`, `.#`, etc.).
    if (j === 0 || /\s/.test(beforeHash)) {
      const body = textBeforeCaret.slice(j + 1, caret);
      if (body.length > 0) {
        return { kind: 'tag', query: body, start: j };
      }
    }
  }

  return null;
}

// Build the candidate list for a trigger. Pure; the caller supplies the
// source data (emoji map, file basenames, tag list) fetched async by main.js.
// Returns an array of { value, display, hint } where:
//   value    — the text to insert (already includes trigger syntax)
//   display  — short label shown in the dropdown
//   hint     — optional secondary text (e.g. the emoji glyph for `:smile:`)
//
// Ranking is deliberately simple: case-insensitive prefix match first, then
// `includes`, then alphabetical. The candidate lists are short; fancy fuzzy
// ranking isn't worth the complexity for v1.
export function buildCandidates(kind, query, sources = {}) {
  const { emojis = {}, files = [], tags = [], limit = 8 } = sources;
  const q = (query || '').toLowerCase();

  if (kind === 'emoji') {
    const keys = Object.keys(emojis);
    const matched = keys
      .filter((k) => !q || k.toLowerCase().startsWith(q))
      .concat(keys.filter((k) => q && k.toLowerCase().includes(q) && !k.toLowerCase().startsWith(q)))
      .filter((k, i, arr) => arr.indexOf(k) === i); // dedupe (starts-with + includes can overlap)
    return matched
      .slice(0, limit)
      .map((k) => ({ value: `:${k}:`, display: `:${k}:`, hint: emojis[k] }));
  }

  if (kind === 'wiki') {
    const matched = files
      .filter((f) => !q || f.toLowerCase().includes(q))
      .slice(0, limit);
    return matched.map((f) => ({ value: `[[${f}]]`, display: f, hint: '.md' }));
  }

  if (kind === 'tag') {
    const matched = tags
      .filter((t) => !q || t.toLowerCase().includes(q))
      .slice(0, limit);
    return matched.map((t) => ({ value: `#${t}`, display: `#${t}`, hint: '' }));
  }

  return [];
}

// Splice the accepted candidate value into the text, replacing the trigger
// range [start, end). Returns { text, caret } where `caret` is the new caret
// position (end of inserted text).
export function acceptSuggestion(text, start, end, value) {
  const next = text.slice(0, start) + value + text.slice(end);
  return { text: next, caret: start + value.length };
}
