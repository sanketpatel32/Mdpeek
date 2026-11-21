// Unit tests for the terminal module's pure helpers and lifecycle controller.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initTerminal, readCssVar, xtermThemeFromApp, normalizeOscCwd } from '../src/views/terminal.js';

describe('initTerminal', () => {
  it('returns a safe controller with no-op lifecycle methods and notifies on open/toggle', () => {
    const onToast = vi.fn();
    const terminal = initTerminal({ cwdProvider: () => '.', onToast });
    expect(typeof terminal.open).toBe('function');
    expect(typeof terminal.close).toBe('function');
    expect(typeof terminal.toggle).toBe('function');
    expect(typeof terminal.destroyAll).toBe('function');

    terminal.open();
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('removed'));

    terminal.toggle();
    expect(onToast).toHaveBeenCalledTimes(2);

    expect(() => terminal.destroyAll()).not.toThrow();
    expect(() => terminal.setTheme()).not.toThrow();
    expect(() => terminal.updateZoom(1.2)).not.toThrow();
  });
});

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
    expect(theme.foreground).toBe('#e8e8e8');
    expect(theme.red).toBe('#ff5555');
    expect(theme.blue).toBe('#8be9fd');
  });

  it('derives the ANSI palette from the theme alert/success tokens', () => {
    document.documentElement.style.setProperty('--success', '#50fa7b');
    document.documentElement.style.setProperty('--alert-warning', '#f1fa8c');
    document.documentElement.style.setProperty('--alert-note', '#8be9fd');
    document.documentElement.style.setProperty('--alert-important', '#ff79c6');
    const theme = xtermThemeFromApp();
    expect(theme.green).toBe('#50fa7b');
    expect(theme.yellow).toBe('#f1fa8c');
    expect(theme.cyan).toBe('#8be9fd');
    expect(theme.magenta).toBe('#ff79c6');
    expect(theme.brightGreen).toBe('#50fa7b');
    expect(theme.brightYellow).toBe('#f1fa8c');
  });

  it('always returns the full ANSI 16-color palette', () => {
    const theme = xtermThemeFromApp();
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

describe('normalizeOscCwd', () => {
  it('parses OSC 7 Windows drive paths (file://host/C:/…)', () => {
    expect(normalizeOscCwd('file://desktop/C:/Users/sanpa/docs')).toBe(String.raw`C:\Users\sanpa\docs`);
  });

  it('parses OSC 7 Unix-style paths without converting separators', () => {
    expect(normalizeOscCwd('file://wsl/home/user/projects')).toBe('/home/user/projects');
  });

  it('passes through bare OSC 9;9 Windows paths', () => {
    expect(normalizeOscCwd(String.raw`C:\Users\sanpa\docs`)).toBe(String.raw`C:\Users\sanpa\docs`);
  });

  it('decodes percent-encoded characters', () => {
    expect(normalizeOscCwd('file://host/C:/Users/My%20Docs')).toBe(String.raw`C:\Users\My Docs`);
  });

  it('returns empty string for empty input and tolerates malformed encoding', () => {
    expect(normalizeOscCwd('')).toBe('');
    expect(normalizeOscCwd('file://host/C:/bad/%e0%80')).toContain('C:');
  });
});
