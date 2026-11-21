// Terminal Drawer module — deprecated and removed in favor of external terminal.
// Preserves pure helpers for theme / cwd parsing and unit testing.

// Read a CSS custom property from :root, returning `fallback` if unset or if
// the computed value is empty. Stripped of surrounding whitespace.
export function readCssVar(name, fallback = '') {
  if (typeof window === 'undefined' || !window.getComputedStyle) return fallback;
  const v = window.getComputedStyle(document.documentElement).getPropertyValue(name);
  const trimmed = (v || '').trim();
  return trimmed || fallback;
}

// Compute a concrete font family stack for terminal / canvas context.
export function getTerminalFontFamily() {
  const fontVar = readCssVar('--mono-font', '');
  if (fontVar) {
    const cleanFont = fontVar.replace(/^["']|["']$/g, '');
    return `"${cleanFont}", "Cascadia Code", Consolas, "Fira Code", monospace`;
  }
  return '"Cascadia Code", Consolas, "Fira Code", monospace';
}

// Build an xterm-compatible theme object from the app's active theme CSS vars.
export function xtermThemeFromApp() {
  const fg     = readCssVar('--fg', '#e8e8e8');
  const bg     = readCssVar('--bg', '#000000');
  const muted  = readCssVar('--fg-muted', '#888888');
  const red     = readCssVar('--danger',          '#ff5555');
  const green   = readCssVar('--success',         '#50fa7b');
  const yellow  = readCssVar('--alert-warning',   '#f1fa8c');
  const blue    = readCssVar('--accent',          '#8be9fd');
  const magenta = readCssVar('--alert-important', '#ff79c6');
  const cyan    = readCssVar('--alert-note',      '#8be9fd');
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: readCssVar('--surface-active', 'rgba(255,255,255,0.2)'),
    black: muted,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white: fg,
    brightBlack: muted,
    brightRed: red,
    brightGreen: green,
    brightYellow: yellow,
    brightBlue: blue,
    brightMagenta: magenta,
    brightCyan: cyan,
    brightWhite: fg,
  };
}

// Normalize an OSC 7 / OSC 9;9 cwd report into a display path.
export function normalizeOscCwd(raw) {
  if (!raw) return '';
  let p = String(raw);
  try { p = decodeURIComponent(p); } catch { /* keep raw on malformed input */ }
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(p);
  if (m) {
    p = m[1];
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  }
  if (/^[A-Za-z]:/.test(p)) return p.replace(/\//g, '\\');
  return p;
}

export function initTerminal({ cwdProvider, onToast } = {}) {
  const toast = onToast || (() => {});
  const drawer = typeof document !== 'undefined' ? document.getElementById('terminal-drawer') : null;

  function open() {
    toast('Integrated terminal has been removed.');
  }

  function close() {
    if (drawer) drawer.classList.add('hidden');
  }

  function toggle() {
    toast('Integrated terminal has been removed.');
  }

  function clear() {}
  function execute() {}
  function destroyAll() {}
  function setTheme() {}
  function updateZoom(zoomLevel = 1) {}

  return {
    open,
    close,
    toggle,
    clear,
    execute,
    destroyAll,
    setTheme,
    updateZoom,
  };
}
