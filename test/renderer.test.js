import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderMarkdown, renderCode, expandTocMarker, expandAdmonitions, expandCollapsible } from '../src/lib/renderer.js';

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

describe('enhanceDom — language badge', () => {
  it('adds a .code-lang badge showing the language for non-plaintext blocks', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<pre><code class="hljs language-python">print(1)</code></pre>';
    await enhanceDom(div);
    const badge = div.querySelector('.code-lang');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('python');
  });

  it('skips the badge for plaintext (no value showing "plaintext")', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<pre><code class="hljs language-plaintext">hello</code></pre>';
    await enhanceDom(div);
    expect(div.querySelector('.code-lang')).toBeNull();
  });

  it('skips the badge when no language class is present', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<pre><code>no language</code></pre>';
    await enhanceDom(div);
    expect(div.querySelector('.code-lang')).toBeNull();
  });

  it('is idempotent — does not add a second badge on re-enhance', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<pre><code class="hljs language-rust">fn main() {}</code></pre>';
    await enhanceDom(div);
    await enhanceDom(div);
    expect(div.querySelectorAll('.code-lang')).toHaveLength(1);
  });
});

describe('enhanceDom — line-number gutter (v0.34.0)', () => {
  it('does NOT add a gutter by default (opt-in)', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<pre><code class="hljs language-js">a\nb\nc</code></pre>';
    await enhanceDom(div);
    expect(div.querySelector('.code-gutter')).toBeNull();
    expect(div.querySelector('pre').classList.contains('with-gutter')).toBe(false);
  });

  it('adds a gutter with one row per line when lineNumbers: true', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<pre><code class="hljs language-js">a\nb\nc</code></pre>';
    await enhanceDom(div, { lineNumbers: true });
    const gutter = div.querySelector('.code-gutter');
    expect(gutter).toBeTruthy();
    expect(gutter.children).toHaveLength(3);
    expect(gutter.children[0].textContent).toBe('1');
    expect(gutter.children[2].textContent).toBe('3');
    expect(div.querySelector('pre').classList.contains('with-gutter')).toBe(true);
  });

  it('trims the phantom trailing line from a trailing newline', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    // "a\nb\n" splits to ['a','b',''] — the gutter should show 2 rows, not 3.
    div.innerHTML = '<pre><code class="hljs language-js">a\nb\n</code></pre>';
    await enhanceDom(div, { lineNumbers: true });
    expect(div.querySelector('.code-gutter').children).toHaveLength(2);
  });

  it('preserves the copy/save buttons alongside the gutter', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<pre><code class="hljs language-js">x</code></pre>';
    await enhanceDom(div, { lineNumbers: true });
    expect(div.querySelector('.copy-btn')).toBeTruthy();
    expect(div.querySelector('.save-code-btn')).toBeTruthy();
    expect(div.querySelector('.code-gutter')).toBeTruthy();
  });

  it('moves the <code> into a .code-row alongside the gutter', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<pre><code class="hljs language-js">hello</code></pre>';
    await enhanceDom(div, { lineNumbers: true });
    const row = div.querySelector('.code-row');
    expect(row).toBeTruthy();
    expect(row.querySelector('code')).toBeTruthy();   // code still exists
    expect(row.querySelector('.code-gutter')).toBeTruthy();
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

describe('renderCode — line numbers', () => {
  it('produces a gutter with one div per source line', () => {
    const html = renderCode('a\nb\nc', 'plaintext');
    // Three lines of source → three numbers in the gutter. The gutter block
    // is followed by <pre, so anchor the extraction there.
    const gutterBlock = html.split('<pre class="code-pre"')[0];
    const nums = gutterBlock.match(/<div>\d+<\/div>/g);
    expect(nums.length).toBe(3);
    expect(nums[0]).toBe('<div>1</div>');
    expect(nums[2]).toBe('<div>3</div>');
  });

  it('handles single-line files (gutter has exactly one number)', () => {
    const html = renderCode('only line', 'plaintext');
    const gutterBlock = html.split('<pre class="code-pre"')[0];
    expect(gutterBlock.match(/<div>\d+<\/div>/g).length).toBe(1);
  });

  it('wraps the highlighted code in a <pre class="code-pre">', () => {
    const html = renderCode('const x = 1;', 'javascript');
    expect(html).toContain('class="code-pre"');
    expect(html).toContain('language-javascript');
  });

  it('gutter count matches newline count + 1 (trailing line counts)', () => {
    const html = renderCode('a\nb\n', 'plaintext');
    const gutterBlock = html.split('<pre class="code-pre"')[0];
    expect(gutterBlock.match(/<div>\d+<\/div>/g).length).toBe(3);
  });
});

// v0.35.0: GFM task lists must render with checkboxes that survive DOMPurify
// sanitization — the preview's click handler targets these <input> elements.
// marked v18 emits <li><input disabled type="checkbox"> with no class on the li.
describe('renderMarkdown — GFM task lists (v0.35.0)', () => {
  it('renders task items with a checkbox input', () => {
    const html = renderMarkdown('- [ ] one\n- [x] two');
    expect(html).toContain('<input');
    expect(html).toContain('type="checkbox"');
  });

  it('marks checked items as checked', () => {
    const html = renderMarkdown('- [x] done');
    expect(html).toContain('checked');
  });

  it('DOMPurify keeps the checkbox inputs (click targets survive)', () => {
    const html = renderMarkdown('- [ ] a\n- [x] b');
    const inputCount = (html.match(/<input[^>]*type="checkbox"/g) || []).length;
    expect(inputCount).toBe(2);
  });

  it('does not emit a checkbox for plain list items', () => {
    const html = renderMarkdown('- plain item');
    expect(html).not.toContain('checkbox');
  });
});

// v0.35.0: enhanceDom must make task checkboxes interactive (remove `disabled`,
// add role + tabindex) so the delegated click handler in main.js receives real
// user clicks across all browsers.
describe('enhanceDom — task checkboxes made interactive (v0.35.0)', () => {
  it('removes the disabled attribute from task checkboxes', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = renderMarkdown('- [ ] a\n- [x] b');
    await enhanceDom(div, { mermaid: false, folding: false });
    const boxes = div.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    boxes.forEach((cb) => expect(cb.hasAttribute('disabled')).toBe(false));
  });

  it('adds role=checkbox and tabindex=0 for keyboard access', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = renderMarkdown('- [ ] task');
    await enhanceDom(div, { mermaid: false, folding: false });
    const cb = div.querySelector('input[type="checkbox"]');
    expect(cb.getAttribute('role')).toBe('checkbox');
    expect(cb.getAttribute('tabindex')).toBe('0');
  });

  it('preserves the checked state (only disabled is removed)', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = renderMarkdown('- [x] done');
    await enhanceDom(div, { mermaid: false, folding: false });
    const cb = div.querySelector('input[type="checkbox"]');
    expect(cb.checked).toBe(true);
    expect(cb.hasAttribute('disabled')).toBe(false);
  });
});

describe('enhanceDom — image zoom tagging (v0.36.0)', () => {
  it('tags standalone images as zoomable (data-zoom="1")', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<p><img src="https://example.com/a.png" alt="pic"></p>';
    await enhanceDom(div, { mermaid: false, folding: false });
    const img = div.querySelector('img');
    expect(img.dataset.zoom).toBe('1');
  });

  it('does NOT tag images wrapped in a link (data-zoom="0")', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<a href="https://example.com"><img src="https://example.com/b.png"></a>';
    await enhanceDom(div, { mermaid: false, folding: false });
    const img = div.querySelector('img');
    expect(img.dataset.zoom).toBe('0');
  });

  it('is idempotent — re-enhancing does not flip an existing tag', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    div.innerHTML = '<img src="https://example.com/c.png">';
    await enhanceDom(div, { mermaid: false, folding: false });
    await enhanceDom(div, { mermaid: false, folding: false });
    expect(div.querySelector('img').dataset.zoom).toBe('1');
  });

  it('opens the lightbox overlay on click', async () => {
    const { enhanceDom } = await import('../src/lib/renderer.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.innerHTML = '<img src="https://example.com/d.png" alt="zoom me">';
    await enhanceDom(div, { mermaid: false, folding: false });
    div.querySelector('img').click();
    const overlay = document.getElementById('mdpeek-lightbox');
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains('open')).toBe(true);
    // Clean up.
    overlay.remove();
    div.remove();
  });
});

describe('renderMarkdown — emoji shortcodes (v0.36.0)', () => {
  it('replaces :shortcode: with the emoji in prose', () => {
    const html = renderMarkdown('Hello :smile: world');
    expect(html).toContain('😄');
    expect(html).not.toContain(':smile:');
  });

  it('handles multiple shortcodes in one line', () => {
    const html = renderMarkdown(':thumbsup: nice :tada:');
    expect(html).toContain('👍');
    expect(html).toContain('🎉');
  });

  it('leaves unknown shortcodes untouched', () => {
    const html = renderMarkdown('see :not_real: ok');
    expect(html).toContain(':not_real:');
  });

  it('does NOT replace shortcodes inside code spans', () => {
    const html = renderMarkdown('run `cmd :smile:` now');
    expect(html).toContain(':smile:');
    expect(html).not.toContain('😄');
  });

  it('does NOT replace shortcodes inside fenced code blocks', () => {
    const html = renderMarkdown('```\nconst x = ":heart:";\n```');
    expect(html).toContain(':heart:');
    expect(html).not.toContain('❤️');
  });
});

describe('renderMarkdown — highlight marker ==text== (v0.38.0)', () => {
  it('wraps ==text== in <mark>', () => {
    const html = renderMarkdown('this is ==important== text');
    expect(html).toContain('<mark>important</mark>');
    expect(html).not.toContain('==important==');
  });

  it('handles multiple highlights on one line', () => {
    const html = renderMarkdown('==a== and ==b==');
    expect(html).toContain('<mark>a</mark>');
    expect(html).toContain('<mark>b</mark>');
  });

  it('does NOT treat === (heading underline) as a highlight', () => {
    const html = renderMarkdown('Title\n===');
    expect(html).not.toContain('<mark>');
  });

  it('does NOT match == inside code spans', () => {
    const html = renderMarkdown('run `a == b` now');
    expect(html).not.toContain('<mark>');
    expect(html).toContain('==');
  });

  it('renders inline formatting inside the highlight', () => {
    const html = renderMarkdown('==bold **inside**==');
    expect(html).toContain('<mark>');
    expect(html).toContain('<strong>inside</strong>');
  });
});

describe('expandTocMarker', () => {
  it('passes through markdown with no [[toc]] marker unchanged', () => {
    const md = '# Title\n\nSome text.\n\n## Section';
    expect(expandTocMarker(md)).toBe(md);
  });

  it('replaces a standalone [[toc]] line with a heading list', () => {
    const md = '# Intro\n\n## A\n\n## B\n\n[[toc]]';
    const out = expandTocMarker(md);
    // The marker is replaced; the result references each heading by slug.
    expect(out).not.toContain('[[toc]]');
    expect(out).toContain('- [Intro](#intro)');
    expect(out).toContain('- [A](#a)');
    expect(out).toContain('- [B](#b)');
  });

  it('leaves [[toc]] inside a fenced code block untouched', () => {
    const md = '# H\n\n```\n[[toc]]\n```\n\n[[toc]]';
    const out = expandTocMarker(md);
    // The fenced one survives verbatim; the standalone one is expanded.
    expect(out).toContain('```\n[[toc]]\n```');
    expect(out).toContain('- [H](#h)');
  });

  it('expands multiple [[toc]] markers in the same doc', () => {
    const md = '# A\n\n[[toc]]\n\nmore\n\n[[toc]]';
    const out = expandTocMarker(md);
    const matches = out.split('- [A](#a)').length - 1;
    expect(matches).toBe(2);
  });

  it('dedupes slug collisions the same way the heading-id hook does', () => {
    // Two "Foo" headings → second one gets slug "foo-1". The TOC link must
    // point at that deduped slug or the in-page anchor won't resolve.
    const md = '# Foo\n\n# Foo\n\n[[toc]]';
    const out = expandTocMarker(md);
    expect(out).toContain('- [Foo](#foo)');
    expect(out).toContain('- [Foo](#foo-1)');
  });
});

describe('renderMarkdown — definition lists', () => {
  it('renders Term + : Definition as <dl><dt><dd>', () => {
    const html = renderMarkdown('Apple\n: A fruit\n: Also a company');
    expect(html).toContain('<dl>');
    expect(html).toContain('<dt>Apple</dt>');
    expect(html).toContain('<dd>A fruit</dd>');
    expect(html).toContain('<dd>Also a company</dd>');
    expect(html).toContain('</dl>');
  });

  it('renders multiple consecutive definition lists', () => {
    const html = renderMarkdown('Apple\n: Fruit\n\nBanana\n: Yellow');
    // Two separate <dl> blocks (separated by a blank line).
    const dlCount = html.split('<dl>').length - 1;
    expect(dlCount).toBe(2);
    expect(html).toContain('<dt>Banana</dt>');
  });

  it('parses inline markdown in the term and definitions', () => {
    const html = renderMarkdown('**Bold** term\n: [link](https://x.com)');
    expect(html).toContain('<dt><strong>Bold</strong> term</dt>');
    expect(html).toContain('<a href="https://x.com"');
  });

  it('leaves a standalone colon line as a paragraph (no term above)', () => {
    // A colon line with no preceding term line shouldn't become an empty <dl>.
    const html = renderMarkdown(': just a colon line');
    expect(html).not.toContain('<dl>');
  });
});

describe('expandAdmonitions — mkDocs !!! syntax (v0.45.0)', () => {
  it('passes through text with no !!! marker', () => {
    expect(expandAdmonitions('just a paragraph')).toBe('just a paragraph');
    expect(expandAdmonitions('')).toBe('');
  });

  it('rewrites !!! note into a GFM alert blockquote', () => {
    const md = '!!! note\n    Body line';
    const out = expandAdmonitions(md);
    expect(out).toContain('> [!NOTE]');
    expect(out).toContain('> Body line');
  });

  it('preserves an optional quoted title', () => {
    const md = '!!! tip "Pro hint"\n    Use tabs';
    const out = expandAdmonitions(md);
    expect(out).toContain('> [!TIP] Pro hint');
    expect(out).toContain('> Use tabs');
  });

  it('ends the block at a non-indented line', () => {
    const md = '!!! warning\n    Inside\nOutside';
    const out = expandAdmonitions(md);
    expect(out).toContain('> [!WARNING]');
    expect(out).toContain('> Inside');
    // Outside line is NOT prefixed with >
    expect(out).toContain('\nOutside');
    expect(out).not.toContain('> Outside');
  });

  it('maps danger to the CAUTION alert', () => {
    const out = expandAdmonitions('!!! danger\n    Careful');
    expect(out).toContain('> [!CAUTION]');
  });

  it('keeps blank lines within the body as blank blockquote lines', () => {
    const md = '!!! note\n    Para one\n\n    Para two';
    const out = expandAdmonitions(md);
    expect(out).toContain('> Para one');
    expect(out).toContain('>');
    expect(out).toContain('> Para two');
  });
});

describe('renderMarkdown — admonition end-to-end', () => {
  it('renders !!! note as a themed alert callout', () => {
    const html = renderMarkdown('!!! note\n    Hello admonition');
    expect(html).toContain('markdown-alert');
    expect(html).toContain('markdown-alert-title');
    expect(html).toContain('Hello admonition');
  });
});

describe('expandCollapsible — mkDocs ??? syntax (v0.46.0)', () => {
  it('passes through text with no ??? marker', () => {
    expect(expandCollapsible('just a paragraph')).toBe('just a paragraph');
    expect(expandCollapsible('')).toBe('');
  });

  it('emits a collapsed <details> with the type as default summary', () => {
    const out = expandCollapsible('??? note\n    Hidden body');
    expect(out).toContain('<details');
    expect(out).not.toContain('<details open');
    expect(out).toContain('<summary>');
    expect(out).toContain('note');
    expect(out).toContain('Hidden body');
    expect(out).toContain('</details>');
  });

  it('emits an open <details> with ???+ and a quoted title', () => {
    const out = expandCollapsible('???+ tip "Expand me"\n    Body line');
    // The `open` attribute sits after the class attr: `<details class="…" open>`.
    expect(out).toMatch(/<details[^>]* open/);
    expect(out).toContain('Expand me');
    expect(out).toContain('Body line');
  });

  it('preserves multi-line indented bodies', () => {
    const md = '??? note\n    First\n    Second';
    const out = expandCollapsible(md);
    expect(out).toContain('First');
    expect(out).toContain('Second');
  });
});

describe('renderMarkdown — collapsible end-to-end (v0.46.0)', () => {
  it('renders ??? as a native <details> block', () => {
    const html = renderMarkdown('??? note "Click"\n    Secret content');
    expect(html).toContain('<details');
    expect(html).toContain('<summary>');
    expect(html).toContain('Click');
    expect(html).toContain('Secret content');
    expect(html).toContain('</details>');
  });
});

describe('renderMarkdown — image size syntax (v0.45.0)', () => {
  it('renders a plain image without size attrs (and does not crash on alt)', () => {
    // Regression: previously the image renderer called an undefined escapeAttr
    // and threw whenever an image had alt text.
    const html = renderMarkdown('![my alt](https://x.com/a.png)');
    expect(html).toContain('<img');
    expect(html).toContain('alt="my alt"');
    expect(html).not.toContain('width=');
  });

  it('renders GitHub "=WxH" title as width/height attrs', () => {
    const html = renderMarkdown('![alt](https://x.com/a.png "=200x300")');
    expect(html).toContain('width="200"');
    expect(html).toContain('height="300"');
    // The size token is stripped from the title.
    expect(html).not.toContain('title="=200x300"');
  });

  it('renders Obsidian "|W" alt as a width attr', () => {
    const html = renderMarkdown('![alt|300](https://x.com/a.png)');
    expect(html).toContain('width="300"');
    expect(html).toContain('alt="alt"');
  });

  it('escapes quotes in alt text safely', () => {
    const html = renderMarkdown('![a "b" c](https://x.com/a.png)');
    expect(html).toContain('&quot;');
    expect(html).not.toContain('a "b" c');
  });
});
