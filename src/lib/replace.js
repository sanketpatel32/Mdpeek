// Pure substitution engine for project-wide find & replace. No DOM, no IPC —
// fully unit-testable. The same functions power the live preview, so preview
// and actual replace can never diverge.
//
// Matching is plain substring (mirrors the existing `search_in_folder` Rust
// command) with a case-sensitive toggle. Offsets are code-point based, so
// multibyte and astral-plane characters (emoji) are handled correctly.

// Find every occurrence of `query` in `content`. Returns match offsets
// [{ start, end }, ...] in code-point coordinates. Non-overlapping,
// left-to-right: after a match at [start, end), the next search begins at
// `end`. An empty query returns [] (nothing to find).
export function findAllMatches(content, query, { caseSensitive }) {
  if (!query) return [];
  const hay = caseSensitive ? content : content.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches = [];
  let from = 0;
  while (from <= hay.length) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1) break;
    matches.push({ start: idx, end: idx + needle.length });
    // Advance past this match so overlapping matches (e.g. "aa" in "aaaa")
    // are not double-counted.
    from = idx + needle.length;
  }
  return matches;
}

// Replace every occurrence of `query` with `replacement` in `content`.
// Returns { result, count }. Reuses findAllMatches so the matching rules
// (case-sensitivity, overlap-safety) are identical. The replacement text is
// inserted verbatim — it is never re-scanned, so a replacement that contains
// the query cannot cause an infinite loop.
export function applyReplacements(content, query, replacement, { caseSensitive }) {
  const matches = findAllMatches(content, query, { caseSensitive });
  if (matches.length === 0) return { result: content, count: 0 };
  // Walk matches left-to-right, splicing into a fresh string. Because matches
  // are non-overlapping and we track an output cursor, earlier offsets stay
  // valid as we build the result.
  let out = '';
  let cursor = 0;
  for (const m of matches) {
    out += content.slice(cursor, m.start) + replacement;
    cursor = m.end;
  }
  out += content.slice(cursor);
  return { result: out, count: matches.length };
}
