// File-tree sidebar (Explorer). Renders the contents of a chosen root folder
// as a tree the user can browse and click to open files. Directories expand/
// collapse on click; subdirectories load lazily on first expand (no full
// recursive walk on open). The currently-open file is highlighted.
//
// main.js owns the lifecycle: it creates the container + element, calls
// setRoot(path) when a folder is picked, and onOpenFile(path) is called when
// the user clicks a file row.

import { invoke } from '@tauri-apps/api/core';

let _root = null;          // absolute path of the open folder, or null
let _container = null;     // the DOM element we render into
let _activePath = null;    // file path that should render as active
let _onOpenFile = null;    // callback: (path) => void
let _expanded = new Set(); // directory paths the user has expanded

// ---------- public API ----------
export function initFileTree(container, onOpenFile) {
  _container = container;
  _onOpenFile = onOpenFile;
  // One delegated click handler covers every row — rows are added/removed
  // constantly as the user expands/collapses, so per-row listeners would leak.
  _container.addEventListener('click', onTreeClick);
  renderEmpty();
}

export function setTreeRoot(path) {
  _root = path;
  _expanded.clear();
  if (path) {
    _expanded.add(path); // root is always expanded
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

export function refreshTree() {
  render();
}

// ---------- rendering ----------
function renderEmpty() {
  _container.innerHTML = `
    <div class="tree-empty">
      <p style="margin: 0 0 10px 0;">No folder opened</p>
      <button class="welcome-action primary" id="tree-open-btn" style="margin: 0; width: 100%; padding: 6px 12px; font-size: 12px; justify-content: center;" type="button">
        Open folder...
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
  row.style.paddingLeft = `${depth * 14 + 10}px`;
  const chevron = entry.is_dir ? '<svg class="tree-chevron" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><polyline points="4 6 8 10 12 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '<span class="tree-chevron-spacer"></span>';
  const icon = entry.is_dir ? dirIcon() : fileIcon(entry.name);
  row.innerHTML = `${chevron}${icon}<span class="tree-name">${escapeHtml(entry.name)}</span>`;
  return row;
}

function dirIcon() {
  return '<svg class="tree-icon dir" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
}
function getFileIconHtml(cls, extraClass = '') {
  const extra = extraClass ? ` ${extraClass}` : '';
  if (cls === 'md') {
    return `<svg class="file-icon md${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 11v4M8 11l2 2 2-2M12 11v4"/></svg>`;
  }
  if (cls === 'pdf') {
    return `<svg class="file-icon pdf${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 11v4M9 11h2.5a1.5 1.5 0 0 0 0-3H9"/></svg>`;
  }
  if (cls === 'img') {
    return `<svg class="file-icon img${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  }
  if (cls === 'code') {
    return `<svg class="file-icon code${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
  }
  if (cls === 'ex') {
    return `<svg class="file-icon ex${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="10" height="10" rx="1"/><circle cx="15" cy="15" r="5"/><path d="M13 8h5v5"/></svg>`;
  }
  if (cls === 'txt') {
    return `<svg class="file-icon txt${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="15" x2="14" y2="15"/></svg>`;
  }
  // Default fallback icon
  return `<svg class="file-icon${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
}

function fileIcon(name) {
  // Color the icon by file type so the tree is scannable at a glance.
  const ext = (name.split('.').pop() || '').toLowerCase();
  const cls = fileTypeClass(ext);
  return getFileIconHtml(cls, 'tree-icon file');
}
function fileTypeClass(ext) {
  if (['md', 'markdown', 'mdx'].includes(ext)) return 'md';
  if (['txt', 'log'].includes(ext)) return 'txt';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['excalidraw'].includes(ext)) return 'ex';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return 'img';
  if (['js', 'ts', 'json', 'html', 'css', 'py', 'go', 'rs', 'java', 'cpp', 'c', 'sh', 'bash', 'zsh', 'yaml', 'yml', 'toml'].includes(ext)) return 'code';
  return '';
}

// ---------- interactions ----------
async function onTreeClick(e) {
  const row = e.target.closest('.tree-row');
  if (!row) return;
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
  row.classList.add('expanded');
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
  row.classList.remove('expanded');
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
  // Recover depth from paddingLeft — the only place it's encoded.
  const px = parseFloat(row.style.paddingLeft) || 0;
  return Math.max(0, Math.round((px - 10) / 14));
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
