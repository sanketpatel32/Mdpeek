import { describe, it, expect } from 'vitest';
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
