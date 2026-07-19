// Shared file-type classification + icon generator.
// Tabs, the welcome-screen recents list, and the file tree all share this
// so icons stay consistent. Pure functions — safe to import anywhere.
//
// Two-tier icon model:
//   1. SPECIAL types (md, pdf, img, ex, txt) get a unique SVG glyph.
//   2. CODE types (js, py, rs, go, ts, json, …) get a colored letter badge —
//      a tiny pill showing the file's 1–3 letter extension in its language's
//      brand color. Far lighter than shipping 30+ SVG paths, and the colors
//      make the tree/tabs/recents scannable at a glance.
//   3. Unknown extensions fall back to the generic file glyph.

// Maps a file extension to a short type token used for icon selection.
// Returns '' for unknown extensions (callers fall back to the generic icon).
export function fileTypeClass(ext) {
  if (!ext) return '';
  ext = ext.toLowerCase();
  if (['md', 'markdown', 'mdx'].includes(ext)) return 'md';
  if (['txt', 'log'].includes(ext)) return 'txt';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['excalidraw'].includes(ext)) return 'ex';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) return 'img';
  if (CODE_LANGUAGES[ext]) return 'code';
  return '';
}

// Returns the matching file-type token for a full path (or '' if unknown).
export function fileTypeFromPath(path) {
  if (!path) return '';
  const ext = (path.split('.').pop() || '').toLowerCase();
  return fileTypeClass(ext);
}

// Returns an inline SVG string for the given type token. Accepts an extra
// class so callers can scope styling (e.g. 'tab-icon', 'recent-icon').
// Unknown / empty token falls back to the generic file glyph.
export function getFileIconHtml(cls, extraClass = '') {
  const extra = extraClass ? ` ${extraClass}` : '';
  if (cls === 'md') {
    return `<svg class="file-icon md${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 11v4M8 11l2 2 2-2M12 11v4"/></svg>`;
  }
  if (cls === 'pdf') {
    return `<svg class="file-icon pdf${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 11v4M9 11h2.5a1.5 1.5 0 0 0 0-3H9"/></svg>`;
  }
  if (cls === 'img') {
    return `<svg class="file-icon img${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  }
  if (cls === 'code') {
    return `<svg class="file-icon code${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
  }
  if (cls === 'ex') {
    return `<svg class="file-icon ex${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="10" height="10" rx="1"/><circle cx="15" cy="15" r="5"/><path d="M13 8h5v5"/></svg>`;
  }
  if (cls === 'txt') {
    return `<svg class="file-icon txt${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="15" x2="14" y2="15"/></svg>`;
  }
  // Default fallback icon
  return `<svg class="file-icon${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
}

// ---- Language badges -----------------------------------------------------
// Each entry: { label, bg, fg } where label is the short badge text (1–3 chars,
// uppercase) and bg/fg are CSS colors. bg doubles as the colored tint even
// when the badge is rendered without a fill (e.g. recents list).
//
// Colors loosely follow each language's brand identity — JS yellow, TS blue,
// Python blue, Rust orange, Go cyan, etc. Kept short and consistent.
const CODE_LANGUAGES = {
  // web
  js:       { label: 'JS',  color: '#f7df1e' }, // JavaScript — yellow
  mjs:      { label: 'JS',  color: '#f7df1e' },
  cjs:      { label: 'JS',  color: '#f7df1e' },
  jsx:      { label: 'JSX', color: '#61dafb' }, // React
  ts:       { label: 'TS',  color: '#3178c6' }, // TypeScript — blue
  tsx:      { label: 'TSX', color: '#61dafb' },
  json:     { label: '{}',  color: '#cbcb41' }, // JSON — olive-gray
  jsonc:    { label: '{}',  color: '#cbcb41' },
  html:     { label: '<>',  color: '#e34c26' }, // HTML — orange
  htm:      { label: '<>',  color: '#e34c26' },
  css:      { label: '#',   color: '#563d7c' }, // CSS — purple
  scss:     { label: '#',   color: '#c6538c' },
  sass:     { label: '#',   color: '#c6538c' },
  less:     { label: '#',   color: '#1d365d' },
  vue:      { label: 'V',   color: '#41b883' }, // Vue — green
  svelte:   { label: 'S',   color: '#ff3e00' }, // Svelte — red-orange
  // systems
  py:       { label: 'PY',  color: '#3776ab' }, // Python — blue
  pyw:      { label: 'PY',  color: '#3776ab' },
  rb:       { label: 'RB',  color: '#cc342d' }, // Ruby — red
  go:       { label: 'GO',  color: '#00add8' }, // Go — cyan
  rs:       { label: 'RS',  color: '#dea584' }, // Rust — tan
  java:     { label: 'J',   color: '#b07219' }, // Java — brown
  kt:       { label: 'KT',  color: '#a97bff' }, // Kotlin
  kts:      { label: 'KT',  color: '#a97bff' },
  swift:    { label: 'SW',  color: '#fa7343' }, // Swift — orange
  c:        { label: 'C',   color: '#555555' }, // C
  h:        { label: 'H',   color: '#555555' },
  cpp:      { label: 'C+',  color: '#f34b7d' }, // C++ — pink
  cc:       { label: 'C+',  color: '#f34b7d' },
  cxx:      { label: 'C+',  color: '#f34b7d' },
  hpp:      { label: 'H+',  color: '#f34b7d' },
  cs:       { label: 'C#',  color: '#178600' }, // C# — green
  php:      { label: 'PHP', color: '#4f5d95' }, // PHP — purple-gray
  // shell / scripting
  sh:       { label: '$',   color: '#89e051' }, // Shell — green
  bash:     { label: '$',   color: '#89e051' },
  zsh:      { label: '$',   color: '#89e051' },
  fish:     { label: '$',   color: '#89e051' },
  ps1:      { label: 'PS',  color: '#012456' }, // PowerShell
  bat:      { label: 'BAT', color: '#89e051' },
  cmd:      { label: 'CMD', color: '#89e051' },
  lua:      { label: 'LUA', color: '#000080' }, // Lua
  r:        { label: 'R',   color: '#198ce7' }, // R
  pl:       { label: 'PL',  color: '#0298c3' }, // Perl
  // data / config
  yaml:     { label: 'Y',   color: '#cb171e' }, // YAML — red
  yml:      { label: 'Y',   color: '#cb171e' },
  toml:     { label: 'T',   color: '#9c4221' }, // TOML — brown
  ini:      { label: 'INI', color: '#6d8086' }, // INI — gray
  cfg:      { label: 'CFG', color: '#6d8086' },
  conf:     { label: 'CFG', color: '#6d8086' },
  xml:      { label: '<>',  color: '#0060ac' }, // XML
  sql:      { label: 'SQL', color: '#e38c00' }, // SQL — amber
  graphql:  { label: 'GQL', color: '#e10098' }, // GraphQL — pink
  gql:      { label: 'GQL', color: '#e10098' },
  // docs / notebooks
  tex:      { label: 'TEX', color: '#3d6117' }, // LaTeX
  bib:      { label: 'BIB', color: '#3d6117' },
  ipynb:    { label: 'NB',  color: '#f37726' }, // Jupyter — orange
  // docker / build
  dockerfile:{ label: '🐳', color: '#384d54' }, // Docker — whale emoji (no SVG needed)
  makefile: { label: 'MK',  color: '#427819' }, // Make — green
  cmake:    { label: 'CMK', color: '#064f8c' },
  gemfile:  { label: 'GEM', color: '#cc342d' }, // Ruby Gemfile
  // rust-adjacent
  lock:     { label: '🔒', color: '#6d8086' }, // lockfiles
};

// Returns the badge spec for an extension, or null if not a code language.
export function getCodeBadge(ext) {
  if (!ext) return null;
  return CODE_LANGUAGES[ext.toLowerCase()] || null;
}

// Returns the badge spec for a path, or null if not a code language.
export function getCodeBadgeForPath(path) {
  if (!path) return null;
  const ext = (path.split('.').pop() || '').toLowerCase();
  // Special-case well-known filename stems that have no extension.
  const base = (path.split(/[\\/]/).pop() || '').toLowerCase();
  if (base === 'dockerfile') return CODE_LANGUAGES.dockerfile;
  if (base === 'makefile') return CODE_LANGUAGES.makefile;
  if (base === 'gemfile') return CODE_LANGUAGES.gemfile;
  if (base === 'cmakelists.txt') return CODE_LANGUAGES.cmake;
  return getCodeBadge(ext);
}

// Renders a small colored badge for a code file: a 1–3 char pill in the
// language's brand color. extraClass lets callers scope sizing. Used for
// .js/.py/.rs/.go/etc. — replaces the generic-code glyph for those types.
export function getCodeBadgeHtml(spec, extraClass = '') {
  if (!spec) return '';
  const extra = extraClass ? ` ${extraClass}` : '';
  return `<span class="code-badge${extra}" style="--badge-color: ${spec.color}">${spec.label}</span>`;
}

// Unified icon picker for any path — used by tabs, recents, and the file tree.
//   • Special types (md/pdf/img/ex/txt) → unique SVG glyph
//   • Code languages (js/py/rs/...)      → colored letter badge
//   • Unknown                            → generic file SVG
// extraClass is appended to whichever element gets rendered.
export function getIconForPath(path, extraClass = '') {
  if (!path) return getFileIconHtml('', extraClass);
  const special = fileTypeFromPath(path);
  if (special && special !== 'code') {
    return getFileIconHtml(special, extraClass);
  }
  const badge = getCodeBadgeForPath(path);
  if (badge) return getCodeBadgeHtml(badge, extraClass);
  return getFileIconHtml('', extraClass);
}

// Compact relative-time formatter ("just now", "5m ago", "3h ago",
// "yesterday", "4d ago", "Jul 3"). Pure: takes an optional now-ms for testing.
export function relativeTime(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return day + 'd ago';
  // Beyond a week: short month-day stamp, e.g. "Jul 3".
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
