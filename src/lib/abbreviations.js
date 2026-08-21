// v0.46.0: Markdown Extra / PHP Markdown Extra abbreviation references.
//
// A line like:
//
//   *[HTML]: HyperText Markup Language
//
// (on its own line, anywhere in the doc) DEFINES an abbreviation. Every
// standalone whole-word occurrence of `HTML` in the rest of the document is
// then wrapped as `<abbr title="HyperText Markup Language">HTML</abbr>`, which
// browsers render with a native tooltip on hover.
//
// Implementation notes:
//   - The definition lines are collected and REMOVED from the source so they
//     don't render as stray prose. Multiple definitions for the same key are
//     last-wins (matches PHP Markdown Extra).
//   - Replacement is done as a STRING-LEVEL pre-pass (before marked sees the
//     text), not a marked extension, because we need word-boundary semantics
//     across the whole document and must skip both fenced/inline code AND the
//     link-destination portion of `[label](dest)` — neither of which a tokenizer
//     extension can express cleanly.
//   - The fence-split pattern (same as expandSuperscript / preprocessWikiLinks)
//     keeps code spans verbatim; inside non-code spans we additionally mask
//     `](…)` link destinations so an abbreviation key that happens to appear
//     in a URL is left untouched.
//
// Pure + DOM-free so it can be unit-tested in isolation.

// Pull the `*[KEY]: expansion` definitions out of `md`.
//
// Returns { md: cleanedMd, abbrs: Map<key, expansion> } where `cleanedMd`
// has every definition line removed (and the blank line it may have occupied
// collapsed). Definitions are case-sensitive (PHP Markdown Extra is too).
// A definition line must:
//   - be the only thing on its line (start-of-line `*[`),
//   - have a non-empty key with no `]` inside,
//   - have a non-empty expansion after the colon.
export function extractAbbreviations(md) {
  const abbrs = new Map();
  if (!md || md.indexOf('*[') === -1) return { md, abbrs };
  const defRe = /^\*\[([^\]]+)\]:[ \t]*(.+?)[ \t]*$/;
  const kept = [];
  for (const line of md.split('\n')) {
    const m = line.match(defRe);
    if (m) {
      abbrs.set(m[1], m[2]);
    } else {
      kept.push(line);
    }
  }
  if (abbrs.size === 0) return { md, abbrs };
  return { md: kept.join('\n'), abbrs };
}

// Wrap whole-word occurrences of each abbreviation key in non-code text.
// `abbrs` is a Map<key, expansion>. Returns the transformed markdown.
//
// Code-skip strategy mirrors expandSuperscript: split on fenced/inline code,
// transform only the non-code spans. Inside non-code spans we additionally
// mask `](…)` link destinations (replace them with a placeholder while we
// work, then restore) so a URL containing the key isn't mangled.
export function applyAbbreviations(md, abbrs) {
  if (!md || !abbrs || abbrs.size === 0) return md;
  const fenceRe = /```[\s\S]*?```|`[^`\n]*`/g;
  const out = [];
  let last = 0;
  let m;
  while ((m = fenceRe.exec(md)) !== null) {
    out.push(transformSpan(md.slice(last, m.index), abbrs));
    out.push(m[0]); // preserve code verbatim
    last = m.index + m[0].length;
  }
  out.push(transformSpan(md.slice(last), abbrs));
  return out.join('');
}

// Apply abbreviations to a single code-free span, masking link destinations.
function transformSpan(span, abbrs) {
  // Pull out `](…)` destinations so we don't wrap a key that appears in a URL.
  // The mask must be reversible and must not collide with anything the
  // replacement could emit. We use a private-use placeholder.
  const dests = [];
  const masked = span.replace(/\]\(([^)]*)\)/g, (whole, dest) => {
    dests.push(dest);
    return `](\u0000${dests.length - 1}\u0000)`;
  });
  // Longest keys first so a key that is a prefix of another (e.g. "AB" vs
  // "ABC") isn't matched at a position the longer key would own.
  const keys = [...abbrs.keys()].sort((a, b) => b.length - a.length);
  // One combined pass: sequential per-key passes would re-scan earlier
  // insertions, letting a key nest itself inside another key's title attr.
  const re = new RegExp(`(?<![\\w])(${keys.map(escapeRegex).join('|')})(?![\\w])`, 'g');
  const transformed = masked.replace(re, (_w, k) => `<abbr title="${attrEscape(abbrs.get(k))}">${k}</abbr>`);
  // Restore link destinations.
  return transformed.replace(/\]\(\u0000(\d+)\u0000\)/g, (whole, i) => `](${dests[Number(i)]})`);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function attrEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
