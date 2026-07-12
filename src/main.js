import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { openUrl } from '@tauri-apps/plugin-opener';
import { showDocument, buildToc } from './views/viewer.js';
import { initEditor } from './views/editor.js';
import { renderTabs } from './views/tabs.js';
import { DocumentStore } from './lib/documents.js';
import { saveSession, loadSession } from './lib/persistence.js';

// SVG icons for theme toggle (sun = light active, moon = dark active)
const ICON_SUN =
  '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
const ICON_MOON =
  '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';

const WELCOME_HTML = `
  <div class="welcome">
    <img src="/icon.png" alt="mdpeek" class="welcome-logo" />
    <h1>Welcome to mdpeek <span class="version-badge">v0.3.1</span></h1>
    <p>A lightweight Markdown viewer. Open a file to get started, or drop one onto this window.</p>
    <div class="welcome-hints">
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>O</kbd> Open</span>
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>N</kbd> New tab</span>
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>S</kbd> Save</span>
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>E</kbd> Toggle edit</span>
    </div>
  </div>
`;

// Single source of truth: the list of open Documents + active-tab pointer.
const store = new DocumentStore();

const el = {
  open: document.getElementById('btn-open'),
  save: document.getElementById('btn-save'),
  mode: document.getElementById('btn-mode'),
  sidebar: document.getElementById('btn-sidebar'),
  zoomIn: document.getElementById('btn-zoom-in'),
  zoomOut: document.getElementById('btn-zoom-out'),
  theme: document.getElementById('btn-theme'),
  tabStrip: document.getElementById('tab-strip'),
  viewMode: document.getElementById('view-mode'),
  editMode: document.getElementById('edit-mode'),
  document: document.getElementById('document'),
  toc: document.getElementById('toc'),
  editor: document.getElementById('editor'),
  gutter: document.getElementById('gutter'),
  findBar: document.getElementById('find-bar'),
  preview: document.getElementById('preview'),
  toast: document.getElementById('toast'),
  dropzone: document.getElementById('dropzone'),
  ctxMenu: document.getElementById('ctx-menu'),
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

async function renderActive() {
  // Sync the outgoing doc's editor content + caret + scroll back into its model.
  if (_lastRenderedId !== null && _lastRenderedId !== store.activeId) {
    const prev = store.docs.find((d) => d.id === _lastRenderedId);
    if (prev) {
      if (prev.mode === 'edit' && prev.editor) {
        prev.content = prev.editor.getValue();
        prev.editorState = prev.editor.getState();
      } else if (prev.mode === 'view') {
        // Capture the document's scroll so switching back restores it.
        prev.scrollY = el.document.scrollTop;
      }
    }
  }
  _lastRenderedId = store.activeId;

  const doc = store.active();
  renderTabs(store);

  // No doc, or an empty untouched Untitled tab → show the welcome screen
  // (the Open / drag-drop / shortcut hints) instead of a blank page.
  const isEmpty = !doc || (doc.path === null && doc.content === '');
  if (isEmpty) {
    el.editMode.classList.add('hidden');
    el.editMode.classList.remove('plain');
    el.mode.classList.remove('hidden');
    el.viewMode.classList.remove('hidden');
    el.toc.innerHTML = ''; // clear stale TOC from the previous document
    el.document.classList.add('has-welcome');
    el.document.innerHTML = WELCOME_HTML;
    return;
  }

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
        findBar: el.findBar,
      });
    }
    doc.editor.setValue(doc.content);
    // Restore the caret + scroll captured when we last switched away.
    if (doc.editorState) doc.editor.setState(doc.editorState);
  } else {
    el.editMode.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.document.classList.remove('has-welcome');
    await showDocument(el.document, doc.content);
    buildToc(el.document);
    // Restore the document scroll captured when we last switched away.
    if (doc.scrollY) el.document.scrollTop = doc.scrollY;
  }
}

// ---------- persistence ----------
function persist() {
  saveSession(store.serialize());
}
store.on('change', () => {
  renderActive();
  persist();
});

// ---------- open / new / close ----------
async function openPath(path, content) {
  store.open({ path, content });
  await rewatch(path);
}

function newTab() {
  store.open({ path: null, content: '' });
}

async function closeTab(id) {
  const doc = store.docs.find((d) => d.id === id);
  if (!doc) return;
  if (doc.dirty) {
    const choice = confirm(`"${basename(doc.path)}" has unsaved changes. Close anyway?`);
    if (!choice) return;
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
    if (!confirm(`${dirtyCount} ${noun}. Close anyway?`)) return false;
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

// ---------- mode toggle ----------
function toggleMode() {
  const doc = store.active();
  if (!doc) return;
  if (doc.plain) return; // plain-text docs have no preview to toggle to
  // Capture content before switching out of edit mode.
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  doc.mode = doc.mode === 'view' ? 'edit' : 'view';
  renderActive();
}

// ---------- theme ----------
function applyTheme(next) {
  const root = document.documentElement;
  root.dataset.theme = next;
  localStorage.setItem('mdpeek-theme', next);
  document.getElementById('hljs-light').disabled = next === 'dark';
  document.getElementById('hljs-dark').disabled = next !== 'dark';
  const iconTheme = document.getElementById('icon-theme');
  if (iconTheme) iconTheme.innerHTML = next === 'dark' ? ICON_SUN : ICON_MOON;
  el.theme.title = next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

// ---------- sidebar (TOC) toggle ----------
function toggleSidebar() {
  const collapsed = el.toc.classList.toggle('collapsed');
  el.sidebar.classList.toggle('active', !collapsed);
  localStorage.setItem('mdpeek-sidebar', collapsed ? 'hidden' : 'visible');
}

// ---------- zoom (scales document + preview font-size) ----------
let zoomLevel = 1; // 1.0 = 100%
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;
const BASE_FONT_PX = 15;

function applyZoom() {
  const px = (BASE_FONT_PX * zoomLevel).toFixed(1) + 'px';
  el.document.style.fontSize = px;
  el.preview.style.fontSize = px;
  localStorage.setItem('mdpeek-zoom', String(zoomLevel));
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
  try {
    const update = await check();
    if (update) {
      toast(`Update available: v${update.version}. Click to install.`, {
        persistent: true,
        onClick: () => applyUpdate(update),
      });
    } else if (!silent) {
      toast('You are on the latest version.');
    }
  } catch (e) {
    if (!silent) toast('Update check failed: ' + fmtErr(e));
  }
}

// ---------- events ----------
el.open.addEventListener('click', openFileDialog);
el.save.addEventListener('click', saveActive);
el.mode.addEventListener('click', toggleMode);
el.sidebar.addEventListener('click', toggleSidebar);
el.zoomIn.addEventListener('click', zoomIn);
el.zoomOut.addEventListener('click', zoomOut);
el.theme.addEventListener('click', toggleTheme);

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

// Tab strip: click to switch, click × to close, click + for new
el.tabStrip.addEventListener('click', async (e) => {
  const closeBtn = e.target.closest('.tab-close');
  if (closeBtn) {
    e.stopPropagation();
    await closeTab(closeBtn.dataset.id);
    return;
  }
  if (e.target.id === 'tab-new') {
    newTab();
    return;
  }
  const tab = e.target.closest('.tab');
  if (tab) {
    store.switch(tab.dataset.id);
    const doc = store.active();
    if (doc) await rewatch(doc.path);
  }
});
// Middle-click closes a tab
el.tabStrip.addEventListener('mousedown', (e) => {
  if (e.button !== 1) return;
  const tab = e.target.closest('.tab');
  if (tab) closeTab(tab.dataset.id);
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
  ctxAction(action, tabId);
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

// Editor textarea: mark active doc dirty on input
el.editor.addEventListener('input', () => {
  const doc = store.active();
  if (doc) store.markDirty(doc.id);
});

// Keyboard shortcuts
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
  } else if (e.key === '=' || e.key === '+') {
    e.preventDefault();
    zoomIn();
  } else if (e.key === '-') {
    e.preventDefault();
    zoomOut();
  } else if (e.key === '0') {
    e.preventDefault();
    zoomReset();
  }
});

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
    if (!/\.(md|markdown|mdx|txt)$/i.test(file.name)) {
      toast('Not a supported file: ' + file.name);
      continue;
    }
    const text = await file.text();
    // Tauri exposes the absolute path on the dropped File on desktop.
    await openPath(file.path || file.name, text);
  }
});

// ---------- live reload (file changed on disk) — update active doc ----------
// listen() returns a promise; if registration fails we log instead of letting
// it reject silently at startup.
listen('file-changed', (event) => {
  const doc = store.active();
  if (!doc || !doc.path) return;
  doc.content = event.payload;
  if (doc.mode === 'view') {
    showDocument(el.document, event.payload)
      .then(() => buildToc(el.document))
      .catch((e) => toast('Reload failed: ' + fmtErr(e)));
  } else if (doc.editor) {
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
if (savedTheme === 'dark') applyTheme('dark');

// Restore sidebar state (default visible).
if (localStorage.getItem('mdpeek-sidebar') === 'hidden') {
  el.toc.classList.add('collapsed');
  el.sidebar.classList.remove('active');
}

// Restore zoom level.
const savedZoom = parseFloat(localStorage.getItem('mdpeek-zoom'));
if (savedZoom >= ZOOM_MIN && savedZoom <= ZOOM_MAX) {
  zoomLevel = savedZoom;
}
applyZoom();

(async () => {
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
    el.document.innerHTML = WELCOME_HTML;
  } else {
    await renderActive();
    if (store.active()) await rewatch(store.active().path);
  }
})();

// Check for updates in the background a few seconds after launch (silent: no
// toast if up-to-date). Delayed so the network call doesn't contend with
// initial render + session restore.
setTimeout(() => checkForUpdates(true), UPDATE_CHECK_DELAY_MS);
