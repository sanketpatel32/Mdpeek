// v0.45.0: Tag pane — a side panel listing every #tag seen across the open
// folder, click a tag to pre-seed folder-search. Tags are gathered by the
// caller (main.js's acListTags, which shells out to the Rust grep) and passed
// to render(); this view is a pure presenter with no IPC of its own.
//
// Singleton like the file-tree / folder-search: one DOM element appended to
// <body>-adjacent layout, shown/hidden by toggling `.hidden`.

let created = false;
let overlay;        // #tag-pane-overlay (the panel root)
let listEl;         // .tag-pane-list (chips container)
let closeBtn;       // .tag-pane-close
let countEl;        // .tag-pane-count ("12 tags")
let onTagClick = null; // (tag) => void — caller wires folder-search.searchWith
let emptyEl;        // .tag-pane-empty ("No tags found")

// Build the DOM once. Mirrors the folder-search singleton shape.
function build() {
  overlay = document.createElement('aside');
  overlay.id = 'tag-pane';
  overlay.className = 'tag-pane hidden';
  overlay.setAttribute('aria-label', 'Tags');
  overlay.innerHTML = ''
    + '<div class="tag-pane-header">'
    +   '<span class="tag-pane-title">Tags</span>'
    +   '<span class="tag-pane-count"></span>'
    +   '<button class="tag-pane-close" type="button" title="Close" aria-label="Close tags">✕</button>'
    + '</div>'
    + '<div class="tag-pane-body">'
    +   '<div class="tag-pane-empty hidden">No tags found in this folder.</div>'
    +   '<div class="tag-pane-list"></div>'
    + '</div>';
  document.body.appendChild(overlay);
  listEl = overlay.querySelector('.tag-pane-list');
  closeBtn = overlay.querySelector('.tag-pane-close');
  countEl = overlay.querySelector('.tag-pane-count');
  emptyEl = overlay.querySelector('.tag-pane-empty');
  closeBtn.addEventListener('click', close);
  // Delegated click on a tag chip.
  listEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.tag-chip');
    if (!chip) return;
    const tag = chip.dataset.tag;
    if (tag && onTagClick) onTagClick(tag);
  });
  // Esc closes (one-time listener — close() no-ops when hidden).
  document.addEventListener('keydown', (e) => {
    // !defaultPrevented: dismissing a picker/modal Esc must not cascade.
    if (e.key === 'Escape' && !e.defaultPrevented && isOpen()) close();
  });
}

function isOpen() {
  return created && overlay && !overlay.classList.contains('hidden');
}

export function initTagPane(onTag) {
  if (created) return { open, close, render, resetForTest };
  build();
  onTagClick = onTag || null;
  created = true;
  return { open, close, render, resetForTest };
}

// Test-only: tear down the singleton so a fresh initTagPane() rebuilds the
// DOM. Not called from the app (the pane lives for the app's lifetime).
function resetForTest() {
  if (overlay) overlay.remove();
  created = false;
  overlay = listEl = closeBtn = countEl = emptyEl = null;
  onTagClick = null;
}

// Render a list of tags (strings, no leading #) into chips. Pass [] to show
// the empty state. Pure DOM — no IPC.
function render(tags) {
  if (!created) return;
  const list = (tags || []).slice();
  if (list.length === 0) {
    emptyEl.classList.remove('hidden');
    listEl.innerHTML = '';
    countEl.textContent = '';
    return;
  }
  emptyEl.classList.add('hidden');
  countEl.textContent = `${list.length} tag${list.length === 1 ? '' : 's'}`;
  listEl.innerHTML = list
    .map((t) => `<button class="tag-chip" type="button" data-tag="${escapeAttr(t)}">#${escapeText(t)}</button>`)
    .join('');
}

function open() {
  if (!created) return;
  overlay.classList.remove('hidden');
}

function close() {
  if (!created) return;
  overlay.classList.add('hidden');
}

// Minimal escapers (avoid pulling escape.js into a view that only renders a
// handful of strings; matches the inline pattern in image-viewer/folder-search).
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
