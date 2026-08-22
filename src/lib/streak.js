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
    // Parse as LOCAL midnight — new Date('YYYY-MM-DD') is UTC, which lands on
    // the prior local day west of UTC and breaks the +1-day comparison below.
    const [py, pm, pd] = sorted[i - 1].split('-').map(Number);
    const prev = new Date(py, pm - 1, pd);
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

// --- UI polish (presentation only — never mutates stored writing days) ----
// Flame intensity by streak length, a today-dot ring, and milestone badge
// chips for the status-bar chip. Shares the pill language with the pomodoro/
// goal polish: 999px radius, --shadow-sm lift, --dur-*/--ease-* timing,
// hairline color-mix borders. All motion is prefers-reduced-motion guarded.

/** Style-element id used by the id-guarded injection (test/debug hook). */
export const STREAK_STYLE_ID = 'mdpeek-streak-polish-style';

/** Streak lengths that award a badge chip (highest reached wins). */
export const STREAK_MILESTONES = [7, 30, 100];

/**
 * Intensity tier for a streak length. Pure + testable.
 *   none   0–1   (chip hidden anyway)
 *   ember  2–6    (small flame, dimmed)
 *   flame  7–29   (warm glow)
 *   blaze  30+    (bright glow + idle flicker)
 */
export function streakTier(streak) {
  const n = Math.max(0, Math.floor(Number(streak) || 0));
  if (n >= 30) return 'blaze';
  if (n >= 7) return 'flame';
  if (n >= 2) return 'ember';
  return 'none';
}

/**
 * Highest milestone badge reached, or null below 7 days. Pure + testable:
 *   { days: 30, label: '30-day', metal: 'silver' }
 */
export function streakBadge(streak) {
  const n = Math.max(0, Math.floor(Number(streak) || 0));
  let badge = null;
  for (const days of STREAK_MILESTONES) {
    if (n >= days) {
      badge = { days, label: `${days}-day`, metal: days >= 100 ? 'gold' : days >= 30 ? 'silver' : 'bronze' };
    }
  }
  return badge;
}

/**
 * Rich chip inner markup: intensity-tiered flame, count, today-dot ring, and
 * milestone badge. `opts.today` drives the dot: true → filled (written
 * today), false → hollow dashed ring (streak at risk until midnight),
 * undefined → dot omitted (caller doesn't know). Returns '' below 2 days to
 * match formatStreakChip's earn-its-place rule.
 */
export function streakChipInnerHtml(streak, opts = {}) {
  const n = Math.max(0, Math.floor(Number(streak) || 0));
  if (n < 2) return '';
  const tier = streakTier(n);
  let html = `<span class="streak-flame" aria-hidden="true">🔥</span><span class="streak-count">${n}</span>`;
  if (opts.today === true) {
    html += '<span class="streak-today-dot" title="Written today" aria-label="Written today"></span>';
  } else if (opts.today === false) {
    html += '<span class="streak-today-dot is-off" title="Not written today yet" aria-label="Not written today yet"></span>';
  }
  const badge = opts.badge !== undefined ? opts.badge : streakBadge(n);
  if (badge && !opts.noBadge) {
    html += `<span class="streak-badge streak-badge-${badge.metal}">${badge.label}</span>`;
  }
  // Tier lands on the host element via applyStreakChipPresentation; expose it
  // here too so string-render callers can add `tier-${tier}` themselves.
  void tier;
  return html;
}

/**
 * Upgrade a rendered `.status-streak` chip in place: sets the intensity tier
 * class and swaps in the rich inner markup. Idempotent per element instance.
 *   applyStreakChipPresentation(el, currentStreak(), { today: wroteToday })
 */
export function applyStreakChipPresentation(chipEl, streak, opts = {}) {
  if (!chipEl || typeof document === 'undefined') return null;
  ensureStreakStyles();
  const n = Math.max(0, Math.floor(Number(streak) || 0));
  const tier = streakTier(n);
  chipEl.classList.add('status-streak-rich', `tier-${tier}`);
  chipEl.innerHTML = streakChipInnerHtml(n, opts);
  return tier;
}

/**
 * Inject the streak-chip stylesheet once. Idempotent (id-guarded), DOM-safe.
 */
export function ensureStreakStyles() {
  if (typeof document === 'undefined' || document.getElementById(STREAK_STYLE_ID)) return false;
  const style = document.createElement('style');
  style.id = STREAK_STYLE_ID;
  style.textContent = `
    /* Flame intensity ramp — longer streaks literally burn brighter. Metals
       mix over theme surfaces so badges stay legible in every theme. */
    .status-streak .streak-flame {
      display: inline-block;
      margin-right: 2px;
      transform-origin: 50% 80%;
      transition: filter var(--dur-3, 240ms) var(--ease-out, ease-out);
    }
    .status-streak.tier-ember .streak-flame {
      opacity: 0.7;
      transform: scale(0.85);
      filter: saturate(0.7);
    }
    .status-streak.tier-flame .streak-flame {
      filter: drop-shadow(0 0 3px color-mix(in srgb, #ff9d2e 45%, transparent));
    }
    .status-streak.tier-blaze .streak-flame {
      filter: drop-shadow(0 0 4px color-mix(in srgb, #ff9d2e 65%, transparent)) saturate(1.15);
    }
    /* Today-dot ring: solid green once today is banked… */
    .status-streak .streak-today-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      margin-left: 5px;
      border-radius: 50%;
      vertical-align: 1px;
      background: var(--success);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--success) 22%, transparent);
    }
    /* …hollow dashed while today is unwritten — the streak is at risk. */
    .status-streak .streak-today-dot.is-off {
      background: transparent;
      border: 1.5px dashed var(--fg-muted);
      box-shadow: none;
    }
    /* Milestone badge chips: tiny metal coins beside the count. */
    .status-streak .streak-badge {
      display: inline-block;
      margin-left: 5px;
      padding: 0 5px;
      border-radius: 999px;
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.02em;
      line-height: 14px;
      vertical-align: 1px;
      border: 1px solid;
    }
    .status-streak .streak-badge-bronze {
      color: #a86a2a;
      border-color: color-mix(in srgb, #cd7f32 55%, transparent);
      background: color-mix(in srgb, #cd7f32 16%, transparent);
    }
    .status-streak .streak-badge-silver {
      color: #66707d;
      border-color: color-mix(in srgb, #9aa5b1 60%, transparent);
      background: color-mix(in srgb, #9aa5b1 18%, transparent);
    }
    .status-streak .streak-badge-gold {
      color: #96741d;
      border-color: color-mix(in srgb, #d4af37 55%, transparent);
      background: color-mix(in srgb, #d4af37 20%, transparent);
    }
    @media (prefers-reduced-motion: no-preference) {
      /* Blaze flicker + at-risk invite breathe — ambient only, both off when
         the user asks for reduced motion. */
      .status-streak.tier-blaze .streak-flame {
        animation: streak-flicker 2.4s ease-in-out infinite;
      }
      .status-streak .streak-today-dot.is-off {
        animation: streak-breathe 2.8s ease-in-out infinite;
      }
    }
    @keyframes streak-flicker {
      0%, 100% { transform: scale(1) rotate(-1deg); }
      40% { transform: scale(1.06) rotate(1.5deg); }
      70% { transform: scale(0.98); }
    }
    @keyframes streak-breathe {
      0%, 100% { opacity: 0.55; }
      50% { opacity: 0.95; }
    }
    @media (prefers-reduced-motion: reduce) {
      .status-streak.tier-blaze .streak-flame,
      .status-streak .streak-today-dot.is-off { animation: none; }
      .status-streak .streak-flame { transition: none; }
    }
  `;
  document.head.appendChild(style);
  return true;
}
