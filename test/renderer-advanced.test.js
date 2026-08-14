import { describe, it, expect } from 'vitest';
import { renderMarkdown, parseFenceInfo, parseLineSpec, enhanceDom } from '../src/lib/renderer.js';

describe('renderMarkdown — front matter', () => {
  it('renders a front-matter table and strips the block from the body', () => {
    const html = renderMarkdown('---\ntitle: Note\n---\n# Body\n');
    expect(html).toContain('frontmatter');
    expect(html).toContain('fm-table');
    expect(html.match(/<th>title<\/th>/)).toBeTruthy();
    expect(html).toContain('Note');
    expect(html).toContain('<h1');
    expect(html).toContain('Body');
    // The raw key must not leak as body text.
    expect(html).not.toMatch(/<p>title: Note<\/p>/);
  });

  it('renders <hr> for a bare --- when no key: value follows', () => {
    // A lone --- divider line (not a front-matter block) stays an <hr>.
    const html = renderMarkdown('a\n\n---\n\nb');
    expect(html).toContain('<hr>');
  });
});

describe('renderMarkdown — custom heading ids', () => {
  it('uses {#custom-id} as the heading id and hides it from the text', () => {
    const html = renderMarkdown('## My Section {#custom-id}\n');
    expect(html).toContain('id="custom-id"');
    expect(html).not.toContain('{#custom-id}');
    expect(html).toContain('My Section');
  });

  it('falls back to the auto slug when there is no {#id}', () => {
    const html = renderMarkdown('## Plain Heading\n');
    expect(html).toContain('id="plain-heading"');
  });

  it('dedupes repeated custom ids', () => {
    const html = renderMarkdown('## A {#dup}\n## B {#dup}\n');
    expect(html).toContain('id="dup"');
    expect(html).toContain('id="dup-2"');
  });
});

describe('parseFenceInfo', () => {
  it('parses language, title, and line spec', () => {
    const r = parseFenceInfo('js title="app.js" {1,3-5}');
    expect(r.lang).toBe('js');
    expect(r.title).toBe('app.js');
    expect([...r.lines].sort((a, b) => a - b)).toEqual([1, 3, 4, 5]);
  });

  it('accepts a bare filename and single-quoted titles', () => {
    expect(parseFenceInfo("py 'main.py'").title).toBe('main.py');
    expect(parseFenceInfo('js app.js').title).toBe('app.js');
  });

  it('returns nulls for a plain language', () => {
    const r = parseFenceInfo('python');
    expect(r).toEqual({ lang: 'python', title: null, lines: null });
  });
});

describe('parseLineSpec', () => {
  it('expands ranges and single lines', () => {
    expect([...parseLineSpec('1,3-5')].sort((a, b) => a - b)).toEqual([1, 3, 4, 5]);
  });
  it('ignores garbage parts', () => {
    expect([...parseLineSpec('2,x,4')].sort((a, b) => a - b)).toEqual([2, 4]);
  });
});

describe('renderMarkdown — code fence title + line highlight', () => {
  it('renders a title bar and wraps lines with the spec', () => {
    const html = renderMarkdown('```js title="app.js" {2}\nfoo();\nbar();\n```\n');
    expect(html).toContain('code-block');
    expect(html).toContain('code-title');
    expect(html).toContain('app.js');
    expect(html).toMatch(/<span class="code-line">[\s\S]*?foo[\s\S]*?\(\);[\s\S]*?<\/span>/);
    expect(html).toMatch(/<span class="code-line highlighted">[\s\S]*?bar[\s\S]*?\(\);[\s\S]*?<\/span>/);
    // Language class stays clean (just the language, not the info string).
    expect(html).toContain('language-js"');
  });

  it('renders plain fences unchanged (no wrapper, no spans)', () => {
    const html = renderMarkdown('```\nfoo\n```\n');
    expect(html).not.toContain('code-block');
    expect(html).not.toContain('code-line');
  });

  it('keeps mermaid fences working with an info string', () => {
    const html = renderMarkdown('```mermaid title="diagram"\ngraph TD;\n```\n');
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('graph TD;');
  });
});

describe('enhanceDom — video embeds', () => {
  it('embeds a bare YouTube link paragraph as an iframe card', async () => {
    const div = document.createElement('div');
    div.innerHTML = renderMarkdown('Intro\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n');
    await enhanceDom(div, { mermaid: false, folding: false });
    const iframe = div.querySelector('.video-embed iframe');
    expect(iframe).toBeTruthy();
    expect(iframe.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('preserves the start time from &t=', async () => {
    const div = document.createElement('div');
    div.innerHTML = renderMarkdown('https://youtu.be/abcdefghijk?t=30\n');
    await enhanceDom(div, { mermaid: false, folding: false });
    expect(div.querySelector('iframe').src).toContain('start=30');
  });

  it('embeds Vimeo links', async () => {
    const div = document.createElement('div');
    div.innerHTML = renderMarkdown('https://vimeo.com/123456789\n');
    await enhanceDom(div, { mermaid: false, folding: false });
    expect(div.querySelector('iframe').src).toBe('https://player.vimeo.com/video/123456789');
  });

  it('does NOT embed labeled links or prose mentions', async () => {
    const div = document.createElement('div');
    div.innerHTML = renderMarkdown('[watch this](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n');
    await enhanceDom(div, { mermaid: false, folding: false });
    expect(div.querySelector('iframe')).toBeNull();
    expect(div.querySelector('a')).toBeTruthy();
  });
});
