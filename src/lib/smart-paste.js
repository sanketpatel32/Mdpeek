// v0.45.0: Decide what to insert when the user pastes into the markdown editor.
//
// Rules (in priority order):
//   1. URL + an active selection  → wrap as `[selection](url)`
//   2. URL + no selection        → paste URL verbatim
//   3. Rich-HTML on clipboard      → convert to markdown (tables, lists, links, emphasis)
//   4. Otherwise                    → return null (let the browser paste plain text)
//
// The HTML→markdown converter is deliberately small and dependency-free: it
// handles the patterns you actually get when copying from a browser (Word /
// Google Docs / a web page) — headings, paragraphs, ul/ol, tables, links,
// bold/italic/strike/code — without pulling in a 50KB library like turndown.
// Anything it doesn't recognize falls through to plain text.
//
// Pure + DOM-free (uses a DOMParser shim when called from tests; in the browser
// the real DOMParser is used). Returns { text, start, end } or null.

// Tiny URL check — http(s), ftp, or a www. prefix. Used to detect a URL-only
// clipboard payload (so we can wrap a selection around it).
export function looksLikeUrl(s) {
  if (!s) return false;
  const t = s.trim();
  if (t.includes('\n')) return false; // a URL is single-line
  return /^(https?:\/\/|ftp:\/\/|www\.)\S+$/i.test(t);
}

// Decide the paste outcome. `sel` is { start, end } of the current selection
// in the editor (start === end means no selection). Returns:
//   { text, start, end } — the text to insert + the selection to leave
//   null                  — fall through to default paste
export function smartPaste({ text = '', html = '', sel = { start: 0, end: 0 } } = {}) {
  const plain = (text || '').trim();
  const hasSelection = sel && sel.start !== sel.end;

  // 1. URL + selection → markdown link. We can't read the selected text here
  //    without the editor; the caller passes it via `sel.text` if available.
  if (plain && looksLikeUrl(plain)) {
    if (hasSelection && sel.text) {
      const inserted = `[${sel.text}](${plain})`;
      return { text: inserted, start: sel.start, end: sel.start + inserted.length };
    }
    // 2. URL, no selection → just paste the URL (no transformation).
    return { text: plain, start: sel.start, end: sel.start + plain.length };
  }

  // 3. Rich HTML → markdown. Only kick in when the HTML actually has
  //    structured markup; a bare text node on the clipboard should paste as-is.
  if (html && hasStructuredHtml(html)) {
    const md = htmlToMarkdown(html);
    if (md && md.trim()) {
      return { text: md, start: sel.start, end: sel.start + md.length };
    }
  }

  // 4. Fall through — plain text paste, browser handles it.
  return null;
}

// Does the HTML payload contain any tag worth converting? If it's just
// `<html><body>some text</body></html>` we'd rather paste the plain text.
function hasStructuredHtml(html) {
  return /<(table|ul|ol|h[1-6]|a|strong|b|em|i|blockquote|li|tr|td|th)\b/i.test(html);
}

// Convert an HTML fragment to markdown. Uses DOMParser when available (browser);
// tests inject a mock via the second arg. Returns a markdown string.
export function htmlToMarkdown(html, parser) {
  const parse = parser || (typeof DOMParser !== 'undefined' ? new DOMParser() : null);
  if (!parse) return '';
  const doc = parse.parseFromString(html, 'text/html');
  const out = [];
  walk(doc.body, out);
  // Collapse 3+ newlines to 2 (paragraph spacing) and trim leading whitespace.
  return out.join('').replace(/\n{3,}/g, '\n\n').replace(/^\s+/, '');
}

// Recursive walker: pushes markdown text for each node into `out`.
function walk(node, out) {
  if (!node) return;
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      // Text node — collapse whitespace but preserve a single space.
      out.push(child.textContent.replace(/\s+/g, ' '));
      return;
    }
    if (child.nodeType !== 1) return; // skip comments / processing instructions
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case 'h1': block(out, `# ${text(child)}`); break;
      case 'h2': block(out, `## ${text(child)}`); break;
      case 'h3': block(out, `### ${text(child)}`); break;
      case 'h4': block(out, `#### ${text(child)}`); break;
      case 'h5': block(out, `##### ${text(child)}`); break;
      case 'h6': block(out, `###### ${text(child)}`); break;
      case 'p': block(out, inline(child)); break;
      case 'br': out.push('  \n'); break;
      case 'hr': block(out, '---'); break;
      case 'blockquote': block(out, `> ${inline(child).replace(/\n/g, '\n> ')}`); break;
      case 'strong':
      case 'b': out.push(`**${inline(child)}**`); break;
      case 'em':
      case 'i': out.push(`*${inline(child)}*`); break;
      case 'del':
      case 's': out.push(`~~${inline(child)}~~`); break;
      case 'code': out.push('`' + text(child) + '`'); break;
      case 'pre': block(out, '```\n' + text(child).replace(/\s+$/, '') + '\n```'); break;
      case 'a': {
        const href = child.getAttribute('href') || '';
        out.push(`[${inline(child)}](${href})`);
        break;
      }
      case 'img': {
        const alt = child.getAttribute('alt') || '';
        const src = child.getAttribute('src') || '';
        out.push(`![${alt}](${src})`);
        break;
      }
      case 'ul': listBlock(child, out, false); break;
      case 'ol': listBlock(child, out, true); break;
      case 'table': tableBlock(child, out); break;
      default: walk(child, out); // recurse into unknown containers
    }
  });
}

// Render a <ul>/<ol> element's <li> children as markdown bullet/numbered list.
function listBlock(listNode, out, ordered) {
  out.push('\n');
  let i = 1;
  listNode.querySelectorAll(':scope > li').forEach((li) => {
    const marker = ordered ? `${i}. ` : '- ';
    out.push(`${marker}${inline(li).trim()}\n`);
    i++;
  });
  out.push('\n');
}

// Render a <table> as a markdown table. Assumes the first row is a header
// (either in <thead> or the first <tr>); emits a delimiter row.
function tableBlock(table, out) {
  const rows = [];
  table.querySelectorAll('tr').forEach((tr) => {
    const cells = [];
    tr.querySelectorAll('th, td').forEach((cell) => {
      cells.push(inline(cell).trim().replace(/\|/g, '\\|'));
    });
    if (cells.length) rows.push(cells);
  });
  if (rows.length === 0) return;
  const cols = Math.max(...rows.map((r) => r.length));
  const header = rows[0];
  while (header.length < cols) header.push('');
  const delimiter = Array(cols).fill('---');
  const body = rows.slice(1);
  out.push('\n');
  out.push('| ' + header.join(' | ') + ' |\n');
  out.push('| ' + delimiter.join(' | ') + ' |\n');
  body.forEach((r) => {
    while (r.length < cols) r.push('');
    out.push('| ' + r.join(' | ') + ' |\n');
  });
  out.push('\n');
}

// Concatenate all text inside a node (no markup).
function text(node) {
  return (node.textContent || '').replace(/\s+/g, ' ').trim();
}

// Render a node's children inline (handles nested bold/italic/links).
function inline(node) {
  const out = [];
  walk(node, out);
  return out.join('').trim();
}

// Push a block-level line, ensuring it sits on its own paragraph (surrounded
// by blank lines). Trims the trailing whitespace the inline walker may leave.
function block(out, s) {
  out.push('\n\n' + s.replace(/\s+$/, '') + '\n\n');
}
