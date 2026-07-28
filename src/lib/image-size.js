// v0.45.0: Parse image dimensions from two popular conventions:
//
//   GitHub:    ![alt](src "=200x300")  → width 200, height 300
//              ![alt](src "=200")      → width 200
//   Obsidian:  ![alt|300](src)         → width 300
//
// marked passes the renderer `{ href, title, text }`. The conventions stash
// the size either in the title (GitHub, prefixed with `=`) or in the alt text
// after a `|` (Obsidian). This helper extracts `{ width, height, alt, title }`
// with the size stripped out so the displayed alt/title don't show the raw
// syntax. Returns width/height as numbers, or null when absent.
//
// Pure + DOM-free so it's unit-testable in isolation. The image renderer in
// renderer.js consumes it.
export function parseImageSize({ href = '', title = '', text = '' } = {}) {
  let width = null;
  let height = null;
  let alt = text || '';
  let ttl = title || '';

  // GitHub convention: title is `=WxH` or `=W`. The leading `=` is required
  // so a normal title like "200x300" (no `=`) is left alone.
  const gh = ttl.match(/^=(\d+)?(?:x(\d+))?$/i);
  if (gh && (gh[1] || gh[2])) {
    width = gh[1] ? parseInt(gh[1], 10) : null;
    height = gh[2] ? parseInt(gh[2], 10) : null;
    ttl = ''; // size consumes the title entirely
  }

  // Obsidian convention: `alt|W` — a trailing `|<digits>` on the alt text.
  // Only treat as size if the digits are a plausible pixel count (≤ 99999).
  if (alt.includes('|')) {
    const obs = alt.match(/^(.*)\|(\d{1,5})$/);
    if (obs) {
      alt = obs[1];
      // Don't override an explicit GitHub width; GitHub is more specific.
      if (width === null) width = parseInt(obs[2], 10);
    }
  }

  return { href, alt, title: ttl, width, height };
}
