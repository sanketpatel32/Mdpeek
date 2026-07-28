import { describe, it, expect } from 'vitest';
import { themeForHour, prefersDarkFromMedia, THEME_MODE_KEY } from '../src/lib/theme-schedule.js';

describe('themeForHour', () => {
  it('returns dark for evening hours (19:00–23:59)', () => {
    for (const h of [19, 20, 21, 22, 23]) {
      expect(themeForHour(h)).toBe('dark');
    }
  });

  it('returns dark for early-morning hours (00:00–06:59)', () => {
    for (const h of [0, 1, 2, 3, 4, 5, 6]) {
      expect(themeForHour(h)).toBe('dark');
    }
  });

  it('returns light for daytime hours (07:00–18:59)', () => {
    for (const h of [7, 8, 9, 12, 15, 18]) {
      expect(themeForHour(h)).toBe('light');
    }
  });

  it('coerces non-integer and out-of-range hours safely', () => {
    expect(themeForHour(7.9)).toBe('light');   // truncated to 7
    expect(themeForHour(24)).toBe('dark');     // wraps to 0
    expect(themeForHour(-1)).toBe('dark');     // wraps to 23
    expect(themeForHour('21')).toBe('dark');   // numeric string
    expect(themeForHour(NaN)).toBe('light');   // fallback
  });
});

describe('prefersDarkFromMedia', () => {
  it('returns true when the media query reports dark', () => {
    expect(prefersDarkFromMedia({ matches: true })).toBe(true);
  });

  it('returns false when the media query reports light', () => {
    expect(prefersDarkFromMedia({ matches: false })).toBe(false);
  });

  it('returns false for null/undefined input', () => {
    expect(prefersDarkFromMedia(null)).toBe(false);
    expect(prefersDarkFromMedia(undefined)).toBe(false);
  });
});

describe('THEME_MODE_KEY', () => {
  it('exports the stable localStorage key name', () => {
    expect(THEME_MODE_KEY).toBe('mdpeek-theme-mode');
  });
});
