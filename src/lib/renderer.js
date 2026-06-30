import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import markedKatex from 'marked-katex-extension';

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildMarked() {
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false }));
  marked.use({
    renderer: {
      code({ text, lang }) {
        if (lang === 'mermaid') {
          // Escape so a fence containing `</div>` can't break out of the wrapper.
          return `<div class="mermaid">${escapeHtml(text)}</div>`;
        }
        const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
        let highlighted;
        try {
          highlighted = language === 'plaintext'
            ? escapeHtml(text)
            : hljs.highlight(text, { language }).value;
        } catch {
          highlighted = escapeHtml(text);
        }
        return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
      },
    },
  });
  return marked;
}

const marked = buildMarked();

// Note: DOMPurify requires a DOM `window`. It resolves automatically under
// jsdom (tests) and inside the WebView2 (production), but cannot be called
// from plain Node without one.
export function renderMarkdown(md) {
  const raw = marked.parse(md ?? '', { async: false });
  return DOMPurify.sanitize(raw);
}

export async function enhanceDom(container) {
  if (typeof window === 'undefined') return;
  const nodes = container.querySelectorAll('.mermaid');
  if (nodes.length === 0) return;
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({
    startOnLoad: false,
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
  });
  for (const node of nodes) {
    const code = node.textContent;
    const id = 'mmd-' + Math.random().toString(36).slice(2, 9);
    try {
      const { svg } = await mermaid.render(id, code);
      node.innerHTML = svg;
    } catch {
      node.classList.add('mermaid-error');
      node.setAttribute('data-source', code);
    }
  }
}
