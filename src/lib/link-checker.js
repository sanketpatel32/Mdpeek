// v0.44.0: link checker — extract link targets from markdown and classify them
// as OK or broken given the set of files that exist in the doc's folder.
//
// Pure functions, no DOM, no IPC. main.js's `checkLinks()` command:
//   1. calls extractDocLinks(md)                    → [{ target, display, kind, line }]
//   2. reads the doc's folder via list_dir → Set of basenames
//   3. calls classifyLinks(links, basenames)        → { ok: [...], broken: [...] }
//   4. opens a picker on the broken set; click jumps to the line.

// What counts as a "local" link target we should check. External URLs
// (http/https/mailto/ftp), anchors (#foo), and absolute-ish paths are left
// alone — we only resolve links that look like in-vault file references.
const EXTERNAL_RE = /^(https?:|mailto:|ftp:|tel:|data:|#|\/\/)/i;

function isLocal(target) {
  if (!target) return false;
  if (EXTERNAL_RE.test(target)) return false;
  // Strip any anchor suffix before deciding: `Foo.md#section` is still a Foo.md link.
  const hashIdx = target.indexOf('#');
  const qIdx = target.indexOf('?');
  let end = target.length;
  if (hashIdx >= 0 && hashIdx < end) end = hashIdx;
  if (qIdx >= 0 && qIdx < end) end = qIdx;
  return end > 0;
}

// Normalise a wiki-link target to a basename (no path, no extension) so it can
// be matched against the folder's file set regardless of how the user wrote it.
//   'Foo'           → 'Foo'
//   'sub/Foo.md'    → 'Foo'
//   'Foo.md'        → 'Foo'
function basename(target) {
  if (!target) return '';
  const slash = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'));
  let file = slash >= 0 ? target.slice(slash + 1) : target;
  // Strip a trailing anchor/query before ext-stripping.
  file = file.split(/[?#]/)[0];
  return file.replace(/\.(md|markdown|mdx)$/i, '');
}

// Extract link targets from markdown, skipping fenced code blocks and inline
// code spans (a `[[x]]` inside backticks isn't a link).
//
// Returns [{ target, display, kind, line }] where:
//   - target  : the raw link target as written (e.g. 'Foo', 'notes/Bar.md')
//   - display : the link text users see ('Foo', 'click here')
//   - kind    : 'wiki' | 'md'
//   - line    : 1-indexed line number (matches the gutter / extractHeadings)
export function extractDocLinks(md) {
  if (!md) return [];
  const links = [];
  const lines = md.split('\n');
  let inFence = false;
  let fenceMarker = '';

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const fenceOpen = ln.match(/^\s*(`{3,}|~{3,})/);
    if (fenceOpen) {
      if (!inFence) { inFence = true; fenceMarker = fenceOpen[1][0]; }
      else if (fenceMarker && ln.trim().startsWith(fenceMarker.repeat(3))) { inFence = false; }
      continue;
    }
    if (inFence) continue;

    // Work on a copy with inline code spans blanked out, so a `[[x]]` or
    // `[t](x)` inside backticks isn't picked up. Preserve length + newlines.
    const clean = ln.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));

    // Wiki links: [[Target]] or [[Target|Display]]
    const wikiRe = /\[\[([^[\]]+?)\]\]/g;
    let m;
    while ((m = wikiRe.exec(clean)) !== null) {
      const [rawTarget, ...rest] = m[1].split('|');
      const target = rawTarget.trim();
      if (!target) continue;
      const display = (rest.length ? rest.join('|') : target).trim();
      if (!isLocal(target)) continue;
      links.push({ target, display, kind: 'wiki', line: i + 1 });
    }

    // Standard markdown links: [Display](Target) — also `<...>` angle-wrap.
    const mdRe = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\]]*)\]\(<([^>]*)>\)/g;
    while ((m = mdRe.exec(clean)) !== null) {
      const display = (m[1] !== undefined ? m[1] : m[3]) || '';
      const target = (m[2] !== undefined ? m[2] : m[4]) || '';
      if (!isLocal(target)) continue;
      links.push({ target, display, kind: 'md', line: i + 1 });
    }
  }
  return links;
}

// Partition links into ok / broken given a Set (or array) of basenames that
// exist in the doc's folder. A link is OK if its basename-normalized target
// matches an entry. Case-insensitive on Windows-style folders, case-sensitive
// elsewhere — we default to case-insensitive since most users are on Windows/
// macOS (case-preserving) and a mismatched-case link will fail to resolve.
export function classifyLinks(links, existingBasenames) {
  const set = existingBasenames instanceof Set
    ? existingBasenames
    : new Set(existingBasenames || []);
  // Build a lowercased lookup set for the comparison.
  const lower = new Set();
  for (const b of set) {
    if (typeof b === 'string') lower.add(b.toLowerCase());
  }
  const ok = [];
  const broken = [];
  for (const link of links || []) {
    const b = basename(link.target);
    if (b && lower.has(b.toLowerCase())) ok.push(link);
    else broken.push(link);
  }
  return { ok, broken };
}
