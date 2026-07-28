// v0.44.0: word-count goal for the status bar.
//
// Tiny pure helper: given the current word count and a goal, compute the
// progress. The "session" concept snapshots the word count at goal-set time so
// progress reflects *new* words written toward the goal, not the doc's total —
// matching how iA Writer / Scrivener frame it.
//
// localStorage keys (the orchestrator in main.js owns persistence):
//   GOAL_KEY        = 'mdpeek-writing-goal'      → stringified integer goal
//   SESSION_KEY     = 'mdpeek-writing-session'   → stringified word count at set time

export const GOAL_KEY = 'mdpeek-writing-goal';
export const SESSION_KEY = 'mdpeek-writing-session';

// Returns null when there's no goal (or it's invalid), so the caller can skip
// rendering the chip entirely. Otherwise:
//   { words, sessionWords, goal, written, pct, remaining, done }
// `written` = max(0, words - sessionWords) — never negative (deletes below
// session start shouldn't show negative progress). `pct` is clamped to [0,100].
export function goalProgress(words, goal, sessionWords = 0) {
  const g = Number(goal);
  if (!Number.isFinite(g) || g <= 0) return null;
  const w = Math.max(0, Number(words) || 0);
  const sw = Math.max(0, Number(sessionWords) || 0);
  const written = Math.max(0, w - sw);
  const pct = Math.min(100, Math.round((written / g) * 100));
  return {
    words: w,
    sessionWords: sw,
    goal: g,
    written,
    pct,
    remaining: Math.max(0, g - written),
    done: written >= g,
  };
}

// Format a progress object as a short status-bar chip string.
// "312 / 500 (62%)"  →  done when pct≥100.
export function formatGoalChip(p) {
  if (!p) return '';
  return `${p.written} / ${p.goal} (${p.pct}%)`;
}
