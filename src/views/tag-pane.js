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
let _selectedTag = null; // tag whose chip renders with the accent treatment

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
    // Selected-tag accent treatment: mark the clicked chip, unmark siblings,
    // and remember it so render() can re-apply after a re-render.
    _selectedTag = chip.dataset.tag || null;
    listEl.querySelectorAll('.tag-chip.selected').forEach((c) => c.classList.remove('selected'));
    chip.classList.add('selected');
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
  injectPolishStyles();
  onTagClick = onTag || null;
  created = true;
  return { open, close, render, resetForTest };
}

// UI-polish styles owned by this view. Injected once as a <style> tag so the
// shared stylesheets stay untouched; every value references the global :root
// custom properties from themes.css, so all themes pick these up.
function injectPolishStyles() {
  if (document.getElementById('tag-pane-polish')) return;
  const style = document.createElement('style');
  style.id = 'tag-pane-polish';
  style.textContent = `
    /* Count reads as a quiet badge: tabular digits stop "11 tags" from
       shifting width as the count changes. */
    .tag-pane-count {
      font-variant-numeric: tabular-nums;
      font-weight: 500;
    }
    /* Chip hover: strengthen fill/border; press: tactile dip; keyboard:
       visible ring matching tree rows' focus treatment. */
    .tag-chip {
      transition: background var(--dur-1) var(--ease-out),
                  border-color var(--dur-1) var(--ease-out),
                  transform var(--dur-1) var(--ease-out);
    }
    .tag-chip:hover {
      background: color-mix(in srgb, var(--accent) 22%, transparent);
      border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    }
    .tag-chip:active {
      transform: scale(0.96);
      background: color-mix(in srgb, var(--accent) 28%, transparent);
    }
    .tag-chip:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
    }
    /* The tag that seeded the current search keeps a solid accent treatment
       while its chip is on screen. */
    .tag-chip.selected {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--bg);
      font-weight: 600;
    }
    .tag-chip.selected:hover {
      background: var(--accent-hover);
      border-color: var(--accent-hover);
    }
    /* Empty state: a quiet dashed well instead of bare floating text. */
    .tag-pane-empty {
      padding: var(--sp-5) var(--sp-4);
      border: 1px dashed color-mix(in srgb, var(--fg-muted) 40%, transparent);
      border-radius: var(--radius);
      margin-top: var(--sp-2);
      animation: tp-empty-in var(--dur-3) var(--ease-out);
    }
    @keyframes tp-empty-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// Test-only: tear down the singleton so a fresh initTagPane() rebuilds the
// DOM. Not called from the app (the pane lives for the app's lifetime).
function resetForTest() {
  if (overlay) overlay.remove();
  created = false;
  overlay = listEl = closeBtn = countEl = emptyEl = null;
  onTagClick = null;
  _selectedTag = null;
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
    .map((t) => `<button class="tag-chip${t === _selectedTag ? ' selected' : ''}" type="button" data-tag="${escapeAttr(t)}">#${escapeText(t)}</button>`)
    .join('');
}

function open() {
  if (!created) return;
  overlay.classList.remove('hidden');
}

function close() {
  if (!created) return;
  overlay.classList.add('hidden');
  // A fresh open starts with no chip pre-selected (the search box it seeded
  // may have been cleared in the meantime).
  _selectedTag = null;
}

// Minimal escapers (avoid pulling escape.js into a view that only renders a
// handful of strings; matches the inline pattern in image-viewer/folder-search).
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
