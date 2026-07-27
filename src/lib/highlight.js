// v0.38.0: `==text==` → <mark>text</mark> highlight marker.
//
// Pandoc/Obsidian convention. Implemented as a marked tokenizer extension so
// the parser natively recognizes the syntax (no fragile string preprocessing
// that could clobber `==` inside code spans or fenced blocks — the tokenizer
// only runs on inline text, never inside code tokens).
//
// Mirrors the emoji.js module shape: a pure helper (replaceHighlights) for
// unit tests, plus a markedHighlight factory wired into buildMarked().

// Replace every `==text==` in `text` with `<mark>text</mark>`. The body can
// contain anything except a newline or another `==` (so nested/adjacent
// highlights don't greedily span across them). Exported for unit testing.
//
// Examples:
//   replaceHighlights('a ==foo== b')  → 'a <mark>foo</mark> b'
//   replaceHighlights('no match')     → 'no match'
//   replaceHighlights('==a== ==b==')  → '<mark>a</mark> <mark>b</mark>'
export function replaceHighlights(text) {
  if (!text || text.indexOf('==') === -1) return text;
  // `==` + 1+ non-newline, non-`=` chars + `==`. The [^\n=]+ body prevents
  // matching across lines and prevents `===` (which is a heading underline)
  // or `====` from being misread.
  return text.replace(/==([^\n=]+)==/g, '<mark>$1</mark>');
}

// marked v18 tokenizer extension. `level: 'inline'` runs it on inline text.
// `start()` helps marked find the next possible match for backtracking.
export function markedHighlightExt() {
  return {
    extensions: [
      {
        name: 'highlight',
        level: 'inline',
        start(src) { return src.indexOf('=='); },
        tokenizer(src) {
          // Match at the start of the remaining source only.
          const m = /^==([^\n=]+)==/.exec(src);
          if (m) {
            return {
              type: 'highlight',
              raw: m[0],
              text: m[1],
              tokens: this.lexer.inlineTokens(m[1]),
            };
          }
          return undefined;
        },
        renderer(token) {
          // Render the inner tokens so bold/italic/emoji inside the highlight
          // still work. Falls back to raw text if tokens are missing.
          const inner = token.tokens ? this.parser.parseInline(token.tokens) : token.text;
          return `<mark>${inner}</mark>`;
        },
      },
    ],
  };
}
