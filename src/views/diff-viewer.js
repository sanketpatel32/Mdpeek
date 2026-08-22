// v0.51.0: Snapshot diff viewer — a side-by-side modal comparing two versions
// of a document (a saved snapshot vs the current content, by default).
//
// Singleton like the reference/tag panes: one overlay appended to <body>,
// shown/hidden by toggling `.hidden`. The caller (main.js) supplies the two
// text versions + labels via open(); this view owns the DOM + the LCS diff
// (from src/lib/diff.js). "Use this version" hands the NEW-side text back to
// the caller's onApply callback (which writes it into the active doc).
//
// Scroll-synced panes: scrolling one pane mirrors the other so the aligned
// rows stay lined up.
//
// Polish layer (injected, id-guarded): +/- gutter signs with success/danger
// tints, sticky hunk headers, word-level highlight marks inside changed line
// pairs, tabular-nums stats chips (+N −M), and an empty-diff "no changes"
// state.

import { diffLines, formatDiffStats } from '../lib/diff.js';

let created = false;
let overlay;       // #diff-overlay
let titleEl;       // .diff-title
let statsEl;       // .diff-stats
let oldHeadEl;     // .diff-pane-head-old
let newHeadEl;     // .diff-pane-head-new
let oldBodyEl;     // .diff-pane-old
let newBodyEl;     // .diff-pane-new
let applyBtn;      // .diff-apply
let wsCheck;       // .diff-ws-check (v0.67.0)
let newContent = '';
let oldContent = '';
let onApplyCb = null;
let lastFocus = null; // element to refocus on close (v0.67.0)

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------- injected polish styles ----------
// Idempotent: one <style id="diff-polish-style"> in <head>, re-entry is a no-op.
// Tokens come from themes.css (--sp-*, --dur-*, --radius*, --success/--danger…)
// with literal fallbacks so the pane still renders if injected before theme load.
const POLISH_CSS = `
.diff-sign {
  flex: 0 0 14px;
  text-align: center;
  font-weight: 700;
  color: transparent;
  user-select: none;
}
.diff-line-num { flex-basis: 34px; transition: color var(--dur-1, 120ms) var(--ease-out, ease); }
.diff-add .diff-sign { color: var(--success); }
.diff-del .diff-sign { color: var(--danger); }
.diff-add .diff-line-num {
  opacity: 1;
  color: color-mix(in srgb, var(--success) 60%, var(--fg-muted));
}
.diff-del .diff-line-num {
  opacity: 1;
  color: color-mix(in srgb, var(--danger) 60%, var(--fg-muted));
}

/* Hunk headers: anchored to the pane top while their run scrolls past. */
@keyframes diff-fade-in {
  from { opacity: 0; transform: translateY(-3px); }
  to   { opacity: 1; transform: none; }
}
.diff-hunk {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 2px var(--sp-3, 8px);
  font-size: 11px;
  letter-spacing: 0.03em;
  color: var(--fg-muted);
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
  user-select: none;
  animation: diff-fade-in var(--dur-2, 180ms) var(--ease-out, ease);
}
.diff-hunk-at { color: color-mix(in srgb, var(--accent-soft, transparent) 100%, var(--fg-muted)); }

/* Word-level marks inside a paired del/add row — stronger than the row tint. */
.diff-wdel,
.diff-wadd {
  border-radius: var(--radius-sm, 5px);
  padding: 0 1px;
  margin: 0 -1px;
}
.diff-wdel {
  background: color-mix(in srgb, var(--danger) 34%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 24%, transparent);
}
.diff-wadd {
  background: color-mix(in srgb, var(--success) 34%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--success) 24%, transparent);
}

/* Stats chips: +N / −M pills with aligned digits. */
.diff-stats { display: inline-flex; align-items: center; gap: var(--sp-1, 4px); }
.diff-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px var(--sp-2, 6px);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.diff-chip-add {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--success) 22%, transparent);
}
.diff-chip-del {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 22%, transparent);
}
.diff-chip-neutral { color: var(--fg-muted); background: var(--surface-hover); }

/* Empty diff: centered reassurance instead of two blank panes. */
.diff-empty-state {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2, 6px);
  font-family: var(--font-ui, inherit);
  font-size: 13px;
  color: var(--fg-muted);
  animation: diff-fade-in var(--dur-3, 240ms) var(--ease-out, ease);
}
.diff-empty-glyph {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-size: 15px;
  color: var(--success);
  background: color-mix(in srgb, var(--success) 13%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--success) 26%, transparent);
}
`;

function ensureDiffPolishStyle() {
  if (document.getElementById('diff-polish-style')) return;
  const style = document.createElement('style');
  style.id = 'diff-polish-style';
  style.textContent = POLISH_CSS;
  document.head.appendChild(style);
}

function build() {
  overlay = document.createElement('div');
  overlay.id = 'diff-overlay';
  overlay.className = 'diff-overlay hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Compare versions');
  overlay.innerHTML = ''
    + '<div class="diff-modal">'
    +   '<header class="diff-header">'
    +     '<div class="diff-title-group">'
    +       '<span class="diff-title">Compare versions</span>'
    +       '<span class="diff-stats"></span>'
    +     '</div>'
    +     '<label class="diff-ws-toggle" title="Treat lines that differ only in whitespace as equal"><input type="checkbox" class="diff-ws-check"> Ignore whitespace</label>'
    +     '<button class="diff-close" type="button" title="Close (Esc)" aria-label="Close diff view">✕</button>'
    +   '</header>'
    +   '<div class="diff-grid">'
    +     '<div class="diff-col">'
    +       '<div class="diff-pane-head diff-pane-head-old">Old</div>'
    +       '<div class="diff-pane diff-pane-old"></div>'
    +     '</div>'
    +     '<div class="diff-col">'
    +       '<div class="diff-pane-head diff-pane-head-new">New</div>'
    +       '<div class="diff-pane diff-pane-new"></div>'
    +     '</div>'
    +   '</div>'
    +   '<footer class="diff-actions">'
    +     '<button class="diff-apply tool-btn primary-btn" type="button">Use this version</button>'
    +   '</footer>'
    + '</div>';
  document.body.appendChild(overlay);
  titleEl = overlay.querySelector('.diff-title');
  statsEl = overlay.querySelector('.diff-stats');
  oldHeadEl = overlay.querySelector('.diff-pane-head-old');
  newHeadEl = overlay.querySelector('.diff-pane-head-new');
  oldBodyEl = overlay.querySelector('.diff-pane-old');
  newBodyEl = overlay.querySelector('.diff-pane-new');
  applyBtn = overlay.querySelector('.diff-apply');
  wsCheck = overlay.querySelector('.diff-ws-check');
  wsCheck?.addEventListener('change', renderDiff);
  overlay.querySelector('.diff-close').addEventListener('click', close);
  applyBtn.addEventListener('click', () => {
    if (onApplyCb) onApplyCb(newContent);
    close();
  });
  // Scroll-sync: scrolling either pane mirrors the other (without feedback loop).
  let syncing = false;
  const sync = (src, dst) => {
    if (syncing || !dst) return;
    syncing = true;
    dst.scrollTop = src.scrollTop;
    syncing = false;
  };
  oldBodyEl.addEventListener('scroll', () => sync(oldBodyEl, newBodyEl));
  newBodyEl.addEventListener('scroll', () => sync(newBodyEl, oldBodyEl));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });
}

function isOpen() {
  return created && overlay && !overlay.classList.contains('hidden');
}

// Render one pane. Each row from diffLines maps to a line in the relevant pane;
// rows absent from a side render an empty placeholder line so the two panes
// stay row-aligned (deletions are blank in the new pane, additions blank in old).
//
// A hunk header row precedes each contiguous run of add/del rows. Boundaries
// derive from the shared rows array alone, so both panes emit the identical
// header sequence and stay scroll-synced.
function renderPane(bodyEl, rows, side) {
  const out = [];
  let prevChanged = false;
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const changed = row.type !== 'equal';
    if (changed && !prevChanged) out.push(hunkHeaderHtml(rows, idx));
    prevChanged = changed;
    if (!changed) {
      out.push(lineHtml('equal', row.text, side === 'old' ? row.oldLine : row.newLine, null));
    } else if (row.type === 'add') {
      // Present in new, absent in old.
      if (side === 'new') {
        const pair = idx > 0 && rows[idx - 1].type === 'del' ? rows[idx - 1] : null;
        out.push(lineHtml('add', row.text, row.newLine, pair));
      } else out.push(emptyHtml());
    } else {
      // del: present in old, absent in new.
      if (side === 'old') {
        const pair = idx + 1 < rows.length && rows[idx + 1].type === 'add' ? rows[idx + 1] : null;
        out.push(lineHtml('del', row.text, row.oldLine, pair));
      } else out.push(emptyHtml());
    }
  }
  bodyEl.innerHTML = out.join('');
}

function lineHtml(type, text, lineNo, pair) {
  const num = Number.isInteger(lineNo) ? lineNo : '';
  const sign = type === 'add' ? '+' : type === 'del' ? '\u2212' : '';
  let body;
  if (pair) {
    // Adjacent del/add pair → word-level marks so only the changed words pop.
    const wd = type === 'del'
      ? wordDiffHtml(text, pair.text)
      : wordDiffHtml(pair.text, text);
    body = type === 'del' ? wd.oldHtml : wd.newHtml;
  } else {
    body = esc(text) || ' ';
  }
  return (
    `<div class="diff-row diff-${type}">` +
    `<span class="diff-line-num">${num}</span>` +
    `<span class="diff-sign">${sign}</span>` +
    `<span class="diff-line-text">${body}</span>` +
    `</div>`
  );
}

function emptyHtml() {
  return '<div class="diff-row diff-empty"><span class="diff-line-num"></span><span class="diff-sign"></span><span class="diff-line-text"> </span></div>';
}

// Sticky-feel hunk header for the add/del run starting at startIdx, e.g.
// "@@ −12,3 +14,2 @@". Line ranges count only the changed lines of that side.
function hunkHeaderHtml(rows, startIdx) {
  let oldStart = null;
  let newStart = null;
  let oldCount = 0;
  let newCount = 0;
  for (let k = startIdx; k < rows.length && rows[k].type !== 'equal'; k++) {
    const r = rows[k];
    if (r.type === 'del') {
      if (oldStart === null) oldStart = r.oldLine;
      oldCount++;
    } else {
      if (newStart === null) newStart = r.newLine;
      newCount++;
    }
  }
  const parts = [];
  if (oldStart !== null) parts.push(`\u2212${oldStart},${oldCount}`);
  if (newStart !== null) parts.push(`+${newStart},${newCount}`);
  return (
    `<div class="diff-hunk" aria-hidden="true">` +
    `<span class="diff-hunk-at">@@</span> ${esc(parts.join(' '))} <span class="diff-hunk-at">@@</span>` +
    `</div>`
  );
}

// ---------- word-level diff (presentation only) ----------
const WORD_TOKEN_RE = /\s+|[A-Za-z0-9_]+|[^\s]/g;

// Token-level LCS between two lines → { oldHtml, newHtml } with changed words
// wrapped in .diff-wdel / .diff-wadd marks. Falls back to plain escaping for
// pathologically long lines (guards the O(n·m) DP).
function wordDiffHtml(aText, bText) {
  const a = String(aText).match(WORD_TOKEN_RE) || [];
  const b = String(bText).match(WORD_TOKEN_RE) || [];
  if (a.length > 300 || b.length > 300) {
    return { oldHtml: esc(aText) || ' ', newHtml: esc(bText) || ' ' };
  }
  const m = a.length;
  const n = b.length;
  const dp = new Array(m + 1);
  for (let i = 0; i <= m; i++) dp[i] = new Uint32Array(n + 1);
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const oldOut = [];
  const newOut = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      oldOut.push(esc(a[i]));
      newOut.push(esc(a[i]));
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      oldOut.push(`<mark class="diff-wdel">${esc(a[i])}</mark>`);
      i++;
    } else {
      newOut.push(`<mark class="diff-wadd">${esc(b[j])}</mark>`);
      j++;
    }
  }
  while (i < m) oldOut.push(`<mark class="diff-wdel">${esc(a[i++])}</mark>`);
  while (j < n) newOut.push(`<mark class="diff-wadd">${esc(b[j++])}</mark>`);
  return { oldHtml: oldOut.join(''), newHtml: newOut.join('') };
}

export function initDiffViewer() {
  if (created) return { open, close };
  ensureDiffPolishStyle();
  build();
  created = true;
  return { open, close };
}

// Show the diff overlay. opts: { title?, oldContent, newContent, oldLabel?, newLabel?, onApply? }.
// onApply(newText) is called if the user clicks "Use this version".
function open(opts = {}) {
  if (!created) return;
  oldContent = opts.oldContent ?? '';
  newContent = opts.newContent ?? '';
  onApplyCb = typeof opts.onApply === 'function' ? opts.onApply : null;
  if (opts.title) titleEl.textContent = opts.title;
  oldHeadEl.textContent = opts.oldLabel || 'Old';
  newHeadEl.textContent = opts.newLabel || 'Current';
  renderDiff();
  // v0.67.0: move focus into the dialog (it stayed on the background trigger)
  // and restore it on close.
  lastFocus = document.activeElement;
  overlay.classList.remove('hidden');
  const closeBtn = overlay.querySelector('.diff-close');
  if (closeBtn) closeBtn.focus();
  // Reset scroll to the top so re-opening lands at the first change.
  oldBodyEl.scrollTop = 0;
  newBodyEl.scrollTop = 0;
}

// Run the diff + repaint both panes. Called by open() and by the
// ignore-whitespace toggle (v0.67.0). Renders +N/−M chips when changes exist,
// or a centered "no changes" state in both panes otherwise.
function renderDiff() {
  const { rows, stats } = diffLines(oldContent, newContent, {
    ignoreWhitespace: !!(wsCheck && wsCheck.checked),
  });
  const hasChanges = stats.added > 0 || stats.removed > 0;
  statsEl.innerHTML = hasChanges
    ? chipsHtml(stats)
    : '<span class="diff-chip diff-chip-neutral">no changes</span>';
  const summary = formatDiffStats(stats);
  statsEl.title = summary;
  statsEl.setAttribute('aria-label', `Diff summary: ${summary}`);
  if (!hasChanges) {
    const msg = '<div class="diff-empty-state" role="status">'
      + '<span class="diff-empty-glyph">\u2713</span>'
      + '<span>No changes \u2014 both versions match</span>'
      + '</div>';
    oldBodyEl.innerHTML = msg;
    newBodyEl.innerHTML = msg;
  } else {
    renderPane(oldBodyEl, rows, 'old');
    renderPane(newBodyEl, rows, 'new');
  }
  // Only show "Use this version" when there's a caller to apply to + changes exist.
  // (.hidden class, not the hidden attribute — .tool-btn's display:inline-flex
  // outranks the UA [hidden] rule and would keep the button visible.)
  applyBtn.classList.toggle('hidden', !onApplyCb || !hasChanges);
}

function chipsHtml(stats) {
  const chips = [];
  if (stats.added > 0) chips.push(`<span class="diff-chip diff-chip-add">+${stats.added}</span>`);
  if (stats.removed > 0) chips.push(`<span class="diff-chip diff-chip-del">\u2212${stats.removed}</span>`);
  return chips.join('');
}

function close() {
  if (!created || !overlay) return;
  overlay.classList.add('hidden');
  if (lastFocus && lastFocus.focus) {
    try { lastFocus.focus(); } catch { /* detached */ }
    lastFocus = null;
  }
}
