import './dev-shim.js';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { openUrl } from '@tauri-apps/plugin-opener';
import { showDocument, buildToc } from './views/viewer.js';
import { showImage } from './views/image-viewer.js';
import { initEditor } from './views/editor.js';
import { initFindBar } from './views/find-bar.js';
import { initCommandPalette, initQuickSwitcher, initSnippetPicker } from './views/command-palette.js';
import { initAutocomplete } from './views/autocomplete-dropdown.js';
import { initFileTree, setTreeRoot, refreshTree as refreshFileTree, revealPath } from './views/file-tree.js';
import { initCsvViewer } from './views/csv-viewer.js';
import { initFolderSearch } from './views/folder-search.js';
import { renderTabs } from './views/tabs.js';
import { renderIcons } from './lib/icons.js';
import { toggleTaskLine, taskLineIndex, extractHeadings, buildRelativeImageMarkdown, sortLines, formatTableBlock, sortTableRows, convertList, deriveNoteTitle, convertCase, wrapSelection, wrapBlock, toggleLinePrefix } from './lib/editor-logic.js';
import { EMOJI_MAP } from './lib/emoji.js';
import { saveActiveDoc } from './lib/save-doc.js';
import { SAMPLE_DOC } from './lib/sample-doc.js';
import { getTemplates, saveTemplate } from './lib/templates.js';
import { extractDocLinks, classifyLinks } from './lib/link-checker.js';
import { themeForHour, prefersDarkFromMedia, THEME_MODE_KEY } from './lib/theme-schedule.js';
import { stripMarkdown } from './lib/strip.js';
import { computeStats } from './lib/stats.js';
import { snapshotDoc, pushClosedTab, popClosedTab } from './lib/closed-tabs.js';
import { smartPaste } from './lib/smart-paste.js';
import { initTableEditor } from './views/table-editor.js';
import { parseTable } from './lib/table.js';
import { generateTocMarkdown } from './lib/toc.js';
import { isFeatureOn } from './lib/minimal.js';
import { filterSettingsPanels } from './lib/settings-search.js';
import { initModalFocus, modalOwnsKeyboard, syncModalFocus } from './lib/modal-focus.js';
import { notifyOs, osNotificationsEnabled, setOsNotificationsEnabled } from './lib/notify.js';
// v0.34.1: build-time version for the About + Updates panels. Import is
// hoisted to module top; the value is written into the DOM early (right after
// bootMotion) because the Tauri window code further down aborts module
// execution in browser dev. Kept here with the other imports for clarity.
import pkg from '../package.json' with { type: 'json' };
const BUILD_VERSION = pkg && pkg.version ? pkg.version : null;
import { wireRipples, positionTabIndicator } from './lib/motion.js';
import { countWords } from './lib/dates.js';
import {
  nextWidth, prevWidth, nextFont, prevFont, nextTheme, nextFontFamily,
  readingTimeLabel, loadReaderPrefs,
} from './lib/reading.js';
import { DocumentStore, canSaveDoc, isImagePath, langFromPath } from './lib/documents.js';
import { renderMarkdown, renderCode, renderCsv, parseCsv, prepareCodeLang, enhanceDom } from './lib/renderer.js';
import { saveSession, loadSession, loadRecents, addRecent, removeRecent, saveRecents } from './lib/persistence.js';
import { restoreSessionDocs } from './lib/restore-session.js';
import { applyFileChange } from './lib/file-reload.js';
import { NavHistory } from './lib/nav-history.js';
import { escapeHtml } from './lib/escape.js';
import { getIconForPath, relativeTime } from './lib/file-type.js';
// Vendor CSS bundling (v0.34.0): KaTeX + 6 highlight.js themes bundled locally
// instead of CDN <link> tags in index.html. Works offline; no version skew.
import { installHljsThemes } from './styles/vendors.css.js';
// CHANGELOG.md is bundled at build time as a string via Vite's built-in ?raw
// suffix — no plugin or config needed. Rendered into the Settings → Changelog
// panel on first open (so the running app always shows its own changelog).
import changelogSource from '../CHANGELOG.md?raw';
// GitHub repo URL — single source of truth for the About panel + any other
// links pointing back to the project.
const REPO_URL = 'https://github.com/sanketpatel32/Mdpeek';
const REPO_ISSUES_URL = 'https://github.com/sanketpatel32/Mdpeek/issues';

// Global error handlers for app stability & non-fatal browser warning suppression
window.addEventListener('error', (event) => {
  if (event.message && (event.message.includes('ResizeObserver') || event.message.includes('Script error'))) {
    event.stopImmediatePropagation();
    return;
  }
  console.error('[mdpeek] Unhandled window error:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && String(event.reason).includes('ResizeObserver')) {
    event.stopImmediatePropagation();
    return;
  }
  console.error('[mdpeek] Unhandled promise rejection:', event.reason);
});

// ---------- themes ----------
// Curated set: each entry maps the app theme id to its highlight.js theme id.
// applyTheme() enables exactly one hljs stylesheet so code blocks match.
const HLJS_FOR_THEME = {
  light: 'hljs-light',
  dark: 'hljs-dark',
  'solar-light': 'hljs-solar-light',
  nord: 'hljs-nord',
  oled: 'hljs-dark', // OLED has no native hljs sheet — reuses github-dark.
};
const DEFAULT_THEME = 'light';

// Welcome screen markup — built dynamically so the recent-files list can be
// injected. Called from every place that shows the welcome screen.
// The home desk shares the document workspace's ruled surfaces and controls.
function renderWelcome() {
  const recents = loadRecents();
  const recentsHtml = `
    <section class="recent-files" aria-label="Recent files">
      <div class="recent-header">
        <span class="recent-title">Recent documents</span>
        ${recents.length > 0 ? '<button class="recent-clear" data-action="clear-recents" type="button" title="Clear recent list">Clear</button>' : ''}
      </div>
      ${recents.length === 0 ? `
        <div class="recent-empty">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
          <span>Your next document starts here</span>
          <p class="recent-empty-sub">Open a file to keep it close, or try a sample to explore Markdown.</p>
          <button class="recent-sample" data-action="sample" type="button">Try a sample document</button>
        </div>
      ` : `<div class="recent-list">${recents.map((r) => {
        const path = r.path || '';
        const showPath = path.length > 44 ? path.slice(0, 18) + '…' + path.slice(-22) : path;
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
    <div class="welcome-inner">
      <div class="welcome-hero">
        <span class="brand-mark welcome-brand" aria-hidden="true"></span>
        <h1 class="welcome-title">Room for your next idea.</h1>
        <p class="welcome-tagline">Read beautifully. Write simply. Your notes, documents and ideas, all in one place.</p>
      </div>

      <div class="welcome-actions">
        <button class="welcome-action primary" data-action="open" type="button">
          <span class="wa-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/></svg>
          </span>
          <span class="wa-text">
            <span class="wa-label">Open a document</span>
            <span class="wa-hint">Markdown, PDF, code and more</span>
          </span>
          <kbd>Ctrl+O</kbd>
        </button>
        <button class="welcome-action" data-action="new" type="button">
          <span class="wa-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
          </span>
          <span class="wa-text">
            <span class="wa-label">Start a new note</span>
            <span class="wa-hint">A blank page, ready when you are</span>
          </span>
          <kbd>Ctrl+N</kbd>
        </button>
        ${isFeatureOn('daily') ? `
        <button class="welcome-action" data-action="daily" type="button">
          <span class="wa-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </span>
          <span class="wa-text">
            <span class="wa-label">Today's Note</span>
            <span class="wa-hint">Open or create the daily note</span>
          </span>
        </button>` : ''}
        <button class="welcome-action" data-action="open-folder" type="button">
          <span class="wa-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.69.9H18a2 2 0 0 1 2 2v2"/></svg>
          </span>
          <span class="wa-text">
            <span class="wa-label">Open a folder</span>
            <span class="wa-hint">Bring your files into view</span>
          </span>
        </button>
      </div>

      <div class="welcome-recents">
        ${recentsHtml}
      </div>

      <div class="welcome-footer">
        <span><kbd>Ctrl+Shift+P</kbd> search everything</span>
        <span><kbd>Ctrl+E</kbd> edit/view</span>
        <span><kbd>Ctrl+P</kbd> switch files</span>
        <span class="welcome-drop">drop a file anywhere to open</span>
        <span class="workspace-version">mdpeek v${BUILD_VERSION || ''}</span>
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
  reading: document.getElementById('btn-reading'),
  daily: document.getElementById('btn-daily'),
  explorer: document.getElementById('btn-explorer'),
  fileTree: document.getElementById('file-tree'),
  fileTreeBody: document.getElementById('file-tree-body'),
  fileTreeClose: document.getElementById('file-tree-close'),
  fileTreeOpen: document.getElementById('file-tree-open'),
  zoomIn: document.getElementById('btn-zoom-in'),
  zoomOut: document.getElementById('btn-zoom-out'),
  zoomIndicator: document.getElementById('zoom-indicator'),
  // v0.32.0: theme + update moved into Settings; topbar buttons removed.
  // Theme grid lives in Settings → Appearance; Updates panel in Settings → Updates.
  themeGrid: document.getElementById('theme-grid'),
  settings: document.getElementById('btn-settings'),
  settingsDialog: document.getElementById('settings-dialog'),
  updatesCurrent: document.getElementById('updates-current'),
  updatesBadge: document.getElementById('updates-badge'),
  updatesCheckBtn: document.getElementById('updates-check-btn'),
  updatesInstallRow: document.getElementById('updates-install-row'),
  updatesInstallBtn: document.getElementById('updates-install-btn'),
  updatesReleaseNotes: document.getElementById('updates-release-notes'),
  moreBtn: document.getElementById('btn-more'),
  moreMenu: document.getElementById('more-menu'),
  cmdK: document.getElementById('btn-command-k'),
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
  reader: document.getElementById('reader'),
  readerArticle: document.getElementById('reader-article'),
  readerTitle: document.getElementById('reader-title'),
  readerMeta: document.getElementById('reader-meta'),
  ctxMenu: document.getElementById('ctx-menu'),
  treeCtxMenu: document.getElementById('tree-ctx-menu'),
  closeDialog: document.getElementById('close-dialog'),
  closeRemember: document.getElementById('close-remember'),
  confirmDialog: document.getElementById('confirm-dialog'),
};

// v0.32.0: render lucide icons + wire ripples as early as possible. Called
// here (right after the element cache) so it runs before any Tauri-touching
// code that could abort module execution in the browser dev environment.
// bootMotion() is a hoisted function declaration defined further down; it
// also no-ops gracefully if elements aren't present yet (idempotent, called
// again after full init via DOMContentLoaded below).
bootMotion();
initModalFocus();
// Install the bundled highlight.js <link> elements early (before any Tauri
// code that could abort module execution in the browser dev environment).
// applyTheme() — which runs later at the init section — toggles `disabled` on
// these elements, so they must exist first. Same rationale as bootMotion above.
installHljsThemes();
// v0.34.1: write the build version into the About + Updates panels early.
// MUST run before the Tauri window code (~line 5354: getCurrentWindow()) that
// aborts module execution in browser dev — same bug pattern as bootMotion /
// installHljsThemes above. The `pkg` import is hoisted to module top, so it's
// available here. The runtime getVersion() call (later, Tauri-only) overwrites
// #updates-current with the authoritative value if it resolves.
if (BUILD_VERSION) {
  const aboutVersionEl = document.getElementById('about-version');
  if (aboutVersionEl) aboutVersionEl.textContent = BUILD_VERSION;
  if (el.updatesCurrent) el.updatesCurrent.textContent = `v${BUILD_VERSION}`;
}
document.addEventListener('DOMContentLoaded', bootMotion, { once: true });

// Split pane drag-to-resize handler for Edit Mode
(() => {
  const resizer = document.getElementById('pane-resizer');
  const editMode = el.editMode;
  const editorPane = el.editMode ? el.editMode.querySelector('.editor-pane') : null;
  const previewPane = el.editMode ? el.editMode.querySelector('.preview-pane') : null;

  if (resizer && editMode && editorPane && previewPane) {
    let startX = 0;
    let startEditorW = 0;

    const onMouseMove = (e) => {
      const containerW = editMode.getBoundingClientRect().width;
      const deltaX = e.clientX - startX;
      let newW = startEditorW + deltaX;
      newW = Math.max(150, Math.min(newW, containerW - 150));
      const pct = (newW / containerW) * 100;
      editorPane.style.flex = `0 0 ${pct}%`;
      previewPane.style.flex = `0 0 ${100 - pct}%`;
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    resizer.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      startEditorW = editorPane.getBoundingClientRect().width;
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    });
  }
})();

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

// Render a viewer-load failure into a container using the .viewer-error
// banner. Used by the sync viewer branches in renderActive() so a
// malformed doc
// shows a visible error instead of throwing and rejecting the whole render
// (which would leave the tab blank). `kind` labels the doc type in the message.
function showViewerError(container, kind, e, opts = {}) {
  const raw = fmtErr(e);
  console.error(`viewer load failed (${kind}):`, e);
  container.classList.add('markdown-body');
  // An empty file is not a broken one — a calm neutral message beats a red
  // alert that blames the format.
  if (opts.empty) {
    container.innerHTML =
      `<div class="viewer-error">` +
      `<strong>This ${kind} is empty.</strong><br>` +
      `<span>There is nothing to display yet.</span>` +
      `</div>`;
    return;
  }
  // JS-internal failures (missing Tauri API outside the desktop shell, engine
  // quirks) read as gibberish in the UI — show a plain sentence there and
  // keep the raw detail in the console. Backend errors (e.g. "file not
  // found") stay user-meaningful and pass through.
  const internal =
    /__TAURI_INTERNALS__|is not a function|is not defined|TypeError|ReferenceError|Cannot read/.test(raw);
  const detail = internal ? 'The format may be unsupported, or the file could not be read.' : raw;
  container.innerHTML =
    `<div class="viewer-error">` +
    `<strong>Couldn't open this ${kind}.</strong><br>` +
    `<span>${escapeHtml(detail)}</span>` +
    `</div>`;
}

// v0.51.0: User-facing signal that works when the app is minimized to tray.
// Fires an OS notification (if the user opted in via Settings) AND always shows
// an in-app toast, so the signal is never lost. This is the single chokepoint —
// call this instead of toast() for events a backgrounded user should learn about
// (Pomodoro completion, file-changed-while-unsaved, export done).
function notify(title, body) {
  notifyOs({ title, body }).catch(() => false); // never let this reject
  toast(body ? `${title}: ${body}` : title);
}

function toast(msg, opts = {}) {
  // Auto-detect severity from message content so existing call sites get
  // visual differentiation without each passing a type.
  if (!opts.type) {
    const l = msg.toLowerCase();
    if (/^(saved|copied|exported|inserted|created|deleted|renamed|moved|downloaded|link copied|done|complete|settings reset|imported|cleared|reopened|restored|task restored)/.test(l)) opts.type = 'success';
    else if (/(fail|could not|error|invalid|unable|not found|too large)/.test(l)) opts.type = 'error';
  }
  // Errors stay visible longer — the user needs time to read them.
  const timeout = opts.type === 'error' ? 4500 : TOAST_TIMEOUT_MS;
  // Optional one-shot action button (e.g. "Undo" after a destructive action) —
  // rendered beside the message; clicking it never dismisses mid-run.
  el.toast.textContent = msg;
  el.toast.querySelector('.toast-action')?.remove();
  if (opts.action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = opts.action.label || 'Undo';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearTimeout(toast._t);
      el.toast.classList.add('hidden');
      el.toast.classList.remove('success', 'error', 'warn', 'leaving');
      try { opts.action.run(); } catch (err) { console.error('toast action:', err); }
    });
    el.toast.appendChild(btn);
  }
  el.toast.classList.remove('success', 'error', 'warn', 'leaving');
  if (opts.type) el.toast.classList.add(opts.type);
  el.toast.classList.remove('hidden');
  el.toast.style.cursor = opts.onClick ? 'pointer' : 'default';
  el.toast.onclick = opts.onClick || null;
  clearTimeout(toast._t);
  const dismiss = () => {
    clearTimeout(toast._t);
    el.toast.classList.add('leaving');
    el.toast.onclick = null;
    setTimeout(() => {
      el.toast.classList.add('hidden');
      el.toast.classList.remove('leaving', 'success', 'error', 'warn');
      el.toast.querySelector('.toast-action')?.remove();
    }, 200);
  };
  // Click-to-dismiss when the toast has no action — persistent toasts
  // (previously the only way clear one was waiting out the timer).
  if (!opts.onClick) el.toast.onclick = dismiss;
  if (!opts.persistent) {
    toast._t = setTimeout(dismiss, timeout);
  }
}

function basename(p) {
  return p ? p.split(/[\\/]/).pop() : 'Untitled';
}

// Display title for a doc: filename from the path, or — for untitled notes —
// a title derived from the content (first heading / first line) so tabs, the
// window title and the quick switcher stay meaningful while the user writes
// before saving (they used to all say "Untitled" forever).
function docDisplayName(doc) {
  if (doc && doc.path) return basename(doc.path);
  return deriveNoteTitle(doc ? doc.content : '') || 'Untitled';
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
      syncModalFocus();
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
  try {
    const binary = isImagePath(path);
    await invoke('watch_path', { path: binary ? null : path || null });
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
let _focusedEditor = null;
let _activeImage = null; // controller for the currently-shown annotated image
let _activeCsv = null; // controller for the currently-shown CSV/TSV table
// v0.45.0: stack of recently-closed tab snapshots (newest first) for
// "Reopen closed tab" (Ctrl+Alt+T). Capped at 20 by pushClosedTab.
let _closedTabs = [];

// Toolbar visibility sync — keeps the header uncluttered by hiding buttons
// that have no effect in the current context. Called from every renderActive()
// branch so the rules live in one place. `doc` is null on the welcome screen.
//
// Most buttons (open, explorer, folder-search, daily, zoom, back/forward,
// theme, settings) are global and always shown. The sidebar (TOC) toggle is
// gated separately by syncSidebarVisibility(). This helper only handles the
// doc-specific actions that weren't already toggled inline in each branch.
function syncToolbarForDoc(doc) {
  // Save: editable docs (markdown / plain / code in any mode). Hidden on the
  // welcome screen and for read-only viewers (image / csv).
  el.save.classList.toggle('hidden', !canSaveDoc(doc));
  document.getElementById('btn-save-as').classList.toggle('hidden', !canSaveDoc(doc));
  const markdown = !!doc && !doc.plain && !doc.code && !doc.image && !doc.csv;
  for (const id of ['btn-copy-html', 'btn-copy-plaintext', 'btn-open-browser']) {
    document.getElementById(id)?.classList.toggle('hidden', !markdown);
  }
  const modeLabel = doc?.mode === 'edit' ? 'Preview' : 'Edit';
  el.mode.querySelector('.mode-label').textContent = modeLabel;
  el.mode.setAttribute('aria-label', `Switch to ${modeLabel.toLowerCase()} (Ctrl+E)`);
}

async function renderActive() {
  // Sync the outgoing doc's editor content + caret + scroll back into its model.
  if (_lastRenderedId !== null && _lastRenderedId !== store.activeId) {
    // v0.41.0: dismiss the autocomplete dropdown so it doesn't linger at a
    // stale caret position over the newly-active doc.
    autocomplete.hide();
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
      } else if (prev.mode === 'view') {
        // Capture the document's scroll so switching back restores it.
        prev.scrollY = el.document.scrollTop;
      }
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
    // Hide the draw toolbar when leaving an image tab.
    el.pdfDrawToolbar.classList.add('hidden');
    // Reset draw tool button states.
    document.querySelectorAll('.pdf-tool-btn').forEach((b) => b.classList.remove('active'));
  }
  _lastRenderedId = store.activeId;
  const gen = ++_renderGen; // capture this render's generation for async guards

  const doc = store.active();
  renderTabs(store);
  positionTabIndicator({ strip: el.tabStrip, indicator: el.tabStrip?.querySelector('.tab-indicator') });
  syncSidebarVisibility();
  // Hide toolbar buttons that don't apply to the current doc (e.g. Save on
  // the welcome screen or a read-only PDF/image/csv tab). Per-branch toggles
  // below refine further (draw/export/mode).
  syncToolbarForDoc(doc);
  // v0.68.0: reset the status bar here (it used to linger with stale word
  // counts when switching from an edit-mode tab to PDF/image/etc). The
  // edit-mode branch below re-shows it; canvas branches show their own.
  el.editorStatus.classList.add('hidden');

  // No doc, or an empty untouched Untitled tab in VIEW mode → show the welcome
  // screen. If the user explicitly switched to edit mode, show the editor even
  // for an empty untitled tab so they can start writing.
  const isEmpty = !doc || (doc.path === null && doc.content === '' && doc.mode === 'view' && !doc.code && !doc.csv);
  if (isEmpty) {
    el.editMode.classList.add('hidden');
    el.editMode.classList.remove('plain');
    el.mode.classList.toggle('hidden', !doc);
    el.draw.classList.add('hidden');
    el.export.classList.add('hidden');
    if (el.exportPdf) el.exportPdf.classList.add('hidden');
    if (el.reading) el.reading.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.toc.innerHTML = ''; // clear stale TOC from the previous document
    el.document.classList.remove('code-viewer', 'image-viewer', 'csv-viewer', 'markdown-body');
    el.document.classList.add('has-welcome');
    el.document.innerHTML = renderWelcome();
    setReadingProgressVisible(false);
    return;
  }
  // Image: read-only viewer. Loaded via the asset protocol.
  // Centered on a neutral backdrop so transparent PNGs read clearly; click to
  // toggle actual-size vs. fit-to-window.
  if (doc.image) {
    el.editMode.classList.add('hidden');
    el.mode.classList.add('hidden');
    el.draw.classList.remove('hidden'); // images can be annotated
    el.draw.setAttribute('title', 'Annotate image');
    el.draw.setAttribute('aria-label', 'Annotate image');
    el.export.classList.add('hidden');
    if (el.exportPdf) el.exportPdf.classList.add('hidden');
    if (el.reading) el.reading.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.toc.innerHTML = '';
    el.document.classList.remove('has-welcome', 'code-viewer', 'image-viewer', 'markdown-body');
    el.document.classList.add('image-viewer');
    setReadingProgressVisible(false);
    try {
      _activeImage = showImage(el.document, doc.path);
    } catch (e) {
      console.error('[mdpeek] image viewer load failed:', e);
      showViewerError(el.document, 'image', e);
    }
    if (doc.scrollY) el.document.scrollTop = doc.scrollY;
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
    if (el.reading) el.reading.classList.add('hidden');
    el.pdfDrawToolbar.classList.add('hidden');
    el.viewMode.classList.remove('hidden');
    el.toc.innerHTML = '';
    el.document.classList.remove('has-welcome', 'markdown-body', 'image-viewer', 'code-viewer');
    el.document.classList.add('csv-viewer');
    setReadingProgressVisible(false);
    const tsv = /\.tsv$/i.test(doc.path || '');
    if (!doc.content || !doc.content.trim()) {
      // An empty file is not a broken one — say so calmly.
      showViewerError(el.document, 'CSV/TSV file', null, { empty: true });
    } else {
      try {
        el.document.innerHTML = renderCsv(doc.content, { tsv });
        const parsedRows = parseCsv(doc.content, tsv);
        _activeCsv = initCsvViewer(el.document, parsedRows);
      } catch (e) {
        console.error('[mdpeek] csv viewer load failed:', e);
        showViewerError(el.document, 'CSV/TSV file', e);
      }
    }
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
      if (el.reading) el.reading.classList.add('hidden');
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

  // Text docs (markdown / plain / code-in-edit): ensure the draw toolbar +
  // button are hidden, and restore the markdown-body class (removed by the
  // code-viewer branch).
  el.pdfDrawToolbar.classList.add('hidden');
  el.draw.classList.add('hidden');
  // Export to HTML / Reading mode only make sense for real markdown docs.
  el.export.classList.toggle('hidden', !!doc.plain);
  if (el.exportPdf) el.exportPdf.classList.toggle('hidden', !!doc.plain);
  if (el.reading) el.reading.classList.toggle('hidden', !!doc.plain);
  document.getElementById('btn-copy-html')?.classList.toggle('hidden', !!doc.plain);
  document.getElementById('btn-copy-plaintext')?.classList.toggle('hidden', !!doc.plain);
  document.getElementById('btn-open-browser')?.classList.toggle('hidden', !!doc.plain);
  el.document.classList.remove('has-welcome', 'code-viewer', 'image-viewer');
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
  const isMarkdown = !doc.plain && !doc.code && !doc.csv && !doc.image;
  el.editMode.classList.toggle('plain', !isMarkdown);

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
    if (doc.editorState && doc.editor !== _focusedEditor) doc.editor.setState(doc.editorState);
    // Re-apply typewriter mode to the freshly-bound editor.
    doc.editor.setTypewriter(localStorage.getItem('mdpeek-typewriter') === '1');
    // Keyboard-first: entering edit mode should land the caret in the text.
    // Only when focus wasn't deliberately placed elsewhere (a dialog, the
    // sidebar…). Session restore used to leave focus on <body> so the first
    // keystroke went nowhere.
    if (doc.editor !== _focusedEditor && !document.activeElement?.closest('.modal-overlay:not(.hidden), .palette-overlay:not(.hidden), #find-overlay:not(.hidden)')) doc.editor.focus();
    _focusedEditor = doc.editor;
    el.editorStatus.classList.remove('hidden');
    updateEditorStatus();
    // v0.44.0: restore the editor outline visibility for edit-mode docs.
    if (outlineEl) {
      const want = localStorage.getItem(OUTLINE_KEY) === '1';
      outlineEl.classList.toggle('hidden', !want);
      if (want) rebuildEditorOutline();
    }
    // v0.45.0: restore the stats panel visibility too.
    if (statsEl) {
      const wantStats = localStorage.getItem(STATS_KEY) === '1';
      statsEl.classList.toggle('hidden', !wantStats);
      if (wantStats) rebuildDocStats();
    }
    setReadingProgressVisible(false);
  } else {
    el.editMode.classList.add('hidden');
    el.editorStatus.classList.add('hidden');
    // v0.44.0: editor outline is edit-mode only — hide it in view mode.
    if (outlineEl) outlineEl.classList.add('hidden');
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
    return d ? d.mode : 'view';
  },
  getEditor: () => {
    const d = store.active();
    return d && d.editor ? d.editor : null;
  },
  getDocument: () => el.document,
});

// ---------- command palette ----------
// A flat list of every action the user can launch via Ctrl+Shift+P. Each
// command lazily checks the current state (e.g. no "save" when no doc), so we
// don't need to recompute the list on every open — getCommands() filters at
// call time. Labels are matched fuzzily; keywords give silent ranking boosts.
// v0.49.0: the command list is a named function so both the command palette
// and the "Show keyboard shortcuts" cheat-sheet can read it (the cheat-sheet
// surfaces every command that carries a `hint`).

// v0.52.0: is the caret currently inside a GFM table? Powers the
// "Edit table visually…" palette entry's availability. Cheap + pure (parseTable
// is DOM-free); called per palette open, not per keystroke.
function caretInTable() {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || !doc.editor) return false;
  const { start } = doc.editor.getSelection();
  return !!parseTable(doc.editor.getValue(), start);
}

function getCommands() {
  const cmds = [    { id: 'open', label: 'Open file', hint: 'Ctrl+O', keywords: 'open file load', run: openFileDialog },
    { id: 'open-folder', label: 'Open folder in explorer', keywords: 'open folder explorer tree workspace project', run: openFolderForExplorer },
    { id: 'toggle-explorer', label: 'Toggle file explorer sidebar', hint: 'Ctrl+Shift+E', keywords: 'toggle folder explorer sidebar tree', run: toggleExplorer },
    { id: 'back', label: 'Back', hint: 'Alt+Left', keywords: 'back previous history navigate', run: goBack },
    { id: 'forward', label: 'Forward', hint: 'Alt+Right', keywords: 'forward next history navigate', run: goForward },
    { id: 'quick-switch', label: 'Quick switcher (recent files)', hint: 'Ctrl+P', keywords: 'quick switch recent files open', run: () => quickSwitcher.open() },
    { id: 'new', label: 'New tab', hint: 'Ctrl+N', keywords: 'new tab untitled', run: newTab },
    { id: 'reopen-tab', label: 'Reopen closed tab', hint: 'Ctrl+Alt+T', keywords: 'reopen closed tab recent restore undo', run: reopenClosedTab },
    { id: 'close-others', label: 'Close other tabs', danger: true, keywords: 'close others tabs keep active only', run: () => { const d = store.active(); if (d) ctxAction('close-others', d.id); } },
    { id: 'close-right', label: 'Close tabs to the right', danger: true, keywords: 'close right tabs after', run: () => { const d = store.active(); if (d) ctxAction('close-right', d.id); } },
    { id: 'close-all', label: 'Close all tabs', danger: true, keywords: 'close all tabs every', run: () => ctxAction('close-all', store.active()?.id) },
    { id: 'daily', label: 'Open daily note (today\'s .md)', keywords: 'daily note today date journal', run: openDailyNote },
    { id: 'save', label: 'Save', hint: 'Ctrl+S', keywords: 'save write', run: saveActive },
    { id: 'save-as', label: 'Save as…', hint: 'Ctrl+Alt+S', keywords: 'save as copy write duplicate rename new file', run: saveActiveAs },
    { id: 'export-html', label: 'Export to HTML', keywords: 'export html self-contained', run: exportHtml },
    { id: 'export-txt', label: 'Export to plain text (.txt)', keywords: 'export plain text txt strip markdown', run: exportPlainText },
    { id: 'export-pdf', label: 'Export to PDF', keywords: 'export pdf print document', run: exportPdf },
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
    { id: 'copy-html', label: 'Copy as HTML source', keywords: 'copy html source clipboard paste code cms', run: copyAsHtml },
    { id: 'copy-plaintext', label: 'Copy as plain text', keywords: 'copy plain text strip markdown clipboard paste notepad', run: copyAsPlainText },
    { id: 'open-in-browser', label: 'Open in browser', keywords: 'open browser external launch chrome firefox edge default', run: openInBrowser },
    { id: 'mode', label: 'Toggle edit / view', hint: 'Ctrl+E', keywords: 'toggle edit view mode', run: toggleMode },
    { id: 'goto-line', label: 'Go to line…', hint: 'Ctrl+G', keywords: 'go to line jump navigate number', run: gotoLine },
    { id: 'sort-asc', label: 'Sort lines A→Z', keywords: 'sort lines ascending alpha arrange order', run: () => sortSelection('asc') },
    { id: 'sort-desc', label: 'Sort lines Z→A', keywords: 'sort lines descending reverse arrange order', run: () => sortSelection('desc') },
    { id: 'format-table', label: 'Format table', keywords: 'format table align pipes pad cells markdown tidy', run: formatTable },
    { id: 'edit-table', label: 'Edit table visually…', keywords: 'edit table grid visual rows columns align cells add remove move markdown', run: editTableVisually },
    { id: 'sort-table-asc', label: 'Sort table rows ↑ (by column)', keywords: 'sort table rows column ascending', run: () => sortTable('asc') },
    { id: 'sort-table-desc', label: 'Sort table rows ↓ (by column)', keywords: 'sort table rows column descending', run: () => sortTable('desc') },
    { id: 'convert-list-bullet', label: 'Convert list → bullets', keywords: 'convert list bullet unordered dash asterisk', run: () => convertListSelection('bullet') },
    { id: 'convert-list-ordered', label: 'Convert list → numbered', keywords: 'convert list ordered numbered ol', run: () => convertListSelection('ordered') },
        { id: 'insert-toc', label: 'Insert Table of Contents', keywords: 'insert table of contents toc headings outline markdown', run: insertTocAtCaret },
    { id: 'case-upper', label: 'UPPERCASE selection', keywords: 'convert case upper uppercase capitals', run: () => convertCaseSelection('upper') },
    { id: 'case-lower', label: 'lowercase selection', keywords: 'convert case lower lowercase', run: () => convertCaseSelection('lower') },
    { id: 'case-title', label: 'Title Case selection', keywords: 'convert case title capitalize words', run: () => convertCaseSelection('title') },
    { id: 'case-toggle', label: 'tOGGLE cASE selection', keywords: 'convert case toggle swap invert', run: () => convertCaseSelection('toggle') },
    { id: 'wrap-with', label: 'Wrap with…', keywords: 'wrap surround kbd details code quote block fence', run: () => wrapPicker.open() },
    { id: 'extract-note', label: 'Extract selection to new note', keywords: 'extract selection new note refactor link', run: extractSelectionToNote },
    { id: 'goto-heading', label: 'Go to heading…', keywords: 'go to heading jump navigate outline toc h1 h2', run: () => headingPicker.open() },
    { id: 'editor-outline', label: 'Toggle editor outline', keywords: 'editor outline toc headings panel jump navigate', run: toggleEditorOutline },
    { id: 'fold-toggle', label: 'Toggle fold at caret', keywords: 'fold collapse region section heading editor outline hide', run: foldToggleAtCaret },
    { id: 'unfold-all', label: 'Unfold all', keywords: 'unfold expand all region section heading editor outline show', run: unfoldAll },
    { id: 'doc-stats', label: 'Toggle document statistics', keywords: 'stats statistics words chars sentences paragraphs reading time panel', run: toggleDocStats },
    { id: 'sidebar', label: 'Toggle sidebar (TOC)', hint: 'Ctrl+B', keywords: 'sidebar toc outline', run: toggleSidebar },
    { id: 'find', label: 'Find', hint: 'Ctrl+F', keywords: 'find search', run: () => find.toggle() },
    { id: 'replace', label: 'Find & Replace', hint: 'Ctrl+H', keywords: 'replace substitute find', run: () => find.openReplace() },
    { id: 'focus', label: 'Focus mode', hint: 'F11', keywords: 'focus zen distraction', run: toggleFocus },
    { id: 'reading', label: 'Reading mode', hint: 'Ctrl+Shift+R', keywords: 'reader immersive distraction safari pocket book', run: toggleReading },
    { id: 'typewriter', label: 'Toggle typewriter mode', keywords: 'typewriter center line writing', run: toggleTypewriter },
    { id: 'zoom-in', label: 'Zoom in', hint: 'Ctrl+=', keywords: 'zoom in larger', run: zoomIn },
    { id: 'zoom-out', label: 'Zoom out', hint: 'Ctrl+-', keywords: 'zoom out smaller', run: zoomOut },
    { id: 'zoom-reset', label: 'Reset zoom', hint: 'Ctrl+0', keywords: 'zoom reset 100', run: zoomReset },
    { id: 'theme', label: 'Cycle theme', keywords: 'theme color light dark cycle', run: cycleTheme },
    { id: 'settings', label: 'Open settings', hint: 'Ctrl+,', keywords: 'settings preferences options', run: openSettings },
    { id: 'show-shortcuts', label: 'Show keyboard shortcuts', keywords: 'shortcuts keybindings hotkeys cheat sheet help', run: () => shortcutsPicker.open() },
    { id: 'snippet', label: 'Insert template / snippet', hint: 'Ctrl+Shift+S', keywords: 'snippet template callout table code meeting insert', run: () => snippetPicker.open() },
    { id: 'insert-date', label: 'Insert today\'s date', keywords: 'date time today stamp now insert', run: insertDateAtCursor },
    { id: 'find-in-folder', label: 'Find in folder…', hint: 'Ctrl+Shift+F', keywords: 'find search folder grep workspace content files across project', run: findInFolder },
    { id: 'check-links', label: 'Check links (find broken)', keywords: 'check links broken missing dead validate wiki md', run: checkLinks },
    { id: 'new-from-template', label: 'New from template…', keywords: 'new template create document skeleton starter', run: newFromTemplate },
    { id: 'save-as-template', label: 'Save as template', keywords: 'save template snippet document skeleton starter', run: saveCurrentAsTemplate },
    { id: 'check-updates', label: 'Check for updates', keywords: 'update version check', run: () => checkForUpdates(false) },
    { id: 'quit', label: 'Quit mdpeek', danger: true, keywords: 'quit exit close', run: doQuitApp },
  ];
  // Hide actions that don't make sense in the current state. The palette
  // doesn't need to be exhaustive — it's a power-user shortcut, not a menu.
  const doc = store.active();
  const hasDoc = !!doc;
  return cmds.filter((c) => {
    if ((c.id === 'save' || c.id === 'save-as' || c.id === 'export-html' || c.id === 'export-txt' || c.id === 'export-pdf' || c.id === 'mode' || c.id === 'snippet' || c.id === 'sort-asc' || c.id === 'sort-desc' || c.id === 'copy-html' || c.id === 'copy-plaintext' || c.id === 'open-in-browser' || c.id === 'check-links' || c.id === 'save-as-template' || c.id === 'case-upper' || c.id === 'case-lower' || c.id === 'case-title' || c.id === 'case-toggle' || c.id === 'wrap-with' || c.id === 'edit-table') && !hasDoc) return false;
    if ((c.id === 'save' || c.id === 'save-as') && !canSaveDoc(doc)) return false;
    if (c.id === 'snippet' && !isFeatureOn('snippets')) return false;
    if (c.id === 'daily' && !isFeatureOn('daily')) return false;
    // v0.52.0: visual table editor — feature flag + only when caret is in a table.
    if (c.id === 'edit-table' && !isFeatureOn('table-editor')) return false;
    if (c.id === 'edit-table' && !caretInTable()) return false;
    // v0.55.0: editor region folding — edit-mode only (the editor owns the
    // caret).
    if ((c.id === 'fold-toggle' || c.id === 'unfold-all') && !(doc && doc.mode === 'edit' && doc.editor)) return false;
    return true;
  });
}

const palette = initCommandPalette(getCommands);

// v0.49.0: "Show keyboard shortcuts" cheat-sheet. A read-only picker seeded with
// every command that carries a `hint` (≈22 entries), rendered as label + the
// shortcut chip. Searchable (type "save" → Ctrl+S). onConfirm re-opens the
// palette so the user can run the chosen command — turns the cheat-sheet into a
// two-step launcher (look up the shortcut, then either use it or pick it).
const shortcutsPicker = initQuickSwitcher(
  () => getCommands().filter((c) => c.hint).map((c) => ({ label: c.label, hint: c.hint, keywords: (c.label + ' ' + c.hint + ' ' + (c.keywords || '')) })),
  (_item) => { /* read-only — dismiss; the user looked up the shortcut */ },
  { placeholder: 'Search a shortcut…', ariaLabel: 'Keyboard shortcuts' }
);

// ---------- snippet picker (Ctrl+Shift+S) ----------
const SNIPPET_ITEMS = [
  { label: 'Note Callout', hint: '> [!NOTE]', text: '> [!NOTE]\n> Write your note here.\n\n' },
  { label: 'Tip Callout', hint: '> [!TIP]', text: '> [!TIP]\n> Write your tip here.\n\n' },
  { label: 'Warning Callout', hint: '> [!WARNING]', text: '> [!WARNING]\n> Write your warning here.\n\n' },
  { label: 'Caution Callout', hint: '> [!CAUTION]', text: '> [!CAUTION]\n> Write your caution here.\n\n' },
  { label: 'Important Callout', hint: '> [!IMPORTANT]', text: '> [!IMPORTANT]\n> Write your important detail here.\n\n' },
  { label: 'Table (3x3)', hint: '| Header |', text: '| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell 1 | Cell 2 | Cell 3 |\n| Cell 4 | Cell 5 | Cell 6 |\n\n' },
  { label: 'Task List', hint: '- [ ]', text: '- [ ] First task\n- [ ] Second task\n- [ ] Completed task\n\n' },
  { label: 'Code Block (JS)', hint: '```js', text: '```javascript\nfunction example() {\n  console.log("Hello, world!");\n}\n```\n\n' },
  { label: 'Code Block (Python)', hint: '```python', text: '```python\ndef example():\n    print("Hello, world!")\n```\n\n' },
  { label: 'Math Block (KaTeX)', hint: '$$', text: '$$\nE = mc^2\n$$\n\n' },
  // v0.66.0: getter — the date is computed when the picker opens, not once at
  // app start (the template used to insert a stale date after midnight).
  { label: 'Meeting Notes Template', hint: '# Meeting', get text() { return '# Meeting Notes\n**Date:** ' + new Date().toISOString().slice(0, 10) + '\n**Attendees:** \n\n## Agenda\n1. \n\n## Action Items\n- [ ] \n\n'; } },
];

const snippetPicker = initSnippetPicker(
  () => SNIPPET_ITEMS.map((s) => ({ label: s.label, hint: s.hint, keywords: s.label + ' ' + s.hint, text: s.text })),
  (item) => {
    const doc = store.active();
    if (!doc) return;
    if (doc.mode !== 'edit') {
      doc.mode = 'edit';
      renderActive().then(() => insertSnippetIntoEditor(doc, item.text));
    } else {
      insertSnippetIntoEditor(doc, item.text);
    }
  }
);

// v0.49.0: "Wrap with…" picker. Lists inline/block/line surround options; on
// confirm, applies the chosen wrap to the current selection via
// wrapSelectionApply. Each item carries a `_kind` consumed by the apply helper.
const WRAP_ITEMS = [
  { label: 'Keyboard key', hint: '<kbd>', _kind: 'kbd' },
  { label: 'Collapsible details', hint: '<details>', _kind: 'details' },
  { label: 'Code fence', hint: '```', _kind: 'code' },
  { label: 'Blockquote', hint: '> ', _kind: 'quote' },
];
const wrapPicker = initQuickSwitcher(
  () => WRAP_ITEMS.map((w) => ({ label: w.label, hint: w.hint, keywords: w.label + ' ' + w.hint, _kind: w._kind })),
  (item) => { if (item._kind) wrapSelectionApply(item._kind); },
  { placeholder: 'Choose a wrap style…', ariaLabel: 'Text wrap' }
);

// v0.38.0: jump-to-heading picker. Reads the active doc's source fresh on each
// open (so it stays correct after edits / tab switches), parses ATX headings,
// and on confirm scrolls the caret to the chosen heading's line. Reuses the
// same scrollEditorToLine helper the go-to-line prompt uses. Edit-mode only;
// view mode already has the sidebar TOC for navigation.
const headingPicker = initQuickSwitcher(
  () => {
    const doc = store.active();
    if (!doc || !doc.editor) return [];
    const text = doc.editor.getValue();
    return extractHeadings(text).map((h) => ({
      // Indent by level so nested headings read visually in the list.
      label: '  '.repeat(h.level - 1) + h.text,
      hint: `L${h.line}`,
      keywords: h.text,
      _line: h.line,
    }));
  },
  (item) => {
    const doc = store.active();
    if (!doc || !doc.editor || !item._line) return;
    scrollEditorToLine(doc, item._line);
  },
  { placeholder: 'Jump to heading…', ariaLabel: 'Document outline' }
);

// v0.44.0: Template picker. Lazily populated from getTemplates(localStorage)
// before each open so newly-saved templates show up without a re-init.
const templatePicker = initQuickSwitcher(
  () => getTemplates(localStorage).map((t) => ({
    label: t.name,
    hint: '',
    keywords: t.name + ' ' + t.content.slice(0, 200),
    _content: t.content,
  })),
  (item) => {
    if (!item || typeof item._content !== 'string') return;
    // Open a fresh untitled doc seeded with the template content, in edit mode.
    store.open({ path: null, content: item._content, mode: 'edit' });
  },
  { placeholder: 'Insert a template…', ariaLabel: 'Templates' }
);

// v0.44.0: Broken-link picker (link checker results). Items carry the line
// number; selecting one scrolls the editor there.
const brokenLinkPicker = initQuickSwitcher(
  () => [],
  (item) => {
    if (!item || !item.line) return;
    const doc = store.active();
    if (!doc || !doc.editor) return;
    scrollEditorToLine(doc, item.line);
  },
  { placeholder: 'Broken links in this note…', ariaLabel: 'Link checker' }
);

// v0.51.0: visual table editor (Ctrl+Shift+P → "Edit table visually").
const tableEditor = initTableEditor();

// v0.41.0: editor autocomplete (`:emoji`, `[[wiki`, `#tag`). The dropdown
// view calls getSources(kind, query) async; we dispatch by kind. Emoji is
// synchronous (static map); wiki + tag hit the filesystem and are cached.
let _acFileCache = null;     // { dir, files[] } — invalidated on tree refresh
let _acTagCache = null;      // { at: timestamp, tags[] }
const AC_TAG_TTL_MS = 60_000;

async function acListFiles(dir) {
  if (!dir) return [];
  if (_acFileCache && _acFileCache.dir === dir) return _acFileCache.files;
  try {
    const entries = await invoke('list_dir', { path: dir });
    const files = entries
      .filter((e) => !e.is_dir && /\.(md|markdown|mdx)$/i.test(e.name))
      .map((e) => e.name.replace(/\.(md|markdown|mdx)$/i, ''));
    _acFileCache = { dir, files };
    return files;
  } catch {
    return [];
  }
}

async function acListTags() {
  if (_acTagCache && Date.now() - _acTagCache.at < AC_TAG_TTL_MS) return _acTagCache.tags;
  const root = localStorage.getItem('mdpeek-explorer-root');
  if (!root) return [];
  try {
    const res = await invoke('search_in_folder', { root, query: '#', caseSensitive: false, maxResults: 500 });
    const hits = (res && res.results) || [];
    const tags = new Set();
    for (const h of hits) {
      if (!h.matches) continue;
      for (const m of h.matches) {
        if (!m.text) continue;
        // Pull `#word` tokens out of each matched line.
        const re = /#([\w][\w-]*)/g;
        let mm;
        while ((mm = re.exec(m.text)) !== null) tags.add(mm[1]);
      }
    }
    const list = Array.from(tags).sort();
    _acTagCache = { at: Date.now(), tags: list };
    return list;
  } catch {
    return [];
  }
}

// v0.45.0: GitHub-compatible slug for in-document heading links. Mirrors the
// renderer's slugify (lowercase, strip punctuation, whitespace/underscore →
// hyphen). Used by the heading autocomplete source so the inserted links
// resolve to the rendered headings' ids.
function slugifyHeading(text) {
  const slug = String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug;
}

async function acGetSources(kind /*, query */) {
  if (kind === 'emoji') return { emojis: EMOJI_MAP };
  if (kind === 'wiki') {
    const doc = store.active();
    const dir = doc && doc.path ? doc.path.replace(/[\\/][^\\/]+$/, '') : null;
    const root = localStorage.getItem('mdpeek-explorer-root');
    // Prefer the doc's own folder; fall back to the workspace root.
    const files = await acListFiles(dir || root);
    return { files };
  }
  if (kind === 'tag') return { tags: await acListTags() };
  // v0.45.0: in-document heading links. Source the headings from the active
  // doc's editor (view mode has no editor; fall back to doc.content).
  if (kind === 'heading') {
    const doc = store.active();
    if (!doc) return { headings: [] };
    const text = doc.editor ? doc.editor.getValue() : doc.content || '';
    // extractHeadings returns { level, text, line }; we add a slug for the
    // autocomplete value. Reuse the same slugify the renderer does so the
    // generated links actually resolve.
    const hs = extractHeadings(text).map((h) => ({ slug: slugifyHeading(h.text), text: h.text, depth: h.level }));
    return { headings: hs.filter((h) => h.slug) };
  }
  return {};
}

const autocomplete = initAutocomplete({
  getEditor: () => {
    const doc = store.active();
    return doc && doc.editor ? doc.editor : null;
  },
  getSources: acGetSources,
});

// Tree refreshes (file added/removed/renamed) must drop the autocomplete file
// cache or [[wikilink]] suggestions keep offering stale names.
function refreshTree() {
  _acFileCache = null;
  refreshFileTree();
}

function insertSnippetIntoEditor(doc, textToInsert) {
  if (doc.editor) {
    const sel = doc.editor.getSelection();
    doc.editor.replaceRange(sel.start, sel.end, textToInsert);
  } else {
    doc.content += '\n\n' + textToInsert;
    renderActive().catch((e) => console.error('[mdpeek] snippet append render:', e));
  }
}

// v0.37.0: insert today's date (locale format) at the caret. Edit-mode inserts
// inline; view-mode appends. Mirrors the snippet insert path.
function insertDateAtCursor() {
  const doc = store.active();
  if (!doc || doc.image || doc.csv) {
    toast('Switch to a Markdown document first');
    return;
  }
  const now = new Date();
  const iso = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const locale = now.toLocaleDateString();
  // "2024-07-26 (Jul 26, 2024)" — ISO for sorting + locale for readability.
  insertSnippetIntoEditor(doc, `${iso} (${locale})`);
}

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
      toast('Could not open: ' + item.label);
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
    // v0.49.0: reveal the newly-active file in the tree (expand its ancestors,
    // highlight + scroll it). Fixes a latent bug where tab-switch never updated
    // the tree highlight. Fire-and-forget; revealPath is no-op without a root.
    const d = store.active();
    if (d && d.path) revealPath(d.path);
    rewatch(d?.path);
  } else if (activeId === null) {
    // Last tab closed; reset last-seen so the next open() pushes correctly.
    _lastActiveId = null;
    rewatch(null);
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
  // v0.49.0: Reveal the open file in the explorer sidebar — expand ancestors,
  // highlight, and scroll into view (not just highlight). No-op without a root.
  if (path) revealPath(path);
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
  // Media (audio/video) is read-only and binary — skip it too (v0.49.0).
  if (!isImagePath(path)) await rewatch(path);
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
    if (doc && !doc.code && !doc.csv && !doc.image && doc.mode === 'view' && query) {
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
  scrollEditorToLine(doc, line);
}

// v0.37.0: extracted from applyPendingLine so the go-to-line prompt can reuse
// the exact same caret+scroll math. Edit mode sets the caret on the line and
// scrolls it into the upper third; code-view pixel-scrolls; other doc types
// are a no-op (the caller decides whether to toast).
function scrollEditorToLine(doc, line) {
  if (!doc || line < 1) return false;
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
    return true;
  } else if (doc.code) {
    // Code view: the gutter's <div>s share the <pre>'s line-height. Scroll
    // the document so the target line lands roughly in the upper third.
    const gutterDiv = el.document.querySelector('.code-gutter > div');
    const lineHeight = gutterDiv ? (gutterDiv.getBoundingClientRect().height || 18) : 18;
    el.document.scrollTop = Math.max(0, (line - 1) * lineHeight - el.document.clientHeight / 3);
    return true;
  }
  // CSV / markdown-view / image: no line concept.
  return false;
}

// v0.37.0: Go to line — prompts for a line number and scrolls the caret there.
// Edit mode only (the prompt+setState path needs a real caret); other modes
// get a toast. Uses window.prompt for the simplest UI (no new modal chrome).
function gotoLine() {
  const doc = store.active();
  if (!doc) return;
  if (doc.mode !== 'edit' || !doc.editor) {
    toast('Switch to edit mode to use Go to line');
    return;
  }
  const totalLines = doc.editor.getValue().split('\n').length;
  const raw = window.prompt(`Go to line (1–${totalLines}):`, '');
  if (raw === null) return; // user cancelled
  const line = parseInt(raw, 10);
  if (!Number.isFinite(line) || line < 1) {
    toast('Enter a positive line number');
    return;
  }
  const clamped = Math.min(line, totalLines);
  if (!scrollEditorToLine(doc, clamped)) {
    toast('Could not jump to that line');
  }
}

// v0.42.0: sort the selected line(s) ascending or descending. Whole-doc sort
// when the selection is a caret. Edit-mode only.
function sortSelection(dir) {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || !doc.editor) {
    toast('Switch to edit mode to sort lines');
    return;
  }
  const { start, end } = doc.editor.getSelection();
  const r = sortLines(doc.editor.getValue(), start, end, dir);
  if (r.text === doc.editor.getValue()) return; // no-op (fewer than 2 lines)
  doc.editor.replaceRange(0, doc.editor.getValue().length, r.text);
  doc.editor.setState({ start: r.start, end: r.end });
  if (doc.content !== r.text) {
    doc.content = r.text;
    store.markDirty(doc.id);
    persistSoon();
    scheduleAutoSave();
  }
}

// v0.45.0: format the markdown table the caret is in (align pipes / pad cells).
function formatTable() {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || !doc.editor) { toast('Switch to edit mode to format a table'); return; }
  const { start } = doc.editor.getSelection();
  const r = formatTableBlock(doc.editor.getValue(), start);
  if (!r) { toast('Caret is not in a table'); return; }
  if (r.text === doc.editor.getValue()) return;
  doc.editor.replaceRange(0, doc.editor.getValue().length, r.text);
  doc.editor.setState({ start: r.start, end: r.end });
  doc.content = r.text;
  store.markDirty(doc.id);
  persistSoon();
  scheduleAutoSave();
}

// v0.52.0: open a visual grid editor for the table under the caret. On
// confirm the edited table block replaces just the table's range in the
// source (the surrounding text is untouched), then the doc is marked dirty.
function editTableVisually() {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || !doc.editor) { toast('Switch to edit mode to edit a table'); return; }
  const { start } = doc.editor.getSelection();
  const m = parseTable(doc.editor.getValue(), start);
  if (!m) { toast('Caret is not inside a table'); return; }
  // Capture the block range up front; parseTable owns these offsets, but we
  // pass a clone to the modal so in-place edits can't shift the write-back.
  const startLine = m.startLine;
  const endLine = m.endLine;
  tableEditor.open({
    model: m,
    onApply: (md) => {
      const d = store.active();
      if (!d || !d.editor) return;
      d.editor.replaceRange(startLine, endLine, md);
      d.content = d.editor.getValue();
      store.markDirty(d.id);
      persistSoon();
      scheduleAutoSave();
      toast('Table updated');
    },
  });
}


// v0.45.0: sort the table the caret is in by a column. Prompts for the column
// index (1-based); falls back to the caret's column when blank.
function sortTable(dir) {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || !doc.editor) { toast('Switch to edit mode to sort a table'); return; }
  const { start } = doc.editor.getSelection();
  const input = window.prompt(`Sort table by column number (1-based), blank = caret column — ${dir === 'desc' ? 'descending' : 'ascending'}:`);
  if (input === null) return; // cancelled
  let col = 0;
  if (input.trim() !== '') {
    col = parseInt(input, 10) - 1;
    if (!Number.isFinite(col) || col < 0) { toast('Invalid column number'); return; }
  }
  const r = sortTableRows(doc.editor.getValue(), start, col, dir);
  if (!r) { toast('Caret is not in a table (or table has no body rows)'); return; }
  if (r.text === doc.editor.getValue()) return;
  doc.editor.replaceRange(0, doc.editor.getValue().length, r.text);
  doc.editor.setState({ start: r.start, end: r.end });
  doc.content = r.text;
  store.markDirty(doc.id);
  persistSoon();
  scheduleAutoSave();
}

// v0.46.0: convert the selected line(s) between bullet and ordered list
// markers. `to` is 'bullet' | 'ordered' | 'auto' (auto flips based on the first
// marked line). Mirrors sortSelection's shape.
function convertListSelection(to) {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || !doc.editor) {
    toast('Switch to edit mode to convert a list');
    return;
  }
  const { start, end } = doc.editor.getSelection();
  const r = convertList(doc.editor.getValue(), start, end, to);
  if (r.text === doc.editor.getValue()) return;
  doc.editor.replaceRange(0, doc.editor.getValue().length, r.text);
  doc.editor.setState({ start: r.start, end: r.end });
  if (doc.content !== r.text) {
    doc.content = r.text;
    store.markDirty(doc.id);
    persistSoon();
    scheduleAutoSave();
  }
}

// v0.49.0: convert the case of the selection (or current line for a caret).
// `mode` ∈ 'upper' | 'lower' | 'title' | 'toggle'. Palette-only.

// v0.58.0: Insert a generated Markdown Table of Contents at the current caret.
function insertTocAtCaret() {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || !doc.editor) {
    toast('Switch to edit mode to insert Table of Contents');
    return;
  }
  const currentText = doc.editor.getValue();
  const tocMd = generateTocMarkdown(currentText);
  if (!tocMd) {
    toast('No headings found in document');
    return;
  }
  const { start } = doc.editor.getSelection();
  doc.editor.replaceRange(start, start, tocMd);
  doc.content = doc.editor.getValue();
  store.markDirty(doc.id);
  persistSoon();
  scheduleAutoSave();
  toast('Table of Contents inserted');
}

function convertCaseSelection(mode) {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || !doc.editor) {
    toast('Switch to edit mode to convert case');
    return;
  }
  const { start, end } = doc.editor.getSelection();
  const r = convertCase(doc.editor.getValue(), start, end, mode);
  if (r.text === doc.editor.getValue()) return;
  doc.editor.replaceRange(0, doc.editor.getValue().length, r.text);
  doc.editor.setState({ start: r.start, end: r.end });
  if (doc.content !== r.text) {
    doc.content = r.text;
    store.markDirty(doc.id);
    persistSoon();
    scheduleAutoSave();
  }
}

// v0.49.0: wrap the selection with a chosen surround. `kind` ∈
// 'kbd' | 'details' | 'code' | 'quote'. kbd is inline (wrapSelection); details
// and code are multi-line blocks (wrapBlock); quote reuses toggleLinePrefix.
// Reaches the editor via the same apply path as the other selection ops.
function wrapSelectionApply(kind) {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || !doc.editor) {
    toast('Switch to edit mode to wrap text');
    return;
  }
  const { start, end } = doc.editor.getSelection();
  const value = doc.editor.getValue();
  let r;
  if (kind === 'kbd') {
    r = wrapSelection(value, start, end, '<kbd>', '</kbd>');
  } else if (kind === 'details') {
    r = wrapBlock(value, start, end, '<details>', '</details>');
  } else if (kind === 'code') {
    r = wrapBlock(value, start, end, '```', '```');
  } else if (kind === 'quote') {
    r = toggleLinePrefix(value, start, end, '> ');
  } else {
    return;
  }
  if (!r || r.text === value) return;
  doc.editor.replaceRange(0, value.length, r.text);
  doc.editor.setState({ start: r.start, end: r.end });
  if (doc.content !== r.text) {
    doc.content = r.text;
    store.markDirty(doc.id);
    persistSoon();
    scheduleAutoSave();
  }
}

// v0.46.0: extract the selection into a new untitled markdown note and leave a
// markdown link to it in place of the selection. The new tab's title is derived
// from the extracted content (first heading / first line). Useful for
// refactoring long notes into linked sub-notes.
function extractSelectionToNote() {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || !doc.editor) {
    toast('Switch to edit mode to extract a note');
    return;
  }
  const { start, end } = doc.editor.getSelection();
  if (start === end) { toast('Select the text to extract first'); return; }
  const text = doc.editor.getValue();
  const selection = text.slice(start, end);
  const title = deriveNoteTitle(selection);
  // Replace the selection in the source doc with a link. The link points at
  // the derived title (the user will save the new tab under a matching name).
  const link = `[${title}](${title.replace(/\s+/g, '%20')}.md)`;
  const next = text.slice(0, start) + link + text.slice(end);
  doc.editor.replaceRange(0, doc.editor.getValue().length, next);
  doc.editor.setState({ start, end: start + link.length });
  doc.content = next;
  store.markDirty(doc.id);
  persistSoon();
  scheduleAutoSave();
  // Finish changing the source before opening a tab destroys its editor.
  const extracted = store.open({ path: null, content: selection, mode: 'edit' });
  store.markDirty(extracted.id);
  toast(`Extracted to new note: ${title}`);
}

function newTab() {
  // 'home' (default) opens a welcome-screen tab; an empty untitled view-mode
  // doc naturally renders the welcome screen via renderActive's isEmpty check.
  const fmt = localStorage.getItem('mdpeek-new-tab-format') || 'home';
  const modePref = localStorage.getItem('mdpeek-new-tab-mode') || 'view';
  if (fmt === 'home') {
    store.open({ path: null, content: '', mode: 'view' });
  } else {
    const plain = fmt === 'text';
    store.open({ path: null, content: '', plain, mode: plain ? 'edit' : modePref });
  }
}

// v0.45.0: reopen the most-recently-closed tab. Pops a snapshot off
// _closedTabs and re-opens it. For a saved file (path !== null) we re-read
// from disk so external edits show up; if the read fails we fall back to the
// snapshot content. For an untitled doc we use the snapshot content as-is.
async function reopenClosedTab() {
  const { entry, rest } = popClosedTab(_closedTabs);
  if (!entry) { toast('No recently closed tabs'); return; }
  _closedTabs = rest;
  // store.open dedupes by path: if the file is already open, it just switches
  // to that tab (and we re-push the snapshot so a second Ctrl+Alt+T reopens
  // the next one). The duplicate check returns the existing doc — fine.
  if (entry.path) {
    try {
      const content = await invoke('read_file', { path: entry.path });
      await openPath(entry.path, content);
    } catch {
      // Read failed (file moved/deleted) — open with the snapshot content.
      await openPath(entry.path, entry.content);
    }
  } else {
    store.open({ path: null, content: entry.content, plain: entry.plain, code: entry.code, mode: entry.mode || 'edit' });
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
      await saveDoc(doc);
      // If the save was cancelled (no path chosen), abort the close.
      if (doc.dirty) return;
    }
  }
  // v0.45.0: snapshot the doc for "Reopen closed tab" before we tear it down.
  // Only snapshot docs worth reopening: a saved path OR non-empty content.
  if (doc.path || doc.content) {
    const snap = snapshotDoc(doc);
    if (snap) _closedTabs = pushClosedTab(_closedTabs, snap);
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
    if (!store.active()) renderActive().catch((e) => console.error('[mdpeek] close-all render:', e));
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
    // v0.45.0: snapshot for "Reopen closed tab" (same guard as closeTab).
    if (doc.path || doc.content) {
      const snap = snapshotDoc(doc);
      if (snap) _closedTabs = pushClosedTab(_closedTabs, snap);
    }
    if (doc.editor) doc.editor.destroy();
    if (_lastRenderedId === id) _lastRenderedId = null;
    store.close(id);
  }
  if (store.docs.length === 0) {
    newTab();
    if (!store.active()) renderActive().catch((e) => console.error('[mdpeek] close-others render:', e));
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
// v1.1.2: the pipeline lives in src/lib/save-doc.js (DOM-free, unit-testable);
// this wrapper binds it to the app's live store + OS dialogs.
async function saveActive() {
  return saveDoc(store.active());
}
async function saveDoc(doc) {
  if (!canSaveDoc(doc)) return;
  const oldPath = doc.path;
  const savedPath = await saveActiveDoc({
    invoke,
    toast,
    fmtErr,
    clearDirty: (id) => store.clearDirty(id),
  }, doc);
  if (savedPath && !oldPath) {
    addRecent(savedPath);
    if (!isImagePath(savedPath)) {
      await rewatch(store.active()?.path);
    }
    renderTabs(store);
    updateEditorStatus();
    revealPath(savedPath);
  }
  if (savedPath) persist();
}

async function saveActiveAs() {
  const doc = store.active();
  if (!canSaveDoc(doc)) return;
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  const { content } = doc;
  try {
    const kind = doc.plain ? 'text' : undefined;
    const path = await invoke('save_file_as', { content, kind });
    if (!path) return;
    doc.path = path;
    if ((doc.editor?.getValue() ?? doc.content) === content) store.clearDirty(doc.id);
    toast('Saved as ' + basename(path));
    addRecent(path);
    if (!isImagePath(path)) {
      await rewatch(path);
    }
    renderTabs(store);
    updateEditorStatus();
    revealPath(path);
    persist();
  } catch (e) {
    if (e !== 'cancelled') toast('Save failed: ' + fmtErr(e));
  }
}

// ---------- image paste / drop into the editor ----------
// When an image is pasted or dropped onto the textarea while editing a
// markdown doc, save the bytes to disk and insert a markdown image link at the
// caret.
//
// v0.40.0: when `mdpeek-image-beside-doc` is on (default ON), the image is
// saved to `<docDir>/assets/<hash>.<ext>` and inserted as a portable relative
// link `![](assets/<hash>.<ext>)` — so moving/sharing the .md keeps the image
// working. Untitled docs (no path) and the explicit-OFF setting fall back to
// the legacy behaviour: global assets folder + absolute file:// URL. If disk
// write fails entirely we embed a base64 data URL so the image still shows.
async function insertImageFromBlob(blob) {
  const doc = store.active();
  if (!doc || !doc.editor) return false;
  const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const buf = new Uint8Array(await blob.arrayBuffer());
  const hash = await sha256Hex(buf).catch(() => Math.random().toString(36).slice(2));
  const short = String(hash).slice(0, 10);
  const filename = `img-${short}.${ext}`;

  const besideDoc = localStorage.getItem('mdpeek-image-beside-doc') !== '0';
  const relativeMd = besideDoc ? buildRelativeImageMarkdown(doc && doc.path, filename) : null;
  let md;
  if (relativeMd) {
    const docDir = doc.path.replace(/[\\/][^\\/]+$/, '');
    try {
      await invoke('save_image', { dir: docDir + '\\assets', filename, bytes: Array.from(buf) });
      md = relativeMd;
    } catch (e) {
      md = await fallbackImageMarkdown(blob, buf, filename);
    }
  } else {
    md = await fallbackImageMarkdown(blob, buf, filename);
  }
  doc.editor.insertAtCursor(md);
  store.markDirty(doc.id);
  persistSoon();
  scheduleAutoSave();
  return true;
}

// Legacy fallback for paste-image: write to the central global assets folder
// and emit an absolute file:// URL. Used when "save beside doc" is off or when
// the active doc is untitled (no folder to save beside).
async function fallbackImageMarkdown(blob, buf, filename) {
  try {
    const savedPath = await invoke('save_image', { dir: 'global', filename, bytes: Array.from(buf) });
    const normalized = savedPath.replace(/\\/g, '/');
    const pathUrl = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
    return `![](${encodeURI(pathUrl)})`;
  } catch (e) {
    // Last resort: embed as a base64 data URL so the image still renders.
    const b64 = bytesToBase64(buf);
    return `![](data:${blob.type};base64,${b64})`;
  }
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
a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px;
  text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent); }
a:hover { text-decoration-color: var(--accent); }
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

// Fetch the active hljs theme's CSS text from its <link> href. v0.34.0: the
// links now point at bundled local assets (not CDN), so this works offline.
// Returns '' only if the fetch itself fails (shouldn't happen post-bundle).
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
  if (!doc || doc.code || doc.csv) {
    toast('Export to HTML is for Markdown documents');
    return;
  }
  // Sync editor content before exporting so unsaved edits are included.
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  const bodyHtml = renderMarkdown(doc.content);
  const title = docDisplayName(doc);
  const css = `/* mdpeek export */ ${exportThemeVars()} ${EXPORT_CSS} ${await exportHljsCss()}`;
  const full =
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(title)}</title>\n<style>\n${css}\n</style>\n</head>\n<body>\n` +
    `${bodyHtml}\n</body>\n</html>`;
  try {
    const res = await invoke('save_file_as_html', { content: full });
    // Use the real saved filename (the user may have renamed it in the save
    // dialog) — never a fabricated one.
    notify('Export complete', basename(res) || `${title}.html`);
  } catch (e) {
    if (e !== 'cancelled') toast('Export failed — the file may be open in another program');
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
  if (!doc || doc.code || doc.image || doc.csv) {
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
    // v0.51.0: notify once the print/save dialog closes (the user has either
    // saved a PDF or cancelled — either way the slow op is done).
    notify('PDF export finished', basename(doc.path || 'document'));
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
  if (doc.image) return; // Images are read-only — no edit mode
  if (doc.csv) return;        // CSVs are read-only table views — no edit mode
  // Capture content before switching out of edit mode.
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  doc.mode = doc.mode === 'view' ? 'edit' : 'view';
  if (find) find.close(); // clear highlights/selection before the re-render
  renderActive().then(() => {
    if (store.active()?.id === doc.id && doc.mode === 'edit') doc.editor?.focus();
    persistSoon();
  }).catch((e) => console.error('toggleMode render failed:', e));
}

// ---------- custom CSS (v0.41.0) ----------
// Inject the user's custom stylesheet into <head>. Targets .markdown-body so
// it applies to every rendered surface (view article, edit preview, reader).
// Idempotent: replaces the existing <style> if present.
function applyUserCss() {
  const id = 'mdpeek-user-css';
  let style = document.getElementById(id);
  const css = (localStorage.getItem('mdpeek-user-css') || '').trim();
  if (!css) {
    if (style) style.remove();
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    document.head.appendChild(style);
  }
  style.textContent = css;
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
  applyThemeVisuals(next);
  localStorage.setItem('mdpeek-theme', next);
}

function applyThemeVisuals(next) {
  if (!HLJS_FOR_THEME[next]) next = DEFAULT_THEME;
  const root = document.documentElement;
  root.dataset.theme = next;
  // Enable exactly one highlight.js stylesheet; disable the rest so code
  // blocks recolor to match the active UI theme.
  const want = HLJS_FOR_THEME[next];
  for (const id of Object.values(HLJS_FOR_THEME)) {
    const link = document.getElementById(id);
    if (link) link.disabled = id !== want;
  }
  // Mark the active card in the Settings theme grid (drives the accent ring
  // + check badge). v0.32.0: the topbar theme dropdown is gone.
  document.querySelectorAll('.theme-card').forEach((btn) => {
    const isActive = btn.dataset.theme === next;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    btn.tabIndex = isActive ? 0 : -1;
  });
}

// ---------- focus / zen mode (hide header + sidebar for distraction-free reading) ----------
function toggleFocus() {
  const on = document.body.classList.toggle('focus-mode');
  localStorage.setItem('mdpeek-focus', on ? '1' : '0');
}

// ---------- immersive reading mode (v0.34.0) ----------
// Safari-Reader-style full-screen overlay. Distinct from Focus mode (F11,
// which only hides chrome): Reading Mode is a true overlay with adjustable
// width / font size / color theme, independent of the app theme. Reuses the
// live renderMarkdown + enhanceDom so Mermaid, KaTeX, code blocks, footnotes,
// etc. render exactly as in the normal view.
//
// State: the three prefs (width/font/theme) are persisted under
// mdpeek-reader-<name> and restored on enter. Cycling helpers live in
// ./lib/reading.js so they're unit-testable.
function readingPrefs() {
  return loadReaderPrefs(localStorage);
}
function persistReaderPref(key, value) {
  localStorage.setItem(`mdpeek-reader-${key}`, value);
}
function applyReaderPrefs(prefs) {
  el.reader.dataset.readerWidth = prefs.width;
  el.reader.dataset.readerFont = prefs.font;
  el.reader.dataset.readerTheme = prefs.theme;
  el.reader.dataset.readerFontFamily = prefs.fontFamily || 'sans';
}
function refreshReaderMeta() {
  const doc = store.active();
  if (!doc) return;
  const words = countWords(doc.content);
  const label = readingTimeLabel(words);
  el.readerMeta.textContent = `${words.toLocaleString()} words · ${label}`;
}

async function enterReading() {
  const doc = store.active();
  if (!doc || doc.code || doc.image || doc.csv) {
    toast('Reading mode is for Markdown documents');
    return;
  }
  // Sync any pending editor changes before rendering.
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  // Title: the doc's filename, or a content-derived title for untitled notes.
  el.readerTitle.textContent = docDisplayName(doc);
  refreshReaderMeta();
  // Render the doc into the reader article, then enhance (Mermaid, KaTeX, code
  // badges/gutter) exactly as the normal view does.
  el.readerArticle.innerHTML = renderMarkdown(doc.content);
  try {
    await enhanceDom(el.readerArticle, { lineNumbers: codeLineNumbersPref() });
  } catch (e) {
    console.error('[mdpeek] reader enhanceDom:', e);
  }
  applyReaderPrefs(readingPrefs());
  el.reader.classList.remove('hidden');
  document.body.classList.add('reading');
  // v0.41.0: build the outline + restore its visibility from the pref.
  buildReaderToc();
  if (localStorage.getItem('mdpeek-reader-toc') === '1') toggleReaderToc(true);
  // Focus the scroll region so keyboard shortcuts work without a tab-focus.
  const scroll = el.reader.querySelector('.reader-scroll');
  if (scroll) scroll.scrollTop = doc.readerScrollY || 0;
  el.reader.focus?.();
  // v0.36.0: drive the top progress bar from the scroll position. Wired once
  // (the reader element is long-lived); the listener reads the live scroll
  // region each time so re-entering with a different doc just works.
  setupReaderProgressTracking();
  updateReaderProgress();
}

// v0.41.0: build the reader outline from the rendered article's headings.
// Covers h1–h6 (the view-mode TOC only does h1–h3 — this is the better
// default for long-form reading). Each entry scrolls the heading into view
// inside the reader scroll region on click.
function buildReaderToc() {
  const toc = el.reader.querySelector('#reader-toc');
  if (!toc) return;
  const headings = el.readerArticle.querySelectorAll('h1, h2, h3, h4, h5, h6');
  if (headings.length === 0) {
    toc.innerHTML = '<div class="reader-toc-empty">No headings</div>';
    return;
  }
  toc.innerHTML = '';
  const scroll = el.reader.querySelector('.reader-scroll');
  headings.forEach((h) => {
    const level = parseInt(h.tagName.slice(1), 10);
    const text = (h.textContent || '').trim() || '(untitled)';
    const a = document.createElement('a');
    a.className = `reader-toc-item level-${level}`;
    a.href = '#';
    a.textContent = text;
    a.title = text;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      // Scroll inside the reader's scroll region, not the window.
      if (scroll) {
        const rect = h.getBoundingClientRect();
        const scrollRect = scroll.getBoundingClientRect();
        scroll.scrollTop += rect.top - scrollRect.top - 12;
      } else {
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    toc.appendChild(a);
  });
}

// Show/hide the reader outline. Called with no arg → toggle; with a boolean
// → set explicitly (used by enterReading to restore the saved state).
function toggleReaderToc(force) {
  const toc = el.reader.querySelector('#reader-toc');
  if (!toc) return;
  const show = typeof force === 'boolean' ? force : toc.classList.contains('hidden');
  toc.classList.toggle('hidden', !show);
  localStorage.setItem('mdpeek-reader-toc', show ? '1' : '0');
}

// Attach the scroll → progress-bar listener exactly once. The bar itself is
// the thin accent strip at the very top of the reader (driven by the
// --reader-progress custom property, 0–100%). Respects reduced motion via CSS.
let readerProgressWired = false;
function setupReaderProgressTracking() {
  if (readerProgressWired) return;
  const scroll = el.reader.querySelector('.reader-scroll');
  if (!scroll) return;
  scroll.addEventListener('scroll', updateReaderProgress, { passive: true });
  readerProgressWired = true;
}
function updateReaderProgress() {
  const scroll = el.reader.querySelector('.reader-scroll');
  if (!scroll) return;
  const max = scroll.scrollHeight - scroll.clientHeight;
  const pct = max > 0 ? Math.min(100, Math.max(0, (scroll.scrollTop / max) * 100)) : 0;
  el.reader.style.setProperty('--reader-progress', `${pct}%`);
}

function exitReading() {
  // v0.37.0: remember where the user was reading so re-entering resumes there
  // instead of jumping to the top. Stored on the doc object (in-memory only,
  // matches how view-mode doc.scrollY already behaves).
  const doc = store.active();
  const scroll = el.reader.querySelector('.reader-scroll');
  if (doc && scroll) doc.readerScrollY = scroll.scrollTop;
  el.reader.classList.add('hidden');
  document.body.classList.remove('reading');
  // Drop rendered content so the next enter starts fresh (no stale diagrams).
  el.readerArticle.innerHTML = '';
  // v0.41.0: clear the outline too.
  const toc = el.reader.querySelector('#reader-toc');
  if (toc) { toc.innerHTML = ''; toc.classList.add('hidden'); }
}

function toggleReading() {
  if (document.body.classList.contains('reading')) {
    exitReading();
  } else {
    enterReading();
  }
}

// Cycle helpers — read current pref, advance, persist, apply live.
function readerCycleWidth(dir) {
  const cur = el.reader.dataset.readerWidth || DEFAULTS.width;
  const next = dir > 0 ? nextWidth(cur) : prevWidth(cur);
  persistReaderPref('width', next);
  el.reader.dataset.readerWidth = next;
}
function readerCycleFont(dir) {
  const cur = el.reader.dataset.readerFont || DEFAULTS.font;
  const next = dir > 0 ? nextFont(cur) : prevFont(cur);
  persistReaderPref('font', next);
  el.reader.dataset.readerFont = next;
}
function readerCycleTheme() {
  const cur = el.reader.dataset.readerTheme || DEFAULTS.theme;
  const next = nextTheme(cur);
  persistReaderPref('theme', next);
  el.reader.dataset.readerTheme = next;
}
// v0.38.0: font-family cycle (sans → serif → mono). Bound to the 'F' key,
// which was previously unused in the reader (T is theme, +/- is size).
function readerCycleFontFamily() {
  const cur = el.reader.dataset.readerFontFamily || DEFAULTS.fontFamily;
  const next = nextFontFamily(cur);
  persistReaderPref('font-family', next);
  el.reader.dataset.readerFontFamily = next;
}

// Tiny local helper so reading mode doesn't reach into the editor/viewer
// modules for the code-line-numbers flag. Mirrors viewer.js's read.
function codeLineNumbersPref() {
  try { return localStorage.getItem('mdpeek-code-line-numbers') === '1'; }
  catch { return false; }
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

// v0.35.0: toggle a GFM task-list checkbox from the rendered preview. Unlike
// toggleNoteCheckbox above (disk-only, Kanban inbox), this works on the active
// doc's in-memory content — so it handles unsaved/untitled docs and keeps the
// editor (if open) in sync. The clicked checkbox is the Nth rendered task item;
// taskLineIndex maps it back to its source line, toggleTaskLine flips it, then
// we re-render + persist (silent save — no toast for a checkbox click).
async function togglePreviewCheckbox(itemIndex) {
  const doc = store.active();
  if (!doc) return;
  const text = doc.content || '';
  const lineIndex = taskLineIndex(text, itemIndex);
  if (lineIndex < 0) return;
  const { text: next } = toggleTaskLine(text, lineIndex);
  if (next === text) return; // nothing changed (line wasn't a task)
  doc.content = next;
  store.markDirty(doc.id);
  // Keep the editor in sync if it's open on this doc.
  if (doc.editor && typeof doc.editor.setValue === 'function') {
    const sel = doc.editor.getSelection();
    doc.editor.setValue(next);
    // Restore caret via the raw textarea (the editor object has no setSelection).
    const ta = doc.editor.textarea && doc.editor.textarea();
    if (ta && sel) ta.setSelectionRange(sel.start, sel.end);
  }
  // Persist to disk silently for saved files; unsaved docs just stay dirty.
  if (doc.path) {
    try { await invoke('save_file', { path: doc.path, content: next }); if (doc.content === next) store.clearDirty(doc.id); }
    catch (e) { console.error('checkbox save:', e); /* leave dirty */ }
  }
  persistSoon();
  if (!el.reader.classList.contains('hidden')) {
    const scroll = el.reader.querySelector('.reader-scroll');
    doc.readerScrollY = scroll.scrollTop;
    enterReading().catch((e) => console.error('[mdpeek] reader checkbox:', e));
  }
  renderActive().catch((e) => console.error('[mdpeek] checkbox render:', e));
}

// ---------- daily note ----------
// One-click "today's note". First run asks the user to pick a notes folder
// (persisted to mdpeek-notes-dir); subsequent runs go straight there. If
// today's YYYY-MM-DD.md already exists, opens it; otherwise creates it with a
// small starter template. Opened in edit mode so the user can start writing.
async function openDailyNote() {
  let dir = localStorage.getItem('mdpeek-notes-dir') || '';
  if (!dir) {
    try {
      dir = await invoke('get_default_notes_dir');
      localStorage.setItem('mdpeek-notes-dir', dir);
      toast('Notes folder set: ' + basename(dir));
    } catch (e) {
      toast('Set a notes folder in Settings → General first');
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
    renderActive().catch((e) => console.error('[mdpeek] daily note open render:', e));
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
    renderActive().catch((e) => console.error('[mdpeek] daily note create render:', e));
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

// ---------- copy as HTML source (v0.44.0) ----------
// Sibling to copyAsRichText, but writes the rendered HTML source as plain text
// (so you can paste it into a CMS, email source, or a code editor).
async function copyAsHtml() {
  const doc = store.active();
  if (!doc || doc.plain) { toast('Nothing to copy'); return; }
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  const html = renderMarkdown(doc.content);
  try {
    await navigator.clipboard.writeText(html);
    toast('Copied as HTML source');
  } catch (e) {
    toast('Copy failed: ' + fmtErr(e));
  }
}

// v0.45.0: copy the markdown-stripped plain text (no syntax symbols) so it
// pastes cleanly into a notepad / chat / form field. Reuses stripMarkdown
// (the same pipeline wordCount uses).
async function copyAsPlainText() {
  const doc = store.active();
  if (!doc || doc.plain) { toast('Nothing to copy'); return; }
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  const plain = stripMarkdown(doc.content).trim();
  try {
    await navigator.clipboard.writeText(plain);
    toast('Copied as plain text');
  } catch (e) {
    toast('Copy failed: ' + fmtErr(e));
  }
}

// v0.45.0: export the markdown-stripped plain text to a .txt file via a save
// dialog. Mirrors exportHtml but writes stripped text through save_file_as_text.
async function exportPlainText() {
  const doc = store.active();
  if (!doc || doc.code || doc.csv) {
    toast('Export to text is for Markdown documents');
    return;
  }
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  const plain = stripMarkdown(doc.content).trim();
  try {
    await invoke('save_file_as_text', { content: plain });
    notify('Export complete', `${basename(doc.path || 'untitled')}.txt`);
  } catch (e) {
    if (e !== 'cancelled') toast('Export failed: ' + fmtErr(e));
  }
}

// ---------- open in browser (v0.44.0) ----------
// Stage the rendered doc as a temp HTML file and hand it to the system browser
// via the opener plugin. No save dialog — the file lives in the OS temp dir
// under mdpeek/ and is overwritten on the next open.
async function openInBrowser() {
  const doc = store.active();
  if (!doc || doc.code || doc.csv) {
    toast('Open in browser is for Markdown documents');
    return;
  }
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  const bodyHtml = renderMarkdown(doc.content);
  const title = docDisplayName(doc);
  const css = `/* mdpeek preview */ ${exportThemeVars()} ${EXPORT_CSS} ${await exportHljsCss()}`;
  const full =
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(title)}</title>\n<style>\n${css}\n</style>\n</head>\n<body>\n` +
    `${bodyHtml}\n</body>\n</html>`;
  try {
    const tempPath = await invoke('write_temp_html', { content: full, suggestedName: title });
    await openUrl('file:///' + tempPath.replace(/\\/g, '/').replace(/^\//, ''));
    toast('Opened in browser');
  } catch (e) {
    toast('Open in browser failed: ' + fmtErr(e));
  }
}

// ---------- document templates (v0.44.0) ----------
// User-defined doc skeletons stored in localStorage. "Save as template"
// snapshots the current doc; "New from template" creates a fresh untitled doc
// seeded with that content. The picker is built from initSnippetPicker's core.
function newFromTemplate() {
  const list = getTemplates(localStorage);
  if (list.length === 0) {
    toast('No templates yet — use "Save as template" first');
    return;
  }
  templatePicker.open();
}

function saveCurrentAsTemplate() {
  const doc = store.active();
  if (!doc) { toast('Open a document first'); return; }
  const raw = window.prompt('Template name:', doc.path ? basename(doc.path).replace(/\.(md|markdown|mdx)$/i, '') : '');
  if (!raw) return;
  const name = raw.trim();
  if (!name) return;
  const content = doc.mode === 'edit' && doc.editor ? doc.editor.getValue() : (doc.content || '');
  saveTemplate(localStorage, name, content);
  refreshTemplatePickerItems();
  toast(`Saved template "${name}"`);
}

function refreshTemplatePickerItems() {
  if (!templatePicker?.setItems) return;
  const list = getTemplates(localStorage);
  templatePicker.setItems(list.map((t) => ({
    label: t.name,
    hint: '',
    keywords: t.name + ' ' + t.content.slice(0, 200),
    text: t.content,
  })));
}

// ---------- link checker (v0.44.0) ----------
// Scan the active doc for [[wiki]] and [text](file.md) links, compare each
// target's basename against the files in the doc's folder, and list any that
// don't resolve. Clicking a broken link jumps to its line.
async function checkLinks() {
  const doc = store.active();
  if (!doc) { toast('Open a document first'); return; }
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  const links = extractDocLinks(doc.content || '');
  if (links.length === 0) { toast('No document links found'); return; }

  // Build a Set of basenames in the doc's folder (one list_dir call).
  let basenames = [];
  if (doc.path) {
    const slash = Math.max(doc.path.lastIndexOf('/'), doc.path.lastIndexOf('\\'));
    const dir = slash >= 0 ? doc.path.slice(0, slash) : '';
    if (dir) {
      try {
        const entries = await invoke('list_dir', { path: dir });
        basenames = (entries || []).map((e) => (typeof e === 'string' ? e : e.name)).filter(Boolean);
      } catch (e) {
        toast('Could not read folder: ' + fmtErr(e));
        return;
      }
    }
  }
  const { ok, broken } = classifyLinks(links, basenames);
  if (broken.length === 0) {
    toast(`All ${ok.length} link${ok.length === 1 ? '' : 's'} resolve ✓`);
    return;
  }
  // Show broken links in a picker; clicking jumps to the line.
  const items = broken.map((l) => ({
    label: l.display || l.target,
    hint: `→ ${l.target}  (line ${l.line})`,
    keywords: `${l.target} ${l.display} broken missing`,
    line: l.line,
  }));
  brokenLinkPicker.setItems(items);
  brokenLinkPicker.open();
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
  const hasToc = doc && doc.content.trim() && !doc.image && !doc.code && !doc.csv && !doc.plain && doc.mode === 'view';
  
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
  const hasToc = doc && doc.content.trim() && !doc.image && !doc.code && !doc.csv && !doc.plain && doc.mode === 'view';
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
// v0.67.0: keyboard focus inside the tree (rows are focusable now) drives the
// same tracker that clicks do, so F2/Delete work after arrow navigation.
if (el.fileTreeBody) el.fileTreeBody.addEventListener('focusin', (e) => {
  const row = e.target.closest('.tree-row');
  if (row) { _treeActivePath = row.dataset.path; _treeActiveKind = row.dataset.kind; }
});

// v0.41.0: autocomplete key handling. Capture phase so we run before the
// editor's own keydown (which would otherwise intercept Tab/Enter for indent
// / newline). handleKeydown returns true only when the dropdown is active
// AND the key is one we care about — otherwise it's a no-op and the editor's
// handler runs normally.
el.editor.addEventListener('keydown', (e) => {
  if (localStorage.getItem('mdpeek-feature-autocomplete') === '0') return;
  // v0.67.0: stopImmediatePropagation when the dropdown consumed the key —
  // at-target listeners fire in registration order, so without this the
  // editor's own Tab/Enter handler still runs and inserts a stray indent/newline.
  if (autocomplete.handleKeydown(e)) e.stopImmediatePropagation();
}, true);

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
  // v0.49.0: "New file…" / "New folder…" only make sense on directories.
  // Toggle the two items + their trailing separator together.
  const newEls = el.treeCtxMenu.querySelectorAll('.tree-ctx-new');
  const newSep = el.treeCtxMenu.querySelector('.tree-ctx-new-sep');
  newEls.forEach((b) => b.classList.toggle('hidden', !isDir));
  newSep?.classList.toggle('hidden', !isDir);
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
  // v0.49.0: New file / New folder — only valid on a directory target. The
  // directory itself (when right-clicked) is the container; a file target
  // wouldn't show these items (showTreeCtxMenu hides them).
  if (action === 'new-file') {
    if (kind !== 'dir' || !path) return;
    await createInTree(path, false);
    return;
  }
  if (action === 'new-folder') {
    if (kind !== 'dir' || !path) return;
    await createInTree(path, true);
    return;
  }
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

// v0.49.0: Create a new file or folder inside `dir`. Prompts for a name, then
// invokes the Rust create_path command. On success, refreshes the tree; for a
// new file, also opens it in a tab so the user can start editing immediately.
async function createInTree(dir, isDir) {
  const kindLabel = isDir ? 'folder' : 'file';
  const name = window.prompt(`New ${kindLabel} name:`, isDir ? 'untitled' : 'untitled.md');
  if (name === null) return; // cancelled
  const trimmed = (name || '').trim();
  if (!trimmed) { toast('Name cannot be empty'); return; }
  // Reject path separators — the name must be a single path segment.
  if (/[\\/]/.test(trimmed)) { toast('Name cannot contain a path separator'); return; }
  const fullPath = (dir.endsWith('\\') || dir.endsWith('/') ? dir + trimmed : dir + '\\' + trimmed);
  try {
    await invoke('create_path', { path: fullPath, isDir });
    refreshTree();
    toast(isDir ? 'Folder created' : 'File created');
    // New file → open it immediately so the user can start typing. New folder
    // → just leave it created (expanding the parent reveals it via refreshTree).
    if (!isDir) {
      try { await openPath(fullPath, ''); } catch (e) { /* open is best-effort */ }
    }
  } catch (e) {
    toast('Create failed: ' + fmtErr(e));
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
      if (!store.active()) renderActive().catch((e) => console.error('[mdpeek] remove-recent render:', e));
    } else if (store.active()) {
      await rewatch(store.active().path);
      renderActive().catch((e) => console.error('[mdpeek] remove-recent render:', e));
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
const folderSearch = initFolderSearch(
  (path, line, query) => { openPathAndJump(path, line, query); },
  {
    // Is `path` open in a tab with unsaved edits? Mirrors the file-changed
    // watcher guard (src/main.js:5811) — never clobber unsaved work.
    isDirty: (path) => store.docs.some((d) => d.path === path && d.dirty),
    // Sync a clean open tab after an external write so the editor reflects
    // the change without waiting for a watcher round-trip.
    updateOpenDoc: (path, newContent) => {
      const doc = store.docs.find((d) => d.path === path);
      if (!doc) return;
      doc.content = newContent;
      if (doc.editor && doc.mode === 'edit') doc.editor.setValue(newContent);
      // The content now matches disk — clear the dirty flag.
      store.clearDirty(doc.id);
    },
  },
);

// v0.50.0: Find-in-folder — a first-class entry point to the content search
// (grep). Surfaces it as a palette command + Ctrl+Shift+F. Reuses
// folderSearch.searchWith, so zero new search logic.
function findInFolder() {
  const root = localStorage.getItem('mdpeek-explorer-root');
  if (!root) { toast('Open a folder first'); return; }
  folderSearch.searchWith(root, '');
}

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
  // v0.45.0: markdown-stripping regex pipeline factored into src/lib/strip.js
  // so "Copy as plain text" and the stats panel reuse the same logic.
  const t = stripMarkdown(text);
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

// ---------- editor outline pane (v0.44.0) ----------
// A collapsible list of the active doc's headings, shown alongside the editor.
// Click a heading to jump the caret there. Reuses extractHeadings (the same
// parser the "Go to heading" picker uses) and scrollEditorToLine. Hidden by
// default; toggled by a command palette entry + the panel's close button.
const OUTLINE_KEY = 'mdpeek-editor-outline';
const outlineEl = document.getElementById('editor-outline');
const outlineBody = document.getElementById('editor-outline-body');

function rebuildEditorOutline() {
  if (!outlineEl || outlineEl.classList.contains('hidden')) return;
  const doc = store.active();
  // Outline is edit-mode only (view mode already has the sidebar TOC).
  if (!doc || doc.mode !== 'edit' || !doc.editor) { outlineEl.classList.add('hidden'); return; }
  const headings = extractHeadings(doc.editor.getValue());
  if (headings.length === 0) {
    outlineBody.innerHTML = '<div class="editor-outline-empty">No headings yet</div>';
    return;
  }
  // Render tiered by level. Reuse the reader-toc-item classes so the indent
  // styling matches the reader outline.
  outlineBody.innerHTML = headings
    .map((h) => `<div class="reader-toc-item level-${Math.min(h.level, 6)}" data-line="${h.line}" title="Line ${h.line}">${escapeHtml(h.text)}</div>`)
    .join('');
}

function setEditorOutlineVisible(on) {
  if (!outlineEl) return;
  outlineEl.classList.toggle('hidden', !on);
  localStorage.setItem(OUTLINE_KEY, on ? '1' : '0');
  if (on) rebuildEditorOutline();
}

function toggleEditorOutline() {
  const doc = store.active();
  if (!doc) { toast('Open a document first'); return; }
  if (doc.mode !== 'edit') {
    toast('Switch to edit mode to use the outline');
    return;
  }
  setEditorOutlineVisible(outlineEl?.classList.contains('hidden'));
}

// v0.55.0: editor region folding — core editing affordance (no feature flag).
// toggleFoldAtCaret folds/unfolds the heading that owns the caret line; the
// editor mutates only visual state (textarea.value is never touched). Mirrors
// the edit-mode guard of toggleEditorOutline.
function foldToggleAtCaret() {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || !doc.editor) {
    toast('Switch to edit mode to fold');
    return;
  }
  const folded = doc.editor.toggleFoldAtCaret();
  if (!folded) toast('Place the caret on a heading line to fold');
}

function unfoldAll() {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || !doc.editor) {
    toast('Switch to edit mode to unfold');
    return;
  }
  doc.editor.unfoldAll();
}

if (outlineBody) {
  outlineBody.addEventListener('click', (e) => {
    const item = e.target.closest('[data-line]');
    if (!item) return;
    const doc = store.active();
    if (!doc || !doc.editor) return;
    const line = parseInt(item.dataset.line, 10);
    if (Number.isFinite(line)) scrollEditorToLine(doc, line);
  });
}
if (outlineEl) {
  document.getElementById('editor-outline-close')?.addEventListener('click', () => setEditorOutlineVisible(false));
}
// Restore the saved outline state on first render of an edit-mode doc.
// (Deferred to renderActive via the OUTLINE_KEY check below.)

// --------------------------- doc stats panel (v0.45.0) ---------------------
// Mirrors the editor-outline aside: a togglable floating panel inside
// .editor-wrap, rebuilt on every editor change (cheap — pure parse via
// computeStats). Edit-mode only (view mode already shows the status bar).
const STATS_KEY = 'mdpeek-doc-stats';
const statsEl = document.getElementById('doc-stats');
const statsBody = document.getElementById('doc-stats-body');

function rebuildDocStats() {
  if (!statsEl || statsEl.classList.contains('hidden')) return;
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || !doc.editor) { statsEl.classList.add('hidden'); return; }
  const text = doc.editor.getValue();
  const s = computeStats(text);
  const rows = [
    ['Words', s.words.toLocaleString()],
    ['Characters', s.chars.toLocaleString()],
    ['Sentences', s.sentences.toLocaleString()],
    ['Paragraphs', s.paragraphs.toLocaleString()],
    ['Avg words / sentence', String(s.avgWordsPerSentence)],
    ['Long words (6+)', s.longWords.toLocaleString()],
    ['Reading time', s.readMins > 0 ? `${s.readMins} min` : '—'],
    ['Speaking time', s.speakMins > 0 ? `${s.speakMins} min` : '—'],
  ];
  statsBody.innerHTML = rows
    .map(([label, value]) => `<div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div>`)
    .join('');
}

function setDocStatsVisible(on) {
  if (!statsEl) return;
  statsEl.classList.toggle('hidden', !on);
  localStorage.setItem(STATS_KEY, on ? '1' : '0');
  if (on) rebuildDocStats();
}

function toggleDocStats() {
  const doc = store.active();
  if (!doc) { toast('Open a document first'); return; }
  if (doc.mode !== 'edit') {
    toast('Switch to edit mode to see statistics');
    return;
  }
  setDocStatsVisible(statsEl?.classList.contains('hidden'));
}

if (statsEl) {
  document.getElementById('doc-stats-close')?.addEventListener('click', () => setDocStatsVisible(false));
}

function updateEditorStatus() {
  if (!el.editorStatus || el.editorStatus.classList.contains('hidden')) return;
  const doc = store.active();
  const text = doc && doc.editor ? doc.editor.getValue() : el.editor.value;
  const { words, chars, readMins } = wordCount(text);
  // v0.44.0: keep the editor outline in sync with edits (cheap — pure parse).
  rebuildEditorOutline();
  // v0.45.0: keep the stats panel in sync too.
  rebuildDocStats();
  const savedState = doc && doc.dirty ? 'dirty' : 'saved';
  // v1.6.2: bare words read cleaner than the old "· saved" — the leading
  // middot collided with the status bar's separator dots and looked like a
  // stray dirty-flag glyph.
  const savedLabel = doc && doc.dirty ? 'Edited' : 'Saved';

  // Selection detection
  let selText = '';
  if (doc && doc.mode === 'edit' && doc.editor) {
    const sel = doc.editor.getSelection();
    if (sel && sel.start !== sel.end) {
      selText = text.slice(sel.start, sel.end);
    }
  } else {
    const windowSel = window.getSelection();
    if (windowSel && !windowSel.isCollapsed) {
      selText = windowSel.toString();
    }
  }

  let selHtml = '';
  if (selText.trim().length > 0) {
    const selCounts = wordCount(selText);
    selHtml = `<span class="status-sep" aria-hidden="true">·</span><span class="status-sel">Selected: ${fmtNum(selCounts.words)} w, ${fmtNum(selCounts.chars)} c</span>`;
  }

  // Cursor line:col (v0.35.0). Only meaningful in edit mode where the editor
  // owns the caret. Computed from the selection start offset: line = number of
  // newlines before it + 1, col = chars since the last newline + 1.
  let posHtml = '';
  if (doc && doc.mode === 'edit' && doc.editor) {
    const sel = doc.editor.getSelection();
    const at = sel ? sel.start : 0;
    const before = text.slice(0, at);
    const line = before.split('\n').length;
    const col = at - (before.lastIndexOf('\n') + 1) + 1;
    posHtml = `<span class="status-sep" aria-hidden="true">·</span><span class="status-pos">Ln ${line}, Col ${col}</span>`;
  }

  el.editorStatus.innerHTML =
    `<span>${fmtNum(words)} words</span>` +
    `<span class="status-sep" aria-hidden="true">·</span>` +
    `<span>${fmtNum(chars)} chars</span>` +
    selHtml +
    (readMins > 0 && !selHtml
      ? `<span class="status-sep" aria-hidden="true">·</span><span>~${readMins} min read</span>`
      : '') +
    posHtml +
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
      activeLink.scrollIntoView({ block: 'nearest', behavior: 'auto' });
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
  document.documentElement.style.setProperty('--content-font-size', px);
  document.documentElement.style.setProperty('--zoom-level', String(zoomLevel));
  if (el.document) el.document.style.fontSize = px;
  if (el.preview) el.preview.style.fontSize = px;
  if (el.editor) el.editor.style.fontSize = px;
  if (el.gutter) el.gutter.style.fontSize = px;
  localStorage.setItem('mdpeek-zoom', String(zoomLevel));
  updateZoomIndicator();
  const activeDoc = store && store.docs ? store.docs.find((d) => d.id === store.activeId) : null;
  if (activeDoc && activeDoc.editor && activeDoc.editor.syncGutter) {
    activeDoc.editor.syncGutter();
  }
  if (_activeImage && typeof _activeImage.rerender === 'function') {
    _activeImage.rerender();
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

// v0.37.0: word-wrap + spellcheck are editor-attribute toggles. Both default
// to preserve prior behavior (wrap on, spellcheck off). Applied to the live
// textarea; new tabs pick up the setting on initEditor via editor.js.
function applyWordWrap() {
  const on = localStorage.getItem('mdpeek-word-wrap') !== '0';
  if (el.editor) {
    el.editor.setAttribute('wrap', on ? 'soft' : 'off');
    // v0.69.0: the attribute alone does nothing while the .editor CSS pins
    // white-space: pre-wrap — force the inline value so "off" really stops
    // wrapping ('' restores the CSS default for soft wrap).
    el.editor.style.whiteSpace = on ? '' : 'pre';
  }
  // The measurement mirror copies the textarea's wrapping regime, so
  // re-measure immediately: waiting for the next keystroke left the gutter
  // sized for the old wrap mode and the numbers drifted off their lines.
  const activeDoc = store && store.docs ? store.docs.find((d) => d.id === store.activeId) : null;
  if (activeDoc && activeDoc.editor && activeDoc.editor.syncGutter) {
    activeDoc.editor.syncGutter();
  }
}
function applySpellcheck() {
  const on = localStorage.getItem('mdpeek-spellcheck') === '1';
  if (el.editor) el.editor.spellcheck = on;
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

// ---------- auto-update (v0.32.0: moved into Settings → Updates) ----------
// The old topbar version button is gone. Status now drives:
//   • the Updates settings panel (badge text + install-row visibility)
//   • a body[data-update="update"] attribute that shows a pulse dot on the
//     Settings gear, so users still get notified without the dedicated button.

let _pendingUpdate = null; // cached update object once detected

function setUpdateStatus(state, versionLabel) {
  // Drive the body attribute (gear pulse dot) in every state.
  if (state === 'update') document.body.dataset.update = 'update';
  else delete document.body.dataset.update;

  // Drive the Settings → Updates panel badge + version label. The panel may
  // not exist yet (e.g. during early init or in jsdom tests), so null-check.
  const badge = el.updatesBadge;
  if (badge) {
    badge.classList.remove('state-idle', 'state-checking', 'state-latest', 'state-update', 'state-error');
    const map = {
      checking: ['state-checking', 'Checking…'],
      latest: ['state-latest', 'Up to date'],
      update: ['state-update', 'Update available'],
      error: ['state-error', 'Check failed'],
    };
    const [cls, txt] = map[state] || ['state-idle', 'Unknown'];
    badge.classList.add(cls);
    badge.textContent = txt;
  }
  if (versionLabel !== undefined && el.updatesCurrent) {
    el.updatesCurrent.textContent = `v${versionLabel}`;
  }
  // Show/hide the "Download & restart" row based on whether an update is pending.
  if (el.updatesInstallRow) {
    const has = state === 'update' && _pendingUpdate;
    el.updatesInstallRow.hidden = !has;
    if (has && _pendingUpdate && el.updatesReleaseNotes) {
      el.updatesReleaseNotes.textContent = `v${_pendingUpdate.version} is ready to install.`;
    }
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

// Updates panel wiring (Settings → Updates, v0.32.0).
// "Check now" runs a manual (non-silent) check; "Download & restart" installs
// a pending update. Replaces the old topbar version-button click handler.
if (el.updatesCheckBtn) {
  el.updatesCheckBtn.addEventListener('click', () => checkForUpdates(false));
}
if (el.updatesInstallBtn) {
  el.updatesInstallBtn.addEventListener('click', () => {
    if (_pendingUpdate) applyUpdate(_pendingUpdate);
  });
}
document.addEventListener('selectionchange', () => {
  updateEditorStatus();
});

// ---------- events ----------
el.open.addEventListener('click', openFileDialog);
el.save.addEventListener('click', saveActive);
el.mode.addEventListener('click', toggleMode);
if (el.export) el.export.addEventListener('click', exportHtml);
if (el.exportPdf) el.exportPdf.addEventListener('click', exportPdf);
document.getElementById('btn-copy-html')?.addEventListener('click', copyAsHtml);
document.getElementById('btn-copy-plaintext')?.addEventListener('click', copyAsPlainText);
document.getElementById('btn-open-browser')?.addEventListener('click', openInBrowser);
if (el.reading) el.reading.addEventListener('click', toggleReading);
// Reader overlay control buttons. Each is a no-op if Reading Mode isn't open
// (defensive — the buttons are inside the hidden overlay anyway).
document.getElementById('reader-exit')?.addEventListener('click', exitReading);
document.getElementById('reader-width-prev')?.addEventListener('click', () => readerCycleWidth(-1));
document.getElementById('reader-width-next')?.addEventListener('click', () => readerCycleWidth(1));
document.getElementById('reader-font-prev')?.addEventListener('click', () => readerCycleFont(-1));
document.getElementById('reader-font-next')?.addEventListener('click', () => readerCycleFont(1));
document.getElementById('reader-theme')?.addEventListener('click', readerCycleTheme);
document.getElementById('reader-font-family')?.addEventListener('click', readerCycleFontFamily);

// v0.67.0: floating back-to-top button for long documents. Appears after
// 400px of scroll in the document pane.
(function wireBackToTop() {
  const btt = document.getElementById('back-to-top');
  if (!btt || !el.document) return;
  el.document.addEventListener('scroll', () => {
    btt.classList.toggle('hidden', el.document.scrollTop < 400);
  }, { passive: true });
  btt.addEventListener('click', () => {
    el.document.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();
if (el.daily) el.daily.addEventListener('click', openDailyNote);

el.explorer.addEventListener('click', toggleExplorer);
el.fileTreeClose.addEventListener('click', toggleExplorer);
el.fileTreeOpen.addEventListener('click', openFolderForExplorer);
document.getElementById('btn-folder-search').addEventListener('click', findInFolder);
el.sidebar.addEventListener('click', toggleSidebar);
el.zoomIn.addEventListener('click', zoomIn);
el.zoomOut.addEventListener('click', zoomOut);
// Clicking the % badge resets to 100% (same as Ctrl+0).
if (el.zoomIndicator) el.zoomIndicator.addEventListener('click', zoomReset);
// ---------- theme grid wiring (Settings → Appearance, v0.32.0) ----------
// The topbar theme dropdown is gone; themes are picked from the grid.
if (el.themeGrid) {
  el.themeGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.theme-card');
    if (!card) return;
    // Selecting a specific theme implies manual mode from now on (so the
    // system/time scheduler doesn't immediately overwrite the user's pick).
    localStorage.setItem(THEME_MODE_KEY, 'manual');
    syncThemeModeSeg();
    applyTheme(card.dataset.theme);
  });
}

// v0.44.0: theme-mode segmented control (Manual / Match system / By time).
const themeModeSeg = document.getElementById('theme-mode-seg');

// Live OS-theme follow for "Match system" mode. Installed once, gated at fire
// time by the saved mode — so it also covers switching to system mode
// mid-session (the seg handler used to apply the theme once and never install
// the listener, leaving OS changes ignored until restart).
let _systemThemeListenerInstalled = false;
function ensureSystemThemeListener() {
  if (_systemThemeListenerInstalled) return;
  try {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', (ev) => {
      if ((localStorage.getItem(THEME_MODE_KEY) || 'manual') !== 'system') return;
      applyTheme(prefersDarkFromMedia(ev) ? 'dark' : 'light');
    });
    _systemThemeListenerInstalled = true;
  } catch { /* no matchMedia — theme stays static */ }
}

function syncThemeModeSeg() {
  const mode = localStorage.getItem(THEME_MODE_KEY) || 'manual';
  themeModeSeg?.querySelectorAll('.seg-btn').forEach((btn) => {
    const on = btn.dataset.mode === mode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    btn.tabIndex = on ? 0 : -1;
  });
}
if (themeModeSeg) {
  themeModeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const mode = btn.dataset.mode;
    localStorage.setItem(THEME_MODE_KEY, mode);
    syncThemeModeSeg();
    // Apply immediately so the user sees the effect.
    if (mode === 'system') {
      try {
        const mql = window.matchMedia('(prefers-color-scheme: dark)');
        applyTheme(prefersDarkFromMedia(mql) ? 'dark' : 'light');
      } catch { applyTheme(DEFAULT_THEME); }
      ensureSystemThemeListener();
    } else if (mode === 'time') {
      applyTheme(themeForHour(new Date().getHours()));
    } else {
      applyTheme(localStorage.getItem('mdpeek-theme') || DEFAULT_THEME);
    }
  });
  syncThemeModeSeg();
}

// ---------- more-menu wiring (topbar overflow, v0.32.0) ----------
// Opens a ctx-menu of document/export/tools actions. Items keep their original
// IDs, so the existing per-button handlers (bound elsewhere) still fire.
function openMoreMenu() {
  if (!el.moreMenu) return;
  clearMoreMenuFilter();
  syncMoreMenuGroups();
  el.moreMenu.classList.remove('hidden');
  el.moreBtn?.setAttribute('aria-expanded', 'true');
  // v1.8: the menu is filterable — land focus in the search so typing narrows
  // rows immediately; arrows hand off to the item list (menu keydown handler).
  (document.getElementById('more-search') ||
    el.moreMenu.querySelector('.ctx-item:not(.hidden):not([disabled])'))?.focus();
}
// v1.8: type-to-filter for the more-menu. Filtering uses a dedicated
// .mm-filtered class (NOT .hidden) so clearing the filter can never un-hide
// items the app state hid (feature flags, no-file states).
function applyMoreMenuFilter(query) {
  if (!el.moreMenu) return;
  const q = (query || '').trim().toLowerCase();
  const searchWrap = el.moreMenu.querySelector('.mm-search');
  searchWrap?.classList.toggle('has-value', !!q);
  el.moreMenu.querySelectorAll('.ctx-item').forEach((item) => {
    if (item.classList.contains('hidden')) return; // state-hidden stays hidden
    const label = item.querySelector('.ctx-label')?.textContent || '';
    item.classList.toggle('mm-filtered', !!q && !label.toLowerCase().includes(q));
  });
  syncMoreMenuGroups();
  const visible = [...el.moreMenu.querySelectorAll('.ctx-item')].some(
    (i) => !i.classList.contains('hidden') && !i.classList.contains('mm-filtered'));
  el.moreMenu.querySelector('.mm-empty')?.classList.toggle('hidden', visible);
}
function clearMoreMenuFilter() {
  if (!el.moreMenu) return;
  el.moreMenu.querySelectorAll('.mm-filtered').forEach((i) => i.classList.remove('mm-filtered'));
  const input = document.getElementById('more-search');
  if (input) input.value = '';
  el.moreMenu.querySelector('.mm-search')?.classList.remove('has-value');
  el.moreMenu.querySelector('.mm-empty')?.classList.add('hidden');
}
// v1.6.2: hide a group label (and the separator above it) when every item in
// the group is hidden. An orphaned "Tools" header with nothing beneath it
// reads as a rendering bug, not as "feature disabled".
function syncMoreMenuGroups() {
  if (!el.moreMenu) return;
  const kids = [...el.moreMenu.children];
  kids.forEach((k) => k.classList.remove('group-empty'));
  kids.forEach((kid, i) => {
    if (!kid.classList.contains('ctx-group-label')) return;
    // A group runs to the next label OR separator — the pinned Settings
    // footer sits after a separator and must not count as a Tools item.
    const slice = [];
    for (let j = i + 1; j < kids.length; j++) {
      if (kids[j].classList.contains('ctx-group-label') || kids[j].classList.contains('ctx-sep')) break;
      slice.push(kids[j]);
    }
    const hasVisible = slice.some((s) =>
      (s.classList.contains('ctx-item') || s.classList.contains('menu-zoom-row')) &&
      !s.classList.contains('hidden') && !s.classList.contains('mm-filtered') && s.style.display !== 'none');
    if (hasVisible) return;
    kid.classList.add('group-empty');
    // Drop the separator directly above an empty group too — otherwise the
    // menu ends in a dangling rule.
    for (let j = i - 1; j >= 0; j--) {
      if (kids[j].classList.contains('ctx-sep')) { kids[j].classList.add('group-empty'); break; }
      if (kids[j].classList.contains('ctx-item') || kids[j].classList.contains('menu-zoom-row') || kids[j].classList.contains('ctx-group-label')) break;
    }
  });
}
function closeMoreMenu() {
  if (!el.moreMenu || el.moreMenu.classList.contains('hidden')) return;
  el.moreMenu.classList.add('hidden');
  el.moreBtn?.setAttribute('aria-expanded', 'false');
  if (el.moreMenu.contains(document.activeElement)) el.moreBtn?.focus();
}
if (el.moreBtn) {
  el.moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (el.moreMenu.classList.contains('hidden')) openMoreMenu();
    else closeMoreMenu();
  });
}
// Click outside / Esc closes the more-menu. Items close the menu on click too
// (so the action doesn't leave the menu dangling behind a dialog/overlay).
document.addEventListener('click', (e) => {
  if (el.moreMenu && !el.moreMenu.classList.contains('hidden') && !e.target.closest('.more-menu-wrap')) {
    closeMoreMenu();
  }
});
if (el.moreMenu) {
  el.moreMenu.addEventListener('keydown', (e) => {
    const search = document.getElementById('more-search');
    // v1.8: typing anywhere in the menu jumps into the filter. The char itself
    // lands after focus moves (the default action targets the old element),
    // so append it manually for a seamless feel.
    if (search && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey &&
        document.activeElement !== search && !e.target.closest('.mm-search')) {
      search.focus();
      search.value = (search.value + e.key).slice(0, 100);
      applyMoreMenuFilter(search.value);
      e.preventDefault();
      return;
    }
    const items = [...el.moreMenu.querySelectorAll('button')].filter((item) => !item.disabled && item.getClientRects().length);
    const index = items.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  });
  el.moreMenu.addEventListener('click', (e) => {
    if (e.target.closest('.ctx-item')) closeMoreMenu();
  });
  // v1.8: live filter. Esc in the search clears first, closes second (the
  // document-level Esc closer handles the second press).
  const mmSearchInput = document.getElementById('more-search');
  mmSearchInput?.addEventListener('input', () => applyMoreMenuFilter(mmSearchInput.value));
  mmSearchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mmSearchInput.value) {
      e.preventDefault();
      e.stopPropagation();
      clearMoreMenuFilter();
      mmSearchInput.focus();
    }
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMoreMenu();
});

// ---------- command-K pill wiring (v0.32.0) ----------
// Opens the command palette (same as Ctrl+Shift+P). The pill is the calm
// centerpiece of the new topbar. The `palette` object is created by
// initCommandPalette() above and exposes .open().
if (el.cmdK) {
  el.cmdK.addEventListener('click', () => {
    palette.open();
  });
}
document.getElementById('btn-save-as').addEventListener('click', () => saveActiveAs());

// ---------- settings dialog ----------
// One place to tune every preference. Each control reads/writes a localStorage
// key and applies the change live where possible (theme, find-case). New-tab
// prefs take effect on the next +/Ctrl+N. All controls are wired once.
const SETTING_KEYS = [
  'mdpeek-new-tab-format',
  'mdpeek-new-tab-mode',
  'mdpeek-theme',
  THEME_MODE_KEY,
  'mdpeek-close-action',
  'mdpeek-find-case',
  'mdpeek-base-font',
  'mdpeek-line-height',
  'mdpeek-line-numbers',
  'mdpeek-code-line-numbers',
  'mdpeek-font-family',
  'mdpeek-autosave',
  'mdpeek-tab-size',
  'mdpeek-word-wrap',
  'mdpeek-spellcheck',
  'mdpeek-smart-paste',
  'mdpeek-image-beside-doc',
  'mdpeek-user-css',
  'mdpeek-reader-toc',
];

let _changelogRendered = false;
function openSettings(cat) {
  syncSettingsControls();
  if (_settingsSearchInput) _settingsSearchInput.value = '';
  applySettingsSearch('');
  el.settingsDialog.classList.remove('hidden');
  // Open on the requested category (or General for predictability)
  const firstCat = el.settingsDialog.querySelector(`.settings-cat[data-cat="${cat || 'general'}"]`) ||
    el.settingsDialog.querySelector('.settings-cat[data-cat="general"]');
  if (firstCat && !firstCat.classList.contains('active')) firstCat.click();
  // Put focus inside the dialog: its Esc handler is dialog-scoped, so with
  // focus left on the opening button Esc was dead until the user Tabbed in.
  const searchInput = el.settingsDialog.querySelector('#settings-search');
  (searchInput || el.settingsDialog.querySelector('button, input, select, [tabindex]'))?.focus();
}
function closeSettings() {
  const hadFocus = el.settingsDialog.contains(document.activeElement);
  el.settingsDialog.classList.add('hidden');
  syncModalFocus();
  // v1.6.2: Settings lives inside the more-menu; when the menu is closed the
  // item has no layout, so return focus to the ⋯ button that opened it.
  if (hadFocus) {
    const target = el.settings?.getClientRects().length ? el.settings : el.moreBtn;
    target?.focus();
  }
}

// Read current pref values from localStorage and reflect them in the modal's
// controls (active states, selected options, checkbox). Called on open and
// after Reset.
function syncSettingsControls() {
  const fmtSel = document.getElementById('settings-new-tab-format');
  if (fmtSel) fmtSel.value = localStorage.getItem('mdpeek-new-tab-format') || 'home';
  const modePref = localStorage.getItem('mdpeek-new-tab-mode') || 'view';
  setSegActive('new-tab-mode', modePref);
  // v0.44.0: theme-mode segmented control sync.
  syncThemeModeSeg();

  // v0.32.0: theme is now a visual grid (no <select>). Sync the active card
  // ring + aria-checked from the stored theme. applyThemeImpl also does this,
  // but the grid must be correct when Settings opens even if the theme was
  // last applied before this code path existed.
  const currentTheme = localStorage.getItem('mdpeek-theme') || 'light';
  document.querySelectorAll('.theme-card').forEach((card) => {
    const isActive = card.dataset.theme === currentTheme;
    card.classList.toggle('active', isActive);
    card.setAttribute('aria-checked', isActive ? 'true' : 'false');
    card.tabIndex = isActive ? 0 : -1;
  });

  // Auto-update toggle (Settings → Updates). Default on (null/anything but '0').
  const autoUpdCb = document.getElementById('settings-auto-update');
  if (autoUpdCb) autoUpdCb.checked = localStorage.getItem('mdpeek-auto-update') !== '0';

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

  // Code-block line numbers default OFF (opt-in, unlike the editor gutter).
  const codeLineNumCb = document.getElementById('settings-code-line-numbers');
  if (codeLineNumCb) codeLineNumCb.checked = localStorage.getItem('mdpeek-code-line-numbers') === '1';

  const activeLineCb = document.getElementById('settings-active-line');
  if (activeLineCb) activeLineCb.checked = localStorage.getItem('mdpeek-active-line') !== '0';

  const autosaveCb = document.getElementById('settings-autosave');
  if (autosaveCb) autosaveCb.checked = localStorage.getItem('mdpeek-autosave') !== '0';

  // v0.37.0: tab-size select + word-wrap + spellcheck checkboxes.
  const tabSizeSel = document.getElementById('settings-tab-size');
  if (tabSizeSel) tabSizeSel.value = localStorage.getItem('mdpeek-tab-size') || '2';
  const wordWrapCb = document.getElementById('settings-word-wrap');
  if (wordWrapCb) wordWrapCb.checked = localStorage.getItem('mdpeek-word-wrap') !== '0';
  const spellcheckCb = document.getElementById('settings-spellcheck');
  if (spellcheckCb) spellcheckCb.checked = localStorage.getItem('mdpeek-spellcheck') === '1';
  // v0.45.0: smart-paste defaults ON (absence of '0' = on).
  const smartPasteCb = document.getElementById('settings-smart-paste');
  if (smartPasteCb) smartPasteCb.checked = localStorage.getItem('mdpeek-smart-paste') !== '0';

  // v0.40.0: portable pasted images — save beside the doc + relative link.
  const imageBesideDocCb = document.getElementById('settings-image-beside-doc');
  if (imageBesideDocCb) imageBesideDocCb.checked = localStorage.getItem('mdpeek-image-beside-doc') !== '0';

  // v0.51.0: OS notifications — opt-in (default off).
  const osNotifyCb = document.getElementById('settings-os-notifications');
  if (osNotifyCb) osNotifyCb.checked = osNotificationsEnabled();

  // v0.41.0: custom CSS textarea + reader-TOC toggle state.
  const userCssTa = document.getElementById('settings-user-css');
  if (userCssTa) userCssTa.value = localStorage.getItem('mdpeek-user-css') || '';

  // Notes folder display — show configured path or auto-initialize with system default.
  const notesPath = document.getElementById('settings-notes-path');
  if (notesPath) {
    let dir = localStorage.getItem('mdpeek-notes-dir');
    if (!dir) {
      invoke('get_default_notes_dir').then((defaultDir) => {
        if (defaultDir && !localStorage.getItem('mdpeek-notes-dir')) {
          localStorage.setItem('mdpeek-notes-dir', defaultDir);
          notesPath.textContent = defaultDir;
          notesPath.classList.remove('unset');
        }
      }).catch(() => {
        notesPath.textContent = 'Not set';
        notesPath.classList.add('unset');
      });
    } else {
      notesPath.textContent = dir;
      notesPath.classList.remove('unset');
    }
  }

  // Feature flags synchronization
  const features = ['snippets', 'daily', 'autocomplete', 'table-editor'];
  features.forEach((feat) => {
    const cb = document.getElementById(`settings-feature-${feat}`);
    if (cb) cb.checked = localStorage.getItem(`mdpeek-feature-${feat}`) !== '0';
  });

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

function applyFeatureFlags() {
  if (el.daily) el.daily.style.display = isFeatureOn('daily') ? '' : 'none';

  syncMoreMenuGroups();
}

function setSegActive(setting, value) {
  const seg = el.settingsDialog.querySelector(`.seg[data-setting="${setting}"]`);
  if (!seg) return;
  seg.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.value === value);
    b.setAttribute('aria-pressed', String(b.dataset.value === value));
  });
}

el.settings.addEventListener('click', () => openSettings());
const closeBtn = document.getElementById('settings-close-btn');
if (closeBtn) closeBtn.addEventListener('click', closeSettings);
el.settingsDialog.addEventListener('keydown', (e) => {
  const radio = e.target.closest('[role="radio"]');
  if (!radio || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
  const items = [...radio.closest('[role="radiogroup"]').querySelectorAll('[role="radio"]')].filter((item) => !item.disabled);
  const index = items.indexOf(radio);
  const delta = ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1;
  const next = e.key === 'Home' ? items[0] : e.key === 'End' ? items.at(-1) : items[(index + delta + items.length) % items.length];
  e.preventDefault();
  next?.focus();
  next?.click();
});
const resetBtn = document.getElementById('settings-reset');
if (resetBtn) {
  resetBtn.addEventListener('click', async () => {
    // Destructive + irreversible (custom CSS dies too) — confirm first, and
    // actually reset everything: SETTING_KEYS alone missed Minimal mode,
    // the feature flags and the notes folder, so the label lied.
    const ok = await confirmDialog({
      title: 'Reset all settings?',
      text: 'This restores every setting to its default, including your custom CSS and feature toggles. This can\u2019t be undone.',
      buttons: [
        { id: 'cancel', label: 'Cancel', kind: 'secondary' },
        { id: 'reset', label: 'Reset everything', kind: 'danger' },
      ],
    }).catch(() => null);
    if (ok !== 'reset') return;
    // Wipe every app-pref key except user data (open tabs, SRS progress,
    // writing days, recents) so "settings" never means "your notes".
    const keep = new Set(['mdpeek-session', 'mdpeek-srs-cards', 'mdpeek-writing-days', 'mdpeek-recents']);
    const wipe = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mdpeek-') && !keep.has(k)) wipe.push(k);
    }
    for (const k of wipe) localStorage.removeItem(k);
    // Apply defaults live.
    applyTheme('light');
    if (find) find.setCaseSensitive(false);
    applyReadingComfort();
    applyLineNumbers();
    applyWordWrap();
    applySpellcheck();
    syncSettingsControls();
    toast('Settings reset to defaults', { type: 'success' });
  });
}

// v0.42.0: export/import settings as JSON. Only keys in SETTING_KEYS are
// touched (no arbitrary localStorage injection on import). Values are
// type-checked to strings. After import every live apply* helper re-runs so
// the UI reflects the new state immediately.
function exportSettings() {
  const data = {};
  for (const k of SETTING_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) data[k] = v;
  }
  data.__exported_at = new Date().toISOString();
  if (BUILD_VERSION) data.__app_version = BUILD_VERSION;
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mdpeek-settings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Settings exported');
  } catch (e) {
    toast('Could not export: ' + fmtErr(e));
  }
}

function importSettings() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error('file is not a settings object');
      }
      let count = 0;
      for (const k of SETTING_KEYS) {
        if (k in data && typeof data[k] === 'string') {
          localStorage.setItem(k, data[k]);
          count++;
        }
      }
      // Re-apply all live state so the UI matches the imported prefs.
      applyTheme(localStorage.getItem('mdpeek-theme') || 'light');
      if (find) find.setCaseSensitive(localStorage.getItem('mdpeek-find-case') === '1');
      applyLineNumbers();
      applyWordWrap();
      applySpellcheck();
      applyUserCss();
      applyReadingComfort();
      syncSettingsControls();
      toast(`Imported ${count} setting${count === 1 ? '' : 's'}`);
    } catch (e) {
      toast('Could not import: ' + fmtErr(e));
    }
  };
  input.click();
}

document.getElementById('settings-export')?.addEventListener('click', exportSettings);
document.getElementById('settings-import')?.addEventListener('click', importSettings);

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
  // Switching categories always exits search mode first so the panel the
  // user picked is shown cleanly (not the stacked search-results view).
  if (_settingsSearchInput && _settingsSearchInput.value) {
    _settingsSearchInput.value = '';
    applySettingsSearch('');
  }
  const name = cat.dataset.cat;
  settingsSidebar.querySelectorAll('.settings-cat').forEach((b) => {
    b.classList.toggle('active', b === cat);
    b.setAttribute('aria-current', b === cat ? 'page' : 'false');
  });
  el.settingsDialog.querySelectorAll('.settings-panel').forEach((p) => {
    p.classList.toggle('hidden', p.dataset.cat !== name);
  });
  _settingsContentEl.scrollTop = 0;
  if (name === 'changelog' && !_changelogRendered) {
    const changelogEl = document.getElementById('changelog-content');
    if (changelogEl) {
      changelogEl.innerHTML = renderMarkdown(changelogSource);
      // Keep release-note headings and footnotes separate from workspace IDs.
      const ids = new Map();
      changelogEl.querySelectorAll('[id]').forEach((node) => {
        ids.set(node.id, `changelog-${node.id}`);
        node.id = ids.get(node.id);
      });
      changelogEl.querySelectorAll('a[href^="#"]').forEach((link) => {
        const target = ids.get(link.getAttribute('href').slice(1));
        if (target) link.setAttribute('href', `#${target}`);
      });
      _changelogRendered = true;
    }
  }
});

// ---------- Settings search (v0.65.0) ----------
// Live filter across every panel: typing stacks all panels (grouped by
// compact section labels) with non-matching rows/cards hidden; clearing
// restores the category view. The DOM filter lives in src/lib so the
// restore path is unit-tested (the browser harness can't send key events).
const _settingsSearchInput = document.getElementById('settings-search');
const _settingsSearchWrap = _settingsSearchInput?.closest('.settings-search');
const _settingsContentEl = el.settingsDialog.querySelector('.settings-content');
const _settingsEmpty = document.getElementById('settings-search-empty');

function applySettingsSearch(q) {
  if (!_settingsContentEl) return;
  const query = (q || '').trim().toLowerCase();
  const active = settingsSidebar?.querySelector('.settings-cat.active');
  const hits = filterSettingsPanels(el.settingsDialog, query, active ? active.dataset.cat : null);
  if (!query) {
    _settingsContentEl.classList.remove('searching');
    _settingsSearchWrap?.classList.remove('has-value');
    _settingsEmpty?.classList.add('hidden');
    return;
  }
  _settingsContentEl.classList.add('searching');
  _settingsSearchWrap?.classList.add('has-value');
  _settingsEmpty?.classList.toggle('hidden', hits > 0);
  _settingsContentEl.scrollTop = 0;
}

if (_settingsSearchInput) {
  _settingsSearchInput.addEventListener('input', (e) => applySettingsSearch(e.target.value));
  // Esc clears a query first; with an empty query it closes the dialog.
  _settingsSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (_settingsSearchInput.value) {
        _settingsSearchInput.value = '';
        applySettingsSearch('');
      } else {
        closeSettings();
      }
    }
  });
}

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

// Theme is now chosen via the Appearance grid (wired above via delegation on
// #theme-grid). The old <select id="settings-theme"> was removed in v0.32.0.

// Auto-update toggle (Settings → Updates, v0.32.0). Persists the pref that
// gates the startup silent check. Default on.
const _autoUpdCb = document.getElementById('settings-auto-update');
if (_autoUpdCb) {
  _autoUpdCb.addEventListener('change', (e) => {
    if (e.target.checked) localStorage.removeItem('mdpeek-auto-update');
    else localStorage.setItem('mdpeek-auto-update', '0');
  });
}

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

// Code-block line numbers (fenced blocks in rendered Markdown). Off by default.
// Re-renders the active doc so the gutter appears/disappears immediately.
document.getElementById('settings-code-line-numbers')?.addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-code-line-numbers', e.target.checked ? '1' : '0');
  // Re-render the active document so the gutter change is visible at once.
  // The viewer/editor read the flag fresh on each render.
  renderActive().catch((err) => console.error('[mdpeek] code-line-numbers re-render:', err));
});

// Active line highlight — toggle the line marker strip.
document.getElementById('settings-active-line')?.addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-active-line', e.target.checked ? '1' : '0');
  if (el.editMode) {
    const ta = el.editMode.querySelector('.editor');
    if (ta) ta.dispatchEvent(new Event('input'));
  }
});

// v0.37.0: tab size — writes the key; editor-logic reads it live on next Tab.
// Also nudges the textarea's tabSize CSS so the rendered spacing matches.
document.getElementById('settings-tab-size')?.addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-tab-size', e.target.value);
  if (el.editor) el.editor.style.tabSize = e.target.value;
});

// Word wrap — soft-wrap vs horizontal scroll. Default on.
document.getElementById('settings-word-wrap')?.addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-word-wrap', e.target.checked ? '1' : '0');
  applyWordWrap();
});

// Spellcheck — editor squiggles. Default off.
document.getElementById('settings-spellcheck')?.addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-spellcheck', e.target.checked ? '1' : '0');
  applySpellcheck();
});

// v0.51.0: OS notifications — opt-in. Enabling proactively requests the OS
// permission so the prompt fires here (not deferred to the first notification).
document.getElementById('settings-os-notifications')?.addEventListener('change', (e) => {
  setOsNotificationsEnabled(e.target.checked);
  if (e.target.checked) {
    // Fire the permission request immediately; ignore the result (the first
    // real notifyOs() call re-checks + re-requests if needed).
    notifyOs({ title: 'mdpeek', body: 'Desktop notifications are on' }).catch(() => {});
  }
});

// v0.45.0: smart paste — URL→link, HTML→markdown. Default ON ('1' is implied
// by the absence of '0', so we store '0' only when disabled).
document.getElementById('settings-smart-paste')?.addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-smart-paste', e.target.checked ? '1' : '0');
});

// v0.40.0: pasted/dropped images save beside the doc + use a relative link.
// Default on (portable). No apply* helper needed — insertImageFromBlob reads
// the setting fresh on every paste.
document.getElementById('settings-image-beside-doc')?.addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-image-beside-doc', e.target.checked ? '1' : '0');
});

// v0.41.0: custom CSS. Debounced save + live apply so the user sees changes
// without closing settings (the styles hit every .markdown-body surface).
let _userCssTimer = null;
document.getElementById('settings-user-css')?.addEventListener('input', (e) => {
  clearTimeout(_userCssTimer);
  _userCssTimer = setTimeout(() => {
    localStorage.setItem('mdpeek-user-css', e.target.value || '');
    applyUserCss();
  }, 300);
});

// Notes folder — re-pick where daily notes are saved.
document.getElementById('settings-notes-pick')?.addEventListener('click', () => {
  changeNotesFolder();
});

// Auto-save — toggle the debounced save-on-idle behavior.
document.getElementById('settings-autosave')?.addEventListener('change', (e) => {
  localStorage.setItem('mdpeek-autosave', e.target.checked ? '1' : '0');
  if (!e.target.checked) clearTimeout(_autoSaveTimer);
});

// Feature flags change handlers
['snippets', 'daily', 'autocomplete', 'table-editor'].forEach((feat) => {
  const cb = document.getElementById(`settings-feature-${feat}`);
  if (cb) {
    cb.addEventListener('change', (e) => {
      localStorage.setItem(`mdpeek-feature-${feat}`, e.target.checked ? '1' : '0');
      applyFeatureFlags();
      // v0.41.0: dismissing the dropdown when autocomplete is toggled off
      // mid-typing avoids a dangling popup.
      if (feat === 'autocomplete' && !e.target.checked) autocomplete.hide();
    });
  }
});

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
  if (doc && doc.image) {
    el.pdfDrawToolbar.classList.toggle('hidden');
    // Exiting: turn off draw mode on whichever controller is active.
    if (el.pdfDrawToolbar.classList.contains('hidden')) {
      const target = _activeImage;
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
  const target = _activeImage;
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
  const target = _activeImage;
  if (target) target.setColor(color);
}

document.getElementById('pdf-tool-pen').addEventListener('click', () => pdfSelectTool('pen'));
document.getElementById('pdf-tool-highlighter').addEventListener('click', () => pdfSelectTool('highlighter'));
document.getElementById('pdf-tool-eraser').addEventListener('click', () => pdfSelectTool('eraser'));
document.querySelectorAll('.pdf-color-swatch').forEach((s) => {
  s.addEventListener('click', () => pdfSelectColor(s.dataset.color));
});
document.getElementById('pdf-tool-clear').addEventListener('click', () => {
  const target = _activeImage;
  if (target) target.clearAll();
});
document.getElementById('pdf-tool-close').addEventListener('click', () => {
  el.pdfDrawToolbar.classList.add('hidden');
  document.querySelectorAll('.pdf-tool-btn').forEach((b) => b.classList.remove('active'));
  const target = _activeImage;
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
  return /\.(md|markdown|mdx|txt)$/i.test(href) || !href.includes('.');
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
    // v0.40.0: if the target is a markdown file, offer to create it on click
    // rather than just dead-ending. One deliberate click prevents typos from
    // silently writing junk files.
    if (/\.(md|markdown|mdx)$/i.test(normalized)) {
      const displayName = normalized.replace(/\\/g, '/').split('/').pop();
      toast(`${displayName} not found — click to create`, {
        onClick: () => createAndOpenMissingLink(fullPath, displayName),
      });
    } else {
      toast('Linked file not found: ' + href);
    }
  }
}

// v0.40.0: create a missing wiki-link / md-link target on demand. Writes a
// small H1 starter (so the new doc isn't blank) then opens it in a tab and
// refreshes the explorer so the file appears in the tree. Mirrors the
// daily-note create idiom at the daily-note builder.
async function createAndOpenMissingLink(fullPath, displayName) {
  const title = displayName.replace(/\.(md|markdown|mdx)$/i, '');
  const starter = `# ${title}\n\n`;
  try {
    await invoke('save_file', { path: fullPath, content: starter });
    await openPath(fullPath, starter);
    refreshTree();
    toast(`Created ${displayName}`);
  } catch (e) {
    toast('Could not create: ' + fmtErr(e));
  }
}

// In-document anchors (footnote refs, [x](#heading) links) scroll in place
// with a brief target flash — the DOMPurify hook no longer forces target=_blank
// on hash-only hrefs, so without this they'd be dead default jumps.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const target = el.document.querySelector(decodeURIComponent(a.getAttribute('href')));
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.classList.remove('anchor-flash');
  void target.offsetWidth;
  target.classList.add('anchor-flash');
  setTimeout(() => target.classList.remove('anchor-flash'), 1600);
});

// Welcome-screen action buttons (Open / New / Daily / Clear recents) —
// delegated so they work regardless of when the welcome HTML is (re)rendered.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.welcome-action, .recent-clear, .recent-sample, .welcome-minimal-explore');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'open') openFileDialog();
  else if (action === 'new') {
    // The welcome card promises "Start writing instantly" — honor it by
    // landing in the editor, not on another welcome screen (Ctrl+N and the
    // tab-strip + still honor the new-tab-format setting).
    store.open({ path: null, content: '', mode: 'edit' });
    store.active()?.editor?.focus();
  }
  else if (action === 'sample') store.open({ path: null, content: SAMPLE_DOC, mode: 'view' });
  else if (action === 'explore-features') openSettings('features');
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

// v0.67.0: keyboard support. Tabs are role=tab + tabindex (roving, see
// renderTabs): arrows move focus within the strip, Enter/Space activate the
// focused tab. The close button is a real <button> and is left alone.
el.tabStrip.addEventListener('keydown', (e) => {
  if (e.target.closest('.tab-close')) return;
  const tab = e.target.closest ? e.target.closest('.tab') : null;
  if (!tab) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const tabs = Array.from(el.tabStrip.querySelectorAll('.tab'));
    const i = tabs.indexOf(tab);
    const next = tabs[e.key === 'ArrowRight' ? Math.min(tabs.length - 1, i + 1) : Math.max(0, i - 1)];
    if (next) {
      tabs.forEach((t) => { t.tabIndex = -1; });
      next.tabIndex = 0;
      next.focus();
    }
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    store.switch(tab.dataset.id);
    const doc = store.active();
    if (doc) rewatch(doc.path).catch(() => {});
  }
});

// v0.67.0: drag-to-reorder. dragstart carries the id; dropping on another tab
// in the same pinned group calls store.moveDoc. Cross-group drops (pinned ↔
// unpinned) are ignored to keep the pinned partition intact.
let _dragTabId = null;
el.tabStrip.addEventListener('dragstart', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  _dragTabId = tab.dataset.id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', _dragTabId); } catch { /* ignore */ }
  }
});
el.tabStrip.addEventListener('dragover', (e) => {
  if (!_dragTabId) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
});
el.tabStrip.addEventListener('drop', (e) => {
  const dragId = _dragTabId;
  _dragTabId = null;
  if (!dragId) return;
  const target = e.target.closest ? e.target.closest('.tab') : null;
  e.preventDefault();
  if (!target || target.dataset.id === dragId) return;
  const dragged = store.docs.find((d) => d.id === dragId);
  const targetDoc = store.docs.find((d) => d.id === target.dataset.id);
  if (!dragged || !targetDoc || dragged.pinned !== targetDoc.pinned) return;
  const group = store.docs.filter((d) => d.pinned === dragged.pinned);
  const idx = group.findIndex((d) => d.id === targetDoc.id);
  store.moveDoc(dragId, idx);
});
el.tabStrip.addEventListener('dragend', () => { _dragTabId = null; });

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
let _tocLast = 0;
el.document.addEventListener('scroll', () => {
  if (_progressRaf) return;
  _progressRaf = requestAnimationFrame(() => {
    _progressRaf = 0;
    updateReadingProgress();
    const now = performance.now();
    if (now - _tocLast >= 150) {
      _tocLast = now;
      updateActiveTocLink();
    }
  });
}, { passive: true });

// Task order spans all lists, including nested lists. Native change events
// cover pointer clicks and keyboard toggles on each reading surface.
function onTaskChange(e) {
  const target = e.target;
  if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
  const itemIndex = [...e.currentTarget.querySelectorAll('li input[type="checkbox"]')].indexOf(target);
  if (itemIndex < 0) return;
  togglePreviewCheckbox(itemIndex);
}
for (const surface of [el.document, el.preview, el.readerArticle]) surface.addEventListener('change', onTaskChange);

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
  // v0.41.0: re-evaluate the autocomplete trigger after each keystroke.
  // Gated by the mdpeek-autocomplete feature flag (default on).
  if (localStorage.getItem('mdpeek-feature-autocomplete') !== '0') {
    autocomplete.refresh();
  }
});

// Image paste into the editor. If the clipboard has an image (screenshot,
// copied picture), intercept it and insert as markdown instead of doing
// nothing. Only fires in edit mode (the textarea is hidden otherwise).
el.editor.addEventListener('paste', (e) => {
  const doc = store.active();
  if (!doc || doc.mode !== 'edit' || doc.plain) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  // Image branch: screenshots / copied pictures → save beside doc + embed.
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
  // v0.45.0: smart text paste. URL over a selection → markdown link; rich
  // HTML → markdown. Gated by mdpeek-smart-paste (default on). Falls through
  // to the browser's default paste when smartPaste returns null.
  if (localStorage.getItem('mdpeek-smart-paste') === '0') return;
  const html = e.clipboardData.getData('text/html') || '';
  const text = e.clipboardData.getData('text/plain') || '';
  const sel = doc.editor.getSelection();
  const selText = sel && sel.start !== sel.end ? doc.editor.getValue().slice(sel.start, sel.end) : '';
  const r = smartPaste({ text, html, sel: { ...sel, text: selText } });
  if (r) {
    e.preventDefault();
    doc.editor.replaceRange(sel.start, sel.end, r.text);
    doc.editor.setState({ start: r.start, end: r.end });
    const v = doc.editor.getValue();
    if (doc.content !== v) {
      doc.content = v;
      store.markDirty(doc.id);
      persistSoon();
      scheduleAutoSave();
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
  const doc = store.active();
  _autoSaveTimer = setTimeout(() => autoSaveActive(doc), AUTO_SAVE_DELAY);
}
async function autoSaveActive(doc = store.active()) {
  if (!doc || !doc.path || !doc.dirty) return;
  setSaveStatus('saving');
  try {
    if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
    const content = doc.content;
    await invoke('save_file', { path: doc.path, content });
    if ((doc.editor?.getValue() ?? doc.content) === content) store.clearDirty(doc.id);
    if (store.active()?.id === doc.id) setSaveStatus(doc.dirty ? 'dirty' : 'saved');
  } catch (e) {
    setSaveStatus('error');
  }
}
function setSaveStatus(state) {
  if (!el.editorStatus || el.editorStatus.classList.contains('hidden')) return;
  const tag = el.editorStatus.querySelector('.save-status');
  if (!tag) return;
  const map = {
    dirty: 'Edited',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
  };
  tag.textContent = map[state] || '';
  tag.dataset.state = state;
}

// Keyboard shortcuts — registered on the CAPTURE phase so we intercept the
// zoom keys before WebView2 can swallow them for native browser zoom.
window.addEventListener('keydown', (e) => {
  if (modalOwnsKeyboard()) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  // Modified commands have their own handlers below. Don't run Ctrl+S/E/F
  // first and accidentally save, switch mode or open find as well.
  if (e.altKey || (e.shiftKey && !['g', '=', '+', '-', '_'].includes(k))) return;
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
  } else if (k === 'g' && e.shiftKey) {
    // Ctrl+Shift+G = previous match (repeat last search even when closed).
    // Ctrl+G was reassigned to Go to line in v0.37.0 — F3 / Shift+F3 / Enter
    // in the find bar still cover next/prev.
    e.preventDefault();
    find.findPrev();
  } else if (k === 'g') {
    // Ctrl+G = Go to line (v0.37.0). Matches VS Code / Sublime convention.
    e.preventDefault();
    gotoLine();
  } else if (k === '=' || k === '+' || e.code === 'NumpadAdd') {
    e.preventDefault();
    zoomIn();
  } else if (k === '-' || k === '_' || e.code === 'NumpadSubtract') {
    e.preventDefault();
    zoomOut();
  } else if (k === '0' || e.code === 'Numpad0') {
    e.preventDefault();
    zoomReset();
  } else if (k === ',') {
    // Ctrl+, → open settings. Conventional keybind (VS Code, most editors).
    // No Shift, so it can't clash with anything in the Shift+ handler below.
    e.preventDefault();
    e.stopPropagation();
    openSettings();
  }
}, true);

// Tree keyboard shortcuts: Cut / Copy / Paste / Delete / Rename. ONLY fire
// when a tree row was the last thing clicked AND focus isn't in the editor or
// an input — otherwise we'd hijack normal text-editing shortcuts.
window.addEventListener('keydown', (e) => {
  if (modalOwnsKeyboard()) return;
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
  if (modalOwnsKeyboard()) return;
  if (e.key !== 'F3') return;
  e.preventDefault();
  if (e.shiftKey) find.findPrev();
  else find.findNext();
}, true);

// F11 = toggle focus/zen mode (hides header + sidebar). Capture phase +
// preventDefault so WebView2 doesn't also fire native fullscreen. Escape exits
// focus mode (handled here, before any other Escape handler can grab it).
window.addEventListener('keydown', (e) => {
  if (modalOwnsKeyboard()) return;
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
  // v0.45.0: Ctrl+Alt+T → reopen closed tab. (Ctrl+Shift+T is typewriter, so
  // Alt is the free modifier here.)
  if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && (e.key === 'T' || e.key === 't')) {
    e.preventDefault();
    e.stopPropagation();
    reopenClosedTab();
    return;
  }
  // Ctrl+Alt+S → Save As…
  if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && (e.key === 'S' || e.key === 's')) {
    e.preventDefault();
    e.stopPropagation();
    saveActiveAs();
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
  // Ctrl+Shift+S → open Markdown snippet/template picker.
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
    if (!isFeatureOn('snippets')) return;
    e.preventDefault();
    e.stopPropagation();
    snippetPicker.open();
    return;
  }
  // Ctrl+Shift+F → find-in-folder content search (v0.50.0). Conventional
  // project-search shortcut; no conflict (plain Ctrl+F is in-document find).
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
    e.preventDefault();
    e.stopPropagation();
    findInFolder();
    return;
  }
  // Ctrl+Shift+R → toggle immersive Reading Mode.
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
    e.preventDefault();
    e.stopPropagation();
    toggleReading();
    return;
  }
  // Ctrl+Shift+A → toggle always-on-top (pin). Mirrors the titlebar pin button.
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
    e.preventDefault();
    e.stopPropagation();
    toggleAlwaysOnTop();
    return;
  }
  // Reader-internal keys. Only active while Reading Mode is open, and only
  // when no modifier is held (so Ctrl+[ etc. keep their browser meaning).
  // Esc exits, [ / ] narrow / widen, + / - grow / shrink text, T cycles theme.
  if (document.body.classList.contains('reading') && !(e.ctrlKey || e.metaKey || e.altKey)) {
    if (e.key === 'Escape') {
      e.preventDefault();
      exitReading();
      return;
    }
    if (e.key === '[') { e.preventDefault(); readerCycleWidth(-1); return; }
    if (e.key === ']') { e.preventDefault(); readerCycleWidth(1); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); readerCycleFont(1); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); readerCycleFont(-1); return; }
    if (e.key === 't' || e.key === 'T') { e.preventDefault(); readerCycleTheme(); return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); readerCycleFontFamily(); return; }
    // v0.41.0: toggle the outline sidebar.
    if (e.key === 'o' || e.key === 'O') { e.preventDefault(); toggleReaderToc(); return; }
  }
  // Esc peels open modal layers, topmost first, BEFORE the workspace-hub
  // branch below — a dialog stacked over the hub must close the dialog, not
  // the hub. Scoped dialog handlers still work when focus is inside them;
  // this global path covers focus left outside (e.g. after the palette
  // closed and restored focus to chrome).
  if (e.key === 'Escape') {
    if (!el.closeDialog.classList.contains('hidden')) {
      e.preventDefault();
      e.stopPropagation();
      hideCloseDialog();
      return;
    }
    if (!el.settingsDialog.classList.contains('hidden')) {
      // The settings search input owns Esc (clears the query first, then
      // blurs; a later Esc closes the dialog). Don't slam the dialog shut
      // from above it.
      if (e.target && _settingsSearchInput && e.target === _settingsSearchInput) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      closeSettings();
      return;
    }
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
  e.stopPropagation();
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
async function doQuitApp() {
  // Flush the active doc's live state before the process goes away — unsaved
  // keystrokes inside the editor's debounce window would otherwise never
  // reach the session or disk. Awaited so quit_app can't race the final write.
  try {
    const d = store.active();
    if (d) {
      if (d.mode === 'edit' && d.editor) d.content = d.editor.getValue();
      persist();
      if (d.path && d.dirty) {
        await invoke('save_file', { path: d.path, content: d.content });
        store.clearDirty(d.id);
      }
    }
  } catch (e) { console.error('quit flush failed:', e); }
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
  // Focus Cancel (the safe choice) so Esc/Enter act without a blind Tab first.
  document.getElementById('close-cancel')?.focus();
}

function hideCloseDialog() {
  el.closeDialog.classList.add('hidden');
  syncModalFocus();
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

// v0.36.0: Always-on-top toggle (pin button in the titlebar + Ctrl+Shift+A).
// Useful when taking notes alongside a browser/PDF. setAlwaysOnTop is a Tauri
// window call; in browser dev it throws, so the button stays hidden and the
// shortcut no-ops (guarded by the same try/catch). State is reflected in the
// button's aria-pressed + an "active" class for styling.
const winPinBtn = document.getElementById('win-pin');
let alwaysOnTop = false;
async function toggleAlwaysOnTop() {
  try {
    alwaysOnTop = !alwaysOnTop;
    await appWindow.setAlwaysOnTop(alwaysOnTop);
    if (winPinBtn) {
      winPinBtn.setAttribute('aria-pressed', String(alwaysOnTop));
      winPinBtn.classList.toggle('active', alwaysOnTop);
      winPinBtn.title = alwaysOnTop ? 'Disable always on top (Ctrl+Shift+A)' : 'Always on top (Ctrl+Shift+A)';
    }
  } catch (e) {
    console.error('setAlwaysOnTop failed:', e);
    alwaysOnTop = !alwaysOnTop; // roll back the optimistic flip
  }
}
if (winPinBtn) {
  winPinBtn.addEventListener('click', toggleAlwaysOnTop);
  // Reveal the button only when the Tauri API is actually available — keeps
  // browser dev clean (no dead/decorative button).
  appWindow.setAlwaysOnTop(false).then(() => {
    winPinBtn.hidden = false;
  }).catch(() => { /* browser dev — leave hidden */ });
}
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
    // Images, PDFs, and audio/video are binary but natively supported — skip
    // the binary rejection and load with empty content (the viewers use the
    // asset protocol to read bytes directly).
    const isSupportedBinary = isImagePath(name);
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
  // Per-path guard: one unreadable file (permissions, vanished mid-drop) must
  // not abort opening the rest of the dropped batch.
  for (const p of paths) {
    try {
      await openDroppedPath(p);
    } catch (e) {
      console.error('[mdpeek] drop open failed for', p, e);
      const base = String(p).split(/[\\/]/).pop() || String(p);
      toast('Could not open: ' + base);
    }
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
      const isSupportedBinary = isImagePath(file.name);
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
// The trailing .catch only covers listener *registration* failure. The body
// itself is wrapped in try/catch because a corrupt-on-disk change (malformed
// CSV, a parseCsv/renderCsv throw) would otherwise escape as an
// unhandled error and silently stop live-reload working for that doc.
listen('file-changed', (event) => {
  try {
    const changed = applyFileChange(store, event.payload);
    if (!changed) return;
    const { doc, conflict } = changed;
    if (conflict) {
      notify('File changed on disk', `${basename(doc.path)} was edited externally — your unsaved edits were kept`);
      return;
    }
    persistSoon();
    if (store.active()?.id !== doc.id) return;
    const content = doc.content;
    // Code files in view mode: re-render the syntax highlighted view on disk change.
    if (doc.code && doc.mode === 'view') {
      if (store.active()?.id === doc.id) {
        el.document.innerHTML = renderCode(content, langFromPath(doc.path));
      }
      return;
    }
    // CSV/TSV files: re-render the table and re-init the viewer on disk change.
    if (doc.csv) {
      if (store.active()?.id === doc.id) {
        if (_activeCsv) { _activeCsv.destroy(); _activeCsv = null; }
        const tsv = /\.tsv$/i.test(doc.path || '');
        try {
          el.document.innerHTML = renderCsv(content, { tsv });
          _activeCsv = initCsvViewer(el.document, parseCsv(content, tsv));
        } catch (e) {
          console.error('[mdpeek] csv reload failed:', e);
          showViewerError(el.document, 'CSV/TSV file', e);
        }
      }
      return;
    }
    if (doc.mode === 'view') {
      const id = doc.id;
      showDocument(el.document, content)
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
      doc.editor.setValue(content);
    }
  } catch (e) {
    // A throw anywhere above (e.g. event.payload shaped unexpectedly) must not
    // kill the listener for future events — log and carry on.
    console.error('[mdpeek] file-changed handler failed:', e);
  }
}).catch((e) => console.error('file-changed listener failed:', e));

// Opened via external double-click (cold start: get_initial_file; hot: open-file event)
listen('open-file', (event) => {
  try {
    const { path, content, is_dir } = event.payload;
    if (is_dir) {
      localStorage.setItem('mdpeek-explorer-root', path);
      setTreeRoot(path);
      if (el.fileTree.classList.contains('hidden')) toggleExplorer();
    } else {
      openPath(path, content).catch((e) => toast('Open failed: ' + fmtErr(e)));
    }
  } catch (e) {
    console.error('[mdpeek] open-file:', e);
  }
}).catch((e) => console.error('open-file listener failed:', e));

window.addEventListener('hljs-language-registered', () => {
  renderActive().catch(() => {});
});

// ---------- init ----------
// (v0.34.0) installHljsThemes() is also called early — right after the el
// cache near the top of this module — because Tauri API calls below can abort
// module execution in the browser dev environment. This idempotent call is a
// safety net for the production build where the early call always succeeds.
installHljsThemes();
// v0.44.0: theme scheduling. If mode is 'system', follow the OS theme; if
// 'time', pick by local hour. Otherwise the user's saved theme wins. We also
// install the listeners here so changes propagate live without a restart.
const themeMode = localStorage.getItem(THEME_MODE_KEY) || 'manual';
if (themeMode === 'system') {
  try {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    applyTheme(prefersDarkFromMedia(mql) ? 'dark' : 'light');
  } catch {
    applyTheme(DEFAULT_THEME);
  }
  ensureSystemThemeListener();
} else if (themeMode === 'time') {
  applyTheme(themeForHour(new Date().getHours()));
  // Re-check every 5 minutes so a long-running session crosses day/night.
  setInterval(() => {
    applyTheme(themeForHour(new Date().getHours()));
  }, 5 * 60 * 1000);
} else {
  const savedTheme = localStorage.getItem('mdpeek-theme');
  applyTheme(savedTheme && HLJS_FOR_THEME[savedTheme] ? savedTheme : DEFAULT_THEME);
}

// v0.32.0: render lucide icons + wire ripples. The function declaration
// hoists, so it can be called early (right after the `el` cache, before any
// Tauri code that might abort module execution in browser dev). Idempotent.
function bootMotion() {
  try { renderIcons(document.body); } catch (e) { console.error('[mdpeek] renderIcons:', e); }
  try { wireRipples(document.body); } catch (e) { console.error('[mdpeek] wireRipples:', e); }
  positionTabIndicator({ strip: el.tabStrip, indicator: el.tabStrip?.querySelector('.tab-indicator') });
}
// Keep the tab indicator aligned on resize (pill widths shift with the window).
window.addEventListener('resize', () => {
  positionTabIndicator({ strip: el.tabStrip, indicator: el.tabStrip?.querySelector('.tab-indicator') });
});

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
applyWordWrap();
applySpellcheck();
applyFeatureFlags();
applyUserCss();

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
      const restored = await restoreSessionDocs(candidates, invoke);
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
    if (el.updatesCurrent) el.updatesCurrent.textContent = `v${v}`;
  })
  .catch(() => {});

setUpdateStatus('checking');

// Check for updates in the background a few seconds after launch (silent: no
// toast if up-to-date). Delayed so the network call doesn't contend with
// initial render + session restore. v0.32.0: gated by the auto-update pref
// (default on) — users can opt out from Settings → Updates.
setTimeout(() => {
  const auto = localStorage.getItem('mdpeek-auto-update');
  if (auto === '0') return; // explicitly opted out
  checkForUpdates(true);
}, UPDATE_CHECK_DELAY_MS);

// Runtime version override: if the Tauri getVersion() call resolves (real
// Tauri build), it overwrites the build-time value already written early at
// the top of this module. In browser/jsdom it rejects and we keep BUILD_VERSION.
// (v0.34.1: the early write + BUILD_VERSION live near bootMotion/installHljsThemes
// because the Tauri window code further up aborts module execution in dev.)
if (typeof getVersion === 'function') {
  getVersion().then((v) => {
    if (el.updatesCurrent) el.updatesCurrent.textContent = `v${v}`;
  }).catch(() => { /* ignore — falls back to BUILD_VERSION or 'v—' */ });
}
