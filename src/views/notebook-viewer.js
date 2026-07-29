// v0.49.0: Jupyter notebook (.ipynb) viewer. Read-only, like the code/CSV
// viewers. Mirrors the image-viewer controller shape: showNotebook() returns
// { container, destroy() }. The parseable core is in src/lib/notebook.js (pure,
// unit-tested); this module owns the DOM: laying out cells as markdown blocks
// (via renderMarkdown), code cells (via renderCode), and their outputs (text /
// image data-URIs / error tracebacks).
//
// Non-throwing: a malformed notebook renders a visible error banner instead of
// a blank canvas (same affordance as the PDF viewer's load error).

import { parseNotebook } from '../lib/notebook.js';
import { renderMarkdown, renderCode, prepareCodeLang, enhanceDom } from '../lib/renderer.js';

export function showNotebook(container, content) {
  container.classList.add('notebook-viewer');
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

  // Ensure the kernel language is registered (python is in the common build, so
  // this is usually a no-op) before the first synchronous render. Rarer kernels
  // register async; we render immediately with plaintext then re-render.
  let renderedLang = language;
  prepareCodeLang(language).then((ready) => {
    if (destroyed || ready) return;
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

  function renderCellHtml(cell) {
    if (cell.type === 'markdown') {
      return `<section class="nb-cell nb-markdown"><div class="markdown-body">${renderMarkdown(cell.source)}</div></section>`;
    }
    if (cell.type === 'raw') {
      return `<section class="nb-cell nb-raw"><pre class="nb-raw-pre">${escapeHtml(cell.source)}</pre></section>`;
    }
    // code cell
    const prompt = Number.isInteger(cell.execCount) ? `In [${cell.execCount}]` : 'In [ ]';
    const outputs = (cell.outputs || []).map(renderOutputHtml).join('');
    return (
      `<section class="nb-cell nb-code">` +
      `<div class="nb-prompt nb-prompt-in">${escapeHtml(prompt)}</div>` +
      `<div class="nb-code-input">${renderCode(cell.source || '', renderedLang)}</div>` +
      outputs +
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

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
