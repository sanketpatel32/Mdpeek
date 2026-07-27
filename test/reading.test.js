import { describe, it, expect } from 'vitest';
import {
  WIDTHS, FONTS, THEMES, FONT_FAMILIES, FONT_FAMILY_STACK,
  WIDTH_PX, FONT_PX, THEME_COLORS,
  DEFAULTS,
  cycle, nextWidth, prevWidth, nextFont, prevFont, nextTheme, nextFontFamily,
  readingTimeMinutes, readingTimeLabel, READING_WPM,
  loadReaderPrefs,
} from '../src/lib/reading.js';

// Minimal localStorage stub for the pure loadReaderPrefs tests.
function makeStore(map = {}) {
  return {
    _m: { ...map },
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; },
    setItem(k, v) { this._m[k] = String(v); },
  };
}

describe('reading — option lists', () => {
  it('exposes four width stops in order (v0.35.1: added fill)', () => {
    expect(WIDTHS).toEqual(['narrow', 'medium', 'wide', 'fill']);
  });
  it('exposes three font stops in order', () => {
    expect(FONTS).toEqual(['small', 'medium', 'large']);
  });
  it('exposes three theme stops in order', () => {
    expect(THEMES).toEqual(['light', 'sepia', 'dark']);
  });
  it('maps every FIXED width stop to a px value (fill has no cap)', () => {
    const fixed = WIDTHS.filter((w) => w !== 'fill');
    expect(fixed).toEqual(['narrow', 'medium', 'wide']);
    fixed.forEach((w) => { expect(typeof WIDTH_PX[w]).toBe('number'); });
  });
  it('does not define a px value for fill (handled in CSS as max-width: none)', () => {
    expect(WIDTH_PX.fill).toBeUndefined();
  });
  it('maps every font stop to a px value', () => {
    FONTS.forEach((f) => { expect(typeof FONT_PX[f]).toBe('number'); });
  });
  it('maps every theme to [bg, fg] color pair', () => {
    THEMES.forEach((t) => {
      const pair = THEME_COLORS[t];
      expect(Array.isArray(pair)).toBe(true);
      expect(pair).toHaveLength(2);
    });
  });
  it('exposes three font-family stops in order (v0.38.0)', () => {
    expect(FONT_FAMILIES).toEqual(['sans', 'serif', 'mono']);
  });
  it('maps every font-family stop to a CSS stack string (v0.38.0)', () => {
    FONT_FAMILIES.forEach((f) => {
      expect(typeof FONT_FAMILY_STACK[f]).toBe('string');
    });
    // 'sans' deliberately empty so the reader inherits the global app font.
    expect(FONT_FAMILY_STACK.sans).toBe('');
    expect(FONT_FAMILY_STACK.serif.toLowerCase()).toContain('serif');
    expect(FONT_FAMILY_STACK.mono.toLowerCase()).toContain('monospace');
  });
});

describe('reading — cycle()', () => {
  it('advances forward and wraps at the end', () => {
    expect(cycle(['a', 'b', 'c'], 'a', 1)).toBe('b');
    expect(cycle(['a', 'b', 'c'], 'b', 1)).toBe('c');
    expect(cycle(['a', 'b', 'c'], 'c', 1)).toBe('a');
  });
  it('goes backward and wraps at the start', () => {
    expect(cycle(['a', 'b', 'c'], 'b', -1)).toBe('a');
    expect(cycle(['a', 'b', 'c'], 'a', -1)).toBe('c');
  });
  it('falls back to the first option for an unknown current', () => {
    expect(cycle(['a', 'b'], 'zzz', 1)).toBe('a');
  });
  it('returns undefined for an empty options list', () => {
    expect(cycle([], 'x', 1)).toBeUndefined();
  });
});

describe('reading — typed cycle helpers', () => {
  it('nextWidth / prevWidth advance and retreat across WIDTHS (v0.35.1: 4 stops)', () => {
    expect(nextWidth('narrow')).toBe('medium');
    expect(nextWidth('medium')).toBe('wide');
    expect(nextWidth('wide')).toBe('fill');        // v0.35.1: new stop
    expect(nextWidth('fill')).toBe('narrow');      // wraps
    expect(prevWidth('medium')).toBe('narrow');
    expect(prevWidth('narrow')).toBe('fill');      // wraps (was 'wide' pre-0.35.1)
    expect(prevWidth('fill')).toBe('wide');
  });
  it('nextFont / prevFont advance and retreat across FONTS', () => {
    expect(nextFont('small')).toBe('medium');
    expect(nextFont('large')).toBe('small');      // wraps
    expect(prevFont('medium')).toBe('small');
    expect(prevFont('small')).toBe('large');      // wraps
  });
  it('nextTheme advances and wraps across THEMES', () => {
    expect(nextTheme('light')).toBe('sepia');
    expect(nextTheme('sepia')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');      // wraps
  });
  it('nextFontFamily advances and wraps across FONT_FAMILIES (v0.38.0)', () => {
    expect(nextFontFamily('sans')).toBe('serif');
    expect(nextFontFamily('serif')).toBe('mono');
    expect(nextFontFamily('mono')).toBe('sans');   // wraps
  });
});

describe('reading — reading-time estimate', () => {
  it('uses a 200 wpm rate', () => {
    expect(READING_WPM).toBe(200);
  });
  it('returns at least 1 minute for any non-negative input', () => {
    expect(readingTimeMinutes(0)).toBe(1);
    expect(readingTimeMinutes(50)).toBe(1);
    expect(readingTimeMinutes(199)).toBe(1);
  });
  it('rounds to the nearest minute', () => {
    expect(readingTimeMinutes(200)).toBe(1);
    expect(readingTimeMinutes(300)).toBe(2);   // 1.5 → 2
    expect(readingTimeMinutes(500)).toBe(3);   // 2.5 → 3
    expect(readingTimeMinutes(1000)).toBe(5);
  });
  it('treats invalid input as zero words (→ 1 min)', () => {
    expect(readingTimeMinutes(NaN)).toBe(1);
    expect(readingTimeMinutes(undefined)).toBe(1);
    expect(readingTimeMinutes(-5)).toBe(1);
  });
  it('produces a human "N min read" label', () => {
    expect(readingTimeLabel(0)).toBe('1 min read');
    expect(readingTimeLabel(400)).toBe('2 min read');
    expect(readingTimeLabel(1000)).toBe('5 min read');
  });
});

describe('reading — loadReaderPrefs', () => {
  it('returns the defaults when nothing is stored', () => {
    const prefs = loadReaderPrefs(makeStore());
    expect(prefs).toEqual(DEFAULTS);
    expect(prefs.width).toBe('medium');
    expect(prefs.font).toBe('medium');
    expect(prefs.theme).toBe('light');
    expect(prefs.fontFamily).toBe('sans');
  });
  it('restores valid stored values', () => {
    const store = makeStore({
      'mdpeek-reader-width': 'wide',
      'mdpeek-reader-font': 'large',
      'mdpeek-reader-theme': 'dark',
      'mdpeek-reader-font-family': 'serif',
    });
    expect(loadReaderPrefs(store)).toEqual({ width: 'wide', font: 'large', theme: 'dark', fontFamily: 'serif' });
  });
  it('falls back to default for an invalid stored value', () => {
    const store = makeStore({
      'mdpeek-reader-width': 'banana',   // invalid
      'mdpeek-reader-font': 'large',     // valid
      'mdpeek-reader-theme': 'neon',     // invalid
      'mdpeek-reader-font-family': 'comic-sans', // invalid
    });
    expect(loadReaderPrefs(store)).toEqual({ width: 'medium', font: 'large', theme: 'light', fontFamily: 'sans' });
  });
  it('handles a partially-populated store', () => {
    const store = makeStore({ 'mdpeek-reader-theme': 'sepia' });
    expect(loadReaderPrefs(store)).toEqual({ width: 'medium', font: 'medium', theme: 'sepia', fontFamily: 'sans' });
  });
  it('restores font-family even when other prefs are unset (v0.38.0)', () => {
    const store = makeStore({ 'mdpeek-reader-font-family': 'mono' });
    const prefs = loadReaderPrefs(store);
    expect(prefs.fontFamily).toBe('mono');
    expect(prefs.width).toBe('medium'); // others still default
  });
});
