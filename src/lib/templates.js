// v0.44.0: user-defined document templates ("new from template").
//
// Pure store helpers over a JSON array of { name, content }. The store is
// backed by localStorage under TEMPLATES_KEY; all functions take an explicit
// `store` argument (a { getItem, setItem } shim) so they're testable without
// touching global localStorage. main.js passes the real localStorage in.
//
//   getTemplates(localStorage)           → [{name, content}, ...]
//   saveTemplate(localStorage, name, c)  → upserts by name; returns new array
//   deleteTemplate(localStorage, name)   → removes by name; returns new array
//
// Malformed JSON recovers to an empty list (never throws) — a corrupted
// template store shouldn't break the app.

export const TEMPLATES_KEY = 'mdpeek-templates';

const SHIM = {
  getItem() { return null; },
  setItem() {},
};

export function getTemplates(store = SHIM) {
  const raw = store.getItem(TEMPLATES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: keep only well-shaped entries.
    return parsed
      .filter((t) => t && typeof t.name === 'string' && typeof t.content === 'string')
      .map((t) => ({ name: t.name, content: t.content }));
  } catch {
    return [];
  }
}

function persist(store, list) {
  store.setItem(TEMPLATES_KEY, JSON.stringify(list));
  return list;
}

export function saveTemplate(store = SHIM, name, content) {
  if (!name || typeof name !== 'string') return getTemplates(store);
  const list = getTemplates(store);
  const idx = list.findIndex((t) => t.name === name);
  const entry = { name, content: typeof content === 'string' ? content : '' };
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  return persist(store, list);
}

export function deleteTemplate(store = SHIM, name) {
  const list = getTemplates(store).filter((t) => t.name !== name);
  return persist(store, list);
}
