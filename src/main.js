import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { openUrl } from '@tauri-apps/plugin-opener';
import { showDocument, buildToc } from './views/viewer.js';
import { showPdf } from './views/pdf-viewer.js';
import { showExcalidraw } from './views/excalidraw-viewer.js';
import { initEditor } from './views/editor.js';
import { initFindBar } from './views/find-bar.js';
import { renderTabs } from './views/tabs.js';
import { DocumentStore, isPdfPath, isExcalidrawPath, langFromPath } from './lib/documents.js';
import { renderMarkdown, renderCode, prepareCodeLang } from './lib/renderer.js';
import { saveSession, loadSession, loadRecents, addRecent, removeRecent } from './lib/persistence.js';
import { escapeHtml } from './lib/escape.js';

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
  const recentsHtml = recents.length === 0 ? '' : `
    <section class="recent-files" aria-label="Recent files">
      <div class="recent-title">Recent</div>
      ${recents.map((r) => {
        // Shrink the middle of long paths so the filename stays visible.
        const path = r.path || '';
        const showPath = path.length > 64 ? path.slice(0, 28) + '…' + path.slice(-32) : path;
        return `<button class="recent-item" data-path="${escapeHtml(r.path)}" type="button" title="${escapeHtml(path)}">
          <svg class="recent-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span class="recent-text">
            <span class="recent-name">${escapeHtml(r.name)}</span>
            <span class="recent-path">${escapeHtml(showPath)}</span>
          </span>
        </button>`;
      }).join('')}
    </section>`;
  return `
  <div class="welcome">
    <img src="/icon.png" alt="mdpeek" class="welcome-logo" />
    <h1>Welcome to mdpeek <span class="version-badge">v0.11.4</span></h1>
    <p>A lightweight Markdown viewer. Open a file to get started, or drop one onto this window.</p>
    <div class="welcome-hints">
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>O</kbd> Open</span>
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>N</kbd> New tab</span>
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>S</kbd> Save</span>
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>E</kbd> Toggle edit</span>
      <span class="welcome-hint"><kbd>F11</kbd> Focus mode</span>
    </div>
    ${recentsHtml}
  </div>
`;
}

// Single source of truth: the list of open Documents + active-tab pointer.
const store = new DocumentStore();

const el = {
  open: document.getElementById('btn-open'),
  save: document.getElementById('btn-save'),
  mode: document.getElementById('btn-mode'),
  draw: document.getElementById('btn-draw'),
  sidebar: document.getElementById('btn-sidebar'),
  export: document.getElementById('btn-export'),
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
  ctxMenu: document.getElementById('ctx-menu'),
  closeDialog: document.getElementById('close-dialog'),
  closeRemember: document.getElementById('close-remember'),
  confirmDialog: document.getElementById('confirm-dialog'),
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
    // Hide the draw toolbar when leaving a PDF tab.
    el.pdfDrawToolbar.classList.add('hidden');
    // Reset draw tool button states.
    document.querySelectorAll('.pdf-tool-btn').forEach((b) => b.classList.remove('active'));
  }
  _lastRenderedId = store.activeId;
  const gen = ++_renderGen; // capture this render's generation for async guards

  const doc = store.active();
  renderTabs(store);

  // No doc, or an empty untouched Untitled tab in VIEW mode → show the welcome
  // screen. If the user explicitly switched to edit mode, show the editor even
  // for an empty untitled tab so they can start writing.
  const isEmpty = !doc || (doc.path === null && doc.content === '' && doc.mode === 'view' && !doc.pdf && !doc.excalidraw && !doc.code);
  if (isEmpty) {
    el.editMode.classList.add('hidden');
    el.editMode.classList.remove('plain');
    el.mode.classList.remove('hidden');
    el.export.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.toc.innerHTML = ''; // clear stale TOC from the previous document
    el.document.classList.remove('code-viewer');
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
    el.viewMode.classList.remove('hidden');
    el.toc.innerHTML = '';
    el.document.classList.remove('has-welcome', 'code-viewer', 'markdown-body');
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

  // Excalidraw: full canvas editor, no edit toggle, no TOC.
  if (doc.excalidraw) {
    el.editMode.classList.add('hidden');
    el.mode.classList.add('hidden');
    el.draw.classList.add('hidden');
    el.export.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.toc.innerHTML = '';
    el.document.classList.remove('has-welcome', 'code-viewer', 'markdown-body');
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

  // Code file (non-markdown source): read-only syntax-highlighted view, no
  // edit toggle, no TOC. Uses a dedicated .code-viewer class so it gets
  // monospace styling without inheriting the markdown prose CSS.
  if (doc.code) {
    el.editMode.classList.add('hidden');
    el.editMode.classList.remove('plain');
    el.mode.classList.add('hidden');
    el.draw.classList.add('hidden');
    el.export.classList.add('hidden');
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
        // Re-render once the extra language registers. No scroll restore here:
        // the sync render above already set it, and the re-render swaps
        // identical content at the same height so the browser keeps scroll.
        if (ready && gen === _renderGen && store.active()?.id === doc.id) {
          el.document.innerHTML = renderCode(doc.content, lang);
        }
      }).catch(() => {});
    }
    if (doc.scrollY) el.document.scrollTop = doc.scrollY;
    return;
  }

  // Non-PDF/Excalidraw/code docs: ensure the draw toolbar + button are hidden,
  // and restore the markdown-body class (removed by the code-viewer branch).
  el.pdfDrawToolbar.classList.add('hidden');
  el.draw.classList.add('hidden');
  // Export to HTML only makes sense for real markdown docs (not plain text).
  el.export.classList.toggle('hidden', !!doc.plain);
  el.document.classList.remove('code-viewer');
  el.document.classList.add('markdown-body');

  el.mode.title = doc.mode === 'edit'
    ? 'Editing. Click to view (Ctrl+E)'
    : 'Viewing. Click to edit (Ctrl+E)';
  el.mode.classList.toggle('active', doc.mode === 'edit');
  // Plain-text docs have no markdown preview — hide the toggle and expand the
  // editor to full width.
  el.mode.classList.toggle('hidden', !!doc.plain);
  el.editMode.classList.toggle('plain', !!doc.plain);

  if (doc.mode === 'edit') {
    el.viewMode.classList.add('hidden');
    el.editMode.classList.remove('hidden');
    if (!doc.editor) {
      doc.editor = initEditor({
        textarea: el.editor,
        preview: el.preview,
        gutter: el.gutter,
      });
    }
    doc.editor.setValue(doc.content);
    // Restore the caret + scroll captured when we last switched away.
    if (doc.editorState) doc.editor.setState(doc.editorState);
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
    if (d.code) return 'view'; // code docs render read-only highlighted HTML (same find path as view mode)
    return d.mode;
  },
  getEditor: () => {
    const d = store.active();
    return d && d.editor ? d.editor : null;
  },
  getDocument: () => el.document,
  getPdf: () => _activePdf,
});

store.on('change', () => {
  renderActive().catch((e) => {
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
async function openPath(path, content) {
  store.open({ path, content });
  // Record in the recents list (welcome screen) — only real files, not untitled.
  if (path) addRecent(path);
  // PDFs are read-only binary — no file-watcher (the text-based watcher would
  // choke on bytes, and live-reload isn't meaningful for a PDF).
  // Excalidraw files are JSON but the canvas manages its own state — skip watcher.
  if (!isPdfPath(path) && !isExcalidrawPath(path)) await rewatch(path);
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
  // Always keep at least one tab open.
  if (store.docs.length === 0) {
    newTab();
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
  if (action === 'close') {
    await closeTab(tabId);
  } else if (action === 'close-others') {
    await closeDocs(store.docs.filter((d) => d.id !== tabId).map((d) => d.id));
  } else if (action === 'close-right') {
    await closeDocs(store.docs.slice(idx + 1).map((d) => d.id));
  } else if (action === 'close-all') {
    await closeDocs(store.docs.map((d) => d.id));
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

// ---------- export to self-contained HTML ----------
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
  if (!doc || doc.pdf || doc.excalidraw || doc.code) {
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


function toggleMode() {
  const doc = store.active();
  if (!doc) return;
  if (doc.plain) return; // plain-text docs have no preview to toggle to
  if (doc.pdf) return;   // PDFs are read-only — no edit mode
  if (doc.excalidraw) return; // Excalidraw is always interactive — no edit/view toggle
  if (doc.code) return;  // code files are read-only highlighted views
  // Capture content before switching out of edit mode.
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  doc.mode = doc.mode === 'view' ? 'edit' : 'view';
  if (find) find.close(); // clear highlights/selection before the re-render
  renderActive().catch((e) => console.error('toggleMode render failed:', e));
}

// ---------- theme ----------
function applyTheme(next) {
  if (!HLJS_FOR_THEME[next]) next = DEFAULT_THEME;
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

// ---------- sidebar (TOC) toggle ----------
function toggleSidebar() {
  const collapsed = el.toc.classList.toggle('collapsed');
  el.sidebar.classList.toggle('active', !collapsed);
  localStorage.setItem('mdpeek-sidebar', collapsed ? 'hidden' : 'visible');
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
function setReadingProgressVisible(visible) {
  if (!el.readingProgress) return;
  el.readingProgress.classList.toggle('active', visible);
  if (visible) updateReadingProgress();
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
el.mode.addEventListener('click', toggleMode);
el.sidebar.addEventListener('click', toggleSidebar);
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
];

function openSettings() {
  syncSettingsControls();
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

// Auto-save — toggle the debounced save-on-idle behavior.
document.getElementById('settings-autosave').addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-autosave', e.target.checked ? '1' : '0');
  if (!e.target.checked) clearTimeout(_autoSaveTimer);
});

// ---------- PDF drawing toolbar ----------
// The toolbar floats over the document when a PDF tab is active. Tools toggle
// draw mode on the active PDF controller; closing exits draw mode.
let _pdfDrawTool = 'pen';   // current tool selection (persists across open/close)
let _pdfDrawColor = '#1d1d1f';

function pdfToggleToolbar() {
  // Show/hide the toolbar — only meaningful when a PDF is active.
  const doc = store.active();
  if (doc && doc.pdf) {
    el.pdfDrawToolbar.classList.toggle('hidden');
    // Exiting: turn off draw mode on the controller.
    if (el.pdfDrawToolbar.classList.contains('hidden') && _activePdf) {
      _activePdf.setDrawMode(false);
    }
  }
}

function pdfSelectTool(tool) {
  _pdfDrawTool = tool;
  // Toggle the active class on the tool buttons.
  document.getElementById('pdf-tool-pen').classList.toggle('active', tool === 'pen');
  document.getElementById('pdf-tool-highlighter').classList.toggle('active', tool === 'highlighter');
  document.getElementById('pdf-tool-eraser').classList.toggle('active', tool === 'eraser');
  if (_activePdf) {
    _activePdf.setTool(tool);
    // Entering a tool activates draw mode (unless it's already active).
    _activePdf.setDrawMode(true);
  }
}

function pdfSelectColor(color) {
  _pdfDrawColor = color;
  document.querySelectorAll('.pdf-color-swatch').forEach((s) => {
    s.classList.toggle('active', s.dataset.color === color);
  });
  if (_activePdf) _activePdf.setColor(color);
}

document.getElementById('pdf-tool-pen').addEventListener('click', () => pdfSelectTool('pen'));
document.getElementById('pdf-tool-highlighter').addEventListener('click', () => pdfSelectTool('highlighter'));
document.getElementById('pdf-tool-eraser').addEventListener('click', () => pdfSelectTool('eraser'));
document.querySelectorAll('.pdf-color-swatch').forEach((s) => {
  s.addEventListener('click', () => pdfSelectColor(s.dataset.color));
});
document.getElementById('pdf-tool-clear').addEventListener('click', () => {
  if (_activePdf) _activePdf.clearAll();
});
document.getElementById('pdf-tool-close').addEventListener('click', () => {
  el.pdfDrawToolbar.classList.add('hidden');
  document.querySelectorAll('.pdf-tool-btn').forEach((b) => b.classList.remove('active'));
  if (_activePdf) _activePdf.setDrawMode(false);
});

// The toolbar gear button (btn-draw, shown only on PDF tabs) toggles the draw toolbar.
el.draw.addEventListener('click', () => pdfToggleToolbar());

// The + button now lives outside #tab-strip (in the container) so the tab-strip
// click handler can't catch it. Wire it directly.
const tabNewBtn = document.getElementById('tab-new');
if (tabNewBtn) tabNewBtn.addEventListener('click', () => newTab());

// Link clicks inside rendered markdown: external URLs open in the system
// browser via the opener plugin (the default would navigate the WebView2
// itself, leaving the app). In-document #anchor links still scroll normally.
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
  // Disable items that would be no-ops (e.g. "Close others" with only one tab,
  // "Close to the right" when the tab is already the last one).
  const onlyTab = store.docs.length === 1;
  const isLast = idx === store.docs.length - 1;
  const items = el.ctxMenu.querySelectorAll('.ctx-item');
  items.forEach((btn) => {
    const a = btn.dataset.action;
    btn.disabled = false;
    if (a === 'close-others' && onlyTab) btn.disabled = true;
    if (a === 'close-right' && (onlyTab || isLast)) btn.disabled = true;
    if (a === 'close-all' && onlyTab) btn.disabled = true;
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
  });
}, { passive: true });

// Editor textarea: mark active doc dirty on input + debounced re-persist.
el.editor.addEventListener('input', () => {
  const doc = store.active();
  if (doc) store.markDirty(doc.id);
  persistSoon();
  updateEditorStatus();
  scheduleAutoSave();
});

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
  if (e.key === 'F11') {
    e.preventDefault();
    toggleFocus();
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
  e.preventDefault();
  dragDepth = 0;
  el.dropzone.classList.add('hidden');
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  for (const file of Array.from(files)) {
    try {
      // Accept any text/code/markdown file; reject only known binary types.
      // PDFs + Excalidraw (.excalidraw is JSON but handled by its own viewer)
      // are special-cased below. Anything else binary gets a toast.
      const isBinary = /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|avif|heic|mp[34]|webm|mov|avi|m4[av]|ogg|wav|flac|zip|7z|rar|tar|gz|bz2|xz|exe|msi|dll|so|dylib|o|obj|a|lib|class|jar|war|pyc|wasm|ttf|otf|woff2?|eot|cab|iso|vhd|vhdx)$/i.test(file.name);
      if (isBinary && !isPdfPath(file.name)) {
        toast('Not a text file: ' + file.name);
        continue;
      }
      // PDFs are binary — don't read as text. The PDF viewer loads them via the
      // asset protocol using the file path (Tauri exposes it on desktop).
      if (isPdfPath(file.name)) {
        await openPath(file.path || file.name, '');
        continue;
      }
      const text = await file.text();
      // Tauri exposes the absolute path on the dropped File on desktop.
      await openPath(file.path || file.name, text);
    } catch (err) {
      // One bad file shouldn't block the rest of a multi-file drop.
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
  // Code files are read-only highlighted views — re-render on disk change so
  // the user sees the latest version (e.g. a build log or regenerated config).
  if (doc.code) {
    doc.content = event.payload;
    if (store.active()?.id === doc.id) {
      el.document.innerHTML = renderCode(event.payload, langFromPath(doc.path));
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
  const { path, content } = event.payload;
  openPath(path, content).catch((e) => toast('Open failed: ' + fmtErr(e)));
}).catch((e) => console.error('open-file listener failed:', e));

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
        // the welcome screen for no benefit.
        if (s.path === null && (s.content === '' || s.content == null) && !s.dirty) {
          return false;
        }
        return true;
      });
      // Read all on-disk files concurrently; untitled tabs pass through as-is.
      const restored = await Promise.all(
        candidates.map(async (s) => {
          if (!s.path) return s; // untitled — content was persisted directly
          // PDFs restore from path alone — no content re-read (binary file).
          if (isPdfPath(s.path)) return { ...s, content: '' };
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
        await openPath(initial.path, initial.content);
        return; // get_initial_file already added a tab
      }
    } catch {
      /* ignore */
    }

    // If still no tabs (fresh launch, no session, no argv), show the welcome
    // screen instead of an empty Untitled tab. The welcome hero offers Open /
    // drag-drop / shortcuts — it's a better starting point than a blank page.
    if (store.docs.length === 0) {
      renderTabs(store); // empty tab strip (just the + button)
      el.document.classList.add('has-welcome');
      el.document.innerHTML = renderWelcome();
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
    renderTabs(store);
    el.document.classList.add('has-welcome');
    el.document.innerHTML = renderWelcome();
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
