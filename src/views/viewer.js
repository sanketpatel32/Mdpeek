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

// Renders `content` (markdown string) into `el`. Returns a promise that resolves
// after mermaid diagrams are enhanced.
export async function showDocument(el, content) {
  el.innerHTML = renderMarkdown(content);
  await enhanceDom(el, { lineNumbers: codeLineNumbersOn(), proseHighlights: proseHighlightsOn() });
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
    tocEl.innerHTML = '';
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
