// Pure helpers for the immersive Reading Mode (v0.34.0). Kept DOM-free so the
// cycling math + reading-time estimate are unit-testable in isolation.
//
// Three orthogonal preferences, each a small ordered cycle:
//   width:  narrow → medium → wide → fill  (column max-width in px, or fill)
//   font:   small  → medium → large (article base font-size in px)
//   theme:  light  → sepia  → dark  (background/foreground presets)
//
// All three are persisted independently under mdpeek-reader-<name> so reopening
// Reading Mode restores the last-used combo. The cycles are deliberately short
// so keyboard cycling ([ ] + - T) is fast.
//
// v0.35.1: added a 'fill' width stop — removes the max-width cap entirely so
// the article stretches to the viewport (with side padding). The three fixed
// stops remain for readers who prefer a constrained column.

export const WIDTHS = ['narrow', 'medium', 'wide', 'fill'];
export const FONTS = ['small', 'medium', 'large'];
export const THEMES = ['light', 'sepia', 'dark'];

// Concrete px values per FIXED stop (fill has no cap — it's handled in CSS via
// a special rule that sets max-width: none). Exposed for tests + the setters.
export const WIDTH_PX = { narrow: 580, medium: 720, wide: 880 };
export const FONT_PX = { small: 17, medium: 19, large: 21 };

// Reader color presets. Independent of the app theme — you can read in sepia
// while the app stays dark. Each entry is [bg, fg].
export const THEME_COLORS = {
  light: ['#ffffff', '#1d1d1f'],
  sepia: ['#f8f1e3', '#5b4636'],
  dark: ['#1a1a1c', '#e6e6e6'],
};

// Default combo — comfortable for most readers. Medium width + medium font is
// the Safari-Reader-style default; light theme matches the typical app theme.
export const DEFAULTS = { width: 'medium', font: 'medium', theme: 'light' };

// Cycle an ordered list forward (dir=1) or backward (dir=-1). Wraps around.
//   cycle(['a','b','c'], 'a', 1)  → 'b'
//   cycle(['a','b','c'], 'c', 1)  → 'a'   (wraps)
//   cycle(['a','b','c'], 'b', -1) → 'a'
// Falls back to the first option if `current` isn't in the list (defensive —
// handles corrupted localStorage like an unknown theme name).
export function cycle(options, current, dir = 1) {
  if (!Array.isArray(options) || options.length === 0) return undefined;
  const idx = options.indexOf(current);
  if (idx === -1) return options[0];
  const n = options.length;
  return options[(idx + dir + n) % n];
}

export const nextWidth = (cur) => cycle(WIDTHS, cur, 1);
export const prevWidth = (cur) => cycle(WIDTHS, cur, -1);
export const nextFont = (cur) => cycle(FONTS, cur, 1);
export const prevFont = (cur) => cycle(FONTS, cur, -1);
export const nextTheme = (cur) => cycle(THEMES, cur, 1);

// Estimate reading time from word count. Average adult silent reading rate is
// ~200-250 wpm for non-technical prose; we use 200 (mdpeek reads technical
// docs) so the estimate errs on the comfortable side. Returns minutes, min 1.
export const READING_WPM = 200;
export function readingTimeMinutes(wordCount) {
  const n = Math.max(0, Number(wordCount) || 0);
  return Math.max(1, Math.round(n / READING_WPM));
}

// Human label for the estimate: "1 min read", "5 min read".
export function readingTimeLabel(wordCount) {
  return `${readingTimeMinutes(wordCount)} min read`;
}

// Load the saved reader prefs, falling back to DEFAULTS for any missing or
// invalid entry. `store` is injected (window.localStorage in the app, a stub
// in tests) so this stays pure.
export function loadReaderPrefs(store) {
  const read = (key, options, fallback) => {
    const raw = store.getItem(`mdpeek-reader-${key}`);
    return options.includes(raw) ? raw : fallback;
  };
  return {
    width: read('width', WIDTHS, DEFAULTS.width),
    font: read('font', FONTS, DEFAULTS.font),
    theme: read('theme', THEMES, DEFAULTS.theme),
  };
}
