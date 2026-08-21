// v0.45.0: Pandoc-style subscript (`H~2~O`) and superscript (`x^2^`) syntax.
//
// Conventions:
//   H~2~O   →  H<sub>2</sub>O
//   x^2^    →  x<sup>2</sup>
//
// Two integration strategies, dictated by how marked v18 tokenizes:
//
//   - SUBSCRIPT (`~`) is implemented as a marked `inline` tokenizer extension
//     (buildExt below). This works because marked's GFM inline `text` regex
//     includes `~` in its stop-set (`[\\<!\\[`*~_]`), so marked hands control
//     to our tokenizer at every `~`. GFM's own `~~del~~` runs first and
//     consumes the strikethrough cases, so we never see them.
//
//   - SUPERSCRIPT (`^`) CANNOT use the same path: marked's inline `text`
//     regex does NOT include `^` in its stop-set, so the default text
//     tokenizer greedily eats `E=mc^2^` as a single text token before our
//     extension ever runs. Instead we expose `expandSuperscript(md)` as a
//     string-level preprocessor (run before marked.parse), gated on the
//     presence of `^` and skipping fenced/inline code. This mirrors
//     expandTocMarker / preprocessWikiLinks exactly.
//
// Both paths are unit-testable via the exported `replaceSubSup` pure helper.

// Pure helper for unit tests: replace every `H~2~O` and `x^2^` in `text` with
// HTML. Kept side-effect-free and DOM-free so it can be tested without marked.
//
// Examples:
//   replaceSubSup('H~2~O')    → 'H<sub>2</sub>O'
//   replaceSubSup('x^2^')     → 'x<sup>2</sup>'
//   replaceSubSup('no match') → 'no match'
//   replaceSubSup('~~hi~~')   → '~~hi~~'  (strikes left alone)
export function replaceSubSup(text) {
  if (!text) return text;
  if (text.indexOf('~') === -1 && text.indexOf('^') === -1) return text;
  // Subscript: `<pre>~<body>~` where pre is a non-space, non-`~` char and body
  // is 1+ chars (none of them `~` or newline; at least the first is non-space).
  // The pre char is captured so we can re-emit it OUTSIDE the <sub> (otherwise
  // `H~2~O` would render as `<sub>H2</sub>O`).
  let out = text.replace(/([^\s~])~([^\s~][^~\n]*?)~/g, (_w, pre, body) => `${pre}<sub>${body}</sub>`);
  // Superscript: same shape with `^`. Skip if body contains `$` (KaTeX math).
  out = out.replace(/([^\s^])\^([^\s^][^^\n]*?)\^/g, (whole, pre, body) =>
    body.includes('$') ? whole : `${pre}<sup>${body}</sup>`,
  );
  return out;
}

// Expand `x^2^` → `x<sup>2</sup>` in markdown text BEFORE marked sees it.
// Necessary because marked's inline text tokenizer eats `^` as a plain char.
// Skips fenced code blocks and inline code (preserved verbatim). Passes
// through unchanged if no `^` is present. Mirrors the fence-split pattern in
// preprocessWikiLinks / expandTocMarker.
export function expandSuperscript(md) {
  if (!md || md.indexOf('^') === -1) return md;
  const fenceRe = /```[\s\S]*?```|`[^`\n]*`/g;
  const out = [];
  let last = 0;
  let m;
  while ((m = fenceRe.exec(md)) !== null) {
    out.push(supReplacers(md.slice(last, m.index)));
    out.push(m[0]); // preserve code verbatim
    last = m.index + m[0].length;
  }
  out.push(supReplacers(md.slice(last)));
  return out.join('');
}

// Apply the superscript replacement to a code-free span. Link/image
// destinations are masked out first so a URL containing `x^y^` is left
// untouched (same strategy as transformSpan in abbreviations.js).
function supReplacers(s) {
  const dests = [];
  const masked = s.replace(/\]\(([^)]*)\)/g, (whole, dest) => {
    dests.push(dest);
    return `](\u0000${dests.length - 1}\u0000)`;
  });
  const expanded = masked.replace(/([^\s^])\^([^\s^][^^\n]*?)\^/g, (whole, pre, body) =>
    body.includes('$') ? whole : `${pre}<sup>${body}</sup>`,
  );
  return expanded.replace(/\]\(\u0000(\d+)\u0000\)/g, (whole, i) => `](${dests[Number(i)]})`);
}

// marked v18 tokenizer extension for SUBSCRIPT only. `level: 'inline'` runs
// it on inline text; marked's GFM text regex stops at `~` so we get a chance.
// `start()` helps marked find the next possible match for backtracking.
export function markedSubSup() {
  return {
    extensions: [buildSubExt()],
  };
}

// v0.46.0: Discord/Reddit spoilers — `||secret||` → redacted, click-to-reveal.
//
// Like `^` for superscript, `|` is NOT in marked's GFM inline-text stop-set
// (`[\\<!\\[`*~_]`), so a tokenizer extension never fires — marked eats
// `||x||` as plain text. We use a string-level pre-pass instead, mirroring
// `expandSuperscript` exactly (fence-split, skip fenced/inline code).
//
// The body regex `(?<!\|)\|\|([^\n|]+)\|\|(?!\|)` requires:
//   - no `|` adjacent to the opening/closing `||` (prevents matching the
//     pipe-delimiter rows of a GFM table — `| a | b |` is never a spoiler),
//   - a body with no newline and no `|` (single-line, no nested pipes).
//
// Pure + DOM-free so it can be unit-tested in isolation.
export function expandSpoilers(md) {
  if (!md || md.indexOf('||') === -1) return md;
  const fenceRe = /```[\s\S]*?```|`[^`\n]*`/g;
  const out = [];
  let last = 0;
  let m;
  while ((m = fenceRe.exec(md)) !== null) {
    out.push(spoilerReplace(md.slice(last, m.index)));
    out.push(m[0]); // preserve code verbatim
    last = m.index + m[0].length;
  }
  out.push(spoilerReplace(md.slice(last)));
  return out.join('');
}

// Apply the spoiler replacement to a single code-free span. The lookbehind/
// lookahead on `|` keep table-delimiter rows (`|---|`) from matching.
function spoilerReplace(s) {
  return s.replace(/(?<!\|)\|\|([^\n|]+)\|\|(?!\|)/g, '<span class="spoiler">$1</span>');
}

function buildSubExt() {
  // Body must be non-empty, single-line, not contain `~`, and START with a
  // non-space + non-`~` char (keeps `~~strikethrough~~` from being misread;
  // in practice marked consumes `~~...~~` as GFM del first anyway). Mirrors
  // the pure helper's `[^\s~]` opening requirement.
  const re = /^~([^\s~][^~\n]*?)~/;
  return {
    name: 'subscript',
    level: 'inline',
    start(src) { return src.indexOf('~'); },
    tokenizer(src) {
      const m = re.exec(src);
      if (!m) return undefined;
      const body = m[1];
      return {
        type: 'subscript',
        raw: m[0],
        body,
        tokens: this.lexer.inlineTokens(body, []),
      };
    },
    renderer(token) {
      const inner = token.tokens ? this.parser.parseInline(token.tokens) : token.body;
      return `<sub>${inner}</sub>`;
    },
  };
}
