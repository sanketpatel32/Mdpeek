import { describe, it, expect, vi } from 'vitest';

// Mock the heavy mermaid module so enhanceDom stays fast + deterministic.
vi.mock('mermaid', () => ({
  default: { initialize: () => {}, render: () => Promise.resolve({ svg: '' }) },
}));

import { enhanceDom } from '../src/lib/renderer.js';

// A container with the `.markdown-body` class so the production CSS selectors
// match (the enhance pass doesn't depend on it, but it keeps the tests honest).
function container(html) {
  const el = document.createElement('div');
  el.className = 'markdown-body';
  el.innerHTML = html;
  return el;
}

describe('enhanceDom — prose highlights', () => {
  it('wraps 3+-syllable words in mark.prose-complex when enabled', async () => {
    const el = container('<p>The utilization was significant.</p>');
    await enhanceDom(el, { proseHighlights: true });
    const marks = el.querySelectorAll('mark.prose-complex');
    expect(marks.length).toBe(2);
    expect(marks[0].textContent).toBe('utilization');
    expect(marks[1].textContent).toBe('significant');
  });

  it('does not wrap anything when the option is off (default)', async () => {
    const el = container('<p>The utilization was significant.</p>');
    await enhanceDom(el, {}); // proseHighlights defaults to false
    expect(el.querySelectorAll('mark.prose-complex').length).toBe(0);
  });

  it('preserves surrounding text and inline elements exactly', async () => {
    const el = container('<p>The <strong>utilization</strong> was significant.</p>');
    await enhanceDom(el, { proseHighlights: true });
    // The <strong> survives, and the word inside it is wrapped too (it is a
    // text node under <strong>, which is not code/mark). The plain-text word
    // outside is wrapped. Net: 2 marks, 1 strong still present.
    expect(el.querySelectorAll('strong').length).toBe(1);
    expect(el.querySelectorAll('mark.prose-complex').length).toBe(2);
    // Full text content is unchanged by the wrapping.
    expect(el.querySelector('p').textContent).toBe('The utilization was significant.');
  });

  it('skips code blocks and inline code', async () => {
    const el = container('<pre><code>const utilization = significant;</code></pre><p>code: <code>utilization</code> here</p>');
    await enhanceDom(el, { proseHighlights: true });
    expect(el.querySelectorAll('mark.prose-complex').length).toBe(0);
  });

  it('skips table cells and alert callouts', async () => {
    const el = container(
      '<table><tbody><tr><td>utilization significant</td></tr></tbody></table>'
      + '<blockquote class="markdown-alert"><p>utilization significant here now</p></blockquote>'
      + '<p>utilization significant methodology</p>'
    );
    await enhanceDom(el, { proseHighlights: true });
    // Only the standalone paragraph gets marks; the table cell + callout don't.
    expect(el.querySelectorAll('mark.prose-complex').length).toBe(3);
  });

  it('adds .prose-dense to a difficult paragraph', async () => {
    const dense = 'The implementation of the methodology necessitated a comprehensive examination of the organizational infrastructure, which consequently facilitated the optimization of numerous operational procedures and administrative functionalities throughout the enterprise.';
    const el = container(`<p>${dense}</p>`);
    await enhanceDom(el, { proseHighlights: true });
    expect(el.querySelector('p').classList.contains('prose-dense')).toBe(true);
  });

  it('does not add .prose-dense to short paragraphs', async () => {
    const el = container('<p>A short note.</p>');
    await enhanceDom(el, { proseHighlights: true });
    expect(el.querySelector('p').classList.contains('prose-dense')).toBe(false);
  });

  it('is idempotent across repeated enhance calls', async () => {
    const el = container('<p>The utilization was significant.</p>');
    await enhanceDom(el, { proseHighlights: true });
    const firstCount = el.querySelectorAll('mark.prose-complex').length;
    await enhanceDom(el, { proseHighlights: true });
    expect(el.querySelectorAll('mark.prose-complex').length).toBe(firstCount);
  });
});
