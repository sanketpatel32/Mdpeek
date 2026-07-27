# Project-wide Find & Replace — Design

**Date:** 2026-07-27
**Feature:** Extend the existing folder search panel from find-only to find-and-replace across multiple files.
**Approach:** Hybrid — pure substitution logic in JS (`src/lib/replace.js`), batched file I/O in Rust (`read_files_batch` / `write_files_batch`), orchestration in the panel view.

---

## 1. Goal

The folder search panel (`src/views/folder-search.js`) currently finds matches across a folder but cannot modify them. This feature adds the ability to replace matches across all files in the searched folder, with a live preview, a confirmation step, open-tab synchronization, a dirty-file guard, and single-level undo.

## 2. Non-goals (out of scope for v1)

- Regular-expression matching (plain substring only, mirroring existing search).
- Whole-word matching.
- A full diff view (the preview shows per-line before/after, not a unified diff).
- A multi-level undo stack (single-level undo only).
- Per-match selective replace (replace is all-or-nothing per file or per folder).

The pure module's option shape is designed so these can be added later without changing call sites.

## 3. Architecture

Three layers, cleanly separated:

```
src/lib/replace.js          ← pure substitution logic (unit-tested; powers preview)
src-tauri/src/commands.rs   ← read_files_batch / write_files_batch (I/O only, no logic)
src/views/folder-search.js  ← orchestration: search → preview → replace → undo
```

### Replace-All flow

1. User expands the replace row, types a replacement, clicks **Replace All**.
2. Panel takes the paths-with-matches from the existing `search_in_folder` results.
3. `read_files_batch(paths)` — Rust reads all N files in one IPC call.
4. For each file, JS runs pure `applyReplacements(content, query, replacement, opts)` → collects `{ path, oldContent, newContent, count }`.
5. **Dirty guard:** skip any path that is open in a tab with unsaved edits (asked via the `isDirty` callback).
6. `write_files_batch(writes)` — Rust writes all files in one IPC call.
7. **Open-tab sync:** for each written path open in a clean tab, update `doc.content` + `editor.setValue()` in memory.
8. Store undo snapshot; re-run search to show remaining matches.

### Per-file replace flow

Same as Replace-All but scoped to a single file-group's path (step 2 uses one path instead of all).

## 4. Pure module — `src/lib/replace.js`

The substitution engine. No DOM, no IPC — fully unit-testable. The same functions power the live preview, so preview and actual replace can never diverge.

### API

```js
// Find every occurrence (not just first-per-line like search_in_folder).
// Returns match offsets in the original string.
findAllMatches(content, query, { caseSensitive }) → [{ start, end }, …]

// Apply replacement, return new content + count of replacements made.
applyReplacements(content, query, replacement, { caseSensitive })
  → { result: string, count: number }
```

### Behavior

- Plain substring match (mirrors existing `search_in_folder`); case-sensitive toggle.
- `replacement` may be empty (delete) or longer than `query`.
- Non-overlapping, left-to-right matching: after a match at `[start, end)`, the next search begins at `end`. This is overlap-safe and prevents infinite loops when `query` is a substring of `replacement`.
- Case-insensitive mode lowercases both haystack and needle for matching; the replacement text is inserted verbatim (not re-cased).
- Multibyte/Unicode-safe: offsets are character-based, not byte-based.

### Tests — `test/replace.test.js`

- Basic single replacement.
- Multiple matches on one line.
- Multiple matches across multiple lines.
- Case-sensitive vs case-insensitive.
- Empty replacement (deletion).
- No matches → `count: 0`, content unchanged.
- Query is a substring of replacement (no infinite loop, e.g. query `"a"`, replacement `"aa"`).
- Overlapping-safe (e.g. query `"aa"` in `"aaaa"` → 2 matches, not 3).
- Multibyte/Unicode (e.g. emoji, accented chars) offsets correct.
- `findAllMatches` returns offsets that `applyReplacements` honors.

## 5. Rust batch I/O — `src-tauri/src/commands.rs`

Two thin, reusable commands. I/O only — no substitution logic (that stays in JS).

### API

```rust
read_files_batch(paths: Vec<String>)
  → Vec<FileReadResult { path: String, content: Option<String>, error: Option<String> }>

write_files_batch(writes: Vec<FileWrite { path: String, content: String }>)
  → Vec<FileWriteResult { path: String, ok: bool, error: Option<String> }>
```

### Behavior

- `read_files_batch` reuses the binary-skip / lossy-UTF-8 read path from `search_in_folder` (the `search_is_binary_ext` + `search_looks_binary` helpers). A file that is binary or unreadable returns `content: None` + `error: Some(msg)`; it does not abort the batch.
- `write_files_batch` writes each file's content via the same `fs::write` used by `save_file`. Per-file error isolation: one unwritable file returns `ok: false` + `error`; the rest still write.
- Both commands are registered in the Tauri command handler list alongside `search_in_folder`.

## 6. Panel UI — `src/views/folder-search.js`

Mirrors the find-bar's replace UX for muscle memory.

### Layout

- **Replace row** (chevron-toggle, like find-bar): replace input + **Replace All** button + **Undo** button. Hidden by default; expanded via a chevron next to the case toggle or by typing in the replace input.
- **Per-file replace:** a small "Replace" button on each file-group header (replaces all matches in that one file only).
- **Live preview:** when a replacement is typed, each match row shows the post-replace line (old match struck through → new text). This per-row preview operates only on the line text already fetched by `search_in_folder` (no file re-read), so it is **best-effort**: it shows the first match per line (the search cap) and does not reflect multiple matches on one line.
- **Count badge:** while a replacement is typed, the badge shows the search match count (a lower bound — it may undercount when a line has multiple matches). The **true** replacement count is computed by `applyReplacements` on full file content and shown in the confirm dialog (§6) before anything is written.

### Confirm step

Before writing, a confirmation dialog:

> Replace N occurrences across M files? (K skipped: unsaved changes)

- `N` = total replacements projected by `applyReplacements` across all non-skipped files.
- `M` = number of files that will be written.
- `K` = number of files skipped because they are open with unsaved edits.
- If `K > 0`, the skipped files are listed (paths) in the dialog body.
- User confirms or cancels. On cancel, nothing is written.

### Shortcuts

- `Alt+A` — Replace All (matches find-bar's replace-all binding).
- `Alt+Enter` — replace in the focused file-group (matches find-bar's replace binding).
- `Esc` — close panel (existing).

## 7. Open-tab sync & dirty guard

The panel is a singleton and does not know about tabs. `main.js` extends the init contract:

```js
initFolderSearch({
  onOpen,                              // existing: (path, line, query) => void
  isDirty: (path) => boolean,          // is this path open in a tab with unsaved edits?
  updateOpenDoc: (path, newContent) => void,  // sync a clean open tab after write
})
```

### Behavior

- **Dirty file** → skipped, reported in the confirm dialog, never clobbered. This mirrors the existing `file-changed` watcher guard (`src/main.js:5811`), which refuses to overwrite unsaved edits.
- **Clean open tab** → written to disk *and* updated in memory (`doc.content` + `editor.setValue()`), so the editor reflects the change without waiting for a watcher round-trip. The watcher is non-recursive on the active doc only, so non-active open tabs would not otherwise reload.
- **Not open in any tab** → written to disk only.

`main.js` implements `isDirty` by scanning `store.docs` (the public array on `DocumentStore`) for a doc with `doc.path === path` and `doc.dirty === true`, and `updateOpenDoc` by finding the matching doc and calling its editor's `setValue` + clearing dirty (the content now matches disk).

## 8. Undo

Single-level (standard for cross-file replace).

- After a successful replace, store `lastReplace = [{ path, oldContent }]` (only files actually written).
- **Undo** button calls `write_files_batch` with the old contents and restores open tabs via `updateOpenDoc`.
- **Staleness guard:** before restoring a file, re-read its current content (or check the open tab's content). If it no longer equals what we wrote (user edited it since the replace), skip restoring that file and report it in a toast — never clobber post-replace edits.
- Undo clears the snapshot (button disables). A new replace overwrites the snapshot.

## 9. Error handling

- **Read failure** (per file): reported in the confirm dialog as a skipped file; replace proceeds for the rest.
- **Write failure** (per file): reported in a toast after the batch; files that wrote successfully are still applied + synced + undoable.
- **Empty query or replacement:** Replace All is disabled when the find query is empty. An empty *replacement* is allowed (means deletion).
- **No matches:** Replace All is disabled (no-op).

## 10. Testing strategy

- **Pure module** (`test/replace.test.js`): full unit coverage per §4. This is the core of the feature and must be green before any UI work.
- **Rust commands**: covered by the existing manual build/run; the logic is thin I/O. (The project's Vitest suite does not cover Rust.)
- **Panel orchestration**: manual verification — replace across a small test folder, confirm open-tab sync, confirm dirty guard, confirm undo, confirm per-file replace.

## 11. Files touched

| File | Change |
| --- | --- |
| `src/lib/replace.js` | **New** — pure substitution module. |
| `test/replace.test.js` | **New** — unit tests for the pure module. |
| `src-tauri/src/commands.rs` | Add `read_files_batch` + `write_files_batch` + result structs; register in command list. |
| `src/views/folder-search.js` | Add replace row, per-file replace, live preview, confirm dialog, undo, orchestration. |
| `src/main.js` | Extend `initFolderSearch` call with `isDirty` + `updateOpenDoc` callbacks. |
| `src/styles/content.css` (or base.css) | Styles for the replace row, preview strike-through, per-file replace button. |
| `README.md` | Note the feature under "File explorer" (project-wide find & replace). |
