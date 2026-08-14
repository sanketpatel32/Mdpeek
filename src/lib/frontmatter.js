// v0.62.0: YAML front matter → metadata table.
//
// A leading `---\n…\n---\n` block is pulled out of the document before
// rendering (previously it leaked through and rendered as a broken <hr> plus
// raw `key: value` text) and re-rendered as a compact key/value table at the
// top of the preview.
//
// This is a deliberately small YAML subset — no nesting, no anchors, no
// multi-line scalars. Supported value shapes cover what note-taking front
// matter actually contains:
//
//   title: My Note                 → string
//   title: "Quoted Note"           → string (quotes stripped)
//   draft: false                   → boolean
//   reading-time: 12               → number
//   date: 2026-08-14               → string (kept verbatim)
//   tags: [a, b, c]                → "a, b, c"
//   tags: a, b                     → "a, b" (unquoted comma list, Obsidian style)
//
// Pure module: no DOM, no marked, no deps. The table HTML is built here so
// renderMarkdown only has to concatenate it, and unit tests can run in plain
// Node.

import { escapeHtml } from './escape.js';

// Detect and remove a leading front-matter block. Returns { md, meta }.
// `md` is the document with the block stripped; `meta` is an ordered array of
// { key, value } (an array, not an object, so duplicate keys and ordering are
// preserved — real-world front matter repeats keys more than you'd think).
//
//   extractFrontMatter('---\ntitle: x\n---\nbody')  → { md: 'body', meta: [{key:'title', value:'x'}] }
//   extractFrontMatter('no front matter')            → { md: 'no front matter', meta: [] }
export function extractFrontMatter(md) {
  const src = typeof md === 'string' ? md : '';
  // The block must be the very first thing in the file. Allow \r\n line ends.
  const m = src.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { md: src, meta: [] };
  const meta = [];
  for (const line of m[1].split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue; // blank line or `# comment`
    const kv = line.match(/^[ \t]*([^:#][^:]*?)[ \t]*:[ \t]*(.*)$/);
    if (!kv) continue; // not simple `key: value` — skip rather than guess
    meta.push({ key: kv[1].trim(), value: parseValue(kv[2]) });
  }
  return { md: src.slice(m[0].length), meta };
}

// Parse one YAML-subset scalar into a display string.
function parseValue(raw) {
  let v = raw.trim();
  // Inline array: [a, b, c] — strip brackets, keep comma display.
  const arr = v.match(/^\[(.*)\]$/);
  if (arr) v = arr[1];
  // Quoted string: strip one matching pair of quotes.
  const q = v.match(/^(".*"|'.*')$/);
  if (q) v = v.slice(1, -1);
  return v.trim();
}

// Build the metadata table HTML. Keys and values are HTML-escaped; the value
// for a "tags"-like key is rendered as pills (comma-split) when it contains
// commas — matches how Obsidian-style tag lists read best.
export function renderFrontMatterTable(meta) {
  if (!meta || meta.length === 0) return '';
  const rows = meta
    .map(({ key, value }) => {
      const isTags = /tags?|keywords/i.test(key);
      const cells = isTags && value.includes(',')
        ? value.split(',').map((t) => t.trim()).filter(Boolean)
            .map((t) => `<span class="fm-tag">${escapeHtml(t)}</span>`).join('')
        : escapeHtml(value);
      return `<tr><th>${escapeHtml(key)}</th><td>${cells}</td></tr>`;
    })
    .join('');
  return `<div class="frontmatter"><table class="fm-table"><tbody>${rows}</tbody></table></div>`;
}
