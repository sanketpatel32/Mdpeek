// Renders the tab strip into #tab-strip from a DocumentStore.
// Returns nothing; main.js attaches click/close handlers after render.
// This module also installs one-time *presentational* drag hooks on the strip
// (drag ghost opacity, insertion-point bar, snap-back settle) — they only
// decorate; main.js's own dragstart/dragover/drop handlers still own the
// actual reorder data flow.

import { escapeHtml } from '../lib/escape.js';
import { getIconForPath } from '../lib/file-type.js';

function titleFor(doc) {
  if (doc.path) {
    const parts = doc.path.split(/[\\/]/);
    return parts[parts.length - 1];
  }
  return 'Untitled';
}

// Native tooltip text: full path first (the filename alone is ambiguous when
// several folders are open), then state suffixes. The dirty marker mirrors
// the status bar's "· edited" wording so both cues read the same way.
function tooltipFor(doc) {
  let t = doc.path || (doc.shared ? 'Shared document' : 'Untitled');
  if (doc.dirty) t += ' — unsaved changes';
  if (doc.pinned) t += ' — pinned';
  return t;
}

// File-type badge for saved files; no badge for untitled tabs.
// getIconForPath picks the right glyph (SVG for special types, colored
// letter badge for code languages, generic file otherwise).
function iconFor(doc) {
  if (!doc.path) return '';
  return getIconForPath(doc.path, 'tab-icon');
}

// ---------- render-state tracking ----------
// The last HTML we wrote into the strip. Redundant renders used to re-run
// innerHTML with identical markup, which restarts every CSS animation in the
// strip — most visibly the .tab-dot--dirty breathe snapping back to full
// opacity mid-cycle on rapid save/edit cycles. markDirty/clearDirty already
// guard store events to clean⇄dirty transitions, but collab status and other
// flows can still call render() with no visual delta. Skipping identical
// markup keeps dot animation phase stable without introducing async timing
// (a rAF debounce would break callers that measure the strip immediately
// after renderTabs returns, e.g. positionTabIndicator).
let _lastHtml = null;

// Previous pinned flags per tab id — lets us pop a settle animation on the
// exact tab that was just pinned/unpinned instead of letting it teleport.
const _prevPinned = new Map();

// True when the environment honors reduced motion. Re-checked lazily because
// jsdom (tests) has no matchMedia at all.
function prefersReducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch { return false; }
}

// Short WAAPI settle (fade+scale-in). Used for pin/unpin transitions and as
// the drag snap-back affordance. No-ops under reduced motion or where
// Element.animate is missing. Uses only opacity/transform so it stays valid
// across themes without reading color tokens per-frame. The easing is a
// literal mirror of --ease-out because WAAPI's easing option cannot resolve
// CSS var() — passing one throws synchronously and the catch below would
// silently disable the whole settle.
function settle(el, keyframes, duration) {
  if (!el || typeof el.animate !== 'function') return;
  if (prefersReducedMotion()) return;
  try { el.animate(keyframes, { duration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }); } catch { /* never fatal */ }
}
function popIn(el) {
  settle(el, [
    { opacity: '0.35', transform: 'scale(0.94)' },
    { opacity: '1', transform: 'scale(1)' },
  ], parseInt(getComputedStyle(document.documentElement).getPropertyValue('--dur-2') || '180', 10) || 180);
}

// ---------- overflow scrolling ----------
// Scroll the active (typically just-opened) tab fully into view. Unlike the
// old scrollIntoView call this:
//   • scrolls ONLY the strip horizontally (scrollIntoView could also nudge
//     ancestor scroll containers vertically),
//   • insets the target by the edge-fade width (--sp-4, the 12px gradient
//     veil on .tab-strip) so the revealed tab isn't half-hidden under the fade,
//   • uses scrollTo behavior:'smooth', downgraded to 'auto' for reduced motion.
function ensureActiveVisible(strip) {
  const active = strip.querySelector('.tab.active');
  if (!active || typeof strip.scrollTo !== 'function') return;
  const stripRect = strip.getBoundingClientRect();
  const r = active.getBoundingClientRect();
  if (r.width === 0) return; // hidden / not laid out yet
  const cs = getComputedStyle(strip);
  const fade = parseFloat(cs.getPropertyValue('--sp-4')) || 16;
  const left = r.left - stripRect.left + strip.scrollLeft;
  const right = left + r.width;
  let target = null;
  if (left < strip.scrollLeft + fade) target = Math.max(0, left - fade);
  else if (right > strip.scrollLeft + strip.clientWidth - fade) target = right - strip.clientWidth + fade;
  // Already comfortably visible → don't yank the user's manual scroll position.
  if (target === null || Math.abs(target - strip.scrollLeft) < 1) return;
  try {
    strip.scrollTo({ left: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  } catch {
    strip.scrollLeft = target; // older engines without object form
  }
}

// ---------- drag decoration (one-time delegated hooks) ----------
let _hooksInstalled = false;
let _dragId = null;        // mirror of main.js's _dragTabId, presentational only
let _dropLanded = false;   // did our drop listener see a same-group landing?

let _insBar = null;        // insertion-point indicator bar (lives inside the strip)
let _ghost = null;         // off-screen drag-image clone

function hideInsertBar() {
  if (_insBar) _insBar.style.opacity = '0';
}
function removeGhost() {
  if (_ghost) { _ghost.remove(); _ghost = null; }
}

// Lazily create the 2px accent bar that shows exactly where the drop will
// land. Absolutely positioned inside #tab-strip (position:relative per
// base.css), pointer-events:none so it can never become e.target of the very
// dragover/drop events it decorates. Left coordinates are content-relative
// (+scrollLeft, same math positionTabIndicator uses) so it tracks correctly
// while the strip is scrolled.
function showInsertBar(strip, tabEl, side) {
  if (!_insBar || !_insBar.isConnected) {
    _insBar = document.createElement('div');
    _insBar.setAttribute('aria-hidden', 'true');
    Object.assign(_insBar.style, {
      position: 'absolute',
      top: '5px',
      bottom: '5px',
      width: '2px',
      borderRadius: '2px',
      background: 'var(--accent)',
      // z-index 3: above tab backgrounds/labels within the strip's stacking
      // context (strip is position:relative per base.css) — nothing else in
      // the strip is layered, so any low value above content works.
      zIndex: '3',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'left var(--dur-1, 120ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), opacity var(--dur-1, 120ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1))',
    });
    strip.appendChild(_insBar);
  }
  const stripRect = strip.getBoundingClientRect();
  const r = tabEl.getBoundingClientRect();
  let x = r.left - stripRect.left + strip.scrollLeft;
  if (side === 'after') x += r.width + 1; // +1 centers it in the 1px flex gap
  else x -= 3;
  _insBar.style.left = `${x}px`;
  _insBar.style.opacity = '1';
}

// Low-opacity clone of the tab used as the native drag image — the default
// is an opaque snapshot of the whole strip row which reads as "ripped out".
function makeDragImage(tab, e) {
  if (!e.dataTransfer || typeof e.dataTransfer.setDragImage !== 'function') return;
  const ghost = tab.cloneNode(true);
  ghost.classList.add('is-dragging'); // hook, in case CSS ever wants it
  Object.assign(ghost.style, {
    position: 'fixed',
    top: '-9999px',
    left: '-9999px',
    width: `${tab.offsetWidth}px`,
    height: `${tab.offsetHeight}px`,
    margin: '0',
    opacity: '0.85',
    background: 'var(--surface)',
    boxShadow: 'var(--shadow-md)',
    pointerEvents: 'none',
  });
  document.body.appendChild(ghost);
  _ghost = ghost;
  e.dataTransfer.setDragImage(ghost, 14, 14);
  // setDragImage snapshots synchronously during dragstart; drop the clone on
  // the next tick so it never paints.
  setTimeout(removeGhost, 0);
}

function installDragHooks(strip) {
  if (_hooksInstalled || !strip) return;
  _hooksInstalled = true;

  strip.addEventListener('dragstart', (e) => {
    const tab = e.target && e.target.closest ? e.target.closest('.tab') : null;
    if (!tab) return;
    _dragId = tab.dataset.id;
    _dropLanded = false;
    tab.classList.add('is-dragging');
    tab.style.opacity = '0.45'; // dim the source slot while its ghost flies
    try { makeDragImage(tab, e); } catch { /* jsdom / odd engines */ }
  });

  strip.addEventListener('dragover', (e) => {
    if (!_dragId) return;
    const tab = e.target && e.target.closest ? e.target.closest('.tab') : null;
    if (!tab || tab.dataset.id === _dragId) return hideInsertBar();
    // Cross-group drops (pinned ↔ unpinned) are rejected by main.js — don't
    // promise a landing spot we won't honor.
    const src = strip.querySelector('.tab.is-dragging');
    if (!src || src.classList.contains('pinned') !== tab.classList.contains('pinned')) {
      return hideInsertBar();
    }
    const r = tab.getBoundingClientRect();
    showInsertBar(strip, tab, e.clientX < r.left + r.width / 2 ? 'before' : 'after');
  });

  strip.addEventListener('drop', () => { _dropLanded = true; hideInsertBar(); });
  strip.addEventListener('dragleave', (e) => {
    // Only when the pointer actually exits the strip, not when crossing gaps
    // between child elements (dragleave fires for those too).
    if (!e.relatedTarget || !(e.relatedTarget.closest && e.relatedTarget.closest('.tab-strip'))) {
      hideInsertBar();
    }
  });

  strip.addEventListener('dragend', () => {
    hideInsertBar();
    removeGhost();
    if (!_dragId) return;
    const src = strip.querySelector('.tab.is-dragging');
    if (src) {
      src.classList.remove('is-dragging');
      src.style.opacity = '';
      // Snap-back: animate the source settling home only when nothing moved
      // (invalid cross-group drop, released over empty space, Esc). After a
      // successful reorder the strip re-renders and the new layout itself
      // communicates the result.
      if (!_dropLanded) popIn(src);
    }
    _dragId = null;
    _dropLanded = false;
  });
}

export function renderTabs(store) {
  const strip = document.getElementById('tab-strip');
  if (!strip) return;
  installDragHooks(strip);

  const html = store.docs
    .map((d) => {
      const active = d.id === store.activeId ? ' active' : '';
      const pinned = d.pinned ? ' pinned' : '';
      const shared = d.shared ? ' shared' : '';
      // v0.67.0: dot modifiers — a shared+dirty tab used to render two
      // identically-green dots (the shared tint overrode the dirty one).
      const dirty = d.dirty ? '<span class="tab-dot tab-dot--dirty" title="Unsaved changes">●</span>' : '';
      // Shared docs show a green "live" dot so the collab state is visible at
      // a glance even when there are no unsaved changes. Pulses via the
      // existing global @keyframes dot-pulse (base.css) applied inline — no
      // new CSS needed; motion.css's global prefers-reduced-motion kill-switch
      // still overrides it because inline styles lose to !important rules.
      const sharedDotStyle = d.dirty ? '' : ' style="animation: dot-pulse 2s ease-in-out infinite"';
      const sharedDot = d.shared ? `<span class="tab-dot tab-dot--shared"${sharedDotStyle} title="Live collaboration">●</span>` : '';
      const icon = iconFor(d);
      const title = escapeHtml(titleFor(d));
      // Pinned tabs: title is hidden via CSS; the close × is also hidden (you
      // unpin via the context menu, not by closing). Title attribute carries
      // full path + modified/pinned state so hover-tooltips stay useful.
      // v0.67.0: role=tab + roving tabindex (arrows/Enter handled in
      // main.js), draggable for drag-to-reorder, and the close affordance is
      // a real focusable <button>.
      // Close-button hit area: 18px was tight for a pointer target; inline
      // min-width/min-height grow the clickable chip to 20px without touching
      // the stylesheet (inline styles outrank the base.css dimensions).
      return `<div class="tab${active}${pinned}${shared}" data-id="${d.id}" role="tab" aria-selected="${active ? 'true' : 'false'}" tabindex="${active ? '0' : '-1'}" draggable="true" title="${escapeHtml(tooltipFor(d))}">
        ${icon}<span class="tab-title">${title}</span>${dirty}${sharedDot}
        <button class="tab-close" data-id="${d.id}" type="button" title="Close (Ctrl+W)" aria-label="Close tab" style="min-width:20px;min-height:20px;width:20px;height:20px">×</button>
      </div>`;
    })
    .join('');

  // Identical markup → keep the existing DOM (and its running animations).
  if (html !== _lastHtml || !strip.querySelector('.tab')) {
    strip.innerHTML = html;
    _lastHtml = html;

    // Pin/unpin transition: pop the tab whose pinned flag just flipped, so
    // the shrink-to-icon / expand-to-full change reads as a deliberate state
    // change rather than an instant teleport across the strip.
    for (const d of store.docs) {
      if (_prevPinned.has(d.id) && _prevPinned.get(d.id) !== !!d.pinned) {
        const el = strip.querySelector(`.tab[data-id="${d.id}"]`);
        popIn(el);
      }
      _prevPinned.set(d.id, !!d.pinned);
    }
    // Drop ids for tabs that were closed so the map can't grow unbounded.
    for (const id of [..._prevPinned.keys()]) {
      if (!store.docs.some((d) => d.id === id)) _prevPinned.delete(id);
    }
  }

  // Keep the roving tabindex honest across re-renders: exactly one tab (the
  // active one, or the first) is tabbable. Also runs after skipped renders —
  // cheap, and covers main.js's arrow-key roving having moved tabIndex.
  const tabs = strip.querySelectorAll('.tab');
  tabs.forEach((t) => { t.tabIndex = t.classList.contains('active') ? 0 : -1; });
  if (tabs.length && ![...tabs].some((t) => t.tabIndex === 0)) tabs[0].tabIndex = 0;

  // Auto-scroll the active/new tab into view (see ensureActiveVisible).
  ensureActiveVisible(strip);
}
