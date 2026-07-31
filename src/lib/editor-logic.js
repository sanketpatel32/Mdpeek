// Pure editor helpers — no DOM. Each takes the textarea's current text and
// selection and returns the next { text, start, end } state. Unit-tested in
// test/editor-logic.test.js. The DOM wiring in src/views/editor.js calls these
// and writes the result back via setRangeText + setSelectionRange.

// Indent string used by handleTab/handleShiftTab. Defaults to 2 spaces
// (GitHub/VS Code markdown default). v0.37.0: configurable via the
// `mdpeek-tab-size` localStorage key — accepts '2' | '4' | '8'. Tests pass a
// literal size so they don't touch localStorage; the editor passes nothing and
// getIndent reads the live setting.
const INDENT_TABLE = { '2': '  ', '4': '    ', '8': '        ' };
const DEFAULT_INDENT = '  ';
export function getIndent(size) {
  if (size === 2 || size === 4 || size === 8) return INDENT_TABLE[String(size)];
  if (typeof localStorage !== 'undefined') {
    return INDENT_TABLE[localStorage.getItem('mdpeek-tab-size')] || DEFAULT_INDENT;
  }
  return DEFAULT_INDENT;
}

// ----------------------------- selection utils -----------------------------

// Returns [lineStart, lineEnd] offsets for the line(s) spanned by [start, end].
function lineRange(text, pos) {
  const start = text.lastIndexOf('\n', pos - 1) + 1; // -1 → 0 (first line)
  let end = text.indexOf('\n', pos);
  if (end === -1) end = text.length;
  return [start, end];
}

// ----------------------------- Tab / Shift+Tab -----------------------------

// No selection → insert the indent string at caret.
// Selection (even partial) → indent every touched line by one indent level.
export function handleTab(text, start, end) {
  const INDENT = getIndent();
  if (start === end) {
    return insertAt(text, start, INDENT, start + INDENT.length);
  }
  return indentLines(text, start, end, INDENT);
}

// Outdent every touched line by one indent level. Lines with no leading indent
// are left alone. Collapses a multi-line selection to its start.
export function handleShiftTab(text, start, end) {
  const INDENT = getIndent();
  const [lineStart] = lineRange(text, Math.min(start, end));
  let cursor = lineStart;
  const lines = text.slice(lineStart, end).split('\n');
  for (const line of lines) {
    if (line.startsWith(INDENT)) {
      cursor += INDENT.length; // skip past the removed indent
    }
  }
  const out = text.slice(0, lineStart) + lines.map((l) => (l.startsWith(INDENT) ? l.slice(INDENT.length) : l)).join('\n') + text.slice(end);
  return { text: out, start: lineStart, end: lineStart + lines.join('\n').length };
}

function indentLines(text, start, end, prefix) {
  const [lineStart] = lineRange(text, start);
  const block = text.slice(lineStart, end);
  const lines = block.split('\n').map((l) => prefix + l);
  const replaced = lines.join('\n');
  const out = text.slice(0, lineStart) + replaced + text.slice(end);
  // Move the caret/anchor along with the inserted prefix on the first line.
  const delta = prefix.length; // first line gained one prefix
  return { text: out, start: start + delta, end: end + (lines.length - 1) * prefix.length + delta };
}

function insertAt(text, at, insert, caret) {
  return { text: text.slice(0, at) + insert + text.slice(at), start: caret, end: caret };
}

// ----------------------------- Enter (smart newline) -----------------------

// Matches a list marker prefix at the start of a line: "- ", "* ", "+ ",
// or "N. " / "N) ". Capture group 1 = the marker, group 2 = the number (if any).
const LIST_RE = /^(\s*)([-*+]\s+|\d+[.)]\s+)/;

export function handleEnter(text, start, end) {
  // Replace any selection with a plain newline.
  if (start !== end) {
    return { text: text.slice(0, start) + '\n' + text.slice(end), start: start + 1, end: start + 1 };
  }

  const [lineStart] = lineRange(text, start);
  const lineUpToCaret = text.slice(lineStart, start);

  // 1) Empty list item ("- " with nothing after) → exit the list: delete marker.
  const m = lineUpToCaret.match(LIST_RE);
  if (m && lineUpToCaret === m[1] + m[2]) {
    const out = text.slice(0, lineStart) + text.slice(start); // drop the marker
    return { text: out, start: lineStart, end: lineStart };
  }

  // 2) List item with content → continue the list with a new marker. Increments
  //    ordered lists ("1. " → "2. "), preserves bullet and indentation.
  if (m) {
    const indent = m[1];
    const marker = m[2];
    const next = incrementMarker(marker);
    const insert = '\n' + indent + next;
    return { text: text.slice(0, start) + insert + text.slice(start), start: start + insert.length, end: start + insert.length };
  }

  // 3) Caret right after an unclosed code fence → close it on the next lines.
  const fenceMatch = lineUpToCaret.match(/^(\s*)(```+|~~~+)(.*)$/);
  if (fenceMatch) {
    const fence = fenceMatch[2];
    // Is there a matching closing fence later in the doc? If not, close it.
    const after = text.slice(start);
    const closer = new RegExp('(^|\\n)\\s*' + escapeRe(fence[0].repeat(3)) + '\\s*(\\n|$)');
    if (!closer.test(after)) {
      const insert = '\n\n' + fenceMatch[1] + fence; // blank line + closing fence
      // Caret ends on the blank line inside the fence, ready to type.
      return { text: text.slice(0, start) + insert + text.slice(start), start: start + 1, end: start + 1 };
    }
  }

  // 4) Plain newline.
  return { text: text.slice(0, start) + '\n' + text.slice(start), start: start + 1, end: start + 1 };
}

function incrementMarker(marker) {
  const m = marker.match(/^(\d+)([.)]\s+)$/);
  return m ? `${Number(m[1]) + 1}${m[2]}` : marker;
}

// ----------------------------- wrap (bold/italic/code) ---------------------

// Wraps [start,end) in `before`+`after`. No selection → inserts empty markers
// and places caret between them. Selection is preserved inside the markers.
// If the selection is already wrapped, unwraps it (toggle).
export function wrapSelection(text, start, end, before, after = before) {
  const hasSel = start !== end;
  // Toggle off if currently wrapped.
  if (hasSel && text.slice(start - before.length, start) === before && text.slice(end, end + after.length) === after) {
    const out = text.slice(0, start - before.length) + text.slice(start, end) + text.slice(end + after.length);
    return { text: out, start: start - before.length, end: end - before.length };
  }
  const sel = text.slice(start, end);
  const out = text.slice(0, start) + before + sel + after + text.slice(end);
  if (hasSel) {
    return { text: out, start: start + before.length, end: end + before.length };
  }
  // No selection: caret ends between the markers.
  return { text: out, start: start + before.length, end: start + before.length };
}

// v0.49.0: Wrap the selection in a MULTI-LINE block (open/close tags each on
// their own line), e.g. `<details>...</details>` or a fenced code block. Unlike
// wrapSelection (inline `before`/`after` strings), the open/close are placed on
// fresh lines around the selection so the result reads as a proper block:
//
//   <open>
//   <selection>
//   </close>
//
// Behavior:
//   - Selection present → wrap it; the selection (including its content) is
//     preserved verbatim between the tags. If the open line would collide with
//     preceding text, a leading newline is inserted; same for the close + a
//     trailing newline so the block stands alone.
//   - No selection (caret) → insert empty `open\n\nclose` with the caret on the
//     blank middle line ready to type.
// `open` and `close` are the full tag/fence lines WITHOUT trailing newlines.
// Returns { text, start, end } covering the inner content (the selection or the
// empty middle line), so the caller restores the selection there.
export function wrapBlock(text, start, end, open, close) {
  const hasSel = start !== end;
  const sel = text.slice(start, end);
  // Decide whether we need leading/trailing newlines to isolate the block.
  const needLeadingNl = start > 0 && text[start - 1] !== '\n';
  const needTrailingNl = end < text.length && text[end] !== '\n';
  const lead = needLeadingNl ? '\n' : '';
  const trail = needTrailingNl ? '\n' : '';
  const inserted = `${lead}${open}\n${sel}\n${close}${trail}`;
  const out = text.slice(0, start) + inserted + text.slice(end);
  // Inner content sits between the open line and the close line.
  const innerStart = start + lead.length + open.length + 1; // +1 for the \n after open
  const innerEnd = innerStart + sel.length;
  if (hasSel) {
    return { text: out, start: innerStart, end: innerEnd };
  }
  // No selection: caret sits on the empty inner line (innerStart === innerEnd).
  return { text: out, start: innerStart, end: innerStart };
}

// Insert a Markdown link `[text](url)` at the selection (Ctrl+K).
// - Selection present → wrap it as the link text, place caret in the URL.
// - No selection → insert `[](url)` with caret in the empty text slot.
// If `url` is provided (e.g. caller detected a URL on the clipboard), it's
// pre-filled; otherwise the URL slot is empty for the user to type/paste.
// Caret lands in the emptiest slot so the user types immediately.
export function insertLink(text, start, end, url = '') {
  const sel = text.slice(start, end);
  const hasSel = start !== end;
  const link = `[${sel}](${url})`;
  const out = text.slice(0, start) + link + text.slice(end);
  if (hasSel && url) {
    // Both filled — select nothing, place caret after the whole link.
    return { text: out, start: start + link.length, end: start + link.length };
  }
  if (hasSel) {
    // Text filled, URL empty — place caret in the URL slot to type it.
    const urlPos = start + 1 + sel.length + 2; // `[` + sel + `](`
    return { text: out, start: urlPos, end: urlPos };
  }
  // No selection — place caret in the empty text slot.
  const textPos = start + 1; // right after `[`
  return { text: out, start: textPos, end: textPos };
}

// Toggle a line prefix (e.g. '# ', '- ', '> ', '1. ') on every line touched by
// the selection. If all touched lines already start with `prefix`, removes it;
// otherwise adds it. Caret/selection shifts to follow the first line's delta.
// Used by the formatting toolbar for headings, lists, and blockquotes.
export function toggleLinePrefix(text, start, end, prefix) {
  const [lineStart] = lineRange(text, Math.min(start, end));
  const block = text.slice(lineStart, Math.max(start, end));
  const lines = block.split('\n');
  const allHave = lines.every((l) => l.startsWith(prefix));
  const replaced = lines.map((l) => (allHave ? l.slice(prefix.length) : prefix + l)).join('\n');
  const out = text.slice(0, lineStart) + replaced + text.slice(Math.max(start, end));
  const delta = allHave ? -prefix.length : prefix.length; // first-line change
  // Multi-line: extra delta accumulates per extra line.
  const extra = lines.length > 1 ? (lines.length - 1) * delta : 0;
  return {
    text: out,
    start: Math.max(lineStart, Math.min(start, start + delta)),
    end: Math.max(start, end) + delta + extra,
  };
}

// ----------------------------- auto-pair ------------------------------------

const PAIRS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set([')', ']', '}']);
const QUOTES = new Set(['"', "'", '`']);

// Decide what to do when the user types `char` at [start,end).
// Returns null if we should let the browser handle it natively.
export function autoPair(text, start, end, char) {
  // Skip-over: typing a closer when the next char is that closer → move caret +1.
  if (CLOSERS.has(char) || QUOTES.has(char)) {
    if (start === end && text[start] === char) {
      return { text, start: start + 1, end: start + 1, handled: true };
    }
  }

  // Open bracket with no selection → insert pair, caret inside.
  if (PAIRS[char] && start === end) {
    const insert = char + PAIRS[char];
    return { text: text.slice(0, start) + insert + text.slice(start), start: start + 1, end: start + 1, handled: true };
  }

  // Quote with no selection. Heuristic: only pair if the preceding char is not
  // a word char (avoids pairing inside contractions like "don't").
  if (QUOTES.has(char) && start === end) {
    const prev = text[start - 1] || '';
    if (!/\w/.test(prev)) {
      const insert = char + char;
      return { text: text.slice(0, start) + insert + text.slice(start), start: start + 1, end: start + 1, handled: true };
    }
  }

  return null; // let the browser type it
}

// Backspace at [start,end): if deleting an empty pair (closer right after
// opener), delete both. Returns null if not applicable.
export function handleBackspace(text, start, end) {
  if (start !== end || start === 0) return null;
  const prev = text[start - 1];
  const next = text[start];
  if (PAIRS[prev] && next === PAIRS[prev]) {
    return { text: text.slice(0, start - 1) + text.slice(start + 1), start: start - 1, end: start - 1 };
  }
  if (QUOTES.has(prev) && next === prev) {
    return { text: text.slice(0, start - 1) + text.slice(start + 1), start: start - 1, end: start - 1 };
  }
  return null;
}

// ----------------------------- find ----------------------------------------

// Returns array of {start, end} for every match of `query`.
// v0.41.0: options object adds `regex` and `wholeWord`. The legacy
// `findMatches(text, query, caseSensitive)` 3-arg form still works because
// the 3rd arg is accepted positionally and threaded into `caseSensitive`.
export function findMatches(text, query, opts = {}) {
  if (typeof opts === 'boolean') opts = { caseSensitive: opts };
  const { caseSensitive = false, regex = false, wholeWord = false } = opts;
  if (!query) return [];

  // Regex path. Invalid pattern → [] (UI shows "no match"). Zero-length
  // matches (e.g. `a*`) are advanced by 1 to avoid an infinite loop.
  if (regex) {
    let re;
    try { re = new RegExp(query, caseSensitive ? 'g' : 'gi'); }
    catch { return []; }
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  }

  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  // Whole-word: require a non-word char (or string boundary) on each side.
  // We still find candidates via indexOf for speed, then boundary-check.
  const isWord = (ch) => /\w/.test(ch);
  const out = [];
  let i = 0;
  while (i <= hay.length) {
    const idx = hay.indexOf(needle, i);
    if (idx === -1) break;
    const end = idx + needle.length;
    if (wholeWord) {
      const leftOk = idx === 0 || !isWord(hay[idx - 1]);
      const rightOk = end === hay.length || !isWord(hay[end]);
      if (leftOk && rightOk) out.push({ start: idx, end });
    } else {
      out.push({ start: idx, end });
    }
    i = end;
  }
  return out;
}

// Given matches[] and current caret, returns the index of the match to jump to
// for "next" (forward) or "prev" (backward). Wraps around.
export function nextMatchIndex(matches, caret, forward = true) {
  if (matches.length === 0) return -1;
  if (forward) {
    const next = matches.findIndex((m) => m.start >= caret);
    return next === -1 ? 0 : next;
  }
  // A match counts as "behind the caret" only if it fully ends before the
  // caret — this excludes a match the caret currently sits inside.
  let last = -1;
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].end < caret) last = i;
    else break;
  }
  return last === -1 ? matches.length - 1 : last;
}

// ----------------------------- shared --------------------------------------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Count lines — used by the gutter to know how many number cells to render.
export function lineCount(text) {
  if (text.length === 0) return 1;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

// Flip a GitHub task-list checkbox on a given 0-indexed line. Recognizes the
// GFM syntax: `- [ ]` / `- [x]` (case-insensitive x), with any list marker
// (-, *, +) and any leading indent. Returns the new { text } unchanged if the
// line isn't a task item. Used by the clickable-checkbox-in-preview feature.
export function toggleTaskLine(text, lineIndex) {
  const lines = text.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return { text };
  const ln = lines[lineIndex];
  const doneRe = /^(\s*[-*+]\s+)\[[xX]\](\s*)/;
  const openRe = /^(\s*[-*+]\s+)\[ \](\s*)/;
  if (doneRe.test(ln)) {
    lines[lineIndex] = ln.replace(doneRe, '$1[ ]$2');
  } else if (openRe.test(ln)) {
    lines[lineIndex] = ln.replace(openRe, '$1[x]$2');
  } else {
    return { text };
  }
  return { text: lines.join('\n') };
}

// Map the Nth rendered task-list checkbox (0-indexed, in document order) back
// to its source line index. The rendered order matches source order, so we
// scan the source lines for task markers and return the (itemIndex)-th match.
// Returns -1 if itemIndex is out of range (line changed under us, etc.).
const TASK_LINE_RE = /^\s*[-*+]\s+\[[ xX]\]/;
export function taskLineIndex(text, itemIndex) {
  if (itemIndex < 0) return -1;
  const lines = text.split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    // Skip fenced code blocks so `- [ ]` inside ``` isn't mistaken for a task.
    if (/^\s*```/.test(lines[i])) {
      // toggle fence state by scanning — simple approach: skip to closing fence
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) i++;
      continue;
    }
    if (TASK_LINE_RE.test(lines[i])) {
      if (seen === itemIndex) return i;
      seen++;
    }
  }
  return -1;
}

// ----------------------------- line operations -----------------------------
// Duplicate / move / comment helpers. All operate on the line(s) spanned by
// [start, end) and return the next { text, start, end }. Caret/selection is
// placed on the resulting line(s) so the user can repeat the action.

// Duplicate every line touched by the selection downward (VS Code Ctrl+D
// behavior). With no selection, duplicates the caret's line. The selection
// is moved onto the newly-inserted copy so a second Ctrl+D duplicates again.
export function duplicateLines(text, start, end) {
  const [lineStart, lineEnd] = lineRange2(text, start, end);
  const block = text.slice(lineStart, lineEnd);
  const nlAfter = text[lineEnd] === '\n' ? '\n' : '';
  // Insert "<block>\n" after the last touched line. If there's no trailing
  // newline (last line of doc), we add one to separate the copy.
  const sep = nlAfter || '\n';
  const out = text.slice(0, lineEnd) + sep + block + text.slice(lineEnd);
  const newStart = lineEnd + sep.length;
  const newEnd = newStart + block.length;
  return { text: out, start: newStart, end: newEnd };
}

// Move the touched line(s) up (dir=-1) or down (dir=1). Swaps the block with
// the adjacent line above/below. No-op (returns text unchanged) at the top of
// the doc when moving up, or at the bottom when moving down — the caller can
// detect that via `result.text === text` to skip the write-back. The selection
// tracks the moved block so the user can repeat the move.
export function moveLines(text, start, end, dir) {
  const [lineStart, lineEnd] = lineRange2(text, start, end);
  if (dir < 0) {
    // Need a line above to swap with. The separator \n sits at lineStart-1.
    if (lineStart === 0) return { text, start, end };
    const prevEnd = lineStart - 1; // index of the \n between above and block
    const prevStart = text.lastIndexOf('\n', prevEnd - 1) + 1; // start of above line
    const before = text.slice(0, prevStart); // usually "" (prevStart follows a \n or is 0)
    const above = text.slice(prevStart, prevEnd);
    const block = text.slice(lineStart, lineEnd);
    const rest = text.slice(lineEnd); // includes the \n after block if any
    const out = before + block + '\n' + above + rest;
    // Block moved up to [prevStart, prevStart + block.length).
    const shift = prevStart - lineStart; // negative
    return { text: out, start: start + shift, end: end + shift };
  } else {
    // Need a line below to swap with. Requires a \n right after the block.
    if (lineEnd >= text.length || text[lineEnd] !== '\n') return { text, start, end };
    const belowStart = lineEnd + 1;
    let belowEnd = text.indexOf('\n', belowStart);
    if (belowEnd === -1) belowEnd = text.length;
    const before = text.slice(0, lineStart); // includes the \n before the block
    const block = text.slice(lineStart, lineEnd);
    const below = text.slice(belowStart, belowEnd);
    const rest = text.slice(belowEnd); // includes the \n after below if any
    const out = before + below + '\n' + block + rest;
    // Block moved down by (below.length + 1 for the inserted \n).
    const shift = below.length + 1;
    return { text: out, start: start + shift, end: end + shift };
  }
}

// Sort the line(s) spanned by [start, end]. If the selection spans multiple
// lines, only those lines are sorted; if it's a caret (start === end), the
// whole document is sorted. `dir` is 'asc' (default) or 'desc'. Uses
// localeCompare for natural ordering (case-insensitive, accent-aware). The
// returned selection covers the sorted block. No-op if fewer than 2 lines.
export function sortLines(text, start, end, dir = 'asc') {
  if (!text) return { text, start, end };
  const [lineStart, lineEnd] = lineRange2(text, start, end);
  // Whole-doc sort when the selection is a caret OR covers only one line.
  const singleLine = lineStart === lineEnd || text.indexOf('\n', lineStart) === -1
    || text.indexOf('\n', lineStart) >= lineEnd;
  const blkStart = singleLine ? 0 : lineStart;
  const blkEnd = singleLine ? text.length : lineEnd;
  const block = text.slice(blkStart, blkEnd);
  // Split into lines WITHOUT keeping the trailing newline on each, so we can
  // re-join with '\n' cleanly. Preserve whether the block ended with a newline.
  const hadTrailingNl = block.endsWith('\n');
  const lines = (hadTrailingNl ? block.slice(0, -1) : block).split('\n');
  if (lines.length < 2) return { text, start, end };
  lines.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if (dir === 'desc') lines.reverse();
  const sorted = lines.join('\n') + (hadTrailingNl ? '\n' : '');
  const out = text.slice(0, blkStart) + sorted + text.slice(blkEnd);
  // Place the caret at the end of the sorted block.
  const newCaret = blkStart + sorted.length - (hadTrailingNl ? 1 : 0);
  return { text: out, start: newCaret, end: newCaret };
}

// v0.49.0: Convert the case of the selection (or the current line when the
// selection is a caret). `mode` is 'upper' | 'lower' | 'title' | 'toggle'.
//   - caret (start === end) → transform the current line (intuitive for case)
//   - selection             → transform just the selected text
// The returned selection covers the transformed span. No-op on empty input.
// Title case capitalizes the first letter of each word (a "word" is a run of
// letters/digits); non-word separators are preserved. Toggle swaps per-char
// upper↔lower. Palette-only (no keybind) — invoked via convertCaseSelection.
export function convertCase(text, start, end, mode = 'upper') {
  if (!text) return { text, start, end };
  const s = Math.min(start, end);
  const e = Math.max(start, end);
  // Caret → operate on the whole current line; selection → operate on the span.
  let blkStart, blkEnd;
  if (s === e) {
    [blkStart, blkEnd] = lineRange2(text, s, e);
  } else {
    blkStart = s;
    blkEnd = e;
  }
  const block = text.slice(blkStart, blkEnd);
  const transformed = transformCase(block, mode);
  if (transformed === block) return { text, start, end };
  const out = text.slice(0, blkStart) + transformed + text.slice(blkEnd);
  return { text: out, start: blkStart, end: blkStart + transformed.length };
}

// Pure case transform of a string. Exported for direct unit testing.
//   transformCase('foo Bar', 'upper')  → 'FOO BAR'
//   transformCase('foo Bar', 'lower')  → 'foo bar'
//   transformCase('foo bar', 'title')  → 'Foo Bar'
//   transformCase('Foo bAR', 'toggle') → 'fOO Bar'
//   transformCase('foo bar', 'weird')  → 'foo bar'  (unknown mode → no-op)
export function transformCase(str, mode) {
  if (!str) return str;
  if (mode === 'upper') return str.toUpperCase();
  if (mode === 'lower') return str.toLowerCase();
  if (mode === 'toggle') {
    let out = '';
    for (const ch of str) {
      const up = ch.toUpperCase();
      out += ch === up ? ch.toLowerCase() : up;
    }
    return out;
  }
  if (mode === 'title') {
    // Capitalize the first letter of each word run; lowercase the rest. A "word"
    // is a run of letters/digits so apostrophes/punct act as separators and
    // are passed through unchanged.
    return str.replace(/(\p{L}|\p{N})([\p{L}\p{N}]*)/gu, (_m, head, tail) => head.toUpperCase() + tail.toLowerCase());
  }
  return str; // unknown mode → no-op
}

// Toggle an HTML comment (`<!-- ... -->`) around the selection. Markdown has
// no native line-comment, so this is the canonical way to hide prose. Three
// cases:
//   - Selection already wrapped → unwrap (toggle off).
//   - Selection present → wrap with `<!--` + `-->`, caret stays inside.
//   - No selection → wrap the entire caret line, caret at start of content.
export function toggleComment(text, start, end) {
  const C_OPEN = '<!--';
  const C_CLOSE = '-->';
  // Toggle off if currently wrapped.
  if (start !== end &&
      text.slice(start - C_OPEN.length, start) === C_OPEN &&
      text.slice(end, end + C_CLOSE.length) === C_CLOSE) {
    const out = text.slice(0, start - C_OPEN.length) + text.slice(start, end) + text.slice(end + C_CLOSE.length);
    return { text: out, start: start - C_OPEN.length, end: end - C_OPEN.length };
  }
  if (start !== end) {
    const sel = text.slice(start, end);
    const out = text.slice(0, start) + C_OPEN + sel + C_CLOSE + text.slice(end);
    return { text: out, start: start + C_OPEN.length, end: end + C_OPEN.length };
  }
  // No selection → comment the whole caret line.
  const [lineStart, lineEnd] = lineRange2(text, start, end);
  const line = text.slice(lineStart, lineEnd);
  const out = text.slice(0, lineStart) + C_OPEN + line + C_CLOSE + text.slice(lineEnd);
  return { text: out, start: lineStart + C_OPEN.length, end: lineStart + C_OPEN.length + line.length };
}

// Returns [startOfFirstTouchedLine, startOfLineAfterLastTouchedLine).
// Differs from lineRange() (which is caret-relative) in that it spans the
// FULL block of touched lines including the trailing newline boundary, which
// the move/duplicate ops need to reason about cleanly.
function lineRange2(text, start, end) {
  const s = Math.min(start, end);
  const e = Math.max(start, end);
  const lineStart = text.lastIndexOf('\n', s - 1) + 1;
  let lineEnd = text.indexOf('\n', e);
  if (lineEnd === -1) lineEnd = text.length;
  // If the selection ends exactly at a line boundary (caret at col 0 of the
  // next line), don't include that next line in the touched range.
  if (e !== s && e === lineEnd && text[e - 1] === '\n') {
    lineEnd = e - 1;
  }
  return [lineStart, lineEnd];
}

// ----------------------------- heading extraction --------------------------
// v0.38.0: parse ATX headings (#..######) for the "jump to heading" picker.
// Returns [{ level, text, line }] where line is 1-indexed (matches the gutter
// and scrollEditorToLine). Skips fenced code blocks so a `# comment` inside
// ``` isn't mistaken for an h1. Setext headings (underline === / ---) are NOT
// recognized — they're rare in notes and ATX covers >99% of real docs.
const ATX_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
export function extractHeadings(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const out = [];
  let inFence = false;
  let fenceMarker = '';
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    // Track fenced code blocks (``` or ~~~). A line opening/closing a fence
    // can't also be a heading, so we check fence state before ATX.
    const fenceOpen = ln.match(/^\s*(`{3,}|~{3,})/);
    if (fenceOpen) {
      if (!inFence) { inFence = true; fenceMarker = fenceOpen[1][0]; }
      else if (fenceMarker && ln.trim().startsWith(fenceMarker.repeat(3))) { inFence = false; }
      continue;
    }
    if (inFence) continue;
    const m = ln.match(ATX_RE);
    if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 });
  }
  return out;
}

// Build a portable relative-path image markdown link for a pasted/dropped
// image. Used by insertImageFromBlob in main.js when the
// `mdpeek-image-beside-doc` setting is on (default). Returns the markdown
// string, or null if `docPath` is null/empty (untitled doc — no folder to
// save beside, so the caller falls back to a global path or data URL).
//
//   buildRelativeImageMarkdown('C:\\notes\\Foo.md', 'img-abc.png')
//     → '![](assets/img-abc.png)'
//   buildRelativeImageMarkdown('/home/me/Foo.md', 'img-abc.png')
//     → '![](assets/img-abc.png)'
//   buildRelativeImageMarkdown(null, 'img-abc.png') → null
export function buildRelativeImageMarkdown(docPath, filename) {
  if (!docPath) return null;
  return `![](assets/${filename})`;
}

// ----------------------------- table cell navigation -----------------------
// v0.44.0: when the caret sits inside a markdown table row, Tab/Shift+Tab
// should jump cell-to-cell (like a spreadsheet) instead of inserting the
// indent string. Returns { caret } when it handled the key (the editor sets
// the selection to that absolute offset), or null to fall through to normal
// Tab handling. `dir` is +1 (Tab) or -1 (Shift+Tab).
//
// A "table row" is a line matching /^\s*\|.*\|\s*$/ — i.e. starts with a pipe
// (after optional indent) and ends with one. The delimiter row (|---|---|)
// qualifies too; navigating onto it is harmless and matches Typora/Obsidian.
export function tableCellNav(text, caret, dir) {
  if (!text || typeof caret !== 'number') return null;
  // Find the line the caret is on.
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  let lineEnd = text.indexOf('\n', caret);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  // Must look like a table row.
  if (!/^\s*\|.*\|\s*$/.test(line)) return null;

  // Split into cells. We keep track of each cell's [start, end) offsets in
  // the full text so we can jump the caret to absolute positions. The pipes
  // themselves are the delimiters; cells are what's between them.
  //   "| a | b |"  →  cells: " a ", " b "  (between the 3 pipes)
  const pipeOffsets = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '|' && !(i > 0 && line[i - 1] === '\\')) pipeOffsets.push(i);
  }
  if (pipeOffsets.length < 2) return null;

  // Build [absStart, absEnd) per cell from consecutive pipe pairs.
  const cells = [];
  for (let i = 0; i < pipeOffsets.length - 1; i++) {
    const cs = lineStart + pipeOffsets[i] + 1;
    const ce = lineStart + pipeOffsets[i + 1];
    cells.push([cs, ce]);
  }

  // Locate the cell containing the caret (caret may be on a pipe; treat a
  // pipe as belonging to the cell to its right, except the last pipe which
  // belongs to the cell to its left).
  let idx = cells.findIndex(([cs, ce]) => caret >= cs && caret < ce);
  if (idx === -1) {
    // Caret is on/after the final pipe → last cell.
    idx = cells.length - 1;
  }

  let target = idx + dir;
  if (target >= 0 && target < cells.length) {
    // Stay on this row: place caret at the start of the target cell's content
    // (skip one leading space if present, so the caret lands after the space).
    return { caret: cellContentStart(text, cells[target]) };
  }

  // Past the row edge → move to the same column on the prev/next row.
  const wantCol = dir > 0 ? 0 : cells.length - 1;
  if (dir > 0) {
    // Move down to the next row, first cell.
    if (lineEnd >= text.length) return { caret }; // no next line
    const nextLineEnd = text.indexOf('\n', lineEnd + 1);
    const nextEnd = nextLineEnd === -1 ? text.length : nextLineEnd;
    const nextLine = text.slice(lineEnd + 1, nextEnd);
    if (!/^\s*\|.*\|\s*$/.test(nextLine)) return { caret };
    return { caret: cellOnRow(text, lineEnd + 1, nextLine, wantCol) };
  } else {
    // Move up to the previous row, last cell.
    if (lineStart === 0) return { caret }; // no previous line
    const prevLineStart = text.lastIndexOf('\n', lineStart - 2) + 1;
    const prevLine = text.slice(prevLineStart, lineStart - 1);
    if (!/^\s*\|.*\|\s*$/.test(prevLine)) return { caret };
    return { caret: cellOnRow(text, prevLineStart, prevLine, wantCol) };
  }
}

// Place the caret at the content start of cell `col` on the row beginning at
// `rowStart`. `line` is the row's text. Falls back to row start if the row
// has fewer cells than `col`.
function cellOnRow(text, rowStart, line, col) {
  const pipes = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '|' && !(i > 0 && line[i - 1] === '\\')) pipes.push(i);
  }
  if (pipes.length < 2) return rowStart;
  const maxCol = pipes.length - 2; // last cell index
  const c = Math.min(col, maxCol);
  const cellStart = rowStart + pipes[c] + 1;
  return cellContentStart(text, [cellStart, rowStart + pipes[c + 1]]);
}

// Given a cell [start, end), return the offset of its first non-space char
// (so Tab lands inside the content, not on the leading padding).
function cellContentStart(text, [cs, ce]) {
  let i = cs;
  while (i < ce && (text[i] === ' ' || text[i] === '\t')) i++;
  return i;
}

// v0.45.0: detect the contiguous table block (consecutive /^\s*\|.*\|\s*$/
// lines) surrounding the caret. Returns { startLine, endLine, lines } where
// lines is the array of table-row strings (without their newlines), or null
// when the caret is not inside a table. Used by formatTableBlock + sortTableRows.
// v0.52.0: exported so src/lib/table.js (visual table editor) can reuse the
// same block detection instead of re-implementing it.
export function detectTableBlock(text, pos) {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  // Walk backwards to the first non-table line.
  let s = lineStart;
  while (s > 0) {
    const prevStart = text.lastIndexOf('\n', s - 2) + 1;
    const prevLine = text.slice(prevStart, s - 1); // exclude the newline
    if (!/^\s*\|.*\|\s*$/.test(prevLine)) break;
    s = prevStart;
  }
  // Walk forwards to the first non-table line.
  let e = text.indexOf('\n', pos);
  if (e === -1) e = text.length;
  let endLineEnd = e;
  while (endLineEnd < text.length) {
    const nextStart = endLineEnd + 1;
    const nextEnd = text.indexOf('\n', nextStart);
    const nextLineEnd = nextEnd === -1 ? text.length : nextEnd;
    const nextLine = text.slice(nextStart, nextLineEnd);
    if (!/^\s*\|.*\|\s*$/.test(nextLine)) break;
    endLineEnd = nextLineEnd;
  }
  const blockText = text.slice(s, endLineEnd);
  const lines = blockText.split('\n').filter((l) => /^\s*\|.*\|\s*$/.test(l));
  if (lines.length < 2) return null; // a table needs a header + delimiter at minimum
  return { startLine: s, endLine: endLineEnd, lines };
}

// Split a table row into raw cell bodies (the text between the pipes, with the
// surrounding spaces preserved so alignment can pad them). The leading/trailing
// pipes are dropped; escaped pipes \| are preserved as-is (caller treats them
// literally, matching the renderer's behavior). Returns [] if the line isn't
// a valid row.
function splitRowCells(line) {
  const trimmed = line.replace(/^\s+/, '');
  // Strip exactly one leading and one trailing pipe (the markdown table shape).
  const inner = trimmed.replace(/^\|/, '').replace(/\|\s*$/, '');
  // Split on unescaped pipes. A simple scan avoids lookbehind portability
  // issues some engines have with /\|/ in split().
  const cells = [];
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '|' && !(i > 0 && inner[i - 1] === '\\')) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

// Format the table block surrounding the caret: pad each cell so columns line
// up, preserving the delimiter row's alignment markers (:--: etc.). Returns
// the transformed { text, start, end } or null if the caret isn't in a table.
// The caret is moved to the start of the formatted block.
export function formatTableBlock(text, pos) {
  if (!text || typeof pos !== 'number') return null;
  const block = detectTableBlock(text, pos);
  if (!block) return null;
  const { startLine, endLine, lines } = block;
  const parsed = lines.map((l) => splitRowCells(l));
  const colCount = Math.max(...parsed.map((r) => r.length));
  const widths = new Array(colCount).fill(0);
  // Compute per-column max content width, skipping the delimiter row (its
  // cells are dashes — padding those would widen the table for no reason).
  for (let r = 0; r < parsed.length; r++) {
    if (r === 1 && isDelimiterRow(parsed[r])) continue;
    for (let c = 0; c < parsed[r].length; c++) {
      widths[c] = Math.max(widths[c], parsed[r][c].trim().length);
    }
  }
  // Re-emit each row with padded cells. The delimiter row's dashes are
  // extended to the column width so the rendered table looks consistent.
  const out = parsed.map((row, r) => {
    const padded = [];
    for (let c = 0; c < colCount; c++) {
      const cell = (row[c] || '').trim();
      if (r === 1 && isDelimiterCell(cell)) {
        padded.push(padDelimiter(cell, widths[c]));
      } else {
        padded.push(padCell(cell, widths[c]));
      }
    }
    return `| ${padded.join(' | ')} |`;
  });
  const formatted = out.join('\n');
  const next = text.slice(0, startLine) + formatted + text.slice(endLine);
  return { text: next, start: startLine, end: startLine };
}

// Pad a normal cell to `width` with trailing spaces (left-aligned, the GFM
// default). The one-space padding on each side is added by the joiner in
// formatTableBlock, so this is just the raw content width.
function padCell(cell, width) {
  return cell + ' '.repeat(Math.max(0, width - cell.length));
}
function padDelimiter(cell, width) {
  // Delimiter cells look like :---, ---, :--:, ---. Pad the dashes to width.
  const m = cell.match(/^(:?)(-*)(:?)$/);
  if (!m) return padCell(cell, width);
  const [, left, , right] = m;
  const target = Math.max(3, width); // min 3 dashes so GFM still sees a delimiter
  const dashCount = Math.max(0, target - left.length - right.length);
  return `${left}${'-'.repeat(dashCount)}${right}`;
}
function isDelimiterRow(row) {
  return row.every((c) => isDelimiterCell(c.trim()));
}
function isDelimiterCell(cell) {
  return /^:?-+:?$/.test(cell);
}

// Sort the body rows of the table surrounding the caret by column `col`
// (0-indexed) in direction `dir` ('asc' | 'desc'). The header + delimiter
// rows are kept in place; numeric cells sort numerically, others lexically.
// Returns the transformed { text, start, end } or null if not in a table.
export function sortTableRows(text, pos, col = 0, dir = 'asc') {
  if (!text || typeof pos !== 'number') return null;
  const block = detectTableBlock(text, pos);
  if (!block) return null;
  const { startLine, endLine, lines } = block;
  if (lines.length < 3) return null; // need header + delimiter + at least one body row
  const header = lines[0];
  const delimiter = lines[1];
  const body = lines.slice(2);
  const sorted = body.slice().sort((a, b) => {
    const ca = (splitRowCells(a)[col] || '').trim();
    const cb = (splitRowCells(b)[col] || '').trim();
    const na = Number(ca);
    const nb = Number(cb);
    let cmp;
    if (Number.isFinite(na) && Number.isFinite(nb) && ca !== '' && cb !== '') {
      cmp = na - nb;
    } else {
      cmp = ca.localeCompare(cb, undefined, { sensitivity: 'base', numeric: true });
    }
    return dir === 'desc' ? -cmp : cmp;
  });
  const out = [header, delimiter, ...sorted].join('\n');
  const next = text.slice(0, startLine) + out + text.slice(endLine);
  return { text: next, start: startLine, end: startLine };
}

// ----------------------- v0.46.0 editor helpers --------------------------

// B1: Transpose (swap) the two characters on either side of the caret.
// Classic Unix-editing Ctrl+T behavior:
//   - caret mid-line → swap chars at pos-1 and pos, leave caret at pos+1,
//   - caret at end of line → swap the last two chars (pos-2/pos-1), caret at
//     end of line,
//   - caret at start of line/doc → no-op (nothing to swap on the left).
// `pos` is a caret position (start === end).
export function transposeChars(text, pos) {
  if (!text) return { text, start: pos, end: pos };
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const col = pos - lineStart;
  // Need at least 2 chars on this line to the left of (or around) the caret.
  if (col <= 0) {
    // At the start of a line: no left char. No-op.
    return { text, start: pos, end: pos };
  }
  // At end of line (caret on the \n or at the line's last char): swap the last
  // two chars of the line. Otherwise swap the chars flanking the caret.
  const atLineEnd = pos >= text.length || text[pos] === '\n';
  const a = atLineEnd ? pos - 2 : pos - 1;
  const b = atLineEnd ? pos - 1 : pos;
  if (a < lineStart) return { text, start: pos, end: pos }; // single-char line
  const out = text.slice(0, a) + text[b] + text[a] + text.slice(b + 1);
  const caret = atLineEnd ? pos : pos + 1;
  return { text: out, start: caret, end: caret };
}

// B2: Join the current line with the next: drop the newline between them,
// collapse the next line's leading whitespace to a single space, and collapse
// any resulting double space. No-op on the last line. Caret lands at the join
// point (where the newline was).
export function joinLine(text, pos) {
  if (!text) return { text, start: pos, end: pos };
  const lineEnd = text.indexOf('\n', pos);
  if (lineEnd === -1) return { text, start: pos, end: pos }; // last line
  const nextStart = lineEnd + 1;
  let nextEnd = text.indexOf('\n', nextStart);
  if (nextEnd === -1) nextEnd = text.length;
  const leftPart = text.slice(0, lineEnd).replace(/\s+$/, '');
  const trimmedNext = text.slice(nextStart, nextEnd).replace(/^\s+/, '');
  // Join with a single space when both sides have content; empty joiner otherwise.
  const joiner = leftPart && trimmedNext ? ' ' : '';
  const out = leftPart + joiner + trimmedNext + text.slice(nextEnd);
  const caret = leftPart.length + joiner.length;
  return { text: out, start: caret, end: caret };
}

// B3: Convert the selected line(s) between bullet (`- `/`* `/`+ `) and ordered
// (`1. `) list markers. `to` is 'bullet' or 'ordered'. Mirrors toggleLinePrefix:
// operates on every touched line. Ordered output is renumbered sequentially;
// bullet output normalizes any marker to `- `. Non-list lines gain the prefix.
// Indent is preserved (sub-lists keep their leading spaces).
export function convertList(text, start, end, to = 'bullet') {
  if (!text) return { text, start, end };
  const [lineStart] = lineRange(text, Math.min(start, end));
  const blockEnd = Math.max(start, end);
  const block = text.slice(lineStart, blockEnd);
  const lines = block.split('\n');
  // Detect what the block currently is by inspecting the first line's marker.
  const bulletRe = /^(\s*)([-*+])\s+/;
  const orderedRe = /^(\s*)(\d+)\.\s+/;
  // Decide direction if `to` isn't explicit: bullets → ordered, else → bullets.
  const firstMarked = lines.find((l) => bulletRe.test(l) || orderedRe.test(l));
  const currentlyBullet = firstMarked ? bulletRe.test(firstMarked) : false;
  const target = to === 'auto' ? (currentlyBullet ? 'ordered' : 'bullet') : to;

  let counter = 1;
  const replaced = lines.map((l) => {
    const b = l.match(bulletRe);
    const o = l.match(orderedRe);
    const indent = (b || o) ? (b || o)[1] : (l.match(/^(\s*)/)?.[1] || '');
    const content = (b || o) ? l.slice((b || o)[0].length) : l.trimStart();
    if (target === 'ordered') {
      return `${indent}${counter++}. ${content}`;
    }
    return `${indent}- ${content}`;
  }).join('\n');

  const out = text.slice(0, lineStart) + replaced + text.slice(blockEnd);
  return { text: out, start: lineStart, end: lineStart + replaced.length };
}

// B4: Compute a selection that covers the whole caret line. When `extend` is
// true, the end is pushed to the end of the next line instead (for repeated
// Ctrl+L). `anchor` is the user's original selection anchor so extension stays
// anchored at the top. Returns { start, end } only (text is unchanged).
//
// Call shape for the editor view:
//   first Ctrl+L  → selectLine(text, pos, { anchor: pos, extend: false })
//   repeat        → selectLine(text, currentEnd, { anchor, extend: true })
export function selectLine(text, pos, { anchor = null, extend = false } = {}) {
  if (!text) return { start: 0, end: 0 };
  const base = extend && anchor != null ? Math.max(anchor, pos) : pos;
  const lineStart = text.lastIndexOf('\n', base - 1) + 1;
  let lineEnd = text.indexOf('\n', base);
  if (lineEnd === -1) lineEnd = text.length;
  // When extending, push the end to the end of the FOLLOWING line (so the
  // selection grows by one full line each press).
  if (extend && lineEnd < text.length) {
    const nextEnd = text.indexOf('\n', lineEnd + 1);
    lineEnd = nextEnd === -1 ? text.length : nextEnd;
  }
  const start = extend && anchor != null ? Math.min(anchor, lineStart) : lineStart;
  return { start, end: lineEnd };
}

// B5: Derive a sensible title for an extracted note from its content. Prefers
// the first ATX heading's text, then the first non-empty line (truncated to
// 60 chars), finally "Untitled". Pure helper (no DOM).
export function deriveNoteTitle(text) {
  if (!text || !text.trim()) return 'Untitled';
  const lines = text.split('\n');
  // First ATX heading.
  for (const ln of lines) {
    const m = ln.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (m) return truncate(m[1]);
  }
  // First non-empty, non-front-matter line.
  for (const ln of lines) {
    const t = ln.trim();
    if (t && !t.startsWith('---') && !t.startsWith('+++')) return truncate(t);
  }
  return 'Untitled';
}

function truncate(s, max = 60) {
  const t = String(s).trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
