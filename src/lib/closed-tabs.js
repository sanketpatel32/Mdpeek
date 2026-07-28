// v0.45.0: A stack of recently-closed document metadata so a closed tab can
// be reopened (Ctrl+Alt+T), mirroring every browser/editor.
//
// Pure helpers operating on a plain array (newest first). The caller owns the
// array and persistence; this module just shapes the push/pop/dedupe logic so
// it's unit-testable in isolation. Wired in main.js's closeTab/closeDocs.

// Snapshot the essential fields of a doc about to be closed. We deliberately
// copy only what's needed to reopen it — `editor` (a live controller) and
// `editorState` (transient) are dropped because a reopened doc gets a fresh
// editor instance on render.
export function snapshotDoc(doc) {
  if (!doc) return null;
  return {
    path: doc.path ?? null,
    content: doc.content ?? '',
    plain: !!doc.plain,
    code: !!doc.code,
    mode: doc.mode || 'edit',
    closedAt: Date.now(),
  };
}

// Push a closed-tab snapshot onto the stack (newest first). Caps at `max`
// entries (default 20) by dropping the oldest. Returns a NEW array — does not
// mutate the input — so React-style equality checks still work.
//
// If the snapshot's path already exists in the stack (same file closed twice),
// the older entry is removed first so the same file can't pile up multiple
// slots. Untitled docs (path === null) are always pushed (each is distinct).
export function pushClosedTab(stack, entry, max = 20) {
  if (!entry) return stack || [];
  let next = (stack || []).slice();
  if (entry.path !== null) {
    next = next.filter((e) => e.path !== entry.path);
  }
  next.unshift(entry);
  if (next.length > max) next.length = max;
  return next;
}

// Pop the most-recently-closed tab off the stack. Returns `{ entry, rest }`
// so the caller can both reopen the entry AND update the stack in one shot.
// Returns `{ entry: null, rest: stack }` when the stack is empty.
export function popClosedTab(stack) {
  const s = stack || [];
  if (s.length === 0) return { entry: null, rest: s };
  return { entry: s[0], rest: s.slice(1) };
}
