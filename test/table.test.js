import { describe, it, expect } from 'vitest';
import {
  parseTable,
  emitTable,
  addRow,
  removeRow,
  moveRow,
  addColumn,
  removeColumn,
  moveColumn,
  setAlign,
  setCell,
} from '../src/lib/table.js';

// A minimal well-formed table with a header + delimiter + one body row. The
// caret position for these tests points somewhere inside it.
const SIMPLE = 'Intro line\n| Name | Age |\n| --- | --- |\n| Ada | 36 |\nTrailer line';

describe('parseTable', () => {
  it('returns null when the caret is not inside a table', () => {
    expect(parseTable('no table here', 3)).toBeNull();
  });

  it('accepts a header + delimiter with no body rows (0 body rows is valid GFM)', () => {
    const m = parseTable('| a |\n| --- |', 0);
    expect(m).not.toBeNull();
    expect(m.rows).toEqual([['a']]); // header only, no body
  });

  it('returns null for fewer than 2 rows', () => {
    expect(parseTable('| a | b |', 0)).toBeNull();
  });

  it('returns null when row 1 is not a delimiter row', () => {
    const t = '| Name |\n| Ada |';
    expect(parseTable(t, 5)).toBeNull();
  });

  it('parses a simple table into rows + null aligns', () => {
    const m = parseTable(SIMPLE, 18); // caret inside the table
    expect(m).not.toBeNull();
    expect(m.rows).toEqual([['Name', 'Age'], ['Ada', '36']]);
    expect(m.aligns).toEqual([null, null]);
  });

  it('records absolute block offsets', () => {
    const m = parseTable(SIMPLE, 18);
    // Block starts at the beginning of "| Name |" and ends at the end of "| Ada |".
    const block = SIMPLE.slice(m.startLine, m.endLine);
    expect(block.split('\n')).toEqual([
      '| Name | Age |',
      '| --- | --- |',
      '| Ada | 36 |',
    ]);
  });

  it('reads all four alignment kinds from the delimiter row', () => {
    const t = '| a | b | c | d |\n| :-- | --: | :-: | --- |\n| 1 | 2 | 3 | 4 |';
    const m = parseTable(t, 5);
    expect(m.aligns).toEqual(['left', 'right', 'center', null]);
  });

  it('trims surrounding whitespace in cells', () => {
    const t = '|   spaced   |\n| --- |\n|   x   |';
    const m = parseTable(t, 3);
    expect(m.rows).toEqual([['spaced'], ['x']]);
  });

  it('preserves escaped pipes as literal | in cells', () => {
    const t = '| a \\| b |\n| --- |\n| x |';
    const m = parseTable(t, 3);
    expect(m.rows).toEqual([['a \\| b'], ['x']]);
  });

  it('normalizes ragged rows to the widest column count', () => {
    const t = '| a | b | c |\n| --- | --- | --- |\n| only-one |';
    const m = parseTable(t, 3);
    expect(m.rows).toEqual([['a', 'b', 'c'], ['only-one', '', '']]);
  });

  it('returns null for non-table garbage', () => {
    expect(parseTable(null, 0)).toBeNull();
    expect(parseTable('text', null)).toBeNull();
  });
});

describe('emitTable', () => {
  it('emits a simple table', () => {
    const out = emitTable({ rows: [['Name', 'Age'], ['Ada', '36']], aligns: [null, null] });
    expect(out).toEqual('| Name | Age |\n| ---- | --- |\n| Ada  | 36  |');
  });

  it('emits alignment markers from aligns', () => {
    const out = emitTable({ rows: [['a', 'b', 'c']], aligns: ['left', 'right', 'center'] });
    const lines = out.split('\n');
    expect(lines[1]).toBe('| :-- | --: | :-: |');
  });

  it('keeps min 3 dashes in the delimiter even for short content', () => {
    const out = emitTable({ rows: [['x']], aligns: [null] });
    expect(out.split('\n')[1]).toBe('| --- |');
  });

  it('is deterministic (same model → same string)', () => {
    const model = { rows: [['A', 'B'], ['1', '2']], aligns: [null, null] };
    expect(emitTable(model)).toBe(emitTable(model));
  });

  it('round-trips a parsed table through emit with stable structure', () => {
    const m = parseTable(SIMPLE, 18);
    const emitted = emitTable(m);
    const reparsed = parseTable('x\n' + emitted + '\nx', 2);
    expect(reparsed.rows).toEqual(m.rows);
    expect(reparsed.aligns).toEqual(m.aligns);
  });

  it('emits escaped pipes literally', () => {
    const out = emitTable({ rows: [['a \\| b']], aligns: [null] });
    expect(out.split('\n')[0]).toBe('| a \\| b |');
  });
});

describe('ops — rows', () => {
  const base = { rows: [['H']], aligns: [null] };

  it('addRow appends a blank body row by default', () => {
    const m = addRow(base);
    expect(m.rows).toEqual([['H'], ['']]);
    // input not mutated
    expect(base.rows).toEqual([['H']]);
  });

  it('addRow inserts at the given body index', () => {
    const m = addRow({ rows: [['H'], ['a'], ['b']], aligns: [null] }, 1);
    expect(m.rows).toEqual([['H'], [''], ['a'], ['b']]);
  });

  it('removeRow removes a body row but not the header', () => {
    const m = removeRow({ rows: [['H'], ['a'], ['b']], aligns: [null] }, 2);
    expect(m.rows).toEqual([['H'], ['a']]);
  });

  it('removeRow is a no-op for the header index and out-of-range', () => {
    const rows = [['H'], ['a']];
    expect(removeRow({ rows, aligns: [null] }, 0).rows).toEqual([['H'], ['a']]);
    expect(removeRow({ rows, aligns: [null] }, 9).rows).toEqual([['H'], ['a']]);
  });

  it('moveRow moves a body row up/down and no-ops at edges', () => {
    const rows = [['H'], ['a'], ['b'], ['c']];
    expect(moveRow({ rows, aligns: [null] }, 2, -1).rows.map((r) => r[0])).toEqual(['H', 'b', 'a', 'c']);
    expect(moveRow({ rows, aligns: [null] }, 1, -1).rows.map((r) => r[0])).toEqual(['H', 'a', 'b', 'c']); // can't move above header
  });
});

describe('ops — columns', () => {
  it('addColumn appends a blank column by default', () => {
    const m = addColumn({ rows: [['a', 'b'], ['1', '2']], aligns: [null, null] });
    expect(m.aligns).toEqual([null, null, null]);
    expect(m.rows).toEqual([['a', 'b', ''], ['1', '2', '']]);
  });

  it('addColumn inserts at the given index', () => {
    const m = addColumn({ rows: [['a', 'b']], aligns: [null, null] }, 0);
    expect(m.rows).toEqual([['', 'a', 'b']]);
    expect(m.aligns).toEqual([null, null, null]);
  });

  it('removeColumn removes the column from aligns and every row', () => {
    const m = removeColumn({ rows: [['a', 'b'], ['1', '2']], aligns: [null, null] }, 1);
    expect(m.aligns).toEqual([null]);
    expect(m.rows).toEqual([['a'], ['1']]);
  });

  it('moveColumn swaps columns left/right and no-ops at edges', () => {
    const rows = [['a', 'b']];
    expect(moveColumn({ rows, aligns: [null, null] }, 1, -1).rows).toEqual([['b', 'a']]);
    expect(moveColumn({ rows, aligns: [null, null] }, 0, -1).rows).toEqual([['a', 'b']]);
  });
});

describe('ops — cell/align', () => {
  it('setAlign sets the column alignment', () => {
    const m = setAlign({ rows: [['a']], aligns: [null] }, 0, 'center');
    expect(m.aligns).toEqual(['center']);
  });

  it('setAlign is a no-op out of range', () => {
    const m = setAlign({ rows: [['a']], aligns: [null] }, 5, 'center');
    expect(m.aligns).toEqual([null]);
  });

  it('setCell updates one cell and does not mutate input', () => {
    const base = { rows: [['a', 'b'], ['1', '2']], aligns: [null, null] };
    const m = setCell(base, 0, 1, 'B!');
    expect(m.rows[0]).toEqual(['a', 'B!']);
    expect(base.rows[0]).toEqual(['a', 'b']);
  });

  it('setCell is a no-op for an out-of-range row', () => {
    const base = { rows: [['a']], aligns: [null] };
    expect(setCell(base, 9, 0, 'x').rows).toEqual([['a']]);
  });
});

describe('invariant through op round-trips', () => {
  it('add column + add row + set cell survives a parse→emit→parse cycle', () => {
    const start = parseTable(SIMPLE, 18);
    let m = addColumn(start); // new col
    m = addRow(m); // new row
    m = setCell(m, m.rows.length - 1, m.aligns.length - 1, 'corner');
    const emitted = emitTable(m);
    const reparsed = parseTable('x\n' + emitted + '\nx', 2);
    expect(reparsed.rows).toEqual(m.rows);
    expect(reparsed.aligns).toEqual(m.aligns);
  });
});
