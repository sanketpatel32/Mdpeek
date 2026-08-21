// v0.51.0: Line-level diff for the snapshot-diff view.
//
// Implements the classic LCS (longest-common-subsequence) dynamic-programming
// diff: O(n·m) time + space, which is fine for per-document snapshots (bounded,
// human-sized texts). Pure + DOM-free → unit-tested. Non-throwing on empty or
// null input. The output is a flat list of aligned rows so a viewer can render
// two side-by-side panes that stay lined up.
//
// Row shapes:
//   { type: 'equal', oldLine, newLine, text } — unchanged line (present on both)
//   { type: 'add',   newLine, text }          — line only in the new version
//   { type: 'del',   oldLine, text }          — line only in the old version
// oldLine / newLine are 1-indexed line numbers in their respective versions
// (undefined when the row is absent from that side).

// Split text into lines WITHOUT keeping a trailing empty string for a
// terminal newline — that way "a\n" and "a" both diff as one line. A truly
// empty string diffs as zero lines.
function toLines(text) {
  if (!text) return [];
  const s = String(text).replace(/\r\n/g, '\n');
  if (s === '') return [];
  // A trailing newline indicates the line ends there; drop the empty element it
  // would otherwise produce, so {"a\n","a"} are equal.
  const parts = s.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '' && s.endsWith('\n')) {
    parts.pop();
  }
  return parts;
}

// Compute the LCS DP table dimensions (m+1 × n+1) where cell [i][j] holds the
// length of the LCS of oldLines[0..i) and newLines[0..j).
function lcsTable(a, b) {
  const m = a.length;
  const n = b.length;
  // Build with Uint32Array rows for a smaller footprint on large docs.
  const dp = new Array(m + 1);
  for (let i = 0; i <= m; i++) dp[i] = new Uint32Array(n + 1);
  for (let i = m - 1; i >= 0; i--) {
    const row = dp[i];
    const next = dp[i + 1];
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        row[j] = 1 + next[j + 1];
      } else {
        row[j] = next[j] >= dp[i][j + 1] ? next[j] : dp[i][j + 1];
      }
    }
  }
  return dp;
}

// Diff two texts line-by-line. Returns { rows, stats } where stats is
// { added, removed } (line counts). Pure; never throws.
export function diffLines(oldText, newText, { ignoreWhitespace = false } = {}) {
  const a = toLines(oldText);
  const b = toLines(newText);
  // v0.67.0: optionally compare whitespace-normalized keys so pure reindents
  // / trailing spaces don't flood the diff. Emitted rows keep the original
  // text; only equality uses the keys.
  const key = (l) => (ignoreWhitespace ? l.replace(/\s+/g, ' ').trim() : l);
  const ak = a.map(key);
  const bk = b.map(key);
  const m = a.length;
  const n = b.length;
  const dp = lcsTable(ak, bk);
  const rows = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  // Walk the DP table from the top-left, emitting rows in document order.
  // Emit deletions before additions at a given divergence so the viewer reads
  // naturally (old text removed, then new text inserted).
  while (i < m && j < n) {
    if (ak[i] === bk[j]) {
      rows.push({ type: 'equal', oldLine: i + 1, newLine: j + 1, text: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', oldLine: i + 1, text: a[i] });
      i++;
      removed++;
    } else {
      rows.push({ type: 'add', newLine: j + 1, text: b[j] });
      j++;
      added++;
    }
  }
  while (i < m) {
    rows.push({ type: 'del', oldLine: i + 1, text: a[i] });
    i++;
    removed++;
  }
  while (j < n) {
    rows.push({ type: 'add', newLine: j + 1, text: b[j] });
    j++;
    added++;
  }
  return { rows, stats: { added, removed } };
}

// Format a diff's added/removed counts as a compact header string, e.g.
// "+12 −3" (uses the minus sign U+2212 for a tidy glyph). Returns 'no changes'
// when nothing was added or removed.
export function formatDiffStats(stats) {
  if (!stats) return 'no changes';
  const { added, removed } = stats;
  if (added === 0 && removed === 0) return 'no changes';
  const parts = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`\u2212${removed}`);
  return parts.join(' ');
}
