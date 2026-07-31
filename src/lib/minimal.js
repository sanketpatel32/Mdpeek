// v0.54.0: Minimal mode — pure, DOM-free logic for the "hide all non-core
// features" master switch. Kept separate from main.js so it's unit-testable
// the same way prose.js / table.js are: pass a storage-like object, get answers.
//
// The whole feature hinges on isFeatureOn being Minimal-aware: every existing
// call site in main.js that asks "is this feature enabled?" routes through it,
// so suppression propagates from one predicate instead of being patched at
// 14 sites. MINIMAL_SUPPRESSED is the single source of truth for "non-core".

export const MINIMAL_SUPPRESSED = new Set([
  'collab', 'kanban', 'terminal', 'present', 'snippets', 'daily',
  'pomodoro', 'calendar', 'tasks', 'review', 'autocomplete', 'graph',
  'table-editor', 'prose-highlights',
]);

// Is Minimal mode on? `store` is a localStorage-like object (getItem). Absent
// key or any failure → false (Minimal is opt-in for existing users).
export function minimalModeOn(store = localStorage) {
  try { return store.getItem('mdpeek-minimal-mode') === '1'; }
  catch { return false; }
}

// Is feature `name` enabled? Returns false when Minimal mode is on AND the
// feature is non-core; otherwise defers to the per-feature flag (default ON,
// '0' disables). `store` is localStorage-like.
export function isFeatureOn(name, store = localStorage) {
  if (minimalModeOn(store) && MINIMAL_SUPPRESSED.has(name)) return false;
  try { return store.getItem(`mdpeek-feature-${name}`) !== '0'; }
  catch { return true; }
}
