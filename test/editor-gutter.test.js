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
});
