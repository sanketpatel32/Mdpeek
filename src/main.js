import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
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
    <h1>Welcome to mdpeek <span class="version-badge">v0.0.9</span></h1>
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
  theme: document.getElementById('btn-theme'),
  fileName: document.getElementById('file-name'),
  tabStrip: document.getElementById('tab-strip'),
  viewMode: document.getElementById('view-mode'),
  editMode: document.getElementById('edit-mode'),
  document: document.getElementById('document'),
  toc: document.getElementById('toc'),
  editor: document.getElementById('editor'),
  preview: document.getElementById('preview'),
  toast: document.getElementById('toast'),
  dropzone: document.getElementById('dropzone'),
};

// ---------- helpers ----------
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
    }, 2500);
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
// Tracks the previously-rendered doc so we can sync its editor content back
// into the doc BEFORE swapping to the new active doc (the <textarea> is shared,
// so without this, switching away from an edit-mode tab would lose typed text).
let _lastRenderedId = null;

async function renderActive() {
  // Sync the outgoing doc's editor content back into its model.
  if (_lastRenderedId !== null && _lastRenderedId !== store.activeId) {
    const prev = store.docs.find((d) => d.id === _lastRenderedId);
    if (prev && prev.mode === 'edit' && prev.editor) {
      prev.content = prev.editor.getValue();
    }
  }
  _lastRenderedId = store.activeId;

  const doc = store.active();
  renderTabs(store);
  el.fileName.textContent = doc ? basename(doc.path) : 'No file';

  if (!doc) {
    el.document.classList.add('has-welcome');
    el.document.innerHTML = WELCOME_HTML;
    return;
  }

  const labelMode = document.getElementById('label-mode');
  if (labelMode) labelMode.textContent = doc.mode === 'edit' ? 'View' : 'Edit';

  if (doc.mode === 'edit') {
    el.viewMode.classList.add('hidden');
    el.editMode.classList.remove('hidden');
    if (!doc.editor) {
      doc.editor = initEditor({ textarea: el.editor, preview: el.preview });
    }
    doc.editor.setValue(doc.content);
  } else {
    el.editMode.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.document.classList.remove('has-welcome');
    await showDocument(el.document, doc.content);
    buildToc(el.document);
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

// ---------- file open dialog ----------
async function openFileDialog() {
  try {
    const res = await invoke('open_file');
    await openPath(res.path, res.content);
  } catch (e) {
    if (e !== 'cancelled') toast('Open failed: ' + e);
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
      if (e !== 'cancelled') toast('Save failed: ' + e);
    }
    return;
  }
  try {
    await invoke('save_file', { path: doc.path, content });
    store.clearDirty(doc.id);
    toast('Saved');
  } catch (e) {
    toast('Save failed: ' + e);
  }
}

// ---------- mode toggle ----------
function toggleMode() {
  const doc = store.active();
  if (!doc) return;
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

// ---------- auto-update (perMachine install: UAC will prompt when applying) ----------
async function applyUpdate(update) {
  toast('Downloading update…');
  try {
    await update.downloadAndInstall();
    toast('Update installed — relaunching…');
    await relaunch();
  } catch (e) {
    toast('Update failed: ' + e);
  }
}

async function checkForUpdates(silent = false) {
  try {
    const update = await check();
    if (update) {
      toast(`Update available — v${update.version}. Click to install.`, {
        persistent: true,
        onClick: () => applyUpdate(update),
      });
    } else if (!silent) {
      toast('You are on the latest version.');
    }
  } catch (e) {
    if (!silent) toast('Update check failed: ' + e);
  }
}

// ---------- events ----------
el.open.addEventListener('click', openFileDialog);
el.save.addEventListener('click', saveActive);
el.mode.addEventListener('click', toggleMode);
el.theme.addEventListener('click', toggleTheme);

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
    if (!/\.(md|markdown|mdx)$/i.test(file.name)) {
      toast('Not a markdown file: ' + file.name);
      continue;
    }
    const text = await file.text();
    // Tauri exposes the absolute path on the dropped File on desktop.
    await openPath(file.path || file.name, text);
  }
});

// ---------- live reload (file changed on disk) — update active doc ----------
listen('file-changed', (event) => {
  const doc = store.active();
  if (!doc || !doc.path) return;
  doc.content = event.payload;
  if (doc.mode === 'view') {
    showDocument(el.document, event.payload).then(() => buildToc(el.document));
  } else if (doc.editor) {
    doc.editor.setValue(event.payload);
  }
});

// Opened via external double-click (cold start: get_initial_file; hot: open-file event)
listen('open-file', (event) => {
  const { path, content } = event.payload;
  openPath(path, content);
});

// ---------- init ----------
const savedTheme = localStorage.getItem('mdpeek-theme');
if (savedTheme === 'dark') applyTheme('dark');

(async () => {
  // Restore session, re-reading file contents from disk.
  const session = loadSession();
  if (session && Array.isArray(session.docs) && session.docs.length > 0) {
    const restored = [];
    for (const s of session.docs) {
      if (s.path) {
        try {
          const content = await invoke('read_file', { path: s.path });
          restored.push({ ...s, content });
        } catch {
          // File missing since last session — keep last-known content so the
          // user can save-as. Mark path so the tab still shows its name.
          restored.push(s);
        }
      } else {
        // Untitled tab — content was persisted directly.
        restored.push(s);
      }
    }
    store.restore({ docs: restored, activeId: session.activeId });
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
    el.fileName.textContent = 'No file';
    el.document.classList.add('has-welcome');
    el.document.innerHTML = WELCOME_HTML;
  } else {
    await renderActive();
    if (store.active()) await rewatch(store.active().path);
  }
})();

// Check for updates in the background 3s after launch (silent: no toast if up-to-date).
setTimeout(() => checkForUpdates(true), 3000);
