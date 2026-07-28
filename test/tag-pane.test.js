import { describe, it, expect, beforeEach } from 'vitest';
import { initTagPane } from '../src/views/tag-pane.js';

// The tag pane is a DOM-presenter singleton. We test that render() produces
// the expected chip markup + count, and that clicking a chip fires the
// onTag callback with the right value. jsdom provides the DOM.

describe('tag pane (v0.45.0)', () => {
  let pane;
  let clicked;
  beforeEach(() => {
    // Reset the singleton so each test gets a fresh DOM build.
    document.getElementById('tag-pane')?.remove();
    const resetter = initTagPane(() => {});
    if (resetter.resetForTest) resetter.resetForTest();
    clicked = null;
    pane = initTagPane((tag) => { clicked = tag; });
  });

  it('renders tags as clickable chips', () => {
    pane.render(['work', 'urgent', 'idea']);
    const chips = document.querySelectorAll('.tag-chip');
    expect(chips).toHaveLength(3);
    expect(chips[0].dataset.tag).toBe('work');
    expect(chips[0].textContent).toBe('#work');
  });

  it('shows the tag count', () => {
    pane.render(['a', 'b']);
    expect(document.querySelector('.tag-pane-count').textContent).toBe('2 tags');
  });

  it('shows the empty state for no tags', () => {
    pane.render([]);
    expect(document.querySelector('.tag-pane-empty').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('.tag-chip').length).toBe(0);
  });

  it('fires the onTag callback when a chip is clicked', () => {
    pane.render(['alpha']);
    const chip = document.querySelector('.tag-chip');
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicked).toBe('alpha');
  });

  it('escapes special chars in a tag name', () => {
    pane.render(['<script>']);
    const chip = document.querySelector('.tag-chip');
    // The data-attr and visible text are both escaped.
    expect(chip.dataset.tag).toBe('<script>');
    expect(chip.textContent).toBe('#<script>');
    // And there's no actual <script> element injected.
    expect(document.querySelectorAll('script').length).toBe(0);
  });

  it('open/close toggles the hidden class', () => {
    const overlay = document.getElementById('tag-pane');
    expect(overlay.classList.contains('hidden')).toBe(true);
    pane.open();
    expect(overlay.classList.contains('hidden')).toBe(false);
    pane.close();
    expect(overlay.classList.contains('hidden')).toBe(true);
  });
});
