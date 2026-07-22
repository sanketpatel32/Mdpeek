// Unit tests for the integrated terminal module's pure helpers.
//
// We can't integration-test a live PTY from vitest (it needs the Tauri Rust
// runtime), so we test the pure pieces: the CSS-var reader and the
// xterm-theme mapper. These are the only bits with non-trivial logic.
//
// This file also establishes the Tauri IPC mock pattern for the suite — the
// first test file to mock `@tauri-apps/api/core`. Future tests of modules
// that call invoke/Channel can copy this shape.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the Tauri core module so importing terminal.js doesn't try to talk to
// the (absent) Rust runtime. Channel is a minimal stand-in: `onmessage` is the
// handler the real API calls on every backend send; send() invokes it.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => ({ id: 1 })),
  Channel: class {
    constructor(fn) { this.onmessage = fn || null; }
    send(m) { if (this.onmessage) this.onmessage(m); }
  },
}));

// Mock xterm.js + addons as inert constructors so we don't pull in the full
// renderer (which needs canvas/Workers that jsdom doesn't provide).
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor(opts) { this.options = opts || {}; }
    loadAddon() {}
    open() {}
    write() {}
    clear() {}
    focus() {}
    dispose() {}
    on() {}
    onData() { return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
    get cols() { return 80; }
    get rows() { return 24; }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { activate() {} dispose() {} fit() {} },
}));
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class { activate() {} dispose() {} },
}));

import { readCssVar, xtermThemeFromApp } from '../src/views/terminal.js';

beforeEach(() => {
  // Reset the :root inline style so each test starts from a clean slate.
  document.documentElement.style.cssText = '';
  // jsdom supports getComputedStyle on documentElement with inline styles, but
  // not CSS rules from <style>/<link>. Tests below set vars via inline style.
});

describe('readCssVar', () => {
  it('returns the value of a set CSS var, trimmed', () => {
    document.documentElement.style.setProperty('--accent', '  #0071e3 ');
    expect(readCssVar('--accent')).toBe('#0071e3');
  });

  it('returns the fallback when the var is unset', () => {
    expect(readCssVar('--nonexistent', '#fff')).toBe('#fff');
  });

  it('returns the fallback when the var is set but empty', () => {
    document.documentElement.style.setProperty('--empty', '');
    expect(readCssVar('--empty', 'fallback')).toBe('fallback');
  });

  it('returns an empty string by default if no fallback is given', () => {
    expect(readCssVar('--alsounset')).toBe('');
  });
});

describe('xtermThemeFromApp', () => {
  it('maps the key app vars to the xterm theme slots', () => {
    document.documentElement.style.setProperty('--bg', '#1d1d1f');
    document.documentElement.style.setProperty('--fg', '#f9f9fb');
    document.documentElement.style.setProperty('--accent', '#0071e3');
    document.documentElement.style.setProperty('--danger', '#ff3b30');
    document.documentElement.style.setProperty('--surface-hover', '#2a2a2c');

    const theme = xtermThemeFromApp();
    expect(theme.background).toBe('#1d1d1f');
    expect(theme.foreground).toBe('#f9f9fb');
    expect(theme.cursor).toBe('#f9f9fb');      // cursor uses fg
    expect(theme.cursorAccent).toBe('#1d1d1f'); // accent uses bg
    expect(theme.red).toBe('#ff3b30');          // red uses --danger
    expect(theme.blue).toBe('#0071e3');         // blue uses --accent
  });

  it('uses sensible fallbacks when vars are missing', () => {
    const theme = xtermThemeFromApp();
    expect(theme.background).toBe('#000000');
    expect(theme.foreground).toBe('#ffffff');
    expect(theme.red).toBe('#ff0000');
    expect(theme.blue).toBe('#0000ff');
  });

  it('always returns the full ANSI 16-color palette', () => {
    const theme = xtermThemeFromApp();
    // xterm.js requires all 16 base colors; missing keys break the renderer.
    for (const slot of [
      'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
      'brightMagenta', 'brightCyan', 'brightWhite',
    ]) {
      expect(typeof theme[slot]).toBe('string');
      expect(theme[slot].length).toBeGreaterThan(0);
    }
  });
});
