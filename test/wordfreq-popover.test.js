import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initWordFreqPopover } from '../src/views/wordfreq-popover.js';

// DOM smoke for the word-frequency popover. The pure ranking logic lives in
// wordfreq.test.js; these guard the rendering + click glue.

describe('wordfreq-popover view', () => {
  let popover;
  beforeEach(() => {
    popover = initWordFreqPopover();
  });
  afterEach(() => {
    popover.close();
  });

  it('renders the overlay hidden until opened', () => {
    const overlay = document.getElementById('wf-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('open() shows a ranked list of items with counts and bars', () => {
    popover.open({
      items: [
        { word: 'apple', count: 5 },
        { word: 'beta', count: 2 },
      ],
    });
    const overlay = document.getElementById('wf-overlay');
    expect(overlay.classList.contains('hidden')).toBe(false);
    const items = overlay.querySelectorAll('.wf-item');
    expect(items.length).toBe(2);
    expect(items[0].querySelector('.wf-word').textContent).toBe('apple');
    expect(items[0].querySelector('.wf-count').textContent).toBe('5');
    expect(items[0].querySelector('.wf-rank').textContent).toBe('1');
  });

  it('shows the empty state when there are no items', () => {
    popover.open({ items: [] });
    const overlay = document.getElementById('wf-overlay');
    expect(overlay.querySelector('.wf-empty').classList.contains('hidden')).toBe(false);
    expect(overlay.querySelectorAll('.wf-item').length).toBe(0);
  });

  it('clicking an item calls onWord with that word', () => {
    let clicked = null;
    popover.open({
      items: [{ word: 'apple', count: 3 }],
      onWord: (w) => { clicked = w; },
    });
    document.querySelector('#wf-overlay .wf-item').click();
    expect(clicked).toBe('apple');
  });

  it('Esc closes the popover', () => {
    popover.open({ items: [{ word: 'x', count: 1 }] });
    const overlay = document.getElementById('wf-overlay');
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('scales the bar fill relative to the top word', () => {
    popover.open({
      items: [
        { word: 'top', count: 10 },
        { word: 'half', count: 5 },
      ],
    });
    const fills = document.querySelectorAll('#wf-overlay .wf-bar-fill');
    // Top word → 100%; half-count → 50%.
    expect(fills[0].style.width).toBe('100%');
    expect(fills[1].style.width).toBe('50%');
  });

  it('escapes the word text (no HTML injection)', () => {
    popover.open({ items: [{ word: '<script>x</script>', count: 1 }] });
    const overlay = document.getElementById('wf-overlay');
    // The literal <script> tag must not become a live element.
    expect(overlay.querySelectorAll('script').length).toBe(0);
    expect(overlay.querySelector('.wf-word').textContent).toBe('<script>x</script>');
  });
});
