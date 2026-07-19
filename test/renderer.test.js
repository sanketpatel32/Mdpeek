import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderMarkdown } from '../src/lib/renderer.js';

// Mock the heavy mermaid module so enhanceDom tests are fast and deterministic
// (don't depend on the real 400KB library loading under load).
const mockMermaidRender = vi.fn();
vi.mock('mermaid', () => ({
  default: {
    initialize: () => {},
    render: mockMermaidRender,
  },
}));

const here = dirname(fileURLToPath(import.meta.url));
const fix = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

describe('renderMarkdown — GFM core', () => {
  it('renders headings, emphasis, lists, quotes, links', () => {
    const html = renderMarkdown(fix('gfm.md'));
    expect(html).toContain('<h1');
    expect(html).toContain('Title');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>item one</li>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<a href="https://example.com"');
  });
});

describe('renderMarkdown — code highlighting', () => {
  it('wraps code in hljs spans', () => {
    const html = renderMarkdown(fix('code.md'));
    expect(html).toContain('class="hljs language-js"');
    expect(html).toMatch(/hljs-keyword|hljs-title/);
  });
});

describe('renderMarkdown — math (KaTeX)', () => {
  it('renders inline and block math', () => {
    const html = renderMarkdown(fix('math.md'));
    expect(html).toMatch(/katex/);
    expect(html).toContain('E=mc^2');
    expect(html).toContain('\\int');
  });
});

describe('renderMarkdown — mermaid', () => {
  it('routes mermaid fences to a .mermaid div (not highlighted)', () => {
    const html = renderMarkdown(fix('mermaid.md'));
    expect(html).toContain('<div class="mermaid">');
    expect(html).toContain('graph TD');
    expect(html).not.toContain('class="hljs language-mermaid"');
  });
});

describe('renderMarkdown — XSS safety', () => {
  it('strips dangerous schemes, handlers, and scripts', () => {
    const html = renderMarkdown(fix('xss.md'));
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('onerror');
    expect(html.toLowerCase()).not.toContain('<script');
  });
});

describe('renderMarkdown — edge cases', () => {
  it('returns empty string for null/undefined/empty input', () => {
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
    expect(renderMarkdown('')).toBe('');
  });

  it('falls back to plaintext for unknown languages', () => {
    const html = renderMarkdown('```totally-made-up-lang\nhello\n```');
    expect(html).toContain('class="hljs language-plaintext"');
    expect(html).toContain('hello');
  });
});

describe('renderMarkdown — heading IDs', () => {
  it('slugifies heading text into an id', () => {
    const html = renderMarkdown('## Hello World');
    expect(html).toContain('id="hello-world"');
  });

  it('dedupes identical headings with -2, -3 suffixes', () => {
    const html = renderMarkdown('## Intro\n\n## Intro\n\n## Intro');
    expect(html).toContain('id="intro"');
    expect(html).toContain('id="intro-2"');
    expect(html).toContain('id="intro-3"');
  });
});

describe('renderMarkdown — footnotes', () => {
  it('renders footnote refs and a definitions section', () => {
    const html = renderMarkdown('See this[^1].\n\n[^1]: The note text.');
    // A footnote reference (not the old broken link-to-"note" behavior).
    expect(html).not.toMatch(/href="note"/);
    // A footnotes definitions section at the bottom.
    expect(html.toLowerCase()).toMatch(/footnotes|footnote/);
    expect(html).toContain('The note text.');
  });
});

describe('renderMarkdown — GFM alerts', () => {
  it('renders > [!NOTE] as a markdown-alert blockquote', () => {
    const html = renderMarkdown('> [!NOTE]\n> This is a note.');
    expect(html).toContain('markdown-alert');
    expect(html).toContain('NOTE');
  });

  it('renders > [!WARNING] with the WARNING class', () => {
    const html = renderMarkdown('> [!WARNING]\n> Be careful.');
    expect(html).toContain('markdown-alert-WARNING');
  });
});

describe('renderMarkdown — task lists', () => {
  it('renders - [x] / - [ ] as checkboxes', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked'); // the done item
  });
});

describe('renderMarkdown — link hardening', () => {
  it('adds target=_blank and rel=noopener to links', () => {
    const html = renderMarkdown('[ex](https://example.com)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('renderMarkdown — wiki-links', () => {
  it('converts [[Target]] into a markdown link to Target.md', () => {
    const html = renderMarkdown('See [[README]].');
    expect(html).toMatch(/<a[^>]*href="README\.md"/);
    expect(html).toContain('>README</a>');
  });

  it('supports [[Target|Display]] with custom display text', () => {
    const html = renderMarkdown('[[notes/jan|January note]]');
    expect(html).toMatch(/href="notes\/jan\.md"/);
    expect(html).toContain('>January note</a>');
  });

  it('preserves the original extension when one is given', () => {
    const html = renderMarkdown('[[doc.pdf]]');
    expect(html).toMatch(/href="doc\.pdf"/);
  });

  it('does not transform [[ ]] inside fenced code blocks', () => {
    const html = renderMarkdown('```\n[[not a link]]\n```');
    expect(html).not.toMatch(/href="not a link\.md"/);
  });

  it('does not transform [[ ]] inside inline code', () => {
    const html = renderMarkdown('Use `[[array]]` syntax.');
    expect(html).not.toMatch(/href="array\.md"/);
  });

  it('returns input unchanged when no [[ appears', () => {
    const html = renderMarkdown('plain text with [a normal] link');
    expect(html).toContain('plain text');
    expect(html).not.toMatch(/href="[^"]*\.md"/);
  });

  it('URL-encodes paths containing spaces', () => {
    const html = renderMarkdown('[[my notes]]');
    expect(html).toMatch(/href="my%20notes\.md"/);
  });
});

describe('renderMarkdown — render cache', () => {
  it('returns identical output for the same input (cached)', () => {
    const a = renderMarkdown('## Same\n\ntext');
    const b = renderMarkdown('## Same\n\ntext');
    expect(b).toBe(a);
  });
});

describe('enhanceDom', () => {
  it('no-ops when there are no .mermaid nodes', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<p>no diagrams here</p>';
    await enhanceDom(div);
    expect(div.innerHTML).toBe('<p>no diagrams here</p>');
  });

  it('marks a node with mermaid-error when mermaid fails to render', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    mockMermaidRender.mockRejectedValueOnce(new Error('boom'));
    const div = document.createElement('div');
    div.innerHTML = '<div class="mermaid">not a real diagram @@@</div>';
    const node = div.querySelector('.mermaid');
    await enhanceDom(div);
    expect(node.classList.contains('mermaid-error')).toBe(true);
    expect(node.getAttribute('data-source')).toBe('not a real diagram @@@');
  });

  it('injects SVG when mermaid renders successfully', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    mockMermaidRender.mockResolvedValueOnce({ svg: '<svg>diagram</svg>' });
    const div = document.createElement('div');
    div.innerHTML = '<div class="mermaid">graph TD</div>';
    const node = div.querySelector('.mermaid');
    await enhanceDom(div);
    expect(node.innerHTML).toBe('<svg>diagram</svg>');
    expect(node.classList.contains('mermaid-error')).toBe(false);
  });
});

describe('enhanceDom — copy buttons', () => {
  it('adds a copy button to each <pre> with a <code> child', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML =
      '<pre><code class="hljs language-js">const x = 1;</code></pre>' +
      '<pre><code>plain</code></pre>';
    await enhanceDom(div);
    const btns = div.querySelectorAll('.copy-btn');
    expect(btns).toHaveLength(2);
    btns.forEach((b) => {
      expect(b.getAttribute('aria-label')).toBe('Copy code');
    });
  });

  it('does not add a button to a <pre> without <code>', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<pre>just text, no code tag</pre>';
    await enhanceDom(div);
    expect(div.querySelectorAll('.copy-btn')).toHaveLength(0);
  });

  it('is idempotent — enhancing twice adds no duplicate buttons', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<pre><code>x</code></pre>';
    await enhanceDom(div);
    await enhanceDom(div);
    expect(div.querySelectorAll('.copy-btn')).toHaveLength(1);
  });

  it('copies code text to clipboard on click and flashes "copied"', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const div = document.createElement('div');
    document.body.innerHTML = '';
    document.body.append(div);
    div.innerHTML = '<pre><code class="hljs language-js">const x = 1;</code></pre>';
    await enhanceDom(div);

    const btn = div.querySelector('.copy-btn');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // clipboard.writeText is called synchronously; the flash is async but the
    // call itself is immediate.
    expect(writeText).toHaveBeenCalledWith('const x = 1;');
  });
});

describe('enhanceDom — heading anchors', () => {
  it('appends an anchor link to each heading with an id', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML =
      '<h2 id="section-one">Section One</h2>' +
      '<h3 id="sub">Sub</h3>';
    await enhanceDom(div);
    const links = div.querySelectorAll('.anchor-link');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('#section-one');
    expect(links[1].getAttribute('href')).toBe('#sub');
    expect(links[0].getAttribute('aria-label')).toBe('Copy link to this heading');
  });

  it('skips headings without an id', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<h2>No id here</h2>';
    await enhanceDom(div);
    expect(div.querySelectorAll('.anchor-link')).toHaveLength(0);
  });

  it('is idempotent — enhancing twice adds no duplicate anchors', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<h2 id="once">Once</h2>';
    await enhanceDom(div);
    await enhanceDom(div);
    expect(div.querySelectorAll('.anchor-link')).toHaveLength(1);
  });

  it('copies the #slug fragment on click and prevents default navigation', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const div = document.createElement('div');
    document.body.innerHTML = '';
    document.body.append(div);
    div.innerHTML = '<h2 id="deep-link">Deep Link</h2>';
    await enhanceDom(div);

    const a = div.querySelector('.anchor-link');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);

    expect(writeText).toHaveBeenCalledWith('#deep-link');
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('enhanceDom — outline folding', () => {
  it('adds a fold-toggle button to each heading that has following content', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<h2 id="a">Section A</h2><p>body</p><h2 id="b">Section B</h2><p>more</p>';
    await enhanceDom(div);
    const toggles = div.querySelectorAll('.fold-toggle');
    expect(toggles.length).toBe(2);
  });

  it('does not add a toggle when a heading has no following content', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<h2 id="lonely">Lonely</h2>';
    await enhanceDom(div);
    expect(div.querySelectorAll('.fold-toggle').length).toBe(0);
  });

  it('stops folding at the next heading of equal-or-higher level', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML =
      '<h2 id="parent">Parent</h2>' +
      '<p>parent body</p>' +
      '<h3 id="child">Child</h3>' +
      '<p>child body</p>' +
      '<h2 id="sibling">Sibling</h2>' +
      '<p>sibling body</p>';
    await enhanceDom(div);
    // Click the parent's toggle → its collapse should hide everything until
    // the next h2 (sibling): parent body, child h3, child body. The sibling
    // h2 and its body stay visible.
    const parentBtn = div.querySelector('#parent .fold-toggle');
    parentBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(div.querySelector('#parent').classList.contains('collapsed')).toBe(true);
    expect(div.querySelector('#sibling').classList.contains('folded-away')).toBe(false);
    // The next <p> after sibling is the sibling's body — should be visible.
    const allP = div.querySelectorAll('p');
    const siblingBody = allP[allP.length - 1];
    expect(siblingBody.classList.contains('folded-away')).toBe(false);
    // The child section IS part of the parent's section and should be folded.
    expect(div.querySelector('#child').classList.contains('folded-away')).toBe(true);
  });

  it('toggles back to expanded on a second click', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<h2 id="a">A</h2><p>body</p>';
    await enhanceDom(div);
    const btn = div.querySelector('#a .fold-toggle');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(div.querySelector('#a').classList.contains('collapsed')).toBe(true);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(div.querySelector('#a').classList.contains('collapsed')).toBe(false);
    expect(div.querySelectorAll('p.folded-away').length).toBe(0);
  });

  it('respects the folding: false option (used by the editor preview)', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<h2 id="a">A</h2><p>body</p>';
    await enhanceDom(div, { folding: false });
    expect(div.querySelectorAll('.fold-toggle').length).toBe(0);
  });
});
