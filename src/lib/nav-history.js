// Browser-style navigation history for the active doc. Tracks a cursor into a
// list of doc IDs; every "navigate" (tab switch, file open, wiki-link click)
// pushes onto the list and truncates any forward entries (matching browser
// semantics). back() / forward() move the cursor and return the target id.
//
// Pure logic — no DOM, unit-tested directly. main.js owns the instance and
// wires navigate() to every place the active doc changes.

export class NavHistory {
  constructor() {
    this._stack = [];
    this._cursor = -1; // index of the "current" entry; -1 = empty
    this._suppressed = false; // when true, navigate() is a no-op (we're walking)
  }

  get current() {
    return this._cursor >= 0 ? this._stack[this._cursor] : null;
  }
  get canBack() {
    return this._cursor > 0;
  }
  get canForward() {
    return this._cursor < this._stack.length - 1;
  }
  // Snapshot of all tracked ids — used by callers to prune closed docs.
  get entries() {
    return this._stack.slice();
  }

  // Record a navigation to `id`. No-op if id matches the current entry, so
  // repeated navigate(active) calls (e.g. from store 'change' events that
  // didn't actually switch tabs) don't bloat the stack.
  navigate(id) {
    if (id == null || id === undefined) return;
    if (this._suppressed) return;
    if (this.current === id) return;
    // Drop any forward entries — clicking a link abandons the forward history.
    if (this._cursor < this._stack.length - 1) {
      this._stack = this._stack.slice(0, this._cursor + 1);
    }
    this._stack.push(id);
    this._cursor = this._stack.length - 1;
  }

  back() {
    if (!this.canBack) return null;
    this._cursor--;
    return this.current;
  }

  forward() {
    if (!this.canForward) return null;
    this._cursor++;
    return this.current;
  }

  // Remove an id from history entirely (e.g. when a doc is closed). Compacts
  // the stack and clamps the cursor.
  remove(id) {
    const lenBefore = this._stack.length;
    this._stack = this._stack.filter((x) => x !== id);
    // If we removed entries at or before the cursor, shift the cursor.
    const removed = lenBefore - this._stack.length;
    if (removed > 0) {
      // Re-find the cursor: clamp to the new bounds.
      this._cursor = Math.min(this._cursor, this._stack.length - 1);
      if (this._cursor < 0) this._cursor = this._stack.length - 1;
    }
  }

  clear() {
    this._stack = [];
    this._cursor = -1;
  }

  // Suppress navigate() while performing back()/forward() so the walk doesn't
  // create new entries. Pair with runUnsuppressed() — never leave suppression
  // on, or future navigations are silently lost.
  suppress() { this._suppressed = true; }
  unsuppress() { this._suppressed = false; }
}
