// v0.44.0: automatic theme switching — match the OS theme, or switch by time.
//
// Pure helpers only. main.js wires the listeners (matchMedia for 'system', a
// 5-min interval for 'time') and calls applyTheme with the resolved id.
//
//   themeForHour(hour) → 'light' | 'dark'
//     Dark 19:00–06:59 (7pm to 7am), light 07:00–18:59. Picked to roughly
//     track civil twilight in temperate latitudes without needing the user's
//     location. Local hour, 0–23.
//
//   prefersDarkFromMedia(mql) → boolean
//     Thin wrapper so the matchMedia call in main.js can be tested by passing
//     a stub MediaQueryList.

export const THEME_MODE_KEY = 'mdpeek-theme-mode';

// Hour (0–23) at/below which we consider it "night" → dark theme.
const DARK_START = 19; // 7pm
const DARK_END = 6;    // through 6:59am

export function themeForHour(hour) {
  const h = Math.trunc(Number(hour));
  if (!Number.isFinite(h)) return 'light';
  const norm = ((h % 24) + 24) % 24;
  return norm >= DARK_START || norm <= DARK_END ? 'dark' : 'light';
}

// Read prefers-color-scheme from a matchMedia result (or any object exposing
// .matches). Returns true when the OS wants dark.
export function prefersDarkFromMedia(mql) {
  return !!(mql && mql.matches);
}
