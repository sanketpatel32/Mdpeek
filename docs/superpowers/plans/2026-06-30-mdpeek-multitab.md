# mdpeek Multi-tab + Session Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform mdpeek from single-document to multi-tab with session restore, shipped as v0.0.8.

**Architecture:** A pure `DocumentStore` (the list of open Documents + active pointer + persistence) becomes the single source of truth. The toolbar, viewport, watcher, and shortcuts all operate on the active Document. A new tab strip renders above the viewport. A Tauri single-instance plugin routes 2nd-launch file opens to the running window.

**Tech Stack:** Vanilla JS (ES modules), Tauri 2 (`tauri-plugin-single-instance`), Vitest + jsdom, `localStorage` for session persistence.

**Spec:** `docs/superpowers/specs/2026-06-30-mdpeek-multitab-design.md`

---

## File Structure

```
src/
├── lib/
│   ├── documents.js     NEW — Document model + DocumentStore (pure, tested)
│   ├── persistence.js   NEW — save/load session JSON to localStorage
│   └── renderer.js      UNCHANGED
├── views/
│   ├── tabs.js          NEW — render tab strip, handle click/close/new
│   ├── viewer.js        UNCHANGED (showDocument, buildToc signatures stable)
│   └── editor.js        UNCHANGED (initEditor signature stable)
├── main.js              MAJOR REFACTOR — wire DocumentStore to UI
└── styles/base.css      + tab strip styles
index.html               + <div id="tab-strip">
src-tauri/src/lib.rs     + single-instance plugin + forward argv to frontend
src-tauri/Cargo.toml     + tauri-plugin-single-instance
test/documents.test.js   NEW — DocumentStore unit tests
```

**Key boundaries:** `documents.js` is pure logic (no DOM, fully unit-testable). `persistence.js` is a thin localStorage wrapper. `tabs.js` only renders the strip. `main.js` is the glue that listens to DocumentStore events and updates the viewport/toolbar.

---

## Task 1: Document model + DocumentStore (TDD — pure logic)

**Files:**
- Create: `src/lib/documents.js`
- Create: `test/documents.test.js`

- [ ] **Step 1: Write the failing tests**

`test/documents.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentStore, createDocument } from '../src/lib/documents.js';

describe('createDocument', () => {
  it('creates a doc with defaults', () => {
    const d = createDocument({ path: '/a.md', content: '# hi' });
    expect(d.path).toBe('/a.md');
    expect(d.content).toBe('# hi');
    expect(d.mode).toBe('view');
    expect(d.dirty).toBe(false);
    expect(d.scrollY).toBe(0);
    expect(d.editor).toBe(null);
    expect(typeof d.id).toBe('string');
  });

  it('untitled docs have null path', () => {
    const d = createDocument({ content: '' });
    expect(d.path).toBe(null);
  });
});

describe('DocumentStore', () => {
  let store;
  beforeEach(() => {
    store = new DocumentStore();
  });

  it('starts empty with activeId null', () => {
    expect(store.docs).toEqual([]);
    expect(store.activeId).toBe(null);
  });

  it('open() adds a doc and activates it', () => {
    const d = store.open({ path: '/a.md', content: 'a' });
    expect(store.docs).toHaveLength(1);
    expect(store.docs[0]).toBe(d);
    expect(store.activeId).toBe(d.id);
  });

  it('open() with same path returns existing doc (no duplicate)', () => {
    const d1 = store.open({ path: '/a.md', content: 'a' });
    const d2 = store.open({ path: '/a.md', content: 'a' });
    expect(d2).toBe(d1);
    expect(store.docs).toHaveLength(1);
  });

  it('open() untitled always creates new (path=null)', () => {
    store.open({ path: null, content: '' });
    store.open({ path: null, content: '' });
    expect(store.docs).toHaveLength(2);
  });

  it('active() returns the active doc', () => {
    const d = store.open({ path: '/a.md', content: 'a' });
    expect(store.active()).toBe(d);
  });

  it('switch(id) sets activeId', () => {
    const d1 = store.open({ path: '/a.md', content: 'a' });
    const d2 = store.open({ path: '/b.md', content: 'b' });
    store.switch(d1.id);
    expect(store.activeId).toBe(d1.id);
    expect(store.active()).toBe(d1);
  });

  it('close() removes a doc; if it was active, activates neighbor', () => {
    const d1 = store.open({ path: '/a.md', content: 'a' });
    const d2 = store.open({ path: '/b.md', content: 'b' });
    const d3 = store.open({ path: '/c.md', content: 'c' });
    store.switch(d2.id);
    store.close(d2.id);
    expect(store.docs).toHaveLength(2);
    expect(store.docs.find((x) => x.id === d2.id)).toBeUndefined();
    // active falls back to a neighbor (d1 or d3)
    expect([d1.id, d3.id]).toContain(store.activeId);
  });

  it('close() last doc leaves store empty (caller handles creating Untitled)', () => {
    const d = store.open({ path: '/a.md', content: 'a' });
    store.close(d.id);
    expect(store.docs).toEqual([]);
    expect(store.activeId).toBe(null);
  });

  it('markDirty sets dirty=true; clearDirty sets false', () => {
    const d = store.open({ path: '/a.md', content: 'a' });
    store.markDirty(d.id);
    expect(d.dirty).toBe(true);
    store.clearDirty(d.id);
    expect(d.dirty).toBe(false);
  });

  it('emits "change" on open/switch/close', () => {
    const cb = vi.fn();
    store.on('change', cb);
    const d1 = store.open({ path: '/a.md', content: 'a' });
    const d2 = store.open({ path: '/b.md', content: 'b' });
    store.switch(d1.id);
    store.close(d2.id);
    expect(cb).toHaveBeenCalledTimes(4); // open, open, switch, close
  });

  it('serialize() returns plain array; round-trips via restore()', () => {
    const d1 = store.open({ path: '/a.md', content: 'a-content' });
    store.open({ path: null, content: 'untitled-content' });
    store.switch(d1.id);
    const data = store.serialize();
    expect(Array.isArray(data.docs)).toBe(true);
    expect(data.docs).toHaveLength(2);
    expect(data.docs[0].path).toBe('/a.md');
    expect(data.activeId).toBe(d1.id);

    const s2 = new DocumentStore();
    s2.restore(data);
    expect(s2.docs).toHaveLength(2);
    expect(s2.docs[0].path).toBe('/a.md');
    expect(s2.docs[0].content).toBe('a-content');
    expect(s2.docs[1].path).toBe(null);
    expect(s2.docs[1].content).toBe('untitled-content');
    expect(s2.activeId).toBe(s2.docs[0].id);
  });

  it('restore() ignores corrupt data gracefully', () => {
    expect(() => store.restore(null)).not.toThrow();
    expect(() => store.restore({ docs: 'not-an-array' })).not.toThrow();
    expect(store.docs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```
Expected: FAIL — `Cannot find module '../src/lib/documents.js'`.

- [ ] **Step 3: Implement `documents.js`**

`src/lib/documents.js`:
```js
// Pure logic: Document model + DocumentStore. No DOM, fully unit-testable.

let _idCounter = 0;
function newId() {
  _idCounter += 1;
  return `doc-${Date.now().toString(36)}-${_idCounter}`;
}

export function createDocument({ path = null, content = '', mode = 'view' } = {}) {
  return {
    id: newId(),
    path, // string | null (null = Untitled, not yet saved)
    content,
    mode, // 'view' | 'edit'
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

  open({ path = null, content = '' }) {
    // Duplicate check: files on disk (path != null) open once.
    if (path !== null) {
      const existing = this.docs.find((d) => d.path === path);
      if (existing) {
        this.switch(existing.id);
        return existing;
      }
    }
    const doc = createDocument({ path, content });
    this.docs.push(doc);
    this.activeId = doc.id;
    this._emit('change');
    return doc;
  }

  switch(id) {
    if (!this.docs.find((d) => d.id === id)) return;
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
      docs: this.docs.map((d) => ({
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
      .map((d) => ({
        id: typeof d.id === 'string' ? d.id : newId(),
        path: typeof d.path === 'string' ? d.path : null,
        content: d.content,
        mode: d.mode === 'edit' ? 'edit' : 'view',
        dirty: false, // never restore as dirty — content was just re-read
        scrollY: Number.isFinite(d.scrollY) ? d.scrollY : 0,
        editor: null,
      }));
    this.activeId = this.docs.find((d) => d.id === data.activeId)
      ? data.activeId
      : (this.docs[0]?.id || null);
    this._emit('change');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: all document tests PASS (plus the existing 10 renderer tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/lib/documents.js test/documents.test.js
git commit -m "feat(documents): DocumentStore + Document model (TDD)"
```

---

## Task 2: Persistence (localStorage wrapper)

**Files:**
- Create: `src/lib/persistence.js`

This is a thin wrapper — no separate test file; it's exercised by the manual smoke test (quit + relaunch).

- [ ] **Step 1: Implement `persistence.js`**

`src/lib/persistence.js`:
```js
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

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 2: Verify it imports cleanly (build check)**

```bash
npx vite build
```
Expected: builds without errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/persistence.js
git commit -m "feat(persistence): localStorage session wrapper"
```

---

## Task 3: Tab strip view

**Files:**
- Create: `src/views/tabs.js`

Renders the tab strip from a DocumentStore. Emits no events itself — `main.js` attaches listeners to the rendered elements. Pure rendering function.

- [ ] **Step 1: Implement `tabs.js`**

`src/views/tabs.js`:
```js
// Renders the tab strip into #tab-strip from a DocumentStore.
// Returns helpers for re-rendering and finding elements.

function titleFor(doc) {
  if (doc.path) {
    const parts = doc.path.split(/[\\/]/);
    return parts[parts.length - 1];
  }
  return 'Untitled';
}

export function renderTabs(store) {
  const strip = document.getElementById('tab-strip');
  if (!strip) return;

  const html = store.docs
    .map((d) => {
      const active = d.id === store.activeId ? ' active' : '';
      const dirty = d.dirty ? ' <span class="tab-dot">●</span>' : '';
      const title = escapeHtml(titleFor(d));
      return `<div class="tab${active}" data-id="${d.id}" title="${escapeHtml(d.path || 'Untitled')}">
        <span class="tab-title">${title}</span>${dirty}
        <span class="tab-close" data-id="${d.id}" title="Close (middle-click)">×</span>
      </div>`;
    })
    .join('');

  strip.innerHTML = `${html}<button id="tab-new" class="tab-new" title="New tab (Ctrl+N)">+</button>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

- [ ] **Step 2: Verify it imports cleanly**

```bash
npx vite build
```
Expected: builds without errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/tabs.js
git commit -m "feat(tabs): tab strip renderer"
```

---

## Task 4: Tab strip styles + markup

**Files:**
- Modify: `index.html`
- Modify: `src/styles/base.css`

- [ ] **Step 1: Add `<div id="tab-strip">` to `index.html`**

In `index.html`, find the `<header class="app-header">...</header>` block and insert the tab strip immediately AFTER the closing `</header>` and BEFORE `<main id="view-mode">`:

```html
    </header>

    <div id="tab-strip" class="tab-strip"></div>

    <main id="view-mode" class="view-mode">
```

- [ ] **Step 2: Add tab strip styles to `src/styles/base.css`**

Append to `src/styles/base.css`:
```css

/* ---------- Tab strip ---------- */
.tab-strip {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px 0 8px;
  background: var(--surface);
  border-bottom: 1px solid var(--border-subtle);
  overflow-x: auto;
  scrollbar-width: none;
  min-height: 34px;
}
.tab-strip::-webkit-scrollbar {
  height: 0;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 200px;
  padding: 5px 4px 5px 10px;
  background: transparent;
  color: var(--fg-secondary);
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--radius) var(--radius) 0 0;
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
  -webkit-user-select: none;
  user-select: none;
}
.tab:hover {
  background: var(--surface-hover);
}
.tab.active {
  background: var(--bg);
  color: var(--fg);
  border-color: var(--border-subtle);
}
.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}
.tab-dot {
  color: var(--accent);
  font-size: 10px;
}
.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  line-height: 1;
  color: var(--fg-muted);
}
.tab-close:hover {
  background: var(--surface-active);
  color: var(--fg);
}
.tab-new {
  background: transparent;
  border: none;
  color: var(--fg-muted);
  font-size: 18px;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  margin-left: 4px;
}
.tab-new:hover {
  background: var(--surface-hover);
  color: var(--fg);
}
```

- [ ] **Step 3: Verify it builds**

```bash
npx vite build
```
Expected: builds without errors.

- [ ] **Step 4: Commit**

```bash
git add index.html src/styles/base.css
git commit -m "feat(ui): tab strip markup + styles"
```

---

## Task 5: Rust single-instance plugin (so 2nd launch routes to running window)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json` (no change needed — single-instance uses core events)

- [ ] **Step 1: Add the dependency to `src-tauri/Cargo.toml`**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:
```toml
tauri-plugin-single-instance = { version = "2", features = ["deep-link"] }
```
(Place it right after the `tauri-plugin-updater = "2"` line.)

- [ ] **Step 2: Wire the plugin in `src-tauri/src/lib.rs`**

In `src-tauri/src/lib.rs`, the plugin must be registered FIRST (before any other plugin) per the single-instance docs. Modify the `run()` function so the builder chain starts with the single-instance init. Replace the start of `run()`:

Current:
```rust
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
```

Replace with:
```rust
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // Single-instance: a second launch focuses this window and forwards its
        // argv (e.g. a double-clicked .md) as an `open-file` event to the
        // frontend, which opens it as a new tab instead of a new window.
        builder = builder.plugin(
            tauri_plugin_single_instance::init(|app, argv, _cwd| {
                use tauri::{Manager, Emitter};
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    // argv[0] is the exe; argv[1] (if present) is the file path.
                    if argv.len() > 1 {
                        let path = argv[1].clone();
                        if let Ok(content) = std::fs::read_to_string(&path) {
                            let payload = serde_json::json!({ "path": path, "content": content });
                            let _ = window.emit("open-file", payload);
                        }
                    }
                }
            }),
        );
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
```

- [ ] **Step 3: Verify it compiles**

```bash
cd src-tauri && cargo check
```
Expected: `Finished` with no errors. (Downloading + compiling the single-instance crate takes a minute on first run.)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "feat(backend): single-instance plugin routes 2nd launch to running window"
```

---

## Task 6: Refactor `main.js` to use DocumentStore (the big one)

**Files:**
- Modify: `src/main.js` (major rewrite — preserves all existing features)

This is the integration glue. The previous single `state` object is replaced by a `DocumentStore`. The toolbar, viewport, watcher, and shortcuts all operate on the active document.

- [ ] **Step 1: Rewrite `src/main.js`**

Replace the ENTIRE contents of `src/main.js` with:
```js
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { showDocument, buildToc } from './views/viewer.js';
import { initEditor } from './views/editor.js';
import { renderTabs } from './views/tabs.js';
import { DocumentStore } from './lib/documents.js';
import { saveSession, loadSession } from './lib/persistence.js';

const ICON_SUN =
  '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
const ICON_MOON =
  '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';

const WELCOME_HTML = `
  <div class="welcome">
    <img src="/icon.png" alt="mdpeek" class="welcome-logo" />
    <h1>Welcome to mdpeek <span class="version-badge">v0.0.8</span></h1>
    <p>A lightweight Markdown viewer. Open a file to get started, or drop one onto this window.</p>
    <div class="welcome-hints">
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>O</kbd> Open</span>
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>N</kbd> New tab</span>
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>S</kbd> Save</span>
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>E</kbd> Toggle edit</span>
    </div>
  </div>
`;

const store = new DocumentStore();
const el = {
  open: document.getElementById('btn-open'),
  save: document.getElementById('btn-save'),
  mode: document.getElementById('btn-mode'),
  theme: document.getElementById('btn-theme'),
  fileName: document.getElementById('file-name'),
  tabStrip: document.getElementById('tab-strip'),
  viewMode: document.getElementById('view-mode'),
  editMode: document.getElementById('edit-mode'),
  document: document.getElementById('document'),
  toc: document.getElementById('toc'),
  editor: document.getElementById('editor'),
  preview: document.getElementById('preview'),
  toast: document.getElementById('toast'),
  dropzone: document.getElementById('dropzone'),
};

// ---------- helpers ----------
function toast(msg, opts = {}) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  el.toast.style.cursor = opts.onClick ? 'pointer' : 'default';
  el.toast.onclick = opts.onClick || null;
  clearTimeout(toast._t);
  if (!opts.persistent) {
    toast._t = setTimeout(() => {
      el.toast.classList.add('hidden');
      el.toast.onclick = null;
    }, 2500);
  }
}

function basename(p) {
  return p ? p.split(/[\\/]/).pop() : 'Untitled';
}

async function rewatch(path) {
  if (!path) return;
  try {
    await invoke('watch_path', { path });
  } catch {
    /* ignore watcher failures */
  }
}

// ---------- viewport rendering (operates on active doc) ----------
async function renderActive() {
  const doc = store.active();
  renderTabs(store);
  el.fileName.textContent = doc ? basename(doc.path) : 'No file';

  if (!doc) {
    // No tabs — show welcome (shouldn't happen since we always keep >=1 tab).
    el.document.classList.add('has-welcome');
    el.document.innerHTML = WELCOME_HTML;
    return;
  }

  // Mode toggle label
  const labelMode = document.getElementById('label-mode');
  if (labelMode) labelMode.textContent = doc.mode === 'edit' ? 'View' : 'Edit';

  if (doc.mode === 'edit') {
    el.viewMode.classList.add('hidden');
    el.editMode.classList.remove('hidden');
    if (!doc.editor) {
      doc.editor = initEditor({ textarea: el.editor, preview: el.preview });
    }
    doc.editor.setValue(doc.content);
  } else {
    el.editMode.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.document.classList.remove('has-welcome');
    await showDocument(el.document, doc.content);
    buildToc(el.document);
  }
}

// ---------- persistence ----------
function persist() {
  saveSession(store.serialize());
}
store.on('change', () => {
  renderActive();
  persist();
});

// ---------- open / new / close ----------
async function openPath(path, content) {
  store.open({ path, content });
  await rewatch(path);
}

function newTab() {
  store.open({ path: null, content: '' });
}

async function closeTab(id) {
  const doc = store.docs.find((d) => d.id === id);
  if (!doc) return;
  if (doc.dirty) {
    const choice = confirm(`"${basename(doc.path)}" has unsaved changes. Close anyway?`);
    if (!choice) return;
  }
  store.close(id);
  // Always keep at least one tab open.
  if (store.docs.length === 0) {
    newTab();
  } else if (store.active()) {
    await rewatch(store.active().path);
  }
}

// ---------- file open dialog ----------
async function openFileDialog() {
  try {
    const res = await invoke('open_file');
    await openPath(res.path, res.content);
  } catch (e) {
    if (e !== 'cancelled') toast('Open failed: ' + e);
  }
}

// ---------- save ----------
async function saveActive() {
  const doc = store.active();
  if (!doc) return;
  const content = doc.mode === 'edit' && doc.editor ? doc.editor.getValue() : doc.content;
  // sync back into the doc
  doc.content = content;

  if (!doc.path) {
    try {
      const path = await invoke('save_file_as', { content });
      doc.path = path;
      store.clearDirty(doc.id);
      toast('Saved');
    } catch (e) {
      if (e !== 'cancelled') toast('Save failed: ' + e);
    }
    return;
  }
  try {
    await invoke('save_file', { path: doc.path, content });
    store.clearDirty(doc.id);
    toast('Saved');
  } catch (e) {
    toast('Save failed: ' + e);
  }
}

// ---------- mode toggle ----------
function toggleMode() {
  const doc = store.active();
  if (!doc) return;
  // capture content before switching
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  doc.mode = doc.mode === 'view' ? 'edit' : 'view';
  renderActive();
}

// ---------- theme ----------
function applyTheme(next) {
  const root = document.documentElement;
  root.dataset.theme = next;
  localStorage.setItem('mdpeek-theme', next);
  document.getElementById('hljs-light').disabled = next === 'dark';
  document.getElementById('hljs-dark').disabled = next !== 'dark';
  const iconTheme = document.getElementById('icon-theme');
  if (iconTheme) iconTheme.innerHTML = next === 'dark' ? ICON_SUN : ICON_MOON;
  el.theme.title = next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

// ---------- auto-update ----------
async function applyUpdate(update) {
  toast('Downloading update…');
  try {
    await update.downloadAndInstall();
    toast('Update installed — relaunching…');
    await relaunch();
  } catch (e) {
    toast('Update failed: ' + e);
  }
}
async function checkForUpdates(silent = false) {
  try {
    const update = await check();
    if (update) {
      toast(`Update available — v${update.version}. Click to install.`, {
        persistent: true,
        onClick: () => applyUpdate(update),
      });
    } else if (!silent) {
      toast('You are on the latest version.');
    }
  } catch (e) {
    if (!silent) toast('Update check failed: ' + e);
  }
}

// ---------- events ----------
el.open.addEventListener('click', openFileDialog);
el.save.addEventListener('click', saveActive);
el.mode.addEventListener('click', toggleMode);
el.theme.addEventListener('click', toggleTheme);

// Tab strip: click to switch, click × to close, click + for new
el.tabStrip.addEventListener('click', async (e) => {
  const closeBtn = e.target.closest('.tab-close');
  if (closeBtn) {
    e.stopPropagation();
    await closeTab(closeBtn.dataset.id);
    return;
  }
  if (e.target.id === 'tab-new') {
    newTab();
    return;
  }
  const tab = e.target.closest('.tab');
  if (tab) {
    store.switch(tab.dataset.id);
    const doc = store.active();
    if (doc) await rewatch(doc.path);
  }
});
// Middle-click closes a tab
el.tabStrip.addEventListener('mousedown', (e) => {
  if (e.button !== 1) return;
  const tab = e.target.closest('.tab');
  if (tab) closeTab(tab.dataset.id);
});

// Editor textarea: mark dirty on input
el.editor.addEventListener('input', () => {
  const doc = store.active();
  if (doc) store.markDirty(doc.id);
});

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'o') { e.preventDefault(); openFileDialog(); }
  else if (k === 's') { e.preventDefault(); saveActive(); }
  else if (k === 'e') { e.preventDefault(); toggleMode(); }
  else if (k === 'n') { e.preventDefault(); newTab(); }
  else if (k === 'w') { e.preventDefault(); const d = store.active(); if (d) closeTab(d.id); }
});

// Drag & drop
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (e.dataTransfer?.types?.includes('Files')) {
    dragDepth++;
    el.dropzone.classList.remove('hidden');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) el.dropzone.classList.add('hidden');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  el.dropzone.classList.add('hidden');
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  for (const file of Array.from(files)) {
    if (!/\.(md|markdown|mdx)$/i.test(file.name)) {
      toast('Not a markdown file: ' + file.name);
      continue;
    }
    const text = await file.text();
    await openPath(file.path || file.name, text);
  }
});

// Live reload (file changed on disk) — update active doc if it matches
listen('file-changed', (event) => {
  const doc = store.active();
  if (!doc || !doc.path) return;
  doc.content = event.payload;
  if (doc.mode === 'view') {
    showDocument(el.document, event.payload).then(() => buildToc(el.document));
  } else if (doc.editor) {
    doc.editor.setValue(event.payload);
  }
});

// Opened via external double-click (cold start: get_initial_file; hot: open-file event)
listen('open-file', (event) => {
  const { path, content } = event.payload;
  openPath(path, content);
});

// ---------- init ----------
const savedTheme = localStorage.getItem('mdpeek-theme');
if (savedTheme === 'dark') applyTheme('dark');

(async () => {
  // Restore session, re-reading file contents from disk.
  const session = loadSession();
  if (session && Array.isArray(session.docs) && session.docs.length > 0) {
    const restored = [];
    for (const s of session.docs) {
      if (s.path) {
        try {
          const content = await readFileFromDisk(s.path);
          restored.push({ ...s, content });
        } catch {
          // file missing — keep last content, mark path null-ish? Keep path so
          // user can save-as. We keep the old content.
          restored.push(s);
        }
      } else {
        // Untitled — content was persisted.
        restored.push(s);
      }
    }
    store.restore({ docs: restored, activeId: session.activeId });
  }

  // Cold-start: did Windows pass a file path on argv?
  try {
    const initial = await invoke('get_initial_file');
    if (initial) {
      await openPath(initial.path, initial.content);
      return; // get_initial_file already added a tab
    }
  } catch {
    /* ignore */
  }

  // If still no tabs (fresh launch, no session, no argv), create one Untitled.
  if (store.docs.length === 0) {
    newTab();
  } else {
    await renderActive();
    if (store.active()) await rewatch(store.active().path);
  }
})();

// Helper: read a file from disk via a Tauri command (we already have one).
// Reuse save_file? No — we need a read. The watcher's open-file path used
// std::fs in Rust, so we add a tiny command here. For now, the frontend can
// fetch via the existing `get_initial_file` semantics by re-opening.
// To avoid a new Rust command, we read via a hidden trick: open_file is a
// dialog — not usable. So we MUST add a read_file command in Rust.
// (See Task 7.)
async function readFileFromDisk(path) {
  return invoke('read_file', { path });
}

// Update check (silent) 3s after launch.
setTimeout(() => checkForUpdates(true), 3000);
```

**NOTE:** the above references `invoke('read_file', { path })` which doesn't exist yet — Task 7 adds it. Run `cargo check` only after Task 7.

- [ ] **Step 2: Commit (the file references a not-yet-existing Rust command; that's intentional — Task 7 completes it)**

```bash
git add src/main.js
git commit -m "feat(app): refactor to DocumentStore for multi-tab + session restore"
```

---

## Task 7: Add `read_file` Rust command (needed by session restore)

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command to `src-tauri/src/commands.rs`**

Append to `src-tauri/src/commands.rs`:
```rust
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register it in `src-tauri/src/lib.rs`**

In `src-tauri/src/lib.rs`, find the `invoke_handler` block:
```rust
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::save_file_as,
            watcher::watch_path,
            get_initial_file,
        ])
```
Add `commands::read_file,` to the list:
```rust
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::save_file_as,
            commands::read_file,
            watcher::watch_path,
            get_initial_file,
        ])
```

- [ ] **Step 3: Verify everything compiles (frontend + backend together)**

```bash
cd src-tauri && cargo check
```
Expected: `Finished` with no errors.

- [ ] **Step 4: Run the full test suite**

```bash
cd .. && npm test
```
Expected: all tests pass (documents + renderer).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(backend): read_file command for session restore"
```

---

## Task 8: Bump to v0.0.8, build, smoke test, release

**Files:**
- Modify: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `CHANGELOG.md`

- [ ] **Step 1: Bump version 0.0.7 → 0.0.8**

In `package.json`: `"version": "0.0.8"`
In `src-tauri/tauri.conf.json`: `"version": "0.0.8"`
In `src-tauri/Cargo.toml`: `version = "0.0.8"`
(The version badge in main.js already says v0.0.8 from Task 6.)

- [ ] **Step 2: Update CHANGELOG**

Add after `## [Unreleased]` in `CHANGELOG.md`:
```markdown
## [0.0.8] - 2026-06-30

### Added
- **Multi-tab editing**: open multiple files as tabs in one window. Open via
  drag-drop/Ctrl+O, Ctrl+N for a new blank tab, or double-click a .md while
  mdpeek is running (opens as a tab, not a second window).
- **Session restore**: reopen mdpeek and your tabs come back. Open file paths
  + active tab + Untitled-tab contents are persisted to localStorage.
- Tab strip: clickable tabs, × or middle-click to close, dirty indicator (●),
  unsaved-changes confirm on close.
- Single-instance: a second launch focuses the running window and forwards the
  opened file as a new tab.
- New shortcuts: `Ctrl+N` new tab, `Ctrl+W` close tab.

### Changed
- Major internal refactor: single-document `state` replaced by `DocumentStore`.
```

- [ ] **Step 3: Build the signed installer**

```bash
rm -fv src-tauri/target/release/bundle/nsis/mdpeek_*-setup.exe
TAURI_SIGNING_PRIVATE_KEY_PATH="$(pwd)/.tauri/mdpeek.key" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
npm run tauri:build
```
Expected: `releases/mdpeek-0.0.8-setup.exe` produced.

- [ ] **Step 4: Smoke test (manual)**

Run the v0.0.8 build (or install it). Verify:
1. Launch → one Untitled tab appears.
2. `Ctrl+O` opens file A → new tab.
3. `Ctrl+O` opens file B → second tab; tab strip shows both.
4. Click tab A → switches (content swaps).
5. `Ctrl+N` → new Untitled tab.
6. Edit an Untitled tab → ● appears; close → confirm dialog.
7. Quit + relaunch → tabs restored (A, B, Untitled content).
8. With mdpeek running, double-click a .md in Explorer → opens as new tab in the running window (no 2nd window).
9. Close the last tab → a fresh Untitled appears.

- [ ] **Step 5: Publish release**

```bash
gh release create v0.0.8 --title "mdpeek v0.0.8" --notes "Multi-tab + session restore. See CHANGELOG.md."
npm run make-release
```

- [ ] **Step 6: Commit + tag + push**

```bash
git add -A
git commit -m "release: v0.0.8 (multi-tab + session restore)"
git tag v0.0.8
git push origin main
# align the release tag:
SHA=$(git rev-parse v0.0.8)
gh api -X PATCH repos/sanketpatel32/Mdpeek/git/refs/tags/v0.0.8 -f sha="$SHA"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Tabs in one window → Task 4 (markup), Task 6 (wiring) ✓
- Open from disk (file/drag-drop) → Task 6 (openFileDialog, drop handler) ✓
- New blank tab (Ctrl+N) → Task 6 (newTab, shortcut, + button) ✓
- External double-click in running window → Task 5 (single-instance) + Task 6 (open-file listener) ✓
- Session restore (paths + active + untitled content) → Task 2 (persistence) + Task 6 (init) + Task 7 (read_file) ✓
- Open existing = switch not duplicate → Task 1 (DocumentStore.open duplicate check) ✓
- Dirty tracking + close confirm → Task 6 (closeTab, markDirty) ✓
- Single shared viewport, scroll/cursor preserved per tab → Task 6 (renderActive swaps content; per-tab `editor` lazy-init preserves its own state) ✓

**Placeholder scan:** none. Every code step has full runnable code.

**Type/signature consistency:**
- `DocumentStore` API (`open`, `switch`, `close`, `active`, `markDirty`, `clearDirty`, `serialize`, `restore`, `on`) — defined in Task 1, used identically in Task 6 ✓
- `renderTabs(store)` — defined Task 3, called in Task 6's `renderActive` ✓
- `saveSession`/`loadSession` — defined Task 2, called in Task 6 ✓
- `read_file` Rust command — added Task 7, invoked as `invoke('read_file', { path })` in Task 6 ✓
- `open-file` event payload shape `{path, content}` — emitted in lib.rs (Task 5) and consumed in Task 6 ✓
- Tauri command names registered in `lib.rs` match the `invoke(...)` calls in Task 6: `open_file`, `save_file`, `save_file_as`, `read_file`, `watch_path`, `get_initial_file` ✓
