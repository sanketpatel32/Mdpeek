// v0.44.0: per-document theme override.
//
// Most of the app uses a single global theme (`mdpeek-theme`). This module
// adds an opt-in per-doc override stored as a JSON map of `path → themeId`:
// when the active doc's path has an entry, renderActive temporarily applies
// that theme; switching away restores the global.
//
// Keeping this in its own module (rather than on the doc object) means the
// override survives across doc reloads without touching the doc model — the
// doc's path is stable, the map is keyed on it, and the doc model stays lean.
//
// All functions take an explicit `store` shim ({ getItem, setItem }) so the
// round-trip is unit-testable without touching global localStorage.

export const DOC_THEME_KEY = 'mdpeek-doc-themes';

const SHIM = {
  getItem() { return null; },
  setItem() {},
};

// Read the full { path → themeId } map. Malformed JSON recovers to {}.
export function getAllDocThemes(store = SHIM) {
  const raw = store.getItem(DOC_THEME_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

// Get the theme for a doc path, or null if none pinned (inherit global).
export function getDocTheme(path, store = SHIM) {
  if (!path) return null;
  const map = getAllDocThemes(store);
  return map[path] || null;
}

// Pin a theme to a doc path. Returns the new full map.
export function setDocTheme(path, themeId, store = SHIM) {
  if (!path || typeof themeId !== 'string') return getAllDocThemes(store);
  const map = getAllDocThemes(store);
  map[path] = themeId;
  store.setItem(DOC_THEME_KEY, JSON.stringify(map));
  return map;
}

// Clear the override for a doc path. Returns the new full map.
export function clearDocTheme(path, store = SHIM) {
  if (!path) return getAllDocThemes(store);
  const map = getAllDocThemes(store);
  delete map[path];
  store.setItem(DOC_THEME_KEY, JSON.stringify(map));
  return map;
}
