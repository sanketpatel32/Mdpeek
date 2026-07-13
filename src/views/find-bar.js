// Unified, idempotent find bar. A single DOM element appended to <body>,
// created once; listeners attached once. Works in both view mode (highlights
// matches inside the rendered #document) and edit mode (selects the current
// match in the shared textarea).
//
// Idempotency: calling initFindBar twice is a no-op; pressing Ctrl+F repeatedly
// only flips .hidden and focuses the input — nothing is cloned, nothing stacks.
//
// Reuses the pure findMatches / nextMatchIndex from editor-logic.js so the
// matching rules stay in one place and stay unit-tested.

import { findMatches, nextMatchIndex } from '../lib/editor-logic.js';

const CASE_KEY = 'mdpeek-find-case';

let created = false;
let overlay;        // #find-overlay — the fixed wrapper
let input;          // .find-input
let countEl;        // .find-count
let caseBtn;        // .find-toggle (Aa)

// Module state. Single source of truth, reset on close.
let query = '';
let caseSensitive = false;
let marks = [];     // [<mark>] in view mode; empty in edit mode
let matchIdx = -1;
let debounceTimer = null;

// PDF search state.
let pdfMatches = [];     // [{ page, start, end }] — flat offsets into per-page text
let pdfHighlights = [];  // [<div>] overlay elements
let pdfSearching = false;

// Accessors handed in by main.js — let us ask for the live mode/editor/doc
// without holding direct references (those change on every tab switch).
let ctx = {
  getMode: () => 'view',
  getEditor: () => null,
  getDocument: () => null,
};

// ---------- DOM construction (once) ----------
function build() {
  overlay = document.createElement('div');
  overlay.id = 'find-overlay';
  overlay.className = 'find-overlay hidden';
  overlay.innerHTML = `
    <div class="find-bar-card">
      <button class="find-toggle" id="find-case" title="Match case" aria-label="Match case" aria-pressed="false" type="button">Aa</button>
      <input type="text" class="find-input" placeholder="Find…" spellcheck="false" autocomplete="off" />
      <span class="find-count">0/0</span>
      <button class="find-prev tool-btn icon-only" title="Previous (Shift+Enter)" aria-label="Previous match" type="button">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
      <button class="find-next tool-btn icon-only" title="Next (Enter)" aria-label="Next match" type="button">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <button class="find-close tool-btn icon-only" title="Close (Esc)" aria-label="Close find bar" type="button">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  input = overlay.querySelector('.find-input');
  countEl = overlay.querySelector('.find-count');
  caseBtn = overlay.querySelector('#find-case');

  // Restore case preference.
  caseSensitive = localStorage.getItem(CASE_KEY) === '1';
  caseBtn.setAttribute('aria-pressed', String(caseSensitive));
  caseBtn.classList.toggle('active', caseSensitive);

  wireOnce();
}

// ---------- listeners (attached exactly once) ----------
function wireOnce() {
  caseBtn.addEventListener('click', () => setCaseSensitive(!caseSensitive));

  input.addEventListener('input', () => {
    query = input.value;
    // Debounce so typing through a long doc stays smooth.
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(run, 120);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(!e.shiftKey); // Enter = next, Shift+Enter = prev
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Esc clears the query first; a second Esc (or empty query) closes.
      if (input.value !== '') {
        input.value = '';
        query = '';
        run();
      } else {
        close();
      }
    } else if (e.key === 'F3') {
      e.preventDefault();
      step(!e.shiftKey);
    }
  });

  overlay.querySelector('.find-prev').addEventListener('click', () => step(false));
  overlay.querySelector('.find-next').addEventListener('click', () => step(true));
  overlay.querySelector('.find-close').addEventListener('click', close);
}

// ---------- core search ----------
// Runs the current query against the active mode and updates count + highlights.
function run() {
  clearMarks();
  clearPdfHighlights();
  const doc = ctx.getDocument();
  const mode = ctx.getMode();
  if (mode === 'edit') {
    runEdit();
  } else if (mode === 'pdf') {
    runPdf(ctx.getPdf());
  } else {
    runView(doc);
  }
  updateCount();
  input.classList.toggle('no-match', query !== '' && matchIdx === -1);
}

// Edit mode: find over textarea content, select + scroll to current match.
// Does NOT steal focus from the find input — we only set the selection range
// and scroll the textarea so the match is visible. Focus moves to the editor
// only on explicit navigation (Enter / next-prev button) via jumpEditFocus.
function runEdit() {
  const editor = ctx.getEditor();
  if (!editor || !query) {
    matchIdx = -1;
    return;
  }
  const text = editor.getValue();
  const ms = findMatches(text, query, caseSensitive);
  if (ms.length === 0) {
    matchIdx = -1;
    return;
  }
  const caret = editor.getState().end;
  matchIdx = nextMatchIndex(ms, caret, true);
  showMatch(editor, ms[matchIdx], text, false);
}

// Visually show a match in the textarea: set selection + scroll. When
// `focusEditor` is true (explicit navigation), move focus to the textarea;
// otherwise leave focus where it is (find input keeps focus while typing).
function showMatch(editor, m, text, focusEditor) {
  if (focusEditor) editor.focus();
  editor.setState({ start: m.start, end: m.end });
  // Best-effort vertical centering: line-based, ignores wrapping.
  const lineNum = text.slice(0, m.start).split('\n').length - 1;
  const lineHeight = parseFloat(getComputedStyle(editor.textarea()).lineHeight);
  const ta = editor.textarea();
  ta.scrollTop = Math.max(0, lineNum * lineHeight - ta.clientHeight / 2);
}

// View mode: walk text nodes of #document, wrap matches in <mark>.
function runView(container) {
  if (!container || !query) {
    matchIdx = -1;
    return;
  }
  const ranges = collectTextRanges(container);
  if (ranges.length === 0) {
    matchIdx = -1;
    return;
  }
  // Build a flat string + offset→{node, localOffset} map for findMatches.
  let text = '';
  const map = [];
  for (const { node, text: seg } of ranges) {
    for (let i = 0; i < seg.length; i++) {
      map.push({ node, offset: i });
    }
    text += seg;
  }
  const ms = findMatches(text, query, caseSensitive);
  if (ms.length === 0) {
    matchIdx = -1;
    return;
  }
  // Pick the match nearest the current scroll position (first visible match).
  matchIdx = pickNearest(container, ms, map);
  wrapMatches(ms, matchIdx, container);
}

// Walk #document, collecting (textNode, text) for every text node we should
// search. Skips <script>/<style>/<svg> subtrees; descends into highlight.js
// spans inside <pre><code>.
function collectTextRanges(root) {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.nodeName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
      // Skip SVG (mermaid) — text inside diagrams is not searchable here.
      if (p.closest('svg')) return NodeFilter.FILTER_REJECT;
      // Skip <mark> we just inserted — avoids double-wrapping on re-run.
      if (p.classList && (p.classList.contains('find-match') || p.classList.contains('find-current'))) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.nodeValue && node.nodeValue.length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let n;
  while ((n = walker.nextNode())) {
    out.push({ node: n, text: n.nodeValue });
  }
  return out;
}

function pickNearest(container, ms, map) {
  // Heuristic: find the first match whose midpoint is at or below the current
  // viewport top. Falls back to the last match if all are above it.
  const top = container.scrollTop;
  let fallback = 0;
  for (let i = 0; i < ms.length; i++) {
    const mid = (ms[i].start + ms[i].end) / 2 | 0;
    const { node } = map[mid] || {};
    if (!node) continue;
    const elTop = node.parentElement.getBoundingClientRect().top;
    const absTop = elTop + container.scrollTop - container.getBoundingClientRect().top;
    if (absTop >= top - 8) return i;
    fallback = i;
  }
  return fallback;
}

// Split text nodes and wrap each match range in <mark>. Processes matches in
// FORWARD order, advancing a cursor over a fresh TreeWalker so that when a
// text node is split (by surroundContents), we continue from the remainder
// node — letting two matches in the SAME original paragraph both highlight.
function wrapMatches(ms, currentIdx, container) {
  // Re-walk fresh: we need live text nodes that survive splits. Using a
  // TreeWalker is fragile across re-parenting, so instead we locate each
  // match by re-scanning text nodes under `container` for every match —
  // simple and robust, O(textNodes × matches) which is fine for a doc viewer.
  for (let i = 0; i < ms.length; i++) {
    const startFlat = ms[i].start;
    const endFlat = ms[i].end;
    const located = locateFlatRange(container, startFlat, endFlat);
    if (!located) continue;

    const mark = document.createElement('mark');
    mark.className = 'find-match' + (i === currentIdx ? ' find-current' : '');
    try {
      located.range.surroundContents(mark);
    } catch (e) {
      try {
        const frag = located.range.extractContents();
        mark.appendChild(frag);
        located.range.insertNode(mark);
      } catch (e2) {
        continue;
      }
    }
    marks.push(mark);
  }
  if (marks[currentIdx]) {
    marks[currentIdx].scrollIntoView({ block: 'center', behavior: 'auto' });
  }
}

// Walk `container`'s text nodes with a flat-offset accumulator and build a
// Range covering [startFlat, endFlat) in the concatenated text. Skips text
// inside <script>/<style>/svg. Does NOT skip text inside already-inserted
// <mark> elements — counting it keeps the flat offsets consistent with the
// original concatenation, and since matches are non-overlapping we never
// double-wrap. Re-walked per match so splits from earlier matches are seen.
function locateFlatRange(container, startFlat, endFlat) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.nodeName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
      if (p.closest('svg')) return NodeFilter.FILTER_REJECT;
      return node.nodeValue && node.nodeValue.length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let flat = 0;
  let sNode = null, sOff = 0, eNode = null, eOff = 0;
  let n;
  while ((n = walker.nextNode())) {
    const len = n.nodeValue.length;
    const segEnd = flat + len;
    if (sNode === null && startFlat < segEnd) {
      sNode = n;
      sOff = startFlat - flat;
    }
    if (eNode === null && endFlat <= segEnd) {
      eNode = n;
      eOff = endFlat - flat;
      break;
    }
    flat = segEnd;
  }
  if (!sNode || !eNode) return null;
  try {
    const range = document.createRange();
    range.setStart(sNode, sOff);
    range.setEnd(eNode, eOff);
    return { range };
  } catch (e) {
    return null;
  }
}

// Remove every <mark.find-match> we inserted, restoring the original text nodes.
function clearMarks() {
  if (marks.length === 0) return;
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    if (parent.normalize) parent.normalize();
  }
  marks = [];
}

// ---------- navigation ----------
function step(forward) {
  const mode = ctx.getMode();
  if (mode === 'edit') {
    stepEdit(forward);
  } else if (mode === 'pdf') {
    stepPdf(forward);
  } else {
    stepView(forward);
  }
  updateCount();
}

function stepEdit(forward) {
  const editor = ctx.getEditor();
  if (!editor || !query) return;
  const text = editor.getValue();
  const ms = findMatches(text, query, caseSensitive);
  if (ms.length === 0) {
    matchIdx = -1;
    return;
  }
  const caret = editor.getState().end;
  matchIdx = nextMatchIndex(ms, forward ? caret : editor.getState().start, forward);
  // Explicit navigation (Enter / next-prev): move focus to the editor so the
  // user can keep typing there if they wish.
  showMatch(editor, ms[matchIdx], text, true);
}

// ---------- PDF search ----------
// Search across all pages by extracting text via getTextContent (cached in
// the controller). Matches are stored as { page, start, end } and highlighted
// with overlay divs positioned over the text layer spans.
async function runPdf(controller) {
  if (!controller || !controller.pdfDoc || !query) {
    pdfMatches = [];
    matchIdx = -1;
    return;
  }
  countEl.textContent = 'Searching…';
  pdfMatches = [];
  for (let page = 1; page <= controller.pdfDoc.numPages; page++) {
    const text = controller.textCache.get(page) || '';
    if (!text) continue;
    const ms = findMatches(text, query, caseSensitive);
    for (const m of ms) {
      pdfMatches.push({ page, start: m.start, end: m.end });
    }
  }
  if (pdfMatches.length === 0) {
    matchIdx = -1;
    return;
  }
  matchIdx = 0;
  await highlightPdfMatches(controller);
}

// Position overlay divs over the matched text spans on each affected page.
async function highlightPdfMatches(controller) {
  clearPdfHighlights();
  // Group matches by page.
  const byPage = new Map();
  for (let i = 0; i < pdfMatches.length; i++) {
    const m = pdfMatches[i];
    if (!byPage.has(m.page)) byPage.set(m.page, []);
    byPage.get(m.page).push(i);
  }
  for (const [page, indices] of byPage) {
    const textLayer = controller.textLayers.get(page);
    if (!textLayer) continue;
    const divs = textLayer.textDivs || [];
    const text = controller.textCache.get(page) || '';
    for (const idx of indices) {
      const m = pdfMatches[idx];
      // Compute the bounding rect of the matched character range by unioning
      // the rects of the text spans that fall within [start, end).
      const rect = spanRectForRange(divs, text, m.start, m.end);
      if (!rect) continue;
      const wrapper = controller.container.querySelector(
        `.pdf-page[data-page-num="${page}"]`
      );
      if (!wrapper) continue;
      const overlay = document.createElement('div');
      overlay.className = 'pdf-search-highlight' + (idx === matchIdx ? ' pdf-search-current' : '');
      overlay.style.left = rect.left + 'px';
      overlay.style.top = rect.top + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
      wrapper.appendChild(overlay);
      pdfHighlights.push(overlay);
    }
  }
  // Scroll to the current match.
  scrollToPdfMatch(controller);
}

// Given the text-layer spans and a flat [start,end) range, compute the union
// bounding rect in page-relative coordinates. Each span carries its own text;
// we reconstruct which spans the range covers by accumulating lengths.
function spanRectForRange(divs, fullText, start, end) {
  let offset = 0;
  let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
  let found = false;
  for (const span of divs) {
    const len = (span.textContent || '').length;
    const spanStart = offset;
    const spanEnd = offset + len;
    offset = spanEnd;
    // Does this span overlap [start, end)?
    if (spanEnd <= start || spanStart >= end) continue;
    const rect = span.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    found = true;
    // Convert to page-relative coords.
    const parent = span.offsetParent;
    if (!parent) continue;
    const parentRect = parent.getBoundingClientRect();
    minLeft = Math.min(minLeft, rect.left - parentRect.left);
    minTop = Math.min(minTop, rect.top - parentRect.top);
    maxRight = Math.max(maxRight, rect.right - parentRect.left);
    maxBottom = Math.max(maxBottom, rect.bottom - parentRect.top);
  }
  if (!found) return null;
  return {
    left: minLeft,
    top: minTop,
    width: Math.max(1, maxRight - minLeft),
    height: Math.max(1, maxBottom - minTop),
  };
}

function stepPdf(forward) {
  if (pdfMatches.length === 0) return;
  matchIdx = (matchIdx + (forward ? 1 : -1) + pdfMatches.length) % pdfMatches.length;
  // Restyle overlays + scroll.
  for (const ov of pdfHighlights) {
    ov.classList.remove('pdf-search-current');
  }
  if (pdfHighlights[matchIdx]) {
    pdfHighlights[matchIdx].classList.add('pdf-search-current');
  }
  const controller = ctx.getPdf();
  if (controller) scrollToPdfMatch(controller);
}

function scrollToPdfMatch(controller) {
  if (!pdfHighlights[matchIdx]) return;
  pdfHighlights[matchIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function clearPdfHighlights() {
  for (const ov of pdfHighlights) ov.remove();
  pdfHighlights = [];
}

function stepView(forward) {
  const container = ctx.getDocument();
  if (!container || marks.length === 0) {
    run();
    return;
  }
  // Re-find against the current text (cheap) to get fresh indices, then map
  // back to marks. This handles the case where the user scrolled.
  matchIdx = (matchIdx + (forward ? 1 : -1) + marks.length) % marks.length;
  for (let i = 0; i < marks.length; i++) {
    marks[i].classList.toggle('find-current', i === matchIdx);
  }
  marks[matchIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function updateCount() {
  // For view mode the count = marks.length; for edit mode we re-count cheaply;
  // for PDF the count = pdfMatches.length.
  let total;
  const mode = ctx.getMode();
  if (mode === 'edit') {
    const editor = ctx.getEditor();
    total = editor ? findMatches(editor.getValue(), query, caseSensitive).length : 0;
  } else if (mode === 'pdf') {
    total = pdfMatches.length;
  } else {
    total = marks.length;
  }
  countEl.textContent = total === 0 ? '0/0' : `${matchIdx + 1}/${total}`;
}

// ---------- public API ----------
function isOpen() {
  return overlay && !overlay.classList.contains('hidden');
}

function open() {
  if (!overlay) build();
  overlay.classList.remove('hidden');
  // Seed the query from the current selection — only if the input is empty
  // (so Ctrl+F twice doesn't overwrite what the user is typing).
  if (input.value === '') {
    const seed = readSelectionSeed();
    if (seed) {
      input.value = seed;
      query = seed;
    }
  }
  input.focus();
  input.select();
  run();
}

function close() {
  if (!overlay) return;
  clearTimeout(debounceTimer);
  clearMarks();
  clearPdfHighlights();
  pdfMatches = [];
  overlay.classList.add('hidden');
  matchIdx = -1;
  countEl.textContent = '0/0';
  input.classList.remove('no-match');
  // Return focus to the editor/document so keyboard shortcuts keep working.
  if (ctx.getMode() === 'edit') {
    const editor = ctx.getEditor();
    if (editor) {
      // Collapse any match selection so the user's next keystroke inserts
      // instead of replacing a leftover highlighted match. Put the caret at
      // the selection end so typing continues naturally.
      const { end } = editor.getState();
      editor.setState({ start: end, end, scrollTop: editor.textarea().scrollTop });
      editor.focus();
    }
  }
}

function toggle() {
  if (isOpen()) {
    input.focus();
    input.select();
  } else {
    open();
  }
}

// Read the current selection to seed the query. Returns '' if nothing useful.
function readSelectionSeed() {
  if (ctx.getMode() === 'edit') {
    const editor = ctx.getEditor();
    if (!editor) return '';
    const { start, end } = editor.getState();
    if (start === end) return '';
    const sel = editor.getValue().slice(start, end);
    // Only seed single-line selections (multi-line is usually a deliberate cut).
    return sel.includes('\n') ? '' : sel;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
  const text = sel.toString();
  if (!text || text.includes('\n')) return '';
  // Only seed from selections inside the document pane.
  const container = ctx.getDocument();
  if (!container || !container.contains(sel.anchorNode)) return '';
  return text;
}

// Force a re-run without touching the input (used after external doc reloads).
function refresh() {
  if (isOpen()) run();
}

// External entry point for the settings dialog to set case-sensitivity live.
// Updates the button + persisted pref + re-runs the search if open.
function setCaseSensitive(value) {
  caseSensitive = !!value;
  localStorage.setItem(CASE_KEY, caseSensitive ? '1' : '0');
  if (caseBtn) {
    caseBtn.setAttribute('aria-pressed', String(caseSensitive));
    caseBtn.classList.toggle('active', caseSensitive);
  }
  if (isOpen()) run();
}

export function initFindBar(accessors) {
  if (created) return; // idempotent
  created = true;
  ctx = { ...ctx, ...accessors };
  build();
  return { open, close, toggle, isOpen, refresh, setCaseSensitive, findNext: () => step(true), findPrev: () => step(false) };
}
