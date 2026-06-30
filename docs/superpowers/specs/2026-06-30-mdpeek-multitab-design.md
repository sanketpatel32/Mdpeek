# mdpeek — Multi-tab + Session Restore (v0.0.8)

**Date:** 2026-06-30
**Version:** 0.0.8
**Status:** Approved

## Goal

Transform mdpeek from a single-document viewer into a multi-tab editor with session restore. Reopen the app and your tabs come back.

## Confirmed scope (user decisions)

- **Tabs in one window** (not multi-window)
- **Three ways to open a tab:**
  1. Drag-drop / `Ctrl+O` (file on disk)
  2. `Ctrl+N` (blank "Untitled" tab)
  3. External double-click of a `.md` while mdpeek is already running (routes to existing window as a new tab)
- **Session restore:** remember open file paths + active tab + Untitled contents. On relaunch, re-read files from disk.
- **Open existing file = switch to its tab** (no duplicates).

## Architecture — the core refactor

The current app has one global `state = {path, content, mode, editor}`. The toolbar, viewer, editor, watcher, and shortcuts all read/write this single object. That is the core thing that must change.

New model: a list of `Document` objects, one per tab. The toolbar and viewport operate on the *active* document.

```
┌──────────────────────────────────────────────────────────┐
│  Toolbar (operates on activeDoc)                          │
├──────────────────────────────────────────────────────────┤
│  Tab Strip: [README.md ×] [notes.md ×] [Untitled ×] [+]  │  ← new
├──────────────────────────────────────────────────────────┤
│  Viewport: shows activeDoc's content                      │
│  (either viewer or editor split-pane)                     │
└──────────────────────────────────────────────────────────┘
```

### Document model (per tab)

```js
{
  id: string,          // unique, stable across session for untitled tracking
  path: string|null,   // null = Untitled (not yet saved)
  content: string,     // current text
  mode: 'view'|'edit', // per-tab mode
  dirty: boolean,      // unsaved changes (dot shown in tab)
  scrollY: number,     // restored when switching back
  editor: Editor|null, // lazy-init when first entering edit mode
}
```

### Behavioral rules

- Single shared viewport (`#document`, `#editor`, `#preview` stay in the DOM). Switching tabs swaps which Document renders into them, preserving scroll.
- File watcher: rewatched on tab switch (one watcher at a time, on the active doc's path).
- Tab strip: clickable tabs, middle-click or `×` to close, `+` button = Ctrl+N.
- Close with unsaved changes: confirm dialog ("Save / Don't save / Cancel").
- Opening an already-open file: if `docs.find(d => d.path === path)` exists, switch to it; else new tab.

## Components

| Component | Change |
|---|---|
| `src/lib/documents.js` | **NEW** — `Document` class + `DocumentStore` (the list, active-tab pointer, persistence, event emission). Pure logic, unit-testable. |
| `src/lib/persistence.js` | **NEW** — save/load session JSON to `localStorage` (paths, activeId, untitled contents). |
| `src/views/tabs.js` | **NEW** — render the tab strip from DocumentStore; handle click/close/new. |
| `src/main.js` | **Major refactor** — replace global `state` with DocumentStore; toolbar/shortcuts/drag-drop/watcher all operate on active doc. |
| `src/views/viewer.js`, `src/views/editor.js` | Minor — accept a Document, render into given elements. |
| `index.html` | Add `<div id="tab-strip">` above the viewport; New button wired to Ctrl+N. |
| `src/styles/base.css` | Add `.tab-strip`, `.tab`, `.tab.active`, `.tab.dirty`, `.tab-new` styles. |
| `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs` | Add `tauri-plugin-single-instance` so 2nd launch routes to existing window + forwards argv. |

## Data flow

1. **Launch:** DocumentStore loads from `localStorage` → re-reads each path's content from disk → renders tabs. If empty, creates one Untitled tab.
2. **Open file (Ctrl+O / drop / double-click):** if path open → switch; else `store.open({path, content})` → renders new tab + switches.
3. **New tab (Ctrl+N):** `store.open({path: null, content: ''})` → "Untitled N" tab.
4. **Switch tab:** store current scroll → load active doc's content/mode into viewport → rewatch its file.
5. **Edit + save:** marks doc dirty → Ctrl+S writes to disk (or Save-As if Untitled) → clears dirty, updates path/title.
6. **Close tab:** if dirty → confirm → remove → if no tabs left, create one Untitled.
7. **External double-click (mdpeek already running):** single-instance plugin focuses window + forwards path as an event → frontend opens as new tab.
8. **Quit/relaunch:** DocumentStore auto-persists on every change → next launch restores.

## Error handling

- File deleted between sessions: show tab with a "[file missing]" marker, keep last-known content, allow save-as.
- File unreadable at open: toast error, don't create tab.
- Corrupt session JSON: ignore, start fresh with one Untitled.

## Testing

- `DocumentStore` unit tests (Vitest): open/switch/close, no-duplicate-paths, dirty tracking, serialize/restore round-trip, untitled-content persistence. Core logic, fully unit-testable.
- Manual smoke test: open 3 files as tabs, switch between them (scroll preserved), Ctrl+N new tab, close-with-unsaved confirm, quit + relaunch → tabs restored, external double-click opens in running instance.

## Out of scope (v0.0.8) — YAGNI

- Tab drag-to-reorder
- Pin tabs / tab groups
- Split-view (two docs side by side)
- Search across tabs
- Recently-closed tab restore (Ctrl+Shift+T)

## Delivery

v0.0.8 — single release. Build, sign, publish → existing v0.0.7 installs auto-update to it.

## Risk

This is the biggest change yet. The single-document → multi-document refactor touches almost every frontend file. All current features (viewer/editor/theme/updater/file-open) are preserved, but internals get restructured. The renderer (`src/lib/renderer.js`) is untouched and its tests remain green throughout.
