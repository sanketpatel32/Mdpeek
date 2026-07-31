// Pure GFM Markdown table model — no DOM, no IPC. Parses the pipe-delimited
// table surrounding a caret position into a structured model, applies
// row/column/alignment edits as pure functions, and serializes the model back
// to padded GFM markdown. Unit-tested in test/table.test.js. The view
// (src/views/table-editor.js) renders the model and feeds edits through the
// ops here; main.js writes the emitted markdown back to the textarea.
//
// Reuses detectTableBlock from editor-logic.js for block-range detection so
// "is the caret in a table?" agrees with formatTableBlock/sortTableRows.

import { detectTableBlock } from './editor-logic.js';

// --- parsing -------------------------------------------------------------

// Split a table row's inner text (between the outer pipes) into trimmed cell
// contents. Escaped pipes \| are kept as literal | (matches the renderer). The
// leading/trailing pipe should already be stripped before calling.
function splitCells(inner) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '|' && !(i > 0 && inner[i - 1] === '\\')) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

// Read a delimiter cell (e.g. ":--:", "---", "--:", ":--") into an alignment.
// Returns 'left' | 'center' | 'right' | null. Anything that isn't a valid
// delimiter cell returns undefined so callers can reject a non-delimiter row.
function parseAlignCell(cell) {
  const t = cell.trim();
  const m = t.match(/^(:?)(-+)(:?)$/);
  if (!m) return undefined;
  const [, left, , right] = m;
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

// Detect & parse the GFM table surrounding `pos`. Returns null when the caret
// is not inside a valid table (no block, fewer than 2 rows, or row 1 isn't a
// delimiter row). rows[0] is the header; rows[1..] are body rows. aligns has
// one entry per column (null when unaligned). Ragged rows are padded to the
// widest row's column count with ''. startLine/endLine are absolute text
// offsets of the block (endLine exclusive).
export function parseTable(text, pos) {
  if (!text || typeof pos !== 'number') return null;
  const block = detectTableBlock(text, pos);
  if (!block) return null;
  const { startLine, endLine, lines } = block;

  // Strip exactly one leading/trailing pipe per row, then split.
  const rawRows = lines.map((line) => {
    const trimmed = line.replace(/^\s+/, '');
    const inner = trimmed.replace(/^\|/, '').replace(/\|\s*$/, '');
    return splitCells(inner);
  });

  // A real table needs a header + a delimiter row (row index 1).
  if (rawRows.length < 2) return null;
  const alignCells = rawRows[1];
  const aligns = alignCells.map(parseAlignCell);
  // If any delimiter cell failed to parse, this isn't a valid GFM table.
  if (aligns.some((a) => a === undefined)) return null;

  // The delimiter row itself isn't a data row; drop it from `rows`.
  const rows = [rawRows[0], ...rawRows.slice(2)];

  // Pad ragged rows to the widest column count.
  const colCount = Math.max(...rows.map((r) => r.length), aligns.length, 1);
  const normRows = rows.map((r) => {
    const out = r.slice();
    while (out.length < colCount) out.push('');
    return out;
  });
  const normAligns = aligns.slice();
  while (normAligns.length < colCount) normAligns.push(null);

  return { rows: normRows, aligns: normAligns, startLine, endLine };
}

// --- emitting ------------------------------------------------------------

// Pad a content cell to `width` with trailing spaces (left-aligned, matching
// formatTableBlock's padCell).
function padCell(cell, width) {
  return cell + ' '.repeat(Math.max(0, width - cell.length));
}

// Build a delimiter cell string from an alignment, at least 3 dashes wide.
function delimiterCell(align, width) {
  const dashCount = Math.max(3, width);
  const dashes = '-'.repeat(dashCount);
  if (align === 'center') return `:${dashes.slice(1, -1) || '-'}:`;
  if (align === 'right') return `${dashes.slice(0, -1)}:`;
  if (align === 'left') return `:${dashes.slice(1)}`;
  return dashes;
}

// Serialize a model back to padded GFM markdown. Column widths are derived
// from content (skipping the implicit delimiter row), so output matches the
// style formatTableBlock produces. Deterministic: identical model → identical
// string. rows[0] is the header; a delimiter row is emitted as row 1.
export function emitTable(model) {
  const { rows, aligns } = model;
  if (!rows || rows.length === 0) return '';
  const colCount = Math.max(...rows.map((r) => r.length), aligns.length, 1);
  const normRows = rows.map((r) => {
    const out = r.slice();
    while (out.length < colCount) out.push('');
    return out;
  });
  const normAligns = aligns.slice();
  while (normAligns.length < colCount) normAligns.push(null);

  // Per-column max content width across data rows.
  const widths = new Array(colCount).fill(0);
  for (const r of normRows) {
    for (let c = 0; c < colCount; c++) {
      widths[c] = Math.max(widths[c], (r[c] || '').length);
    }
  }

  const renderRow = (cells) => '| ' + cells.map((c, i) => padCell(c, widths[i])).join(' | ') + ' |';
  const out = [renderRow(normRows[0])];
  out.push('| ' + normAligns.map((a, i) => padCell(delimiterCell(a, widths[i]), widths[i])).join(' | ') + ' |');
  for (let r = 1; r < normRows.length; r++) out.push(renderRow(normRows[r]));
  return out.join('\n');
}

// --- pure model ops (each returns a new model; input never mutated) -------

function clone(model) {
  return {
    rows: model.rows.map((r) => r.slice()),
    aligns: model.aligns.slice(),
  };
}

// Add a blank row. atIndex inserts at that 0-based body index (header is row 0);
// omitted/undefined appends. Negative or out-of-range clamps.
export function addRow(model, atIndex) {
  const m = clone(model);
  const colCount = m.aligns.length;
  const blank = new Array(colCount).fill('');
  const insertAt = atIndex == null ? m.rows.length : Math.max(1, Math.min(m.rows.length, atIndex));
  m.rows.splice(insertAt, 0, blank);
  return m;
}

// Remove the body row at `atIndex` (0-based body index, so row 1..). Removing
// the header (index 0) is rejected by the view, not here; this layer trusts the
// caller and will remove whatever is asked. No-op if index out of range.
export function removeRow(model, atIndex) {
  const m = clone(model);
  if (atIndex < 1 || atIndex >= m.rows.length) return m;
  m.rows.splice(atIndex, 1);
  return m;
}

// Move body row `atIndex` by `dir` (-1 up / +1 down). No-op at edges.
export function moveRow(model, atIndex, dir) {
  const m = clone(model);
  const target = atIndex + dir;
  if (atIndex < 1 || atIndex >= m.rows.length || target < 1 || target >= m.rows.length) return m;
  const [row] = m.rows.splice(atIndex, 1);
  m.rows.splice(target, 0, row);
  return m;
}

// Add a blank column (empty cells, null align). atIndex inserts at that column;
// omitted/undefined appends.
export function addColumn(model, atIndex) {
  const m = clone(model);
  const insertAt = atIndex == null ? m.aligns.length : Math.max(0, Math.min(m.aligns.length, atIndex));
  m.aligns.splice(insertAt, 0, null);
  m.rows = m.rows.map((r) => {
    const out = r.slice();
    out.splice(insertAt, 0, '');
    return out;
  });
  return m;
}

// Remove the column at `atIndex`. No-op if out of range. Will remove the last
// column if asked — the view enforces the "keep ≥1 column" invariant.
export function removeColumn(model, atIndex) {
  const m = clone(model);
  if (atIndex < 0 || atIndex >= m.aligns.length) return m;
  m.aligns.splice(atIndex, 1);
  m.rows = m.rows.map((r) => {
    const out = r.slice();
    out.splice(atIndex, 1);
    return out;
  });
  return m;
}

// Move column `atIndex` by `dir` (-1 left / +1 right). No-op at edges.
export function moveColumn(model, atIndex, dir) {
  const m = clone(model);
  const target = atIndex + dir;
  if (atIndex < 0 || atIndex >= m.aligns.length || target < 0 || target >= m.aligns.length) return m;
  const [a] = m.aligns.splice(atIndex, 1);
  m.aligns.splice(target, 0, a);
  m.rows = m.rows.map((r) => {
    const out = r.slice();
    const [cell] = out.splice(atIndex, 1);
    out.splice(target, 0, cell);
    return out;
  });
  return m;
}

// Set the alignment of column `col`. No-op if out of range.
export function setAlign(model, col, align) {
  const m = clone(model);
  if (col < 0 || col >= m.aligns.length) return m;
  m.aligns[col] = align;
  return m;
}

// Set the text of cell [row, col]. Grows the row with '' if needed; no-op if
// row out of range.
export function setCell(model, row, col, text) {
  const m = clone(model);
  if (row < 0 || row >= m.rows.length) return m;
  const out = m.rows[row].slice();
  const colCount = m.aligns.length;
  while (out.length < colCount) out.push('');
  if (col < 0 || col >= out.length) return m;
  out[col] = text;
  m.rows[row] = out;
  return m;
}
