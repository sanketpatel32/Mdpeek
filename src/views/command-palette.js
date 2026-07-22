// Command palette + quick switcher — both are fuzzy-searchable launchers that
// share the same modal card UI. initCommandPalette takes a list of actions;
// initQuickSwitcher takes a list of file-like items + an onSelect callback.
//
// Both open with a shortcut (Ctrl+Shift+P / Ctrl+P), filter as the user types,
// and confirm on Enter. The shared picker core lives at the bottom of the file.

import { fuzzyMatch } from '../lib/fuzzy.js';

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
// user confirms. The returned { open, close } controls visibility.
function makePicker({ placeholder, getItems, onSelect, id }) {
  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'modal-overlay palette-overlay hidden';
  overlay.innerHTML = PICKER_HTML(placeholder);
  document.body.append(overlay);

  const input = overlay.querySelector('.palette-input');
  const list = overlay.querySelector('.palette-list');

  let filtered = [];
  let selected = 0;

  function render(query) {
    const all = getItems();
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
    list.innerHTML = empty
      ? '<li class="palette-empty">No matches</li>'
      : filtered.map((s, i) => {
          const cls = i === selected ? 'palette-item active' : 'palette-item';
          const hint = s.item.hint ? `<span class="palette-hint">${escapeHtml(s.item.hint)}</span>` : '';
          return `<li class="${cls}" role="option" data-i="${i}">${highlight(s.item.label, i === 0 ? s.indices : null)}${hint}</li>`;
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
    });
    const active = list.querySelector('.palette-item.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function choose() {
    const pick = filtered[selected]?.item;
    if (!pick) return;
    close();
    try { onSelect(pick); } catch (err) { console.error('picker onSelect failed:', err); }
  }

  function open() {
    overlay.classList.remove('hidden');
    input.value = '';
    render('');
    requestAnimationFrame(() => input.focus());
  }
  function close() {
    overlay.classList.add('hidden');
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

  return { open, close };
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
