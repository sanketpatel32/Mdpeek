// Command palette — a fuzzy-searchable action launcher. Opens with Ctrl+Shift+P,
// shows a list of commands, filters as the user types, and runs the selected
// command on Enter. Pure DOM, no framework.
//
// The caller passes an array of commands: { id, label, hint?, keywords?, run() }.
// `run` is called with no args; closing happens automatically after the call.

import { fuzzyMatch } from '../lib/fuzzy.js';

const PALETTE_HTML = `
  <div class="palette-card" role="dialog" aria-label="Command palette">
    <input class="palette-input" type="text" placeholder="Type a command…" autocomplete="off" spellcheck="false" />
    <ul class="palette-list" role="listbox"></ul>
    <div class="palette-footer">
      <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
      <span><kbd>Enter</kbd> run</span>
      <span><kbd>Esc</kbd> close</span>
    </div>
  </div>
`;

export function initCommandPalette(getCommands) {
  const overlay = document.createElement('div');
  overlay.id = 'palette';
  overlay.className = 'modal-overlay palette-overlay hidden';
  overlay.innerHTML = PALETTE_HTML;
  document.body.append(overlay);

  const input = overlay.querySelector('.palette-input');
  const list = overlay.querySelector('.palette-list');

  let filtered = [];   // current visible commands
  let selected = 0;    // index into `filtered`

  function render(query) {
    const all = getCommands();
    const scored = [];
    for (const cmd of all) {
      // Search label + keywords (joined). The displayed highlight uses the
      // label match only — keyword matches are silent ranking boosts.
      const hay = (cmd.label + ' ' + (cmd.keywords || '')).toLowerCase();
      const labelMatch = fuzzyMatch(query, cmd.label);
      if (!labelMatch && !hay.includes(query.toLowerCase())) continue;
      const m = labelMatch || { score: 0, indices: [] };
      scored.push({ cmd, score: m.score, indices: m.indices });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.cmd.label.length - b.cmd.label.length;
    });
    filtered = scored.slice(0, 12).map((s) => s.cmd);
    selected = 0;
    list.innerHTML = filtered.map((cmd, i) => {
      const cls = i === selected ? 'palette-item active' : 'palette-item';
      const hint = cmd.hint ? `<span class="palette-hint">${cmd.hint}</span>` : '';
      return `<li class="${cls}" role="option" data-i="${i}">${highlight(cmd.label, i === 0 ? scored[0]?.indices : null)}${hint}</li>`;
    }).join('') || '<li class="palette-empty">No commands found</li>';
  }

  // Wrap matched chars in <mark>. Indices are correct only for the first
  // (active) item — others get plain text, which is fine (low priority).
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
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(selected + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(selected - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[selected];
      if (cmd) {
        close();
        try { cmd.run(); } catch (err) { console.error('palette command failed:', err); }
      }
    }
  });

  // Click an item: find its index and run.
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.palette-item');
    if (!item) return;
    const i = parseInt(item.dataset.i, 10);
    const cmd = filtered[i];
    if (cmd) {
      close();
      try { cmd.run(); } catch (err) { console.error('palette command failed:', err); }
    }
  });

  // Click outside the card closes.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return { open, close };
}
