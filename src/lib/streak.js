// v0.55.0: Writing-day streak — a tiny reward loop for the capture / daily-note
// workflow. Any day the user edits/saves a daily note OR fires quick-capture
// counts as a "writing day." Consecutive days build a streak shown as a 🔥 N
// chip in the existing status bar (zero new chrome).
//
// Pure + DOM-free, mirroring sessions.js / templates.js: all functions take an
// explicit `store` ({ getItem, setItem }) so they're testable without global
// localStorage. Day stamps are local-time ISO dates (YYYY-MM-DD), matching the
// daily-note idiom in dates.js. Malformed JSON recovers to an empty set (never
// throws).

export const STREAK_KEY = 'mdpeek-writing-days';

const SHIM = {
  getItem() { return null; },
  setItem() {},
};

// Day stamp in local time as "YYYY-MM-DD" (matches dates.dateStamp). Kept local
// so a writing day tracks the user's clock, not UTC.
function dayStamp(now) {
  const d = now instanceof Date ? now : new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Read the persisted set of writing-day stamps. Always returns a Set<string>,
// recovering to empty on corrupt/missing storage.
function readSet(store) {
  const raw = store.getItem(STREAK_KEY);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((s) => typeof s === 'string' && s));
  } catch {
    return new Set();
  }
}

function persist(store, set) {
  try { store.setItem(STREAK_KEY, JSON.stringify([...set])); }
  catch { /* storage full or disabled — ignore */ }
  return set;
}

// Record `now`'s day as a writing day. Idempotent for the same day (calling
// twice in one day adds one stamp). Persists to `store` and returns the updated
// Set (so callers/tests can inspect without a fresh read).
export function markWritingDay(store = SHIM, now = Date.now()) {
  const set = readSet(store);
  set.add(dayStamp(now));
  persist(store, set);
  return set;
}

// Count of consecutive writing days ending at `now`. Anchors on today if today
// is a writing day; otherwise anchors on *yesterday* so the visible streak
// doesn't drop to 0 at 00:01 before the user has written today. Returns 0 when
// there's no streak (no days, or a gap before the anchor).
export function currentStreak(store = SHIM, now = Date.now()) {
  const set = readSet(store);
  const today = dayStamp(now);
  let cursor;
  if (set.has(today)) {
    cursor = new Date(now);
  } else {
    // Anchor on yesterday so the streak survives the midnight rollover until a
    // new writing day is recorded.
    cursor = new Date(now);
    cursor.setDate(cursor.getDate() - 1);
  }
  let count = 0;
  // Walk backwards day by day while consecutive stamps exist.
  // Guard against an infinite loop on a pathological clock with an absolute cap.
  for (let i = 0; i < 100000; i++) {
    const stamp = dayStamp(cursor);
    if (!set.has(stamp)) break;
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

// Longest run of consecutive writing days ever recorded. Walks the stamps in
// ascending order, tracking the current run length and the best seen. Returns 0
// for an empty store.
export function bestStreak(store = SHIM) {
  const set = readSet(store);
  if (set.size === 0) return 0;
  const sorted = [...set].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const cur = new Date(sorted[i]);
    prev.setDate(prev.getDate() + 1);
    if (dayStamp(prev) === sorted[i]) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
}

// Format the streak as a status-bar chip. Returns '' for 0/1 (no chip — the
// streak only surfaces once it's actually a streak of 2+), and '🔥 N' otherwise.
export function formatStreakChip(streak) {
  const n = Math.max(0, Math.floor(Number(streak) || 0));
  if (n < 2) return '';
  return `🔥 ${n}`;
}
