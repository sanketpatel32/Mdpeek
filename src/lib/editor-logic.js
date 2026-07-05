// Pure editor helpers — no DOM. Each takes the textarea's current text and
// selection and returns the next { text, start, end } state. Unit-tested in
// test/editor-logic.test.js. The DOM wiring in src/views/editor.js calls these
// and writes the result back via setRangeText + setSelectionRange.

const INDENT = '  '; // 2 spaces — matches GitHub/VS Code markdown default

// ----------------------------- selection utils -----------------------------

// Returns [lineStart, lineEnd] offsets for the line(s) spanned by [start, end].
function lineRange(text, pos) {
  const start = text.lastIndexOf('\n', pos - 1) + 1; // -1 → 0 (first line)
  let end = text.indexOf('\n', pos);
  if (end === -1) end = text.length;
  return [start, end];
}

// ----------------------------- Tab / Shift+Tab -----------------------------

// No selection → insert 2 spaces at caret.
// Selection (even partial) → indent every touched line by INDENT.
export function handleTab(text, start, end) {
  if (start === end) {
    return insertAt(text, start, INDENT, start + INDENT.length);
  }
  return indentLines(text, start, end, INDENT);
}

// Outdent every touched line by one INDENT (2 spaces). Lines with no leading
// INDENT are left alone. Collapses a multi-line selection to its start.
export function handleShiftTab(text, start, end) {
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
  while (i <= hay.length) {
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
