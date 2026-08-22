// Command palette + quick switcher — both are fuzzy-searchable launchers that
// share the same modal card UI. initCommandPalette takes a list of actions;
// initQuickSwitcher takes a list of file-like items + an onSelect callback.
//
// Both open with a shortcut (Ctrl+Shift+P / Ctrl+P), filter as the user types,
// and confirm on Enter. The shared picker core lives at the bottom of the file.

import { fuzzyMatch } from '../lib/fuzzy.js';

// Presentation polish (iteration 9). Injected once per app run; selectors are
// two-class deep so they win cascade ties against base.css/motion.css
// regardless of stylesheet import order. All values reference global tokens.
const PALETTE_POLISH_CSS = `
  /* Open: scale+fade down from top-center (decelerate), not the shared
     modal spring which reads bouncy for a launcher. */
  .palette-overlay .palette-card {
    animation: mdpeek-palette-in var(--dur-3) var(--ease-out);
    transform-origin: 50% 0;
  }
  @keyframes mdpeek-palette-in {
    from { opacity: 0; transform: translateY(calc(var(--sp-3) * -1)) scale(0.97); }
    to   { opacity: 1; transform: none; }
  }
  /* Selection crossfade over --dur-2 so arrowing through items reads as one
     highlight gliding rather than hard on/off swaps; smooth scroll follows. */
  .palette-overlay .palette-item {
    transition-duration: var(--dur-2);
  }
  .palette-overlay .palette-list {
    scroll-behavior: smooth;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  /* Fuzzy-match chips: tinted accent pill behind matched chars for contrast
     against both the resting and active row backgrounds. */
  .palette-list .palette-item mark {
    background: var(--accent-soft);
    color: var(--accent);
    border-radius: var(--radius-sm);
    padding: 0 1px;
    margin: 0 -1px;
    box-decoration-break: clone;
  }
  /* Footer hint bar: right-aligned keycap chips instead of bare text. */
  .palette-overlay .palette-footer {
    justify-content: flex-end;
    gap: var(--sp-4);
    padding: var(--sp-2) var(--sp-5) var(--sp-3);
  }
  .palette-overlay .palette-footer kbd {
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1;
    padding: var(--sp-0) var(--sp-1);
    margin-right: var(--sp-1);
    color: var(--fg-secondary);
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-bottom-width: 2px;
    border-radius: var(--radius-sm);
  }
  /* Empty state: title + suggestion stacked and centered. */
  .palette-overlay .palette-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-1);
    padding: var(--sp-6) var(--sp-5);
    animation: mdpeek-palette-in var(--dur-2) var(--ease-out);
  }
  .palette-empty-title { color: var(--fg-secondary); font-size: 13px; }
  .palette-empty-hint  { color: var(--fg-muted); font-size: 12px; }

`;
function injectPalettePolishCss() {
  const id = 'mdpeek-palette-polish';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = PALETTE_POLISH_CSS;
  document.head.appendChild(style);
}

const PICKER_HTML = (placeholder) => `
  <div class="palette-card" role="dialog" aria-label="Picker">
    <input class="palette-input" type="text" placeholder="${placeholder}" autocomplete="off" spellcheck="false" />
    <ul class="palette-list" role="listbox"></ul>
    <div class="palette-footer">
      <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
      <span><kbd>Enter</kbd> select</span>
      <span><kbd>Esc</kbd> close</span>
    </div>
  </div>
`;

// Build a modal picker. `getItems()` returns the current list of items, each
// shaped { label, hint?, keywords?, indices? }. `onSelect(item)` runs when the
// user confirms. The returned { open, close, setItems } controls visibility
// and (for pickers that populate lazily, e.g. backlinks) lets the caller swap
// in a fresh item list before opening.
// v0.50.0: exported so main.js can build ad-hoc pickers (e.g. the document
// overview / heading cloud) without a dedicated wrapper per use case.
export function makePicker({ placeholder, getItems, onSelect, id, emptyMessage }) {
  injectPalettePolishCss();
  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'modal-overlay palette-overlay hidden';
  overlay.innerHTML = PICKER_HTML(placeholder);
  document.body.append(overlay);

  const input = overlay.querySelector('.palette-input');
  const list = overlay.querySelector('.palette-list');

  let filtered = [];
  let selected = 0;
  // Wrapped so setItems can swap the source without rebuilding the picker.
  let _getItems = getItems;

  function render(query) {
    const all = _getItems();
    const scored = [];
    for (const item of all) {
      const hay = (item.label + ' ' + (item.keywords || '')).toLowerCase();
      const labelMatch = fuzzyMatch(query, item.label);
      if (!labelMatch && !hay.includes(query.toLowerCase())) continue;
      const m = labelMatch || { score: 0, indices: [] };
      scored.push({ item, score: m.score, indices: m.indices });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.item.label.length - b.item.label.length;
    });
    filtered = scored.slice(0, 12);
    selected = 0;
    const empty = filtered.length === 0;
    // Pickers can name their own no-items message (e.g. the quick switcher
    // says "No recent files yet"); a typed query still says "No matches" —
    // with a suggestion line so the dead end feels actionable.
    list.innerHTML = empty
      ? `<li class="palette-empty" role="presentation">
           <span class="palette-empty-title">${query ? 'No matches for \u201C' + escapeHtml(query) + '\u201D' : escapeHtml(emptyMessage || 'No matches')}</span>
           ${query ? '<span class="palette-empty-hint">Try fewer characters or check spelling</span>' : ''}
         </li>`
      : filtered.map((s, i) => {
          const cls = i === selected ? 'palette-item active' : 'palette-item';
          const hint = s.item.hint ? `<span class="palette-hint">${escapeHtml(s.item.hint)}</span>` : '';
          return `<li class="${cls}" role="option" aria-selected="${i === selected ? 'true' : 'false'}" data-i="${i}">${highlight(s.item.label, i === 0 ? s.indices : null)}${hint}</li>`;
        }).join('');
  }

  function highlight(label, indices) {
    if (!indices || indices.length === 0) return escapeHtml(label);
    let out = '';
    let mi = 0;
    for (let i = 0; i < label.length; i++) {
      if (mi < indices.length && indices[mi] === i) {
        out += `<mark>${escapeHtml(label[i])}</mark>`;
        mi++;
      } else {
        out += escapeHtml(label[i]);
      }
    }
    return out;
  }
  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function setActive(i) {
    selected = Math.max(0, Math.min(filtered.length - 1, i));
    list.querySelectorAll('.palette-item').forEach((el, idx) => {
      el.classList.toggle('active', idx === selected);
      el.setAttribute('aria-selected', idx === selected ? 'true' : 'false');
    });
    const active = list.querySelector('.palette-item.active');
    // Smooth scroll keeps the highlight's travel continuous with the
    // crossfade (CSS scroll-behavior covers programmatic scrolls too).
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function choose() {
    const pick = filtered[selected]?.item;
    if (!pick) return;
    close();
    try { onSelect(pick); } catch (err) { console.error('picker onSelect failed:', err); }
  }

  // Leaving plays the shared overlay-out/modal-out animations from
  // motion.css (.is-leaving) before the overlay is actually hidden — the
  // timer covers the longer of the two (--dur-2 = 180ms) plus a frame.
  let hideTimer = null;
  function open() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    overlay.classList.remove('hidden');
    overlay.classList.remove('is-leaving');
    input.value = '';
    render('');
    requestAnimationFrame(() => input.focus());
  }
  function close() {
    if (overlay.classList.contains('hidden') || hideTimer) return;
    overlay.classList.add('is-leaving');
    hideTimer = setTimeout(() => {
      hideTimer = null;
      overlay.classList.add('hidden');
      overlay.classList.remove('is-leaving');
    }, 200);
  }
  // Swap the item source (used by pickers that compute their list lazily —
  // e.g. the backlinks picker, which scans the folder on demand and then
  // opens). Subsequent open() calls re-render against the new list.
  function setItems(arr) {
    _getItems = () => arr;
  }

  input.addEventListener('input', () => render(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(selected + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(selected - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(); }
  });
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.palette-item');
    if (!item) return;
    selected = parseInt(item.dataset.i, 10);
    choose();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return { open, close, setItems };
}

// Command palette — actions.
export function initCommandPalette(getCommands) {
  return makePicker({
    id: 'palette',
    placeholder: 'Type a command…',
    getItems: getCommands,
    onSelect: (cmd) => cmd.run(),
  });
}

// Quick switcher — files. Items have { label, hint, path }; onSelect gets the
// item so the caller can open the path.
export function initQuickSwitcher(getItems, onSelect) {
  return makePicker({
    id: 'quick-switcher',
    placeholder: 'Type a file name…',
    emptyMessage: 'No recent files yet — open something first',
    getItems,
    onSelect,
  });
}

// Snippet picker — markdown templates & code fences.
export function initSnippetPicker(getSnippets, onSelect) {
  return makePicker({
    id: 'snippet-picker',
    placeholder: 'Select a template or snippet to insert…',
    getItems: getSnippets,
    onSelect,
  });
}
