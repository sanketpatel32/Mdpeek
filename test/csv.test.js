import { describe, it, expect } from 'vitest';
import { parseCsv, renderCsv } from '../src/lib/renderer.js';

describe('parseCsv', () => {
  it('parses a basic 2-row CSV', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles a trailing newline without creating an empty row', () => {
    expect(parseCsv('a,b\nc,d\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles quoted fields with embedded commas', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
    expect(parseCsv('"foo, bar, baz",x')).toEqual([['foo, bar, baz', 'x']]);
  });

  it('handles escaped quotes ("") inside a quoted field', () => {
    expect(parseCsv('"she said ""hi"""', false)).toEqual([['she said "hi"']]);
  });

  it('handles an embedded newline inside a quoted field', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']]);
  });

  it('treats CRLF the same as LF', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('parses a quoted field containing the delimiter literally', () => {
    expect(parseCsv('"1,000","2,000"')).toEqual([['1,000', '2,000']]);
  });

  it('parses TSV mode (tab delimiter)', () => {
    expect(parseCsv('a\tb\nc\td', true)).toEqual([['a', 'b'], ['c', 'd']]);
    // A comma inside a TSV row is literal, not a delimiter.
    expect(parseCsv('a,b\tc', true)).toEqual([['a,b', 'c']]);
  });

  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv(null)).toEqual([]);
    expect(parseCsv(undefined)).toEqual([]);
  });

  it('preserves empty fields', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
    expect(parseCsv('a,"",c')).toEqual([['a', '', 'c']]);
  });

  it('handles a single row with no newline', () => {
    expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  it('preserves an empty line in the middle of a file', () => {
    const out = parseCsv('a,b\n\nc,d');
    expect(out).toEqual([['a', 'b'], [''], ['c', 'd']]);
  });
});

describe('renderCsv', () => {
  it('renders a table with a header row and body rows', () => {
    const html = renderCsv('name,age\nAlice,30\nBob,25');
    expect(html).toContain('<table');
    expect(html).toContain('<thead>');
    expect(html).toContain('<th');
    expect(html).toContain('name');
    expect(html).toContain('Alice');
    expect(html).toContain('Bob');
  });

  it('includes a filter input in the toolbar', () => {
    const html = renderCsv('a,b\n1,2');
    expect(html).toContain('class="csv-filter"');
    expect(html).toContain('type="search"');
  });

  it('shows the row count in the toolbar', () => {
    const html = renderCsv('h1,h2\n1,2\n3,4\n5,6');
    expect(html).toContain('3 rows');
  });

  it('renders column headers with sort affordance', () => {
    const html = renderCsv('name,age\nAlice,30');
    expect(html).toContain('data-sort-type');
    expect(html).toContain('sort-ind');
  });

  it('marks numeric columns as numeric sort type', () => {
    // age column has all numeric values → numeric
    const html = renderCsv('name,age\nAlice,30\nBob,25');
    // <thead> contains the substring "<th", so the split array is:
    // [0]=before-thead, [1]="ead><tr>", [2]=name th, [3]=age th.
    const ths = html.split('<th');
    const nameTh = ths[2];
    const ageTh = ths[3];
    expect(nameTh).toContain('data-sort-type="string"');
    expect(ageTh).toContain('data-sort-type="number"');
  });

  it('right-aligns numeric cells via data-numeric', () => {
    const html = renderCsv('h\n42');
    expect(html).toContain('data-numeric="1"');
  });

  it('renders an empty-state message for empty input', () => {
    const html = renderCsv('');
    expect(html).toContain('csv-empty');
    expect(html).toContain('No rows');
  });

  it('sanitizes HTML in cell content', () => {
    const html = renderCsv('h\n<script>alert(1)</script>');
    // DOMPurify strips the script tag.
    expect(html).not.toContain('<script>');
  });

  it('escapes HTML special characters in cells', () => {
    const html = renderCsv('h\na < b & c > d');
    expect(html).not.toContain('a < b & c > d');
  });

  it('respects the tsv option', () => {
    // Without tsv: a comma in a cell splits the cell.
    const csvHtml = renderCsv('a,b\n1,2');
    expect(csvHtml).toContain('data-col="1"'); // two columns
    // With tsv: a comma is literal.
    const tsvHtml = renderCsv('a,b\tc\n1,2\t3', { tsv: true });
    // Header should have two columns: "a,b" and "c"
    expect(tsvHtml).toContain('a,b');
  });

  it('renders correctly with no body rows (header only)', () => {
    const html = renderCsv('col1,col2,col3');
    expect(html).toContain('<thead>');
    expect(html).toContain('0 rows');
  });
});
