// File-tree sidebar (Explorer). Renders the contents of a chosen root folder
// as a tree the user can browse and click to open files. Directories expand/
// collapse on click; subdirectories load lazily on first expand (no full
// recursive walk on open). The currently-open file is highlighted.
//
// main.js owns the lifecycle: it creates the container + element, calls
// setRoot(path) when a folder is picked, and onOpenFile(path) is called when
// the user clicks a file row.

import { invoke } from '@tauri-apps/api/core';
import { getIconForPath } from '../lib/file-type.js';
import { ancestorsUnder } from '../lib/documents.js';

let _root = null;          // absolute path of the open folder, or null
let _container = null;     // the DOM element we render into
let _activePath = null;    // file path that should render as active
let _onOpenFile = null;    // callback: (path) => void
let _expanded = new Set(); // directory paths the user has expanded
// v0.67.0: expansion state persists per root so deep vaults survive restarts
// and folder re-picks (previously collapsed back to nothing).
const TREE_EXPANDED_KEY = 'mdpeek-tree-expanded:';

function saveExpanded() {
  if (!_root) return;
  try { localStorage.setItem(TREE_EXPANDED_KEY + _root, JSON.stringify([..._expanded])); } catch { /* quota */ }
}

// ---------- public API ----------
export function initFileTree(container, onOpenFile) {
  _container = container;
  _onOpenFile = onOpenFile;
  // One delegated click handler covers every row — rows are added/removed
  // constantly as the user expands/collapses, so per-row listeners would leak.
  _container.addEventListener('click', onTreeClick);
  // v0.67.0: keyboard navigation — ArrowUp/Down move focus, Enter/Space
  // activate, ArrowRight/Left expand/collapse (Left on a collapsed dir's row
  // goes to its parent). Rows carry tabindex=-1 with a roving tabindex=0.
  _container.addEventListener('keydown', onTreeKeydown);
  _container.setAttribute('role', 'tree');
  _container.setAttribute('aria-label', 'File explorer');
  renderEmpty();
}

export function setTreeRoot(path) {
  _root = path;
  _expanded.clear();
  if (path) {
    _expanded.add(path); // root is always expanded
    // v0.67.0: restore this root's persisted expansion state.
    try {
      const saved = JSON.parse(localStorage.getItem(TREE_EXPANDED_KEY + path) || '[]');
      if (Array.isArray(saved)) {
        for (const ep of saved) {
          // Separator check: a bare startsWith would let a sibling root that
          // shares a prefix ("C:\work" vs "C:\work2\…") restore its dirs here.
          const sep = typeof ep === 'string' ? ep.charAt(path.length) : '';
          if (typeof ep === 'string' && ep !== path && ep.startsWith(path) && (sep === '\\' || sep === '/')) _expanded.add(ep);
        }
      }
    } catch { /* ignore corrupt state */ }
  }
  render();
}

export function setActivePath(path) {
  _activePath = path;
  // Toggle the .active class without re-rendering the whole tree — cheaper
  // and avoids fl_icker on file open.
  _container.querySelectorAll('.tree-row.active').forEach((r) => r.classList.remove('active'));
  if (!path) return;
  const row = _container.querySelector(`.tree-row[data-path="${cssEscape(path)}"]`);
  if (row) row.classList.add('active');
}

// v0.49.0: Reveal a file in the tree: expand every ancestor directory (so a
// deeply-nested file's row actually exists in the DOM even if its parents were
// never opened), highlight it as active, and scroll it into view. No-op when
// no root is open or the path isn't under it. Safe to await; failures (e.g. a
// vanished ancestor) are swallowed — the tree simply won't expand that branch.
//
// Also fixes a latent bug: previously switching tabs didn't call setActivePath
// at all, so the tree highlight went stale until a fresh openPath. Callers now
// route tab-switches through revealPath, which subsumes setActivePath.
export async function revealPath(path) {
  if (!_root || !path) { setActivePath(path); return; }
  // Compute the ancestor dirs (root excluded) from root→down to the file's
  // parent. Each must be expanded for the file's row to exist in the DOM.
  const ancestors = ancestorsUnder(path, _root);
  for (const dir of ancestors) {
    if (_expanded.has(dir)) continue; // already open — its children are loaded
    // Find the dir's row (it exists because the previous ancestor was just
    // expanded, or it's a top-level entry). If it's missing, stop — the file
    // can't be reached down this branch.
    const row = _container.querySelector(`.tree-row[data-path="${cssEscape(dir)}"]`);
    if (!row) break;
    try {
      await expandDir(row, dir);
    } catch {
      break; // list_dir failed — leave the branch collapsed
    }
  }
  setActivePath(path);
  // Scroll the now-visible row into view (cheap; mirrors tabs/command-palette).
  const row = _container.querySelector(`.tree-row[data-path="${cssEscape(path)}"]`);
  if (row && typeof row.scrollIntoView === 'function') {
    row.scrollIntoView({ block: 'nearest' });
  }
}

export function refreshTree() {
  render();
}

// ---------- rendering ----------
function renderEmpty() {
  _container.innerHTML = `
    <div class="tree-empty">
      <p class="tree-empty-text">No folder opened</p>
      <button class="welcome-action primary tree-empty-btn" id="tree-open-btn" type="button">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.69.9H18a2 2 0 0 1 2 2v2"/></svg>
        <span>Open folder...</span>
      </button>
    </div>
  `;
}

async function render() {
  if (!_root) { renderEmpty(); return; }
  _container.innerHTML = '';
  // Build the root level; children are appended lazily on expand.
  const entries = await listDir(_root).catch(() => []);
  const frag = document.createDocumentFragment();
  frag.appendChild(headerRow());
  for (const e of entries) frag.appendChild(rowFor(e, 0));
  _container.innerHTML = '';
  _container.appendChild(frag);
  reapplyActive();
  // Exactly one row starts tabbable (roving tabindex).
  const firstRow = _container.querySelector('.tree-row');
  if (firstRow) firstRow.tabIndex = 0;
}

function headerRow() {
  const root = document.createElement('div');
  root.className = 'tree-root-label';
  const name = _root.split(/[\\/]/).pop() || _root;
  root.textContent = name;
  root.title = _root;
  return root;
}

// Build a single row for an entry. Indentation is depth * 14px.
function rowFor(entry, depth) {
  const row = document.createElement('div');
  row.className = `tree-row ${entry.is_dir ? 'is-dir' : 'is-file'}`;
  row.dataset.path = entry.path;
  row.dataset.kind = entry.is_dir ? 'dir' : 'file';
  row.dataset.depth = String(depth); // depthOf() reads this (see below)
  row.tabIndex = -1; // roving tabindex — see focusRow / onTreeKeydown
  row.setAttribute('role', 'treeitem');
  if (entry.is_dir) row.setAttribute('aria-expanded', _expanded.has(entry.path) ? 'true' : 'false');
  row.style.paddingLeft = `${depth * 14 + 10}px`;
  const chevron = entry.is_dir ? '<svg class="tree-chevron" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><polyline points="6 4 10 8 6 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '<span class="tree-chevron-spacer"></span>';
  const icon = entry.is_dir ? dirIcon() : fileIcon(entry.name);
  row.innerHTML = `${chevron}${icon}<span class="tree-name">${escapeHtml(entry.name)}</span>`;
  return row;
}

function dirIcon() {
  return '<svg class="tree-icon dir" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
}

// Files get the unified icon: SVG glyph for special types, colored letter
// badge for code languages, generic file otherwise.
function fileIcon(name) {
  return getIconForPath(name, 'tree-icon file');
}

// ---------- interactions ----------
async function onTreeClick(e) {
  const row = e.target.closest('.tree-row');
  if (!row) return;
  // Clicking a row also focuses it (rows are keyboard-focusable now).
  focusRow(row);
  const path = row.dataset.path;
  const kind = row.dataset.kind;
  if (kind === 'file') {
    if (_onOpenFile) _onOpenFile(path);
    return;
  }
  // Directory: toggle expansion.
  if (_expanded.has(path)) {
    collapseDir(row, path);
  } else {
    await expandDir(row, path);
  }
}

async function expandDir(row, path) {
  _expanded.add(path);
  saveExpanded();
  row.classList.add('expanded');
  row.setAttribute('aria-expanded', 'true');
  row.querySelector('.tree-chevron')?.classList.add('open');
  // Append a loading placeholder, then replace with the real entries.
  const depth = depthOf(row);
  const loader = document.createElement('div');
  loader.className = 'tree-loading';
  loader.textContent = '…';
  loader.style.paddingLeft = `${(depth + 1) * 14 + 10}px`;
  row.after(loader);
  const entries = await listDir(path).catch(() => []);
  loader.remove();
  // Collapsed while loading? Don't append children under a collapsed row.
  if (!_expanded.has(path)) return;
  // Insert after the clicked row in document order — every entry's depth is
  // one more than the directory's depth.
  let target = row;
  for (const entry of entries) {
    const child = rowFor(entry, depth + 1);
    target.after(child);
    target = child;
    // Auto-expand single-level nested dirs that the user already expanded
    // in a previous session (e.g. if they re-pick the same root).
    if (entry.is_dir && _expanded.has(entry.path)) {
      await expandDir(child, entry.path);
      // After recursive expand, target needs to be the last descendant.
      target = lastDescendantOf(child);
    }
  }
}

function collapseDir(row, path) {
  _expanded.delete(path);
  saveExpanded();
  row.classList.remove('expanded');
  row.setAttribute('aria-expanded', 'false');
  row.querySelector('.tree-chevron')?.classList.remove('open');
  // Remove every descendant row until we hit a sibling at the same/lower depth.
  const depth = depthOf(row);
  let next = row.nextElementSibling;
  while (next && !next.classList.contains('tree-root-label')) {
    // A row belongs to this subtree if its padding-left is greater than the
    // parent's. We compare depths via the parsed integer.
    if (depthOf(next) <= depth) break;
    const toRemove = next;
    next = next.nextElementSibling;
    toRemove.remove();
  }
}

function depthOf(row) {
  // v0.67.0: depth is carried on the row's dataset. The old paddingLeft
  // arithmetic silently broke if the CSS padding ever changed.
  const d = parseInt(row.dataset.depth, 10);
  if (Number.isFinite(d)) return d;
  const px = parseFloat(row.style.paddingLeft) || 0;
  return Math.max(0, Math.round((px - 10) / 14));
}

// Roving-tabindex focus helper for keyboard navigation.
function focusRow(row) {
  if (!row) return;
  _container.querySelectorAll('.tree-row').forEach((r) => { r.tabIndex = -1; });
  row.tabIndex = 0;
  if (typeof row.focus === 'function') row.focus();
}

function findParentRow(row) {
  const depth = depthOf(row);
  let cur = row.previousElementSibling;
  while (cur && depthOf(cur) >= depth) cur = cur.previousElementSibling;
  return cur && cur.classList.contains('tree-row') ? cur : null;
}

function onTreeKeydown(e) {
  const row = e.target.closest ? e.target.closest('.tree-row') : null;
  if (!row) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const rows = Array.from(_container.querySelectorAll('.tree-row'));
    const next = rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) focusRow(next);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (row.dataset.kind === 'file') {
      if (_onOpenFile) _onOpenFile(row.dataset.path);
    } else if (_expanded.has(row.dataset.path)) {
      collapseDir(row, row.dataset.path);
    } else {
      expandDir(row, row.dataset.path);
    }
  } else if (e.key === 'ArrowRight') {
    if (row.dataset.kind === 'dir' && !_expanded.has(row.dataset.path)) {
      e.preventDefault();
      expandDir(row, row.dataset.path);
    }
  } else if (e.key === 'ArrowLeft') {
    if (row.dataset.kind === 'dir' && _expanded.has(row.dataset.path)) {
      e.preventDefault();
      collapseDir(row, row.dataset.path);
    } else {
      const parent = findParentRow(row);
      if (parent) {
        e.preventDefault();
        focusRow(parent);
      }
    }
  }
}
function lastDescendantOf(row) {
  const depth = depthOf(row);
  let cur = row;
  while (cur.nextElementSibling && depthOf(cur.nextElementSibling) > depth) {
    cur = cur.nextElementSibling;
  }
  return cur;
}

function reapplyActive() {
  if (!_activePath) return;
  const row = _container.querySelector(`.tree-row[data-path="${cssEscape(_activePath)}"]`);
  if (row) row.classList.add('active');
}

// ---------- helpers ----------
async function listDir(path) {
  const entries = await invoke('list_dir', { path });
  return entries;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// CSS.escape is available in modern browsers (incl. WebView2); the fallback is
// good enough for the paths we deal with (attribute selectors are forgiving).
function cssEscape(s) {
  if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(s);
  return String(s).replace(/["\\]/g, '\\$&');
}
