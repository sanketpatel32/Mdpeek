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
