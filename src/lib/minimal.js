// Feature flags — pure, DOM-free logic for the per-feature toggles in
// Settings → Features. Kept separate from main.js so it's unit-testable:
// pass a storage-like object, get an answer.

// Is feature `name` enabled? Default ON; '0' in localStorage disables.
// `store` is localStorage-like.
export function isFeatureOn(name, store = localStorage) {
  try { return store.getItem(`mdpeek-feature-${name}`) !== '0'; }
  catch { return true; }
}
