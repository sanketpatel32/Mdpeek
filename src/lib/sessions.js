// v0.49.0: named workspace sessions — save/restore a set of open tabs PLUS the
// open folder (explorer root + visibility). Lets a user switch between
// projects ("work", "personal", "research") without re-opening each tab set.
//
// Pure store helpers over a JSON array of { name, root, explorerVisible,
// createdAt, snapshot }. The store is backed by localStorage under
// SESSIONS_KEY; all functions take an explicit `store` argument (a
// { getItem, setItem } shim) so they're testable without global localStorage.
// main.js passes the real localStorage in and builds `snapshot` via
// store.serialize() (the existing tab-serialization path).
//
//   getSessions(localStorage)                     → [{name, root, ...}, ...]
//   saveSession(localStorage, name, {root,        → upserts by name; returns array
//     explorerVisible, snapshot})
//   deleteSession(localStorage, name)             → removes by name; returns array
//
// Malformed JSON recovers to an empty list (never throws) — a corrupted
// sessions store shouldn't break the app. Mirrors templates.js exactly.

export const SESSIONS_KEY = 'mdpeek-sessions';

const SHIM = {
  getItem() { return null; },
  setItem() {},
};

// Validate + normalize a raw parsed session entry. Drops entries missing the
// required name; coerces the optional fields to safe defaults.
function normalizeEntry(t) {
  if (!t || typeof t.name !== 'string' || !t.name) return null;
  return {
    name: t.name,
    root: typeof t.root === 'string' ? t.root : null,
    explorerVisible: t.explorerVisible !== undefined ? !!t.explorerVisible : true,
    createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
    snapshot: t.snapshot && typeof t.snapshot === 'object' ? t.snapshot : { docs: [], activeId: null },
  };
}

export function getSessions(store = SHIM) {
  const raw = store.getItem(SESSIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEntry).filter(Boolean);
  } catch {
    return [];
  }
}

function persist(store, list) {
  store.setItem(SESSIONS_KEY, JSON.stringify(list));
  return list;
}

export function saveSession(store = SHIM, name, { root = null, explorerVisible = true, snapshot = { docs: [], activeId: null } } = {}) {
  if (!name || typeof name !== 'string') return getSessions(store);
  const list = getSessions(store);
  const idx = list.findIndex((t) => t.name === name);
  const entry = {
    name,
    root: typeof root === 'string' ? root : null,
    explorerVisible: !!explorerVisible,
    createdAt: idx >= 0 ? list[idx].createdAt : Date.now(),
    snapshot: snapshot && typeof snapshot === 'object' ? snapshot : { docs: [], activeId: null },
  };
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  return persist(store, list);
}

export function deleteSession(store = SHIM, name) {
  const list = getSessions(store).filter((t) => t.name !== name);
  return persist(store, list);
}
