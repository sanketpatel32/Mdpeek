// v0.55.0: Word-frequency popover — a transient on-demand modal that lists the
// active document's top words by frequency. Toggled by the "Word frequency…"
// command-palette entry. Mirrors the lightweight modal style of table-editor.js
// (singleton overlay appended to <body>, shown/hidden via .hidden, Esc closes).
//
// The popover owns no analysis of its own — the caller (main.js) supplies the
// ranked list via open({ items }), where each item is { word, count } from
// topWords(). Clicking a word calls onWord(word) so the caller can scroll to
// the first occurrence if it wants (best-effort).

let created = false;
let overlay;        // #wf-overlay
let listEl;         // .wf-list
let emptyEl;        // .wf-empty
let onWordCb = null;
let prevFocus = null;

function build() {
  overlay = document.createElement('div');
  overlay.id = 'wf-overlay';
  overlay.className = 'wf-overlay hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Word frequency');
  overlay.innerHTML = ''
    + '<div class="wf-modal">'
    +   '<header class="wf-header">'
    +     '<span class="wf-title">Word frequency</span>'
    +     '<button class="wf-close" type="button" title="Close (Esc)" aria-label="Close word frequency">✕</button>'
    +   '</header>'
    +   '<div class="wf-body">'
    +     '<ol class="wf-list"></ol>'
    +     '<div class="wf-empty hidden">No prose to analyze.</div>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(overlay);
  listEl = overlay.querySelector('.wf-list');
  emptyEl = overlay.querySelector('.wf-empty');
  overlay.querySelector('.wf-close').addEventListener('click', close);
  // Esc closes without scrolling. stopPropagation so it doesn't also trigger the
  // app-level Esc handler.
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      e.stopPropagation();
      close();
    }
  });
  // Delegated click on list items.
  listEl.addEventListener('click', (e) => {
    const li = e.target.closest('.wf-item');
    if (!li) return;
    const word = li.dataset.word;
    if (word && onWordCb) onWordCb(word);
  });
  // Items are focusable (tabindex in the markup) — Enter/Space act like click.
  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const li = e.target.closest('.wf-item');
    if (!li) return;
    e.preventDefault();
    const word = li.dataset.word;
    if (word && onWordCb) onWordCb(word);
  });
}

function isOpen() {
  return created && overlay && !overlay.classList.contains('hidden');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function render(items) {
  if (!items || items.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  // Bar scale: the top word fills the track; others scale relative to it.
  const max = items[0].count || 1;
  listEl.innerHTML = items.map(({ word, count }, i) => {
    const pct = Math.max(4, Math.round((count / max) * 100));
    return (
      `<li class="wf-item" data-word="${escapeHtml(word)}" tabindex="0" role="button" title="Click to scroll to first occurrence">`
      + `<span class="wf-rank">${i + 1}</span>`
      + `<span class="wf-word">${escapeHtml(word)}</span>`
      + `<span class="wf-bar"><span class="wf-bar-fill" style="width:${pct}%"></span></span>`
      + `<span class="wf-count">${count}</span>`
      + `</li>`
    );
  }).join('');
}

export function initWordFreqPopover() {
  if (created) return { open, close, isOpen };
  build();
  created = true;
  return { open, close, isOpen };
}

// opts: { items: [{word, count}], onWord: (word) => void }
function open(opts = {}) {
  if (!created) return;
  onWordCb = typeof opts.onWord === 'function' ? opts.onWord : null;
  render(Array.isArray(opts.items) ? opts.items : []);
  prevFocus = document.activeElement;
  overlay.classList.remove('hidden');
  // Focus the close button so Esc has a target inside the dialog.
  const closeBtn = overlay.querySelector('.wf-close');
  if (closeBtn) closeBtn.focus();
}

function close() {
  if (!created || !overlay) return;
  overlay.classList.add('hidden');
  onWordCb = null;
  if (prevFocus && typeof prevFocus.focus === 'function') {
    try { prevFocus.focus(); } catch (_) { /* element may be gone */ }
    prevFocus = null;
  }
}
