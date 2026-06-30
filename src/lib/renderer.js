import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import markedKatex from 'marked-katex-extension';

function buildMarked() {
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false }));
  marked.use({
    renderer: {
      code({ text, lang }) {
        if (lang === 'mermaid') {
          return `<div class="mermaid">${text}</div>`;
        }
        const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
        let highlighted;
        try {
          highlighted = hljs.highlight(text, { language }).value;
        } catch {
          highlighted = hljs.highlightAuto(text).value;
        }
        return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
      },
    },
  });
  return marked;
}

const marked = buildMarked();

const PURIFY_CONFIG = {
  ADD_ATTR: ['target'],
};

export function renderMarkdown(md) {
  const raw = marked.parse(md ?? '', { async: false });
  return DOMPurify.sanitize(raw, PURIFY_CONFIG);
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
