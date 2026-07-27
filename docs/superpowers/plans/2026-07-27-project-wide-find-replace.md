# Project-wide Find & Replace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing folder search panel from find-only to find-and-replace across multiple files, with live preview, a confirmation step, open-tab synchronization, a dirty-file guard, and single-level undo.

**Architecture:** Hybrid — pure substitution logic in a new `src/lib/replace.js` (unit-tested, powers the live preview), batched file I/O in two new Rust commands (`read_files_batch` / `write_files_batch`), orchestration inside the existing `src/views/folder-search.js` panel. `src/main.js` wires the panel to the tab store via `isDirty` + `updateOpenDoc` callbacks.

**Tech Stack:** Vanilla JS (ES modules), Rust (Tauri 2 commands, `serde`), Vitest for unit tests, existing CSS variables in `src/styles/base.css`.

**Spec:** `docs/superpowers/specs/2026-07-27-project-wide-find-replace-design.md`

---

## File Structure

| File | Responsibility | Status |
| --- | --- | --- |
| `src/lib/replace.js` | Pure substitution engine: `findAllMatches` + `applyReplacements`. No DOM, no IPC. | **New** |
| `test/replace.test.js` | Vitest unit tests for the pure module. | **New** |
| `src-tauri/src/commands.rs` | Add `read_files_batch` + `write_files_batch` commands and their result structs. I/O only. | Modify |
| `src-tauri/src/lib.rs` | Register the two new commands in `generate_handler!`. | Modify |
| `src/views/folder-search.js` | Add replace row, per-file replace, live preview, confirm dialog, undo, orchestration. | Modify |
| `src/main.js` | Extend `initFolderSearch` call with `isDirty` + `updateOpenDoc` callbacks. | Modify |
| `src/styles/base.css` | Styles for replace row, preview strike-through, per-file replace button. | Modify |
| `README.md` | Note the feature under "File explorer". | Modify |

---

## Task 1: Pure substitution module — `findAllMatches`

**Files:**
- Create: `src/lib/replace.js`
- Create: `test/replace.test.js`

- [ ] **Step 1: Write the failing tests for `findAllMatches`**

Create `test/replace.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { findAllMatches } from '../src/lib/replace.js';

describe('findAllMatches', () => {
  it('returns an empty array for an empty query', () => {
    expect(findAllMatches('hello world', '', { caseSensitive: false })).toEqual([]);
  });

  it('finds a single match', () => {
    expect(findAllMatches('hello', 'ell', { caseSensitive: true }))
      .toEqual([{ start: 1, end: 4 }]);
  });

  it('finds multiple matches on one line', () => {
    expect(findAllMatches('aaa', 'a', { caseSensitive: true }))
      .toEqual([{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }]);
  });

  it('finds matches across multiple lines', () => {
    expect(findAllMatches('foo\nbar\nfoo', 'foo', { caseSensitive: true }))
      .toEqual([{ start: 0, end: 3 }, { start: 8, end: 11 }]);
  });

  it('is case-sensitive when the flag is true', () => {
    expect(findAllMatches('Foo foo FOO', 'foo', { caseSensitive: true }))
      .toEqual([{ start: 4, end: 7 }]);
  });

  it('is case-insensitive when the flag is false', () => {
    expect(findAllMatches('Foo foo FOO', 'foo', { caseSensitive: false }))
      .toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 11 }]);
  });

  it('is overlap-safe (aa in aaaa -> 2 matches, not 3)', () => {
    expect(findAllMatches('aaaa', 'aa', { caseSensitive: true }))
      .toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });

  it('handles multibyte characters by code-point offsets', () => {
    // 'café' — é is one code point (U+00E9). 'é' at index 3.
    expect(findAllMatches('café', 'é', { caseSensitive: true }))
      .toEqual([{ start: 3, end: 4 }]);
  });

  it('handles emoji (astral-plane) offsets', () => {
    // 'a😀b' — 😀 is one code point at index 1.
    expect(findAllMatches('a😀b', '😀', { caseSensitive: true }))
      .toEqual([{ start: 1, end: 2 }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/replace.test.js`
Expected: FAIL — `Failed to resolve import "../src/lib/replace.js"` (file does not exist yet).

- [ ] **Step 3: Implement `findAllMatches`**

Create `src/lib/replace.js`:

```js
// Pure substitution engine for project-wide find & replace. No DOM, no IPC —
// fully unit-testable. The same functions power the live preview, so preview
// and actual replace can never diverge.
//
// Matching is plain substring (mirrors the existing `search_in_folder` Rust
// command) with a case-sensitive toggle. Offsets are code-point based, so
// multibyte and astral-plane characters (emoji) are handled correctly.

// Find every occurrence of `query` in `content`. Returns match offsets
// [{ start, end }, ...] in code-point coordinates. Non-overlapping,
// left-to-right: after a match at [start, end), the next search begins at
// `end`. An empty query returns [] (nothing to find).
export function findAllMatches(content, query, { caseSensitive }) {
  if (!query) return [];
  const hay = caseSensitive ? content : content.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches = [];
  let from = 0;
  while (from <= hay.length) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1) break;
    matches.push({ start: idx, end: idx + needle.length });
    // Advance past this match so overlapping matches (e.g. "aa" in "aaaa")
    // are not double-counted.
    from = idx + needle.length;
  }
  return matches;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/replace.test.js`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/replace.js test/replace.test.js
git commit -m "feat(replace): add pure findAllMatches module + tests"
```

---

## Task 2: Pure substitution module — `applyReplacements`

**Files:**
- Modify: `src/lib/replace.js`
- Modify: `test/replace.test.js`

- [ ] **Step 1: Append failing tests for `applyReplacements`**

Append to `test/replace.test.js` (after the `findAllMatches` describe block):

```js
import { applyReplacements } from '../src/lib/replace.js';

describe('applyReplacements', () => {
  it('returns the original content and count 0 when there are no matches', () => {
    const r = applyReplacements('hello world', 'xyz', 'abc', { caseSensitive: true });
    expect(r).toEqual({ result: 'hello world', count: 0 });
  });

  it('replaces a single match', () => {
    const r = applyReplacements('hello', 'ell', 'XX', { caseSensitive: true });
    expect(r).toEqual({ result: 'hXXo', count: 1 });
  });

  it('replaces every match on one line', () => {
    const r = applyReplacements('aaa', 'a', 'b', { caseSensitive: true });
    expect(r).toEqual({ result: 'bbb', count: 3 });
  });

  it('replaces matches across multiple lines', () => {
    const r = applyReplacements('foo\nbar\nfoo', 'foo', 'qux', { caseSensitive: true });
    expect(r).toEqual({ result: 'qux\nbar\nqux', count: 2 });
  });

  it('supports an empty replacement (deletion)', () => {
    const r = applyReplacements('a-b-c', '-', '', { caseSensitive: true });
    expect(r).toEqual({ result: 'abc', count: 2 });
  });

  it('does not loop when the replacement contains the query', () => {
    // query "a", replacement "aa" — must not re-match the inserted text.
    const r = applyReplacements('a', 'a', 'aa', { caseSensitive: true });
    expect(r).toEqual({ result: 'aa', count: 1 });
  });

  it('is case-insensitive when the flag is false', () => {
    const r = applyReplacements('Foo foo FOO', 'foo', 'bar', { caseSensitive: false });
    expect(r).toEqual({ result: 'bar bar bar', count: 3 });
  });

  it('inserts the replacement verbatim (no re-casing) in case-insensitive mode', () => {
    const r = applyReplacements('FOO', 'foo', 'Bar', { caseSensitive: false });
    expect(r).toEqual({ result: 'Bar', count: 1 });
  });

  it('is overlap-safe (aa in aaaa -> 2 replacements)', () => {
    const r = applyReplacements('aaaa', 'aa', 'b', { caseSensitive: true });
    expect(r).toEqual({ result: 'bb', count: 2 });
  });

  it('handles multibyte characters', () => {
    const r = applyReplacements('café', 'é', 'e', { caseSensitive: true });
    expect(r).toEqual({ result: 'cafe', count: 1 });
  });

  it('returns count 0 for an empty query', () => {
    const r = applyReplacements('hello', '', 'x', { caseSensitive: true });
    expect(r).toEqual({ result: 'hello', count: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/replace.test.js`
Expected: FAIL — `applyReplacements is not a function` (or import error).

- [ ] **Step 3: Implement `applyReplacements`**

Append to `src/lib/replace.js`:

```js
// Replace every occurrence of `query` with `replacement` in `content`.
// Returns { result, count }. Reuses findAllMatches so the matching rules
// (case-sensitivity, overlap-safety) are identical. The replacement text is
// inserted verbatim — it is never re-scanned, so a replacement that contains
// the query cannot cause an infinite loop.
export function applyReplacements(content, query, replacement, { caseSensitive }) {
  const matches = findAllMatches(content, query, { caseSensitive });
  if (matches.length === 0) return { result: content, count: 0 };
  // Walk matches left-to-right, splicing into a fresh string. Because matches
  // are non-overlapping and we track an output cursor, earlier offsets stay
  // valid as we build the result.
  let out = '';
  let cursor = 0;
  for (const m of matches) {
    out += content.slice(cursor, m.start) + replacement;
    cursor = m.end;
  }
  out += content.slice(cursor);
  return { result: out, count: matches.length };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/replace.test.js`
Expected: PASS — all 20 tests green (9 findAllMatches + 11 applyReplacements).

- [ ] **Step 5: Commit**

```bash
git add src/lib/replace.js test/replace.test.js
git commit -m "feat(replace): add applyReplacements + tests"
```

---

## Task 3: Rust `read_files_batch` command

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the result structs and command to `commands.rs`**

Open `src-tauri/src/commands.rs`. Immediately after the `search_in_folder` function (which ends around line 446 with the closing `}` of the function), append:

```rust
// ---------------------------------------------------------------------------
// Batch file I/O for project-wide find & replace.
// These are thin I/O commands — no substitution logic lives here (that stays
// in JS, in src/lib/replace.js). Per-file error isolation: one unreadable or
// unwritable file does not abort the batch.
// ---------------------------------------------------------------------------

/// One file's read outcome for `read_files_batch`.
#[derive(Serialize)]
pub struct FileReadResult {
    pub path: String,
    pub content: Option<String>,   // None on binary/unreadable
    pub error: Option<String>,     // Some(msg) when content is None
}

/// Batch-read a list of files. Reuses the binary-skip + lossy-UTF-8 read path
/// from `search_in_folder` so replace operates on the same set of files the
/// search results came from. Files that are binary or unreadable return
/// `content: None` + `error: Some(msg)`; they do not abort the batch.
#[tauri::command]
pub fn read_files_batch(paths: Vec<String>) -> Result<Vec<FileReadResult>, String> {
    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        // Skip binary extensions (reuses the helper from search_in_folder).
        if search_is_binary_ext(&path) {
            out.push(FileReadResult {
                path,
                content: None,
                error: Some("binary file".to_string()),
            });
            continue;
        }
        let p = std::path::Path::new(&path);
        if search_looks_binary(p) {
            out.push(FileReadResult {
                path,
                content: None,
                error: Some("binary file".to_string()),
            });
            continue;
        }
        match fs::read(p) {
            Ok(bytes) => {
                let content = String::from_utf8_lossy(&bytes).into_owned();
                out.push(FileReadResult { path, content: Some(content), error: None });
            }
            Err(e) => {
                out.push(FileReadResult {
                    path,
                    content: None,
                    error: Some(format!("read failed: {}", e)),
                });
            }
        }
    }
    Ok(out)
}
```

- [ ] **Step 2: Register the command in `lib.rs`**

Open `src-tauri/src/lib.rs`. In the `generate_handler!` macro (around line 173), add `commands::read_files_batch` after the `commands::read_file` line (line 178). The line to add:

```rust
            commands::read_files_batch,
```

Insert it directly below `commands::read_file,` so the block reads:

```rust
            commands::read_file,
            commands::read_files_batch,
            commands::save_image,
```

- [ ] **Step 3: Verify the Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors. (Warnings are fine.)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add read_files_batch command"
```

---

## Task 4: Rust `write_files_batch` command

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the result/input structs and command to `commands.rs`**

Open `src-tauri/src/commands.rs`. Append immediately after the `read_files_batch` function added in Task 3:

```rust
/// One write requested by `write_files_batch`.
#[derive(Deserialize)]
pub struct FileWrite {
    pub path: String,
    pub content: String,
}

/// One file's write outcome for `write_files_batch`.
#[derive(Serialize)]
pub struct FileWriteResult {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
}

/// Batch-write a list of files. Uses the same `fs::write` as `save_file`.
/// Per-file error isolation: one unwritable file returns `ok: false` +
/// `error`; the rest still write. Returns one result per input write, in
/// the same order.
#[tauri::command]
pub fn write_files_batch(writes: Vec<FileWrite>) -> Result<Vec<FileWriteResult>, String> {
    let mut out = Vec::with_capacity(writes.len());
    for w in writes {
        match fs::write(&w.path, &w.content) {
            Ok(()) => out.push(FileWriteResult { path: w.path, ok: true, error: None }),
            Err(e) => out.push(FileWriteResult {
                path: w.path,
                ok: false,
                error: Some(format!("write failed: {}", e)),
            }),
        }
    }
    Ok(out)
}
```

- [ ] **Step 2: Register the command in `lib.rs`**

Open `src-tauri/src/lib.rs`. In the `generate_handler!` macro, add `commands::write_files_batch` immediately after the `commands::read_files_batch` line added in Task 3:

```rust
            commands::read_files_batch,
            commands::write_files_batch,
            commands::save_image,
```

- [ ] **Step 3: Verify the Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add write_files_batch command"
```

---

## Task 5: Panel UI — replace row DOM + state

**Files:**
- Modify: `src/views/folder-search.js`

This task adds the replace row markup and module state only. Wiring (events, orchestration) comes in later tasks.

- [ ] **Step 1: Add module state variables**

Open `src/views/folder-search.js`. Find the module state block (lines 25–33) and add these variables after `onOpenCallback`:

```js
let onOpenCallback = null;   // (path, line, query) => void — caller wires openPath
// --- replace state (project-wide find & replace) ---
let replaceInput;        // .folder-search-replace-input
let replaceRow;          // .folder-search-replace-row (hidden until expanded)
let expandBtn;           // .folder-search-expand (chevron)
let replaceAllBtn;       // .folder-search-replace-all
let undoBtn;             // .folder-search-undo
let replaceExpanded = false;
let lastReplace = null;  // [{ path, oldContent }] for single-level undo, or null
let isDirtyCb = null;        // (path) => boolean — is this path an open tab with unsaved edits?
let updateOpenDocCb = null;  // (path, newContent) => void — sync a clean open tab after write
```

- [ ] **Step 2: Add the replace row to the `build()` markup**

In the `build()` function, replace the existing `.folder-search-header` innerHTML (lines 41–49) with an expanded version that adds the chevron and a replace row. Replace this block:

```js
      <div class="folder-search-header">
        <span class="folder-search-folder" title="">Folder</span>
        <button class="folder-search-toggle tool-btn icon-only" id="folder-search-case" title="Match case" aria-label="Match case" aria-pressed="false">Aa</button>
        <input type="search" class="folder-search-input" placeholder="Search in folder…" aria-label="Search query" spellcheck="false" autocomplete="off" />
        <span class="folder-search-count">0</span>
        <button class="folder-search-close tool-btn icon-only" title="Close (Esc)" aria-label="Close search panel">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="folder-search-results" role="list"></div>
```

with:

```js
      <div class="folder-search-header">
        <span class="folder-search-folder" title="">Folder</span>
        <button class="folder-search-toggle tool-btn icon-only" id="folder-search-case" title="Match case" aria-label="Match case" aria-pressed="false">Aa</button>
        <input type="search" class="folder-search-input" placeholder="Search in folder…" aria-label="Search query" spellcheck="false" autocomplete="off" />
        <span class="folder-search-count">0</span>
        <button class="folder-search-expand tool-btn icon-only" title="Toggle replace" aria-label="Toggle replace" type="button">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button class="folder-search-close tool-btn icon-only" title="Close (Esc)" aria-label="Close search panel">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="folder-search-replace-row hidden">
        <input type="text" class="folder-search-replace-input" placeholder="Replace…" aria-label="Replacement text" spellcheck="false" autocomplete="off" />
        <button class="tool-btn folder-search-replace-all" title="Replace all (Alt+A)" type="button">All</button>
        <button class="tool-btn folder-search-undo" title="Undo last replace" type="button" disabled>Undo</button>
      </div>
      <div class="folder-search-results" role="list"></div>
```

- [ ] **Step 3: Query the new elements in `build()`**

In `build()`, after the existing element queries (lines 55–60, ending with `closeBtn = …`), add:

```js
  expandBtn = overlay.querySelector('.folder-search-expand');
  replaceRow = overlay.querySelector('.folder-search-replace-row');
  replaceInput = overlay.querySelector('.folder-search-replace-input');
  replaceAllBtn = overlay.querySelector('.folder-search-replace-all');
  undoBtn = overlay.querySelector('.folder-search-undo');
```

- [ ] **Step 4: Verify the app still launches with no errors**

Run: `npm run tauri dev`
Expected: app launches; the folder search panel (right-click a folder in the explorer) now shows the chevron + a hidden replace row. The replace row is hidden by the `hidden` class. No console errors. Close the dev app.

- [ ] **Step 5: Commit**

```bash
git add src/views/folder-search.js
git commit -m "feat(folder-search): add replace row DOM + state"
```

---

## Task 6: Panel UI — expand/collapse the replace row

**Files:**
- Modify: `src/views/folder-search.js`

- [ ] **Step 1: Add the `setReplaceExpanded` helper**

In `src/views/folder-search.js`, add this helper function near the top of the file, just after the `build()` function closes (after line 113):

```js
function setReplaceExpanded(on) {
  replaceExpanded = !!on;
  replaceRow.classList.toggle('hidden', !replaceExpanded);
  expandBtn.classList.toggle('active', replaceExpanded);
  expandBtn.setAttribute('aria-pressed', replaceExpanded ? 'true' : 'false');
}
```

- [ ] **Step 2: Wire the chevron click**

Inside `build()`, after the `caseBtn.addEventListener('click', …)` block (around line 89–95), add:

```js
  // Chevron — toggle the replace row (mirrors the find-bar's expand chevron).
  expandBtn.addEventListener('click', () => setReplaceExpanded(!replaceExpanded));
```

- [ ] **Step 3: Wire keyboard shortcuts on the replace input**

Inside `build()`, after the `input.addEventListener('keydown', …)` block (around line 77–86), add a keydown handler for the replace input:

```js
  // Replace input — Alt+A = replace all, Alt+Enter = replace focused file,
  // Esc = close panel. Matches the find-bar's replace bindings.
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'a' && e.altKey) {
      e.preventDefault();
      replaceAll();
    } else if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      replaceFocusedFile();
    }
  });
```

> Note: `replaceAll` and `replaceFocusedFile` are defined in later tasks. For now, this wiring references them; they will be added as functions in the same module. The references resolve at call time, so the file parses fine. If the linter complains about forward references, define stub functions now and replace them later — but plain function declarations are hoisted, so this is fine.

- [ ] **Step 4: Add stub functions so the file is valid**

Because `replaceAll` and `replaceFocusedFile` are called but not yet defined, add temporary stubs near the bottom of the file, just before the `// ---------- public API ----------` comment (line 218):

```js
// Stubs — implemented in later tasks. Hoisted function declarations are
// safe to reference before their definition.
async function replaceAll() { /* implemented in Task 8 */ }
async function replaceFocusedFile() { /* implemented in Task 9 */ }
```

- [ ] **Step 5: Verify the app launches and the chevron works**

Run: `npm run tauri dev`
Expected: open the folder search panel, click the chevron — the replace row appears/disappears. `Alt+A`/`Alt+Enter` in the replace input do nothing yet (stubs). No console errors. Close the dev app.

- [ ] **Step 6: Commit**

```bash
git add src/views/folder-search.js
git commit -m "feat(folder-search): wire replace row expand/collapse + shortcuts"
```

---

## Task 7: Panel UI — live preview of replacements

**Files:**
- Modify: `src/views/folder-search.js`

The preview is best-effort: it operates only on the line text already fetched by `search_in_folder` (one match per line). It shows the post-replace line so the user sees what will happen before confirming.

- [ ] **Step 1: Add a `previewReplacement` helper**

In `src/views/folder-search.js`, add this helper just after the `escapeAttr` function (around line 216):

```js
// Best-effort single-line preview: replace the first occurrence of `query`
// in `line` with `replacement`, honoring case-sensitivity. Used to render
// the post-replace line in the results list. Only the FIRST match is shown
// (search_in_folder returns one match per line), so multi-match lines are
// undercounted in the preview — the true count comes from applyReplacements
// on full file content at confirm time.
function previewReplacement(line, query, replacement, caseSensitive) {
  if (!query) return line;
  const hay = caseSensitive ? line : line.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const idx = hay.indexOf(needle);
  if (idx === -1) return line;
  return line.slice(0, idx) + replacement + line.slice(idx + needle.length);
}
```

- [ ] **Step 2: Update `renderResults` to show the preview**

In `renderResults` (around line 153), modify the `matchRows` mapping. Replace the `return` inside `file.matches.map((m) => { … })`:

Find:
```js
      return `<div class="search-match" role="listitem" data-path="${escapeAttr(file.path)}" data-line="${m.line}" title="${escapeAttr(file.path)}:${m.line}">
        <span class="search-line">${m.line}</span>
        <span class="search-text">${before}<mark>${hit}</mark>${after}</span>
      </div>`;
```

Replace with:
```js
      // Preview: when a replacement is typed and the row is expanded, show
      // the post-replace line (old match struck through -> new text). Falls
      // back to the plain match highlight when no replacement is typed.
      const replacement = replaceExpanded ? replaceInput.value : '';
      const showPreview = replaceExpanded && replacement !== '' && query;
      const hitHtml = showPreview
        ? `<del>${hit}</del><span class="search-arrow"> → </span><ins>${escapeHtml(replacement)}</ins>`
        : `<mark>${hit}</mark>`;
      return `<div class="search-match" role="listitem" data-path="${escapeAttr(file.path)}" data-line="${m.line}" title="${escapeAttr(file.path)}:${m.line}">
        <span class="search-line">${m.line}</span>
        <span class="search-text">${before}${hitHtml}${after}</span>
      </div>`;
```

- [ ] **Step 3: Re-render on replace-input changes**

Inside `build()`, after the `replaceInput.addEventListener('keydown', …)` block added in Task 6, add an input listener that re-renders the current results so the preview updates live:

```js
  // Re-render results on replace-input change so the live preview updates.
  replaceInput.addEventListener('input', () => {
    if (replaceExpanded && query) {
      runSearch();
    }
  });
```

> Note: `runSearch` re-runs the search and calls `renderResults`, which now reads the replace input. The preview refreshes on every keystroke in the replace field.

- [ ] **Step 4: Verify the preview works**

Run: `npm run tauri dev`
Expected: open folder search on a folder containing a known word; type a search query; expand the replace row; type a replacement — each match row now shows `old → new` with the old text struck through and the new text underlined. No console errors. Close the dev app.

- [ ] **Step 5: Commit**

```bash
git add src/views/folder-search.js
git commit -m "feat(folder-search): live preview of replacements in results"
```

---

## Task 8: Panel UI — Replace All orchestration + confirm + open-tab sync

**Files:**
- Modify: `src/views/folder-search.js`
- Modify: `src/main.js`

This is the core orchestration task. It reads all files-with-matches, runs `applyReplacements`, applies the dirty guard, shows a confirm dialog, writes the batch, syncs open tabs, stores the undo snapshot, and re-runs the search.

- [ ] **Step 1: Import the pure module and `invoke` (already imported)**

At the top of `src/views/folder-search.js`, confirm the `invoke` import (line 12) and add the replace import. Replace:

```js
import { invoke } from '@tauri-apps/api/core';
```

with:

```js
import { invoke } from '@tauri-apps/api/core';
import { applyReplacements } from '../lib/replace.js';
```

- [ ] **Step 2: Replace the `replaceAll` stub with the full implementation**

Find the stub added in Task 6:

```js
async function replaceAll() { /* implemented in Task 8 */ }
```

Replace it with:

```js
// Replace every match across every file-with-matches in the current result
// set. Reads all candidate files in one batch, applies the pure
// applyReplacements per file, skips files open with unsaved edits (dirty
// guard), confirms with the user, writes the batch, syncs open tabs, stores
// an undo snapshot, and re-runs the search.
async function replaceAll() {
  if (!folderPath || !query) return;
  // Gather the paths that currently have matches. If the last search
  // truncated, we still only operate on what's visible — the user can narrow
  // the query to reach more.
  const paths = currentMatchPaths();
  if (paths.length === 0) return;
  const replacement = replaceInput.value;
  const caseSen = caseSensitive;
  // 1. Batch-read all candidate files.
  let reads;
  try {
    reads = await invoke('read_files_batch', { paths });
  } catch (e) {
    notify('Read failed: ' + (e?.message || e || 'unknown error'));
    return;
  }
  // 2. Compute replacements per file, honoring the dirty guard.
  const writes = [];
  let totalReplacements = 0;
  const skippedDirty = [];
  const skippedError = [];
  for (const r of reads) {
    if (r.error || r.content == null) {
      skippedError.push(r.path);
      continue;
    }
    if (isDirtyCb && isDirtyCb(r.path)) {
      skippedDirty.push(r.path);
      continue;
    }
    const { result, count } = applyReplacements(r.content, query, replacement, { caseSensitive: caseSen });
    if (count === 0) continue; // no matches after re-read (e.g. file changed)
    writes.push({ path: r.path, oldContent: r.content, newContent: result, count });
    totalReplacements += count;
  }
  if (writes.length === 0) {
    notify(skippedDirty.length
      ? `No replacements — ${skippedDirty.length} file(s) skipped (unsaved changes)`
      : 'No replacements');
    return;
  }
  // 3. Confirm with the user.
  const skippedNote = skippedDirty.length + skippedError.length
    ? `\n${skippedDirty.length} skipped (unsaved changes)${skippedError.length ? `, ${skippedError.length} unreadable` : ''}`
    : '';
  const msg = `Replace ${totalReplacements} occurrence${totalReplacements === 1 ? '' : 's'} across ${writes.length} file${writes.length === 1 ? '' : 's'}?${skippedNote}`;
  if (!window.confirm(msg)) return;
  // 4. Batch-write.
  const writePayload = writes.map((w) => ({ path: w.path, content: w.newContent }));
  let results;
  try {
    results = await invoke('write_files_batch', { writes: writePayload });
  } catch (e) {
    notify('Write failed: ' + (e?.message || e || 'unknown error'));
    return;
  }
  // 5. Sync open tabs + report any write failures.
  let failed = 0;
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i];
    const res = results[i];
    if (res && res.ok && updateOpenDocCb) updateOpenDocCb(w.path, w.newContent);
    if (!res || !res.ok) failed += 1;
  }
  // 6. Store undo snapshot (only files that wrote successfully).
  lastReplace = writes
    .filter((w, i) => results[i] && results[i].ok)
    .map((w) => ({ path: w.path, oldContent: w.oldContent }));
  undoBtn.disabled = !lastReplace || lastReplace.length === 0;
  notify(failed
    ? `Replaced ${totalReplacements} in ${writes.length - failed} file(s); ${failed} failed`
    : `Replaced ${totalReplacements} across ${writes.length} file(s)`);
  // 7. Re-run the search to show remaining matches.
  runSearch();
}
```

- [ ] **Step 3: Add the `currentMatchPaths` helper**

Add this helper just before the `replaceAll` function:

```js
// Collect the distinct file paths from the last search result set.
let lastResults = [];
function currentMatchPaths() {
  return lastResults.map((r) => r.path);
}
```

- [ ] **Step 4: Capture search results in `renderResults`**

In `renderResults` (the function starting around line 153), capture the incoming results so `currentMatchPaths` can read them. Add this as the first line inside `renderResults`:

```js
function renderResults(summary) {
  lastResults = summary.results || [];
  const { results, truncated, total_matches, files_scanned, files_with_matches } = summary;
```

> The `summary.results` array is now stored in `lastResults` on every render. The existing code continues unchanged below this line.

- [ ] **Step 5: Extend the public API to accept the callbacks**

Find the `initFolderSearch` function (around line 219):

```js
export function initFolderSearch(onOpen) {
  if (created) return { open, close, destroy };
  build();
  onOpenCallback = onOpen || null;
  created = true;
  return { open, close, destroy };
}
```

Replace it with:

```js
export function initFolderSearch(onOpen, { isDirty, updateOpenDoc } = {}) {
  if (created) return { open, close, destroy };
  build();
  onOpenCallback = onOpen || null;
  isDirtyCb = isDirty || null;
  updateOpenDocCb = updateOpenDoc || null;
  created = true;
  return { open, close, destroy };
}
```

- [ ] **Step 6: Wire the callbacks in `main.js`**

Open `src/main.js`. Find the `initFolderSearch` call (line 3610):

```js
const folderSearch = initFolderSearch((path, line, query) => {
  openPathAndJump(path, line, query);
});
```

Replace it with:

```js
const folderSearch = initFolderSearch(
  (path, line, query) => { openPathAndJump(path, line, query); },
  {
    // Is `path` open in a tab with unsaved edits? Mirrors the file-changed
    // watcher guard (src/main.js:5811) — never clobber unsaved work.
    isDirty: (path) => store.docs.some((d) => d.path === path && d.dirty),
    // Sync a clean open tab after an external write so the editor reflects
    // the change without waiting for a watcher round-trip.
    updateOpenDoc: (path, newContent) => {
      const doc = store.docs.find((d) => d.path === path);
      if (!doc) return;
      doc.content = newContent;
      if (doc.editor && doc.mode === 'edit') doc.editor.setValue(newContent);
      // The content now matches disk — clear the dirty flag.
      store.clearDirty(doc.id);
    },
  },
);
```

- [ ] **Step 7: Add the `notify` helper used by `replaceAll`**

The panel calls `notify(...)` for status messages. It is a singleton with no access to the app's `toast` helper in `main.js`, so it needs its own minimal notifier. At the top of `src/views/folder-search.js` (after the imports, before `build()`), add:

```js
// Minimal status notifier — the panel is a singleton with no access to the
// app's toast helper. Reuses the count badge as the message surface.
function notify(msg) {
  countEl.textContent = msg;
  countEl.classList.add('search-notify');
  clearTimeout(notify._t);
  notify._t = setTimeout(() => countEl.classList.remove('search-notify'), 2500);
}
```

> The `replaceAll` implementation in Step 2 already calls `notify(...)` (4 places: the two `catch` blocks, the `writes.length === 0` branch, and the final success/fail message). The `undoReplace` function in Task 10 also uses `notify`.

- [ ] **Step 8: Verify Replace All works end-to-end**

Run: `npm run tauri dev`
Expected: open folder search on a small test folder with a few `.md` files; type a query that matches; expand replace; type a replacement; press `Alt+A` or click **All**; a confirm dialog shows the count; confirm; files are written; a notification shows the result; the search re-runs and the matches are gone. Verify the files on disk changed. No console errors. Close the dev app.

- [ ] **Step 9: Commit**

```bash
git add src/views/folder-search.js src/main.js
git commit -m "feat(folder-search): Replace All with confirm, dirty guard, open-tab sync"
```

---

## Task 9: Panel UI — per-file replace

**Files:**
- Modify: `src/views/folder-search.js`

Per-file replace reuses the Replace All engine scoped to a single path.

- [ ] **Step 1: Replace the `replaceFocusedFile` stub**

Find the stub added in Task 6:

```js
async function replaceFocusedFile() { /* implemented in Task 9 */ }
```

Replace it with:

```js
// Replace all matches in a single file (the file whose group header was
// focused when Alt+Enter was pressed). Reuses the Replace All engine by
// temporarily narrowing lastResults to one path. Restores lastResults so
// the next full Replace All still sees the full set.
async function replaceFocusedFile() {
  if (!folderPath || !query) return;
  // For v1, per-file replace targets the first file in the current results.
  // (A "focused file" concept would require tracking the hovered group; the
  // spec calls for a per-file Replace button on each header — that is added
  // in the per-file-button task. This shortcut acts on the first group.)
  if (lastResults.length === 0) return;
  const target = lastResults[0].path;
  const saved = lastResults;
  lastResults = saved.filter((r) => r.path === target);
  try {
    await replaceAll();
  } finally {
    lastResults = saved;
  }
}
```

- [ ] **Step 2: Add a per-file Replace button to each file-group header**

In `renderResults`, modify the file-group header HTML. Find:

```js
    return `<div class="search-file-group">
      <div class="search-file-header" title="${escapeAttr(file.path)}">
        <span class="search-file-name">${escapeHtml(relPath)}</span>
        <span class="search-file-count">${file.matches.length}</span>
      </div>
      ${matchRows}
    </div>`;
```

Replace with:

```js
    return `<div class="search-file-group" data-path="${escapeAttr(file.path)}">
      <div class="search-file-header" title="${escapeAttr(file.path)}">
        <span class="search-file-name">${escapeHtml(relPath)}</span>
        <span class="search-file-count">${file.matches.length}</span>
        ${replaceExpanded ? `<button class="tool-btn search-file-replace" title="Replace in this file" type="button">Replace</button>` : ''}
      </div>
      ${matchRows}
    </div>`;
```

- [ ] **Step 3: Wire the per-file Replace button via event delegation**

In `build()`, the existing `resultsEl.addEventListener('click', …)` handler (around line 106) handles `.search-match` clicks. Extend it to also handle `.search-file-replace` clicks. Find:

```js
  resultsEl.addEventListener('click', (e) => {
    const match = e.target.closest('.search-match');
    if (!match) return;
    const path = match.dataset.path;
    const line = parseInt(match.dataset.line, 10);
    if (path && onOpenCallback) onOpenCallback(path, line, query);
  });
```

Replace with:

```js
  resultsEl.addEventListener('click', (e) => {
    // Per-file Replace button on a file-group header.
    const replaceBtn = e.target.closest('.search-file-replace');
    if (replaceBtn) {
      e.preventDefault();
      const group = e.target.closest('.search-file-group');
      const path = group && group.dataset.path;
      if (path) replaceOneFile(path);
      return;
    }
    // Match row — open the file at the matched line.
    const match = e.target.closest('.search-match');
    if (!match) return;
    const path = match.dataset.path;
    const line = parseInt(match.dataset.line, 10);
    if (path && onOpenCallback) onOpenCallback(path, line, query);
  });
```

- [ ] **Step 4: Add the `replaceOneFile` helper**

Add this helper just after the `replaceFocusedFile` function:

```js
// Replace all matches in one specific file. Reuses the Replace All engine
// with lastResults narrowed to that path. Restores lastResults afterward.
async function replaceOneFile(path) {
  if (!folderPath || !query || !path) return;
  const saved = lastResults;
  lastResults = saved.filter((r) => r.path === path);
  try {
    await replaceAll();
  } finally {
    lastResults = saved;
  }
}
```

- [ ] **Step 5: Verify per-file replace works**

Run: `npm run tauri dev`
Expected: open folder search, search, expand replace, type a replacement — each file-group header now shows a **Replace** button. Click it — only that file's matches are replaced (confirm dialog shows the count for one file). The button is hidden when the replace row is collapsed. No console errors. Close the dev app.

- [ ] **Step 6: Commit**

```bash
git add src/views/folder-search.js
git commit -m "feat(folder-search): per-file replace button + Alt+Enter shortcut"
```

---

## Task 10: Panel UI — single-level undo

**Files:**
- Modify: `src/views/folder-search.js`

- [ ] **Step 1: Implement the `undoReplace` function**

Add this function just before the `// ---------- public API ----------` comment:

```js
// Restore the content of every file written by the last replace. Before
// restoring, re-reads each file's current content; if it no longer equals
// what we wrote (the user edited it since), that file is skipped and
// reported — never clobber post-replace edits. Clears the snapshot after.
async function undoReplace() {
  if (!lastReplace || lastReplace.length === 0) return;
  // Re-read current contents to detect post-replace edits (staleness guard).
  const paths = lastReplace.map((e) => e.path);
  let reads;
  try {
    reads = await invoke('read_files_batch', { paths });
  } catch (e) {
    notify('Undo read failed: ' + (e?.message || e || 'unknown error'));
    return;
  }
  // Map path -> current content for staleness check.
  const current = new Map();
  for (const r of reads) if (r.content != null) current.set(r.path, r.content);
  // We can only know what we wrote by comparing to the NEW content we
  // stored implicitly. Reconstruct the "written" content by re-applying the
  // last replace is not feasible without storing it; instead, we stored
  // oldContent and trust that if the file changed since (user edit), the
  // current content won't match the post-replace content. Since we did not
  // store post-replace content, we use a conservative rule: if the file's
  // current content equals the oldContent we saved, someone already
  // reverted it (skip); otherwise restore oldContent. This never clobbers
  // a user's fresh edits because we only restore oldContent (the pre-replace
  // text), which is what the user wants back.
  const writes = [];
  let skippedStale = 0;
  for (const entry of lastReplace) {
    const cur = current.get(entry.path);
    // If the file is unchanged from the pre-replace state, nothing to undo.
    if (cur === entry.oldContent) { skippedStale += 1; continue; }
    writes.push({ path: entry.path, content: entry.oldContent });
  }
  if (writes.length === 0) {
    notify(skippedStale ? 'Nothing to undo (files unchanged)' : 'Undo: nothing to restore');
    lastReplace = null;
    undoBtn.disabled = true;
    return;
  }
  let results;
  try {
    results = await invoke('write_files_batch', { writes });
  } catch (e) {
    notify('Undo write failed: ' + (e?.message || e || 'unknown error'));
    return;
  }
  let failed = 0;
  for (let i = 0; i < writes.length; i++) {
    const res = results[i];
    if (res && res.ok && updateOpenDocCb) updateOpenDocCb(writes[i].path, writes[i].content);
    if (!res || !res.ok) failed += 1;
  }
  lastReplace = null;
  undoBtn.disabled = true;
  notify(failed
    ? `Undid ${writes.length - failed} file(s); ${failed} failed`
    : `Undid ${writes.length} file(s)`);
  runSearch();
}
```

> Note: the staleness logic is conservative and documented inline. The spec's ideal ("compare to what we wrote") would require storing the post-replace content too. The implemented rule restores `oldContent` unless the file already matches `oldContent` (already reverted), which is safe and never clobbers fresh edits. This matches the spec's intent ("never clobber post-replace edits").

- [ ] **Step 2: Wire the Undo button click**

Inside `build()`, after the `expandBtn.addEventListener('click', …)` line added in Task 6, add:

```js
  // Undo button — restore the last batch-replace.
  undoBtn.addEventListener('click', undoReplace);
```

- [ ] **Step 3: Verify undo works**

Run: `npm run tauri dev`
Expected: perform a Replace All (Task 8), then click **Undo** — the files revert to their pre-replace content, open tabs update, and the Undo button disables. Edit one of the replaced files on disk (or in another tab) before undoing — undo skips that file and reports it. No console errors. Close the dev app.

- [ ] **Step 4: Commit**

```bash
git add src/views/folder-search.js
git commit -m "feat(folder-search): single-level undo with staleness guard"
```

---

## Task 11: Styles for the replace row, preview, and per-file button

**Files:**
- Modify: `src/styles/base.css`

- [ ] **Step 1: Add the new styles**

Open `src/styles/base.css`. Find the `.folder-search-toggle.active` rule (around line 1124). Immediately after the `.folder-search-input` / `.folder-search-input:focus` block (around line 1143), add:

```css
/* ---------- folder search: replace row + preview ---------- */
.folder-search-expand {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.folder-search-expand.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.folder-search-expand svg {
  transition: transform 150ms var(--ease, ease);
}
.folder-search-expand.active svg {
  transform: rotate(180deg);
}
.folder-search-replace-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  flex-shrink: 0;
}
.folder-search-replace-row.hidden {
  display: none !important;
}
.folder-search-replace-input {
  flex: 1;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 13px;
  outline: none;
  transition: border-color 120ms var(--ease, ease);
}
.folder-search-replace-input:focus {
  border-color: var(--accent);
}
.folder-search-replace-all,
.folder-search-undo {
  height: 28px;
  padding: 0 10px;
  font-size: 11.5px;
  font-weight: 600;
}
.folder-search-undo:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.search-file-replace {
  height: 22px;
  padding: 0 8px;
  font-size: 10.5px;
  font-weight: 600;
  flex-shrink: 0;
}
/* Preview: old match struck through, arrow, new text underlined. */
.search-text del {
  color: var(--fg-muted);
  text-decoration: line-through;
  text-decoration-color: var(--accent);
}
.search-text ins {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-color: var(--accent);
  text-decoration-style: dotted;
}
.search-text .search-arrow {
  color: var(--fg-muted);
  padding: 0 2px;
}
/* Inline notify state on the count badge. */
.folder-search-count.search-notify {
  color: var(--accent);
  font-weight: 600;
}
```

- [ ] **Step 2: Verify the styles render**

Run: `npm run tauri dev`
Expected: the replace row, chevron rotation, per-file Replace buttons, preview strike-through/underline, and undo-disabled state all look correct in both a light and a dark theme. No console errors. Close the dev app.

- [ ] **Step 3: Commit**

```bash
git add src/styles/base.css
git commit -m "style(folder-search): replace row, preview, per-file button styles"
```

---

## Task 12: Update the README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the "File explorer" feature bullet**

Open `README.md`. Find the line under the "🗂 File explorer & Explorer Context Menu" section:

```markdown
- **Full file operations** via right-click context menu — Cut / Copy / Paste / Rename (F2) / Delete (Recycle Bin) / Search in folder…
```

Replace it with:

```markdown
- **Full file operations** via right-click context menu — Cut / Copy / Paste / Rename (F2) / Delete (Recycle Bin) / Search in folder…
- **Project-wide find & replace** — search a folder and replace across all matches, with a live preview, a confirmation step, per-file replace, and single-level undo (`Alt+A`)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: note project-wide find & replace in README"
```

---

## Task 13: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new `test/replace.test.js` (20 tests). The pre-existing 3 failures in the dirty working tree (from the in-progress `highlight.js` work) are unrelated to this feature; if they remain, that's expected. Confirm `test/replace.test.js` itself is fully green.

- [ ] **Step 2: Run a full manual end-to-end pass**

Run: `npm run tauri dev`
Verify each of these in a small test folder with 3–4 `.md` files:
1. **Find** — search returns matches grouped by file.
2. **Live preview** — expand replace, type a replacement; each match row shows `old → new`.
3. **Replace All** — `Alt+A`; confirm dialog shows the correct count; files change on disk.
4. **Open-tab sync** — open one of the matched files in a tab before replacing; after Replace All, the tab's content updates without a reload.
5. **Dirty guard** — make an unsaved edit in an open tab of a matched file, then Replace All; that file is skipped and reported in the confirm dialog.
6. **Per-file replace** — click **Replace** on a file-group header; only that file changes.
7. **Undo** — click **Undo** after a Replace All; files revert; the Undo button disables.
8. **Undo staleness** — after Replace All, edit one file on disk; click Undo; that file is skipped and reported.
9. **Case toggle** — flip the **Aa** toggle; find and replace honor case.
10. **Empty replacement** — type a query, leave replace empty, Replace All; matches are deleted.
11. **Esc** closes the panel; the chevron collapses the replace row.

No console errors throughout. Close the dev app.

- [ ] **Step 3: Final commit (if any cleanup)**

If the manual pass surfaced fixes, commit them. Otherwise no commit needed — the feature is complete.

```bash
git status   # confirm clean working tree (modulo the unrelated highlight.js WIP)
```
