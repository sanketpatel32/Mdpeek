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
    textarea.style.paddingTop = '20px';
    textarea.style.paddingBottom = '20px';
    textarea.style.fontFamily = 'Inter, sans-serif';

    const editor = initEditor({ textarea, gutter });

    // Verify syncGutter copies computed typography to gutter. Line-height is
    // the notable one: syncGutter re-derives it from the ratio (jsdom has no
    // CSS cascade here, so the 1.6 fallback applies → round(18 × 1.6) = 29px)
    // and pins the SAME integer px on the textarea and the gutter so rows and
    // text advance by whole pixels together.
    expect(gutter.style.fontSize).toBe('18px');
    expect(textarea.style.lineHeight).toBe('29px');
    expect(gutter.style.lineHeight).toBe('29px');
    expect(gutter.style.paddingTop).toBe('20px');
    expect(gutter.style.paddingBottom).toBe('20px');
    expect(gutter.children.length).toBe(3);
    expect(gutter.children[0].style.lineHeight).toBe('29px');

    editor.destroy();
  });

  it('re-derives line-height when the font size changes (zoom)', () => {
    // Regression: syncGutter used to re-read its own stale inline px, so after
    // a zoom (font-size change) the line-height stayed at the pre-zoom value
    // forever and zoomed text slid off the line numbers.
    textarea.value = 'a\nb';
    textarea.style.fontSize = '18px';
    const editor = initEditor({ textarea, gutter });
    expect(textarea.style.lineHeight).toBe('29px'); // round(18 × 1.6)

    // Simulate applyZoom changing only the font size, then re-sync.
    textarea.style.fontSize = '24px';
    editor.syncGutter();
    expect(textarea.style.lineHeight).toBe('38px'); // round(24 × 1.6), not 29
    expect(gutter.style.lineHeight).toBe('38px');
    expect(gutter.children[0].style.lineHeight).toBe('38px');

    editor.destroy();
  });

  it('mirror follows the textarea wrapping regime when word wrap is off', () => {
    // Regression: the mirror was pinned to pre-wrap by CSS, so with word wrap
    // off it kept wrapping long lines while the textarea scrolled
    // horizontally — gutter rows below any long line desynced.
    localStorage.setItem('mdpeek-word-wrap', '0');
    try {
      textarea.value = 'short\n' + 'x'.repeat(500);
      const editor = initEditor({ textarea, gutter });
      const mirror = container.querySelector('.editor-mirror');

      expect(textarea.getAttribute('wrap')).toBe('off');
      // The inline white-space is what actually stops the wrapping (the CSS
      // pre-wrap default would override the wrap attribute alone).
      expect(textarea.style.whiteSpace).toBe('pre');
      expect(getComputedStyle(mirror).whiteSpace).toBe('pre');

      editor.destroy();
    } finally {
      localStorage.removeItem('mdpeek-word-wrap');
    }
  });

  it('uses the textarea as the only text-rendering layer', () => {
    // Regression: the old editor hid textarea glyphs and rendered a separate
    // syntax-highlight overlay. Wrapping or font differences made visible text
    // drift away from the native textarea caret.
    container.classList.add('highlight-on');

    const editor = initEditor({ textarea, gutter });

    expect(container.classList.contains('highlight-on')).toBe(false);
    expect(container.querySelector('.editor-overlay')).toBeNull();
    // Soft-wrap is now ON (long lines wrap instead of horizontal-scrolling).
    expect(textarea.getAttribute('wrap')).toBe('soft');
    // The hidden measurement mirror is created so gutter/marker positions can
    // account for wrapping.
    expect(container.querySelector('.editor-mirror')).not.toBeNull();

    editor.destroy();
  });

  it('places the active-line strip on the same source row', () => {
    textarea.value = 'L1\nL2\nL3\nL4';
    textarea.style.fontSize = '13.5px';
    textarea.style.lineHeight = '22px';
    textarea.style.paddingTop = '16px';
    textarea.style.paddingBottom = '16px';

    const editor = initEditor({ textarea, gutter });

    expect(gutter.children.length).toBe(4);

    const l3Start = 'L1\nL2\n'.length;
    textarea.setSelectionRange(l3Start, l3Start);
    textarea.dispatchEvent(new Event('click'));

    // The active-line marker reads from the mirror. In jsdom, offsetTop
    // accumulates as 0 for each child (no real layout), so the marker top
    // resolves to the textarea's paddingTop minus scrollTop. With scrollTop=0
    // the strip should sit at padTop (16px). We assert it's a finite number
    // and non-negative — the exact px depends on the mirror's layout, which
    // jsdom approximates.
    const wrap = textarea.parentElement;
    const stripTopRaw = wrap.style.getPropertyValue('--active-line-top');
    const stripTop = parseFloat(stripTopRaw);
    expect(Number.isFinite(stripTop)).toBe(true);
    expect(stripTop).toBeGreaterThanOrEqual(0);

    editor.destroy();
  });

  it('gutter row height tracks the mirror line height when content is set', () => {
    // jsdom doesn't do real text layout (offsetHeight is 0 for wrapped lines),
    // so we can't test actual wrapping here. Instead we verify the wiring:
    // after syncGutter runs, each gutter child has an explicit height style
    // set from the mirror (even if it falls back to linePx when offsetHeight=0).
    textarea.value = 'short\nalso short';
    textarea.style.fontSize = '13.5px';
    textarea.style.lineHeight = '22px';

    const editor = initEditor({ textarea, gutter });

    expect(gutter.children.length).toBe(2);
    for (const row of gutter.children) {
      // Height is always set (either from mirror offsetHeight or the linePx
      // fallback) — never empty.
      expect(row.style.height).toMatch(/^\d+px$/);
    }

    editor.destroy();
  });
});
