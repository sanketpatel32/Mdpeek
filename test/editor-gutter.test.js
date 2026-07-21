import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initEditor } from '../src/views/editor.js';

describe('Editor Gutter Alignment', () => {
  let container;
  let textarea;
  let gutter;

  beforeEach(() => {
    container = document.createElement('div');
    container.className = 'editor-wrap';
    
    gutter = document.createElement('div');
    gutter.className = 'gutter';
    
    textarea = document.createElement('textarea');
    textarea.className = 'editor';
    
    container.appendChild(gutter);
    container.appendChild(textarea);
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('synchronizes gutter typography and padding with textarea', () => {
    textarea.value = 'line 1\nline 2\nline 3';
    textarea.style.fontSize = '18px';
    textarea.style.lineHeight = '28px';
    textarea.style.paddingTop = '20px';
    textarea.style.paddingBottom = '20px';
    textarea.style.fontFamily = 'Inter, sans-serif';

    const editor = initEditor({
      textarea,
      gutter,
      highlightEnabled: false,
    });

    // Verify syncGutter copies computed typography to gutter
    expect(gutter.style.fontSize).toBe('18px');
    expect(gutter.style.lineHeight).toBe('28px');
    expect(gutter.style.paddingTop).toBe('20px');
    expect(gutter.style.paddingBottom).toBe('20px');
    expect(gutter.children.length).toBe(3);
    expect(gutter.children[0].style.lineHeight).toBe('28px');

    editor.destroy();
  });

  // Regression: when a logical line soft-wraps to multiple visual rows, the
  // active-line strip must sum the wrap-aware heights of every prior gutter
  // row, not assume one-row-per-line. The pre-fix formula
  //   top = padTop + lineNum × linePx
  // painted the strip on the wrong visual row after any wrapped line, which
  // was half of the "cursor points to one line but text is elsewhere" bug.
  // We simulate wrap by manually assigning the wrapped gutter row a taller
  // height (the mirror-based measurement does this in real layout; jsdom
  // doesn't lay out, so we inject the post-measurement heights directly).
  it('places the active-line strip using wrap-aware row heights', () => {
    // 4 logical lines: L1, L2 (wraps), L4, L5. Caret will land at the start
    // of L4 — visually below the wrapped row.
    textarea.value = 'L1\nL2 long wrapped line\nL4\nL5';
    textarea.style.fontSize = '13.5px';
    textarea.style.lineHeight = '22px';
    textarea.style.paddingTop = '16px';
    textarea.style.paddingBottom = '16px';

    const editor = initEditor({
      textarea,
      gutter,
      highlightEnabled: false,
    });

    // syncGutter populated 4 gutter children (one per logical line). The wrapped
    // line is L2 — gutter child index 1. Simulate the mirror's wrap measurement
    // by giving that child a doubled height. (In real layout, syncGutter does
    // this via the mirror element's getBoundingClientRect; jsdom returns 0
    // there, so the production code's `|| linePx` fallback leaves every row at
    // linePx. We set the value directly to test that updateActiveLineMarker
    // reads the wrap-aware heights rather than recomputing lineNum × linePx.)
    expect(gutter.children.length).toBe(4);
    gutter.children[1].style.height = '44px'; // 2 visual rows × 22px

    // Place the caret at the start of L4 (logical line index 2 — visually
    // BELOW the wrapped L2 row).
    const l4Start = 'L1\nL2 long wrapped line\n'.length; // 24
    textarea.setSelectionRange(l4Start, l4Start);
    textarea.dispatchEvent(new Event('click'));

    const wrap = textarea.parentElement;
    const stripTop = parseFloat(wrap.style.getPropertyValue('--active-line-top'));
    // Expected: padTop(16) + L1(22) + L2-wrapped(44) − scrollTop(0) = 82.
    // Pre-fix buggy value would have been 16 + 2 × 22 = 60 (no wrap awareness).
    expect(stripTop).toBe(82);

    // Sanity: the buggy value is different — confirms the test would catch a
    // regression to the naive formula.
    expect(stripTop).not.toBe(16 + 2 * 22);

    editor.destroy();
  });
});
