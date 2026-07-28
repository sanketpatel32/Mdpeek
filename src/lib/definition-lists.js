// v0.44.0: GFM-style definition list support (Term / : Definition).
//
// Markdown source like:
//
//   Apple
//   : A round fruit
//   : Also a tech company
//
// renders as `<dl><dt>Apple</dt><dd>A round fruit</dd><dd>Also a tech company</dd></dl>`.
//
// Why a hand-rolled extension instead of `marked-definition-lists`? That
// package's peer range caps at marked <16 and this app runs marked 18. The
// extension below is a ~40-line block tokenizer that plugs into marked's
// `extensions` array (same shape every other extension here uses) and stays
// DOM-free so it can be unit-tested in isolation.
//
// Grammar (per block, greedy across consecutive `:` lines):
//   <term line>\n
//   : <definition text>\n
//   (: <definition text>\n)*
// The term may itself be inline-markdown (so `**Apple**` bolds). The term
// line must NOT itself start with `:` and must be followed by a `:` line —
// otherwise it's just a paragraph.

const COLON_LINE = /^:[ \t]+(.*)$/;

// Build the marked extension object. `parseInline` is marked's inline lexer
// passed in at tokenize time so the term renders with full inline markdown.
export function markedDefinitionLists() {
  return {
    extensions: [
      {
        name: 'definitionList',
        level: 'block',
        tokenizer(src) {
          // Look for a term line immediately followed by at least one `:` line.
          // We scan line by line so the term can't span lines.
          const lines = src.split('\n');
          let i = 0;
          // Skip blank lines isn't needed — marked feeds us starting at the
          // current block boundary. Find the first term+colon pair.
          if (lines.length < 2) return undefined;
          // The term line must be non-empty and not start with `:`.
          // Find the first colon line, then back up to the term.
          let firstColon = -1;
          for (let j = 0; j < lines.length; j++) {
            if (COLON_LINE.test(lines[j])) { firstColon = j; break; }
            // A blank line ends the search — a term can't be separated from
            // its definitions by a blank line.
            if (j > 0 && lines[j].trim() === '' && j < lines.length - 1) return undefined;
          }
          if (firstColon <= 0) return undefined; // need a term line above
          const termLine = lines[firstColon - 1];
          if (termLine.trim() === '' || COLON_LINE.test(termLine)) return undefined;

          // Collect consecutive colon lines starting at firstColon.
          const defs = [];
          let consumed = termLine + '\n';
          let k = firstColon;
          for (; k < lines.length; k++) {
            const m = lines[k].match(COLON_LINE);
            if (!m) break;
            defs.push(m[1].trim());
            consumed += lines[k] + '\n';
          }
          // Strip the trailing newline we added; marked wants the raw eaten text.
          // (Tokenizer must return `raw` = exact substring consumed.)
          const raw = consumed.replace(/\n$/, '');
          // Pre-tokenize term + each definition as inline markdown so the
          // renderer can call parseInline on the token streams. `this.lexer`
          // is provided by marked to custom tokenizers.
          const termTokens = this.lexer.inlineTokens(termLine, []);
          const defTokens = defs.map((d) => this.lexer.inlineTokens(d, []));
          return {
            type: 'definitionList',
            raw,
            term: termLine,
            termTokens,
            defTokens,
          };
        },
        renderer(token) {
          // Render the pre-tokenized inline markdown so **bold**, [links](x),
          // etc. work inside the term and definitions.
          const termHtml = this.parser.parseInline(token.termTokens);
          const defsHtml = token.defTokens
            .map((toks) => `<dd>${this.parser.parseInline(toks)}</dd>`)
            .join('');
          return `<dl><dt>${termHtml}</dt>${defsHtml}</dl>`;
        },
      },
    ],
  };
}
