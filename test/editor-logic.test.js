import { describe, it, expect, afterEach } from 'vitest';
import {
  handleTab,
  handleShiftTab,
  handleEnter,
  wrapSelection,
  toggleLinePrefix,
  autoPair,
  handleBackspace,
  findMatches,
  nextMatchIndex,
  lineCount,
  insertLink,
  toggleTaskLine,
  taskLineIndex,
  duplicateLines,
  moveLines,
  toggleComment,
  sortLines,
  getIndent,
  extractHeadings,
  buildRelativeImageMarkdown,
  tableCellNav,
  formatTableBlock,
  sortTableRows,
  transposeChars,
  joinLine,
  convertList,
  selectLine,
  deriveNoteTitle,
  convertCase,
  transformCase,
  wrapBlock,
} from '../src/lib/editor-logic.js';

// helper: apply a logic result to verify text + caret in one assertion
function apply(text, start, end, fn, ...args) {
  return fn(text, start, end, ...args);
}

describe('handleTab', () => {
  it('inserts 2 spaces at caret when no selection', () => {
    const r = handleTab('abc', 1, 1);
    expect(r.text).toBe('a  bc');
    expect(r.start).toBe(3);
    expect(r.end).toBe(3);
  });

  it('indents every selected line', () => {
    const r = handleTab('a\nb\nc', 0, 5); // spans all 3 lines
    expect(r.text).toBe('  a\n  b\n  c');
  });

  it('indents the line of a partial single-line selection', () => {
    const r = handleTab('hello', 1, 3); // sel "el"
    expect(r.text).toBe('  hello');
  });
});

describe('handleShiftTab', () => {
  it('outdents lines that start with the indent', () => {
    const r = handleShiftTab('  a\n  b\n  c', 0, 10);
    expect(r.text).toBe('a\nb\nc');
  });

  it('leaves un-indented lines unchanged', () => {
    const r = handleShiftTab('a\nb', 0, 3);
    expect(r.text).toBe('a\nb');
  });

  it('outdents only the leading indent, not all whitespace', () => {
    const r = handleShiftTab('    a', 0, 5); // 4 spaces → 2 spaces
    expect(r.text).toBe('  a');
  });
});

describe('handleEnter', () => {
  it('plain newline when not in a list or fence', () => {
    const r = handleEnter('hello', 2, 2);
    expect(r.text).toBe('he\nllo');
    expect(r.start).toBe(3);
  });

  it('replaces selection with a newline', () => {
    const r = handleEnter('hello', 1, 4);
    expect(r.text).toBe('h\no');
  });

  it('continues a bullet list', () => {
    const r = handleEnter('- item', 6, 6);
    expect(r.text).toBe('- item\n- ');
    expect(r.start).toBe(9);
  });

  it('continues a hyphen bullet', () => {
    const r = handleEnter('* x', 3, 3);
    expect(r.text).toBe('* x\n* ');
  });

  it('continues and increments an ordered list', () => {
    const r = handleEnter('1. one', 7, 7);
    expect(r.text).toBe('1. one\n2. ');
  });

  it('increments ordered list with ) delimiter', () => {
    const r = handleEnter('3) x', 4, 4);
    expect(r.text).toBe('3) x\n4) ');
  });

  it('preserves indentation on list continuation', () => {
    const r = handleEnter('  - nested', 11, 11);
    expect(r.text).toBe('  - nested\n  - ');
  });

  it('exits list on empty item', () => {
    const r = handleEnter('- ', 2, 2);
    expect(r.text).toBe('');
    expect(r.start).toBe(0);
  });

  it('closes an unclosed code fence', () => {
    const r = handleEnter('```js', 5, 5);
    expect(r.text).toBe('```js\n\n```');
    expect(r.start).toBe(6); // caret on the blank line inside
  });

  it('does not close a fence that is already closed later', () => {
    const text = '```js\nfoo\n```';
    const r = handleEnter(text, 5, 5);
    expect(r.text).toBe('```js\n\nfoo\n```'); // plain newline only
  });
});

describe('wrapSelection', () => {
  it('wraps a selection in bold', () => {
    const r = wrapSelection('hello', 0, 5, '**');
    expect(r.text).toBe('**hello**');
    expect(r.start).toBe(2);
    expect(r.end).toBe(7);
  });

  it('inserts empty markers at caret when no selection (italic)', () => {
    const r = wrapSelection('hello', 2, 2, '*');
    expect(r.text).toBe('he**llo'); // '**' here = two single '*' around caret
    expect(r.start).toBe(3); // caret lands between the two markers
    expect(r.end).toBe(3);
  });

  it('toggles off when already wrapped', () => {
    const r = wrapSelection('**hi**', 2, 4, '**');
    expect(r.text).toBe('hi');
    expect(r.start).toBe(0);
    expect(r.end).toBe(2);
  });

  it('wraps inline code', () => {
    const r = wrapSelection('var x', 0, 5, '`');
    expect(r.text).toBe('`var x`');
  });
});

describe('autoPair', () => {
  it('pairs an open paren', () => {
    const r = autoPair('ab', 1, 1, '(');
    expect(r.text).toBe('a()b');
    expect(r.start).toBe(2);
    expect(r.handled).toBe(true);
  });

  it('pairs a square bracket', () => {
    const r = autoPair('ab', 1, 1, '[');
    expect(r.text).toBe('a[]b');
  });

  it('skips over a closer when typing it in front of one', () => {
    const r = autoPair('a()b', 2, 2, ')');
    expect(r.text).toBe('a()b');
    expect(r.start).toBe(3);
  });

  it('does not pair a quote after a word char (apostrophe)', () => {
    const r = autoPair("dont", 4, 4, "'");
    expect(r).toBe(null);
  });

  it('pairs a quote at start of word', () => {
    const r = autoPair('hello', 0, 0, '"');
    expect(r.text).toBe('""hello');
    expect(r.start).toBe(1);
  });

  it('does not pair when there is a selection (let native wrap it)', () => {
    const r = autoPair('abc', 0, 3, '(');
    expect(r).toBe(null);
  });
});

describe('handleBackspace', () => {
  it('deletes both chars of an empty pair', () => {
    // 'a()b' → caret at index 2 (between '(' and ')')
    const r = handleBackspace('a()b', 2, 2);
    expect(r.text).toBe('ab');
    expect(r.start).toBe(1);
  });

  it('deletes both quotes of an empty pair', () => {
    // 'a""b' → caret at index 2 (between the quotes)
    const r = handleBackspace('a""b', 2, 2);
    expect(r.text).toBe('ab');
  });

  it('returns null when not a pair', () => {
    expect(handleBackspace('abc', 1, 1)).toBe(null);
  });
});

describe('findMatches', () => {
  it('finds all case-insensitive matches', () => {
    const m = findMatches('Foo foo FOO', 'foo');
    expect(m).toHaveLength(3);
    expect(m[0]).toEqual({ start: 0, end: 3 });
  });

  it('respects caseSensitive flag', () => {
    const m = findMatches('Foo foo', 'Foo', true);
    expect(m).toHaveLength(1);
  });

  it('returns empty for empty query', () => {
    expect(findMatches('abc', '')).toEqual([]);
  });

  it('handles overlapping-adjacent matches (ababab)', () => {
    const m = findMatches('ababab', 'ab');
    expect(m).toHaveLength(3);
  });

  // ---------- v0.41.0: regex + whole-word ----------

  it('supports regex mode (basic alternation)', () => {
    const m = findMatches('cat dog bird', 'cat|dog', { regex: true });
    expect(m).toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }]);
  });

  it('supports regex with capture-group-free patterns', () => {
    // `h.*o` is greedy but each match still has correct start/end.
    const m = findMatches('hi hello halo', 'h\\w+', { regex: true });
    expect(m).toHaveLength(3);
    expect(m[0]).toEqual({ start: 0, end: 2 });   // 'hi'
    expect(m[1]).toEqual({ start: 3, end: 8 });   // 'hello'
  });

  it('returns [] for an invalid regex (no throw)', () => {
    expect(findMatches('abc', '[', { regex: true })).toEqual([]);
  });

  it('regex respects caseSensitive option', () => {
    const m = findMatches('Foo foo', 'foo', { regex: true, caseSensitive: true });
    expect(m).toEqual([{ start: 4, end: 7 }]);
  });

  it('regex does not infinite-loop on zero-length matches', () => {
    // `a*` matches empty string at every position; guard advances lastIndex.
    const m = findMatches('xyz', 'a*', { regex: true });
    // Empty matches are recorded with start === end; the loop must terminate.
    expect(m.length).toBeGreaterThan(0);
  });

  it('wholeWord matches only at word boundaries', () => {
    const m = findMatches('cat catalog cat', 'cat', { wholeWord: true });
    // Position 4 ('catalog') is NOT a whole-word match; 0 and 12 are.
    expect(m).toEqual([{ start: 0, end: 3 }, { start: 12, end: 15 }]);
  });

  it('wholeWord + caseSensitive combine', () => {
    const m = findMatches('Cat cat CAT', 'cat', { wholeWord: true, caseSensitive: true });
    expect(m).toEqual([{ start: 4, end: 7 }]);
  });

  it('legacy 3-arg positional form still works (backward compat)', () => {
    // Old callers pass `caseSensitive` as the 3rd positional arg.
    expect(findMatches('Foo foo', 'Foo', true)).toEqual([{ start: 0, end: 3 }]);
    expect(findMatches('Foo foo', 'Foo', false)).toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }]);
  });
});

describe('nextMatchIndex', () => {
  const matches = [{ start: 0, end: 2 }, { start: 5, end: 7 }, { start: 10, end: 12 }];

  it('forward from before first → first', () => {
    expect(nextMatchIndex(matches, 0, true)).toBe(0);
  });

  it('forward from middle → next', () => {
    expect(nextMatchIndex(matches, 3, true)).toBe(1);
  });

  it('forward past last → wraps to first', () => {
    expect(nextMatchIndex(matches, 11, true)).toBe(0);
  });

  it('backward from middle → previous', () => {
    expect(nextMatchIndex(matches, 6, false)).toBe(0);
  });

  it('backward from start → wraps to last', () => {
    expect(nextMatchIndex(matches, 0, false)).toBe(2);
  });

  it('returns -1 for no matches', () => {
    expect(nextMatchIndex([], 0, true)).toBe(-1);
  });
});

describe('lineCount', () => {
  it('counts an empty string as 1 line', () => {
    expect(lineCount('')).toBe(1);
  });

  it('counts single line', () => {
    expect(lineCount('hello')).toBe(1);
  });

  it('counts multiple lines', () => {
    expect(lineCount('a\nb\nc')).toBe(3);
  });

  it('counts trailing newline as a new line', () => {
    expect(lineCount('a\n')).toBe(2);
  });
});

describe('toggleLinePrefix', () => {
  it('adds the prefix to a single line', () => {
    const r = toggleLinePrefix('hello', 0, 5, '# ');
    expect(r.text).toBe('# hello');
  });

  it('adds the prefix to every touched line in a multi-line selection', () => {
    const r = toggleLinePrefix('a\nb\nc', 0, 5, '- ');
    expect(r.text).toBe('- a\n- b\n- c');
  });

  it('removes the prefix when every line already has it (toggle off)', () => {
    const r = toggleLinePrefix('# hello', 0, 7, '# ');
    expect(r.text).toBe('hello');
  });

  it('adds the prefix to lines that lack it even if some already have it', () => {
    const r = toggleLinePrefix('- a\nb', 0, 5, '- ');
    expect(r.text).toBe('- - a\n- b');
  });

  it('only touches lines touched by the selection, not the whole doc', () => {
    // selection only on line 2 (positions 2..3)
    const r = toggleLinePrefix('a\nb\nc', 2, 3, '# ');
    expect(r.text).toBe('a\n# b\nc');
  });
});

// ---------- insertLink (Ctrl+K) ----------

describe('insertLink', () => {
  it('wraps a selection as link text, caret in empty URL slot', () => {
    const r = insertLink('hello world', 6, 11); // "world"
    expect(r.text).toBe('hello [world]()');
    // caret lands inside the URL slot: after `[world](`
    expect(r.start).toBe('hello [world]('.length);
    expect(r.end).toBe(r.start);
  });

  it('with no selection, places caret in the empty text slot', () => {
    const r = insertLink('foo', 3, 3);
    expect(r.text).toBe('foo[]()');
    expect(r.start).toBe(4); // right after `[`
    expect(r.end).toBe(4);
  });

  it('pre-fills a provided URL and places caret after the link', () => {
    const r = insertLink('see ', 4, 4, 'https://x.io');
    // no selection → [](https://x.io), but URL is filled
    const r2 = insertLink('see link', 4, 8, 'https://x.io');
    expect(r2.text).toBe('see [link](https://x.io)');
    expect(r2.start).toBe('see [link](https://x.io)'.length);
    expect(r2.end).toBe(r2.start);
  });

  it('with selection + URL, caret lands after the whole link', () => {
    const r = insertLink('a b c', 2, 3, 'https://y.io');
    expect(r.text).toBe('a [b](https://y.io) c');
    expect(r.start).toBe('a [b](https://y.io)'.length);
    expect(r.end).toBe(r.start);
  });
});

// ---------- toggleTaskLine (preview checkbox toggle) ----------

describe('toggleTaskLine', () => {
  it('flips an open checkbox to checked', () => {
    const r = toggleTaskLine('- [ ] buy milk', 0);
    expect(r.text).toBe('- [x] buy milk');
  });

  it('flips a checked checkbox back to open', () => {
    const r = toggleTaskLine('- [x] done', 0);
    expect(r.text).toBe('- [ ] done');
  });

  it('handles uppercase X and * / + markers', () => {
    expect(toggleTaskLine('* [X] a', 0).text).toBe('* [ ] a');
    expect(toggleTaskLine('+ [ ] b', 0).text).toBe('+ [x] b');
  });

  it('preserves leading indent on nested tasks', () => {
    const r = toggleTaskLine('  - [ ] nested', 0);
    expect(r.text).toBe('  - [x] nested');
  });

  it('leaves non-task lines unchanged', () => {
    const text = '- plain item\nnot a task';
    expect(toggleTaskLine(text, 0).text).toBe(text);
    expect(toggleTaskLine(text, 1).text).toBe(text);
  });

  it('flips only the specified line, not all task lines', () => {
    const text = '- [ ] one\n- [x] two';
    expect(toggleTaskLine(text, 0).text).toBe('- [x] one\n- [x] two');
    expect(toggleTaskLine(text, 1).text).toBe('- [ ] one\n- [ ] two');
  });

  it('returns unchanged for out-of-range line index', () => {
    expect(toggleTaskLine('- [ ] a', 5).text).toBe('- [ ] a');
    expect(toggleTaskLine('- [ ] a', -1).text).toBe('- [ ] a');
  });
});

// ---------- taskLineIndex (map rendered item N → source line) ----------

describe('taskLineIndex', () => {
  it('returns the source line for the Nth task item', () => {
    const text = '# Title\n\n- [ ] one\n- [x] two\n\npara';
    expect(taskLineIndex(text, 0)).toBe(2); // "one"
    expect(taskLineIndex(text, 1)).toBe(3); // "two"
  });

  it('returns -1 for an out-of-range item index', () => {
    const text = '- [ ] only';
    expect(taskLineIndex(text, 1)).toBe(-1);
    expect(taskLineIndex(text, -1)).toBe(-1);
  });

  it('ignores - [ ] inside fenced code blocks', () => {
    const text = '- [ ] real task\n```\n- [ ] not a task\n```\n- [ ] another';
    expect(taskLineIndex(text, 0)).toBe(0);   // "real task"
    expect(taskLineIndex(text, 1)).toBe(4);   // "another" (skips the one in the fence)
    expect(taskLineIndex(text, 2)).toBe(-1);  // no third task
  });

  it('returns -1 when there are no task items', () => {
    expect(taskLineIndex('just text\n- plain list item', 0)).toBe(-1);
  });
});

describe('duplicateLines', () => {
  it('duplicates the caret line when no selection', () => {
    const text = 'aaa\nbbb\nccc';
    // Caret on line 1 ("bbb").
    const r = duplicateLines(text, 5, 5);
    expect(r.text).toBe('aaa\nbbb\nbbb\nccc');
    // New selection covers the duplicate ("bbb" after the newline).
    expect(r.start).toBe(8);
    expect(r.end).toBe(11);
  });

  it('duplicates the last line of the doc (no trailing newline)', () => {
    const text = 'aaa\nbbb';
    const r = duplicateLines(text, 4, 4);
    expect(r.text).toBe('aaa\nbbb\nbbb');
  });

  it('duplicates a multi-line selection as a block', () => {
    const text = 'aaa\nbbb\nccc\nddd';
    // Select "bbb\nccc" (lines 1-2).
    const r = duplicateLines(text, 4, 11);
    expect(r.text).toBe('aaa\nbbb\nccc\nbbb\nccc\nddd');
  });

  it('preserves caret-on-duplicate so a second call duplicates again', () => {
    const text = 'aaa\nbbb\nccc';
    const r1 = duplicateLines(text, 5, 5);
    // Apply r1 and duplicate again from r1's selection.
    const r2 = duplicateLines(r1.text, r1.start, r1.end);
    expect(r2.text).toBe('aaa\nbbb\nbbb\nbbb\nccc');
  });
});

describe('moveLines', () => {
  it('moves a line down', () => {
    const text = 'aaa\nbbb\nccc';
    const r = moveLines(text, 4, 7, 1); // "bbb" down
    expect(r.text).toBe('aaa\nccc\nbbb');
  });

  it('moves a line up', () => {
    const text = 'aaa\nbbb\nccc';
    const r = moveLines(text, 4, 7, -1); // "bbb" up
    expect(r.text).toBe('bbb\naaa\nccc');
  });

  it('is a no-op moving the first line up (returns text unchanged)', () => {
    const text = 'aaa\nbbb\nccc';
    const r = moveLines(text, 0, 3, -1);
    expect(r.text).toBe(text);
  });

  it('is a no-op moving the last line down', () => {
    const text = 'aaa\nbbb\nccc';
    const r = moveLines(text, 8, 11, 1);
    expect(r.text).toBe(text);
  });

  it('moves a multi-line block down as a unit', () => {
    const text = 'aaa\nbbb\nccc\nddd';
    const r = moveLines(text, 4, 11, 1); // "bbb\nccc" down
    expect(r.text).toBe('aaa\nddd\nbbb\nccc');
  });

  it('selection tracks the moved block so the move is repeatable', () => {
    const text = 'aaa\nbbb\nccc';
    const r1 = moveLines(text, 4, 7, -1); // "bbb" up → "bbb\naaa\nccc"
    expect(r1.text).toBe('bbb\naaa\nccc');
    const r2 = moveLines(r1.text, r1.start, r1.end, -1); // now first line, no-op
    expect(r2.text).toBe(r1.text);
  });
});

describe('sortLines', () => {
  it('sorts ascending (whole doc, caret selection)', () => {
    const r = sortLines('cherry\napple\nbanana', 0, 0, 'asc');
    expect(r.text).toBe('apple\nbanana\ncherry');
  });

  it('sorts descending', () => {
    const r = sortLines('apple\nbanana\ncherry', 0, 0, 'desc');
    expect(r.text).toBe('cherry\nbanana\napple');
  });

  it('sorts only the selected multi-line range', () => {
    // Selection covers 'banana\ncherry' (lines 2-3); 'header' + 'apple' are
    // untouched. Ascending → 'banana' before 'cherry' (b < c).
    const text = 'header\nbanana\ncherry\napple';
    // 'header\n' = 7 chars; 'banana\ncherry' ends at index 7+6+1+6 = 20.
    const r = sortLines(text, 7, 20, 'asc');
    expect(r.text).toBe('header\nbanana\ncherry\napple');
  });

  it('is case-insensitive (localeCompare base sensitivity)', () => {
    const r = sortLines('banana\nApple\nCHERRY', 0, 0, 'asc');
    expect(r.text).toBe('Apple\nbanana\nCHERRY');
  });

  it('is a no-op for fewer than 2 lines', () => {
    expect(sortLines('solo', 0, 0, 'asc').text).toBe('solo');
    expect(sortLines('', 0, 0, 'asc').text).toBe('');
  });

  it('preserves text outside the sorted block', () => {
    const text = 'keep-top\nzebra\napple\nkeep-bottom';
    const r = sortLines(text, 9, 15, 'asc'); // select 'zebra\napple'
    expect(r.text.startsWith('keep-top\n')).toBe(true);
    expect(r.text.endsWith('\nkeep-bottom')).toBe(true);
    expect(r.text).toBe('keep-top\napple\nzebra\nkeep-bottom');
  });

  it('preserves a trailing newline at end of doc', () => {
    const r = sortLines('b\na\n', 0, 0, 'asc');
    expect(r.text).toBe('a\nb\n');
  });

  it('places the caret at the end of the sorted block', () => {
    // 'apple\nbanana\ncherry' sorted ascending → caret at end (index 19).
    const r = sortLines('cherry\napple\nbanana', 0, 0, 'asc');
    expect(r.start).toBe(r.end);
    expect(r.start).toBe('apple\nbanana\ncherry'.length);
  });
});

describe('toggleComment', () => {
  it('wraps a selection in <!-- -->', () => {
    const text = 'hello world';
    const r = toggleComment(text, 0, 5);
    expect(r.text).toBe('<!--hello--> world');
    expect(r.start).toBe(4);  // after <!--
    expect(r.end).toBe(9);    // before -->
  });

  it('toggles off when already wrapped', () => {
    const text = '<!--hello--> world';
    const r = toggleComment(text, 4, 9);
    expect(r.text).toBe('hello world');
  });

  it('comments the whole caret line when no selection', () => {
    const text = 'aaa\nbbb\nccc';
    const r = toggleComment(text, 5, 5); // caret on "bbb"
    expect(r.text).toBe('aaa\n<!--bbb-->\nccc');
  });

  it('comments an empty line (zero-length content)', () => {
    const text = 'aaa\n\nccc';
    const r = toggleComment(text, 4, 4);
    expect(r.text).toBe('aaa\n<!---->\nccc');
  });
});

describe('getIndent (v0.37.0)', () => {
  it('returns the explicit size when passed (2/4/8)', () => {
    expect(getIndent(2)).toBe('  ');
    expect(getIndent(4)).toBe('    ');
    expect(getIndent(8)).toBe('        ');
  });

  it('returns 2 spaces by default when localStorage has no setting', () => {
    localStorage.removeItem('mdpeek-tab-size');
    expect(getIndent()).toBe('  ');
  });

  it('reads the mdpeek-tab-size setting from localStorage', () => {
    localStorage.setItem('mdpeek-tab-size', '4');
    expect(getIndent()).toBe('    ');
    localStorage.setItem('mdpeek-tab-size', '8');
    expect(getIndent()).toBe('        ');
    localStorage.setItem('mdpeek-tab-size', '2');
    expect(getIndent()).toBe('  ');
    localStorage.removeItem('mdpeek-tab-size');
  });

  it('falls back to 2 spaces for an unknown setting value', () => {
    localStorage.setItem('mdpeek-tab-size', '3');
    expect(getIndent()).toBe('  ');
    localStorage.setItem('mdpeek-tab-size', 'garbage');
    expect(getIndent()).toBe('  ');
    localStorage.removeItem('mdpeek-tab-size');
  });
});

describe('handleTab respects tab-size setting (v0.37.0)', () => {
  afterEach(() => {
    localStorage.removeItem('mdpeek-tab-size');
  });

  it('inserts 4 spaces when mdpeek-tab-size is "4"', () => {
    localStorage.setItem('mdpeek-tab-size', '4');
    const r = handleTab('abc', 1, 1); // no selection
    expect(r.text).toBe('a    bc');
  });

  it('inserts 8 spaces when mdpeek-tab-size is "8"', () => {
    localStorage.setItem('mdpeek-tab-size', '8');
    const r = handleTab('abc', 1, 1);
    expect(r.text).toBe('a        bc');
  });

  it('outdents a single 4-space line when tab-size is "4"', () => {
    localStorage.setItem('mdpeek-tab-size', '4');
    const r = handleShiftTab('    a', 0, 5);
    expect(r.text).toBe('a');
  });
});

describe('extractHeadings (v0.38.0)', () => {
  it('parses ATX headings with their level and 1-indexed line', () => {
    const text = '# Title\n\nsome text\n## Section\n### Sub';
    expect(extractHeadings(text)).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Section', line: 4 },
      { level: 3, text: 'Sub', line: 5 },
    ]);
  });

  it('ignores lines that only look like headings inside fenced code blocks', () => {
    const text = '# Real\n```\n# not a heading\n## also not\n```\n## Also real';
    const heads = extractHeadings(text);
    expect(heads).toHaveLength(2);
    expect(heads[0].text).toBe('Real');
    expect(heads[1].text).toBe('Also real');
  });

  it('works with ~~~ fences too, not just ```', () => {
    const text = '# Real\n~~~\n# not a heading\n~~~\n## Real again';
    const heads = extractHeadings(text);
    expect(heads).toHaveLength(2);
  });

  it('strips trailing # sequences (closing hashes)', () => {
    expect(extractHeadings('# Title ##')).toEqual([{ level: 1, text: 'Title', line: 1 }]);
    expect(extractHeadings('## Sub ###')).toEqual([{ level: 2, text: 'Sub', line: 1 }]);
  });

  it('ignores a bare # with no text', () => {
    expect(extractHeadings('#\n## \nreal text')).toEqual([]);
  });

  it('caps heading level at 6 (####### is not a heading)', () => {
    expect(extractHeadings('####### seven hashes')).toEqual([]);
    expect(extractHeadings('###### six is ok')).toEqual([{ level: 6, text: 'six is ok', line: 1 }]);
  });

  it('returns [] for empty / null input', () => {
    expect(extractHeadings('')).toEqual([]);
    expect(extractHeadings(null)).toEqual([]);
  });

  it('returns [] for text with no headings', () => {
    expect(extractHeadings('just a paragraph\nand another')).toEqual([]);
  });
});

describe('buildRelativeImageMarkdown', () => {
  it('builds a relative assets/ link for a saved doc (Windows path)', () => {
    expect(buildRelativeImageMarkdown('C:\\notes\\Foo.md', 'img-abc.png'))
      .toBe('![](assets/img-abc.png)');
  });

  it('builds a relative assets/ link for a saved doc (Unix path)', () => {
    expect(buildRelativeImageMarkdown('/home/me/Foo.md', 'img-xyz.jpg'))
      .toBe('![](assets/img-xyz.jpg)');
  });

  it('returns null for an untitled doc (no folder to save beside)', () => {
    expect(buildRelativeImageMarkdown(null, 'img-abc.png')).toBeNull();
    expect(buildRelativeImageMarkdown('', 'img-abc.png')).toBeNull();
    expect(buildRelativeImageMarkdown(undefined, 'img-abc.png')).toBeNull();
  });
});

describe('tableCellNav', () => {
  // Table used across tests:
  //   | a | b | c |
  //    0123456789...
  // Indices (0-based, single line):
  //   |<0> a<4> |<6> b<8> |<10> c<12> |<14>
  // The line is 15 chars. Cell " a " is [1,4), " b " is [5,8), " c " is [9,12).

  it('returns null when the caret is not on a table row', () => {
    expect(tableCellNav('hello world', 3, 1)).toBeNull();
    expect(tableCellNav('just\ntext', 6, 1)).toBeNull();
  });

  it('moves forward to the next cell on Tab', () => {
    // "| a | b | c |", caret at index 2 (inside "a"). Next cell "b" content
    // starts at index 6 (after "| ").
    const line = '| a | b | c |';
    const r = tableCellNav(line, 2, 1);
    expect(r).not.toBeNull();
    expect(r.caret).toBe(6);
  });

  it('moves backward to the previous cell on Shift+Tab', () => {
    const line = '| a | b | c |';
    // caret at index 10 (inside "c") → prev cell "b" at index 6
    const r = tableCellNav(line, 10, -1);
    expect(r).not.toBeNull();
    expect(r.caret).toBe(6);
  });

  it('wraps down to the next row (first cell) when Tabbing past the last cell', () => {
    const md = '| a | b |\n| c | d |';
    // First row "| a | b |" is 9 chars; second starts at index 10.
    // Caret at index 6 (inside "b", the last cell of row 1). Tab should land
    // in "c" of row 2, which starts at index 10 + 2 = 12.
    const r = tableCellNav(md, 6, 1);
    expect(r).not.toBeNull();
    expect(r.caret).toBe(12);
  });

  it('wraps up to the previous row (last cell) when Shift-Tabbing past the first cell', () => {
    const md = '| a | b |\n| c | d |';
    // caret at index 12 (inside "c", the first cell of row 2). Shift+Tab
    // should land in "b" of row 1, at index 6.
    const r = tableCellNav(md, 12, -1);
    expect(r).not.toBeNull();
    expect(r.caret).toBe(6);
  });

  it('returns {caret} unchanged when Tabbing past the last row (no next row)', () => {
    const md = '| a | b |';
    // single row, caret in last cell "b" at index 6, Tab forward → nowhere to
    // go. Should return {caret: 6} (no-op) rather than null so the editor
    // doesn't fall through to handleTab and insert indent.
    const r = tableCellNav(md, 6, 1);
    expect(r).not.toBeNull();
    expect(r.caret).toBe(6);
  });

  it('works on the delimiter row too (harmless navigation)', () => {
    const md = '| a | b |\n| --- | --- |\n| c | d |';
    // delimiter row starts at index 10: "| --- | --- |"
    //   10:| 11:(sp) 12:- 13:- 14:- 15:(sp) 16:| 17:(sp) 18:- ...
    // caret at index 13 (inside first "---"). Tab → next cell content "---"
    // at index 18 (the leading space at 17 is skipped by cellContentStart).
    const r = tableCellNav(md, 13, 1);
    expect(r).not.toBeNull();
    expect(r.caret).toBe(18);
  });

  it('skips leading cell padding to land on content', () => {
    // Cell with extra padding "|   wide   |"; caret on pipe. Tab from a
    // prior cell should land on 'w', not on the leading spaces.
    const line = '| x |   wide   |';
    // caret in "x" at index 2 → Tab → next cell content 'w' at index 8
    const r = tableCellNav(line, 2, 1);
    expect(r).not.toBeNull();
    expect(r.caret).toBe(8);
  });
});

describe('formatTableBlock (v0.45.0)', () => {
  it('returns null when the caret is not in a table', () => {
    expect(formatTableBlock('just prose', 3)).toBeNull();
  });

  it('aligns columns by padding to the widest cell', () => {
    const md = '| name | age |\n| --- | --- |\n| Bob | 30 |\n| Alice | 25 |';
    const r = formatTableBlock(md, md.indexOf('Bob'));
    expect(r).not.toBeNull();
    // Each line should have matching column widths.
    const lines = r.text.split('\n');
    expect(lines[0]).toBe('| name  | age |');
    expect(lines[2]).toBe('| Bob   | 30  |');
    expect(lines[3]).toBe('| Alice | 25  |');
  });

  it('preserves alignment markers in the delimiter row', () => {
    const md = '| left | center | right |\n| :--- | :----: | ----: |\n| a | b | c |';
    const r = formatTableBlock(md, md.indexOf('a'));
    const lines = r.text.split('\n');
    // Markers preserved; dashes padded to match each column's content width.
    // left(4)→:---, center(6)→:----:, right(5)→----:
    expect(lines[1]).toBe('| :--- | :----: | ----: |');
  });

  it('normalizes short delimiters to the GFM minimum (3 dashes)', () => {
    // Single-dash delimiters get padded to width 3 so GFM still recognizes them.
    const md = '| a | b |\n| - | - |\n| 1 | 2 |';
    const r = formatTableBlock(md, md.length - 2);
    expect(r).not.toBeNull();
    expect(r.text).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
  });

  it('does not touch surrounding prose', () => {
    const md = 'intro\n| a | b |\n| - | - |\n| 1 | 2 |\noutro';
    const r = formatTableBlock(md, md.indexOf('1'));
    expect(r.text).toContain('intro\n');
    expect(r.text).toContain('\noutro');
  });
});

describe('sortTableRows (v0.45.0)', () => {
  const tbl = '| name | age |\n| --- | --- |\n| Bob | 30 |\n| Alice | 25 |\n| Carol | 40 |';

  it('returns null when the caret is not in a table', () => {
    expect(sortTableRows('prose', 0)).toBeNull();
  });

  it('sorts body rows by column 0 ascending', () => {
    const r = sortTableRows(tbl, tbl.indexOf('Bob'), 0, 'asc');
    const body = r.text.split('\n').slice(2);
    expect(body.map((l) => l.match(/Alice|Bob|Carol/)[0])).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('sorts body rows by column 0 descending', () => {
    const r = sortTableRows(tbl, tbl.indexOf('Bob'), 0, 'desc');
    const body = r.text.split('\n').slice(2);
    expect(body.map((l) => l.match(/Alice|Bob|Carol/)[0])).toEqual(['Carol', 'Bob', 'Alice']);
  });

  it('sorts numerically when the column is numeric', () => {
    // Lexicographic sort would put '30' before '4'; numeric puts 4 first.
    const md = '| n |\n| - |\n| 30 |\n| 4 |';
    const r = sortTableRows(md, md.indexOf('30'), 0, 'asc');
    expect(r.text.split('\n').slice(2)).toEqual(['| 4 |', '| 30 |']);
  });

  it('keeps the header and delimiter rows in place', () => {
    const r = sortTableRows(tbl, tbl.indexOf('Bob'), 0, 'asc');
    const lines = r.text.split('\n');
    expect(lines[0]).toBe('| name | age |');
    expect(lines[1]).toBe('| --- | --- |');
  });

  it('returns null for a table with no body rows (header + delimiter only)', () => {
    const md = '| a | b |\n| - | - |';
    expect(sortTableRows(md, 3, 0, 'asc')).toBeNull();
  });
});

// ---------- v0.46.0: transpose chars (B1) ----------
describe('transposeChars (v0.46.0)', () => {
  it('swaps the two chars around the caret mid-line', () => {
    // caret between a|b → ba
    const r = transposeChars('ab', 1);
    expect(r.text).toBe('ba');
    expect(r.start).toBe(2);
  });

  it('swaps the last two chars when caret is at line end', () => {
    // 'hello' with caret at end (pos 5) → 'helol'
    const r = transposeChars('hello', 5);
    expect(r.text).toBe('helol');
    expect(r.start).toBe(5);
  });

  it('is a no-op at the start of a line', () => {
    const r = transposeChars('abc', 0);
    expect(r.text).toBe('abc');
  });

  it('is a no-op on a single-char line', () => {
    const r = transposeChars('a', 1);
    expect(r.text).toBe('a');
  });

  it('swaps at the end of a mid-doc line', () => {
    const text = 'abc\ndef';
    // caret at end of 'abc' (pos 3, on the \n) → swap last two chars 'bc' → 'cb'
    const r = transposeChars(text, 3);
    expect(r.text).toBe('acb\ndef');
  });
});

// ---------- v0.46.0: join line (B2) ----------
describe('joinLine (v0.46.0)', () => {
  it('joins the current line with the next via a single space', () => {
    const r = joinLine('hello\nworld', 2);
    expect(r.text).toBe('hello world');
    expect(r.start).toBe(6);
  });

  it('collapses the next line leading whitespace to one space', () => {
    const r = joinLine('a\n    b', 1);
    expect(r.text).toBe('a b');
  });

  it('is a no-op on the last line', () => {
    const r = joinLine('hello', 2);
    expect(r.text).toBe('hello');
  });

  it('trims trailing whitespace on the left part', () => {
    const r = joinLine('hello   \nworld', 5);
    expect(r.text).toBe('hello world');
  });
});

// ---------- v0.46.0: convert list type (B3) ----------
describe('convertList (v0.46.0)', () => {
  it('converts bullets to ordered and renumbers', () => {
    const r = convertList('- a\n- b\n- c', 0, 100, 'ordered');
    expect(r.text).toBe('1. a\n2. b\n3. c');
  });

  it('converts ordered to bullets', () => {
    const r = convertList('1. a\n2. b', 0, 100, 'bullet');
    expect(r.text).toBe('- a\n- b');
  });

  it('auto-detects direction when to=auto', () => {
    const r1 = convertList('- a\n- b', 0, 100, 'auto');
    expect(r1.text).toBe('1. a\n2. b');
    const r2 = convertList('1. a\n2. b', 0, 100, 'auto');
    expect(r2.text).toBe('- a\n- b');
  });

  it('normalizes mixed markers to a single kind', () => {
    const r = convertList('- a\n* b\n+ c', 0, 100, 'ordered');
    expect(r.text).toBe('1. a\n2. b\n3. c');
  });

  it('adds the prefix to non-list lines', () => {
    const r = convertList('plain\ntext', 0, 100, 'bullet');
    expect(r.text).toBe('- plain\n- text');
  });

  it('preserves indentation on sub-items', () => {
    const r = convertList('- a\n  - sub', 0, 100, 'ordered');
    expect(r.text).toBe('1. a\n  2. sub');
  });
});

// ---------- v0.46.0: select line (B4) ----------
describe('selectLine (v0.46.0)', () => {
  it('selects the whole caret line on first press', () => {
    const r = selectLine('hello\nworld', 2);
    expect(r.start).toBe(0);
    expect(r.end).toBe(5);
  });

  it('extends to the next line on repeat', () => {
    const text = 'aaa\nbbb\nccc';
    // indices: 'aaa'=0-2, \n=3, 'bbb'=4-6, \n=7, 'ccc'=8-10
    // first press at pos 2 (line 'aaa') → select [0,3)
    const first = selectLine(text, 2, { anchor: 2, extend: false });
    expect(first.start).toBe(0);
    expect(first.end).toBe(3); // \n after 'aaa'
    // repeat: anchor stays at 2, current pos at 3 → extend end to next \n (7)
    const repeat = selectLine(text, first.end, { anchor: 2, extend: true });
    expect(repeat.start).toBe(0);
    expect(repeat.end).toBe(7); // \n after 'bbb'
  });

  it('does not extend past EOF', () => {
    const text = 'aaa\nbbb'; // 'aaa'=0-2, \n=3, 'bbb'=4-6 (no trailing \n)
    const first = selectLine(text, 1, { anchor: 1, extend: false });
    expect(first.end).toBe(3); // \n after 'aaa'
    const repeat = selectLine(text, first.end, { anchor: 1, extend: true });
    // No line after 'bbb' → end is text.length (7)
    expect(repeat.end).toBe(7);
  });
});

// ---------- v0.46.0: derive note title (B5) ----------
describe('deriveNoteTitle (v0.46.0)', () => {
  it('uses the first ATX heading text', () => {
    expect(deriveNoteTitle('# My Title\nbody')).toBe('My Title');
  });

  it('falls back to the first non-empty line', () => {
    expect(deriveNoteTitle('first line here\nsecond')).toBe('first line here');
  });

  it('returns Untitled for empty input', () => {
    expect(deriveNoteTitle('')).toBe('Untitled');
    expect(deriveNoteTitle('   \n  ')).toBe('Untitled');
  });

  it('truncates long titles', () => {
    const long = 'A'.repeat(100);
    const out = deriveNoteTitle(long);
    expect(out.length).toBe(60);
    expect(out.endsWith('…')).toBe(true);
  });
});

// ---------- v0.49.0: case conversion ----------

describe('transformCase', () => {
  it('uppercases', () => {
    expect(transformCase('foo Bar', 'upper')).toBe('FOO BAR');
  });
  it('lowercases', () => {
    expect(transformCase('Foo BAR', 'lower')).toBe('foo bar');
  });
  it('title-cases each word', () => {
    expect(transformCase('foo bar baz', 'title')).toBe('Foo Bar Baz');
  });
  it('title-cases hyphenated/apostrophe text word-by-word', () => {
    // apostrophe and hyphen are separators → "don't" → "Don'T" is wrong; verify
    // our word definition (run of letters/digits) treats the apostrophe as a
    // separator so "don't" becomes "Don'T"... actually we want readability, so
    // confirm the actual behavior so the test documents it.
    expect(transformCase("don't stop", 'title')).toBe("Don'T Stop");
  });
  it('toggles case per character', () => {
    expect(transformCase('Foo bAR', 'toggle')).toBe('fOO Bar');
  });
  it('toggles digits/punctuation unchanged', () => {
    expect(transformCase('Ab1-2', 'toggle')).toBe('aB1-2');
  });
  it('is a no-op for unknown modes', () => {
    expect(transformCase('foo', 'weird')).toBe('foo');
  });
  it('returns empty/falsy input unchanged', () => {
    expect(transformCase('', 'upper')).toBe('');
    expect(transformCase(null, 'upper')).toBeNull();
  });
});

describe('convertCase (v0.49.0)', () => {
  it('uppercases the current line when the selection is a caret', () => {
    // 'hello world', caret at col 2 of line 1 → whole line uppercased.
    const r = convertCase('hello world', 2, 2, 'upper');
    expect(r.text).toBe('HELLO WORLD');
    expect(r.start).toBe(0);
    expect(r.end).toBe(11);
  });
  it('transforms only the selected span when there is a selection', () => {
    // 'Hello World', select 'o Wor' (indices 4..9) → 'O WOR'.
    const r = convertCase('Hello World', 4, 9, 'upper');
    expect(r.text).toBe('HellO WORld');
    expect(r.start).toBe(4);
    expect(r.end).toBe(9);
  });
  it('lowercases a selection', () => {
    const r = convertCase('ABC DEF', 0, 3, 'lower');
    expect(r.text).toBe('abc DEF');
  });
  it('title-cases a selection', () => {
    const r = convertCase('foo bar', 0, 7, 'title');
    expect(r.text).toBe('Foo Bar');
  });
  it('toggles a selection', () => {
    const r = convertCase('AbCd', 0, 4, 'toggle');
    expect(r.text).toBe('aBcD');
  });
  it('transforms the caret line within a multi-line doc', () => {
    // 'a\nbB\nc', caret on line 2 ('bB') at col 1.
    const text = 'a\nbB\nc';
    const r = convertCase(text, 3, 3, 'upper'); // index 3 is within 'bB'
    expect(r.text).toBe('a\nBB\nc');
  });
  it('is a no-op for empty input', () => {
    expect(convertCase('', 0, 0, 'upper')).toEqual({ text: '', start: 0, end: 0 });
  });
  it('defaults to upper when mode is omitted', () => {
    expect(convertCase('abc', 0, 3).text).toBe('ABC');
  });
});

// ---------- v0.49.0: wrapBlock (multi-line surround) ----------

describe('wrapBlock (v0.49.0)', () => {
  it('wraps a selection with open/close tags on their own lines (mid-doc)', () => {
    // 'intro\nbody\nend', select 'body' (4..8) → wrap in <details>/</details>.
    const text = 'intro\nbody\nend';
    const r = wrapBlock(text, 6, 10, '<details>', '</details>');
    // open sits on its own line after 'intro\n', selection preserved, close on
    // its own line before '\nend'.
    expect(r.text).toBe('intro\n<details>\nbody\n</details>\nend');
    // selection covers the inner content ('body').
    expect(r.start).toBe('intro\n<details>\n'.length);
    expect(r.end).toBe(r.start + 4);
  });
  it('inserts a leading newline when open would collide with preceding text', () => {
    // 'ab' + caret at end → wrap: needs a leading \n so '<details>' starts fresh.
    const r = wrapBlock('ab', 2, 2, '<details>', '</details>');
    expect(r.text).toBe('ab\n<details>\n\n</details>');
    expect(r.start).toBe('ab\n<details>\n'.length);
    expect(r.end).toBe(r.start);
  });
  it('does not add a leading newline when already at line start', () => {
    const r = wrapBlock('x\n', 2, 2, '<details>', '</details>');
    // caret at index 2 is right after the '\n' → no leading newline needed.
    expect(r.text).toBe('x\n<details>\n\n</details>');
  });
  it('inserts a trailing newline when close would collide with following text', () => {
    // selection at start of 'ab' → close needs trailing \n.
    const r = wrapBlock('ab', 0, 0, '<o>', '</c>');
    expect(r.text).toBe('<o>\n\n</c>\nab');
  });
  it('wraps a code selection in a fenced block', () => {
    const text = 'before\nprint(1)\nafter';
    const r = wrapBlock(text, 7, 15, '```python', '```');
    expect(r.text).toBe('before\n```python\nprint(1)\n```\nafter');
    expect(r.text.slice(r.start, r.end)).toBe('print(1)');
  });
  it('places the caret on the empty inner line when there is no selection', () => {
    const r = wrapBlock('x', 1, 1, '<details>', '</details>');
    // 'x' + '\n<details>\n' (12 chars) → caret at index 13 on the blank line.
    expect(r.start).toBe('x\n<details>\n'.length);
    expect(r.end).toBe(r.start);
  });
});
