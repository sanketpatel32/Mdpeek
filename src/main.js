import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { showDocument, buildToc } from './views/viewer.js';
import { initEditor } from './views/editor.js';

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

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.add('hidden'), 2000);
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
  if (mode === 'edit') {
    el.viewMode.classList.add('hidden');
    el.editMode.classList.remove('hidden');
    if (!state.editor) {
      state.editor = initEditor({ textarea: el.editor, preview: el.preview });
    }
    state.editor.setValue(state.content);
    el.mode.textContent = 'Edit';
  } else {
    el.editMode.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    const current = state.editor ? state.editor.getValue() : state.content;
    showDocument(el.document, current).then(() => buildToc(el.document));
    el.mode.textContent = 'View';
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
  el.theme.textContent = next === 'dark' ? '☀' : '☾';
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

// --- init ---
const savedTheme = localStorage.getItem('mdpeek-theme');
if (savedTheme === 'dark') applyTheme('dark');

showDocument(
  el.document,
  '# mdpeek\n\nPress **Ctrl+O** to open a file, or drag one onto this window.\n\nToggle edit with **Ctrl+E**.',
).then(() => buildToc(el.document));
