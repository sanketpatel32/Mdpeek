// Pomodoro timer — state machine + persistence + a single ticker.
// The pure state transitions are unit-tested in test/workspace.test.js; the
// DOM/interval wiring lives in main.js (which calls these functions).
//
// State shape (persisted under localStorage['mdpeek-pomodoro']):
//   {
//     phase:     'focus' | 'break' | 'longbreak',
//     remaining: seconds left in the current phase,
//     running:   bool,
//     cycle:     number of focus sessions completed this set,
//     taskTag:   string | null   (a Kanban task id this focus session is tied to),
//     settings:  { focus, break, longbreak, longEvery }   (all in minutes)
//   }
//
// The ticker is a SINGLE setInterval(1000) started lazily by main.js when the
// first phase begins; main.js owns the handle and clears it on quit.

const KEY = 'mdpeek-pomodoro';

export const DEFAULT_SETTINGS = {
  focus: 25,
  break: 5,
  longbreak: 15,
  longEvery: 4, // every N focus phases, take a long break
};

/** Build a fresh state object at the start of a focus phase. */
export function initialState(settings = DEFAULT_SETTINGS) {
  return {
    phase: 'focus',
    remaining: settings.focus * 60,
    running: false,
    cycle: 0,
    taskTag: null,
    settings,
  };
}

/** Load persisted state; fall back to a fresh focus phase if missing/corrupt. */
export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw);
    return normalize(parsed);
  } catch {
    return initialState();
  }
}

/** Persist state. Swallows quota errors (best-effort). */
export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** Clear persisted state entirely (e.g. on a "stop/reset" action). */
export function clearState() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Length (seconds) of a phase given the settings. */
export function phaseSeconds(phase, settings = DEFAULT_SETTINGS) {
  const mins =
    phase === 'focus' ? settings.focus :
    phase === 'longbreak' ? settings.longbreak :
    settings.break;
  return Math.max(1, mins) * 60;
}

/**
 * Start/resume the current phase. Returns a NEW state object with running=true.
 * Pure — does not touch the timer.
 */
export function start(state) {
  return { ...state, running: true };
}

/** Pause. Returns a new state with running=false. */
export function pause(state) {
  return { ...state, running: false };
}

/**
 * Advance the timer by one second.
 * - If time remains → returns { state: <decremented>, finished: false }.
 * - If the phase just ended → returns { state: <next phase, ready>, finished: true, completed: <phase that ended> }.
 * Pure + testable (inject the duration to step multiple seconds at once).
 */
export function tick(state, elapsedSec = 1) {
  if (!state.running) return { state, finished: false };
  let remaining = state.remaining - elapsedSec;
  if (remaining > 0) {
    return { state: { ...state, remaining }, finished: false };
  }
  // Phase finished — advance to the next phase, set running=false (auto-start
  // is opt-in via the caller in main.js, not here).
  const completed = state.phase;
  let cycle = state.cycle;
  let nextPhase;
  if (state.phase === 'focus') {
    cycle += 1;
    nextPhase = cycle % state.settings.longEvery === 0 ? 'longbreak' : 'break';
  } else {
    nextPhase = 'focus';
  }
  const nextLen = phaseSeconds(nextPhase, state.settings);
  return {
    state: {
      ...state,
      phase: nextPhase,
      remaining: nextLen,
      running: false,
      cycle,
      taskTag: nextPhase === 'focus' ? null : state.taskTag, // clear tag on break start
    },
    finished: true,
    completed,
  };
}

/** Skip to the next phase manually (user clicked "skip"). */
export function skipPhase(state) {
  const completed = state.phase;
  let cycle = state.cycle;
  let nextPhase;
  if (state.phase === 'focus') {
    cycle += 1;
    nextPhase = cycle % state.settings.longEvery === 0 ? 'longbreak' : 'break';
  } else {
    nextPhase = 'focus';
  }
  return {
    ...state,
    phase: nextPhase,
    remaining: phaseSeconds(nextPhase, state.settings),
    running: false,
    cycle,
    taskTag: nextPhase === 'focus' ? null : state.taskTag,
    completed,
  };
}

/** Hard reset to the start of a fresh focus phase. */
export function reset(settings = DEFAULT_SETTINGS) {
  return initialState(settings);
}

/** Format remaining seconds as "M:SS" (e.g. 1497 → "24:57", 65 → "1:05"). */
export function formatTime(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

/** Human label for a phase. */
export function phaseLabel(phase) {
  return phase === 'longbreak' ? 'Long break'
    : phase === 'break' ? 'Break'
    : 'Focus';
}

// --- UI polish (presentation only — never mutates timer state) ----------
// Painters for the header HUD pill (#pomo-status). Everything here READS
// state and paints; the state machine above stays untouched. Styles are
// injected once behind an id guard and reference global tokens (--accent,
// --success, --dur-*, --ease-*, --shadow-sm) so every theme adapts. Shared
// pill language with the goal/streak chips: 999px pill radius, --radius-sm
// controls, --shadow-sm hover lift, hairline color-mix borders.

/** Style-element id used by the id-guarded injection (test/debug hook). */
export const POMODORO_STYLE_ID = 'mdpeek-pomodoro-polish-style';

// r=7.5 → full circumference of the progress arc (matches .pomo-ring geometry).
const RING_CIRCUMFERENCE = 2 * Math.PI * 7.5;

/** Tone bucket for a phase — focus ↔ break drives the accent↔success shift. */
export function pomodoroTone(phase) {
  return phase === 'focus' ? 'focus' : 'break';
}

/**
 * Elapsed fraction [0..1] of the current phase — pure + testable.
 * Drives the circular progress ring (fills clockwise as time burns).
 */
export function ringFraction(remaining, phase, settings = DEFAULT_SETTINGS) {
  const total = phaseSeconds(phase, settings);
  const rem = Math.max(0, Math.min(total, Number(remaining) || 0));
  return (total - rem) / total;
}

/**
 * Inject the HUD polish stylesheet once. Idempotent (id-guarded) and a safe
 * no-op without a DOM (Node tests). Returns true when it injected.
 */
export function ensurePomodoroStyles() {
  if (typeof document === 'undefined' || document.getElementById(POMODORO_STYLE_ID)) return false;
  const style = document.createElement('style');
  style.id = POMODORO_STYLE_ID;
  style.textContent = `
    /* Phase tone lives on ONE custom property so work/break shifts crossfade
       everywhere at once (base.css hardcodes --accent on the pill). */
    #pomo-status {
      --pomo-tone: var(--accent);
      background: color-mix(in srgb, var(--pomo-tone) 10%, transparent);
      border-color: color-mix(in srgb, var(--pomo-tone) 25%, transparent);
      color: var(--fg-secondary);
      transition: background-color var(--dur-3, 240ms) var(--ease-out, ease-out),
        border-color var(--dur-3, 240ms) var(--ease-out, ease-out);
    }
    #pomo-status.break { --pomo-tone: var(--success); }
    #pomo-status:hover { box-shadow: var(--shadow-sm, none); }
    .pomo-phase-label {
      color: var(--pomo-tone);
      transition: color var(--dur-3, 240ms) var(--ease-out, ease-out);
    }
    /* Countdown digits must not wiggle as seconds flip. */
    .pomo-time {
      color: var(--pomo-tone);
      font-variant-numeric: tabular-nums;
      font-feature-settings: 'tnum' 1;
      transition: color var(--dur-3, 240ms) var(--ease-out, ease-out);
    }
    .pomo-dot {
      background: var(--pomo-tone);
      transition: background-color var(--dur-3, 240ms) var(--ease-out, ease-out);
    }
    /* Circular progress ring: fills clockwise from 12 o'clock. The dashoffset
       glides on a 1s linear ramp so each tick blends instead of snapping. */
    #pomo-status.has-ring .pomo-dot { display: none; } /* ring replaces the dot */
    .pomo-ring {
      flex-shrink: 0;
      transform: rotate(-90deg);
    }
    .pomo-ring circle {
      fill: none;
      stroke-width: 2.5;
    }
    .pomo-ring-bg { stroke: color-mix(in srgb, var(--pomo-tone) 22%, transparent); }
    .pomo-ring-fg {
      stroke: var(--pomo-tone);
      stroke-linecap: round;
      transition: stroke-dashoffset 1s linear,
        stroke var(--dur-3, 240ms) var(--ease-out, ease-out);
    }
    /* Phase changes reset the arc — jump instantly, then resume smooth ticks. */
    #pomo-status.no-ring-anim .pomo-ring-fg { transition: stroke var(--dur-3, 240ms) var(--ease-out, ease-out); }
    /* Controls: quiet ghosts while running; start (paused) is THE loud affordance. */
    .pomo-toggle {
      border-radius: var(--radius-sm, 5px);
      color: var(--fg-secondary);
      transition: background-color var(--dur-1, 120ms) var(--ease-out, ease-out),
        color var(--dur-1, 120ms) var(--ease-out, ease-out);
    }
    .pomo-toggle:hover {
      background: color-mix(in srgb, var(--pomo-tone) 14%, transparent);
      color: var(--pomo-tone);
    }
    #pomo-status:not(.running) #pomo-toggle {
      background: var(--pomo-tone);
      color: #ffffff;
      padding: 3px;
    }
    #pomo-status:not(.running) #pomo-toggle:hover {
      background: color-mix(in srgb, var(--pomo-tone) 85%, #00000000);
      color: #ffffff;
    }
    /* Compact/collapsed mode: just ring + clock, for cramped chrome. */
    #pomo-status.compact {
      height: 24px;
      gap: 5px;
      padding: 0 6px;
      font-size: 11px;
    }
    #pomo-status.compact .pomo-phase-label,
    #pomo-status.compact #pomo-skip,
    #pomo-status.compact #pomo-reset { display: none; }
    @media (prefers-reduced-motion: reduce) {
      .pomo-ring-fg { transition: none; }
      #pomo-status.running .pomo-dot-focus { animation: none; }
    }
  `;
  document.head.appendChild(style);
  return true;
}

/**
 * Attach the SVG progress ring to the pill (once — idempotent via data flag).
 * Pass an explicit element in tests; defaults to #pomo-status.
 */
export function attachPomodoroRing(statusEl) {
  if (typeof document === 'undefined') return null;
  const pill = statusEl || document.getElementById('pomo-status');
  if (!pill || pill.dataset.pomoRing === '1') return pill ? pill.querySelector('.pomo-ring') : null;
  ensurePomodoroStyles();
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'pomo-ring');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  for (const cls of ['pomo-ring-bg', 'pomo-ring-fg']) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', '10');
    c.setAttribute('cy', '10');
    c.setAttribute('r', '7.5');
    if (cls === 'pomo-ring-fg') {
      c.setAttribute('stroke-dasharray', String(RING_CIRCUMFERENCE));
      c.setAttribute('stroke-dashoffset', String(RING_CIRCUMFERENCE)); // empty until first tick
    }
    svg.appendChild(c);
  }
  pill.insertBefore(svg, pill.firstChild);
  pill.classList.add('has-ring');
  pill.dataset.pomoRing = '1';
  return svg;
}

/**
 * Paint the pill from a state object (same shape the state machine emits).
 * Idempotent — safe to call on every 1s tick. Returns true when painted.
 */
export function updatePomodoroHud(state, statusEl) {
  if (typeof document === 'undefined' || !state) return false;
  const pill = statusEl || document.getElementById('pomo-status');
  if (!pill) return false;
  ensurePomodoroStyles();
  attachPomodoroRing(pill);

  // Phase tone: single class flip crossfades pill/dot/label/time/ring together.
  pill.classList.toggle('break', pomodoroTone(state.phase) === 'break');
  pill.classList.toggle('running', !!state.running);

  // Arc: advance smoothly; on a NEW phase the offset jumps backwards, so drop
  // the transition for exactly that frame (no counter-clockwise rewind spin).
  const fg = pill.querySelector('.pomo-ring-fg');
  if (fg) {
    const frac = ringFraction(state.remaining, state.phase, state.settings);
    const offset = RING_CIRCUMFERENCE * (1 - frac);
    const prev = Number(fg.dataset.offset ?? RING_CIRCUMFERENCE);
    if (offset > prev + 0.5) {
      pill.classList.add('no-ring-anim');
      const settle = () => pill.classList.remove('no-ring-anim');
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(settle);
      else setTimeout(settle, 0);
    }
    fg.dataset.offset = String(offset);
    fg.setAttribute('stroke-dashoffset', String(offset));
  }

  // Accessible narration mirrors the visuals (icon swap alone isn't enough).
  pill.setAttribute(
    'aria-label',
    `${phaseLabel(state.phase)} ${formatTime(state.remaining)}${state.running ? '' : ' (paused)'}`,
  );
  return true;
}

/** Toggle the compact/collapsed HUD variant. Returns the resulting state. */
export function setPomodoroCompact(compact = true, statusEl) {
  if (typeof document === 'undefined') return compact;
  const pill = statusEl || document.getElementById('pomo-status');
  if (!pill) return compact;
  ensurePomodoroStyles();
  pill.classList.toggle('compact', !!compact);
  return pill.classList.contains('compact');
}

// --- internals ---------------------------------------------------------

function normalize(parsed) {
  const merged = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
  // Corrupt/non-numeric values must fall back to defaults — otherwise
  // phaseSeconds() yields NaN and the timer cycles phases instantly.
  const settings = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    settings[k] = Number.isFinite(merged[k]) ? merged[k] : DEFAULT_SETTINGS[k];
  }
  const phase = ['focus', 'break', 'longbreak'].includes(parsed.phase) ? parsed.phase : 'focus';
  const remaining = Number.isFinite(parsed.remaining) && parsed.remaining > 0
    ? Math.floor(parsed.remaining)
    : phaseSeconds(phase, settings);
  return {
    phase,
    remaining,
    running: false, // never resume running on reload — require explicit start
    cycle: Number.isFinite(parsed.cycle) ? parsed.cycle : 0,
    taskTag: typeof parsed.taskTag === 'string' ? parsed.taskTag : null,
    settings,
  };
}
