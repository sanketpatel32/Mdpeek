// Shared file-type classification + icon generator.
// Tabs, the welcome-screen recents list, and the file tree all share this
// so icons stay consistent. Pure functions — safe to import anywhere.
//
// Two-tier icon model:
//   1. SPECIAL types (md, pdf, img, ex, txt) get a unique SVG glyph.
//   2. CODE types (js, py, rs, go, ts, json, …) get a real material-design
//      language icon (yellow JS square, blue Python snake, etc.) from
//      src/lib/language-icons.js — 48 hand-crafted SVGs bundled inline.
//   3. Unknown extensions fall back to the generic file glyph.

import {
  getLanguageIconForPath,
  renderLanguageIcon,
} from './language-icons.js';

// Maps a file extension to a short type token used for icon selection.
// Returns '' for unknown extensions (callers fall back to the generic icon).
export function fileTypeClass(ext) {
  if (!ext) return '';
  ext = ext.toLowerCase();
  if (['md', 'markdown', 'mdx'].includes(ext)) return 'md';
  if (['txt', 'log'].includes(ext)) return 'txt';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['excalidraw'].includes(ext)) return 'ex';
  if (['csv', 'tsv'].includes(ext)) return 'csv';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) return 'img';
  // Anything with a known language icon is treated as code.
  if (getLanguageIconForPath('x.' + ext)) return 'code';
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
// Note: this returns the *generic* code glyph for cls === 'code'. For the
// real per-language icon, use getIconForPath() below.
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
  if (cls === 'csv') {
    // Table grid glyph — distinguishes .csv/.tsv from generic code.
    return `<svg class="file-icon csv${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`;
  }
  // Default fallback icon
  return `<svg class="file-icon${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
}

// Unified icon picker for any path — used by tabs, recents, and the file tree.
//   • Special types (md/pdf/img/ex/txt) → unique SVG glyph
//   • Code languages (js/py/rs/...)      → real material-design language icon
//   • Unknown                            → generic file SVG
// extraClass is appended to whichever element gets rendered.
export function getIconForPath(path, extraClass = '') {
  if (!path) return getFileIconHtml('', extraClass);
  // Special types first — they take precedence over the language lookup
  // (e.g. .md is a special glyph, not the markdown-language icon).
  const special = fileTypeFromPath(path);
  if (special && special !== 'code') {
    return getFileIconHtml(special, extraClass);
  }
  // Code language → real material-design icon.
  const langSpec = getLanguageIconForPath(path);
  if (langSpec) {
    return renderLanguageIcon(langSpec, extraClass ? `lang-icon ${extraClass}` : 'lang-icon');
  }
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
