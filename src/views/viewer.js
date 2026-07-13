import { renderMarkdown, enhanceDom } from '../lib/renderer.js';

// Renders `content` (markdown string) into `el`. Returns a promise that resolves
// after mermaid diagrams are enhanced.
export async function showDocument(el, content) {
  el.innerHTML = renderMarkdown(content);
  await enhanceDom(el);
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
