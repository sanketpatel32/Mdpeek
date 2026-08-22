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

// UI-polish styles owned by this view. Injected once as an id-guarded <style>;
// every value references global tokens so all themes pick these up.
function injectPolishStyles() {
  if (document.getElementById('wf-polish-style')) return;
  const style = document.createElement('style');
  style.id = 'wf-polish-style';
  style.textContent = `
    /* Fifth grid cell for the share-of-total %, revealed only while the row is
       hovered/keyboard-focused — data on demand instead of permanent noise.
       (.wf-count keeps its exact textContent; the pct is a separate cell.) */
    .wf-item {
      grid-template-columns: 28px minmax(80px, 1fr) minmax(60px, 2fr) 44px 44px;
      transition: background var(--dur-1) var(--ease-out);
    }
    .wf-pct {
      color: var(--fg-muted);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      text-align: right;
      opacity: 0;
      transition: opacity var(--dur-1) var(--ease-out);
    }
    .wf-item:hover .wf-pct,
    .wf-item:focus-visible .wf-pct { opacity: 1; }
    /* Top-word accent: rank chip + bar + word all pick up the accent so the
       eye lands on row 1 first and reads the rest as "the long tail". */
    .wf-item.is-top { cursor: pointer; }
    .wf-item.is-top .wf-rank {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      margin-left: auto;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 700;
    }
    .wf-item.is-top .wf-bar-fill { background: var(--accent); opacity: 0.9; }
    .wf-item.is-top .wf-word { color: var(--accent); font-weight: 600; }
    .wf-count { font-variant-numeric: tabular-nums; }
    /* Staggered entrance: rows drift up and bars grow left-to-right, each
       delayed by its rank (capped at 12 steps so long lists still feel snappy).
       Entirely skipped under prefers-reduced-motion. */
    @media (prefers-reduced-motion: no-preference) {
      .wf-item {
        animation: wf-row-in var(--dur-2, 200ms) var(--ease-out) backwards;
        animation-delay: calc(min(var(--wf-i, 0), 12) * 22ms);
      }
      .wf-bar-fill {
        transform-origin: left center;
        animation: wf-bar-in var(--dur-3, 240ms) var(--ease-spring, ease-out) backwards;
        animation-delay: calc(min(var(--wf-i, 0), 12) * 22ms + 30ms);
      }
      @keyframes wf-row-in {
        from { opacity: 0; transform: translateY(4px); }
      }
      @keyframes wf-bar-in {
        from { transform: scaleX(0); }
      }
    }
  `;
  document.head.appendChild(style);
}

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
  const total = items.reduce((sum, it) => sum + (it.count || 0), 0) || 1;
  listEl.innerHTML = items.map(({ word, count }, i) => {
    const pct = Math.max(4, Math.round((count / max) * 100));
    // Share of total for the hover-only pct cell: whole percents above ~10%,
    // one decimal below, and "<1%" for rounding-edge slivers.
    const share = (count / total) * 100;
    const shareLabel = (share >= 9.95 ? String(Math.round(share)) : share >= 0.95 ? share.toFixed(1) : '<1') + '%';
    return (
      `<li class="wf-item${i === 0 ? ' is-top' : ''}" data-word="${escapeHtml(word)}" tabindex="0" role="button" title="Click to scroll to first occurrence" style="--wf-i:${i}">`
      + `<span class="wf-rank">${i + 1}</span>`
      + `<span class="wf-word">${escapeHtml(word)}</span>`
      + `<span class="wf-bar"><span class="wf-bar-fill" style="width:${pct}%"></span></span>`
      + `<span class="wf-count">${count}</span>`
      + `<span class="wf-pct">${shareLabel}</span>`
      + `</li>`
    );
  }).join('');
}

export function initWordFreqPopover() {
  if (created) return { open, close, isOpen };
  injectPolishStyles();
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
