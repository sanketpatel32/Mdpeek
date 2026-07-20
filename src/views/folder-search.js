// Folder-wide search panel. Idempotent singleton like the find bar: a single
// DOM element appended to <body>, built once, shown/hidden by toggling a
// `.hidden` class. The user opens it by right-clicking a folder in the file
// explorer (or by clicking the toolbar search button, which searches the
// current explorer root).
//
// Recursion + grep happens on the Rust side (`search_in_folder` command) so
// we avoid O(files) IPC round-trips and skip binary files cheaply. The panel
// is a thin result lister with debounced input + a generation counter for
// race protection.

import { invoke } from '@tauri-apps/api/core';

const CASE_KEY = 'mdpeek-folder-search-case';

let created = false;
let overlay;          // #folder-search-overlay
let input;            // .folder-search-input
let caseBtn;          // .folder-search-toggle (Aa)
let countEl;          // .folder-search-count
let resultsEl;        // .folder-search-results (scrollable)
let headerLabelEl;    // shows the folder being searched
let closeBtn;         // .folder-search-close

// Module state.
let folderPath = null;       // the folder currently being searched
let query = '';
let caseSensitive = false;
let debounceTimer = null;
let searchGen = 0;           // bumped on every input change; race guard
let inFlight = false;        // true while a search is awaiting Rust
let onOpenCallback = null;   // (path, line, query) => void — caller wires openPath

// Build the DOM once. Idempotent — safe to call repeatedly.
function build() {
  overlay = document.createElement('div');
  overlay.id = 'folder-search-overlay';
  overlay.className = 'folder-search-overlay hidden';
  overlay.innerHTML = `
    <div class="folder-search-card">
      <div class="folder-search-header">
        <span class="folder-search-folder" title="">Folder</span>
        <button class="folder-search-toggle tool-btn icon-only" id="folder-search-case" title="Match case" aria-label="Match case" aria-pressed="false">Aa</button>
        <input type="search" class="folder-search-input" placeholder="Search in folder…" aria-label="Search query" spellcheck="false" autocomplete="off" />
        <span class="folder-search-count">0</span>
        <button class="folder-search-close tool-btn icon-only" title="Close (Esc)" aria-label="Close search panel">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="folder-search-results" role="list"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  input = overlay.querySelector('.folder-search-input');
  caseBtn = overlay.querySelector('.folder-search-toggle');
  countEl = overlay.querySelector('.folder-search-count');
  resultsEl = overlay.querySelector('.folder-search-results');
  headerLabelEl = overlay.querySelector('.folder-search-folder');
  closeBtn = overlay.querySelector('.folder-search-close');

  // Restore the case-sensitive preference (mirrors the find bar).
  caseSensitive = localStorage.getItem(CASE_KEY) === '1';
  if (caseSensitive) {
    caseBtn.classList.add('active');
    caseBtn.setAttribute('aria-pressed', 'true');
  }

  // Input — debounced search trigger.
  input.addEventListener('input', () => {
    query = input.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 200);
  });

  // Enter — run immediately (skip debounce).
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounceTimer);
      runSearch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  // Case toggle.
  caseBtn.addEventListener('click', () => {
    caseSensitive = !caseSensitive;
    caseBtn.classList.toggle('active', caseSensitive);
    caseBtn.setAttribute('aria-pressed', caseSensitive ? 'true' : 'false');
    localStorage.setItem(CASE_KEY, caseSensitive ? '1' : '0');
    runSearch();
  });

  // Close button.
  closeBtn.addEventListener('click', close);

  // Click-outside dismiss (only when clicking the overlay itself, not a child).
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  // Result click — delegated since the list re-renders constantly.
  resultsEl.addEventListener('click', (e) => {
    const match = e.target.closest('.search-match');
    if (!match) return;
    const path = match.dataset.path;
    const line = parseInt(match.dataset.line, 10);
    if (path && onOpenCallback) onOpenCallback(path, line, query);
  });
}

async function runSearch() {
  if (!folderPath) return;
  searchGen += 1;
  const myGen = searchGen;
  // Empty query → clear results, show empty state.
  if (!query) {
    renderEmpty('Type to search this folder');
    countEl.textContent = '0';
    return;
  }
  // Show a loading state — but only if results are currently empty (avoids
  // flicker on incremental keystrokes where results already exist).
  if (resultsEl.querySelector('.search-empty') || resultsEl.children.length === 0) {
    renderEmpty('Searching…');
  }
  inFlight = true;
  let summary;
  try {
    summary = await invoke('search_in_folder', {
      root: folderPath,
      query,
      caseSensitive,
      maxResults: 1000,
    });
  } catch (err) {
    if (myGen === searchGen) {
      renderEmpty('Search failed: ' + (err?.message || err || 'unknown error'));
      countEl.textContent = '!';
    }
    inFlight = false;
    return;
  }
  inFlight = false;
  // Race guard: drop the result if a newer search has started.
  if (myGen !== searchGen) return;
  renderResults(summary);
}

function renderResults(summary) {
  const { results, truncated, total_matches, files_scanned, files_with_matches } = summary;
  // Count badge: show match count (or "truncated" hint via the body text).
  countEl.textContent = String(total_matches);
  if (total_matches === 0) {
    const note = files_scanned === 0
      ? 'No searchable files in this folder'
      : `No matches in ${files_scanned} file${files_scanned === 1 ? '' : 's'}`;
    renderEmpty(note);
    return;
  }
  const html = results.map((file) => {
    const matchRows = file.matches.map((m) => {
      // Highlight the match substring within m.text using m.match_start/match_end.
      const before = escapeHtml(m.text.slice(0, m.match_start));
      const hit = escapeHtml(m.text.slice(m.match_start, m.match_end));
      const after = escapeHtml(m.text.slice(m.match_end));
      return `<div class="search-match" role="listitem" data-path="${escapeAttr(file.path)}" data-line="${m.line}" title="${escapeAttr(file.path)}:${m.line}">
        <span class="search-line">${m.line}</span>
        <span class="search-text">${before}<mark>${hit}</mark>${after}</span>
      </div>`;
    }).join('');
    const relPath = relativizeForDisplay(file.path);
    return `<div class="search-file-group">
      <div class="search-file-header" title="${escapeAttr(file.path)}">
        <span class="search-file-name">${escapeHtml(relPath)}</span>
        <span class="search-file-count">${file.matches.length}</span>
      </div>
      ${matchRows}
    </div>`;
  }).join('');
  const truncationNote = truncated
    ? `<div class="search-truncated">Results truncated — narrow your search to see more</div>`
    : '';
  resultsEl.innerHTML = html + truncationNote;
}

function renderEmpty(message) {
  resultsEl.innerHTML = `<div class="search-empty">${escapeHtml(message)}</div>`;
}

// Shorten an absolute path for display: show last 2 segments, ellipsized.
function relativizeForDisplay(path) {
  if (!folderPath) return path;
  // Try to strip the folder root for a cleaner relative path.
  if (path.startsWith(folderPath)) {
    const rel = path.slice(folderPath.length).replace(/^[\\/]+/, '');
    if (rel) return rel;
  }
  // Fall back to last 2 segments.
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return parts.join('/');
  return '…/' + parts.slice(-2).join('/');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// ---------- public API ----------
export function initFolderSearch(onOpen) {
  if (created) return { open, close, destroy };
  build();
  onOpenCallback = onOpen || null;
  created = true;
  return { open, close, destroy };
}

function open(targetFolderPath) {
  if (!created) return;
  folderPath = targetFolderPath;
  overlay.classList.remove('hidden');
  // Update the folder label.
  const parts = (targetFolderPath || '').split(/[\\/]/).filter(Boolean);
  headerLabelEl.textContent = parts.length ? parts[parts.length - 1] : 'Folder';
  headerLabelEl.title = targetFolderPath || '';
  // Reset query + results when switching folders.
  input.value = '';
  query = '';
  renderEmpty('Type to search this folder');
  countEl.textContent = '0';
  // Focus + select on open.
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

function close() {
  if (!created) return;
  overlay.classList.add('hidden');
  // Cancel any pending search so it doesn't write results after close.
  searchGen += 1;
  clearTimeout(debounceTimer);
}

function destroy() {
  // Fully remove the singleton (rarely needed — the panel lives for the app's
  // lifetime). Provided for completeness.
  if (!created) return;
  clearTimeout(debounceTimer);
  overlay.remove();
  created = false;
  overlay = input = caseBtn = countEl = resultsEl = headerLabelEl = closeBtn = null;
}
