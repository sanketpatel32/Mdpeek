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
  enhanceCodeBlocks(container);
  await enhanceMermaid(container);
}

// Adds a copy button to each <pre> that contains a <code> block. One delegated
// listener per container — avoids a listener per button (the rendered DOM is
// rebuilt on every keystroke in edit mode, so per-button listeners would leak).
function enhanceCodeBlocks(container) {
  if (typeof window === 'undefined') return;
  const pres = container.querySelectorAll('pre');
  pres.forEach((pre) => {
    if (pre.querySelector(':scope > code') && !pre.querySelector('.copy-btn')) {
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Copy code');
      btn.title = 'Copy';
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      pre.append(btn);
    }
  });

  if (!container.__copyHandler) {
    const handler = async (e) => {
      const btn = e.target.closest('.copy-btn');
      if (!btn || !container.contains(btn)) return;
      const pre = btn.parentElement;
      const code = pre.querySelector('code');
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code.textContent);
        flashCopied(btn);
      } catch {
        // clipboardwrite may fail in insecure contexts; fall back silently.
      }
    };
    container.addEventListener('click', handler);
    container.__copyHandler = handler;
  }
}

// Briefly swap the button to a checkmark so the user sees feedback.
const COPY_FLASH_MS = 1200;
function flashCopied(btn) {
  if (btn.dataset.copied === '1') return;
  btn.dataset.copied = '1';
  btn.classList.add('copied');
  btn.dataset.original = btn.innerHTML;
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  setTimeout(() => {
    btn.innerHTML = btn.dataset.original;
    btn.classList.remove('copied');
    delete btn.dataset.copied;
  }, COPY_FLASH_MS);
}

// Monotonic counter for mermaid render IDs — Math.random() can collide across
// concurrent re-renders in edit mode, producing duplicate SVG IDs.
let _mmdSeq = 0;

async function enhanceMermaid(container) {
  const nodes = container.querySelectorAll('.mermaid');
  if (nodes.length === 0) return;
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({
    startOnLoad: false,
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
  });
  for (const node of nodes) {
    const code = node.textContent;
    const id = 'mmd-' + (++_mmdSeq);
    try {
      const { svg } = await mermaid.render(id, code);
      node.innerHTML = svg;
    } catch {
      // Clear any partial/error SVG mermaid may have inserted, then mark the
      // node so CSS can show a friendly placeholder.
      node.innerHTML = '';
      node.classList.add('mermaid-error');
      node.setAttribute('data-source', code);
    }
  }
}
