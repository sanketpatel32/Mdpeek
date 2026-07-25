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

// --- internals ---------------------------------------------------------

function normalize(parsed) {
  const settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
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
