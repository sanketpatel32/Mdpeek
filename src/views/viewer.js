import { renderMarkdown, enhanceDom } from '../lib/renderer.js';

// v0.34.0: line numbers on fenced code blocks are opt-in (off by default). Read
// once per render so a setting toggle takes effect on the next render without
// a page reload.
function codeLineNumbersOn() {
  try { return localStorage.getItem('mdpeek-code-line-numbers') === '1'; }
  catch { return false; }
}

// v0.53.0: prose highlights (complex-word underlines + dense-paragraph tint)
// are opt-in. Read fresh each render so the toggle takes effect on re-render.
// v0.54.0: short-circuit under Minimal mode so the overlay never renders even
// if the plain key was left '1' from before Minimal was turned on.
function proseHighlightsOn() {
  try {
    if (localStorage.getItem('mdpeek-minimal-mode') === '1') return false;
    return localStorage.getItem('mdpeek-prose-highlights') === '1';
  }
  catch { return false; }
}

// v0.55.0: word-frequency underline overlay (overused 5+ use words). Same
// opt-in + Minimal-suppression rules as prose highlights.
function wordFreqOn() {
  try {
    if (localStorage.getItem('mdpeek-minimal-mode') === '1') return false;
    return localStorage.getItem('mdpeek-wordfreq-underline') === '1';
  }
  catch { return false; }
}

// Renders `content` (markdown string) into `el`. Returns a promise that resolves
// after mermaid diagrams are enhanced. Non-throwing: if the parser or enhancer
// throws on malformed input, a visible error banner is shown instead of leaving
// the pane blank (which would read to the user as "rendering is broken").
export async function showDocument(el, content) {
  let html;
  try {
    html = renderMarkdown(content);
  } catch (e) {
    console.error('[mdpeek] renderMarkdown failed:', e);
    el.innerHTML =
      `<div class="pdf-error">` +
      `<div>Couldn't render this document: ${escapeHtml(e && e.message ? e.message : String(e))}</div>` +
      `</div>`;
    return;
  }
  el.innerHTML = html;
  try {
    await enhanceDom(el, { lineNumbers: codeLineNumbersOn(), proseHighlights: proseHighlightsOn(), wordFreq: wordFreqOn() });
  } catch (e) {
    // Enhance failure (e.g. a quirky mermaid diagram) must never blank the
    // already-rendered body — the markdown is still readable, just without
    // the enhancement. Log and move on.
    console.error('[mdpeek] enhanceDom failed:', e);
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Builds a table of contents from h1-h3 inside `root` and injects it into the
// element with id="toc". The renderer assigns GitHub-style slug ids to headings
// (see renderer.js); we reuse those so in-document anchors and TOC links point
// at the same target. Headings without an id (e.g. empty text) get a fallback.
export function buildToc(root) {
  const tocEl = document.getElementById('toc');
  if (!tocEl) return;
  const headings = root.querySelectorAll('h1, h2, h3');
  if (headings.length === 0) {
    // Say so instead of showing a blank rail.
    tocEl.innerHTML = '<div class="toc-empty">No headings yet</div>';
    return;
  }
  const items = [];
  headings.forEach((h, i) => {
    const id = h.id || `h-${i}`;
    h.id = id;
    items.push(`<li class="toc-${h.tagName.toLowerCase()}"><a href="#${id}">${h.textContent}</a></li>`);
  });
  tocEl.innerHTML = `<ul>${items.join('')}</ul>`;
}
