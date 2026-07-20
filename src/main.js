import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { openUrl } from '@tauri-apps/plugin-opener';
import { showDocument, buildToc } from './views/viewer.js';
import { showPdf } from './views/pdf-viewer.js';
import { showExcalidraw } from './views/excalidraw-viewer.js';
import { showImage } from './views/image-viewer.js';
import { initEditor } from './views/editor.js';
import { initFindBar } from './views/find-bar.js';
import { initCommandPalette, initQuickSwitcher } from './views/command-palette.js';
import { initFileTree, setTreeRoot, setActivePath, refreshTree } from './views/file-tree.js';
import { initCsvViewer } from './views/csv-viewer.js';
import { initFolderSearch } from './views/folder-search.js';
import { renderTabs } from './views/tabs.js';
import { DocumentStore, isPdfPath, isImagePath, isExcalidrawPath, langFromPath, langForEdit } from './lib/documents.js';
import { renderMarkdown, renderCode, renderCsv, parseCsv, prepareCodeLang } from './lib/renderer.js';
import { saveSession, loadSession, loadRecents, addRecent, removeRecent, saveRecents } from './lib/persistence.js';
import { NavHistory } from './lib/nav-history.js';
import { escapeHtml } from './lib/escape.js';
import { getIconForPath, relativeTime } from './lib/file-type.js';
// Real-time P2P collaboration (v0.21.0). Yjs + Trystero + Tauri deep-link.
import * as collab from './collab.js';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
// CHANGELOG.md is bundled at build time as a string via Vite's built-in ?raw
// suffix — no plugin or config needed. Rendered into the Settings → Changelog
// panel on first open (so the running app always shows its own changelog).
import changelogSource from '../CHANGELOG.md?raw';
// GitHub repo URL — single source of truth for the About panel + any other
// links pointing back to the project.
const REPO_URL = 'https://github.com/sanketpatel32/Mdpeek';
const REPO_ISSUES_URL = 'https://github.com/sanketpatel32/Mdpeek/issues';

// ---------- themes ----------
// Curated set: each entry maps the app theme id to its highlight.js theme id.
// applyTheme() enables exactly one hljs stylesheet so code blocks match.
const HLJS_FOR_THEME = {
  light: 'hljs-light',
  dark: 'hljs-dark',
  'solar-light': 'hljs-solar-light',
  'solar-dark': 'hljs-solar-dark',
  dracula: 'hljs-dracula',
  nord: 'hljs-nord',
  // The four new themes reuse existing hljs stylesheets (no native match).
  github: 'hljs-light',
  'github-dark': 'hljs-dark',
  'tokyo-night': 'hljs-dark',
  catppuccin: 'hljs-dracula',
};
const DEFAULT_THEME = 'light';

// Welcome screen markup — built dynamically so the recent-files list can be
// injected. Called from every place that shows the welcome screen.
function renderWelcome() {
  const recents = loadRecents();
  const recentsHtml = `
    <section class="recent-files" aria-label="Recent files">
      <div class="recent-header">
        <span class="recent-title">Recent</span>
        ${recents.length > 0 ? '<button class="recent-clear" data-action="clear-recents" type="button" title="Clear recent list">Clear</button>' : ''}
      </div>
      ${recents.length === 0 ? `
        <div class="recent-empty">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span>No recent files yet</span>
        </div>
      ` : `<div class="recent-list">${recents.map((r) => {
        // Shrink the middle of long paths so the filename stays visible.
        const path = r.path || '';
        const showPath = path.length > 48 ? path.slice(0, 20) + '…' + path.slice(-24) : path;
        // Per-file-type glyph so recents match tab icons (md/pdf/img/ex/txt)
        // plus colored letter badges for code languages (JS/PY/RS/GO/...).
        const iconHtml = getIconForPath(path, 'recent-icon');
        const when = relativeTime(r.openedAt);
        return `<button class="recent-item" data-path="${escapeHtml(r.path)}" type="button" title="${escapeHtml(path)}">
          ${iconHtml}
          <span class="recent-text">
            <span class="recent-name">${escapeHtml(r.name)}</span>
            <span class="recent-path">${escapeHtml(showPath)}</span>
          </span>
          ${when ? `<span class="recent-when">${escapeHtml(when)}</span>` : ''}
        </button>`;
      }).join('')}</div>`}
    </section>`;
  return `
  <div class="welcome">
    <div class="welcome-card">
      <div class="welcome-main">
        <div class="welcome-brand">
          <img src="/icon.png" alt="mdpeek" class="welcome-logo" />
          <h1 class="welcome-title">mdpeek <span class="version-badge">v0.21.1</span></h1>
          <p class="welcome-tagline">A lightweight Markdown viewer.</p>
        </div>

        <div class="welcome-actions">
          <button class="welcome-action primary" data-action="open" type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span>Open file</span>
            <kbd>Ctrl+O</kbd>
          </button>
          <button class="welcome-action" data-action="new" type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
            <span>New note</span>
            <kbd>Ctrl+N</kbd>
          </button>
          <button class="welcome-action" data-action="daily" type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>Today's note</span>
          </button>
          <button class="welcome-action" data-action="open-folder" type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
            <span>Open folder</span>
            <kbd>Ctrl+Shift+E</kbd>
          </button>
        </div>

        <div class="welcome-footer" aria-hidden="true">
          <kbd>Ctrl+E</kbd> edit/view
          <span class="dot">·</span>
          <kbd>Ctrl+P</kbd> switch
          <span class="dot">·</span>
          <kbd>F11</kbd> focus
          <span class="dot">·</span>
          <span class="welcome-drop">drop a file to open</span>
        </div>
      </div>

      <div class="welcome-aside">
        ${recentsHtml}
      </div>
    </div>
  </div>
`;
}

// Single source of truth: the list of open Documents + active-tab pointer.
const store = new DocumentStore();
// Browser-style back/forward history of the active doc. Wired into store
// 'change' events; cleared on session reset.
const navHistory = new NavHistory();
let _lastActiveId = null; // tracks the previously-seen activeId to detect switches
let _navWalking = false;  // true while we're driving back/forward (suppresses re-push)

const el = {
  open: document.getElementById('btn-open'),
  save: document.getElementById('btn-save'),
  mode: document.getElementById('btn-mode'),
  draw: document.getElementById('btn-draw'),
  sidebar: document.getElementById('btn-sidebar'),
  export: document.getElementById('btn-export'),
  exportPdf: document.getElementById('btn-export-pdf'),
  present: document.getElementById('btn-present'),
  daily: document.getElementById('btn-daily'),
  explorer: document.getElementById('btn-explorer'),
  fileTree: document.getElementById('file-tree'),
  fileTreeBody: document.getElementById('file-tree-body'),
  fileTreeClose: document.getElementById('file-tree-close'),
  fileTreeOpen: document.getElementById('file-tree-open'),
  zoomIn: document.getElementById('btn-zoom-in'),
  zoomOut: document.getElementById('btn-zoom-out'),
  zoomIndicator: document.getElementById('zoom-indicator'),
  theme: document.getElementById('btn-theme'),
  themeMenu: document.getElementById('theme-menu'),
  settings: document.getElementById('btn-settings'),
  settingsDialog: document.getElementById('settings-dialog'),
  update: document.getElementById('btn-update'),
  tabStrip: document.getElementById('tab-strip'),
  viewMode: document.getElementById('view-mode'),
  editMode: document.getElementById('edit-mode'),
  document: document.getElementById('document'),
  toc: document.getElementById('toc'),
  editor: document.getElementById('editor'),
  gutter: document.getElementById('gutter'),
  editorStatus: document.getElementById('editor-status'),
  readingProgress: document.getElementById('reading-progress'),
  preview: document.getElementById('preview'),
  toast: document.getElementById('toast'),
  dropzone: document.getElementById('dropzone'),
  pdfDrawToolbar: document.getElementById('pdf-draw-toolbar'),
  slideshow: document.getElementById('slideshow'),
  ctxMenu: document.getElementById('ctx-menu'),
  treeCtxMenu: document.getElementById('tree-ctx-menu'),
  closeDialog: document.getElementById('close-dialog'),
  closeRemember: document.getElementById('close-remember'),
  confirmDialog: document.getElementById('confirm-dialog'),
  // Collaboration (v0.21.0)
  share: document.getElementById('btn-share'),
  shareDialog: document.getElementById('share-dialog'),
  shareLinkInput: document.getElementById('share-link-input'),
  shareCopyBtn: document.getElementById('share-copy-btn'),
  shareStatus: document.getElementById('share-status'),
  shareCancelBtn: document.getElementById('share-cancel-btn'),
  shareEndBtn: document.getElementById('share-end-btn'),
  joinDialog: document.getElementById('join-dialog'),
  joinText: document.getElementById('join-dialog-text'),
  joinStatus: document.getElementById('join-dialog-status'),
  joinConfirmBtn: document.getElementById('join-confirm-btn'),
  joinCancelBtn: document.getElementById('join-cancel-btn'),
  collabStatus: document.getElementById('collab-status'),
  peerCarets: document.getElementById('peer-carets'),
};

// ---------- helpers ----------
const TOAST_TIMEOUT_MS = 2500;
const UPDATE_CHECK_DELAY_MS = 3000; // let the UI settle before the network call

// Normalise thrown values into a readable string — Tauri commands reject with
// strings, but JS errors and unknown rejections arrive as objects.
function fmtErr(e) {
  if (e == null) return 'unknown error';
  if (typeof e === 'string') return e;
  return e.message || String(e);
}

function toast(msg, opts = {}) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  el.toast.style.cursor = opts.onClick ? 'pointer' : 'default';
  el.toast.onclick = opts.onClick || null;
  clearTimeout(toast._t);
  if (!opts.persistent) {
    toast._t = setTimeout(() => {
      el.toast.classList.add('hidden');
      el.toast.onclick = null;
    }, TOAST_TIMEOUT_MS);
  }
}

function basename(p) {
  return p ? p.split(/[\\/]/).pop() : 'Untitled';
}

// Reusable in-app confirmation dialog (replaces native confirm()). Returns a
// Promise that resolves to the chosen button id, or null if dismissed.
//   confirmDialog({ title, text, buttons: [{id, label, kind}] })
// kind: 'primary' | 'danger' | 'secondary' (default)
const WARN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

function confirmDialog({ title, text, buttons, icon = 'warn' }) {
  return new Promise((resolve) => {
    const dlg = el.confirmDialog;
    const titleEl = dlg.querySelector('#confirm-title');
    const textEl = dlg.querySelector('#confirm-text');
    const iconEl = dlg.querySelector('#confirm-icon');
    const actionsEl = dlg.querySelector('#confirm-actions');
    titleEl.textContent = title;
    textEl.textContent = text;
    iconEl.innerHTML = icon === 'warn' ? WARN_ICON : '';
    iconEl.style.display = icon ? 'flex' : 'none';

    actionsEl.innerHTML = '';
    let resolved = false;

    // Escape + click-outside listeners. Captured here so done() can remove
    // them — without this, { once: true } listeners that never fire (because
    // the user clicked a button instead) would accumulate across dialog opens.
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(null);
      }
    };
    const onBackdrop = (e) => {
      if (e.target === dlg) done(null);
    };

    const done = (val) => {
      if (resolved) return;
      resolved = true;
      dlg.removeEventListener('keydown', onKey);
      dlg.removeEventListener('click', onBackdrop);
      dlg.classList.add('hidden');
      resolve(val);
    };

    for (const btn of buttons) {
      const b = document.createElement('button');
      b.className = 'modal-btn';
      if (btn.kind === 'primary') b.classList.add('modal-btn-primary');
      else if (btn.kind === 'danger') b.classList.add('modal-btn-danger');
      else b.classList.add('modal-btn-secondary');
      b.textContent = btn.label;
      b.addEventListener('click', () => done(btn.id));
      actionsEl.appendChild(b);
    }

    dlg.addEventListener('keydown', onKey);
    dlg.addEventListener('click', onBackdrop);

    dlg.classList.remove('hidden');
    // Focus the first button for keyboard users.
    const firstBtn = actionsEl.querySelector('.modal-btn');
    if (firstBtn) firstBtn.focus();
  });
}

async function rewatch(path) {
  if (!path) return;
  try {
    await invoke('watch_path', { path });
  } catch {
    /* ignore watcher failures */
  }
}

// ---------- viewport rendering (operates on active doc) ----------
// Tracks the previously-rendered doc so we can sync its editor content + caret
// + scroll position back into the doc BEFORE swapping to the new active doc.
// The <textarea> is shared across all tabs, so without this capture a tab
// switch would lose typed text and the caret/scroll position.
let _lastRenderedId = null;
let _renderGen = 0; // monotonic counter — guards async loads against stale tabs
let _activePdf = null; // controller for the currently-shown PDF (for teardown)
let _activeExcalidraw = null; // controller for the currently-shown Excalidraw tab
let _activeImage = null; // controller for the currently-shown annotated image
let _activeCsv = null; // controller for the currently-shown CSV/TSV table

// Toolbar visibility sync — keeps the header uncluttered by hiding buttons
// that have no effect in the current context. Called from every renderActive()
// branch so the rules live in one place. `doc` is null on the welcome screen.
//
// Most buttons (open, explorer, folder-search, daily, zoom, back/forward,
// theme, settings) are global and always shown. The sidebar (TOC) toggle is
// gated separately by syncSidebarVisibility(). This helper only handles the
// doc-specific actions that weren't already toggled inline in each branch.
function syncToolbarForDoc(doc) {
  // Save: only editable docs (markdown / plain / code in any mode). Hide on
  // the welcome screen and for read-only viewers (PDF / image / csv /
  // excalidraw) — there's nothing to write back to disk for those.
  const editable = !!doc && !doc.pdf && !doc.image && !doc.csv && !doc.excalidraw;
  el.save.classList.toggle('hidden', !editable);
}

async function renderActive() {
  // Sync the outgoing doc's editor content + caret + scroll back into its model.
  if (_lastRenderedId !== null && _lastRenderedId !== store.activeId) {
    // Closing the find bar on tab switch prevents stale highlights from one
    // doc lingering over another, and drops the textarea selection of a
    // soon-to-be-destroyed editor.
    if (find) find.close();
    const prev = store.docs.find((d) => d.id === _lastRenderedId);
    if (prev) {
      if (prev.mode === 'edit' && prev.editor) {
        prev.content = prev.editor.getValue();
        prev.editorState = prev.editor.getState();
        // If this doc is bound to a collab session, detach the binding before
        // the editor is destroyed (otherwise Y.Text observers reference a
        // dead textarea). The binding is re-established on tab return.
        if (_collabDocId === prev.id) collab.unbindEditor();
        // CRITICAL: destroy the outgoing editor's listeners. The <textarea> is
        // shared across all tabs; without this, switching between edit-mode
        // tabs stacks N keydown/input handlers on it, and every editor action
        // (Tab, Enter, auto-pair, Ctrl+B) applies N times, corrupting content.
        prev.editor.destroy();
        prev.editor = null;
      } else if (prev.mode === 'view' || prev.pdf) {
        // Capture the document's scroll so switching back restores it.
        prev.scrollY = el.document.scrollTop;
      }
    }
    // Tear down the outgoing PDF viewer (frees memory + cancels render tasks).
    if (_activePdf) {
      _activePdf.destroy();
      _activePdf = null;
    }
    // Tear down the outgoing Excalidraw tab (unmounts React).
    if (_activeExcalidraw) {
      _activeExcalidraw.destroy();
      _activeExcalidraw = null;
    }
    // Tear down the outgoing CSV viewer (removes its event listeners).
    if (_activeCsv) {
      _activeCsv.destroy();
      _activeCsv = null;
    }
    // Tear down the outgoing image viewer (detaches pointer handlers + observer).
    if (_activeImage) {
      _activeImage.destroy();
      _activeImage = null;
    }
    // Hide the draw toolbar when leaving a PDF tab.
    el.pdfDrawToolbar.classList.add('hidden');
    // Reset draw tool button states.
    document.querySelectorAll('.pdf-tool-btn').forEach((b) => b.classList.remove('active'));
  }
  _lastRenderedId = store.activeId;
  const gen = ++_renderGen; // capture this render's generation for async guards

  const doc = store.active();
  renderTabs(store);
  syncSidebarVisibility();
  // Hide toolbar buttons that don't apply to the current doc (e.g. Save on
  // the welcome screen or a read-only PDF/image/csv tab). Per-branch toggles
  // below refine further (draw/export/mode).
  syncToolbarForDoc(doc);

  // No doc, or an empty untouched Untitled tab in VIEW mode → show the welcome
  // screen. If the user explicitly switched to edit mode, show the editor even
  // for an empty untitled tab so they can start writing.
  const isEmpty = !doc || (doc.path === null && doc.content === '' && doc.mode === 'view' && !doc.pdf && !doc.excalidraw && !doc.code && !doc.csv);
  if (isEmpty) {
    el.editMode.classList.add('hidden');
    el.editMode.classList.remove('plain');
    el.mode.classList.remove('hidden');
    el.export.classList.add('hidden');
    if (el.exportPdf) el.exportPdf.classList.add('hidden');
    if (el.present) el.present.classList.add('hidden');
    if (el.share) el.share.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.toc.innerHTML = ''; // clear stale TOC from the previous document
    el.document.classList.remove('code-viewer', 'image-viewer');
    el.document.classList.add('has-welcome', 'markdown-body');
    el.document.innerHTML = renderWelcome();
    setReadingProgressVisible(false);
    return;
  }

  // PDF: read-only viewer, no edit toggle, no TOC. Draw toolbar available.
  if (doc.pdf) {
    el.editMode.classList.add('hidden');
    el.mode.classList.add('hidden');
    el.draw.classList.remove('hidden');
    el.export.classList.add('hidden');
    if (el.exportPdf) el.exportPdf.classList.add('hidden');
    if (el.present) el.present.classList.add('hidden');
    if (el.share) el.share.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.toc.innerHTML = '';
    el.document.classList.remove('has-welcome', 'code-viewer', 'image-viewer', 'markdown-body');
    setReadingProgressVisible(false);
    // showPdf is async and lazy-loads pdf.js. Store the controller so we can
    // tear it down on tab switch.
    showPdf(el.document, doc.path).then((ctrl) => {
      // Guard: if the user already switched away (gen mismatch), tear down.
      if (gen !== _renderGen) {
        ctrl.destroy();
      } else {
        _activePdf = ctrl;
        if (doc.scrollY) el.document.scrollTop = doc.scrollY;
      }
    }).catch((e) => toast('Could not open PDF: ' + fmtErr(e)));
    return;
  }

  // Image: read-only viewer. Loaded via the asset protocol (same as PDFs).
  // Centered on a neutral backdrop so transparent PNGs read clearly; click to
  // toggle actual-size vs. fit-to-window.
  if (doc.image) {
    el.editMode.classList.add('hidden');
    el.mode.classList.add('hidden');
    el.draw.classList.remove('hidden'); // images can be annotated (since v0.17.0)
    el.draw.setAttribute('title', 'Annotate image');
    el.draw.setAttribute('aria-label', 'Annotate image');
    el.export.classList.add('hidden');
    if (el.exportPdf) el.exportPdf.classList.add('hidden');
    if (el.present) el.present.classList.add('hidden');
    if (el.share) el.share.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.toc.innerHTML = '';
    el.document.classList.remove('has-welcome', 'code-viewer', 'image-viewer', 'markdown-body');
    el.document.classList.add('image-viewer');
    setReadingProgressVisible(false);
    _activeImage = showImage(el.document, doc.path);
    if (doc.scrollY) el.document.scrollTop = doc.scrollY;
    return;
  }

  // Excalidraw: full canvas editor, no edit toggle, no TOC.
  if (doc.excalidraw) {
    el.editMode.classList.add('hidden');
    el.mode.classList.add('hidden');
    el.draw.classList.add('hidden');
    el.export.classList.add('hidden');
    if (el.exportPdf) el.exportPdf.classList.add('hidden');
    if (el.present) el.present.classList.add('hidden');
    if (el.share) el.share.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.toc.innerHTML = '';
    el.document.classList.remove('has-welcome', 'code-viewer', 'image-viewer', 'markdown-body');
    setReadingProgressVisible(false);
    // showExcalidraw is async and lazy-loads React + Excalidraw. The onSave
    // callback writes the scene JSON back to doc.content (debounced) so the
    // drawing persists across tab switches.
    showExcalidraw(el.document, doc.content, (json) => {
      doc.content = json;
      store.markDirty(doc.id);
      persistSoon();
    }, document.documentElement.dataset.theme).then((ctrl) => {
      if (gen !== _renderGen) {
        ctrl.destroy();
      } else {
        _activeExcalidraw = ctrl;
      }
    }).catch((e) => toast('Could not open Excalidraw: ' + fmtErr(e)));
    return;
  }

  // CSV/TSV file: read-only sortable, filterable table view. No edit toggle,
  // no TOC. Uses a dedicated .csv-viewer class so it gets its own styling.
  if (doc.csv) {
    el.editMode.classList.add('hidden');
    el.mode.classList.add('hidden');
    el.draw.classList.add('hidden');
    el.export.classList.add('hidden');
    if (el.exportPdf) el.exportPdf.classList.add('hidden');
    if (el.present) el.present.classList.add('hidden');
    if (el.share) el.share.classList.add('hidden');
    el.pdfDrawToolbar.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.toc.innerHTML = '';
    el.document.classList.remove('has-welcome', 'markdown-body', 'image-viewer', 'code-viewer');
    el.document.classList.add('csv-viewer');
    setReadingProgressVisible(false);
    const tsv = /\.tsv$/i.test(doc.path || '');
    el.document.innerHTML = renderCsv(doc.content, { tsv });
    const parsedRows = parseCsv(doc.content, tsv);
    _activeCsv = initCsvViewer(el.document, parsedRows);
    if (doc.scrollY) el.document.scrollTop = doc.scrollY;
    return;
  }

  // Code file (non-markdown source): read-only syntax-highlighted view, no
  // edit toggle, no TOC. Uses a dedicated .code-viewer class so it gets
  // monospace styling without inheriting the markdown prose CSS.
  // Code file (non-markdown source): syntax-highlighted view when in view mode.
  // When in edit mode, it falls through to the text editor.
  if (doc.code) {
    if (doc.mode === 'edit') {
      // Fall through to the text editor below
    } else {
      el.editMode.classList.add('hidden');
      el.editMode.classList.remove('plain');
      el.mode.classList.remove('hidden');
      el.draw.classList.add('hidden');
      el.export.classList.add('hidden');
    if (el.exportPdf) el.exportPdf.classList.add('hidden');
    if (el.present) el.present.classList.add('hidden');
    if (el.share) el.share.classList.add('hidden');
      el.pdfDrawToolbar.classList.add('hidden');
      el.viewMode.classList.remove('hidden');
      el.toc.innerHTML = '';
      el.document.classList.remove('has-welcome', 'markdown-body');
      el.document.classList.add('code-viewer');
      setReadingProgressVisible(false);
      const lang = langFromPath(doc.path);
      // Render now (synchronous — covers the common ~36 languages). If the lang
      // is an extra that needs dynamic import, re-render once it's registered.
      el.document.innerHTML = renderCode(doc.content, lang);
      if (lang) {
        prepareCodeLang(lang).then((ready) => {
          // Re-render once the extra language registers.
          if (ready && gen === _renderGen && store.active()?.id === doc.id) {
            el.document.innerHTML = renderCode(doc.content, lang);
          }
        }).catch(() => {});
      }
      if (doc.scrollY) el.document.scrollTop = doc.scrollY;
      el.mode.title = 'Viewing. Click to edit (Ctrl+E)';
      el.mode.classList.remove('active');
      return;
    }
  }

  // Non-PDF/Excalidraw/code docs: ensure the draw toolbar + button are hidden,
  // and restore the markdown-body class (removed by the code-viewer branch).
  el.pdfDrawToolbar.classList.add('hidden');
  el.draw.classList.add('hidden');
  // Export to HTML / Present only make sense for real markdown docs (not
  // plain text — there's nothing to split into slides for a .txt file).
  el.export.classList.toggle('hidden', !!doc.plain);
  if (el.exportPdf) el.exportPdf.classList.toggle('hidden', !!doc.plain);
  if (el.present) el.present.classList.toggle('hidden', !!doc.plain);
  if (el.share) el.share.classList.toggle('hidden', !!doc.plain || collab.getStatus().active);
  el.document.classList.remove('code-viewer', 'image-viewer');
  el.document.classList.add('markdown-body');

  el.mode.title = doc.mode === 'edit'
    ? 'Editing. Click to view (Ctrl+E)'
    : 'Viewing. Click to edit (Ctrl+E)';
  el.mode.classList.toggle('active', doc.mode === 'edit');
  // Plain-text docs have no markdown preview — hide the toggle and expand the
  // editor to full width.
  el.mode.classList.toggle('hidden', !!doc.plain);
  // The `plain` class hides the preview pane and makes the editor full-width.
  // Apply it not just for .txt files (doc.plain) but for ANY non-markdown
  // doc that ends up in edit mode (e.g. code files like .js/.py/.rs). The
  // preview pane only renders markdown, so showing it for code is misleading.
  const isMarkdown = !doc.plain && !doc.code && !doc.csv && !doc.pdf && !doc.image && !doc.excalidraw;
  el.editMode.classList.toggle('plain', !isMarkdown);

  if (doc.mode === 'edit') {
    el.viewMode.classList.add('hidden');
    el.editMode.classList.remove('hidden');
    if (!doc.editor) {
      doc.editor = initEditor({
        textarea: el.editor,
        preview: el.preview,
        gutter: el.gutter,
        language: langForEdit(doc),
        highlightEnabled: localStorage.getItem('mdpeek-editor-highlight') !== '0',
      });
    }
    doc.editor.setValue(doc.content);
    // The <textarea> is shared across all tabs, so the editor instance is too.
    // Switching tabs must re-set the language so the overlay re-highlights
    // with the right grammar (e.g. .js → .py → .md).
    doc.editor.setLanguage(langForEdit(doc));
    // If this is the doc currently bound to a collab session, re-bind the
    // fresh editor instance to Yjs (renderActive destroys the editor on tab
    // switch, so we need to re-attach on return).
    if (collab.getStatus().active && _collabDocId === doc.id) {
      collab.bindEditor(doc.editor);
    }
    // Update the placeholder to match the doc type — code files shouldn't
    // say "Type markdown here...". The textarea's placeholder attribute is
    // what shows when the buffer is empty.
    const ta = doc.editor.textarea();
    if (ta) {
      if (doc.code) {
        const lang = langFromPath(doc.path);
        ta.placeholder = lang
          ? `Type ${lang} here...`
          : 'Type code here...';
      } else if (doc.plain) {
        ta.placeholder = 'Type plain text here...';
      } else {
        ta.placeholder = 'Type markdown here...';
      }
    }
    // Restore the caret + scroll captured when we last switched away.
    if (doc.editorState) doc.editor.setState(doc.editorState);
    // Re-apply typewriter mode to the freshly-bound editor.
    doc.editor.setTypewriter(localStorage.getItem('mdpeek-typewriter') === '1');
    el.editorStatus.classList.remove('hidden');
    updateEditorStatus();
    setReadingProgressVisible(false);
  } else {
    el.editMode.classList.add('hidden');
    el.editorStatus.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.document.classList.remove('has-welcome');
    await showDocument(el.document, doc.content);
    // Guard: if the user switched tabs during the (slow) mermaid render, bail
    // so we don't write TOC/scroll into the now-active doc.
    if (gen !== _renderGen) return;
    buildToc(el.document);
    updateActiveTocLink();
    // Restore the document scroll captured when we last switched away.
    if (doc.scrollY) el.document.scrollTop = doc.scrollY;
    setReadingProgressVisible(true);
  }
}

// ---------- persistence ----------
function persist() {
  saveSession(store.serialize());
}

// Global find bar — single instance, idempotent. Accessors read live state so
// the find module never holds stale references across tab/mode switches.
// Initialized BEFORE store.on('change') so renderActive() (which references
// `find`) can never hit a temporal-dead-zone ReferenceError if a 'change'
// event fires during startup.
const find = initFindBar({
  getMode: () => {
    const d = store.active();
    if (!d) return 'view';
    if (d.pdf) return 'pdf';
    if (d.excalidraw) return 'excalidraw';
    if (d.code) return d.mode;
    return d.mode;
  },
  getEditor: () => {
    const d = store.active();
    return d && d.editor ? d.editor : null;
  },
  getDocument: () => el.document,
  getPdf: () => _activePdf,
});

// ---------- command palette ----------
// A flat list of every action the user can launch via Ctrl+Shift+P. Each
// command lazily checks the current state (e.g. no "save" when no doc), so we
// don't need to recompute the list on every open — getCommands() filters at
// call time. Labels are matched fuzzily; keywords give silent ranking boosts.
const palette = initCommandPalette(() => {
  const cmds = [
    { id: 'open', label: 'Open file', hint: 'Ctrl+O', keywords: 'open file load', run: openFileDialog },
    { id: 'open-folder', label: 'Open folder in explorer', hint: 'Ctrl+Shift+E', keywords: 'open folder explorer tree workspace project', run: openFolderForExplorer },
    { id: 'back', label: 'Back', hint: 'Alt+Left', keywords: 'back previous history navigate', run: goBack },
    { id: 'forward', label: 'Forward', hint: 'Alt+Right', keywords: 'forward next history navigate', run: goForward },
    { id: 'quick-switch', label: 'Quick switcher (recent files)', hint: 'Ctrl+P', keywords: 'quick switch recent files open', run: () => quickSwitcher.open() },
    { id: 'new', label: 'New tab', hint: 'Ctrl+N', keywords: 'new tab untitled', run: newTab },
    { id: 'daily', label: 'Open daily note (today\'s .md)', keywords: 'daily note today date journal', run: openDailyNote },
    { id: 'save', label: 'Save', hint: 'Ctrl+S', keywords: 'save write', run: saveActive },
    { id: 'export-html', label: 'Export to HTML', keywords: 'export html self-contained', run: exportHtml },
    { id: 'export-pdf', label: 'Export to PDF', keywords: 'export pdf print document', run: exportPdf },
    { id: 'start-presentation', label: 'Start presentation', keywords: 'present slideshow slides deck fullscreen', run: togglePresentation },
    { id: 'start-collab', label: 'Share for live collaboration', keywords: 'collaborate share live pair peer realtime sync', run: openShareModal },
    { id: 'end-collab', label: 'End collaboration session', keywords: 'leave stop end disconnect collab', run: endCollabSession },
    {
      id: 'folder-search',
      label: 'Search in folder',
      keywords: 'search find grep folder files recursive global',
      run: () => {
        const root = localStorage.getItem('mdpeek-explorer-root');
        if (root) {
          folderSearch.open(root);
        } else {
          toast('Open a folder in the explorer first');
          toggleExplorer();
        }
      },
    },
    { id: 'copy-rich', label: 'Copy as rich text', hint: 'Ctrl+Shift+C', keywords: 'copy rich html clipboard paste formatted', run: copyAsRichText },
    { id: 'mode', label: 'Toggle edit / view', hint: 'Ctrl+E', keywords: 'toggle edit view mode', run: toggleMode },
    { id: 'sidebar', label: 'Toggle sidebar (TOC)', hint: 'Ctrl+B', keywords: 'sidebar toc outline', run: toggleSidebar },
    { id: 'find', label: 'Find', hint: 'Ctrl+F', keywords: 'find search', run: () => find.toggle() },
    { id: 'replace', label: 'Find & Replace', hint: 'Ctrl+H', keywords: 'replace substitute find', run: () => find.openReplace() },
    { id: 'focus', label: 'Focus mode', hint: 'F11', keywords: 'focus zen distraction', run: toggleFocus },
    { id: 'typewriter', label: 'Toggle typewriter mode', keywords: 'typewriter center line writing', run: toggleTypewriter },
    { id: 'zoom-in', label: 'Zoom in', hint: 'Ctrl+=', keywords: 'zoom in larger', run: zoomIn },
    { id: 'zoom-out', label: 'Zoom out', hint: 'Ctrl+-', keywords: 'zoom out smaller', run: zoomOut },
    { id: 'zoom-reset', label: 'Reset zoom', hint: 'Ctrl+0', keywords: 'zoom reset 100', run: zoomReset },
    { id: 'theme', label: 'Cycle theme', keywords: 'theme color light dark cycle', run: cycleTheme },
    { id: 'settings', label: 'Open settings', keywords: 'settings preferences options', run: openSettings },
    { id: 'check-updates', label: 'Check for updates', keywords: 'update version check', run: () => checkForUpdates(false) },
    { id: 'quit', label: 'Quit mdpeek', keywords: 'quit exit close', run: doQuitApp },
  ];
  // Hide actions that don't make sense in the current state. The palette
  // doesn't need to be exhaustive — it's a power-user shortcut, not a menu.
  const doc = store.active();
  const hasDoc = !!doc;
  const collabActive = collab.getStatus().active;
  return cmds.filter((c) => {
    if ((c.id === 'save' || c.id === 'export-html' || c.id === 'export-pdf' || c.id === 'start-presentation' || c.id === 'start-collab' || c.id === 'mode') && !hasDoc) return false;
    // 'end-collab' is only meaningful when a session is running.
    if (c.id === 'end-collab' && !collabActive) return false;
    // 'start-collab' is hidden once a session is active (use End instead).
    if (c.id === 'start-collab' && collabActive) return false;
    return true;
  });
});

// ---------- quick switcher (Ctrl+P) ----------
// Fuzzy-opens from the recents list. Reads recents at open-time so it always
// reflects the latest state; selecting an item reads the file and opens it as
// a new tab. Dead paths are caught and surfaced as a toast + removed.
const quickSwitcher = initQuickSwitcher(
  () => loadRecents().map((r) => ({ label: r.name, hint: shortPath(r.path), keywords: r.path, path: r.path })),
  async (item) => {
    try {
      const content = await invoke('read_file', { path: item.path });
      await openPath(item.path, content);
    } catch (e) {
      toast('Could not open: ' + item.name);
      removeRecent(item.path);
    }
  },
);

// Compact a path for the hint column: keep the filename + parent dir only.
function shortPath(p) {
  const parts = p.split(/[\\/]/);
  if (parts.length <= 2) return p;
  return '…/' + parts.slice(-2).join('/');
}

store.on('change', () => {
  // Track active-doc changes for back/forward navigation. We compare against
  // _lastActiveId so we only push when the active doc actually changed (the
  // 'change' event fires for many reasons — markDirty, content edits, etc.).
  const activeId = store.activeId;
  if (activeId !== _lastActiveId) {
    if (!_navWalking) navHistory.navigate(activeId);
    _lastActiveId = activeId;
    updateNavButtons();
  } else if (activeId === null) {
    // Last tab closed; reset last-seen so the next open() pushes correctly.
    _lastActiveId = null;
  }
  // Remove closed docs from history so we never try to switch back to them.
  for (const id of navHistory.entries) {
    if (id !== null && !store.docs.find((d) => d.id === id)) {
      navHistory.remove(id);
    }
  }
  renderActive().then(() => {
    // After rendering settles, jump to a pending line if one was stashed on
    // the active doc (e.g. by openPathAndJump from a folder-search result).
    applyPendingLine(store.active());
  }).catch((e) => {
    console.error('renderActive failed:', e);
    // Last-resort fallback: show the welcome screen so the app doesn't freeze.
    el.editMode.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.document.classList.add('has-welcome');
    el.document.innerHTML = renderWelcome();
  });
  persist();
});

// Debounced persist on every editor keystroke. Without this, the session only
// saved on the FIRST edit per tab (markDirty emits 'change' once, when dirty
// flips false→true). Now content is re-serialized ~1s after typing stops, so a
// crash/power-loss doesn't lose everything after the first character.
let _persistTimer = null;
function persistSoon() {
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(persist, 1000);
}

// ---------- open / new / close ----------
async function openPath(path, content, opts = {}) {
  store.open({ path, content });
  // Record in the recents list (welcome screen) — only real files, not untitled.
  if (path) addRecent(path);
  // Highlight the open file in the explorer sidebar (if visible + in tree).
  if (path) setActivePath(path);
  // Stash the requested line so the post-render hook can scroll to it once
  // renderActive finishes (the store 'change' event fires synchronously inside
  // store.open above, but renderActive itself runs as a microtask via .catch).
  if (opts.line) {
    const d = store.active();
    if (d) d.pendingLine = opts.line;
  }
  // PDFs are read-only binary — no file-watcher (the text-based watcher would
  // choke on bytes, and live-reload isn't meaningful for a PDF).
  // Excalidraw files are JSON but the canvas manages its own state — skip watcher.
  if (!isPdfPath(path) && !isExcalidrawPath(path)) await rewatch(path);
}

// Open a file from a search result and jump to a specific line. Reads the
// file fresh (search results come from the Rust side, which doesn't ship
// content back), then routes through openPath with the line hint. If the
// file is markdown in view mode, surface the search query in the find bar
// instead of trying to scroll to a source line (markdown view has no line
// concept).
async function openPathAndJump(path, line, query) {
  try {
    const content = await invoke('read_file', { path });
    await openPath(path, content, { line });
    // After openPath schedules the line jump, also kick off the find bar for
    // markdown view-mode docs so in-document matches are highlighted.
    const doc = store.active();
    if (doc && !doc.code && !doc.csv && !doc.pdf && !doc.image && !doc.excalidraw && doc.mode === 'view' && query) {
      // Wait one tick so renderActive has run.
      setTimeout(() => {
        if (find && query) find.open(query, { caseSensitive: false, focus: false });
      }, 60);
    }
  } catch (e) {
    toast('Could not open: ' + basename(path));
  }
}

// Consume doc.pendingLine after renderActive finishes. Called from the
// 'change' listener below once rendering settles. Three modes:
//   - Edit mode (any text): use editor.setState to set caret + scroll.
//   - Code view mode: pixel-scroll via gutter line-height.
//   - Markdown view / others: no-op (callers like openPathAndJump activate
//     the find bar instead).
function applyPendingLine(doc) {
  if (!doc || !doc.pendingLine) return;
  const line = doc.pendingLine;
  doc.pendingLine = null;
  if (line < 1) return;
  if (doc.mode === 'edit' && doc.editor) {
    // Compute character offset + scrollTop via the same math the find bar uses.
    const text = doc.editor.getValue();
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) {
      offset += lines[i].length + 1;
    }
    const ta = doc.editor.textarea();
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    const scrollTop = Math.max(0, (line - 1) * lineHeight - ta.clientHeight / 3);
    doc.editor.setState({ start: offset, end: offset, scrollTop });
  } else if (doc.code) {
    // Code view: the gutter's <div>s share the <pre>'s line-height. Scroll
    // the document so the target line lands roughly in the upper third.
    const gutterDiv = el.document.querySelector('.code-gutter > div');
    const lineHeight = gutterDiv ? (gutterDiv.getBoundingClientRect().height || 18) : 18;
    el.document.scrollTop = Math.max(0, (line - 1) * lineHeight - el.document.clientHeight / 3);
  }
  // CSV / markdown-view / PDF / image / excalidraw: no line concept. No-op.
}

function newTab() {
  // 'home' (default) opens a welcome-screen tab; an empty untitled view-mode
  // doc naturally renders the welcome screen via renderActive's isEmpty check.
  const fmt = localStorage.getItem('mdpeek-new-tab-format') || 'home';
  const modePref = localStorage.getItem('mdpeek-new-tab-mode') || 'view';
  if (fmt === 'excalidraw') {
    store.open({ path: null, content: '', excalidraw: true });
  } else if (fmt === 'home') {
    store.open({ path: null, content: '', mode: 'view' });
  } else {
    const plain = fmt === 'text';
    store.open({ path: null, content: '', plain, mode: plain ? 'edit' : modePref });
  }
}

async function closeTab(id) {
  const doc = store.docs.find((d) => d.id === id);
  if (!doc) return;
  // Closing the shared tab ends the live session — confirm first.
  if (doc.shared && collab.getStatus().active) {
    const choice = await confirmDialog({
      title: 'End collaboration session?',
      text: 'Closing this tab will end the live session and disconnect your collaborator.',
      buttons: [
        { id: 'cancel', label: 'Cancel', kind: 'secondary' },
        { id: 'end', label: 'End session', kind: 'danger' },
      ],
    });
    if (choice === null || choice === 'cancel') return;
    if (_collabDocId === id) {
      collab.endSession();
      _collabDocId = null;
    }
  }
  if (doc.dirty) {
    const name = basename(doc.path);
    const choice = await confirmDialog({
      title: 'Unsaved changes',
      text: `"${name}" has unsaved changes. Closing the tab will discard them.`,
      buttons: [
        { id: 'cancel', label: 'Cancel', kind: 'secondary' },
        { id: 'save', label: 'Save first', kind: 'primary' },
        { id: 'discard', label: 'Discard', kind: 'danger' },
      ],
    });
    if (choice === null || choice === 'cancel') return;
    if (choice === 'save') {
      await saveActive();
      // If the save was cancelled (no path chosen), abort the close.
      if (doc.dirty) return;
    }
  }
  // Free the editor's event listeners before dropping the doc (the <textarea>
  // is shared; without this, every closed edit-mode tab would leak a listener).
  if (doc.editor) doc.editor.destroy();
  if (_lastRenderedId === id) _lastRenderedId = null;
  store.close(id);
  // Closing the last tab opens a fresh home-screen tab so the window never
  // ends up empty. newTab() emits 'change' which re-runs renderActive; the
  // explicit fallback render covers any edge case where the emit didn't reach
  // the listener (e.g. a stale _lastRenderedId short-circuit).
  if (store.docs.length === 0) {
    newTab();
    if (!store.active()) renderActive();
  } else if (store.active()) {
    await rewatch(store.active().path);
  }
}

// Close every doc in `ids`. If any are dirty, show ONE combined confirm
// (rather than N separate dialogs) listing how many unsaved tabs will close.
// Returns true if the close went ahead, false if the user cancelled.
async function closeDocs(ids) {
  const toClose = ids.filter((id) => store.docs.find((d) => d.id === id));
  if (toClose.length === 0) return false;
  const dirtyCount = toClose.filter((id) => {
    const d = store.docs.find((x) => x.id === id);
    return d && d.dirty;
  }).length;
  if (dirtyCount > 0) {
    const noun = dirtyCount === 1 ? 'tab has unsaved changes' : 'tabs have unsaved changes';
    const choice = await confirmDialog({
      title: 'Close multiple tabs',
      text: `${dirtyCount} ${noun}. Closing will discard them.`,
      buttons: [
        { id: 'cancel', label: 'Cancel', kind: 'secondary' },
        { id: 'discard', label: `Close ${dirtyCount} ${dirtyCount === 1 ? 'tab' : 'tabs'}`, kind: 'danger' },
      ],
    });
    if (choice !== 'discard') return false;
  }
  // Switch to the target tab first (if it isn't active) so rewatch at the end
  // targets the right doc; the closing loop handles activeId fallout.
  for (const id of toClose) {
    const doc = store.docs.find((d) => d.id === id);
    if (!doc) continue;
    if (doc.editor) doc.editor.destroy();
    if (_lastRenderedId === id) _lastRenderedId = null;
    store.close(id);
  }
  if (store.docs.length === 0) {
    newTab();
    if (!store.active()) renderActive();
  } else if (store.active()) {
    await rewatch(store.active().path);
  }
  return true;
}

// Context-menu actions for a tab.
async function ctxAction(action, tabId) {
  const doc = store.docs.find((d) => d.id === tabId);
  if (!doc) return;
  const idx = store.docs.findIndex((d) => d.id === tabId);
  if (action === 'pin') {
    store.setPinned(tabId, !doc.pinned);
  } else if (action === 'close') {
    await closeTab(tabId);
  } else if (action === 'close-others') {
    // Pinned tabs survive "close others" — the user explicitly kept them.
    await closeDocs(store.docs.filter((d) => d.id !== tabId && !d.pinned).map((d) => d.id));
  } else if (action === 'close-right') {
    await closeDocs(store.docs.slice(idx + 1).filter((d) => !d.pinned).map((d) => d.id));
  } else if (action === 'close-all') {
    // Pinned tabs survive "close all" too — same reasoning.
    await closeDocs(store.docs.filter((d) => !d.pinned).map((d) => d.id));
  }
}

function hideCtxMenu() {
  el.ctxMenu.classList.add('hidden');
}

// ---------- file open dialog ----------
async function openFileDialog() {
  try {
    const res = await invoke('open_file');
    await openPath(res.path, res.content);
  } catch (e) {
    if (e !== 'cancelled') toast('Open failed: ' + fmtErr(e));
  }
}

// ---------- save ----------
async function saveActive() {
  const doc = store.active();
  if (!doc) return;
  // Sync editor content back into the doc before saving.
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  // Flush the Excalidraw scene (the onChange save is debounced — force it now).
  if (doc.excalidraw && _activeExcalidraw) {
    const json = _activeExcalidraw.getSceneJSON();
    if (json) doc.content = json;
  }
  const { content } = doc;

  if (!doc.path) {
    try {
      const path = await invoke('save_file_as', { content });
      doc.path = path;
      store.clearDirty(doc.id);
      toast('Saved');
    } catch (e) {
      if (e !== 'cancelled') toast('Save failed: ' + fmtErr(e));
    }
    return;
  }
  try {
    await invoke('save_file', { path: doc.path, content });
    store.clearDirty(doc.id);
    toast('Saved');
  } catch (e) {
    toast('Save failed: ' + fmtErr(e));
  }
}

// ---------- image paste / drop into the editor ----------
// When an image is pasted or dropped onto the textarea while editing a
// markdown doc, save the bytes to an `assets/` folder beside the doc and
// insert `![](assets/<hash>.<ext>)` at the caret. For untitled docs (no path),
// fall back to a base64 data URL so the image still embeds inline.
async function insertImageFromBlob(blob) {
  const doc = store.active();
  if (!doc || !doc.editor) return false;
  const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const buf = new Uint8Array(await blob.arrayBuffer());
  const hash = await sha256Hex(buf).catch(() => Math.random().toString(36).slice(2));
  const short = String(hash).slice(0, 10);
  const filename = `img-${short}.${ext}`;
  let md;
  if (doc.path) {
    const dir = doc.path.replace(/[\\/][^\\/]+$/, '');
    try {
      const saved = await invoke('save_image', { dir, filename, bytes: Array.from(buf) });
      md = `![](${saved})`;
    } catch (e) {
      toast('Could not save image: ' + fmtErr(e));
      return false;
    }
  } else {
    // No path yet — embed as a data URL so the image is at least visible.
    // The user can save-as later; the bytes are already in the document.
    const b64 = bytesToBase64(buf);
    md = `![](data:${blob.type};base64,${b64})`;
  }
  doc.editor.insertAtCursor(md);
  store.markDirty(doc.id);
  persistSoon();
  scheduleAutoSave();
  return true;
}

// Minimal SHA-256 → hex (async, Web Crypto). Used for stable image filenames
// so dropping the same image twice doesn't create duplicate files.
async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Base64 encode a Uint8Array — used for the data-URL fallback on untitled docs.
function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}


// Curated prose styles inlined into every export so the file renders correctly
// offline (no CDN, no external CSS). Covers the markdown-body typography that
// matters for sharing — headings, code, lists, tables, blockquotes, links.
const EXPORT_CSS = `
body { margin: 0; padding: 40px 48px 96px; background: var(--bg); color: var(--fg);
  font-family: var(--content-font-family); font-size: var(--content-font-size, 16px);
  line-height: var(--content-line-height); -webkit-font-smoothing: antialiased; }
h1,h2,h3,h4,h5,h6 { line-height: 1.25; margin: 1.8em 0 0.6em; font-weight: 600; }
h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border-subtle); }
h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border-subtle); }
h3 { font-size: 1.25em; } h4 { font-size: 1em; }
p { margin: 0 0 1em; }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
ul,ol { margin: 0 0 1em; padding-left: 1.6em; } li { margin: 0.25em 0; }
blockquote { margin: 0 0 1em; padding: 0.6em 1.1em; color: var(--fg-secondary);
  border-left: 3px solid var(--border); background: var(--surface); border-radius: 0 6px 6px 0; }
code { font-family: "Cascadia Code","SFMono-Regular",Consolas,monospace; font-size: 0.88em;
  background: var(--code-bg); padding: 0.15em 0.4em; border-radius: 4px; }
pre { margin: 0 0 1em; padding: 14px 16px; background: var(--code-bg); border-radius: 8px;
  overflow-x: auto; } pre code { background: none; padding: 0; font-size: 13px; }
hr { border: none; border-top: 1px solid var(--border-subtle); margin: 2em 0; }
table { border-collapse: collapse; margin: 0 0 1em; } th,td { border: 1px solid var(--border);
  padding: 6px 13px; } th { background: var(--surface); font-weight: 600; }
img { max-width: 100%; }
`;

// Read the active theme's CSS variables from the live DOM so the export matches
// what the user sees. Falls back to light-theme defaults if reads fail.
function exportThemeVars() {
  const root = getComputedStyle(document.documentElement);
  const vars = ['--bg', '--fg', '--fg-secondary', '--fg-muted', '--surface', '--border',
    '--border-subtle', '--accent', '--code-bg', '--content-font-family', '--content-line-height'];
  const decls = vars.map((v) => {
    const val = root.getPropertyValue(v).trim();
    return val ? `${v}: ${val};` : '';
  }).filter(Boolean).join(' ');
  return `:root { ${decls} --content-font-size: 16px; }`;
}

// Fetch the active hljs theme's CSS text from its <link> href. Returns '' if
// offline or the fetch fails (code stays readable, just uncolored).
async function exportHljsCss() {
  try {
    const theme = document.documentElement.dataset.theme;
    const id = HLJS_FOR_THEME[theme] || 'hljs-light';
    const link = document.getElementById(id);
    if (!link || !link.href) return '';
    const res = await fetch(link.href);
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return ''; // offline / CORS — export still works, just without code colors
  }
}

async function exportHtml() {
  const doc = store.active();
  if (!doc || doc.pdf || doc.excalidraw || doc.code || doc.csv) {
    toast('Export to HTML is for Markdown documents');
    return;
  }
  // Sync editor content before exporting so unsaved edits are included.
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  const bodyHtml = renderMarkdown(doc.content);
  const title = doc.path ? basename(doc.path).replace(/\.(md|markdown|mdx)$/i, '') : 'Untitled';
  const css = `/* mdpeek export */ ${exportThemeVars()} ${EXPORT_CSS} ${await exportHljsCss()}`;
  const full =
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(title)}</title>\n<style>\n${css}\n</style>\n</head>\n<body>\n` +
    `${bodyHtml}\n</body>\n</html>`;
  try {
    await invoke('save_file_as_html', { content: full });
    toast('Exported to HTML');
  } catch (e) {
    if (e !== 'cancelled') toast('Export failed: ' + fmtErr(e));
  }
}

// Export the active markdown document to PDF via the OS print dialog. The
// print stylesheet (in content.css, @media print) hides all app chrome so
// only the rendered markdown prints. The user picks "Save as PDF" (or any
// printer) in the native dialog. Re-uses the live renderer so Mermaid
// diagrams, KaTeX math, code highlighting, and footnotes all print exactly
// as seen on screen.
async function exportPdf() {
  const doc = store.active();
  if (!doc || doc.pdf || doc.excalidraw || doc.code || doc.image || doc.csv) {
    toast('Export to PDF is for Markdown documents');
    return;
  }
  // Sync any unsaved editor content into the model.
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  // Switch to view mode so the rendered markdown is on screen, and remember
  // the prior mode so we can restore it after the dialog closes.
  const priorMode = doc.mode;
  if (priorMode === 'edit') {
    doc.mode = 'view';
    if (find) find.close();
    await renderActive();
  }
  // Re-render into the live DOM so any deferred enhancements (Mermaid,
  // dynamic hljs languages) are fully painted before window.print() captures.
  try {
    await showDocument(el.document, doc.content);
  } catch (e) {
    console.error('exportPdf render failed:', e);
  }
  // Signal print-only styles (the @media print block keys off <body.printing>).
  document.body.classList.add('printing');
  const cleanup = () => {
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', cleanup);
    // Restore the user's prior edit mode once the dialog is dismissed.
    if (priorMode === 'edit') {
      doc.mode = 'edit';
      renderActive().catch((e) => console.error('exportPdf restore failed:', e));
    }
  };
  window.addEventListener('afterprint', cleanup);
  // Defer to the next frame so the printing class + render settle before the
  // dialog snapshots the page.
  requestAnimationFrame(() => window.print());
}

function toggleMode() {
  const doc = store.active();
  if (!doc) return;
  if (doc.plain) return; // plain-text docs have no preview to toggle to
  if (doc.pdf) return;   // PDFs are read-only — no edit mode
  if (doc.image) return; // Images are read-only — no edit mode
  if (doc.excalidraw) return; // Excalidraw is always interactive — no edit/view toggle
  if (doc.csv) return;        // CSVs are read-only table views — no edit mode
  // Capture content before switching out of edit mode.
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  doc.mode = doc.mode === 'view' ? 'edit' : 'view';
  if (find) find.close(); // clear highlights/selection before the re-render
  renderActive().catch((e) => console.error('toggleMode render failed:', e));
}

// ---------- theme ----------
function applyTheme(next) {
  if (!HLJS_FOR_THEME[next]) next = DEFAULT_THEME;
  applyThemeImpl(next);
}

// Cycle through the available themes in declared order. Used by the command
// palette — gives users a quick way to preview themes without opening the menu.
function cycleTheme() {
  const current = document.documentElement.dataset.theme || DEFAULT_THEME;
  const order = Object.keys(HLJS_FOR_THEME);
  const i = order.indexOf(current);
  const next = order[(i + 1) % order.length];
  applyThemeImpl(next);
}

// Shared implementation — applyTheme validates first, cycleTheme already
// knows the next id is valid.
function applyThemeImpl(next) {
  const root = document.documentElement;
  root.dataset.theme = next;
  localStorage.setItem('mdpeek-theme', next);
  // Enable exactly one highlight.js stylesheet; disable the rest so code
  // blocks recolor to match the active UI theme.
  const want = HLJS_FOR_THEME[next];
  for (const id of Object.values(HLJS_FOR_THEME)) {
    const link = document.getElementById(id);
    if (link) link.disabled = id !== want;
  }
  // Mark the active item in the dropdown (drives the check mark).
  document.querySelectorAll('.theme-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === next);
  });
  const label = document
    .querySelector(`.theme-item[data-theme="${next}"] .theme-name`)
    ?.textContent.trim();
  el.theme.title = label ? `Theme: ${label}` : 'Theme';
  // Propagate theme to the active Excalidraw tab (if any) so the canvas
  // matches the app's light/dark mode.
  if (_activeExcalidraw) _activeExcalidraw.setTheme(next);
  closeThemeMenu();
}

// Dropdown open/close. Anchored under the palette button.
function openThemeMenu() {
  el.themeMenu.classList.remove('hidden');
  el.theme.setAttribute('aria-expanded', 'true');
}
function closeThemeMenu() {
  if (!el.themeMenu || el.themeMenu.classList.contains('hidden')) return;
  el.themeMenu.classList.add('hidden');
  el.theme.setAttribute('aria-expanded', 'false');
}
function toggleThemeMenu() {
  if (el.themeMenu.classList.contains('hidden')) openThemeMenu();
  else closeThemeMenu();
}

// ---------- focus / zen mode (hide header + sidebar for distraction-free reading) ----------
function toggleFocus() {
  const on = document.body.classList.toggle('focus-mode');
  localStorage.setItem('mdpeek-focus', on ? '1' : '0');
}

// ---------- presentation mode (v0.20.0) ----------
// Turn the active markdown doc into a fullscreen slideshow by splitting on
// lines of 3+ hyphens (---). Keyboard nav: arrows/space/PageUp-Down/Home/End,
// F = OS fullscreen, S = toggle deck ↔ reading style, Esc = exit.
let _slideshow = null; // { slides: string[], index, style: 'deck'|'reading' } | null

// Split markdown source into slide chunks. Strips YAML front-matter first
// (so the leading ---\n...\n--- block isn't read as a slide delimiter), then
// splits on lines that are ONLY 3+ hyphens. Empty leading/trailing chunks are
// dropped (e.g. a trailing --- at EOF). A doc with no --- yields one slide.
function splitSlides(md) {
  if (!md) return [];
  let src = md;
  // YAML front-matter: leading ---\n...\n---\n. Non-greedy so it stops at the
  // closing fence; if there's no closing fence the regex won't match and we
  // treat the whole thing as content (rare, malformed).
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(src);
  if (fm) src = src.slice(fm[0].length);
  // Split on lines that are ONLY 3+ hyphens (with optional surrounding space).
  // Multi-line flag so ^/$ match line boundaries, not just string boundaries.
  const parts = src.split(/^[ \t]*-{3,}[ \t]*$/m);
  // Trim each chunk + drop empty leading/trailing entries (keep empties in the
  // middle — those are real blank slides the author may want).
  const trimmed = parts.map((s) => s.replace(/^\n+/, '').replace(/\s+$/, ''));
  while (trimmed.length > 0 && trimmed[0] === '') trimmed.shift();
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
  return trimmed;
}

function togglePresentation() {
  if (document.body.classList.contains('presenting')) {
    exitPresentation();
  } else {
    enterPresentation();
  }
}

function enterPresentation() {
  const doc = store.active();
  if (!doc || doc.pdf || doc.excalidraw || doc.code || doc.image || doc.csv) {
    toast('Presentation is for Markdown documents');
    return;
  }
  // Sync any pending editor changes into doc.content before splitting.
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  const slides = splitSlides(doc.content);
  if (slides.length === 0) {
    toast('Nothing to present — the document is empty');
    return;
  }
  // Build the slide articles. Rendered synchronously per slide (mermaid blocks
  // render as static SVG if pre-rendered, otherwise raw code — skip the
  // expensive enhanceDom mermaid pass for fast slide transitions).
  const stage = el.slideshow.querySelector('.slide-stage');
  stage.innerHTML = '';
  for (const slideMd of slides) {
    const article = document.createElement('article');
    article.className = 'markdown-body slide';
    article.innerHTML = renderMarkdown(slideMd);
    stage.appendChild(article);
  }
  _slideshow = {
    slides,
    index: 0,
    style: localStorage.getItem('mdpeek-slide-style') === 'reading' ? 'reading' : 'deck',
  };
  // Apply the style class on the overlay (drives all the .deck-style /
  // .reading-style CSS rules) + the body class that reveals it.
  el.slideshow.classList.remove('deck-style', 'reading-style');
  el.slideshow.classList.add(_slideshow.style + '-style');
  el.slideshow.classList.remove('hidden');
  document.body.classList.add('presenting');
  updateSlide();
}

function exitPresentation() {
  document.body.classList.remove('presenting');
  el.slideshow.classList.add('hidden');
  // Drop the built slide articles so the next enter re-renders fresh content.
  const stage = el.slideshow.querySelector('.slide-stage');
  if (stage) stage.innerHTML = '';
  // Exit OS fullscreen too if we entered it via F.
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  _slideshow = null;
}

function goToSlide(n) {
  if (!_slideshow) return;
  const total = _slideshow.slides.length;
  _slideshow.index = Math.max(0, Math.min(n, total - 1));
  updateSlide();
}
function nextSlide() { if (_slideshow) goToSlide(_slideshow.index + 1); }
function prevSlide() { if (_slideshow) goToSlide(_slideshow.index - 1); }

function updateSlide() {
  if (!_slideshow) return;
  const { index, slides } = _slideshow;
  const articles = el.slideshow.querySelectorAll('.slide');
  articles.forEach((a, i) => a.classList.toggle('active', i === index));
  // Restart the slide-in animation on the newly-active slide so each
  // transition animates (toggling the class alone won't re-trigger CSS
  // animations without a reflow).
  const active = articles[index];
  if (active) {
    active.style.animation = 'none';
    // Force reflow so the animation restarts.
    void active.offsetWidth;
    active.style.animation = '';
    active.scrollTop = 0;
  }
  const progress = el.slideshow.querySelector('.slide-progress');
  if (progress) progress.textContent = `${index + 1} / ${slides.length}`;
  const prev = el.slideshow.querySelector('.slide-arrow.prev');
  const next = el.slideshow.querySelector('.slide-arrow.next');
  if (prev) prev.disabled = index === 0;
  if (next) next.disabled = index === slides.length - 1;
}

// Toggle between deck (dark, big, centered) and reading (theme, normal) styles.
function toggleSlideStyle() {
  if (!_slideshow) return;
  _slideshow.style = _slideshow.style === 'deck' ? 'reading' : 'deck';
  localStorage.setItem('mdpeek-slide-style', _slideshow.style);
  el.slideshow.classList.remove('deck-style', 'reading-style');
  el.slideshow.classList.add(_slideshow.style + '-style');
}

// Toggle OS-level fullscreen (F key in presentation). No-op if not supported.
function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

// ---------- typewriter mode ----------
// Vertically centers the line containing the caret while editing. Persists
// across tabs + restarts. No-op outside edit mode (the active editor is null).
function toggleTypewriter() {
  const on = localStorage.getItem('mdpeek-typewriter') === '1';
  localStorage.setItem('mdpeek-typewriter', on ? '0' : '1');
  const doc = store.active();
  if (doc && doc.editor) doc.editor.setTypewriter(!on);
  toast(on ? 'Typewriter off' : 'Typewriter on');
}

// ---------- real-time collaboration (v0.21.0) ----------
//
// Host flow:  click Share → collab.startSession(text) → modal shows invite URL
//             → peer joins via URL → both editors stay in sync via Yjs.
// Receiver:   mdpeek://invite URL → join confirm → shared tab created → bound
//             to the host's Yjs doc.
// The textarea ↔ Y.Text binding lives in collab.js; here we only own the UI
// (modal state, status pill, peer caret rendering, tab badges, close guards).

// Track which doc.id is currently bound to the collab session, so we can
// re-bind when switching back to it after visiting another tab.
let _collabDocId = null;
// Pending invite URL captured before the user has confirmed join — used by
// the join dialog.
let _pendingInvite = null;

// Pick a friendly default identity for awareness (cursor label). We don't ask
// the user; the OS hostname is a reasonable stand-in without being identifiable.
function defaultCollabName() {
  try {
    // WebView2 exposes navigator.userAgent but no hostname; fall back to a
    // generic label. (Could prompt the user later; out of scope for MVP.)
    return 'User-' + Math.floor(Math.random() * 9000 + 1000);
  } catch { return 'User'; }
}

function updateCollabStatus(status) {
  if (!el.collabStatus) return;
  const active = status.active;
  el.collabStatus.classList.toggle('hidden', !active);
  if (!active) {
    clearPeerCarets();
    return;
  }
  const text = status.peerCount > 0
    ? `Live · ${status.peerCount} ${status.peerCount === 1 ? 'peer' : 'peers'}`
    : (status.role === 'host' ? 'Live · waiting' : 'Live · connecting');
  el.collabStatus.querySelector('.collab-text').textContent = text;
  // Re-render peer carets if the bound editor is the active one.
  renderPeerCarets(status);
  // Update the share modal status line if it's open.
  if (!el.shareDialog.classList.contains('hidden')) {
    if (status.role === 'host') {
      el.shareStatus.textContent = status.peerCount > 0
        ? `● ${status.peerCount} ${status.peerCount === 1 ? 'collaborator' : 'collaborators'} connected`
        : 'Waiting for a collaborator to join…';
      el.shareStatus.classList.toggle('connected', status.peerCount > 0);
      el.shareEndBtn.classList.toggle('hidden', status.peerCount === 0);
      // Hide the link row once a peer is connected (no need to keep copying).
      const linkRow = el.shareDialog.querySelector('.share-link-row');
      const footnote = el.shareDialog.querySelector('.share-footnote');
      if (linkRow) linkRow.style.display = status.peerCount > 0 ? 'none' : '';
      if (footnote) footnote.style.display = status.peerCount > 0 ? 'none' : '';
    }
  }
  // Surface host-left to receivers.
  if (status.hostLeft) {
    toast('Host ended the session. This tab is now a local document — use Save as… to keep your copy.', { persistent: true });
    const doc = store.docs.find((d) => d.id === _collabDocId);
    if (doc) {
      doc.shared = false;
      renderTabs(store);
    }
    _collabDocId = null;
    collab.unbindEditor();
  }
}

// Subscribe once at startup.
collab.on(updateCollabStatus);

function openShareModal() {
  const doc = store.active();
  if (!doc) return;
  if (collab.getStatus().active) {
    // Session already running — just show its current state.
    el.shareLinkInput.value = '';
    el.shareStatus.textContent = 'Waiting for a collaborator to join…';
    el.shareStatus.classList.remove('connected', 'error');
    el.shareEndBtn.classList.add('hidden');
    el.shareDialog.classList.remove('hidden');
    updateCollabStatus(collab.getStatus());
    return;
  }
  // Sync the editor's current text into doc.content before seeding Yjs, so
  // the host's latest keystrokes are what the receiver starts from.
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  el.shareLinkInput.value = 'Generating…';
  el.shareStatus.textContent = 'Generating invite link…';
  el.shareStatus.classList.remove('connected', 'error');
  el.shareEndBtn.classList.add('hidden');
  el.shareDialog.classList.remove('hidden');
  try {
    const result = collab.startSession(doc.content || '', {
      title: doc.path ? doc.path.split(/[\\/]/).pop() : 'Shared note',
      language: langForEdit(doc) || 'markdown',
    });
    collab.setLocalIdentity({ name: defaultCollabName() });
    el.shareLinkInput.value = result.inviteUrl;
    el.shareStatus.textContent = 'Waiting for a collaborator to join…';
    // Bind the active editor to the Y.Text. Force edit mode so the textarea
    // exists (you can't share a read-only view).
    if (doc.mode !== 'edit') {
      doc.mode = 'edit';
      renderActive();
    }
    // After renderActive rebuilds the editor, bind it on the next tick.
    requestAnimationFrame(() => {
      const d = store.active();
      if (d && d.editor) {
        collab.bindEditor(d.editor);
        _collabDocId = d.id;
      }
    });
  } catch (err) {
    el.shareStatus.textContent = 'Could not start session: ' + (err?.message || err);
    el.shareStatus.classList.add('error');
  }
}

function closeShareModal() {
  el.shareDialog.classList.add('hidden');
}

async function endCollabSession() {
  collab.endSession();
  // Convert the host's shared doc back to a normal doc (it's still on disk).
  const doc = store.docs.find((d) => d.id === _collabDocId);
  if (doc) {
    doc.shared = false;
    renderTabs(store);
  }
  _collabDocId = null;
  closeShareModal();
  toast('Session ended');
}

async function copyShareLink() {
  const url = el.shareLinkInput.value;
  if (!url || url === 'Generating…') return;
  try {
    await navigator.clipboard.writeText(url);
    const original = el.shareCopyBtn.textContent;
    el.shareCopyBtn.textContent = 'Copied!';
    setTimeout(() => { el.shareCopyBtn.textContent = original; }, 1500);
  } catch {
    el.shareLinkInput.focus();
    el.shareLinkInput.select();
    toast('Copy failed — select the link manually');
  }
}

// ---------- receiver: invite URL → join ----------

function showJoinDialog(roomId) {
  _pendingInvite = roomId;
  el.joinStatus.classList.add('hidden');
  el.joinStatus.textContent = '';
  el.joinConfirmBtn.disabled = false;
  el.joinConfirmBtn.textContent = 'Join';
  el.joinDialog.classList.remove('hidden');
}

function closeJoinDialog() {
  el.joinDialog.classList.add('hidden');
  _pendingInvite = null;
}

async function confirmJoin() {
  if (!_pendingInvite) { closeJoinDialog(); return; }
  const roomId = _pendingInvite;
  el.joinConfirmBtn.disabled = true;
  el.joinConfirmBtn.textContent = 'Connecting…';
  el.joinStatus.textContent = 'Reaching the host over P2P…';
  el.joinStatus.classList.remove('hidden', 'error');
  try {
    collab.setLocalIdentity({ name: defaultCollabName() });
    const result = await collab.joinSession(roomId);
    // Create a new shared tab seeded with the host's current text + title.
    const doc = store.open({
      path: null,
      content: result.initialText || '',
      mode: 'edit',
      shared: true,
    });
    if (result.title) doc._collabTitle = result.title;
    // The user-facing tab title for a shared doc: host's filename + "(shared)".
    // We can't easily override renderTabs here, but the .shared class adds a
    // "(shared)" suffix via CSS — good enough for MVP.
    closeJoinDialog();
    // Bind the editor after renderActive builds it for the new tab.
    requestAnimationFrame(() => {
      const d = store.active();
      if (d && d.editor) {
        collab.bindEditor(d.editor);
        _collabDocId = d.id;
      }
    });
    toast('Joined session');
  } catch (err) {
    el.joinStatus.textContent = (err?.message || String(err));
    el.joinStatus.classList.add('error');
    el.joinConfirmBtn.disabled = false;
    el.joinConfirmBtn.textContent = 'Join';
  }
}

function handleInviteUrl(url) {
  const parsed = collab.parseInviteUrl(url);
  if (!parsed) return;
  if (collab.getStatus().active) {
    toast('You are already in a collaboration session. End it first.');
    return;
  }
  showJoinDialog(parsed.roomId);
}

// ---------- peer caret rendering ----------
//
// For each remote peer with a known caret offset, render a thin colored bar
// at the corresponding character position in the textarea. We measure positions
// via a hidden mirror <div> with the same font/padding — standard technique.

let _caretMirror = null;
function ensureCaretMirror() {
  if (_caretMirror) return _caretMirror;
  _caretMirror = document.createElement('div');
  _caretMirror.className = 'collab-mirror';
  _caretMirror.setAttribute('aria-hidden', 'true');
  // Match the textarea's typography + box model exactly so the character
  // bounding boxes line up. Pulled from getComputedStyle at render time.
  const ta = el.editor;
  const cs = getComputedStyle(ta);
  _caretMirror.style.font = cs.font;
  _caretMirror.style.fontSize = cs.fontSize;
  _caretMirror.style.fontFamily = cs.fontFamily;
  _caretMirror.style.lineHeight = cs.lineHeight;
  _caretMirror.style.letterSpacing = cs.letterSpacing;
  _caretMirror.style.whiteSpace = 'pre-wrap';
  _caretMirror.style.wordWrap = 'break-word';
  _caretMirror.style.padding = cs.padding;
  _caretMirror.style.border = cs.border;
  _caretMirror.style.boxSizing = cs.boxSizing;
  _caretMirror.style.position = 'absolute';
  _caretMirror.style.visibility = 'hidden';
  _caretMirror.style.pointerEvents = 'none';
  _caretMirror.style.zIndex = '-1';
  // Width matches the textarea's content width (minus scrollbar).
  _caretMirror.style.width = ta.clientWidth + 'px';
  el.peerCarets.parentElement.appendChild(_caretMirror);
  return _caretMirror;
}

function clearPeerCarets() {
  if (el.peerCarets) el.peerCarets.innerHTML = '';
}

function renderPeerCarets(status) {
  if (!el.peerCarets) return;
  // Only render when the bound doc is the one currently visible.
  const doc = store.active();
  if (!doc || doc.id !== _collabDocId || !doc.editor) {
    clearPeerCarets();
    return;
  }
  const ta = el.editor;
  if (!ta || ta.offsetParent === null) { clearPeerCarets(); return; }
  const mirror = ensureCaretMirror();
  // Mirror the textarea's current text + scroll so caret positions are correct.
  mirror.textContent = ta.value;
  mirror.scrollTop = ta.scrollTop;
  mirror.scrollLeft = ta.scrollLeft;
  // Remove carets for peers that no longer exist; add/update the rest.
  const seenIds = new Set();
  for (const peer of status.peers) {
    if (typeof peer.caret !== 'number') continue;
    seenIds.add(peer.id);
    let node = el.peerCarets.querySelector(`[data-peer="${cssAttrEscape(peer.id)}"]`);
    if (!node) {
      node = document.createElement('div');
      node.className = 'peer-caret';
      node.dataset.peer = peer.id;
      node.style.setProperty('--peer-color', peer.color || '#3b82f6');
      const label = document.createElement('div');
      label.className = 'peer-caret-label';
      label.textContent = peer.name || 'Peer';
      const bar = document.createElement('div');
      bar.className = 'peer-caret-bar';
      node.append(label, bar);
      el.peerCarets.appendChild(node);
    }
    positionCaret(node, peer.caret, mirror, ta);
  }
  // Drop carets for peers not in the new status.
  el.peerCarets.querySelectorAll('.peer-caret').forEach((n) => {
    if (!seenIds.has(n.dataset.peer)) n.remove();
  });
}

// Map a character offset in the textarea to a {left, top, height} rect in
// peer-carets coordinate space, using the mirror element's caret rect.
function positionCaret(node, offset, mirror, ta) {
  // Place a sentinel span at the offset and measure its rect.
  const text = mirror.textContent;
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const before = document.createTextNode(text.slice(0, safeOffset));
  const marker = document.createElement('span');
  marker.textContent = '\u200b'; // zero-width space — preserves layout
  const after = document.createTextNode(text.slice(safeOffset));
  mirror.replaceChildren(before, marker, after);
  const markerRect = marker.getBoundingClientRect();
  const taRect = ta.getBoundingClientRect();
  const parentRect = el.peerCarets.getBoundingClientRect();
  // Caret sits at the right edge of the marker.
  const left = markerRect.right - parentRect.left;
  const top = markerRect.top - parentRect.top;
  node.style.transform = `translate(${left}px, ${top}px)`;
  node.style.height = `${markerRect.height || 18}px`;
}

// Escape a string for use in a CSS attribute selector ([data-peer="…"]).
function cssAttrEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

// The bound doc is being torn down (tab closed or app closing). End the
// session cleanly and notify peers.
function teardownCollabIfActive() {
  if (collab.getStatus().active) {
    collab.endSession();
    _collabDocId = null;
  }
}

// ---------- daily note ----------
// One-click "today's note". First run asks the user to pick a notes folder
// (persisted to mdpeek-notes-dir); subsequent runs go straight there. If
// today's YYYY-MM-DD.md already exists, opens it; otherwise creates it with a
// small starter template. Opened in edit mode so the user can start writing.
async function openDailyNote() {
  let dir = localStorage.getItem('mdpeek-notes-dir') || '';
  if (!dir) {
    // First run: explain what's happening before popping the OS folder
    // picker. Without context, "pick a folder" reads as a confusing non-
    // sequitur and users cancel without knowing why they were asked.
    const choice = await confirmDialog({
      title: 'Pick a notes folder',
      text: 'Daily notes are saved as YYYY-MM-DD.md inside a folder you choose. Pick where mdpeek should keep them — you can change this later in Settings.',
      buttons: [
        { id: 'cancel', label: 'Cancel', kind: 'secondary' },
        { id: 'pick', label: 'Choose folder', kind: 'primary' },
      ],
    });
    if (choice !== 'pick') return;
    try {
      dir = await invoke('pick_folder');
      localStorage.setItem('mdpeek-notes-dir', dir);
      toast('Notes folder set: ' + basename(dir));
    } catch (e) {
      if (e !== 'cancelled') toast('Could not pick folder: ' + fmtErr(e));
      return;
    }
  }
  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const sep = /[\\/]/.test(dir) && !dir.endsWith('/') && !dir.endsWith('\\') ? '\\' : '';
  const path = `${dir}${sep}${stamp}.md`;
  // Try to read the existing file. If it exists, open it; otherwise create.
  try {
    const content = await invoke('read_file', { path });
    await openPath(path, content);
    store.active().mode = 'edit';
    renderActive();
    return;
  } catch (e) {
    // File doesn't exist (or unreadable) → fall through to create.
  }
  const prettyDate = today.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const starter = `# ${stamp}\n\n*${prettyDate}*\n\n## \n\n`;
  try {
    await invoke('save_file', { path, content: starter });
    await openPath(path, starter);
    store.active().mode = 'edit';
    renderActive();
    toast(`Created ${stamp}.md`);
  } catch (e) {
    toast('Could not create daily note: ' + fmtErr(e));
  }
}

// Re-pick the notes folder (used by the Settings panel).
async function changeNotesFolder() {
  try {
    const dir = await invoke('pick_folder');
    localStorage.setItem('mdpeek-notes-dir', dir);
    toast('Notes folder set: ' + basename(dir));
    syncSettingsControls();
  } catch (e) {
    if (e !== 'cancelled') toast('Could not pick folder: ' + fmtErr(e));
  }
}


// Copies the rendered markdown to the clipboard in two formats: text/html
// (so Word/Email/Slack paste it with formatting intact) + text/plain (the raw
// markdown source, so plain-text editors still get something useful). The HTML
// payload is wrapped in a styled container so paste targets render headings,
// lists, and code blocks properly.
async function copyAsRichText() {
  const doc = store.active();
  if (!doc || doc.plain) {
    toast('Nothing to copy');
    return;
  }
  // Edit mode: sync unsaved changes from the editor into doc.content first.
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  const html = renderMarkdown(doc.content);
  const plain = doc.content;
  const styled = `<div class="markdown-body" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.6;">${html}</div>`;
  try {
    const item = new ClipboardItem({
      'text/html': new Blob([styled], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
    toast('Copied as rich text');
  } catch (e) {
    // Insecure context or unsupported ClipboardItem — fall back to plain text.
    try {
      await navigator.clipboard.writeText(plain);
      toast('Copied as markdown');
    } catch {
      toast('Copy failed');
    }
  }
}

// ---------- back / forward navigation ----------
// Walk the doc history (browser-style). Suppression during the walk prevents
// the 'change' event from re-pushing the destination onto the stack.
function goBack() {
  const id = navHistory.back();
  if (!id) return;
  _navWalking = true;
  store.switch(id);
  _navWalking = false;
}
function goForward() {
  const id = navHistory.forward();
  if (!id) return;
  _navWalking = true;
  store.switch(id);
  _navWalking = false;
}
// Update the disabled state of back/forward buttons. Called from the change
// handler. No-op if the buttons aren't in the DOM (defensive).
function updateNavButtons() {
  document.querySelectorAll('[data-nav="back"]').forEach((b) => {
    b.disabled = !navHistory.canBack;
  });
  document.querySelectorAll('[data-nav="forward"]').forEach((b) => {
    b.disabled = !navHistory.canForward;
  });
}

// ---------- sidebar (TOC) toggle & visibility ----------
function syncSidebarVisibility() {
  const doc = store.active();
  const hasToc = doc && !doc.pdf && !doc.excalidraw && !doc.code && !doc.csv && !doc.plain && doc.mode === 'view';
  
  if (!hasToc) {
    el.toc.classList.add('collapsed');
    el.sidebar.classList.add('hidden');
  } else {
    el.sidebar.classList.remove('hidden');
    const pref = localStorage.getItem('mdpeek-sidebar') !== 'hidden';
    el.toc.classList.toggle('collapsed', !pref);
    el.sidebar.classList.toggle('active', pref);
  }
}

function toggleSidebar() {
  const doc = store.active();
  const hasToc = doc && !doc.pdf && !doc.excalidraw && !doc.code && !doc.csv && !doc.plain && doc.mode === 'view';
  if (!hasToc) return;

  const collapsed = el.toc.classList.toggle('collapsed');
  el.sidebar.classList.toggle('active', !collapsed);
  localStorage.setItem('mdpeek-sidebar', collapsed ? 'hidden' : 'visible');
  if (!collapsed) {
    updateActiveTocLink();
  }
}

// ---------- file explorer (left sidebar) ----------
// Browse a chosen folder as a tree; click a file to open it. Persists the
// chosen root + visibility so reopening the app restores the workspace.
initFileTree(el.fileTreeBody, async (path) => {
  try {
    const content = await invoke('read_file', { path });
    await openPath(path, content);
  } catch (e) {
    toast('Could not open: ' + basename(path));
  }
});
el.fileTreeBody.addEventListener('click', (e) => {
  if (e.target.closest('#tree-open-btn')) {
    openFolderForExplorer();
  }
  // Track the last-clicked row so the Cut/Copy/Paste/Delete/F2 keyboard
  // shortcuts have a target when the tree has focus. Cleared by the editor
  // and other inputs' focus handlers below.
  const row = e.target.closest('.tree-row');
  if (row && row.dataset.path) {
    _treeActivePath = row.dataset.path;
    _treeActiveKind = row.dataset.kind;
  }
});
// Clear the tree-active tracker when focus moves to the editor — the editor
// owns its own Ctrl+C/X/V semantics and we must not hijack them. The general
// input/textarea guard in the keydown handler below covers other fields.
el.editor.addEventListener('focus', () => { _treeActivePath = null; _treeActiveKind = null; });

// ---------- File-tree context menu (Cut/Copy/Paste/Rename/Delete) ----------
// Standard Windows-explorer-style right-click menu on files and folders in
// the explorer tree. Backed by the delete_path / rename_path / copy_path /
// move_path Rust commands. Clipboard state is in-memory only — it doesn't
// survive app restart and doesn't touch the system clipboard.
let _clipboard = null;       // { path, op: 'cut'|'copy' } | null
let _treeCtxTarget = null;   // { path, kind: 'file'|'dir', row } last right-click target
let _treeActivePath = null;  // last-clicked tree row path (for keyboard shortcuts)
let _treeActiveKind = null;  // 'file' | 'dir' | null (matches _treeActivePath)

// Return the parent directory of a Windows or POSIX path (no trailing sep).
function parentDir(p) {
  if (!p) return '';
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return idx > 0 ? p.slice(0, idx) : p;
}
// True if `path` is `root` itself or anywhere underneath it (case-insensitive,
// Windows paths are case-insensitive on disk).
function isPathUnder(path, root) {
  if (!path || !root) return false;
  const p = path.toLowerCase().replace(/[\\/]+$/, '');
  const r = root.toLowerCase().replace(/[\\/]+$/, '');
  return p === r || p.startsWith(r + '\\') || p.startsWith(r + '/');
}

// Show the menu at the cursor, populating items based on the target kind +
// current clipboard state.
function showTreeCtxMenu(row, e) {
  const path = row.dataset.path;
  const kind = row.dataset.kind; // 'file' | 'dir'
  _treeCtxTarget = { path, kind, row };
  const isDir = kind === 'dir';
  // Paste requires: target is a directory AND clipboard has something.
  const canPaste = isDir && !!_clipboard && !isPathUnder(_clipboard.path, path);
  // Per-item visibility / disabled state.
  el.treeCtxMenu.querySelectorAll('.ctx-item').forEach((btn) => {
    const action = btn.dataset.action;
    btn.disabled = false;
    if (action === 'paste') btn.disabled = !canPaste;
  });
  // "Search in folder…" only makes sense on directories. Toggle its visibility
  // and the separator above it together.
  const searchBtn = el.treeCtxMenu.querySelector('.tree-ctx-search');
  const searchSep = el.treeCtxMenu.querySelector('.tree-ctx-search-sep');
  if (isDir) {
    searchBtn?.classList.remove('hidden');
    searchSep?.classList.remove('hidden');
  } else {
    searchBtn?.classList.add('hidden');
    searchSep?.classList.add('hidden');
  }
  // Clamp so the menu never overflows the window edge (same trick as tab menu).
  el.treeCtxMenu.classList.remove('hidden');
  const rect = el.treeCtxMenu.getBoundingClientRect();
  el.treeCtxMenu.classList.add('hidden');
  const x = Math.min(e.clientX, window.innerWidth - rect.width - 4);
  const y = Math.min(e.clientY, window.innerHeight - rect.height - 4);
  el.treeCtxMenu.style.left = x + 'px';
  el.treeCtxMenu.style.top = y + 'px';
  el.treeCtxMenu.classList.remove('hidden');
}
function hideTreeCtxMenu() {
  el.treeCtxMenu.classList.add('hidden');
}

// Apply/remove the visual "cut" mark on tree rows that match the clipboard path.
function syncCutMark() {
  el.fileTreeBody.querySelectorAll('.tree-row.cut').forEach((r) => r.classList.remove('cut'));
  if (_clipboard && _clipboard.op === 'cut') {
    const row = el.fileTreeBody.querySelector(`.tree-row[data-path="${cssEscape(_clipboard.path)}"]`);
    row?.classList.add('cut');
  }
}
// Escape a string for safe use inside a CSS attribute selector. The tree
// renders paths verbatim into data-path, so they may contain characters that
// break the selector (quotes, backslashes).
function cssEscape(s) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
  return String(s).replace(/["\\]/g, '\\$&');
}

el.fileTreeBody.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.tree-row');
  if (!row) return; // right-click on empty tree space → no menu
  e.preventDefault();
  showTreeCtxMenu(row, e);
});

el.treeCtxMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('.ctx-item');
  if (!btn || btn.disabled) return;
  const action = btn.dataset.action;
  hideTreeCtxMenu();
  treeCtxAction(action).catch((err) => {
    console.error('treeCtxAction failed:', err);
    toast('Operation failed: ' + fmtErr(err));
  });
});

// Dismiss the tree menu on outside click, Escape, scroll, or window blur —
// mirrors the tab context menu's dismiss logic.
window.addEventListener('mousedown', (e) => {
  if (!el.treeCtxMenu.classList.contains('hidden') && !el.treeCtxMenu.contains(e.target)) {
    hideTreeCtxMenu();
  }
});
window.addEventListener('blur', hideTreeCtxMenu);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.treeCtxMenu.classList.contains('hidden')) hideTreeCtxMenu();
});
el.fileTreeBody.addEventListener('scroll', hideTreeCtxMenu, { passive: true });

// Dispatch a tree context-menu action. `action` is the data-action attribute.
// All paths come from `_treeCtxTarget` (the row that was right-clicked).
async function treeCtxAction(action) {
  const target = _treeCtxTarget;
  if (!target) return;
  const { path, kind } = target;
  if (action === 'cut') {
    if (!path) return;
    _clipboard = { path, op: 'cut' };
    syncCutMark();
    return;
  }
  if (action === 'copy') {
    if (!path) return;
    _clipboard = { path, op: 'copy' };
    syncCutMark(); // clears any previous cut mark
    return;
  }
  if (action === 'paste') {
    if (kind !== 'dir' || !_clipboard) return;
    await pasteInto(path);
    return;
  }
  if (action === 'rename') {
    if (!path) return;
    startRenameInTree(target.row, path);
    return;
  }
  if (action === 'delete') {
    if (!path) return;
    await deleteFromTree(path);
    return;
  }
  if (action === 'search') {
    if (kind !== 'dir') return;
    folderSearch.open(path);
    return;
  }
}

// Copy (op=copy) or move (op=cut) `_clipboard.path` into `dstDir`.
async function pasteInto(dstDir) {
  const src = _clipboard?.path;
  const op = _clipboard?.op;
  if (!src || !op) return;
  // Guard: never paste a folder into itself or one of its descendants.
  if (isPathUnder(dstDir, src)) {
    toast("Can't paste a folder into itself");
    return;
  }
  try {
    let newPath;
    if (op === 'cut') {
      newPath = await invoke('move_path', { src, dstDir });
      // Cut is a one-shot operation — clear the clipboard on success.
      _clipboard = null;
    } else {
      newPath = await invoke('copy_path', { src, dstDir });
    }
    syncCutMark();
    refreshTree();
    toast(op === 'cut' ? 'Moved' : 'Copied', { onClick: null });
  } catch (e) {
    toast('Paste failed: ' + fmtErr(e));
  }
}

// Prompt → move to Recycle Bin → clean up open tabs + recents → refresh.
async function deleteFromTree(path) {
  const name = basename(path);
  // Compute affected tabs up front so the confirm dialog can mention them —
  // avoids a second unsaved-changes prompt after the delete already happened.
  const affected = store.docs.filter((d) => d.path && (d.path === path || isPathUnder(d.path, path)));
  const dirtyCount = affected.filter((d) => d.dirty).length;
  const tabNote = affected.length > 0
    ? `\n\n${affected.length} open ${affected.length === 1 ? 'tab' : 'tabs'} will close` +
      (dirtyCount > 0 ? ` (${dirtyCount} with unsaved changes — recover from the Recycle Bin if needed).` : '.')
    : '';
  const choice = await confirmDialog({
    title: `Delete "${name}"?`,
    text: `Move to the Recycle Bin? You can restore it from there.${tabNote}`,
    buttons: [
      { id: 'cancel', label: 'Cancel', kind: 'secondary' },
      { id: 'delete', label: 'Delete', kind: 'danger' },
    ],
  });
  if (choice !== 'delete') return;
  try {
    await invoke('delete_path', { path });
    // Force-close affected tabs WITHOUT a second unsaved-changes prompt: the
    // delete is already done + the user was warned in the dialog above. Tabs
    // with unsaved buffers lose their in-memory edits (the file itself is in
    // the Recycle Bin if it had been saved at any point).
    for (const d of affected) {
      if (d.editor) d.editor.destroy();
      if (_lastRenderedId === d.id) _lastRenderedId = null;
      store.close(d.id);
    }
    if (store.docs.length === 0) {
      newTab();
      if (!store.active()) renderActive();
    } else if (store.active()) {
      await rewatch(store.active().path);
      renderActive();
    }
    // Strip the path from recents (file or folder) + anything underneath it.
    const remaining = loadRecents().filter((r) => !r.path || (r.path !== path && !isPathUnder(r.path, path)));
    saveRecents(remaining);
    // If the clipboard pointed at the deleted path, drop it.
    if (_clipboard && isPathUnder(_clipboard.path, path)) {
      _clipboard = null;
    }
    syncCutMark();
    refreshTree();
    toast(`"${name}" moved to Recycle Bin`);
  } catch (e) {
    toast('Delete failed: ' + fmtErr(e));
  }
}

// Replace the row's name span with a focused text input prefilled with the
// current name (extension auto-selected-out for files). Enter commits, Esc
// cancels, blur commits. Commuting to rename_path updates the active doc's
// path in place if it matches.
function startRenameInTree(row, path) {
  if (!row) return;
  const nameSpan = row.querySelector('.tree-name');
  if (!nameSpan) return;
  const oldName = basename(path);
  const dir = parentDir(path);
  const isDir = row.dataset.kind === 'dir';
  // Split stem / ext for files so the user can rename without touching the ext.
  let stem = oldName, ext = '';
  if (!isDir && oldName.lastIndexOf('.') > 0) {
    const dot = oldName.lastIndexOf('.');
    stem = oldName.slice(0, dot);
    ext = oldName.slice(dot); // includes the dot
  }
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tree-name-input';
  input.value = oldName;
  input.spellcheck = false;
  nameSpan.replaceWith(input);
  input.focus();
  // Select the stem only (Explorer behavior: ext stays unselected).
  if (ext && !isDir) {
    input.setSelectionRange(0, stem.length);
  } else {
    input.select();
  }
  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    input.removeEventListener('keydown', onKey);
    input.removeEventListener('blur', commit);
    // No-op rename.
    if (!newName || newName === oldName) {
      input.replaceWith(nameSpan);
      return;
    }
    // Reject names containing path separators or other illegal Windows chars.
    if (/[\\/:*?"<>|]/.test(newName)) {
      toast('Name can\'t contain \\ / : * ? " < > |');
      input.replaceWith(nameSpan);
      return;
    }
    const newPath = dir ? (dir + '\\' + newName) : newName;
    try {
      await invoke('rename_path', { from: path, to: newPath });
      // If the renamed path was the active doc, update its path in place so
      // save/watch keep working without forcing a tab close.
      store.docs.forEach((d) => {
        if (d.path === path) d.path = newPath;
      });
      // Recents: keep them — the next focus-driven re-sync will reconcile.
      refreshTree();
    } catch (e) {
      toast('Rename failed: ' + fmtErr(e));
      input.replaceWith(nameSpan);
    }
  };
  const cancel = () => {
    if (committed) return;
    committed = true;
    input.removeEventListener('keydown', onKey);
    input.removeEventListener('blur', commit);
    input.replaceWith(nameSpan);
  };
  const onKey = (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commit();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      cancel();
    }
  };
  input.addEventListener('keydown', onKey);
  input.addEventListener('blur', commit);
}

// Folder-wide search panel. Singleton — built once on first open, then
// reused. The onOpen callback receives (path, line, query) and routes the
// click through openPathAndJump so the file opens at the right line.
const folderSearch = initFolderSearch((path, line, query) => {
  openPathAndJump(path, line, query);
});

async function openFolderForExplorer() {
  try {
    const dir = await invoke('pick_folder');
    localStorage.setItem('mdpeek-explorer-root', dir);
    setTreeRoot(dir);
    if (el.fileTree.classList.contains('hidden')) toggleExplorer();
    toast('Folder opened: ' + basename(dir));
  } catch (e) {
    if (e !== 'cancelled') toast('Could not open folder: ' + fmtErr(e));
  }
}

function toggleExplorer() {
  const isHidden = el.fileTree.classList.contains('hidden');
  if (isHidden) {
    // First-time open with no root → prompt for a folder.
    const root = localStorage.getItem('mdpeek-explorer-root');
    if (!root) {
      openFolderForExplorer();
      return;
    }
    setTreeRoot(root);
  }
  el.fileTree.classList.toggle('hidden');
  const nowVisible = !el.fileTree.classList.contains('hidden');
  el.explorer.classList.toggle('active', nowVisible);
  localStorage.setItem('mdpeek-explorer-visible', nowVisible ? '1' : '0');
  // Refresh on every show — files may have changed since the last view.
  if (nowVisible) refreshTree();
}

// ---------- word count + reading time (editor status bar) ----------
// Strips markdown syntax then counts words. CJK ideographs count as one word
// each (the standard for mixed CJK/Latin text); Latin words split on
// whitespace. Reading time assumes 200 wpm.
function wordCount(text) {
  const t = (text || '')
    .replace(/```[\s\S]*?```/g, ' ')   // fenced code blocks
    .replace(/`[^`]*`/g, ' ')           // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → keep label text
    .replace(/^#{1,6}\s+/gm, ' ')       // headings
    .replace(/^\s*[-*+]\s+/gm, ' ')     // list markers
    .replace(/^\s*\d+\.\s+/gm, ' ')     // numbered lists
    .replace(/[*_~]+/g, ' ')            // emphasis / strikethrough
    .replace(/<[^>]+>/g, ' ');          // raw HTML tags
  // Latin words = runs of word characters (incl. accented + apostrophes).
  const latin = (t.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || []).length;
  // CJK = each ideograph counts as a word (Hiragana/Katakana/Han/Hangul).
  const cjk = (t.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) || []).length;
  const words = latin + cjk;
  const chars = (text || '').replace(/\s/g, '').length;
  const readMins = words > 0 ? Math.max(1, Math.round(words / 200)) : 0;
  return { words, chars, readMins };
}

function fmtNum(n) {
  return n.toLocaleString();
}

function updateEditorStatus() {
  if (!el.editorStatus || el.editorStatus.classList.contains('hidden')) return;
  const doc = store.active();
  const text = doc && doc.editor ? doc.editor.getValue() : el.editor.value;
  const { words, chars, readMins } = wordCount(text);
  const savedState = doc && doc.dirty ? 'dirty' : 'saved';
  const savedLabel = doc && doc.dirty ? '· edited' : '· saved';
  el.editorStatus.innerHTML =
    `<span>${fmtNum(words)} words</span>` +
    `<span class="status-sep" aria-hidden="true">·</span>` +
    `<span>${fmtNum(chars)} chars</span>` +
    (readMins > 0
      ? `<span class="status-sep" aria-hidden="true">·</span><span>~${readMins} min read</span>`
      : '') +
    `<span class="save-status" data-state="${savedState}" style="margin-left:auto">${savedLabel}</span>`;
}

// ---------- reading progress bar ----------
// Reflects how far the user has scrolled through the active document. Lives at
// the top of the view area. Only shown for markdown docs in view mode — hidden
// for welcome, PDF, Excalidraw, code, and edit mode (the editor has its own
// scroll context).
function updateReadingProgress() {
  if (!el.readingProgress) return;
  const maxScroll = el.document.scrollHeight - el.document.clientHeight;
  const pct = maxScroll > 0 ? (el.document.scrollTop / maxScroll) * 100 : 0;
  el.readingProgress.firstElementChild.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}
function updateActiveTocLink() {
  if (!el.toc || el.toc.classList.contains('collapsed')) return;
  const headings = el.document.querySelectorAll('h1, h2, h3');
  if (headings.length === 0) return;

  const docRect = el.document.getBoundingClientRect();
  let activeHeading = null;

  for (const h of headings) {
    const rect = h.getBoundingClientRect();
    const top = rect.top - docRect.top;
    if (top <= 100) {
      activeHeading = h;
    } else {
      break;
    }
  }

  if (!activeHeading && headings.length > 0) {
    activeHeading = headings[0];
  }

  const links = el.toc.querySelectorAll('a');
  links.forEach((a) => a.classList.remove('active'));

  if (activeHeading && activeHeading.id) {
    const activeLink = el.toc.querySelector(`a[href="#${activeHeading.id}"]`);
    if (activeLink) {
      activeLink.classList.add('active');
      activeLink.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}
function setReadingProgressVisible(visible) {
  if (!el.readingProgress) return;
  el.readingProgress.classList.toggle('active', visible);
  if (visible) {
    updateReadingProgress();
    updateActiveTocLink();
  }
}

// ---------- zoom (scales document + preview font-size) ----------
let zoomLevel = 1; // 1.0 = 100%
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;
// Base font comes from the reading-comfort setting (default 15 = Medium).
// Read fresh inside applyZoom so changing the setting applies without a reload.
function baseFontPx() {
  return parseInt(localStorage.getItem('mdpeek-base-font'), 10) || 15;
}

function applyZoom() {
  const px = (baseFontPx() * zoomLevel).toFixed(1) + 'px';
  el.document.style.fontSize = px;
  el.preview.style.fontSize = px;
  // The editor textarea zooms too, so edit mode tracks the same scale as view.
  if (el.editor) el.editor.style.fontSize = px;
  localStorage.setItem('mdpeek-zoom', String(zoomLevel));
  updateZoomIndicator();
  // If a PDF is active, its pages + text layers + strokes must all re-render
  // at the new scale. Defer a tick so the font-size change settles first.
  if (_activePdf) {
    setTimeout(() => { _activePdf.rerenderAll().catch(() => {}); }, 50);
  }
}

// Live zoom badge in the toolbar — shows the current percentage so the user
// gets immediate feedback that zoom changed. Clicking it resets to 100%.
function updateZoomIndicator() {
  if (!el.zoomIndicator) return;
  const pct = Math.round(zoomLevel * 100);
  el.zoomIndicator.textContent = `${pct}%`;
  // Dim the indicator at the default zoom so it reads as "no change"; brighten
  // when the user has zoomed in or out.
  el.zoomIndicator.classList.toggle('active', Math.abs(zoomLevel - 1) > 0.001);
}

// Reading-comfort: line spacing via a CSS variable (no zoom interaction).
// Called on init and when the settings select changes.
const FONT_STACKS = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", sans-serif',
  inter: '"Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
  helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  verdana: 'Verdana, Geneva, "DejaVu Sans", sans-serif',
  serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
  times: '"Times New Roman", Times, Georgia, serif',
  mono: '"SFMono-Regular", "Cascadia Code", Consolas, "Liberation Mono", monospace',
  cascadia: '"Cascadia Code", "Cascadia Mono", "SFMono-Regular", Consolas, monospace',
};

function applyReadingComfort() {
  const lh = parseFloat(localStorage.getItem('mdpeek-line-height')) || 1.7;
  document.documentElement.style.setProperty('--content-line-height', String(lh));
  const ff = localStorage.getItem('mdpeek-font-family') || 'system';
  const stack = FONT_STACKS[ff] || FONT_STACKS.system;
  document.documentElement.style.setProperty('--content-font-family', stack);
  applyZoom(); // pick up a possibly-changed base font
}

// Show/hide the editor gutter (line numbers). Default on.
function applyLineNumbers() {
  const show = localStorage.getItem('mdpeek-line-numbers') !== '0';
  el.gutter.classList.toggle('hidden', !show);
}

function zoomIn() {
  zoomLevel = Math.min(ZOOM_MAX, +(zoomLevel + ZOOM_STEP).toFixed(2));
  applyZoom();
}

function zoomOut() {
  zoomLevel = Math.max(ZOOM_MIN, +(zoomLevel - ZOOM_STEP).toFixed(2));
  applyZoom();
}

function zoomReset() {
  zoomLevel = 1;
  applyZoom();
}

// ---------- auto-update (perMachine install: UAC will prompt when applying) ----------
// The version button shows: a dot (green = latest, amber = update available,
// grey = checking/error) + the current version label. Click runs a manual check.

let _pendingUpdate = null; // cached update object once detected

function setUpdateStatus(state, versionLabel) {
  const btn = el.update;
  if (!btn) return;
  btn.classList.remove('state-checking', 'state-latest', 'state-update', 'state-error');
  if (state === 'checking') {
    btn.classList.add('state-checking');
    btn.title = 'Checking for updates…';
  } else if (state === 'latest') {
    btn.classList.add('state-latest');
    btn.title = `You're on the latest version (v${versionLabel}). Click to check again.`;
  } else if (state === 'update') {
    btn.classList.add('state-update');
    btn.title = `Update available (v${versionLabel}). Click to install.`;
  } else if (state === 'error') {
    btn.classList.add('state-error');
    btn.title = 'Could not check for updates. Click to retry.';
  }
  if (versionLabel !== undefined) {
    const label = btn.querySelector('.update-label');
    if (label) label.textContent = `v${versionLabel}`;
  }
}

async function applyUpdate(update) {
  toast('Downloading update…');
  try {
    await update.downloadAndInstall();
    toast('Update installed. Relaunching…');
    await relaunch();
  } catch (e) {
    toast('Update failed: ' + fmtErr(e));
  }
}

async function checkForUpdates(silent = false) {
  if (!silent) setUpdateStatus('checking');
  try {
    const update = await check();
    if (update) {
      _pendingUpdate = update;
      setUpdateStatus('update', update.version);
      toast(`Update available: v${update.version}. Click to install.`, {
        persistent: true,
        onClick: () => applyUpdate(update),
      });
    } else {
      const v = await getVersion();
      _pendingUpdate = null;
      setUpdateStatus('latest', v);
      if (!silent) toast(`You're on the latest version (v${v}).`);
    }
  } catch (e) {
    setUpdateStatus('error');
    if (!silent) toast('Update check failed: ' + fmtErr(e));
  }
}

// Clicking the version button: if an update is pending, install it; otherwise
// run a manual (non-silent) check.
el.update.addEventListener('click', () => {
  if (_pendingUpdate) {
    applyUpdate(_pendingUpdate);
  } else {
    checkForUpdates(false);
  }
});

// ---------- events ----------
el.open.addEventListener('click', openFileDialog);
el.save.addEventListener('click', saveActive);
if (el.export) el.export.addEventListener('click', exportHtml);
if (el.exportPdf) el.exportPdf.addEventListener('click', exportPdf);
if (el.present) el.present.addEventListener('click', togglePresentation);
if (el.share) el.share.addEventListener('click', openShareModal);
if (el.shareCopyBtn) el.shareCopyBtn.addEventListener('click', copyShareLink);
if (el.shareCancelBtn) el.shareCancelBtn.addEventListener('click', closeShareModal);
if (el.shareEndBtn) el.shareEndBtn.addEventListener('click', endCollabSession);
if (el.joinConfirmBtn) el.joinConfirmBtn.addEventListener('click', confirmJoin);
if (el.joinCancelBtn) el.joinCancelBtn.addEventListener('click', closeJoinDialog);
if (el.collabStatus) el.collabStatus.addEventListener('click', openShareModal);
if (el.daily) el.daily.addEventListener('click', openDailyNote);

// Slideshow click navigation. Arrow buttons + click-on-stage halves advance
// or retreat (PowerPoint convention). Delegated so it survives rebuilds.
el.slideshow.addEventListener('click', (e) => {
  const arrow = e.target.closest('.slide-arrow');
  if (arrow) {
    if (arrow.classList.contains('prev')) prevSlide();
    else if (arrow.classList.contains('next')) nextSlide();
    return;
  }
  // Click on the stage's left/right half → prev/next. Cheap hit-test.
  const stage = e.target.closest('.slide-stage');
  if (stage) {
    const rect = stage.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width / 2) prevSlide();
    else nextSlide();
  }
});

// Formatting toolbar — one delegated handler covers all .fmt-btn clicks.
// Looks up the active doc's editor and dispatches to its format(type) method.
document.querySelector('.fmt-tools')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.fmt-btn');
  if (!btn) return;
  const doc = store.active();
  if (!doc || !doc.editor || doc.plain) return;
  doc.editor.format(btn.dataset.fmt);
});
el.mode.addEventListener('click', toggleMode);
el.sidebar.addEventListener('click', toggleSidebar);
document.getElementById('btn-back').addEventListener('click', goBack);
document.getElementById('btn-forward').addEventListener('click', goForward);
el.explorer.addEventListener('click', toggleExplorer);
el.fileTreeClose.addEventListener('click', toggleExplorer);
el.fileTreeOpen.addEventListener('click', openFolderForExplorer);
// Toolbar button: open the folder-search panel. Prefers the current explorer
// root; if none is set, prompts the user to pick a folder.
const folderSearchBtn = document.getElementById('btn-folder-search');
if (folderSearchBtn) {
  folderSearchBtn.addEventListener('click', () => {
    const root = localStorage.getItem('mdpeek-explorer-root');
    if (root) {
      folderSearch.open(root);
    } else {
      // No folder open yet — pick one. After picking, open the panel on it.
      invoke('pick_folder')
        .then((dir) => {
          localStorage.setItem('mdpeek-explorer-root', dir);
          setTreeRoot(dir);
          if (el.fileTree.classList.contains('hidden')) toggleExplorer();
          folderSearch.open(dir);
        })
        .catch((e) => {
          if (e !== 'cancelled') toast('Could not open folder: ' + fmtErr(e));
        });
    }
  });
}
el.zoomIn.addEventListener('click', zoomIn);
el.zoomOut.addEventListener('click', zoomOut);
// Clicking the % badge resets to 100% (same as Ctrl+0).
if (el.zoomIndicator) el.zoomIndicator.addEventListener('click', zoomReset);
// ---------- theme dropdown wiring ----------
el.theme.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleThemeMenu();
});
// Item clicks: pick the theme and close.
el.themeMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.theme-item');
  if (!item) return;
  applyTheme(item.dataset.theme);
});
// Click outside / Esc closes the menu (same pattern as the tab context menu).
document.addEventListener('click', (e) => {
  if (!el.themeMenu.classList.contains('hidden') && !e.target.closest('.theme-menu-wrap')) {
    closeThemeMenu();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeThemeMenu();
});

// ---------- settings dialog ----------
// One place to tune every preference. Each control reads/writes a localStorage
// key and applies the change live where possible (theme, find-case). New-tab
// prefs take effect on the next +/Ctrl+N. All controls are wired once.
const SETTING_KEYS = [
  'mdpeek-new-tab-format',
  'mdpeek-new-tab-mode',
  'mdpeek-theme',
  'mdpeek-close-action',
  'mdpeek-find-case',
  'mdpeek-base-font',
  'mdpeek-line-height',
  'mdpeek-line-numbers',
  'mdpeek-font-family',
  'mdpeek-autosave',
  'mdpeek-editor-highlight',
];

function openSettings() {
  syncSettingsControls();
  // Render the bundled CHANGELOG into the Changelog panel. Cheap to redo on
  // every open (renderMarkdown has an LRU cache), and avoids rendering it at
  // app startup when most users never visit this panel.
  const changelogEl = document.getElementById('changelog-content');
  if (changelogEl) changelogEl.innerHTML = renderMarkdown(changelogSource);
  el.settingsDialog.classList.remove('hidden');
  // Always open on the General category for predictability (in case the user
  // switched to another category last time and the .active state persisted).
  const firstCat = el.settingsDialog.querySelector('.settings-cat[data-cat="general"]');
  if (firstCat && !firstCat.classList.contains('active')) firstCat.click();
}
function closeSettings() {
  el.settingsDialog.classList.add('hidden');
}

// Read current pref values from localStorage and reflect them in the modal's
// controls (active states, selected options, checkbox). Called on open and
// after Reset.
function syncSettingsControls() {
  const fmtSel = document.getElementById('settings-new-tab-format');
  if (fmtSel) fmtSel.value = localStorage.getItem('mdpeek-new-tab-format') || 'home';
  const modePref = localStorage.getItem('mdpeek-new-tab-mode') || 'view';
  setSegActive('new-tab-mode', modePref);

  const themeSel = document.getElementById('settings-theme');
  if (themeSel) themeSel.value = localStorage.getItem('mdpeek-theme') || 'light';

  const closeSel = document.getElementById('settings-close-action');
  if (closeSel) closeSel.value = localStorage.getItem('mdpeek-close-action') || 'ask';

  const findCaseCb = document.getElementById('settings-find-case');
  if (findCaseCb) findCaseCb.checked = localStorage.getItem('mdpeek-find-case') === '1';

  const fontSel = document.getElementById('settings-font-size');
  if (fontSel) fontSel.value = String(parseInt(localStorage.getItem('mdpeek-base-font'), 10) || 15);

  const lhSel = document.getElementById('settings-line-height');
  if (lhSel) lhSel.value = String(parseFloat(localStorage.getItem('mdpeek-line-height')) || 1.7);

  const ffSel = document.getElementById('settings-font-family');
  if (ffSel) ffSel.value = localStorage.getItem('mdpeek-font-family') || 'system';

  const lineNumCb = document.getElementById('settings-line-numbers');
  if (lineNumCb) lineNumCb.checked = localStorage.getItem('mdpeek-line-numbers') !== '0';

  const autosaveCb = document.getElementById('settings-autosave');
  if (autosaveCb) autosaveCb.checked = localStorage.getItem('mdpeek-autosave') !== '0';

  const editorHighlightCb = document.getElementById('settings-editor-highlight');
  if (editorHighlightCb) editorHighlightCb.checked = localStorage.getItem('mdpeek-editor-highlight') !== '0';

  // Notes folder display — show the configured path (or "Not set") so users
  // can see where daily notes will land without opening a dialog.
  const notesPath = document.getElementById('settings-notes-path');
  if (notesPath) {
    const dir = localStorage.getItem('mdpeek-notes-dir');
    notesPath.textContent = dir || 'Not set';
    notesPath.classList.toggle('unset', !dir);
  }

  // Windows Explorer context menu setting check (hide on non-Windows)
  const isWindows = navigator.userAgent.includes('Windows') || navigator.platform.indexOf('Win') > -1;
  const ctxRow = document.getElementById('setting-row-context-menu');
  if (ctxRow) {
    if (!isWindows) {
      ctxRow.classList.add('hidden');
    } else {
      ctxRow.classList.remove('hidden');
      invoke('is_context_menu_registered').then((registered) => {
        const ctxCb = document.getElementById('settings-context-menu');
        if (ctxCb) ctxCb.checked = registered;
      }).catch((e) => console.error(e));
    }
  }
}

function setSegActive(setting, value) {
  const seg = el.settingsDialog.querySelector(`.seg[data-setting="${setting}"]`);
  if (!seg) return;
  seg.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.value === value);
  });
}

el.settings.addEventListener('click', () => openSettings());
document.getElementById('settings-done').addEventListener('click', closeSettings);
document.getElementById('settings-reset').addEventListener('click', () => {
  for (const k of SETTING_KEYS) localStorage.removeItem(k);
  // Apply defaults live.
  applyTheme('light');
  if (find) find.setCaseSensitive(false);
  applyReadingComfort();
  applyLineNumbers();
  applyEditorHighlightPref();
  syncSettingsControls();
});

// Click outside the card closes the dialog.
el.settingsDialog.addEventListener('click', (e) => {
  if (e.target === el.settingsDialog) closeSettings();
});
// Esc closes (stopPropagation so it doesn't reach the find bar's Esc handler).
el.settingsDialog.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeSettings();
  }
});

// Category sidebar — clicking a category shows only its panel.
const settingsSidebar = el.settingsDialog.querySelector('.settings-sidebar');
if (settingsSidebar) settingsSidebar.addEventListener('click', (e) => {
  const cat = e.target.closest('.settings-cat');
  if (!cat) return;
  const name = cat.dataset.cat;
  settingsSidebar.querySelectorAll('.settings-cat').forEach((b) => {
    b.classList.toggle('active', b === cat);
  });
  el.settingsDialog.querySelectorAll('.settings-panel').forEach((p) => {
    p.classList.toggle('hidden', p.dataset.cat !== name);
  });
});

// About panel — "View on GitHub" / "Report an issue" buttons open the system
// browser via plugin-opener. Delegated so it survives settings re-opens.
el.settingsDialog.addEventListener('click', (e) => {
  const link = e.target.closest('.about-link[data-href]');
  if (!link) return;
  const href = link.dataset.href;
  if (!href) return;
  openUrl(href).catch((err) => toast('Could not open link: ' + fmtErr(err)));
});

// Segmented control (new-tab-mode). (new-tab-format is now a <select>.)
el.settingsDialog.querySelectorAll('.seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const setting = seg.dataset.setting;
    const value = btn.dataset.value;
    if (setting === 'new-tab-mode') {
      localStorage.setItem('mdpeek-new-tab-mode', value);
    }
    setSegActive(setting, value);
  });
});

// New-tab-format select (Home / Markdown / Plain Text / Excalidraw).
document.getElementById('settings-new-tab-format').addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-new-tab-format', e.target.value);
});

// Theme select — reuses the live applyTheme().
document.getElementById('settings-theme').addEventListener('change', (e) => {
  applyTheme(e.target.value);
});

// Close-action select.
document.getElementById('settings-close-action').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v === 'ask') localStorage.removeItem('mdpeek-close-action');
  else localStorage.setItem('mdpeek-close-action', v);
});

// Find case toggle — updates the live find bar too.
document.getElementById('settings-find-case').addEventListener('change', (e) => {
  if (find) find.setCaseSensitive(e.target.checked);
  else localStorage.setItem('mdpeek-find-case', e.target.checked ? '1' : '0');
});

// Font size — persisted as the base; applyZoom multiplies it by the zoom level.
document.getElementById('settings-font-size').addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-base-font', e.target.value);
  applyReadingComfort();
});

// Line spacing — sets the CSS variable directly (no zoom interaction).
document.getElementById('settings-line-height').addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-line-height', e.target.value);
  applyReadingComfort();
});

// Font family — sets the CSS variable for document text.
document.getElementById('settings-font-family').addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-font-family', e.target.value);
  applyReadingComfort();
});

// Line numbers — toggle the editor gutter visibility.
document.getElementById('settings-line-numbers').addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-line-numbers', e.target.checked ? '1' : '0');
  applyLineNumbers();
});

// Notes folder — re-pick where daily notes are saved.
document.getElementById('settings-notes-pick').addEventListener('click', () => {
  changeNotesFolder();
});

// Auto-save — toggle the debounced save-on-idle behavior.
document.getElementById('settings-autosave').addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-autosave', e.target.checked ? '1' : '0');
  if (!e.target.checked) clearTimeout(_autoSaveTimer);
});

// Editor syntax highlighting — toggle the live overlay on/off without restart.
// Applies immediately to all open edit-mode editors so the user sees the
// change the moment they flip the switch.
document.getElementById('settings-editor-highlight').addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-editor-highlight', e.target.checked ? '1' : '0');
  applyEditorHighlightPref();
});

// Read the editor-highlight pref and push it into every editor instance. Called
// at startup, after the settings toggle flips, and after Reset to defaults.
function applyEditorHighlightPref() {
  const on = localStorage.getItem('mdpeek-editor-highlight') !== '0';
  for (const doc of store.docs) {
    if (doc.editor) doc.editor.setHighlightEnabled(on);
  }
}

// Explorer context menu — toggle Windows right-click options dynamically.
const ctxMenuEl = document.getElementById('settings-context-menu');
if (ctxMenuEl) {
  ctxMenuEl.addEventListener('change', async (e) => {
    const checked = e.target.checked;
    try {
      if (checked) {
        await invoke('register_context_menu');
        toast('Registered in Explorer context menu');
      } else {
        await invoke('unregister_context_menu');
        toast('Removed from Explorer context menu');
      }
    } catch (err) {
      toast('Context menu operation failed: ' + fmtErr(err));
      // Revert checkbox state
      e.target.checked = !checked;
    }
  });
}

// ---------- PDF drawing toolbar ----------
// The toolbar floats over the document when a PDF tab is active. Tools toggle
// draw mode on the active PDF controller; closing exits draw mode.
let _pdfDrawTool = 'pen';   // current tool selection (persists across open/close)
let _pdfDrawColor = '#1d1d1f';

function pdfToggleToolbar() {
  // Show/hide the toolbar — meaningful when a PDF or image is active.
  const doc = store.active();
  if (doc && (doc.pdf || doc.image)) {
    el.pdfDrawToolbar.classList.toggle('hidden');
    // Exiting: turn off draw mode on whichever controller is active.
    if (el.pdfDrawToolbar.classList.contains('hidden')) {
      const target = _activePdf || _activeImage;
      target?.setDrawMode(false);
    }
  }
}

function pdfSelectTool(tool) {
  _pdfDrawTool = tool;
  // Toggle the active class on the tool buttons.
  document.getElementById('pdf-tool-pen').classList.toggle('active', tool === 'pen');
  document.getElementById('pdf-tool-highlighter').classList.toggle('active', tool === 'highlighter');
  document.getElementById('pdf-tool-eraser').classList.toggle('active', tool === 'eraser');
  const target = _activePdf || _activeImage;
  if (target) {
    target.setTool(tool);
    // Entering a tool activates draw mode (unless it's already active).
    target.setDrawMode(true);
  }
}

function pdfSelectColor(color) {
  _pdfDrawColor = color;
  document.querySelectorAll('.pdf-color-swatch').forEach((s) => {
    s.classList.toggle('active', s.dataset.color === color);
  });
  const target = _activePdf || _activeImage;
  if (target) target.setColor(color);
}

document.getElementById('pdf-tool-pen').addEventListener('click', () => pdfSelectTool('pen'));
document.getElementById('pdf-tool-highlighter').addEventListener('click', () => pdfSelectTool('highlighter'));
document.getElementById('pdf-tool-eraser').addEventListener('click', () => pdfSelectTool('eraser'));
document.querySelectorAll('.pdf-color-swatch').forEach((s) => {
  s.addEventListener('click', () => pdfSelectColor(s.dataset.color));
});
document.getElementById('pdf-tool-clear').addEventListener('click', () => {
  const target = _activePdf || _activeImage;
  if (target) target.clearAll();
});
document.getElementById('pdf-tool-close').addEventListener('click', () => {
  el.pdfDrawToolbar.classList.add('hidden');
  document.querySelectorAll('.pdf-tool-btn').forEach((b) => b.classList.remove('active'));
  const target = _activePdf || _activeImage;
  target?.setDrawMode(false);
});
// Save button: writes the annotated image to disk (only meaningful for images).
const annotSaveBtn = document.getElementById('pdf-tool-save');
if (annotSaveBtn) {
  annotSaveBtn.addEventListener('click', async () => {
    if (!_activeImage) return;
    try {
      const path = await _activeImage.saveAnnotations();
      if (path) toast('Saved: ' + basename(path));
    } catch (e) {
      if (e !== 'cancelled') toast('Save failed: ' + fmtErr(e));
    }
  });
}

// The toolbar gear button (btn-draw, shown only on PDF tabs) toggles the draw toolbar.
el.draw.addEventListener('click', () => pdfToggleToolbar());

// The + button now lives outside #tab-strip (in the container) so the tab-strip
// click handler can't catch it. Wire it directly.
const tabNewBtn = document.getElementById('tab-new');
if (tabNewBtn) tabNewBtn.addEventListener('click', () => newTab());

// Link clicks inside rendered markdown: external URLs open in the system
// browser via the opener plugin (the default would navigate the WebView2
// itself, leaving the app). In-document #anchor links still scroll normally.
// Internal markdown links (relative .md paths or wiki-links) open as new tabs
// — resolved relative to the active doc's folder. Ctrl+click forces external
// handling for any link.
// Delegated on document so it covers both #document (view mode) and #preview
// (edit mode) without a per-render listener.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  // Let in-document anchors use the browser's native scroll-to-element.
  if (href.startsWith('#')) return;
  // Route recognized external schemes to the OS handler.
  if (/^(https?:|mailto:|tel:|sms:)/i.test(href)) {
    e.preventDefault();
    openUrl(href).catch((err) => toast('Could not open link: ' + fmtErr(err)));
    return;
  }
  // Ctrl+click on any link forces external handling (open in browser).
  if (e.ctrlKey || e.metaKey) {
    if (/^(https?:|mailto:|tel:|sms:|file:)/i.test(href)) {
      e.preventDefault();
      openUrl(href).catch((err) => toast('Could not open link: ' + fmtErr(err)));
    }
    return;
  }
  // Internal link: resolve relative to the active doc's folder, then open.
  // Strip angle-bracket wrapping that markdown uses for paths with spaces.
  const cleanHref = href.replace(/^<(.+)>$/, '$1');
  if (isInternalDocLink(cleanHref)) {
    e.preventDefault();
    openInternalLink(cleanHref);
  }
});

// A link is "internal" if it isn't an external scheme and ends with a known
// document extension (or has no extension at all, which we treat as a note).
function isInternalDocLink(href) {
  if (!href) return false;
  if (/^(https?:|mailto:|tel:|sms:|file:|data:|javascript:)/i.test(href)) return false;
  return /\.(md|markdown|mdx|txt|pdf|excalidraw)$/i.test(href) || !href.includes('.');
}

// Resolve `href` relative to the active doc's folder and open it as a tab.
// Strips leading `./` and decodes URL-escaped chars (marked encodes spaces
// to %20). Falls back to the wiki-link's filename in the docs folder if the
// active doc has no path yet (untitled tab).
async function openInternalLink(href) {
  const doc = store.active();
  const baseDir = doc && doc.path ? doc.path.replace(/[\\/][^\\/]+$/, '') : null;
  // Decode %20 etc., strip leading ./, normalise separators for Windows.
  let normalized;
  try {
    normalized = decodeURIComponent(href.replace(/^\.\//, ''));
  } catch {
    normalized = href.replace(/^\.\//, '');
  }
  normalized = normalized.replace(/\//g, '\\');
  const fullPath = baseDir ? `${baseDir}\\${normalized}` : normalized;
  try {
    const content = await invoke('read_file', { path: fullPath });
    await openPath(fullPath, content);
  } catch (err) {
    toast('Linked file not found: ' + href);
  }
}

// Welcome-screen action buttons (Open / New / Daily / Clear recents) —
// delegated so they work regardless of when the welcome HTML is (re)rendered.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.welcome-action, .recent-clear');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'open') openFileDialog();
  else if (action === 'new') newTab();
  else if (action === 'daily') openDailyNote();
  else if (action === 'open-folder') openFolderForExplorer();
  else if (action === 'clear-recents') {
    saveRecents([]);
    // Re-render the welcome screen if it's currently visible.
    const welcomeEl = el.document.querySelector('.welcome');
    if (welcomeEl) el.document.innerHTML = renderWelcome();
  }
});

// Recent-file clicks on the welcome screen — delegated so it works regardless
// of when the welcome HTML is (re)rendered. Reads the file from disk and opens
// it; if the file is gone (deleted/moved), removes it from recents + toasts.
document.addEventListener('click', async (e) => {
  const item = e.target.closest('.recent-item');
  if (!item) return;
  const path = item.dataset.path;
  if (!path) return;
  try {
    // PDFs return empty content (the viewer loads via asset protocol); others
    // get their text re-read fresh from disk.
    const content = await invoke('read_file', { path });
    await openPath(path, content);
  } catch (err) {
    removeRecent(path);
    toast('File not found: ' + basename(path));
  }
});

// Refresh the welcome screen when the window regains focus, so relative
// timestamps on the recents list ("5m ago") stay accurate without the user
// having to switch away and back. Cheap no-op when the welcome screen isn't
// currently shown.
window.addEventListener('focus', () => {
  if (el.document.querySelector('.welcome')) {
    el.document.innerHTML = renderWelcome();
  }
});

// Tab strip: click to switch, click × to close.
// The + button lives outside #tab-strip now (in the container) and has its
// own listener above — this handler only covers tab switching + close.
el.tabStrip.addEventListener('click', async (e) => {
  try {
    const closeBtn = e.target.closest('.tab-close');
    if (closeBtn) {
      e.stopPropagation();
      await closeTab(closeBtn.dataset.id);
      return;
    }
    const tab = e.target.closest('.tab');
    if (tab) {
      store.switch(tab.dataset.id);
      const doc = store.active();
      if (doc) await rewatch(doc.path);
    }
  } catch (err) {
    console.error('tab click failed:', err);
  }
});
// Middle-click closes a tab
el.tabStrip.addEventListener('mousedown', (e) => {
  if (e.button !== 1) return;
  const tab = e.target.closest('.tab');
  if (tab) closeTab(tab.dataset.id).catch((e) => console.error('closeTab failed:', e));
});

// Right-click → context menu. Only when the cursor is over an actual tab
// (right-clicking the + button or empty strip area does nothing special).
el.tabStrip.addEventListener('contextmenu', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  e.preventDefault();
  const id = tab.dataset.id;
  const idx = store.docs.findIndex((d) => d.id === id);
  const items = el.ctxMenu.querySelectorAll('.ctx-item');
  // Relabel the pin item to reflect the target tab's current pinned state.
  const target = store.docs.find((d) => d.id === id);
  const isPinned = !!target?.pinned;
  // Disable items that would be no-ops (e.g. "Close others" with only one tab,
  // "Close to the right" when the tab is already the last one, "Close all"
  // when every tab is pinned).
  const onlyTab = store.docs.length === 1;
  const isLast = idx === store.docs.length - 1;
  const allPinned = store.docs.every((d) => d.pinned);
  items.forEach((btn) => {
    const a = btn.dataset.action;
    btn.disabled = false;
    if (a === 'pin') btn.textContent = isPinned ? 'Unpin tab' : 'Pin tab';
    if (a === 'close-others' && (onlyTab || store.docs.filter((d) => d.id !== id && !d.pinned).length === 0)) btn.disabled = true;
    if (a === 'close-right' && (onlyTab || isLast || store.docs.slice(idx + 1).every((d) => d.pinned))) btn.disabled = true;
    if (a === 'close-all' && (onlyTab || allPinned)) btn.disabled = true;
    btn.dataset.tabId = id;
  });
  el.ctxMenu.classList.remove('hidden');
  // Clamp so the menu never overflows the window edge.
  const rect = el.ctxMenu.getBoundingClientRect();
  el.ctxMenu.classList.add('hidden');
  const x = Math.min(e.clientX, window.innerWidth - rect.width - 4);
  const y = Math.min(e.clientY, window.innerHeight - rect.height - 4);
  el.ctxMenu.style.left = x + 'px';
  el.ctxMenu.style.top = y + 'px';
  el.ctxMenu.classList.remove('hidden');
});

// Clicking a menu item runs the action and closes the menu.
el.ctxMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('.ctx-item');
  if (!btn || btn.disabled) return;
  const { action, tabId } = btn.dataset;
  hideCtxMenu();
  ctxAction(action, tabId).catch((e) => console.error('ctxAction failed:', e));
});

// Dismiss the menu on any outside click, Escape, scroll, or tab switch.
window.addEventListener('mousedown', (e) => {
  if (!el.ctxMenu.classList.contains('hidden') && !el.ctxMenu.contains(e.target)) {
    hideCtxMenu();
  }
});
window.addEventListener('blur', hideCtxMenu);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideCtxMenu();
});
el.tabStrip.addEventListener('scroll', hideCtxMenu, { passive: true });

// Translate vertical mouse-wheel into horizontal scroll on the tab strip so
// users with a standard mouse (no trackpad) can scroll through many tabs.
el.tabStrip.addEventListener('wheel', (e) => {
  if (e.deltaY === 0) return;
  const maxScroll = el.tabStrip.scrollWidth - el.tabStrip.clientWidth;
  if (maxScroll <= 0) return;
  e.preventDefault();
  el.tabStrip.scrollLeft += e.deltaY;
}, { passive: false });

// Document scroll: update the reading-progress bar. rAF-throttled so the
// listener stays cheap on long docs.
let _progressRaf = 0;
el.document.addEventListener('scroll', () => {
  if (_progressRaf) return;
  _progressRaf = requestAnimationFrame(() => {
    _progressRaf = 0;
    updateReadingProgress();
    updateActiveTocLink();
  });
}, { passive: true });

// Editor textarea: mark active doc dirty on input + debounced re-persist.
el.editor.addEventListener('input', () => {
  const doc = store.active();
  if (doc) {
    // CRITICAL: sync the textarea's value into doc.content BEFORE markDirty.
    // markDirty emits 'change' on the clean→dirty transition, which re-runs
    // renderActive(); without this sync, renderActive's setValue(doc.content)
    // would overwrite the textarea with stale pre-keystroke content and
    // swallow the user's first character.
    if (doc.editor) doc.content = doc.editor.getValue();
    store.markDirty(doc.id);
  }
  persistSoon();
  updateEditorStatus();
  scheduleAutoSave();
});

// Image paste into the editor. If the clipboard has an image (screenshot,
// copied picture), intercept it and insert as markdown instead of doing
// nothing. Only fires in edit mode (the textarea is hidden otherwise).
el.editor.addEventListener('paste', (e) => {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || doc.plain) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      if (blob) {
        e.preventDefault();
        insertImageFromBlob(blob);
        return;
      }
    }
  }
});

// Image drop onto the editor textarea. The window-level drop handler in
// main.js only handles text/code/pdf files; this catches images specifically
// when the user is editing a markdown doc.
el.editor.addEventListener('drop', (e) => {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || doc.plain) return;
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const img = Array.from(files).find((f) => f.type.startsWith('image/'));
  if (!img) return;
  e.preventDefault();
  e.stopPropagation();
  insertImageFromBlob(img);
}, false);

// ---------- auto-save ----------
// Quietly writes the active doc to disk ~1s after typing stops, but only for
// docs that already have a path (untitled tabs would otherwise pop the
// save-as dialog mid-typing). The status bar shows a subtle "saving…" tick
// so the user can see work is being persisted without toast spam.
let _autoSaveTimer = null;
const AUTO_SAVE_DELAY = 1000;
function autoSaveEnabled() {
  return localStorage.getItem('mdpeek-autosave') !== '0';
}
function scheduleAutoSave() {
  if (!autoSaveEnabled()) return;
  clearTimeout(_autoSaveTimer);
  setSaveStatus('dirty');
  _autoSaveTimer = setTimeout(autoSaveActive, AUTO_SAVE_DELAY);
}
async function autoSaveActive() {
  const doc = store.active();
  if (!doc || !doc.path || !doc.dirty) return;
  setSaveStatus('saving');
  try {
    if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
    await invoke('save_file', { path: doc.path, content: doc.content });
    store.clearDirty(doc.id);
    setSaveStatus('saved');
  } catch (e) {
    setSaveStatus('error');
  }
}
function setSaveStatus(state) {
  if (!el.editorStatus || el.editorStatus.classList.contains('hidden')) return;
  const tag = el.editorStatus.querySelector('.save-status');
  if (!tag) return;
  const map = {
    dirty: '· edited',
    saving: '· saving…',
    saved: '· saved',
    error: '· save failed',
  };
  tag.textContent = map[state] || '';
  tag.dataset.state = state;
}

// Keyboard shortcuts — registered on the CAPTURE phase so we intercept the
// zoom keys before WebView2 can swallow them for native browser zoom.
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'o') {
    e.preventDefault();
    openFileDialog();
  } else if (k === 's') {
    e.preventDefault();
    saveActive();
  } else if (k === 'e') {
    e.preventDefault();
    toggleMode();
  } else if (k === 'n') {
    e.preventDefault();
    newTab();
  } else if (k === 'w') {
    e.preventDefault();
    const d = store.active();
    if (d) closeTab(d.id);
  } else if (k === 'b') {
    e.preventDefault();
    toggleSidebar();
  } else if (k === 'f') {
    e.preventDefault();
    find.toggle();
  } else if (k === 'h') {
    // Ctrl+H = find & replace. No-op in view/PDF mode (find bar handles that).
    e.preventDefault();
    find.openReplace();
  } else if (k === 'g') {
    // Ctrl+G = next, Ctrl+Shift+G = prev (repeat last search even when closed).
    e.preventDefault();
    if (e.shiftKey) find.findPrev();
    else find.findNext();
  } else if (k === '=' || k === '+') {
    e.preventDefault();
    zoomIn();
  } else if (k === '-' || k === '_') {
    e.preventDefault();
    zoomOut();
  } else if (k === '0') {
    e.preventDefault();
    zoomReset();
  }
}, true);

// Tree keyboard shortcuts: Cut / Copy / Paste / Delete / Rename. ONLY fire
// when a tree row was the last thing clicked AND focus isn't in the editor or
// an input — otherwise we'd hijack normal text-editing shortcuts.
window.addEventListener('keydown', (e) => {
  if (_treeActivePath == null) return;
  // Bail if the user is typing in an input/textarea/contenteditable — those
  // own these shortcuts (e.g. Ctrl+C copies selected text, not a tree row).
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
  // Also bail if the explorer panel isn't currently visible.
  if (el.fileTree.classList.contains('hidden')) return;

  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'x') {
    e.preventDefault();
    _treeCtxTarget = { path: _treeActivePath, kind: _treeActiveKind, row: null };
    treeCtxAction('cut').catch((err) => toast('Cut failed: ' + fmtErr(err)));
  } else if (ctrl && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    _treeCtxTarget = { path: _treeActivePath, kind: _treeActiveKind, row: null };
    treeCtxAction('copy').catch((err) => toast('Copy failed: ' + fmtErr(err)));
  } else if (ctrl && e.key.toLowerCase() === 'v') {
    // Paste needs a directory target — use the active row only if it's a dir.
    if (_treeActiveKind !== 'dir') return;
    e.preventDefault();
    _treeCtxTarget = { path: _treeActivePath, kind: _treeActiveKind, row: null };
    treeCtxAction('paste').catch((err) => toast('Paste failed: ' + fmtErr(err)));
  } else if (e.key === 'Delete') {
    e.preventDefault();
    _treeCtxTarget = { path: _treeActivePath, kind: _treeActiveKind, row: null };
    treeCtxAction('delete').catch((err) => toast('Delete failed: ' + fmtErr(err)));
  } else if (e.key === 'F2') {
    e.preventDefault();
    const row = el.fileTreeBody.querySelector(`.tree-row[data-path="${cssEscape(_treeActivePath)}"]`);
    _treeCtxTarget = { path: _treeActivePath, kind: _treeActiveKind, row };
    treeCtxAction('rename').catch((err) => toast('Rename failed: ' + fmtErr(err)));
  }
});

// F3 (no modifier) = repeat last search. Shift+F3 = backward. Capture phase so
// it works regardless of focus, and so WebView2 doesn't swallow it.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'F3') return;
  e.preventDefault();
  if (e.shiftKey) find.findPrev();
  else find.findNext();
}, true);

// F11 = toggle focus/zen mode (hides header + sidebar). Capture phase +
// preventDefault so WebView2 doesn't also fire native fullscreen. Escape exits
// focus mode (handled here, before any other Escape handler can grab it).
window.addEventListener('keydown', (e) => {
  // Presentation-mode shortcuts take over the keyboard entirely while the
  // slideshow is active. We bail out of the rest of the handler after handling
  // one of these so nothing else (editor, find bar, palette) intercepts.
  if (document.body.classList.contains('presenting')) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        e.stopPropagation();
        nextSlide();
        return;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        e.stopPropagation();
        prevSlide();
        return;
      case 'Home':
        e.preventDefault();
        e.stopPropagation();
        goToSlide(0);
        return;
      case 'End':
        e.preventDefault();
        e.stopPropagation();
        if (_slideshow) goToSlide(_slideshow.slides.length - 1);
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        exitPresentation();
        return;
      case 'f':
      case 'F':
        e.preventDefault();
        e.stopPropagation();
        toggleFullscreen();
        return;
      case 's':
      case 'S':
        e.preventDefault();
        e.stopPropagation();
        toggleSlideStyle();
        return;
    }
    // Any other key: swallow it so the editor/find bar don't grab keystrokes
    // while the textarea is hidden behind the slideshow.
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  // Ctrl+Shift+P → command palette. Capture phase so the editor's keydown
  // handler (which intercepts Ctrl+letter combos for markdown shortcuts)
  // can't swallow it.
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
    e.preventDefault();
    e.stopPropagation();
    palette.open();
    return;
  }
  // Ctrl+P → quick switcher (fuzzy-open from recents). Same key as VS Code /
  // Sublime / every browser's print dialog (we preventDefault to suppress that).
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'P' || e.key === 'p')) {
    e.preventDefault();
    e.stopPropagation();
    quickSwitcher.open();
    return;
  }
  // Ctrl+Shift+T → toggle typewriter mode (capture phase so the editor's
  // keydown doesn't swallow it). Note: this overrides the browser's "reopen
  // closed tab" shortcut, which doesn't apply inside the app anyway.
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'T' || e.key === 't')) {
    e.preventDefault();
    e.stopPropagation();
    toggleTypewriter();
    return;
  }
  // Ctrl+Shift+C → copy as rich text (formatted HTML + plain markdown).
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
    e.preventDefault();
    e.stopPropagation();
    copyAsRichText();
    return;
  }
  // Ctrl+Shift+E → toggle the file explorer sidebar.
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
    e.preventDefault();
    e.stopPropagation();
    toggleExplorer();
    return;
  }
  if (e.key === 'F11') {
    e.preventDefault();
    toggleFocus();
    return;
  }
  // Alt+Left / Alt+Right → back / forward doc navigation. Same as a browser.
  if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    goBack();
    return;
  }
  if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault();
    goForward();
    return;
  }
  if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) {
    e.preventDefault();
    e.stopPropagation();
    toggleFocus();
  }
}, true);

// Ctrl+scroll = zoom in/out. Intercept on the capture phase (before the page
// scrolls) and only when Ctrl is held, so plain scrolling still works. This
// matches the browser convention users expect.
window.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  if (e.deltaY < 0) zoomIn();
  else if (e.deltaY > 0) zoomOut();
}, { passive: false, capture: true });

// ---------- Close → minimize to tray, or quit? ----------
// The Rust side intercepts the OS close and emits 'close-requested' instead.
// We show a dialog with two choices + a "remember" checkbox. The saved
// preference bypasses the dialog on future closes.
const TRAY_PREF_KEY = 'mdpeek-close-action'; // 'tray' | 'quit' | null

function doMinimizeToTray() {
  invoke('hide_to_tray').catch((e) => toast('Could not minimize: ' + fmtErr(e)));
}
function doQuitApp() {
  invoke('quit_app').catch((e) => toast('Could not quit: ' + fmtErr(e)));
}

function showCloseDialog() {
  const saved = localStorage.getItem(TRAY_PREF_KEY);
  if (saved === 'tray') {
    doMinimizeToTray();
    return;
  }
  if (saved === 'quit') {
    doQuitApp();
    return;
  }
  // No saved preference → show the dialog.
  el.closeRemember.checked = false;
  el.closeDialog.classList.remove('hidden');
}

function hideCloseDialog() {
  el.closeDialog.classList.add('hidden');
}

function resolveClose(action) {
  if (el.closeRemember.checked) {
    localStorage.setItem(TRAY_PREF_KEY, action);
  }
  hideCloseDialog();
  if (action === 'tray') doMinimizeToTray();
  else doQuitApp();
}

listen('close-requested', () => {
  // Warn before hiding/quitting during a live session: minimizing to tray
  // keeps the session alive (the window is just hidden), but quitting ends
  // it for everyone. Surface that distinction.
  if (collab.getStatus().active) {
    confirmDialog({
      title: 'Leave the collaboration session?',
      text: 'You are currently sharing a document live. Quitting will end the session for everyone. Minimizing to tray keeps it running in the background.',
      buttons: [
        { id: 'cancel', label: 'Stay', kind: 'secondary' },
        { id: 'tray', label: 'Minimize to tray', kind: 'primary' },
        { id: 'quit', label: 'Quit + end session', kind: 'danger' },
      ],
    }).then((choice) => {
      if (choice === 'tray') doMinimizeToTray();
      else if (choice === 'quit') { collab.endSession(); doQuitApp(); }
    }).catch(() => {});
    return;
  }
  showCloseDialog();
}).catch((e) => console.error('close-requested listener failed:', e));

document.getElementById('close-cancel').addEventListener('click', hideCloseDialog);
document.getElementById('close-quit').addEventListener('click', () => resolveClose('quit'));
document.getElementById('close-minimize').addEventListener('click', () => resolveClose('tray'));
// Escape cancels the close (window stays open).
el.closeDialog.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation();
    hideCloseDialog();
  }
});

// ---------- custom window controls (decorations:false) ----------
// Minimize → taskbar (distinct from "hide to tray"). Maximize toggles full/
// restored, with the icon synced via the resize event so Win+Up / snap layouts
// keep the glyph correct. Close reuses the existing tray/quit dialog flow.
const appWindow = getCurrentWindow();
const icoMax = document.querySelector('.win-ico-max');
const icoRestore = document.querySelector('.win-ico-restore');

document.getElementById('win-minimize').addEventListener('click', () => {
  appWindow.minimize().catch((e) => console.error('minimize failed:', e));
});
document.getElementById('win-maximize').addEventListener('click', async () => {
  try { await appWindow.toggleMaximize(); } catch (e) { console.error('toggleMaximize failed:', e); }
});
document.getElementById('win-close').addEventListener('click', () => {
  showCloseDialog();
});
async function syncMaxIcon() {
  let maximized = false;
  try {
    maximized = await appWindow.isMaximized();
  } catch (e) {
    console.error('isMaximized failed:', e);
  }
  if (icoMax) icoMax.classList.toggle('hidden', maximized);
  if (icoRestore) icoRestore.classList.toggle('hidden', !maximized);
}
appWindow.onResized(syncMaxIcon).catch(() => {}); // unlisten only matters on teardown
syncMaxIcon();

// ---------- drag & drop (supports multiple files → multiple tabs) ----------
// On desktop (Tauri), file drops come through the native `tauri://drag-drop`
// event — not HTML5 `drop`. Tauri 2's default config intercepts OS drops at
// the window layer, so `window.addEventListener('drop', ...)` never fires with
// real file paths. Listening to the Tauri events gives us absolute paths
// directly (no fragile `file.path` extension on the File object).
//
// The HTML5 handlers below are kept as a fallback for any environment where
// native events aren't wired (e.g. running the web build in a browser).

// Per-file open shared by both drop paths. Takes an absolute path + the file's
// basename; reads the file via invoke('read_file') so text/code/PDF/Excalidraw
// are all routed through the same openPath logic the Open dialog uses.
const DROP_BINARY_RE = /\.(mp[34]|webm|mov|avi|m4[av]|ogg|wav|flac|zip|7z|rar|tar|gz|bz2|xz|exe|msi|dll|so|dylib|o|obj|a|lib|class|jar|war|pyc|wasm|ttf|otf|woff2?|eot|cab|iso|vhd|vhdx)$/i;
async function openDroppedPath(path) {
  const name = path.split(/[\\/]/).pop() || path;
  try {
    // Images + PDFs are binary but natively supported — skip the binary
    // rejection and load with empty content (the viewers use the asset
    // protocol to read bytes directly).
    const isSupportedBinary = isPdfPath(name) || isImagePath(name);
    if (DROP_BINARY_RE.test(name) && !isSupportedBinary) {
      toast('Not a supported file: ' + name);
      return;
    }
    const content = isSupportedBinary ? '' : await invoke('read_file', { path });
    await openPath(path, content);
  } catch (err) {
    toast('Could not open: ' + name);
    console.error('drop open failed:', err);
  }
}

// Primary path: Tauri native drag-drop events. Payloads carry absolute paths.
listen('tauri://drag-enter', () => {
  el.dropzone.classList.remove('hidden');
}).catch((e) => console.error('drag-enter listener failed:', e));
listen('tauri://drag-leave', () => {
  el.dropzone.classList.add('hidden');
}).catch((e) => console.error('drag-leave listener failed:', e));
listen('tauri://drag-drop', async (event) => {
  el.dropzone.classList.add('hidden');
  const paths = event?.payload?.paths;
  if (!Array.isArray(paths) || paths.length === 0) return;
  for (const p of paths) {
    await openDroppedPath(p);
  }
}).catch((e) => console.error('drag-drop listener failed:', e));

// Fallback path: HTML5 drag/drop. Only fires if Tauri's native handler isn't
// intercepting (e.g. web build). Uses file.text() + file.name — path is best
// effort since the browser doesn't expose absolute paths.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (e.dataTransfer?.types?.includes('Files')) {
    dragDepth++;
    el.dropzone.classList.remove('hidden');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) el.dropzone.classList.add('hidden');
});
window.addEventListener('drop', async (e) => {
  // If Tauri's native handler already ran, dataTransfer.files is empty — bail.
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  e.preventDefault();
  dragDepth = 0;
  el.dropzone.classList.add('hidden');
  for (const file of Array.from(files)) {
    try {
      const isSupportedBinary = isPdfPath(file.name) || isImagePath(file.name);
      if (DROP_BINARY_RE.test(file.name) && !isSupportedBinary) {
        toast('Not a supported file: ' + file.name);
        continue;
      }
      if (isSupportedBinary) {
        await openPath(file.path || file.name, '');
        continue;
      }
      const text = await file.text();
      await openPath(file.path || file.name, text);
    } catch (err) {
      toast('Could not open: ' + file.name);
      console.error('drop open failed:', err);
    }
  }
});

// ---------- live reload (file changed on disk) — update active doc ----------
// listen() returns a promise; if registration fails we log instead of letting
// it reject silently at startup.
listen('file-changed', (event) => {
  const doc = store.active();
  if (!doc || !doc.path) return;
  // PDFs are binary + read-only — the text watcher isn't used for them
  // (openPath skips rewatch), but guard anyway in case an event leaks through.
  if (doc.pdf) return;
  // Code files in view mode: re-render the syntax highlighted view on disk change.
  if (doc.code && doc.mode === 'view') {
    doc.content = event.payload;
    if (store.active()?.id === doc.id) {
      el.document.innerHTML = renderCode(event.payload, langFromPath(doc.path));
    }
    return;
  }
  // CSV/TSV files: re-render the table and re-init the viewer on disk change.
  if (doc.csv) {
    doc.content = event.payload;
    if (store.active()?.id === doc.id) {
      if (_activeCsv) { _activeCsv.destroy(); _activeCsv = null; }
      const tsv = /\.tsv$/i.test(doc.path || '');
      el.document.innerHTML = renderCsv(event.payload, { tsv });
      _activeCsv = initCsvViewer(el.document, parseCsv(event.payload, tsv));
    }
    return;
  }
  doc.content = event.payload;
  if (doc.mode === 'view') {
    const id = doc.id;
    showDocument(el.document, event.payload)
      .then(() => {
        // Bail if the user switched tabs during the (slow) mermaid render —
        // don't write TOC/find state into a now-different active doc.
        if (store.active()?.id !== id) return;
        buildToc(el.document);
        updateActiveTocLink();
        // The re-render wiped any <mark> highlights; re-apply if the find bar
        // is open so the user doesn't see their search disappear.
        if (find) find.refresh();
      })
      .catch((e) => toast('Reload failed: ' + fmtErr(e)));
  } else if (doc.editor) {
    // Don't clobber unsaved edits — if the user is mid-edit, keep their work
    // and notify them instead of silently discarding it.
    if (doc.dirty) {
      toast('File changed on disk — your unsaved edits were kept');
      return;
    }
    doc.editor.setValue(event.payload);
  }
}).catch((e) => console.error('file-changed listener failed:', e));

// Opened via external double-click (cold start: get_initial_file; hot: open-file event)
listen('open-file', (event) => {
  const { path, content, is_dir } = event.payload;
  if (is_dir) {
    localStorage.setItem('mdpeek-explorer-root', path);
    setTreeRoot(path);
    if (el.fileTree.classList.contains('hidden')) toggleExplorer();
  } else {
    openPath(path, content).catch((e) => toast('Open failed: ' + fmtErr(e)));
  }
}).catch((e) => console.error('open-file listener failed:', e));

// Warm-start invite URL: mdpeek was already running when the user clicked a
// mdpeek://join?room=… link. The single-instance plugin emits `open-url`; the
// deep-link plugin also fires onOpenUrl. Listen on both so we cover whatever
// path the OS took. (The two are mutually exclusive in practice — single-
// instance handles warm launches, deep-link handles cases where the scheme
// was invoked without going through single-instance.)
listen('open-url', (event) => {
  const url = typeof event.payload === 'string' ? event.payload : event.payload?.url;
  if (url) handleInviteUrl(url);
}).catch((e) => console.error('open-url listener failed:', e));
onOpenUrl((urls) => {
  for (const u of urls || []) handleInviteUrl(String(u));
}).catch(() => { /* deep-link plugin may be unavailable in dev */ });

window.addEventListener('hljs-language-registered', () => {
  renderActive().catch(() => {});
});

// ---------- init ----------
const savedTheme = localStorage.getItem('mdpeek-theme');
applyTheme(savedTheme && HLJS_FOR_THEME[savedTheme] ? savedTheme : DEFAULT_THEME);

// Restore sidebar state (default visible).
if (localStorage.getItem('mdpeek-sidebar') === 'hidden') {
  el.toc.classList.add('collapsed');
  el.sidebar.classList.remove('active');
}

// Restore focus mode (header + sidebar hidden). Off by default.
if (localStorage.getItem('mdpeek-focus') === '1') {
  document.body.classList.add('focus-mode');
}

// Restore the file explorer (left sidebar). Visible by default if the user
// last left it open AND a root folder was picked.
if (localStorage.getItem('mdpeek-explorer-visible') === '1' && localStorage.getItem('mdpeek-explorer-root')) {
  el.fileTree.classList.remove('hidden');
  el.explorer.classList.add('active');
  setTreeRoot(localStorage.getItem('mdpeek-explorer-root'));
}

// Restore zoom level + reading-comfort prefs (font size, line spacing).
const savedZoom = parseFloat(localStorage.getItem('mdpeek-zoom'));
if (savedZoom >= ZOOM_MIN && savedZoom <= ZOOM_MAX) {
  zoomLevel = savedZoom;
}
applyReadingComfort();
applyLineNumbers();

(async () => {
  try {
    // Restore session, re-reading file contents from disk in PARALLEL (was
    // sequential — N tabs meant N round-trip waits before the UI rendered).
    const session = loadSession();
    if (session && Array.isArray(session.docs) && session.docs.length > 0) {
      const candidates = session.docs.filter((s) => {
        // Skip blank untouched Untitled tabs — restoring an empty tab would hide
        // the welcome screen for no benefit. Pinned tabs survive even when
        // blank (the user explicitly kept them around).
        if (s.path === null && (s.content === '' || s.content == null) && !s.dirty && !s.pinned) {
          return false;
        }
        return true;
      });
      // Read all on-disk files concurrently; untitled tabs pass through as-is.
      const restored = await Promise.all(
        candidates.map(async (s) => {
          if (!s.path) return s; // untitled — content was persisted directly
          // PDFs and images restore from path alone — no content re-read (binary).
          if (isPdfPath(s.path) || isImagePath(s.path)) return { ...s, content: '' };
          try {
            const content = await invoke('read_file', { path: s.path });
            return { ...s, content };
          } catch {
            // File missing since last session — keep last-known content so the
            // user can save-as. Mark path so the tab still shows its name.
            return s;
          }
        }),
      );
      if (restored.length > 0) {
        store.restore({ docs: restored, activeId: session.activeId });
      }
    }

    // Cold-start: did Windows pass a file path on argv?
    try {
      const initial = await invoke('get_initial_file');
      if (initial) {
        if (initial.is_dir) {
          localStorage.setItem('mdpeek-explorer-root', initial.path);
          setTreeRoot(initial.path);
          if (el.fileTree.classList.contains('hidden')) toggleExplorer();
        } else {
          await openPath(initial.path, initial.content);
        }
        return; // get_initial_file already added a tab or opened folder
      }
    } catch {
      /* ignore */
    }

    // Cold-start: was mdpeek launched by clicking a mdpeek:// invite link?
    // (Warm launches are handled by the `open-url` event listener below.)
    try {
      const initialUrl = await invoke('get_initial_url');
      if (initialUrl) {
        await renderActive(); // make sure the window is up before prompting
        handleInviteUrl(initialUrl);
        return;
      }
    } catch {
      /* ignore — deep-link plugin not available */
    }

    // If still no tabs (fresh launch, no session, no argv), show the welcome
    // screen instead of an empty Untitled tab. The welcome hero offers Open /
    // drag-drop / shortcuts — it's a better starting point than a blank page.
    if (store.docs.length === 0) {
      await renderActive();
    } else {
      await renderActive();
      if (store.active()) await rewatch(store.active().path);
    }
  } catch (e) {
    // If ANYTHING in the startup flow throws (corrupt session, render error,
    // module load failure), fall back to the welcome screen instead of leaving
    // the user staring at a blank window ("sometimes it doesn't open").
    console.error('Startup error — falling back to welcome screen:', e);
    store.docs.length = 0;
    store.activeId = null;
    await renderActive();
  }
})();

// Show the current version immediately (before the network check resolves) so
// the button isn't blank during the first few seconds.
getVersion()
  .then((v) => {
    // Only set the label; keep the 'checking' dot until the check completes.
    const label = el.update.querySelector('.update-label');
    if (label) label.textContent = `v${v}`;
  })
  .catch(() => {});

setUpdateStatus('checking');

// Check for updates in the background a few seconds after launch (silent: no
// toast if up-to-date). Delayed so the network call doesn't contend with
// initial render + session restore.
setTimeout(() => checkForUpdates(true), UPDATE_CHECK_DELAY_MS);
