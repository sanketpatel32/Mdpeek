import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { showDocument, buildToc } from './views/viewer.js';
import { initEditor } from './views/editor.js';

// SVG icons for theme toggle (sun = light active, moon = dark active)
const ICON_SUN =
  '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
const ICON_MOON =
  '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';

const WELCOME_HTML = `
  <div class="welcome">
    <img src="/icon.png" alt="mdpeek" class="welcome-logo" />
    <h1>Welcome to mdpeek <span class="version-badge">v0.0.7</span></h1>
    <p>A lightweight Markdown viewer. Open a file to get started, or drop one onto this window.</p>
    <div class="welcome-hints">
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>O</kbd> Open</span>
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>E</kbd> Toggle edit</span>
      <span class="welcome-hint"><kbd>Ctrl</kbd>+<kbd>S</kbd> Save</span>
    </div>
  </div>
`;

const state = {
  path: null,
  content: '',
  mode: 'view', // 'view' | 'edit'
  editor: null,
};

const el = {
  open: document.getElementById('btn-open'),
  save: document.getElementById('btn-save'),
  mode: document.getElementById('btn-mode'),
  theme: document.getElementById('btn-theme'),
  fileName: document.getElementById('file-name'),
  viewMode: document.getElementById('view-mode'),
  editMode: document.getElementById('edit-mode'),
  document: document.getElementById('document'),
  toc: document.getElementById('toc'),
  editor: document.getElementById('editor'),
  preview: document.getElementById('preview'),
  toast: document.getElementById('toast'),
  dropzone: document.getElementById('dropzone'),
};

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

function setFileName(path) {
  el.fileName.textContent = path ? path.split(/[\\/]/).pop() : 'No file';
}

async function loadContent(content, path) {
  state.content = content;
  if (path) {
    state.path = path;
    setFileName(path);
    try {
      await invoke('watch_path', { path });
    } catch {
      /* ignore watcher failures (e.g. file dropped from outside fs) */
    }
  }
  if (state.mode === 'view') {
    el.document.classList.remove('has-welcome');
    await showDocument(el.document, content);
    buildToc(el.document);
  } else if (state.editor) {
    state.editor.setValue(content);
  }
}

async function openFile() {
  try {
    const res = await invoke('open_file');
    await loadContent(res.content, res.path);
  } catch (e) {
    if (e !== 'cancelled') toast('Open failed: ' + e);
  }
}

async function saveFile() {
  const content = state.mode === 'edit' ? state.editor.getValue() : state.content;
  if (!state.path) {
    try {
      const path = await invoke('save_file_as', { content });
      state.path = path;
      setFileName(path);
      toast('Saved');
    } catch (e) {
      if (e !== 'cancelled') toast('Save failed: ' + e);
    }
    return;
  }
  try {
    await invoke('save_file', { path: state.path, content });
    toast('Saved');
  } catch (e) {
    toast('Save failed: ' + e);
  }
}

function setMode(mode) {
  state.mode = mode;
  const labelMode = document.getElementById('label-mode');
  if (mode === 'edit') {
    el.viewMode.classList.add('hidden');
    el.editMode.classList.remove('hidden');
    if (!state.editor) {
      state.editor = initEditor({ textarea: el.editor, preview: el.preview });
    }
    state.editor.setValue(state.content);
    if (labelMode) labelMode.textContent = 'View';
    el.mode.title = 'Switch to view (Ctrl+E)';
  } else {
    el.editMode.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    const current = state.editor ? state.editor.getValue() : state.content;
    showDocument(el.document, current).then(() => buildToc(el.document));
    if (labelMode) labelMode.textContent = 'Edit';
    el.mode.title = 'Switch to edit (Ctrl+E)';
  }
}

function toggleMode() {
  setMode(state.mode === 'view' ? 'edit' : 'view');
}

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

// --- events ---
el.open.addEventListener('click', openFile);
el.save.addEventListener('click', saveFile);
el.mode.addEventListener('click', toggleMode);
el.theme.addEventListener('click', toggleTheme);

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'o') {
    e.preventDefault();
    openFile();
  } else if (k === 's') {
    e.preventDefault();
    saveFile();
  } else if (k === 'e') {
    e.preventDefault();
    toggleMode();
  }
});

// --- drag & drop ---
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
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!/\.(md|markdown|mdx)$/i.test(file.name)) {
    toast('Not a markdown file');
    return;
  }
  const text = await file.text();
  // Tauri exposes the absolute path on the dropped File on desktop.
  await loadContent(text, file.path || file.name);
});

// --- live reload ---
listen('file-changed', (event) => {
  state.content = event.payload;
  if (state.mode === 'view') {
    showDocument(el.document, event.payload).then(() => buildToc(el.document));
  } else if (state.editor) {
    state.editor.setValue(event.payload);
  }
});

// --- launched by opening a .md file (double-click / Open with) ---
// Cold start: frontend pulls any file passed on argv via get_initial_file.
// (Hot second-open case is handled via the open-file event below.)
listen('open-file', (event) => {
  const { path, content } = event.payload;
  loadContent(content, path);
});

// --- auto-update (perMachine install: UAC will prompt when applying) ---
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

// --- init ---
const savedTheme = localStorage.getItem('mdpeek-theme');
if (savedTheme === 'dark') applyTheme('dark');

// If launched by double-clicking a .md (or "Open with"), Windows passed the
// file path as argv[1]. Pull it via the backend (pull-based, no race with
// listener registration).
(async () => {
  try {
    const initial = await invoke('get_initial_file');
    if (initial) {
      await loadContent(initial.content, initial.path);
      return; // document loaded — skip the welcome screen
    }
  } catch {
    /* fall through to welcome */
  }
  // Welcome / empty state — raw hero HTML (not rendered markdown).
  el.document.classList.add('has-welcome');
  el.document.innerHTML = WELCOME_HTML;
})();

// Check for updates in the background 3s after launch (silent: no toast if up-to-date).
setTimeout(() => checkForUpdates(true), 3000);

