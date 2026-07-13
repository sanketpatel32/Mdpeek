// Pure logic: Document model + DocumentStore. No DOM, fully unit-testable.

let _idCounter = 0;
function newId() {
  _idCounter += 1;
  return `doc-${Date.now().toString(36)}-${_idCounter}`;
}

// A doc is "plain" when it's a .txt file — plain-text docs skip the markdown
// preview entirely and open in a full-width editor (Notepad-style). Anything
// else (.md / .markdown / .mdx / untitled) is treated as markdown.
export function isPlainPath(path) {
  return !!path && /\.txt$/i.test(path);
}

export function createDocument({ path = null, content = '', mode = 'view', plain } = {}) {
  // `plain` override lets a fresh Untitled tab be plain text without a .txt
  // path (used by the new-tab-format preference). When omitted, plainness is
  // derived from the path as before.
  const isPlain = plain !== undefined ? plain : isPlainPath(path);
  return {
    id: newId(),
    path, // string | null (null = Untitled, not yet saved)
    content,
    mode: isPlain ? 'edit' : mode, // plain docs always open in edit mode
    plain: isPlain, // true = no markdown preview, full-width editor
    dirty: false,
    scrollY: 0,
    editor: null, // lazy-init in main.js when entering edit mode
  };
}

export class DocumentStore {
  constructor() {
    this.docs = [];
    this.activeId = null;
    this._listeners = new Map(); // event -> Set<fn>
  }

  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(cb);
    return () => this._listeners.get(event)?.delete(cb);
  }

  _emit(event, payload) {
    this._listeners.get(event)?.forEach((cb) => cb(payload));
  }

  active() {
    return this.docs.find((d) => d.id === this.activeId) || null;
  }

  open({ path = null, content = '', plain, mode } = {}) {
    // Duplicate check: files on disk (path != null) open once.
    if (path !== null) {
      const existing = this.docs.find((d) => d.path === path);
      if (existing) {
        this.switch(existing.id);
        return existing;
      }
    }
    const doc = createDocument({ path, content, plain, mode });
    this.docs.push(doc);
    this.activeId = doc.id;
    this._emit('change');
    return doc;
  }

  switch(id) {
    if (!this.docs.find((d) => d.id === id)) return;
    if (this.activeId === id) return; // no-op: switching to already-active tab
    this.activeId = id;
    this._emit('change');
  }

  close(id) {
    const idx = this.docs.findIndex((d) => d.id === id);
    if (idx === -1) return;
    this.docs.splice(idx, 1);
    if (this.activeId === id) {
      // activate a neighbor: prefer the one now at idx, else the previous
      const neighbor = this.docs[idx] || this.docs[idx - 1] || null;
      this.activeId = neighbor ? neighbor.id : null;
    }
    this._emit('change');
  }

  markDirty(id) {
    const d = this.docs.find((x) => x.id === id);
    if (d && !d.dirty) {
      d.dirty = true;
      this._emit('change');
    }
  }

  clearDirty(id) {
    const d = this.docs.find((x) => x.id === id);
    if (d && d.dirty) {
      d.dirty = false;
      this._emit('change');
    }
  }

  // Plain-serializable snapshot for persistence.
  serialize() {
    return {
      // Skip blank untouched Untitled tabs — they shouldn't be restored on next
      // launch (we'd rather show the welcome screen than an empty tab).
      docs: this.docs
        .filter((d) => d.path !== null || d.content !== '' || d.dirty)
        .map((d) => ({
          id: d.id,
          path: d.path,
          content: d.content,
          mode: d.mode,
          dirty: d.dirty,
          scrollY: d.scrollY,
        })),
      activeId: this.activeId,
    };
  }

  restore(data) {
    if (!data || !Array.isArray(data.docs)) return;
    this.docs = data.docs
      .filter((d) => d && typeof d.content === 'string')
      .map((d) => {
        const path = typeof d.path === 'string' ? d.path : null;
        const plain = isPlainPath(path);
        return {
          id: typeof d.id === 'string' ? d.id : newId(),
          path,
          content: d.content,
          // plain docs are always in edit mode; markdown honors the snapshot.
          mode: plain ? 'edit' : d.mode === 'edit' ? 'edit' : 'view',
          plain,
          dirty: false, // never restore as dirty — content was just re-read
          scrollY: Number.isFinite(d.scrollY) ? d.scrollY : 0,
          editor: null,
        };
      });
    this.activeId = this.docs.find((d) => d.id === data.activeId)
      ? data.activeId
      : (this.docs[0]?.id || null);
    this._emit('change');
  }
}
