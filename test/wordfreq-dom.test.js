import { describe, it, expect, vi } from 'vitest';

// Mock the heavy mermaid module so enhanceDom stays fast + deterministic.
vi.mock('mermaid', () => ({
  default: { initialize: () => {}, render: () => Promise.resolve({ svg: '' }) },
}));

import { enhanceDom } from '../src/lib/renderer.js';

function container(html) {
  const el = document.createElement('div');
  el.className = 'markdown-body';
  el.innerHTML = html;
  return el;
}

describe('enhanceDom — word-frequency', () => {
  it('wraps overused (5+ use) words in span.wordfreq-mark when enabled', async () => {
    // "alpha" appears 5 times → overused; "beta" once → not.
    const el = container('<p>alpha beta alpha alpha alpha alpha</p>');
    await enhanceDom(el, { wordFreq: true });
    const marks = el.querySelectorAll('span.wordfreq-mark');
    expect(marks.length).toBe(5);
    expect(Array.from(marks).every((m) => m.textContent === 'alpha')).toBe(true);
  });

  it('does not wrap anything when the option is off (default)', async () => {
    const el = container('<p>alpha alpha alpha alpha alpha</p>');
    await enhanceDom(el, {}); // wordFreq defaults to false
    expect(el.querySelectorAll('span.wordfreq-mark').length).toBe(0);
  });

  it('wraps nothing when no word reaches the threshold', async () => {
    const el = container('<p>alpha beta gamma delta</p>');
    await enhanceDom(el, { wordFreq: true });
    expect(el.querySelectorAll('span.wordfreq-mark').length).toBe(0);
  });

  it('is case-insensitive (The/the merge before counting)', async () => {
    // "apple" 5× across cases → all 5 wrapped.
    const el = container('<p>Apple apple APPLE apple apple</p>');
    await enhanceDom(el, { wordFreq: true });
    expect(el.querySelectorAll('span.wordfreq-mark').length).toBe(5);
  });

  it('skips code blocks and inline code', async () => {
    // The 5 "alpha" inside the code block don't count; the 5 in prose do.
    const el = container(
      '<pre><code>alpha alpha alpha alpha alpha</code></pre>'
      + '<p>code: <code>alpha</code> alpha alpha alpha alpha alpha</p>'
    );
    await enhanceDom(el, { wordFreq: true });
    const marks = el.querySelectorAll('span.wordfreq-mark');
    // 5 in the paragraph's prose; the one inside <code> is skipped.
    expect(marks.length).toBe(5);
  });

  it('skips table cells and alert callouts', async () => {
    const el = container(
      '<table><tbody><tr><td>alpha alpha alpha alpha alpha</td></tr></tbody></table>'
      + '<blockquote class="markdown-alert"><p>alpha alpha alpha alpha alpha</p></blockquote>'
      + '<p>alpha alpha alpha alpha alpha</p>'
    );
    await enhanceDom(el, { wordFreq: true });
    // Only the standalone paragraph gets marks.
    expect(el.querySelectorAll('span.wordfreq-mark').length).toBe(5);
  });

  it('coexists with prose highlights (distinct affordance colors)', async () => {
    // Both on: a word can be both complex AND overused. The wrappers nest but
    // neither breaks the other.
    const el = container('<p>methodology methodology methodology methodology methodology</p>');
    await enhanceDom(el, { wordFreq: true, proseHighlights: true });
    expect(el.querySelectorAll('span.wordfreq-mark').length).toBe(5);
    expect(el.querySelectorAll('mark.prose-complex').length).toBe(5);
  });

  it('does not wrap inside headings (only body prose)', async () => {
    const el = container('<h2>alpha alpha alpha alpha alpha</h2><p>alpha alpha alpha alpha alpha</p>');
    await enhanceDom(el, { wordFreq: true });
    // Only the <p> (5); the heading isn't a <p> so it's not selected.
    expect(el.querySelectorAll('span.wordfreq-mark').length).toBe(5);
  });

  it('is idempotent across repeated enhance calls', async () => {
    const el = container('<p>alpha alpha alpha alpha alpha</p>');
    await enhanceDom(el, { wordFreq: true });
    const first = el.querySelectorAll('span.wordfreq-mark').length;
    await enhanceDom(el, { wordFreq: true });
    expect(el.querySelectorAll('span.wordfreq-mark').length).toBe(first);
  });

  it('preserves surrounding text exactly', async () => {
    const el = container('<p>alpha with adjacent text alpha alpha alpha alpha</p>');
    await enhanceDom(el, { wordFreq: true });
    expect(el.querySelector('p').textContent).toBe('alpha with adjacent text alpha alpha alpha alpha');
  });
});
