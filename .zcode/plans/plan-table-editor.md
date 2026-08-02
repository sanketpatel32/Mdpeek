# Implementation Plan — Visual Markdown Table Editor

Spec: `docs/superpowers/specs/2026-07-31-visual-table-editor-design.md`

## Grounding facts (from codebase survey)
- Table parsing already exists as private helpers in `src/lib/editor-logic.js`: `detectTableBlock(text,pos)` (:744), `splitRowCells(line)` (:777), `padCell` (:840), `padDelimiter` (:843), `isDelimiterCell` (:855), `isDelimiterRow` (:852).
- `formatTableBlock`/`sortTableRows` are the post-edit template; canonical write-back tail (main.js:1824-1862): `replaceRange(0, len, text)` → `setState({start,end})` → `doc.content=text` → `store.markDirty` → `persistSoon()` → `scheduleAutoSave()`.
- Command palette: `getCommands()` (main.js:1092) builds `cmds[]` then filters. Add entry + a filter line (main.js:1188-1203). Feature gating in the palette is inline `localStorage.getItem('mdpeek-feature-X') === '0'`.
- Modal template: `src/views/diff-viewer.js` — singleton `build()` on first call, `open()/close()` toggle a `hidden` class, Esc listener, `onApply` callback.
- `features` arrays at main.js:6362 and main.js:6691 (duplicated literal). Settings checkbox markup at index.html:1125-1144 (graph/autocomplete).
- Editor controller: `replaceRange(start,end,text)` (editor.js:487), `getSelection()` → `{start,end}`, `getValue()`, `setState({start,end})`.

## Steps (each independently verifiable)

### Step 1 — Export `detectTableBlock` from editor-logic.js
- Change `function detectTableBlock` → `export function detectTableBlock` (editor-logic.js:744). No behavior change. Reuses across modules instead of duplicating.
- Verify: `npm test` stays green.

### Step 2 — Pure module `src/lib/table.js`
- `parseTable(text, pos)` → `{ rows: string[][], aligns: ('left'|'center'|'right'|null)[], startLine, endLine } | null`. Uses exported `detectTableBlock`. Splits each row to **trimmed** cells via a local `splitCells` (escaped `\|` preserved as literal pipe). Reads alignment from delimiter row (row index 1): `:---`=left, `---:`=right, `:-:`=center, `---`=null. Pads ragged rows to max width with `''`. Returns null if `<2` rows or row 1 isn't a delimiter.
- `emitTable({rows, aligns})` → string. Compute per-column max content width (skip delimiter row). Re-emit header row, a delimiter row re-derived from `aligns` (min 3 dashes), then body rows. Cell padding via local `padCell`/`padDelimiter` (port the small helpers or import — decide: duplicate to keep table.js dependency-light; both are 3-4 lines).
- Pure ops returning new model (no mutation): `addRow`, `removeRow`, `moveRow(model,i,dir)`, `addColumn`, `removeColumn`, `moveColumn(model,i,dir)`, `setAlign(model,col,align)`, `setCell(model,row,col,text)`.
- Export everything. No DOM.

### Step 3 — Tests `test/table.test.js`
- Round-trips (parse→emit): simple 2-col, 3-col, with all 4 alignment kinds, with escaped `\|` in a cell, with CJK/wide chars.
- Parse correctness: null when not in table; null when <2 rows; ragged row normalized; whitespace trimmed; aligns read back correctly.
- Emit correctness: deterministic (same model → same string); min-3-dash delimiter; content-driven widths.
- Ops: addRow/removeRow (append + at-index), addColumn/removeColumn, moveRow/moveColumn incl. no-op at edges, setAlign, setCell.
- Invariant: parse→op→emit→parse preserves shape.
- Verify: `npm test` — new file adds ~22 tests, existing 992 stay green.

### Step 4 — View `src/views/table-editor.js`
- Singleton modal mirroring diff-viewer.js structure: module state, `build()` (overlay + grid DOM appended to body), `open({model, onApply})` / `close()`, Esc listener (stopPropagation), exported `initTableEditor()`.
- Grid: header row (editable `<input>`s), body rows (`<input>`s), column-control strip (align toggle cycle, move-l, move-r, remove), row controls (move-u, move-d, remove), "+ row" / "+ col" affordances, footer Cancel / **Use this version**.
- All edits mutate a local working model via the pure ops from table.js; on confirm calls `onApply(emitTable(model))` then `close()`.
- Focus trap: keep focus within grid while open; restore focus to textarea on close (stash `document.activeElement` on open).
- Invariants enforced in the view (not pure layer): can't remove last column; can't remove header row; can't remove if it would leave <2 rows (header+delimiter).

### Step 5 — CSS (append to `src/styles/content.css` or a small block in base.css)
- `.table-editor-overlay` (fixed, backdrop), `.table-editor-modal`, `.table-editor-grid`, `.table-editor-cell` input styling, control buttons reuse existing `.tool-btn`. Use CSS vars from themes.css (bg/surface/text/border/accent) so it themes automatically. `hidden` class hides.

### Step 6 — Wire into main.js
- Import `{ parseTable, emitTable }` from `./lib/table.js` and `initTableEditor` from `./views/table-editor.js`. Create instance near diff-viewer init (main.js:1377).
- New handler `editTableVisually()`:
  - Guard: active doc + edit mode (same as formatTable).
  - `const { start } = doc.editor.getSelection(); const m = parseTable(doc.editor.getValue(), start); if (!m) { toast('Caret is not inside a table'); return; }`
  - `tableEditor.open({ model: m, onApply: (md) => { doc.editor.replaceRange(m.startLine, m.endLine, md); doc.content = doc.editor.getValue(); store.markDirty(doc.id); persistSoon(); scheduleAutoSave(); toast('Table updated'); } });`
- Add command `{ id: 'edit-table', label: 'Edit table visually…', keywords: 'edit table grid visual rows columns align markdown', run: editTableVisually }` in getCommands() near the other table commands (main.js:1138).
- Add filter line in the availability filter: `if (c.id === 'edit-table' && !caretInTable()) return false;` plus the feature-flag line `if (c.id === 'edit-table' && localStorage.getItem('mdpeek-feature-table-editor') === '0') return false;`. Helper `caretInTable()` returns `!!store.active() && store.active().mode==='edit' && !!parseTable(store.active().editor.getValue(), store.active().editor.getSelection().start)`.

### Step 7 — Feature flag + Settings UI
- Add `'table-editor'` to both features array literals (main.js:6362 and main.js:6691).
- Add checkbox block in index.html before line 1145 (copy graph/autocomplete markup): `id="settings-feature-table-editor"`, label "Table editor", desc "Open a visual grid editor for the Markdown table under the caret".

### Step 8 — CHANGELOG + version bump
- Add `[Unreleased]` entry (or new version) to CHANGELOG.md describing the feature.
- Bump package.json version (minor) + src-tauri version if the project bumps both on release. Check `tauri.conf.json` for a version field.

### Step 9 — Verify
- `npm test` → all green (1014+ tests).
- `npm run build` → builds clean (catches import/syntax errors in the browser bundle).
- Manual smoke (in `npm run tauri dev`, optional): caret in a table → palette "Edit table visually…" → add a column → confirm → source updated + padded.
