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
function renderPane(bodyEl, rows, side) {
  const out = [];
  for (const row of rows) {
    if (row.type === 'equal') {
      out.push(lineHtml('equal', row.text, side === 'old' ? row.oldLine : row.newLine));
    } else if (row.type === 'add') {
      // Present in new, absent in old.
      if (side === 'new') out.push(lineHtml('add', row.text, row.newLine));
      else out.push(emptyHtml());
    } else {
      // del: present in old, absent in new.
      if (side === 'old') out.push(lineHtml('del', row.text, row.oldLine));
      else out.push(emptyHtml());
    }
  }
  bodyEl.innerHTML = out.join('');
}

function lineHtml(type, text, lineNo) {
  const num = Number.isInteger(lineNo) ? lineNo : '';
  return (
    `<div class="diff-row diff-${type}">` +
    `<span class="diff-line-num">${num}</span>` +
    `<span class="diff-line-text">${esc(text) || ' '}</span>` +
    `</div>`
  );
}

function emptyHtml() {
  return '<div class="diff-row diff-empty"><span class="diff-line-num"></span><span class="diff-line-text"> </span></div>';
}

export function initDiffViewer() {
  if (created) return { open, close };
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
// ignore-whitespace toggle (v0.67.0).
function renderDiff() {
  const { rows, stats } = diffLines(oldContent, newContent, {
    ignoreWhitespace: !!(wsCheck && wsCheck.checked),
  });
  statsEl.textContent = formatDiffStats(stats);
  renderPane(oldBodyEl, rows, 'old');
  renderPane(newBodyEl, rows, 'new');
  // Only show "Use this version" when there's a caller to apply to + changes exist.
  applyBtn.hidden = !onApplyCb || (stats.added === 0 && stats.removed === 0);
}

function close() {
  if (!created || !overlay) return;
  overlay.classList.add('hidden');
  if (lastFocus && lastFocus.focus) {
    try { lastFocus.focus(); } catch { /* detached */ }
    lastFocus = null;
  }
}
