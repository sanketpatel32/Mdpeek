// Autocomplete dropdown (v0.41.0). A single non-focusable overlay positioned
// at the textarea caret. The pure trigger/candidate logic lives in
// src/lib/autocomplete.js; this module is the DOM glue:
//
//   - On every editor input, detect a trigger at the caret.
//   - If active, fetch candidates (async, debounced) from getSources().
//   - Render up to 8 items as a dropdown.
//   - Intercept Arrow/Tab/Enter/Esc ON THE TEXTAREA (the dropdown never
//     takes focus, so the user keeps typing seamlessly).
//
// Caret positioning uses the editor's existing `.editor-mirror` technique
// (a hidden div that mirrors the textarea's text one-line-per-div, used by
// the gutter + active-line marker). We clone the text up to the caret into
// a scratch mirror and measure the trailing span's bounding rect.

import { detectTrigger, buildCandidates, acceptSuggestion } from '../lib/autocomplete.js';

// Presentation polish (iteration 9). Injected once per app run; selectors are
// two-class deep to win cascade ties against base.css regardless of import
// order. All values reference global tokens with literal fallbacks
// (light-theme values from themes.css); motion is disabled locally under
// prefers-reduced-motion (mirrors the global kill-switch in motion.css).
const AC_POLISH_CSS = `
  /* Snappy entrance (starts immediately on first paint — no opacity-0 delay,
     so trigger latency perception stays zero). */
  .ac-dropdown {
    animation: mdpeek-ac-in var(--dur-1, 120ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
    transform-origin: 0 0;
    overflow: hidden;
  }
  @keyframes mdpeek-ac-in {
    from { opacity: 0.5; transform: translateY(calc(var(--sp-0, 2px) * -1)); }
    to   { opacity: 1; transform: none; }
  }
  /* The list scrolls, not the card — frees the card's ::before/::after for
     static fade edges over the max-height cutoff. */
  .ac-dropdown .ac-list {
    max-height: 272px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--border, #d0d2da) transparent;
  }
  .ac-dropdown .ac-list::-webkit-scrollbar { width: var(--sp-2, 6px); }
  .ac-dropdown .ac-list::-webkit-scrollbar-thumb {
    background: var(--border, #d0d2da);
    border-radius: var(--radius-sm, 5px);
  }
  /* Fade edges — only while content actually overflows (.is-scrollable),
     top edge only once scrolled away from the start (.is-scrolled).
     z-index 1: stack both gradients above the list rows inside the card
     (the dropdown itself creates the stacking context). */
  .ac-dropdown.is-scrollable::after,
  .ac-dropdown.is-scrolled::before {
    content: "";
    position: absolute;
    left: var(--sp-1, 4px);
    right: var(--sp-1, 4px);
    height: var(--sp-5, 16px);
    pointer-events: none;
    z-index: 1;
  }
  .ac-dropdown.is-scrollable::after {
    bottom: var(--sp-1, 4px);
    background: linear-gradient(to top, var(--surface, #f1f2f6) 30%, transparent);
    border-radius: 0 0 calc(var(--radius, 8px) - var(--sp-1, 4px)) calc(var(--radius, 8px) - var(--sp-1, 4px));
  }
  .ac-dropdown.is-scrolled::before {
    top: var(--sp-1, 4px);
    background: linear-gradient(to bottom, var(--surface, #f1f2f6) 30%, transparent);
    border-radius: calc(var(--radius, 8px) - var(--sp-1, 4px)) calc(var(--radius, 8px) - var(--sp-1, 4px)) 0 0;
  }
  /* Hover and keyboard selection share one visual treatment (parity), and
     pointermove syncs the selection index so aria-selected stays truthful. */
  .ac-list .ac-item:hover,
  .ac-list .ac-item.active {
    background: var(--accent-soft, rgba(0, 113, 227, 0.1));
    color: var(--accent, #0071e3);
  }
  .ac-list .ac-item {
    gap: var(--sp-4, 12px);
    padding: var(--sp-2, 6px) var(--sp-3, 8px);
    border-radius: var(--radius-sm, 5px);
    min-width: 0;
    transition: background-color var(--dur-1, 120ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
      color var(--dur-1, 120ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
  }
  /* Row rhythm: label takes the flexible middle with ellipsis; hint hugs the
     right edge without being pushed off-card by long wiki-link labels. */
  .ac-list .ac-item .ac-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.4;
  }
  .ac-list .ac-item .ac-hint {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .ac-dropdown {
      animation: none;
    }
    .ac-list .ac-item {
      transition: none;
    }
  }
`;
function injectAcPolishCss() {
  const id = 'mdpeek-ac-polish';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = AC_POLISH_CSS;
  document.head.appendChild(style);
}

let created = false;
let dropdown;        // .ac-dropdown
let listEl;          // .ac-list
let mirror;          // .ac-mirror (scratch, for caret measurement)

// Live state. `pending` guards against stale async fetches overwriting a
// newer trigger.
let active = null;   // { kind, query, start, end } or null
let items = [];      // current candidate list
let selected = 0;
let pending = 0;     // monotonic token; stale fetches are dropped
// Last fetched sources per trigger kind. Lets refresh() paint the current
// filter synchronously (zero perceived latency) before the async fetch lands.
let sourceCache = {};

// Accessors handed in by main.js.
let ctx = {
  getEditor: () => null,        // returns the editor instance or null
  getSources: async () => ({ emojis: {}, files: [], tags: [] }),
};

function build() {
  injectAcPolishCss();
  dropdown = document.createElement('div');
  dropdown.className = 'ac-dropdown hidden';
  dropdown.setAttribute('role', 'listbox');
  dropdown.setAttribute('aria-label', 'Autocomplete suggestions');
  dropdown.innerHTML = `<ul class="ac-list" role="presentation"></ul>`;
  // Scratch mirror — never appended to the layout, used only to measure the
  // caret position by reflecting the textarea's text up to the caret.
  mirror = document.createElement('div');
  mirror.className = 'ac-mirror editor-mirror';
  mirror.setAttribute('aria-hidden', 'true');
  document.body.appendChild(dropdown);
  document.body.appendChild(mirror);
  listEl = dropdown.querySelector('.ac-list');
  // Fade-edge state (see .is-scrollable/.is-scrolled in AC_POLISH_CSS).
  listEl.addEventListener('scroll', updateScrollEdges, { passive: true });
  // Hover parity: moving the pointer over an item makes it the selection
  // (same treatment, same aria-selected) — pointermove only fires on real
  // movement, so merely appearing under a stationary cursor can't steal it.
  listEl.addEventListener('pointermove', (e) => {
    const li = e.target.closest('.ac-item');
    if (!li) return;
    const i = parseInt(li.dataset.i, 10);
    if (!Number.isNaN(i) && i !== selected) setActive(i);
  });
}

// Toggle the fade edges: bottom gradient while the list overflows its
// max-height, top gradient once scrolled away from the first row.
function updateScrollEdges() {
  if (!listEl || !dropdown) return;
  const scrollable = listEl.scrollHeight > listEl.clientHeight + 1;
  dropdown.classList.toggle('is-scrollable', scrollable);
  dropdown.classList.toggle('is-scrolled', scrollable && listEl.scrollTop > 2);
}

// v0.68.0: the active doc may have no editor at all (canvas / pdf / home
// tabs) — getEditor() returns null there and the old unguarded chain threw
// from renderActive's tab-switch path, aborting the whole re-render.
function activeTextarea() {
  const ed = ctx && ctx.getEditor ? ctx.getEditor() : null;
  return ed && typeof ed.textarea === 'function' ? ed.textarea() : null;
}

// Show/hide the dropdown. Hiding also clears state so the next open starts
// fresh (no stale items, no leftover selection).
function hide() {
  if (dropdown) {
    dropdown.classList.add('hidden');
    dropdown.classList.remove('is-scrollable', 'is-scrolled');
  }
  const ta = activeTextarea();
  if (ta) ta.setAttribute('aria-expanded', 'false');
  // Invalidate any in-flight candidate fetch — otherwise a resolve that lands
  // after hide() (Esc / outside click) would pass the staleness token check
  // in refresh() and re-render the dropdown out of nowhere.
  pending++;
  active = null;
  items = [];
  selected = 0;
}

// Position the dropdown at the textarea caret. Uses the scratch mirror: copy
// the textarea's text-up-to-caret, append a marker span, read its rect,
// convert to viewport coords, place the dropdown just below + slightly right.
function positionAtCaret(textarea) {
  if (!textarea || !mirror) return;
  const caret = textarea.selectionStart;
  const text = textarea.value.slice(0, caret);
  const cs = getComputedStyle(textarea);
  // Sync the mirror's typography + box so the caret lands at the right spot.
  // These are the properties that affect text wrapping / caret position.
  const props = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
    'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderWidth', 'boxSizing', 'whiteSpace', 'wordBreak', 'wordWrap', 'tabSize'];
  mirror.style.width = textarea.clientWidth + 'px';
  for (const p of props) mirror.style[p] = cs[p];
  // Render one div per line so wrapping is reflected (matches the editor's
  // own mirror technique at editor.js:60). The trailing marker span sits at
  // the caret's visual position.
  const lines = text.split('\n');
  mirror.innerHTML = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const div = document.createElement('div');
    if (i === lines.length - 1) {
      // Last (possibly partial) line: append the marker after the existing text.
      div.textContent = line;
      const mark = document.createElement('span');
      mark.className = 'ac-caret-mark';
      mark.textContent = '|';
      div.appendChild(mark);
    } else {
      div.textContent = line;
    }
    mirror.appendChild(div);
  }
  const mark = mirror.querySelector('.ac-caret-mark');
  if (!mark) return;
  const taRect = textarea.getBoundingClientRect();
  const mRect = mark.getBoundingClientRect();
  // The mirror is laid out at 0,0 in the document body (its parent has no
  // positioning), so mRect's top/left are absolute document coords. Convert
  // to viewport-relative by adding the scroll offset, then to the textarea's
  // coordinate frame.
  const left = taRect.left + (mRect.left - mirror.getBoundingClientRect().left) + 2;
  const top = taRect.top + (mRect.top - mirror.getBoundingClientRect().top) + mRect.height + 2;
  // Clamp horizontally; flip ABOVE the caret line when the dropdown would
  // overflow the bottom edge (v0.67.0 — clamping used to cover the caret).
  const ddRect = dropdown.getBoundingClientRect();
  const maxLeft = window.innerWidth - ddRect.width - 8;
  dropdown.style.left = Math.max(8, Math.min(left, maxLeft)) + 'px';
  const caretTop = taRect.top + (mRect.top - mirror.getBoundingClientRect().top);
  if (top + ddRect.height > window.innerHeight - 8) {
    dropdown.style.top = Math.max(8, caretTop - ddRect.height - 8) + 'px';
  } else {
    dropdown.style.top = Math.max(8, top) + 'px';
  }
}

function render() {
  if (!listEl) return;
  if (items.length === 0) { hide(); return; }
  listEl.innerHTML = items.map((it, i) => {
    const cls = i === selected ? 'ac-item active' : 'ac-item';
    const hint = it.hint ? `<span class="ac-hint">${escapeHtml(it.hint)}</span>` : '';
    return `<li id="ac-opt-${i}" class="${cls}" role="option" aria-selected="${i === selected ? 'true' : 'false'}" data-i="${i}">` +
      `<span class="ac-label">${escapeHtml(it.display)}</span>${hint}</li>`;
  }).join('');
  dropdown.setAttribute('aria-activedescendant', `ac-opt-${selected}`);
  updateScrollEdges();
  dropdown.classList.remove('hidden');
  // v0.67.0: combobox semantics on the textarea.
  const ta = activeTextarea();
  if (ta) ta.setAttribute('aria-expanded', 'true');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function setActive(i) {
  selected = Math.max(0, Math.min(items.length - 1, i));
  listEl.querySelectorAll('.ac-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === selected);
    el.setAttribute('aria-selected', idx === selected ? 'true' : 'false');
  });
  dropdown.setAttribute('aria-activedescendant', `ac-opt-${selected}`);
  const activeEl = listEl.querySelector('.ac-item.active');
  if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest' });
}

// Accept the currently-selected item (or items[0] if none selected) into the
// textarea, then hide. Called on Tab/Enter.
function accept() {
  if (!active || items.length === 0) return false;
  const editor = ctx.getEditor();
  if (!editor) return false;
  const pick = items[selected] || items[0];
  if (!pick) return false;
  const text = editor.getValue();
  const { start } = active;
  const caret = editor.getState().end;
  // v0.67.0: bail when the caret moved back before the trigger (arrows don't
  // refresh the dropdown) — accepting used to splice the wrong range.
  if (caret < start) { hide(); return false; }
  const { text: next, caret: newCaret } = acceptSuggestion(text, start, caret, pick.value);
  editor.replaceRange(start, caret, next.slice(start, newCaret));
  editor.setState({ start: newCaret, end: newCaret });
  editor.focus();
  hide();
  return true;
}

// Called by main.js on every editor input. Re-evaluates the trigger and
// refreshes the dropdown async.
async function refresh() {
  const editor = ctx.getEditor();
  if (!editor) { hide(); return; }
  const text = editor.getValue();
  const caret = editor.getState().end;
  const trig = detectTrigger(text.slice(0, caret));
  if (!trig) { hide(); return; }
  // Re-fetch only if the trigger kind/query changed since last render.
  if (active && active.kind === trig.kind && active.query === trig.query && active.start === trig.start) {
    // Same trigger — just reposition (the user may have scrolled).
    positionAtCaret(editor.textarea());
    return;
  }
  active = { ...trig, end: caret };
  selected = 0;
  // Immediate paint: rebuild candidates from the cached sources for this kind
  // and render synchronously, so the dropdown tracks each keystroke with zero
  // perceived latency. The fresh fetch below reconciles right after.
  const cachedSources = sourceCache[trig.kind];
  if (cachedSources) {
    const preItems = buildCandidates(trig.kind, trig.query, cachedSources);
    if (preItems.length > 0) {
      items = preItems;
      render();
      positionAtCaret(editor.textarea());
    }
  }
  const token = ++pending;
  const sources = await ctx.getSources(trig.kind, trig.query);
  if (token !== pending) return; // a newer trigger superseded us
  sourceCache[trig.kind] = sources;
  items = buildCandidates(trig.kind, trig.query, sources);
  if (items.length === 0) { hide(); return; }
  render();
  positionAtCaret(editor.textarea());
}

// Keydown handler bound to the textarea. Returns true if it handled the key
// (so the editor's own keydown can skip), false to fall through.
function handleKeydown(e) {
  if (!active || items.length === 0) return false;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setActive(selected + 1);
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    setActive(selected - 1);
    return true;
  }
  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
    if (accept()) {
      e.preventDefault();
      return true;
    }
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    hide();
    return true;
  }
  return false;
}

// Window-level outside-click hide. Module-level so destroy() can remove it.
function onWindowPointerDown(e) {
  if (!dropdown || dropdown.classList.contains('hidden')) return;
  if (dropdown.contains(e.target)) return;
  const ta = activeTextarea();
  if (ta && ta.contains && ta.contains(e.target)) return;
  hide();
}

export function initAutocomplete(accessors) {
  if (created) return { refresh, hide, handleKeydown, destroy };
  created = true;
  ctx = { ...ctx, ...accessors };
  build();
  // v0.67.0: click outside (window-level) hides the dropdown — it used to
  // stay floating after clicking the toolbar/preview until the next keystroke.
  // Module-level fn so destroy() can remove it (re-init must not stack copies).
  window.addEventListener('pointerdown', onWindowPointerDown);
  // Click an item to accept it. The dropdown is non-focusable; clicks bubble.
  dropdown.addEventListener('mousedown', (e) => {
    // mousedown so we can preventDefault and keep focus on the textarea.
    e.preventDefault();
    const li = e.target.closest('.ac-item');
    if (!li) return;
    selected = parseInt(li.dataset.i, 10) || 0;
    accept();
  });
  return { refresh, hide, handleKeydown, destroy };
}

function destroy() {
  hide();
  sourceCache = {};
  window.removeEventListener('pointerdown', onWindowPointerDown);
  if (dropdown) dropdown.remove();
  if (mirror) mirror.remove();
  dropdown = null;
  mirror = null;
  listEl = null;
  created = false;
}
