import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initCaptureHud } from '../src/views/capture-hud.js';

// DOM smoke for the capture HUD — mirrors table-editor.test.js. The pure
// formatting/injection rules live in capture.test.js; these guard the
// focus / Enter / Esc / Shift+Enter / disabled-during-save glue.

describe('capture-hud view', () => {
  let hud;
  beforeEach(() => {
    hud = initCaptureHud();
  });
  afterEach(() => {
    hud.close();
  });

  it('renders the HUD + a textarea and is hidden until opened', () => {
    const overlay = document.getElementById('capture-hud');
    expect(overlay).toBeTruthy();
    expect(overlay.classList.contains('hidden')).toBe(true);
    expect(overlay.querySelector('textarea.capture-input')).toBeTruthy();
  });

  it('open() shows the HUD and the destination line', () => {
    hud.open({ destination: '→ 2026-08-01.md (today\'s note)', onCapture: async () => {} });
    const overlay = document.getElementById('capture-hud');
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(overlay.querySelector('.capture-dest').textContent).toContain('2026-08-01.md');
  });

  it('Enter on empty input closes without calling onCapture (no empty bullets)', async () => {
    const onCapture = vi.fn();
    hud.open({ onCapture });
    const overlay = document.getElementById('capture-hud');
    // Input is empty by default.
    overlay.querySelector('.capture-input').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    // Allow any async to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(onCapture).not.toHaveBeenCalled();
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('Enter with text calls onCapture and closes on success', async () => {
    const onCapture = vi.fn(async () => {});
    hud.open({ onCapture });
    const overlay = document.getElementById('capture-hud');
    const input = overlay.querySelector('.capture-input');
    input.value = 'ship release notes';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(onCapture).toHaveBeenCalledWith('ship release notes');
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('Shift+Enter does not submit (lets the user add a newline)', async () => {
    const onCapture = vi.fn();
    hud.open({ onCapture });
    const overlay = document.getElementById('capture-hud');
    const input = overlay.querySelector('.capture-input');
    input.value = 'idea';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(onCapture).not.toHaveBeenCalled();
    expect(overlay.classList.contains('hidden')).toBe(false);
  });

  it('Esc closes without calling onCapture', async () => {
    const onCapture = vi.fn();
    hud.open({ onCapture });
    const overlay = document.getElementById('capture-hud');
    overlay.querySelector('.capture-input').value = 'idea';
    overlay.querySelector('.capture-input').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(onCapture).not.toHaveBeenCalled();
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('keeps the input + text intact and re-enables on capture failure', async () => {
    const onCapture = vi.fn(async () => { throw new Error('disk full'); });
    hud.open({ onCapture });
    const overlay = document.getElementById('capture-hud');
    const input = overlay.querySelector('.capture-input');
    input.value = 'important thought';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    // Still open, text preserved, input usable again.
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('important thought');
    expect(overlay.querySelector('.capture-dest').textContent).toContain('disk full');
  });

  it('disables the input during the async save (no double-submit)', async () => {
    let resolveSave;
    const onCapture = vi.fn(() => new Promise((res) => { resolveSave = res; }));
    hud.open({ onCapture });
    const overlay = document.getElementById('capture-hud');
    const input = overlay.querySelector('.capture-input');
    input.value = 'idea';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // The handler is async; give it a tick to flip `saving`.
    await new Promise((r) => setTimeout(r, 0));
    expect(input.disabled).toBe(true);
    // A second Enter while disabled must not re-call onCapture.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCapture).toHaveBeenCalledTimes(1);
    // Resolve and confirm it closes.
    resolveSave();
    await new Promise((r) => setTimeout(r, 0));
    expect(overlay.classList.contains('hidden')).toBe(true);
  });
});
