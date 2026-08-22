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
import { applyReplacements } from '../lib/replace.js';

const CASE_KEY = 'mdpeek-folder-search-case';

// ---------- UI polish (injected once) ----------
// Presentation-only: count badge pop/zero states, notify jitter guard, a
// clearly distinct keyboard-selection row, replace-row reveal, one-shot
// results entrance, and a highlight sweep over file groups that were just
// written by Replace. Scoped under #folder-search-overlay.
const POLISH_CSS = `
@keyframes fs-count-pop {
  0%   { transform: scale(1); }
  35%  { transform: scale(1.18); }
  100% { transform: scale(1); }
}
#folder-search-overlay .folder-search-count {
  display: inline-block;
  transform-origin: center;
  transition: color var(--dur-2, 180ms) var(--ease-out, ease);
}
#folder-search-overlay .folder-search-count.pop {
  animation: fs-count-pop var(--dur-3, 240ms) var(--ease-spring, ease);
}
/* Zero matches (with a query) = warning; search error = danger. */
#folder-search-overlay .folder-search-count.zero {
  color: var(--warning, #9a6700);
  font-weight: 600;
}
#folder-search-overlay .folder-search-count.error {
  color: var(--danger, #cf222e);
  font-weight: 600;
}
/* Notify messages reuse the badge as the message surface — cap its width so
   long "Replaced N across M files" strings can't squeeze the input and jitter
   the header layout. Full text stays available via title. */
#folder-search-overlay .folder-search-count.search-notify {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Keyboard-selected match must be obvious even when not hovered. */
#folder-search-overlay .search-match.selected {
  background: var(--accent-soft, rgba(9, 105, 218, 0.12));
  box-shadow: inset 2px 0 0 var(--accent, #0969da);
}
/* Replace-row reveal mirrors the find bar's expand chevron. */
@keyframes fs-row-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
#folder-search-overlay .folder-search-replace-row:not(.hidden) {
  animation: fs-row-in var(--dur-2, 180ms) var(--ease-out, ease);
}
/* One-shot results entrance after a loading/empty state — never re-triggered
   on every keystroke re-render (only when .results-appear is set). */
@keyframes fs-results-in {
  from { opacity: 0; transform: translateY(3px); }
  to   { opacity: 1; transform: translateY(0); }
}
#folder-search-overlay .results-appear > .search-file-group {
  animation: fs-results-in var(--dur-2, 180ms) var(--ease-out, ease) backwards;
}
/* Empty / loading / error states. */
#folder-search-overlay .search-empty[data-state="loading"]::after {
  content: '…';
  display: inline-block;
  overflow: hidden;
  vertical-align: bottom;
  animation: fs-dots 900ms steps(4, end) infinite;
}
@keyframes fs-dots {
  0%  { width: 0; }
  100% { width: 1.2em; }
}
#folder-search-overlay .search-empty[data-state="error"] {
  color: var(--danger, #cf222e);
}
/* Highlight sweep across groups touched by a just-applied replace. */
@keyframes fs-apply-sweep {
  0%   { background-color: transparent; }
  25%  { background-color: var(--accent-soft, rgba(9, 105, 218, 0.14)); }
  100% { background-color: transparent; }
}
#folder-search-overlay .search-file-group.just-applied {
  animation: fs-apply-sweep 900ms var(--ease-out, ease);
}
`;

function injectPolishStyle() {
  if (document.getElementById('folder-search-polish-style')) return;
  const style = document.createElement('style');
  style.id = 'folder-search-polish-style';
  style.textContent = POLISH_CSS;
  document.head.appendChild(style);
}

// Re-trigger a one-shot CSS animation class (pop / sweep).
function pulse(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// Minimal status notifier — the panel is a singleton with no access to the
// app's toast helper. Reuses the count badge as the message surface. The
// polish CSS caps the badge width (jitter guard), so the full message is
// mirrored onto title where it stays readable even when ellipsized.
function notify(msg) {
  countEl.textContent = msg;
  countEl.title = msg;
  countEl.classList.add('search-notify');
  clearTimeout(notify._t);
  notify._t = setTimeout(() => {
    countEl.classList.remove('search-notify');
    countEl.title = '';
  }, 2500);
}

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
// --- replace state (project-wide find & replace) ---
let replaceInput;        // .folder-search-replace-input
let replaceRow;          // .folder-search-replace-row (hidden until expanded)
let expandBtn;           // .folder-search-expand (chevron)
let replaceAllBtn;       // .folder-search-replace-all
let undoBtn;             // .folder-search-undo
let replaceExpanded = false;
let lastReplace = null;  // [{ path, oldContent }] for single-level undo, or null
let isDirtyCb = null;        // (path) => boolean — is this path an open tab with unsaved edits?
let updateOpenDocCb = null;  // (path, newContent) => void — sync a clean open tab after write
let lastResults = [];       // last search result set (for currentMatchPaths)
let focusedGroupPath = null; // hovered/keyboard-selected file group (replace-focused-file)
let selectedIdx = -1;        // keyboard-selected .search-match index
let justAppliedPaths = null; // Set of paths a successful replace wrote — drives the one-shot highlight sweep
let lastCountText = null;    // previous badge text; lets us pop only on real changes

// Build the DOM once. Idempotent — safe to call repeatedly.
function build() {
  injectPolishStyle();
  overlay = document.createElement('div');
  overlay.id = 'folder-search-overlay';
  overlay.className = 'folder-search-overlay hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Search in folder');
  overlay.innerHTML = `
    <div class="folder-search-card">
      <div class="folder-search-header">
        <span class="folder-search-folder" title="">Folder</span>
        <button class="folder-search-toggle tool-btn icon-only" id="folder-search-case" title="Match case" aria-label="Match case" aria-pressed="false">Aa</button>
        <input type="search" class="folder-search-input" placeholder="Search in folder…" aria-label="Search query" spellcheck="false" autocomplete="off" />
        <span class="folder-search-count" aria-live="polite">0</span>
        <button class="folder-search-expand tool-btn icon-only" title="Toggle replace" aria-label="Toggle replace" type="button">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button class="folder-search-close tool-btn icon-only" title="Close (Esc)" aria-label="Close search panel">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="folder-search-replace-row hidden">
        <input type="text" class="folder-search-replace-input" placeholder="Replace…" aria-label="Replacement text" spellcheck="false" autocomplete="off" />
        <button class="tool-btn folder-search-replace-all" title="Replace all (Alt+A)" type="button">All</button>
        <button class="tool-btn folder-search-undo" title="Undo last replace" type="button" disabled>Undo</button>
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
  expandBtn = overlay.querySelector('.folder-search-expand');
  replaceRow = overlay.querySelector('.folder-search-replace-row');
  replaceInput = overlay.querySelector('.folder-search-replace-input');
  replaceAllBtn = overlay.querySelector('.folder-search-replace-all');
  undoBtn = overlay.querySelector('.folder-search-undo');

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

  // Enter — run immediately (skip debounce); with a keyboard selection
  // active, Enter opens it (v0.67.0). ArrowDown/Up move the selection.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0) { openSelected(); return; }
      clearTimeout(debounceTimer);
      runSearch();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(e.key === 'ArrowDown' ? 1 : -1);
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

  // Chevron — toggle the replace row (mirrors the find-bar's expand chevron).
  expandBtn.addEventListener('click', () => setReplaceExpanded(!replaceExpanded));

  // Replace All + Undo buttons.
  replaceAllBtn.addEventListener('click', replaceAll);
  undoBtn.addEventListener('click', undoReplace);

  // Replace input — Alt+A = replace all, Alt+Enter = replace focused file,
  // Esc = close panel. Matches the find-bar's replace bindings.
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'a' && e.altKey) {
      e.preventDefault();
      replaceAll();
    } else if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      replaceFocusedFile();
    }
  });

  // Re-render results on replace-input change so the live preview updates.
  // v0.67.0: debounced like the query input — runSearch is a full-folder grep
  // and used to fire synchronously per keystroke.
  replaceInput.addEventListener('input', () => {
    if (replaceExpanded && query) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSearch, 200);
    }
  });

  // Close button.
  closeBtn.addEventListener('click', close);

  // Click-outside dismiss (v0.67.0). The overlay card fills the panel, so the
  // old e.target === overlay check could never fire — listen on the document.
  // v0.68.0: isOpen was referenced but never defined here — every document
  // mousedown threw a ReferenceError (caught by the window error handler).
  const isOpen = () => !!overlay && !overlay.classList.contains('hidden');
  document.addEventListener('mousedown', (e) => {
    if (isOpen() && !overlay.contains(e.target)) close();
  });

  // Result click — delegated since the list re-renders constantly.
  resultsEl.addEventListener('click', (e) => {
    // Per-file Replace button on a file-group header.
    const replaceBtn = e.target.closest('.search-file-replace');
    if (replaceBtn) {
      e.preventDefault();
      const group = e.target.closest('.search-file-group');
      const path = group && group.dataset.path;
      if (path) replaceOneFile(path);
      return;
    }
    // Match row — open the file at the matched line.
    const match = e.target.closest('.search-match');
    if (!match) return;
    const path = match.dataset.path;
    const line = parseInt(match.dataset.line, 10);
    if (path && onOpenCallback) onOpenCallback(path, line, query);
  });
  // Track the hovered file group so "replace focused file" targets what the
  // user is actually looking at (v0.67.0).
  resultsEl.addEventListener('mouseover', (e) => {
    const group = e.target.closest('.search-file-group');
    if (group) focusedGroupPath = group.dataset.path;
  });
  resultsEl.setAttribute('role', 'listbox');
}

// v0.67.0: keyboard selection helpers for the results list.
function visibleMatchRows() {
  return resultsEl ? Array.from(resultsEl.querySelectorAll('.search-match')) : [];
}

function moveSelection(delta) {
  const rows = visibleMatchRows();
  if (rows.length === 0) return;
  if (selectedIdx < 0 && delta < 0) selectedIdx = 0;
  selectedIdx = Math.max(0, Math.min(rows.length - 1, selectedIdx + delta));
  rows.forEach((r, i) => r.classList.toggle('selected', i === selectedIdx));
  const sel = rows[selectedIdx];
  if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
  const group = sel && sel.closest('.search-file-group');
  if (group) focusedGroupPath = group.dataset.path;
}

function openSelected() {
  const rows = visibleMatchRows();
  const row = rows[selectedIdx];
  if (!row) return;
  const path = row.dataset.path;
  const line = parseInt(row.dataset.line, 10);
  if (path && onOpenCallback) onOpenCallback(path, line, query);
}

function setReplaceExpanded(on) {
  replaceExpanded = !!on;
  replaceRow.classList.toggle('hidden', !replaceExpanded);
  expandBtn.classList.toggle('active', replaceExpanded);
  expandBtn.setAttribute('aria-pressed', replaceExpanded ? 'true' : 'false');
}

async function runSearch() {
  if (!folderPath) return;
  focusedGroupPath = null;
  selectedIdx = -1;
  searchGen += 1;
  const myGen = searchGen;
  // Empty query → clear results, show empty state.
  if (!query) {
    renderEmpty('Type to search this folder', 'idle');
    setCount('0', []);
    return;
  }
  // Show a loading state — but only if results are currently empty (avoids
  // flicker on incremental keystrokes where results already exist).
  if (resultsEl.querySelector('.search-empty') || resultsEl.children.length === 0) {
    renderEmpty('Searching', 'loading');
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
      renderEmpty('Search failed — ' + (err?.message || err || 'unknown error'), 'error');
      setCount('!', ['error']);
    }
    inFlight = false;
    return;
  }
  inFlight = false;
  // Race guard: drop the result if a newer search has started.
  if (myGen !== searchGen) return;
  renderResults(summary);
}

// Badge writer: sets text, pops on change, and applies/removes the given
// state classes ('zero' | 'error') in one place so states never fight.
function setCount(text, stateClasses) {
  if (countEl.textContent !== text && !countEl.classList.contains('search-notify')) {
    countEl.textContent = text;
    pulse(countEl, 'pop');
  } else if (countEl.textContent !== text) {
    countEl.textContent = text; // a notify message is showing; don't animate over it
  }
  lastCountText = text;
  countEl.classList.toggle('zero', stateClasses.includes('zero'));
  countEl.classList.toggle('error', stateClasses.includes('error'));
}

function renderResults(summary) {
  lastResults = summary.results || [];
  const { results, truncated, total_matches, files_scanned, files_with_matches } = summary;
  // Count badge: show match count (or "truncated" hint via the body text).
  // Zero with a query reads as the warning state.
  setCount(String(total_matches), total_matches === 0 ? ['zero'] : []);
  if (total_matches === 0) {
    const note = files_scanned === 0
      ? 'No searchable files in this folder'
      : `No matches for “${query}” in ${files_scanned} file${files_scanned === 1 ? '' : 's'}`;
    renderEmpty(note);
    return;
  }
  // One-shot entrance when results replace a loading/empty state — skipped on
  // incremental keystroke re-renders so the list never shimmers while typing.
  const enter = lastRenderWasEmpty ? ' results-appear' : '';
  lastRenderWasEmpty = false;
  const html = results.map((file) => {
    const matchRows = file.matches.map((m) => {
      // Highlight the match substring within m.text using m.match_start/match_end.
      const before = escapeHtml(m.text.slice(0, m.match_start));
      const hit = escapeHtml(m.text.slice(m.match_start, m.match_end));
      const after = escapeHtml(m.text.slice(m.match_end));
      // Preview: when a replacement is typed and the row is expanded, show
      // the post-replace line (old match struck through -> new text). Falls
      // back to the plain match highlight when no replacement is typed.
      const replacement = replaceExpanded ? replaceInput.value : '';
      const showPreview = replaceExpanded && replacement !== '' && query;
      const hitHtml = showPreview
        ? `<del>${hit}</del><span class="search-arrow"> → </span><ins>${escapeHtml(replacement)}</ins>`
        : `<mark>${hit}</mark>`;
      return `<div class="search-match" role="listitem" data-path="${escapeAttr(file.path)}" data-line="${m.line}" title="${escapeAttr(file.path)}:${m.line}">
        <span class="search-line">${m.line}</span>
        <span class="search-text">${before}${hitHtml}${after}</span>
      </div>`;
    }).join('');
    const relPath = relativizeForDisplay(file.path);
    return `<div class="search-file-group" data-path="${escapeAttr(file.path)}">
      <div class="search-file-header" title="${escapeAttr(file.path)}">
        <span class="search-file-name">${escapeHtml(relPath)}</span>
        <span class="search-file-count">${file.matches.length}</span>
        ${replaceExpanded ? `<button class="tool-btn search-file-replace" title="Replace in this file" type="button">Replace</button>` : ''}
      </div>
      ${matchRows}
    </div>`;
  }).join('');
  const truncationNote = truncated
    ? `<div class="search-truncated">Results truncated — narrow your search to see more</div>`
    : '';
  resultsEl.innerHTML = html + truncationNote;
  // Highlight sweep over groups this panel just wrote (Replace All / per-file).
  if (justAppliedPaths && justAppliedPaths.size) {
    let first = null;
    for (const group of resultsEl.querySelectorAll('.search-file-group')) {
      if (!justAppliedPaths.has(group.dataset.path)) continue;
      pulse(group, 'just-applied');
      if (!first) first = group;
    }
    if (first) first.scrollIntoView({ block: 'nearest' });
    justAppliedPaths = null;
  }
  if (enter) {
    resultsEl.classList.add('results-appear');
    setTimeout(() => resultsEl.classList.remove('results-appear'), 260);
  }
}

let lastRenderWasEmpty = true; // was the last list render an empty/loading/error state?

function renderEmpty(message, state = 'idle') {
  lastRenderWasEmpty = true;
  resultsEl.innerHTML = `<div class="search-empty"${state !== 'idle' ? ` data-state="${state}"` : ''}>${escapeHtml(message)}</div>`;
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

// Best-effort single-line preview: replace the first occurrence of `query`
// in `line` with `replacement`, honoring case-sensitivity. Used to render
// the post-replace line in the results list. Only the FIRST match is shown
// (search_in_folder returns one match per line), so multi-match lines are
// undercounted in the preview — the true count comes from applyReplacements
// on full file content at confirm time.
// Collect the distinct file paths from the last search result set.
function currentMatchPaths() {
  return lastResults.map((r) => r.path);
}

// Replace every match across every file-with-matches in the current result
// set. Reads all candidate files in one batch, applies the pure
// applyReplacements per file, skips files open with unsaved edits (dirty
// guard), confirms with the user, writes the batch, syncs open tabs, stores
// an undo snapshot, and re-runs the search.
async function replaceAll() {
  if (!folderPath || !query) return;
  // Gather the paths that currently have matches. If the last search
  // truncated, we still only operate on what's visible — the user can narrow
  // the query to reach more.
  const paths = currentMatchPaths();
  if (paths.length === 0) return;
  const replacement = replaceInput.value;
  const caseSen = caseSensitive;
  // 1. Batch-read all candidate files.
  let reads;
  try {
    reads = await invoke('read_files_batch', { paths });
  } catch (e) {
    notify('Read failed: ' + (e?.message || e || 'unknown error'));
    return;
  }
  // 2. Compute replacements per file, honoring the dirty guard.
  const writes = [];
  let totalReplacements = 0;
  const skippedDirty = [];
  const skippedError = [];
  for (const r of reads) {
    if (r.error || r.content == null) {
      skippedError.push(r.path);
      continue;
    }
    if (isDirtyCb && isDirtyCb(r.path)) {
      skippedDirty.push(r.path);
      continue;
    }
    const { result, count } = applyReplacements(r.content, query, replacement, { caseSensitive: caseSen });
    if (count === 0) continue; // no matches after re-read (e.g. file changed)
    writes.push({ path: r.path, oldContent: r.content, newContent: result, count });
    totalReplacements += count;
  }
  if (writes.length === 0) {
    notify(skippedDirty.length
      ? `No replacements — ${skippedDirty.length} file(s) skipped (unsaved changes)`
      : 'No replacements');
    return;
  }
  // 3. Confirm with the user.
  const skippedNote = skippedDirty.length + skippedError.length
    ? `\n${skippedDirty.length} skipped (unsaved changes)${skippedError.length ? `, ${skippedError.length} unreadable` : ''}`
    : '';
  const msg = `Replace ${totalReplacements} occurrence${totalReplacements === 1 ? '' : 's'} across ${writes.length} file${writes.length === 1 ? '' : 's'}?${skippedNote}`;
  if (!window.confirm(msg)) return;
  // 4. Batch-write.
  const writePayload = writes.map((w) => ({ path: w.path, content: w.newContent }));
  let results;
  try {
    results = await invoke('write_files_batch', { writes: writePayload });
  } catch (e) {
    notify('Write failed: ' + (e?.message || e || 'unknown error'));
    return;
  }
  // 5. Sync open tabs + report any write failures.
  let failed = 0;
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i];
    const res = results[i];
    if (res && res.ok && updateOpenDocCb) updateOpenDocCb(w.path, w.newContent);
    if (!res || !res.ok) failed += 1;
  }
  // 6. Store undo snapshot (only files that wrote successfully).
  lastReplace = writes
    .filter((w, i) => results[i] && results[i].ok)
    .map((w) => ({ path: w.path, oldContent: w.oldContent }));
  undoBtn.disabled = !lastReplace || lastReplace.length === 0;
  notify(failed
    ? `Replaced ${totalReplacements} in ${writes.length - failed} file(s); ${failed} failed`
    : `Replaced ${totalReplacements} across ${writes.length} file(s)`);
  // 7. Re-run the search to show remaining matches. The paths just written
  // get a one-shot highlight sweep in renderResults, so the user sees exactly
  // which files were touched.
  justAppliedPaths = new Set(writes.map((w) => w.path));
  runSearch();
}

// Replace all matches in a single file (the file whose group header was
// focused when Alt+Enter was pressed). Reuses the Replace All engine by
// temporarily narrowing lastResults to one path. Restores lastResults so
// the next full Replace All still sees the full set.
async function replaceFocusedFile() {
  if (!folderPath || !query) return;
  if (lastResults.length === 0) return;
  // v0.67.0: target the hovered/keyboard-selected group — this used to always
  // replace the FIRST result file, a dangerous default for a batch write.
  const target = focusedGroupPath || lastResults[0].path;
  const saved = lastResults;
  lastResults = saved.filter((r) => r.path === target);
  try {
    await replaceAll();
  } finally {
    lastResults = saved;
  }
}

// Replace all matches in one specific file. Reuses the Replace All engine
// with lastResults narrowed to that path. Restores lastResults afterward.
async function replaceOneFile(path) {
  if (!folderPath || !query || !path) return;
  const saved = lastResults;
  lastResults = saved.filter((r) => r.path === path);
  try {
    await replaceAll();
  } finally {
    lastResults = saved;
  }
}

// Restore the content of every file written by the last replace. Before
// restoring, re-reads each file's current content; if it already matches the
// pre-replace state (someone reverted it), that file is skipped — never
// clobber post-replace edits. Clears the snapshot after.
async function undoReplace() {
  if (!lastReplace || lastReplace.length === 0) return;
  // Re-read current contents to detect files already reverted.
  const paths = lastReplace.map((e) => e.path);
  let reads;
  try {
    reads = await invoke('read_files_batch', { paths });
  } catch (e) {
    notify('Undo read failed: ' + (e?.message || e || 'unknown error'));
    return;
  }
  const current = new Map();
  for (const r of reads) if (r.content != null) current.set(r.path, r.content);
  const writes = [];
  let skippedStale = 0;
  for (const entry of lastReplace) {
    const cur = current.get(entry.path);
    // If the file is unchanged from the pre-replace state, nothing to undo.
    if (cur === entry.oldContent) { skippedStale += 1; continue; }
    writes.push({ path: entry.path, content: entry.oldContent });
  }
  if (writes.length === 0) {
    notify(skippedStale ? 'Nothing to undo (files unchanged)' : 'Undo: nothing to restore');
    lastReplace = null;
    undoBtn.disabled = true;
    return;
  }
  let results;
  try {
    results = await invoke('write_files_batch', { writes });
  } catch (e) {
    notify('Undo write failed: ' + (e?.message || e || 'unknown error'));
    return;
  }
  let failed = 0;
  for (let i = 0; i < writes.length; i++) {
    const res = results[i];
    if (res && res.ok && updateOpenDocCb) updateOpenDocCb(writes[i].path, writes[i].content);
    if (!res || !res.ok) failed += 1;
  }
  lastReplace = null;
  undoBtn.disabled = true;
  notify(failed
    ? `Undid ${writes.length - failed} file(s); ${failed} failed`
    : `Undid ${writes.length} file(s)`);
  // Sweep the restored groups too, so "what did undo touch?" is visible.
  justAppliedPaths = new Set(writes.map((w) => w.path));
  runSearch();
}

// ---------- public API ----------
export function initFolderSearch(onOpen, { isDirty, updateOpenDoc } = {}) {
  if (created) return { open, close, destroy, searchWith };
  build();
  onOpenCallback = onOpen || null;
  isDirtyCb = isDirty || null;
  updateOpenDocCb = updateOpenDoc || null;
  created = true;
  return { open, close, destroy, searchWith };
}

function open(targetFolderPath) {
  if (!created) return;
  // Invalidate any pending/in-flight search for the previous folder so its
  // results can't render under the new folder's header.
  searchGen += 1;
  clearTimeout(debounceTimer);
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
  setCount('0', []);
  // Focus + select on open.
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

function close() {
  if (!created) return;
  overlay.classList.add('hidden');
  // Cancel any pending search so it doesn't write results after close.
  searchGen += 1;
  clearTimeout(debounceTimer);
  // Drop transient badge states (pop animation, warn/error tints, notify
  // message) so reopening starts clean instead of flashing stale state.
  clearTimeout(notify._t);
  countEl.classList.remove('pop', 'zero', 'error', 'search-notify');
  countEl.title = '';
}

// v0.45.0: open the panel pre-seeded with a query and run it immediately.
// Used by the tag pane so clicking a #tag shows matching files without the
// user retyping. Mirrors open() but skips the query reset + empty prompt.
function searchWith(targetFolderPath, initialQuery) {
  if (!created) return;
  open(targetFolderPath);
  if (initialQuery) {
    input.value = initialQuery;
    query = initialQuery;
    runSearch();
  }
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
