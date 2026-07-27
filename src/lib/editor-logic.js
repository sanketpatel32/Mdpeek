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

// Returns array of {start, end} for every match of `query` (case-insensitive
// unless caseSensitive). Empty query → [].
export function findMatches(text, query, caseSensitive = false) {
  if (!query) return [];
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const out = [];
  let i = 0;
  while (i < hay.length) {
    const idx = hay.indexOf(needle, i);
    if (idx === -1) break;
    out.push({ start: idx, end: idx + needle.length });
    i = idx + needle.length;
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
