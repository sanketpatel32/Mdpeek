# Visual Markdown Table Editor — Design

**Date:** 2026-07-31
**Feature:** When the caret is inside a GFM Markdown table, open a modal grid that lets the user edit cells, add/remove/move rows & columns, and set per-column alignment. On confirm, the table block is rewritten in the source with correct padding.
**Approach:** Layered — pure text↔model logic in a new `src/lib/table.js` (DOM-free, unit-tested, reusing the table-parsing helpers already in `editor-logic.js`), a modal grid view in `src/views/table-editor.js`, and orchestration in `main.js`.

---

## 1. Goal

Markdown tables are painful to edit by hand: adding a column forces re-padding every row, alignment markers (`:--:`) are fiddly, and reordering rows/columns is a chore. mdpeek already *navigates* tables (`tableCellNav`) and *sorts* + *formats* them (`sortTableRows`, `formatTableBlock`) — but it has no visual editor. This feature adds one, in keeping with mdpeek's register: quiet, precise, fast. The textarea remains the source of truth; the editor is a structured rewriter of one block.

## 2. Non-goals (out of scope for v1)

- Cell merging / row or column spanning.
- Per-cell formatting beyond raw text (no inline bold/link buttons — type it as text, the same as you would in source).
- Nested tables (not part of GFM).
- Live collaboration of the grid view (collab syncs the textarea, which is the result of an edit, so it works for free).
- Editing non-GFM tables (HTML `<table>` blocks, list-based tables). Only pipe-delimited GFM tables.
- Multi-table selection (one table block at a time, the one surrounding the caret).

The model and emit shape are designed so alignment and row/col ops can be extended later without changing call sites.

## 3. Architecture

Three layers, cleanly separated — mirrors the established pattern (`replace.js` / `commands.rs` / `folder-search.js`):

```
src/lib/table.js            ← pure parse/emit + row/col/align ops (unit-tested; deterministic)
src/views/table-editor.js   ← modal grid view: renders model, captures edits, returns model
main.js                     ← orchestration: detect caret-in-table → open modal → write back
```

### Data flow

```
caret inside table
  → parseTable(text, caret)            → model { rows, aligns, startLine, endLine }
  → [modal grid: user edits]           → new model (plain array ops, no DOM reach-out)
  → emitTable(newModel)                → padded markdown string
  → doc.editor.replaceRange(start, end, md)   (existing helper)
  → markDirty + scheduleAutoSave       (existing pattern)
```

Every mutation is a pure function on the model; the view is a thin layer that calls them. This makes the heavy logic unit-testable with no DOM.

## 4. Pure module — `src/lib/table.js`

DOM-free, no IPC — fully unit-testable. Reuses the table-parsing primitives that already exist in `editor-logic.js` (`detectTableBlock`, `splitRowCells`, `padCell`, `padDelimiter`, `isDelimiterCell`). Those are currently module-private; this design exports a small shared helper instead of duplicating logic.

### Shared parsing helpers

A new private `parseRowToCells(line)` is factored out (the existing `splitRowCells` does this, with one nuance: it preserves surrounding spaces; the editor wants trimmed cell content). Concretely, `table.js` will:

- Import `detectTableBlock` (to be exported from `editor-logic.js`) for block-range detection.
- Implement its own cell split on the trimmed inner text (escaped pipes `\|` preserved as literal `|`, matching the renderer), producing **trimmed** cell content.

### API

```js
// Detect & parse the GFM table surrounding `pos`. Returns null when the caret
// is not inside a valid table (fewer than 2 rows, or missing delimiter).
parseTable(text, pos)
  → { rows: string[][],            // rows[0] = header, rows[1..] = body; each row is trimmed cells
      aligns: ('left'|'center'|'right'|null)[],   // per-column alignment from the delimiter row
      startLine: number,           // absolute offset of block start
      endLine: number }            // absolute offset of block end (exclusive)
  | null

// Serialize a model back to padded GFM markdown. Alignment markers are
// re-derived from `aligns`. Column widths are computed from content so output
// matches formatTableBlock's style (which is what the user already sees).
emitTable({ rows, aligns })
  → string                         // newline-joined rows, '|' delimited, padded cells

// --- pure model ops (each returns a new model; never mutates input) ---
addRow(model, atIndex?)             → model   // blank row (empty cells), default append
removeRow(model, atIndex)           → model
moveRow(model, atIndex, dir(-1|1))  → model   // no-op at edges
addColumn(model, atIndex?)          → model   // blank column incl. null align, default append
removeColumn(model, atIndex)        → model
moveColumn(model, atIndex, dir)     → model
setAlign(model, col, 'left'|'center'|'right'|null) → model   // toggles/cycles caller-side
setCell(model, row, col, text)      → model   // single-cell edit
```

### Determinism / escaping

- `emitTable` output is deterministic: sorted-by-construction column widths, left-aligned padding (matches `padCell`).
- Escaped pipes: a literal `\|` typed in a cell is emitted as `\|` so it survives a round-trip.
- Alignment markers: `:---` = left, `:---:` = center, `---:` = right, `---` = null. Read on parse, written on emit.

## 5. View — `src/views/table-editor.js`

A modal grid, built with the same patterns as `src/views/diff-viewer.js` (modal overlay shell, theme via CSS variables from `themes.css`, a `.pdf-error`-style guard for malformed input). No new dependencies.

### Layout

- **Header row** of `<input>` cells (read-write; header is editable).
- **Body rows** of `<input>` cells.
- A **column-control strip** above each column: alignment toggle (cycles left → center → right → none), move-left, move-right, remove-column (✕). An **+ column** control at the right edge.
- **Row controls** at the left of each body row: move-up, move-down, remove-row (✕). An **+ row** control below the last row.
- **Footer:** *Cancel* and *Use this version* buttons. (Mirrors the diff-viewer's affordance wording for consistency.)

### Behavior

- **Keyboard:** Tab / Shift+Tab move across cells; ArrowUp/Down move across rows; Enter on the last cell appends a row; Esc cancels (bubbles to the app-level Esc handler or is caught locally — see §7). These keep mdpeek keyboard-first.
- **Validation:** removing the last column or last row is disabled (a table needs ≥1 column; header + delimiter + ≥1 body row must hold — actually the minimum GFM table is header + delimiter + 0 body rows, so removing the last *body* row is allowed; removing the header row is not). The view enforces these invariants; the pure `removeRow`/`removeColumn` ops do not (they trust the caller), keeping the pure layer simple.
- **Modal lifecycle:** opens into a `position: fixed` overlay with a backdrop; traps focus within the grid; restores focus to the textarea on close. Built/destroyed on demand (no persistent DOM).

## 6. Wiring — `main.js`

- Register a **"Edit table visually…"** command in the command palette (`main.js`, near the existing table commands). It is **enabled only when `parseTable(text, caret)` returns non-null** — i.e. the caret is inside a table. (Pattern: see how other palette commands compute availability.)
- On invoke: parse → open `table-editor.js` modal with the model → on confirm, `doc.editor.replaceRange(startLine, endLine, emitTable(model))`, then set caret, mark dirty, schedule autosave, refresh preview. (This is exactly the post-edit sequence `formatTableBlock`/`sortTableRows` already use.)
- Add a **shortcut** as an opt-in nicety (not required): bind to nothing by default to avoid clashing with the existing shortcut table; the palette entry is the entry point. *(Decision: palette-only for v1 — see §7.)*

## 7. Error handling & edge containment

Consistent with the v0.49.1 stability work — failures degrade to a toast, never a blank tab:

- **Not in a table:** palette entry disabled; if invoked anyway (defensive), `toast('Caret is not inside a table.')`.
- **Malformed table (< 2 rows / bad delimiter):** `parseTable` returns null → same toast.
- **Write-back failure:** `replaceRange` + follow-ups wrapped so a throw degrades to a toast and leaves the textarea untouched.
- **Esc handling:** the modal listens for Esc locally and closes without writing, calling `e.stopPropagation()` so it does not also trigger the app-level "exit focus / close find" handler.

## 8. Gating

Add a **Table editor** feature flag, default **ON**, using the established `mdpeek-feature-<name>` system:

- Append `'table-editor'` to the `features` array at `main.js:6362`.
- Add a `settings-feature-table-editor` checkbox in `index.html` (Settings → Features).
- Gate the palette entry + invoke with `featureOn('table-editor')` (helper at `main.js:3470`).
- Add to `applyFeatureFlags()` only if there's a persistent UI element to hide — the palette entry is dynamic, so no display toggling is needed beyond the gate check at build-time of the palette.

## 9. Testing

`test/table.test.js` (~22 tests), mirroring the shape of `test/graph.test.js` and `test/readability.test.js` — pure module only:

- **Round-trips:** parse→emit identity for well-formed tables (simple, multi-col, with alignment markers, with escaped pipes `\|`).
- **Parse correctness:** delimiter-only detection, alignment read-back (`:--`, `--:`, `:-:`, `---`→null), ragged rows (rows with fewer cells) padded to max width, leading/trailing whitespace in cells trimmed, table-not-found returns null.
- **Emit correctness:** column widths computed from content; delimiter dashes padded (min 3); deterministic output (same model → identical string).
- **Ops:** add/remove row & column (defaults + at-index), move row/column up/down/left/right (incl. no-op at edges), setAlign per column, setCell.
- **Invariants preserved through ops:** a parse→op→emit→parse round-trip keeps the same number of rows/columns and aligns.

The view and wiring carry no novel logic and are verified by manual smoke test.

## 10. Files touched

| File | Change |
| --- | --- |
| `src/lib/table.js` | **New** — pure parse/emit + model ops. |
| `src/lib/editor-logic.js` | **Export** `detectTableBlock` (currently private) for reuse. No behavior change. |
| `src/views/table-editor.js` | **New** — modal grid view. |
| `main.js` | Add palette command + invoke + write-back; gate with `featureOn('table-editor')`. |
| `index.html` | `settings-feature-table-editor` checkbox. |
| `test/table.test.js` | **New** — unit tests. |
| `CHANGELOG.md` | Entry under `[Unreleased]`. |

No Rust changes. No new dependencies. ~1 new lib, 1 new view, 1 new test file, small edits to `editor-logic.js`, `main.js`, `index.html`.
