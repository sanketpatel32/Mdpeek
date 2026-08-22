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
  // floor (not round): pct only reaches 100 exactly when `done` flips true,
  // so the chip never reads "(100%)" while still short of the goal.
  const pct = Math.min(100, Math.floor((written / g) * 100));
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

// --- UI polish (presentation only — never mutates goal state) ------------
// Milestone flashes + completion pulse + inline bar for the status-bar chip.
// Shares the pill language with pomodoro/streak polish: 999px radius,
// --radius-sm inputs, --shadow tokens, --dur-*/--ease-* timing, hairline
// color-mix borders. All motion is prefers-reduced-motion guarded.

/** Style-element id used by the id-guarded injection (test/debug hook). */
export const GOAL_STYLE_ID = 'mdpeek-goal-polish-style';

/** Progress checkpoints that get a one-bloom flash as they're crossed. */
export const GOAL_MILESTONES = [25, 50, 75, 100];

/**
 * Highest milestone crossed by a move from prevPct → pct, or null.
 * Pure — lets the caller decide what "flashing" means (and makes the
 * crossing testable without DOM).
 */
export function milestoneCrossed(prevPct, pct) {
  const from = Math.max(0, Math.min(100, Number(prevPct) || 0));
  const to = Math.max(0, Math.min(100, Number(pct) || 0));
  let hit = null;
  for (const m of GOAL_MILESTONES) {
    if (from < m && to >= m) hit = m; // keep scanning: 0→80 crosses 25+50+75, flash the last
  }
  return hit;
}

/**
 * Mini inline progress bar for the chip. Returns an HTML string (safe to
 * interpolate next to formatGoalChip output) — pct comes straight from
 * goalProgress(), already clamped to [0,100].
 */
export function formatGoalBar(p) {
  if (!p) return '';
  const pct = Math.max(0, Math.min(100, Number(p.pct) || 0));
  return `<span class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Writing goal progress"><i style="--goal-pct:${pct}%"></i></span>`;
}

/**
 * Styled inline number input for editing the goal in place. The orchestrator
 * drops this into its popover/inline editor; styling lives entirely in CSS.
 */
export function goalEditInputHtml(goal = '') {
  const v = parseInt(goal, 10);
  return `<input class="goal-inline-input" type="number" min="50" step="50" inputmode="numeric"`
    + ` value="${Number.isFinite(v) && v > 0 ? v : ''}" placeholder="500"`
    + ` aria-label="Words per session goal" title="Words per session goal"/>`;
}

/**
 * Inject the goal-chip stylesheet once. Idempotent (id-guarded), DOM-safe.
 */
export function ensureGoalStyles() {
  if (typeof document === 'undefined' || document.getElementById(GOAL_STYLE_ID)) return false;
  const style = document.createElement('style');
  style.id = GOAL_STYLE_ID;
  style.textContent = `
    /* Inline bar: quiet track + tone fill that glides as words land. */
    .status-goal .goal-bar {
      display: inline-block;
      width: 56px;
      height: 4px;
      margin-left: 6px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--fg-muted) 28%, transparent);
      overflow: hidden;
      vertical-align: 2px;
    }
    .status-goal .goal-bar > i {
      display: block;
      height: 100%;
      border-radius: inherit;
      width: var(--goal-pct, 0%);
      background: var(--accent);
      transition: width var(--dur-3, 240ms) var(--ease-out, ease-out),
        background-color var(--dur-3, 240ms) var(--ease-out, ease-out);
    }
    .status-goal.done .goal-bar > i { background: var(--success); }
    /* Milestone bloom: one soft accent ring expanding out of the pill. */
    .status-goal.goal-milestone-flash {
      animation: goal-flash calc(var(--dur-4, 360ms) * 1.5) var(--ease-out, ease-out) 1;
    }
    @keyframes goal-flash {
      from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); }
      to   { box-shadow: 0 0 0 9px color-mix(in srgb, var(--accent) 0%, transparent); }
    }
    /* Completion: single springy pop + success bloom. Fires once per element
       (the JS side guards re-fires); stays green via base.css afterwards. */
    .status-goal.done.goal-done-pulse {
      animation: goal-done-pulse calc(var(--dur-4, 360ms) * 2) var(--ease-spring, ease-out) 1;
    }
    @keyframes goal-done-pulse {
      0%   { transform: none; }
      35%  { transform: scale(1.08); box-shadow: 0 0 0 8px color-mix(in srgb, var(--success) 30%, transparent); }
      100% { transform: none; box-shadow: 0 0 0 0 transparent; }
    }
    /* Inline edit input reads as part of the same pill family. */
    .goal-inline-input {
      width: 76px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-elevated);
      color: var(--fg);
      font: inherit;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      transition: border-color var(--dur-1, 120ms) var(--ease-out, ease-out),
        box-shadow var(--dur-1, 120ms) var(--ease-out, ease-out);
    }
    .goal-inline-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    @media (prefers-reduced-motion: reduce) {
      .status-goal.goal-milestone-flash,
      .status-goal.done.goal-done-pulse { animation: none; }
      .status-goal .goal-bar > i { transition: none; }
    }
  `;
  document.head.appendChild(style);
  return true;
}

/**
 * Apply milestone/completion presentation to a rendered `.status-goal` chip.
 * Call after each status render with the PREVIOUS pct so crossings are seen:
 *   applyGoalChipPresentation(el, prevState?.pct ?? 0, p.pct)
 * Flash/pulse are per-element one-shots (guards on the element itself) and
 * self-clean on animationend. Idempotent; no-op without DOM.
 */
export function applyGoalChipPresentation(chipEl, prevPct, pctOrProgress) {
  if (!chipEl || typeof document === 'undefined') return null;
  ensureGoalStyles();
  const done = typeof pctOrProgress === 'object' && pctOrProgress !== null
    ? !!pctOrProgress.done
    : (Number(pctOrProgress) || 0) >= 100;
  const pct = typeof pctOrProgress === 'object' && pctOrProgress !== null
    ? (Number(pctOrProgress.pct) || 0)
    : (Number(pctOrProgress) || 0);

  // Milestones 25/50/75 (+100 handled by the pulse): one bloom each, ever,
  // per element instance — re-renders at the same pct must not reflash.
  const m = milestoneCrossed(prevPct, pct);
  if (m !== null && m < 100 && chipEl._goalMilestoneSeen !== m) {
    chipEl._goalMilestoneSeen = m;
    chipEl.classList.remove('goal-milestone-flash');
    void chipEl.offsetWidth; // restart the animation if a prior one just ran
    chipEl.classList.add('goal-milestone-flash');
    chipEl.addEventListener('animationend', () => chipEl.classList.remove('goal-milestone-flash'), { once: true });
  }
  // Completion pulse: exactly once per element lifetime (one-shot, subtle).
  if (done && !chipEl._goalPulsed) {
    chipEl._goalPulsed = true;
    chipEl.classList.remove('goal-done-pulse');
    void chipEl.offsetWidth;
    chipEl.classList.add('goal-done-pulse');
    chipEl.addEventListener('animationend', () => chipEl.classList.remove('goal-done-pulse'), { once: true });
  }
  return m;
}
