// v0.52.0: Visual Markdown table editor — a modal grid for editing the GFM
// table under the caret without fighting pipes/padding. Singleton like the
// diff viewer: one overlay appended to <body>, shown/hidden via `.hidden`.
//
// The caller (main.js) supplies the parsed model via open({ model, onApply })
// and receives the emitted markdown back through onApply(md) when the user
// confirms. All edits run through the pure ops in src/lib/table.js, so this
// view holds no table logic of its own — it's DOM + input handling.

import {
  addRow, removeRow, moveRow,
  addColumn, removeColumn, moveColumn,
  setAlign, setCell, emitTable,
} from '../lib/table.js';

const ALIGN_CYCLE = [null, 'left', 'center', 'right'];
const ALIGN_GLYPH = { null: '·', left: '⟸', center: '⇔', right: '⟹' };
// JS object keys are strings; map the literal null key explicitly.
ALIGN_GLYPH['null'] = '·';

let created = false;
let overlay;        // #te-overlay
let headGrid;       // .te-cols (column control strip)
let bodyEl;         // .te-body (header + data rows)
let applyBtn;       // .te-apply
let model = null;
let onApplyCb = null;
let prevFocus = null;

function build() {
  overlay = document.createElement('div');
  overlay.id = 'te-overlay';
  overlay.className = 'te-overlay hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Edit table');
  overlay.innerHTML = ''
    + '<div class="te-modal">'
    +   '<header class="te-header">'
    +     '<span class="te-title">Edit table</span>'
    +     '<button class="te-close" type="button" title="Close (Esc)" aria-label="Close table editor">✕</button>'
    +   '</header>'
    +   '<div class="te-scroll">'
    +     '<div class="te-cols"></div>'
    +     '<div class="te-body"></div>'
    +   '</div>'
    +   '<footer class="te-actions">'
    +     '<button class="te-add-row tool-btn" type="button">+ Row</button>'
    +     '<span class="te-spacer"></span>'
    +     '<button class="te-cancel tool-btn" type="button">Cancel</button>'
    +     '<button class="te-apply tool-btn primary-btn" type="button">Use this version</button>'
    +   '</footer>'
    + '</div>';
  document.body.appendChild(overlay);
  headGrid = overlay.querySelector('.te-cols');
  bodyEl = overlay.querySelector('.te-body');
  applyBtn = overlay.querySelector('.te-apply');
  overlay.querySelector('.te-close').addEventListener('click', close);
  overlay.querySelector('.te-cancel').addEventListener('click', close);
  overlay.querySelector('.te-add-row').addEventListener('click', () => { model = addRow(model); render(); });
  applyBtn.addEventListener('click', () => {
    if (onApplyCb) onApplyCb(emitTable(model));
    close();
  });
  // Esc closes without applying. stopPropagation so it doesn't also trigger the
  // app-level Esc (exit focus / close find).
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      e.stopPropagation();
      close();
    }
  });
}

function isOpen() {
  return created && overlay && !overlay.classList.contains('hidden');
}

// Render the column control strip: one cell per column (align toggle,
// move-left, move-right, remove) plus a trailing "+ column".
function renderCols() {
  const colCount = model.aligns.length;
  const cells = [];
  for (let c = 0; c < colCount; c++) {
    cells.push(colControlHtml(c, colCount));
  }
  cells.push('<button class="te-col-add tool-btn" type="button" title="Add column">+ Col</button>');
  headGrid.innerHTML = cells.join('');
}

function colControlHtml(c, colCount) {
  const a = model.aligns[c];
  const glyph = ALIGN_GLYPH[String(a)];
  const canRemove = model.aligns.length > 1;
  return (
    '<div class="te-col-ctl">'
    + `<button class="te-align tool-btn" type="button" data-act="align" data-col="${c}" title="Cycle alignment (none/left/center/right)">${glyph}</button>`
    + `<button class="tool-btn te-ico" type="button" data-act="cmove-l" data-col="${c}" title="Move column left" ${c === 0 ? 'disabled' : ''}>←</button>`
    + `<button class="tool-btn te-ico" type="button" data-act="cmove-r" data-col="${c}" title="Move column right" ${c === colCount - 1 ? 'disabled' : ''}>→</button>`
    + `<button class="tool-btn te-ico te-danger" type="button" data-act="cremove" data-col="${c}" title="Remove column" ${canRemove ? '' : 'disabled'}>✕</button>`
    + '</div>'
  );
}

// Render the row grid: a header row (editable) then each body row with its
// row controls (move up/down/remove) on the left.
function renderRows() {
  const colCount = model.aligns.length;
  const out = [];
  // Header row (row index 0) — no remove control.
  out.push(rowHtml(0, true, colCount));
  for (let r = 1; r < model.rows.length; r++) {
    out.push(rowHtml(r, false, colCount));
  }
  bodyEl.innerHTML = out.join('');
}

function rowHtml(r, isHeader, colCount) {
  const cells = [];
  if (isHeader) {
    cells.push('<div class="te-row-ctl te-row-ctl-head">Header</div>');
  } else {
    cells.push(
      '<div class="te-row-ctl">'
      + `<button class="tool-btn te-ico" type="button" data-act="rmove-u" data-row="${r}" title="Move row up" ${r <= 1 ? 'disabled' : ''}>↑</button>`
      + `<button class="tool-btn te-ico" type="button" data-act="rmove-d" data-row="${r}" title="Move row down" ${r === model.rows.length - 1 ? 'disabled' : ''}>↓</button>`
      + `<button class="tool-btn te-ico te-danger" type="button" data-act="rremove" data-row="${r}" title="Remove row">✕</button>`
      + '</div>'
    );
  }
  for (let c = 0; c < colCount; c++) {
    const val = model.rows[r][c] || '';
    cells.push(`<input class="te-cell" type="text" data-row="${r}" data-col="${c}" value="${attrEscape(val)}" />`);
  }
  return `<div class="te-row${isHeader ? ' te-row-head' : ''}">${cells.join('')}</div>`;
}

function attrEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Wire up delegated clicks (column + row controls) and cell edits. Bound once
// on the stable parent elements in build(); event delegation via data-act /
// data-row / data-col keeps handlers in sync with each render.
function wire() {
  headGrid.addEventListener('click', onColClick);
  bodyEl.addEventListener('click', onRowClick);
  bodyEl.addEventListener('input', onCellInput);
  bodyEl.addEventListener('keydown', onCellKeydown);
}

function onColClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const c = Number(btn.dataset.col);
  if (act === 'align') {
    const cur = model.aligns[c];
    const next = ALIGN_CYCLE[(ALIGN_CYCLE.indexOf(cur) + 1) % ALIGN_CYCLE.length];
    model = setAlign(model, c, next);
    render();
  } else if (act === 'cmove-l') {
    model = moveColumn(model, c, -1); render();
  } else if (act === 'cmove-r') {
    model = moveColumn(model, c, 1); render();
  } else if (act === 'cremove') {
    if (model.aligns.length <= 1) return; // keep ≥1 column
    model = removeColumn(model, c); render();
  }
}

function onRowClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const r = Number(btn.dataset.row);
  if (act === 'rmove-u') { model = moveRow(model, r, -1); render(); }
  else if (act === 'rmove-d') { model = moveRow(model, r, 1); render(); }
  else if (act === 'rremove') {
    // Keep header + at least one body row so the table stays valid.
    if (model.rows.length <= 2) return;
    model = removeRow(model, r); render();
  }
}

function onCellInput(e) {
  const inp = e.target.closest('input.te-cell');
  if (!inp) return;
  const r = Number(inp.dataset.row);
  const c = Number(inp.dataset.col);
  model = setCell(model, r, c, inp.value);
}

// Tab/Arrows/Enter navigation between cells. Enter on the last row appends.
function onCellKeydown(e) {
  const inp = e.target.closest('input.te-cell');
  if (!inp) return;
  const r = Number(inp.dataset.row);
  const c = Number(inp.dataset.col);
  const colCount = model.aligns.length;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (r === model.rows.length - 1) { model = addRow(model); render(); }
    focusCell(r + 1, c);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (r < model.rows.length - 1) focusCell(r + 1, c);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (r > 0) focusCell(r - 1, c);
  } else if (e.key === 'ArrowRight' && inp.selectionStart === inp.value.length) {
    e.preventDefault();
    if (c < colCount - 1) focusCell(r, c + 1);
  } else if (e.key === 'ArrowLeft' && inp.selectionStart === 0) {
    e.preventDefault();
    if (c > 0) focusCell(r, c - 1);
  }
}

function focusCell(r, c) {
  const inp = bodyEl.querySelector(`input.te-cell[data-row="${r}"][data-col="${c}"]`);
  if (inp) inp.focus();
}

function render() {
  // The grid template is shared by the column-control strip and every row so
  // controls line up over their columns: one fixed control slot + N 1fr cells.
  const colCount = model.aligns.length;
  const tracks = '52px ' + '1fr '.repeat(colCount).trim();
  renderCols();
  renderRows();
  headGrid.style.gridTemplateColumns = tracks;
  bodyEl.querySelectorAll('.te-row').forEach((row) => { row.style.gridTemplateColumns = tracks; });
}

export function initTableEditor() {
  if (created) return { open, close };
  build();
  wire();
  created = true;
  return { open, close };
}

// opts: { model, onApply }. model is a parsed table from parseTable().
// onApply(md) receives the emitted markdown when the user confirms.
function open(opts = {}) {
  if (!created) return;
  model = opts.model ? {
    rows: opts.model.rows.map((r) => r.slice()),
    aligns: opts.model.aligns.slice(),
  } : null;
  if (!model) return;
  onApplyCb = typeof opts.onApply === 'function' ? opts.onApply : null;
  render();
  prevFocus = document.activeElement;
  overlay.classList.remove('hidden');
  // Focus the first data cell (header[0][0]) so typing starts immediately.
  focusCell(0, 0);
}

function close() {
  if (!created || !overlay) return;
  overlay.classList.add('hidden');
  model = null;
  onApplyCb = null;
  if (prevFocus && typeof prevFocus.focus === 'function') {
    try { prevFocus.focus(); } catch (_) { /* element may be gone */ }
    prevFocus = null;
  }
}
