// Subsequence fuzzy match — case-insensitive. Returns { score, indices } when
// every char of `query` appears in `text` in order, else null. Score rewards
// prefix matches, contiguous runs, and word boundaries so the most natural
// abbreviation rises to the top. Pure logic, no DOM — unit-tested directly.
export function fuzzyMatch(query, text) {
  if (!query) return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices = [];
  let qi = 0;
  let score = 0;
  let prevMatch = -2;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      indices.push(i);
      // Reward: prefix (i === 0), word boundary (prev char non-alnum), and
      // contiguous matches. Penalize nothing — these bonuses rank naturally.
      if (i === 0) score += 8;
      else if (prevMatch === i - 1) score += 5;
      else if (!/\w/.test(t[i - 1])) score += 4;
      else score += 1;
      qi++;
      prevMatch = i;
    }
  }
  if (qi < q.length) return null; // didn't consume all of query
  return { score, indices };
}
