// v0.49.0: Jupyter notebook (.ipynb) viewer. Read-only, like the code/CSV
// viewers. Mirrors the image-viewer controller shape: showNotebook() returns
// { container, destroy() }. The parseable core is in src/lib/notebook.js (pure,
// unit-tested); this module owns the DOM: laying out cells as markdown blocks
// (via renderMarkdown), code cells (via renderCode), and their outputs (text /
// image data-URIs / error tracebacks).
//
// Non-throwing: a malformed notebook renders a visible error banner instead of
// a blank canvas (same affordance as the PDF viewer's load error).
//
// Polish layer (injected, id-guarded): subtle color-coded cell-type badges,
// inset output panels, tabular-nums execution-count chips, mono rendering
// polish for code cells, a collapse-cell chevron on every cell, and a centered
// empty-notebook state. Presentation/interaction only — parsing, rendering and
// the controller contract are unchanged.

import { parseNotebook } from '../lib/notebook.js';
import { renderMarkdown, renderCode, prepareCodeLang, enhanceDom } from '../lib/renderer.js';

// ---------- injected polish styles ----------
// Idempotent: one <style id="notebook-polish-style"> in <head>, re-entry is a
// no-op. Tokens come from themes.css (--sp-*, --dur-*, --radius*, --accent…)
// with literal fallbacks so cells still render if injected before theme load.
const NOTEBOOK_POLISH_CSS = `
@keyframes nb-fade-up {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}

/* Cell header row: collapse chevron + cell-type badge. Code cells are grids,
   so the head gets its own row via the extended grid-template-areas below;
   markdown/raw cells simply stack it above the body. */
.nb-cell-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2, 6px);
  padding: var(--sp-2, 6px) var(--sp-3, 8px) 0;
}
.nb-code > .nb-cell-head { grid-area: head; padding-bottom: 0; }
.nb-code {
  grid-template-rows: auto auto 1fr;
  grid-template-areas: "head head" "in input" "out out";
}
/* Code-cell bodies dissolve into the section grid so prompt/input/output keep
   their named areas; collapsed wins by specificity and hides everything. */
.nb-code > .nb-cell-body { display: contents; }
.nb-cell.nb-collapsed .nb-cell-body { display: none; }

/* Collapse affordance: quiet ghost chevron that rotates when folded. */
.nb-collapse {
  width: 20px;
  height: 20px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm, 5px);
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition:
    background-color var(--dur-1, 120ms) var(--ease-out, ease),
    color var(--dur-1, 120ms) var(--ease-out, ease);
}
.nb-collapse:hover { background: var(--surface-hover); color: var(--fg); }
.nb-collapse:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring, 0 0 0 2px color-mix(in srgb, var(--accent, #4a90d9) 45%, transparent));
}
.nb-collapse svg {
  width: 13px;
  height: 13px;
  transition: transform var(--dur-2, 180ms) var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}
.nb-collapsed .nb-collapse svg { transform: rotate(-90deg); }

/* Cell-type badges: quiet uppercase pills, tinted per type. */
.nb-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--sp-2, 6px);
  border-radius: 999px;
  font-family: var(--font-ui, system-ui, sans-serif);
  font-size: 9.5px;
  font-weight: 700;
  line-height: 15px;
  letter-spacing: 0.07em;
  user-select: none;
}
.nb-badge-code {
  color: var(--accent, #4a90d9);
  background: var(--accent-soft, rgba(74, 144, 217, 0.12));
}
.nb-badge-markdown {
  color: var(--fg-muted);
  background: color-mix(in srgb, var(--fg-muted) 10%, transparent);
}
.nb-badge-raw {
  color: var(--fg-muted);
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--border-subtle, #e6e7ed);
}

/* Execution-count prompts become chips with aligned digits.
   In [n] takes the accent; Out [n] stays muted so results lead the eye. */
.nb-prompt {
  justify-self: end;
  align-self: start;
  margin: 10px var(--sp-2, 6px) 0 0;
  padding: 0 var(--sp-2, 6px);
  border-radius: 999px;
  font-size: 11px;
  line-height: 17px;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--accent, #4a90d9);
  background: color-mix(in srgb, var(--accent, #4a90d9) 10%, transparent);
}
.nb-output-data .nb-prompt-out {
  color: var(--fg-muted);
  background: color-mix(in srgb, var(--fg-muted) 10%, transparent);
}

/* Output areas: inset panels instead of full-bleed divider rows. */
.nb-output {
  margin: var(--sp-2, 6px) var(--sp-3, 8px);
  padding: var(--sp-2, 6px) var(--sp-3, 8px);
  border: 1px solid var(--border-subtle, #e6e7ed);
  border-radius: var(--radius-sm, 5px);
  background: color-mix(in srgb, var(--fg) 3%, transparent);
}
.nb-output-error {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger, #ff3b30) 18%, transparent);
}

/* Code cell mono polish: pinned mono stack, no ligature surprises, roomier
   leading so highlighted tokens breathe. */
.nb-code-input pre,
.nb-code-input code {
  font-family: var(--font-mono, monospace);
  font-variant-ligatures: none;
}
.nb-code-input pre {
  line-height: 1.55;
  letter-spacing: 0.005em;
  tab-size: 4;
}

/* Empty notebook: centered reassurance instead of a blank canvas. */
.nb-empty-state {
  min-height: 62vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2, 6px);
  text-align: center;
  font-size: 13px;
  color: var(--fg-muted);
  animation: nb-fade-up var(--dur-3, 240ms) var(--ease-out, ease);
}
.nb-empty-glyph {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--sp-1, 4px);
  border-radius: var(--radius-lg, 12px);
  font-family: var(--font-mono, monospace);
  font-size: 15px;
  font-weight: 700;
  color: var(--accent, #4a90d9);
  background: var(--accent-soft, rgba(74, 144, 217, 0.12));
}
.nb-empty-title {
  font-weight: 600;
  color: var(--fg-secondary, var(--fg));
}

@media (prefers-reduced-motion: reduce) {
  .nb-empty-state { animation: none; }
  .nb-collapse svg { transition: none; }
}
`;

function ensureNotebookPolishStyle() {
  if (document.getElementById('notebook-polish-style')) return;
  const style = document.createElement('style');
  style.id = 'notebook-polish-style';
  style.textContent = NOTEBOOK_POLISH_CSS;
  document.head.appendChild(style);
}

// Collapse wiring is delegated on the (persistent) container and survives the
// re-render that happens when an async language grammar lands. The dataset
// guard keeps repeated showNotebook() calls from stacking listeners.
function wireCollapse(container) {
  if (container.dataset.nbCollapseWired === '1') return;
  container.dataset.nbCollapseWired = '1';
  container.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.nb-collapse') : null;
    if (!btn || !container.contains(btn)) return;
    const cell = btn.closest('.nb-cell');
    if (!cell) return;
    const collapsed = cell.classList.toggle('nb-collapsed');
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btn.title = collapsed ? 'Expand cell' : 'Collapse cell';
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function showNotebook(container, content) {
  container.classList.add('notebook-viewer');
  ensureNotebookPolishStyle();
  let destroyed = false;

  const { cells, language, error } = parseNotebook(content);

  if (error) {
    container.innerHTML =
      `<div class="pdf-error notebook-error">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="pdf-error-icon"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>` +
      `<div class="pdf-error-text"><strong>Couldn't open notebook</strong><br>${escapeHtml(error)}</div>` +
      `</div>`;
    return { container, destroy() { destroyed = true; } };
  }

  // Empty notebook: a designed "nothing here" state rather than blank space.
  if (!cells.length) {
    container.innerHTML =
      `<div class="notebook-doc"><div class="nb-empty-state" role="status">` +
      `<span class="nb-empty-glyph">{ }</span>` +
      `<span class="nb-empty-title">Empty notebook</span>` +
      `<span>This .ipynb doesn&rsquo;t contain any cells.</span>` +
      `</div></div>`;
    return { container, destroy() { destroyed = true; } };
  }

  wireCollapse(container);

  // Ensure the kernel language is registered (python is in the common build, so
  // this is usually a no-op) before the first synchronous render. Rarer kernels
  // register async; we render immediately with plaintext then re-render.
  let renderedLang = language;
  prepareCodeLang(language).then((ready) => {
    // v0.67.0: fixed inverted guard — re-render only when the grammar DID
    // land async (ensureLang resolves true on success).
    if (destroyed || !ready) return;
    // Re-render once the language grammar lands.
    renderCells();
  });

  function renderCells() {
    if (destroyed) return;
    const html = cells.map(renderCellHtml).join('');
    container.innerHTML = `<div class="notebook-doc">${html}</div>`;
    // enhanceDom wires copy buttons on code blocks, image click-zoom, etc.
    // Non-blocking; failures (e.g. a quirky cell) must never blank the view.
    enhanceDom(container, { mermaid: false }).catch(() => {});
  }

  // Header row shared by every cell: fold chevron + color-coded type badge.
  function cellHeadHtml(badgeCls, label) {
    return (
      `<div class="nb-cell-head">` +
      `<button type="button" class="nb-collapse" aria-expanded="true" title="Collapse cell" aria-label="Collapse or expand cell">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>` +
      `</button>` +
      `<span class="nb-badge ${badgeCls}">${label}</span>` +
      `</div>`
    );
  }

  function renderCellHtml(cell) {
    if (cell.type === 'markdown') {
      return (
        `<section class="nb-cell nb-markdown">` +
        cellHeadHtml('nb-badge-markdown', 'MARKDOWN') +
        `<div class="nb-cell-body"><div class="markdown-body">${renderMarkdown(cell.source)}</div></div>` +
        `</section>`
      );
    }
    if (cell.type === 'raw') {
      return (
        `<section class="nb-cell nb-raw">` +
        cellHeadHtml('nb-badge-raw', 'RAW') +
        `<div class="nb-cell-body"><pre class="nb-raw-pre">${escapeHtml(cell.source)}</pre></div>` +
        `</section>`
      );
    }
    // code cell
    const prompt = Number.isInteger(cell.execCount) ? `In [${cell.execCount}]` : 'In [ ]';
    const outputs = (cell.outputs || []).map(renderOutputHtml).join('');
    return (
      `<section class="nb-cell nb-code">` +
      cellHeadHtml('nb-badge-code', 'CODE') +
      `<div class="nb-cell-body">` +
      `<div class="nb-prompt nb-prompt-in">${escapeHtml(prompt)}</div>` +
      `<div class="nb-code-input">${renderCode(cell.source || '', renderedLang)}</div>` +
      outputs +
      `</div>` +
      `</section>`
    );
  }

  function renderOutputHtml(out) {
    if (out.kind === 'error') {
      const tb = out.traceback.length ? out.traceback.join('\n') : `${out.ename}: ${out.evalue}`;
      return `<div class="nb-output nb-output-error"><pre>${escapeHtml(tb)}</pre></div>`;
    }
    if (out.kind === 'stream') {
      if (!out.text) return '';
      const cls = out.name === 'stderr' ? ' nb-output-stderr' : '';
      return `<div class="nb-output nb-output-stream${cls}"><pre>${escapeHtml(out.text)}</pre></div>`;
    }
    // result / display
    let body = '';
    if (out.png) {
      body = `<img class="nb-output-img" alt="output" src="data:image/png;base64,${out.png}" />`;
    } else if (out.jpeg) {
      body = `<img class="nb-output-img" alt="output" src="data:image/jpeg;base64,${out.jpeg}" />`;
    } else if (out.text) {
      body = `<pre>${escapeHtml(out.text)}</pre>`;
    } else {
      return ''; // display_data with no renderable payload
    }
    const label = out.kind === 'result' && Number.isInteger(out.executionCount) ? `Out [${out.executionCount}]` : '';
    return `<div class="nb-output nb-output-data">${label ? `<div class="nb-prompt nb-prompt-out">${escapeHtml(label)}</div>` : ''}${body}</div>`;
  }

  renderCells();

  return {
    container,
    destroy() { destroyed = true; },
  };
}
