import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderMarkdown } from '../src/lib/renderer.js';

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
