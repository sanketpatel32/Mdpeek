import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initEditor } from '../src/views/editor.js';

// DOM smoke for editor region folding. The pure line-math lives in fold.test.js;
// these guard the gutter-caret + overlay wiring and the CRITICAL safety
// invariant: folding never mutates textarea.value (the true source is always
// preserved — saving always writes the full document).

describe('Editor region folding', () => {
  let container;
  let textarea;
  let gutter;
  let editor;

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
    if (editor) editor.destroy();
    editor = null;
    if (container.parentNode) document.body.removeChild(container);
  });

  function mount(value) {
    textarea.value = value;
    editor = initEditor({ textarea, gutter });
    return editor;
  }

  it('renders a fold caret on heading gutter rows', () => {
    mount('# Title\nbody line 1\nbody line 2');
    // Line 1 is a heading → its gutter row has a fold caret.
    expect(gutter.children[0].querySelector('.fold-caret')).not.toBeNull();
    // Line 2 is body → no caret.
    expect(gutter.children[1].querySelector('.fold-caret')).toBeNull();
  });

  it('renders no fold carets in a doc without headings', () => {
    mount('just prose\nno headings\nhere');
    expect(gutter.querySelectorAll('.fold-caret').length).toBe(0);
  });

  it('shows ▸ on an unfolded heading and ▾ once folded', () => {
    mount('## Section\nbody');
    const caret = gutter.children[0].querySelector('.fold-caret');
    expect(caret.textContent).toBe('▸');
    caret.click();
    expect(caret.textContent).toBe('▾');
  });

  it('the fold overlay creates a marker when a section is folded', () => {
    mount('## Section\nbody line 1\nbody line 2\nbody line 3');
    const foldLayer = container.querySelector('.editor-folds');
    expect(foldLayer).not.toBeNull();
    expect(foldLayer.querySelectorAll('.fold-marker').length).toBe(0);
    gutter.children[0].querySelector('.fold-caret').click();
    expect(foldLayer.querySelectorAll('.fold-marker').length).toBe(1);
    // The marker carries the heading line it folds.
    expect(foldLayer.querySelector('.fold-marker').dataset.headingLine).toBe('1');
  });

  it('clicking the fold chip unfolds (removes the marker)', () => {
    mount('## Section\nbody line 1\nbody line 2');
    const foldLayer = container.querySelector('.editor-folds');
    gutter.children[0].querySelector('.fold-caret').click();
    expect(foldLayer.querySelectorAll('.fold-marker').length).toBe(1);
    foldLayer.querySelector('.fold-chip').click();
    expect(foldLayer.querySelectorAll('.fold-marker').length).toBe(0);
    // Caret flipped back to ▸.
    expect(gutter.children[0].querySelector('.fold-caret').textContent).toBe('▸');
  });

  it('CRITICAL: textarea.value never changes during fold/unfold', () => {
    const src = '# Title\nbody line 1\nbody line 2\n## Sub\nsub body';
    mount(src);
    const before = textarea.value;
    // Fold the h1 (line 1) — its section runs to EOF here.
    gutter.children[0].querySelector('.fold-caret').click();
    expect(textarea.value).toBe(before);
    // Fold the h2 too.
    gutter.children[3].querySelector('.fold-caret').click();
    expect(textarea.value).toBe(before);
    // Unfold both.
    container.querySelector('.editor-folds .fold-chip').click();
    expect(textarea.value).toBe(before);
    gutter.children[0].querySelector('.fold-caret').click();
    expect(textarea.value).toBe(before);
  });

  it('dims the line numbers of folded-away body rows', () => {
    mount('## Section\nbody line 1\nbody line 2');
    // Heading stays visible; body rows (2,3) get .folded-line when collapsed.
    expect(gutter.children[1].classList.contains('folded-line')).toBe(false);
    gutter.children[0].querySelector('.fold-caret').click();
    expect(gutter.children[1].classList.contains('folded-line')).toBe(true);
    expect(gutter.children[0].classList.contains('folded-line')).toBe(false);
  });

  it('toggleFoldAtCaret folds the heading owning the caret', () => {
    mount('## Section\nbody');
    // Place the caret on line 1 (the heading).
    textarea.setSelectionRange(0, 0);
    expect(editor.toggleFoldAtCaret()).toBe(true);
    expect(container.querySelector('.editor-folds .fold-marker')).not.toBeNull();
    // Caret on a body line returns false (no heading there).
    textarea.setSelectionRange(textarea.value.indexOf('body'), textarea.value.indexOf('body'));
    // Unfold first so we test the no-op path cleanly.
    container.querySelector('.editor-folds .fold-chip').click();
    expect(editor.toggleFoldAtCaret()).toBe(false);
  });

  it('unfoldAll clears every fold', () => {
    mount('## A\na body\n## B\nb body');
    gutter.children[0].querySelector('.fold-caret').click();
    gutter.children[2].querySelector('.fold-caret').click();
    expect(container.querySelectorAll('.editor-folds .fold-marker').length).toBe(2);
    editor.unfoldAll();
    expect(container.querySelectorAll('.editor-folds .fold-marker').length).toBe(0);
  });

  it('editing the doc drops stale fold state (heading line no longer exists)', () => {
    mount('## Section\nbody line');
    gutter.children[0].querySelector('.fold-caret').click();
    expect(container.querySelectorAll('.editor-folds .fold-marker').length).toBe(1);
    // Replace the whole buffer with non-heading prose and fire input.
    textarea.value = 'no headings\nno folds';
    textarea.dispatchEvent(new Event('input'));
    // Stale fold state is reconciled away → no markers remain.
    expect(container.querySelectorAll('.editor-folds .fold-marker').length).toBe(0);
  });

  it('is fence-safe (a # inside a code block is not a foldable heading)', () => {
    mount('```\n# not a heading\n```\n## Real');
    // Only line 4 (## Real) should carry a caret.
    expect(gutter.children[0].querySelector('.fold-caret')).toBeNull();
    expect(gutter.children[3].querySelector('.fold-caret')).not.toBeNull();
  });
});
