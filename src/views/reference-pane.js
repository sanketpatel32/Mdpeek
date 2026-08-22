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
let countEl;       // .ref-count (word-count chip in the header)
let closeBtn;      // .ref-close
let bodyEl;        // .ref-body (the rendered markdown article)
let refreshBtn;    // .ref-refresh (manual re-render fallback)
let getContentCb = null; // () => { name, content } | null
let onNavigateCb = null; // () => void — caller opens a doc picker

// UI-polish styles owned by this view. Injected once as an id-guarded <style>
// so re-init after resetForTest stays cheap; every value references the global
// tokens from themes.css/base.css, so all themes pick these up.
function injectPolishStyles() {
  if (document.getElementById('reference-pane-polish')) return;
  const style = document.createElement('style');
  style.id = 'reference-pane-polish';
  style.textContent = `
    /* Count header chip: a quiet accent pill that answers "how big is this?"
       without stealing attention from the title. Tabular digits stop the pill
       from shifting width as the count changes. */
    .ref-count {
      flex: none;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
      padding: 3px 8px;
      border-radius: 999px;
      color: var(--accent);
      background: var(--accent-soft);
      font-variant-numeric: tabular-nums;
      user-select: none;
    }
    /* Header buttons: a small hover lift (+ press dip) makes the pane chrome
       feel tactile; guarded so reduced-motion users just get the color change
       that already lives in base.css. */
    .ref-actions button {
      transition: background var(--dur-1) var(--ease-out),
                  color var(--dur-1) var(--ease-out);
    }
    @media (prefers-reduced-motion: no-preference) {
      .ref-actions button { transition: transform var(--dur-1) var(--ease-spring), background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out); }
      .ref-actions button:hover { transform: translateY(-1px); }
      .ref-actions button:active { transform: translateY(0) scale(0.92); }
    }
    /* Empty state: icon + message reads as deliberate, not broken. */
    .ref-empty {
      padding: var(--sp-7, 40px) var(--sp-4, 16px);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-3, 12px);
      color: var(--fg-muted);
      font-size: 13px;
      text-align: center;
    }
    .ref-empty-icon {
      width: 40px;
      height: 40px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 18px;
    }
    .ref-empty p { margin: 0; }
    /* Link-out affordance: external links grow a faint ↗ that nudges up-right
       on hover — signals "leaves this pane" without cluttering every link. */
    .ref-body a[href^="http"]::after {
      content: "\\2197";
      display: inline-block;
      font-size: 0.72em;
      margin-left: 2px;
      opacity: 0.55;
    }
    .ref-body a[href^="http"] { transition: color var(--dur-1) var(--ease-out); }
    .ref-body a[href^="http"]:hover::after {
      opacity: 1;
      color: var(--accent);
    }
    @media (prefers-reduced-motion: no-preference) {
      .ref-body a[href^="http"]::after { transition: transform var(--dur-1) var(--ease-spring), opacity var(--dur-1) var(--ease-out); }
      .ref-body a[href^="http"]:hover::after { transform: translate(2px, -2px); }
    }
  `;
  document.head.appendChild(style);
}

function build() {
  overlay = document.createElement('aside');
  overlay.id = 'reference-pane';
  overlay.className = 'reference-pane hidden';
  overlay.setAttribute('aria-label', 'Reference document');
  overlay.innerHTML = ''
    + '<div class="ref-header">'
    +   '<span class="ref-title">Reference</span>'
    +   '<span class="ref-count hidden"></span>'
    +   '<div class="ref-actions">'
    +     '<button class="ref-pick" type="button" title="Pick a different doc" aria-label="Pick a different doc">⇄</button>'
    +     '<button class="ref-refresh" type="button" title="Refresh" aria-label="Refresh">⟳</button>'
    +     '<button class="ref-close" type="button" title="Close" aria-label="Close reference pane">✕</button>'
    +   '</div>'
    + '</div>'
    + '<article class="ref-body markdown-body"></article>';
  document.body.appendChild(overlay);
  titleEl = overlay.querySelector('.ref-title');
  countEl = overlay.querySelector('.ref-count');
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
  injectPolishStyles();
  build();
  getContentCb = getContent || null;
  onNavigateCb = onNavigate || null;
  created = true;
  return { open, close, render, resetForTest };
}

// Rough word count for the header chip — presentation only, so a whitespace
// split is plenty (no need for the real prose tokenizer in wordfreq.js).
function wordCount(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  return words.length;
}

// Re-render the pane from the current getContent() snapshot. Called on open,
// on refresh-button click, and by main.js when the source doc changes.
function render() {
  if (!created || !getContentCb) return;
  const data = getContentCb();
  if (!data) {
    titleEl.textContent = 'Reference';
    countEl.classList.add('hidden');
    bodyEl.innerHTML = ''
      + '<div class="ref-empty">'
      +   '<span class="ref-empty-icon" aria-hidden="true">⌕</span>'
      +   '<p>No reference doc selected.</p>'
      + '</div>';
    return;
  }
  titleEl.textContent = data.name || 'Reference';
  titleEl.title = data.name || '';
  // Header count chip: hide for an empty doc rather than showing "0 words".
  const words = wordCount(data.content);
  countEl.textContent = words.toLocaleString() + (words === 1 ? ' word' : ' words');
  countEl.classList.toggle('hidden', words === 0);
  // renderer.js is already in the main bundle (main.js/editor.js/viewer.js all
  // import it statically), so a direct call is cheaper than a dynamic import.
  try {
    bodyEl.innerHTML = renderMarkdown(data.content || '');
    if (enhanceDom) enhanceDom(bodyEl, { mermaid: true });
  } catch {
    countEl.classList.add('hidden');
    bodyEl.innerHTML = ''
      + '<div class="ref-empty">'
      +   '<span class="ref-empty-icon" aria-hidden="true">⚠</span>'
      +   '<p>Could not render.</p>'
      + '</div>';
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
  overlay = titleEl = countEl = closeBtn = refreshBtn = bodyEl = null;
  getContentCb = onNavigateCb = null;
}
