// Thin localStorage wrapper for session persistence.
// Gracefully no-ops if localStorage is unavailable (e.g. private mode).

const KEY = 'mdpeek-session';

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
