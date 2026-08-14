// v0.45.0: Reference pane — a floating, read-only rendered view of a second
// document shown beside the active doc's editor. Lets you keep a reference
// doc open while editing another (e.g. notes beside a draft).
//
// Scoped intentionally as read-only: a fully editable second editor would
// require either swapping the textarea for CodeMirror or major surgery on the
// shared-textarea editor lifecycle. This pane reuses renderMarkdown (the same
// renderer the live preview uses) and refreshes when the source doc changes.
//
// Singleton like the tag pane: one DOM element appended to <body>, shown/
// hidden by toggling `.hidden`. The caller (main.js) supplies a `getContent`
// callback that returns the current markdown for the chosen doc, so this view
// stays free of store/IPC coupling.

import { renderMarkdown, enhanceDom } from '../lib/renderer.js';

let created = false;
let overlay;       // #reference-pane
let titleEl;       // .ref-title (doc name)
let closeBtn;      // .ref-close
let bodyEl;        // .ref-body (the rendered markdown article)
let refreshBtn;    // .ref-refresh (manual re-render fallback)
let getContentCb = null; // () => { name, content } | null
let onNavigateCb = null; // () => void — caller opens a doc picker

function build() {
  overlay = document.createElement('aside');
  overlay.id = 'reference-pane';
  overlay.className = 'reference-pane hidden';
  overlay.setAttribute('aria-label', 'Reference document');
  overlay.innerHTML = ''
    + '<div class="ref-header">'
    +   '<span class="ref-title">Reference</span>'
    +   '<div class="ref-actions">'
    +     '<button class="ref-pick" type="button" title="Pick a different doc" aria-label="Pick a different doc">⇄</button>'
    +     '<button class="ref-refresh" type="button" title="Refresh" aria-label="Refresh">⟳</button>'
    +     '<button class="ref-close" type="button" title="Close" aria-label="Close reference pane">✕</button>'
    +   '</div>'
    + '</div>'
    + '<article class="ref-body markdown-body"></article>';
  document.body.appendChild(overlay);
  titleEl = overlay.querySelector('.ref-title');
  closeBtn = overlay.querySelector('.ref-close');
  refreshBtn = overlay.querySelector('.ref-refresh');
  bodyEl = overlay.querySelector('.ref-body');
  overlay.querySelector('.ref-pick').addEventListener('click', () => {
    if (onNavigateCb) onNavigateCb();
  });
  refreshBtn.addEventListener('click', () => render());
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    // !defaultPrevented: dismissing a picker/modal Esc must not cascade.
    if (e.key === 'Escape' && !e.defaultPrevented && isOpen()) close();
  });
}

function isOpen() {
  return created && overlay && !overlay.classList.contains('hidden');
}

export function initReferencePane({ getContent, onNavigate } = {}) {
  if (created) return { open, close, render, resetForTest };
  build();
  getContentCb = getContent || null;
  onNavigateCb = onNavigate || null;
  created = true;
  return { open, close, render, resetForTest };
}

// Re-render the pane from the current getContent() snapshot. Called on open,
// on refresh-button click, and by main.js when the source doc changes.
function render() {
  if (!created || !getContentCb) return;
  const data = getContentCb();
  if (!data) {
    titleEl.textContent = 'Reference';
    bodyEl.innerHTML = '<div class="ref-empty">No reference doc selected.</div>';
    return;
  }
  titleEl.textContent = data.name || 'Reference';
  titleEl.title = data.name || '';
  // renderer.js is already in the main bundle (main.js/editor.js/viewer.js all
  // import it statically), so a direct call is cheaper than a dynamic import.
  try {
    bodyEl.innerHTML = renderMarkdown(data.content || '');
    if (enhanceDom) enhanceDom(bodyEl, { mermaid: true });
  } catch {
    bodyEl.innerHTML = '<div class="ref-empty">Could not render.</div>';
  }
}

function open() {
  if (!created) return;
  overlay.classList.remove('hidden');
  render();
}

function close() {
  if (!created) return;
  overlay.classList.add('hidden');
}

function resetForTest() {
  if (overlay) overlay.remove();
  created = false;
  overlay = titleEl = closeBtn = refreshBtn = bodyEl = null;
  getContentCb = onNavigateCb = null;
}
