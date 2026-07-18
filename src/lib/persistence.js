// Thin localStorage wrapper for session persistence.
// Gracefully no-ops if localStorage is unavailable (e.g. private mode).

const KEY = 'mdpeek-session';
const RECENTS_KEY = 'mdpeek-recents';
const MAX_RECENTS = 10;

export function saveSession(snapshot) {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* storage full or disabled — ignore */
  }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // corrupt JSON — caller treats as no session
  }
}

// Recent files — a short MRU list shown on the welcome screen. Each entry is
// { path, name, openedAt } (openedAt is ms since epoch). Capped at MAX_RECENTS.
export function loadRecents() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveRecents(list) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

// Record an opened file at the top of the recents list. Dedupes by path (moves
// an existing entry to the top), trims to MAX_RECENTS. No-op for null paths
// (untitled tabs) so the list only contains real files.
export function addRecent(path) {
  if (!path) return;
  const list = loadRecents().filter((r) => r.path !== path);
  const base = path.split(/[\\/]/).pop() || path;
  list.unshift({ path, name: base, openedAt: Date.now() });
  saveRecents(list.slice(0, MAX_RECENTS));
}

// Remove a path from recents (used when a click reveals the file is gone).
export function removeRecent(path) {
  saveRecents(loadRecents().filter((r) => r.path !== path));
}
