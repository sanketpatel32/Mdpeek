import { describe, it, expect } from 'vitest';
import { parseNotebook, joinSource, normalizeOutput, hljsLangFor } from '../src/lib/notebook.js';

// Build a minimal nbformat 4 notebook skeleton.
function nb4(cells, metadata = {}) {
  return JSON.stringify({
    cells,
    metadata,
    nbformat: 4,
    nbformat_minor: 5,
  });
}

describe('joinSource', () => {
  it('returns a bare string as-is', () => {
    expect(joinSource('hello')).toBe('hello');
  });
  it('joins a line-string array with no added separators (newlines are implicit)', () => {
    expect(joinSource(['print(1)\n', 'print(2)\n'])).toBe('print(1)\nprint(2)\n');
  });
  it('returns "" for undefined / odd shapes', () => {
    expect(joinSource(undefined)).toBe('');
    expect(joinSource(null)).toBe('');
    expect(joinSource(42)).toBe('');
    expect(joinSource([])).toBe('');
  });
});

describe('normalizeOutput', () => {
  it('returns null for non-objects', () => {
    expect(normalizeOutput(null)).toBeNull();
    expect(normalizeOutput('x')).toBeNull();
  });
  it('classifies a stream output', () => {
    expect(normalizeOutput({ output_type: 'stream', name: 'stdout', text: 'hi\n' }))
      .toEqual({ kind: 'stream', name: 'stdout', text: 'hi\n' });
  });
  it('defaults stream name to stdout', () => {
    expect(normalizeOutput({ output_type: 'stream', text: ['a', 'b'] }))
      .toEqual({ kind: 'stream', name: 'stdout', text: 'ab' });
  });
  it('classifies an execute_result with text/plain', () => {
    const o = normalizeOutput({ output_type: 'execute_result', execution_count: 3, data: { 'text/plain': '42' } });
    expect(o.kind).toBe('result');
    expect(o.text).toBe('42');
    expect(o.executionCount).toBe(3);
    expect(o.png).toBeNull();
  });
  it('classifies a display_data with a base64 png (newlines stripped)', () => {
    const o = normalizeOutput({ output_type: 'display_data', data: { 'image/png': 'aGVs\nbG8=' } });
    expect(o.kind).toBe('display');
    expect(o.png).toBe('aGVsbG8=');
  });
  it('classifies an error output', () => {
    const o = normalizeOutput({ output_type: 'error', ename: 'ValueError', evalue: 'bad', traceback: ['  File ...', 'ValueError: bad'] });
    expect(o.kind).toBe('error');
    expect(o.ename).toBe('ValueError');
    expect(o.evalue).toBe('bad');
    expect(o.traceback).toHaveLength(2);
  });
  it('drops unknown output_types', () => {
    expect(normalizeOutput({ output_type: 'weird' })).toBeNull();
  });
});

describe('hljsLangFor', () => {
  it('maps python3 → python', () => {
    expect(hljsLangFor('python3')).toBe('python');
  });
  it('maps C++ and C#', () => {
    expect(hljsLangFor('C++')).toBe('cpp');
    expect(hljsLangFor('c#')).toBe('csharp');
  });
  it('defaults unknown/empty to python', () => {
    expect(hljsLangFor('')).toBe('python');
    expect(hljsLangFor(undefined)).toBe('python');
  });
  it('passes through languages without an override', () => {
    expect(hljsLangFor('R')).toBe('r');
  });
});

describe('parseNotebook', () => {
  it('returns an error for empty input', () => {
    const r = parseNotebook('');
    expect(r.cells).toEqual([]);
    expect(r.error).toBeTruthy();
  });

  it('returns an error for invalid JSON', () => {
    const r = parseNotebook('{ not json');
    expect(r.cells).toEqual([]);
    expect(r.error).toMatch(/not valid JSON/);
  });

  it('returns an error when the top-level value is not a notebook object', () => {
    expect(parseNotebook(JSON.stringify([1, 2, 3])).error).toBeTruthy();
    expect(parseNotebook(JSON.stringify('a string')).error).toBeTruthy();
  });

  it('returns an error when there are no cells', () => {
    const r = parseNotebook(nb4([]));
    expect(r.cells).toEqual([]);
    expect(r.error).toMatch(/no cells|no renderable/);
  });

  it('parses an nbformat 4 notebook with mixed cell types', () => {
    const r = parseNotebook(nb4([
      { cell_type: 'markdown', source: '# Title' },
      { cell_type: 'code', source: ['print(1)\n', 'print(2)'], execution_count: 1, outputs: [] },
      { cell_type: 'raw', source: 'raw text' },
    ]));
    expect(r.error).toBeUndefined();
    expect(r.cells).toHaveLength(3);
    expect(r.cells[0]).toEqual({ type: 'markdown', source: '# Title' });
    expect(r.cells[1].type).toBe('code');
    expect(r.cells[1].source).toBe('print(1)\nprint(2)');
    expect(r.cells[1].language).toBe('python');
    expect(r.cells[1].execCount).toBe(1);
    expect(r.cells[2]).toEqual({ type: 'raw', source: 'raw text' });
  });

  it('normalizes code cell outputs', () => {
    const r = parseNotebook(nb4([
      {
        cell_type: 'code', source: 'x', execution_count: 2,
        outputs: [
          { output_type: 'stream', name: 'stdout', text: 'hello\n' },
          { output_type: 'execute_result', execution_count: 2, data: { 'text/plain': '5' } },
          { output_type: 'error', ename: 'Err', evalue: 'v', traceback: ['t'] },
        ],
      },
    ]));
    const code = r.cells[0];
    expect(code.outputs).toHaveLength(3);
    expect(code.outputs[0].kind).toBe('stream');
    expect(code.outputs[1].kind).toBe('result');
    expect(code.outputs[2].kind).toBe('error');
  });

  it('reads the kernel language from metadata.language_info', () => {
    const r = parseNotebook(nb4(
      [{ cell_type: 'code', source: 'x', outputs: [] }],
      { language_info: { name: 'javascript' } },
    ));
    expect(r.language).toBe('javascript');
    expect(r.cells[0].language).toBe('javascript');
  });

  it('falls back to kernelspec.language for nbformat 3-style metadata', () => {
    const r = parseNotebook(nb4(
      [{ cell_type: 'code', source: 'x', outputs: [] }],
      { kernelspec: { language: 'R' } },
    ));
    expect(r.language).toBe('r');
  });

  it('defaults the language to python when metadata is absent', () => {
    const r = parseNotebook(nb4([{ cell_type: 'markdown', source: 'hi' }]));
    expect(r.language).toBe('python');
  });

  it('parses nbformat 3 (worksheets[0].cells)', () => {
    const r = parseNotebook(JSON.stringify({
      worksheets: [{ cells: [{ cell_type: 'markdown', source: 'v3 cell' }] }],
      nbformat: 3,
    }));
    expect(r.error).toBeUndefined();
    expect(r.cells).toHaveLength(1);
    expect(r.cells[0].source).toBe('v3 cell');
  });

  it('drops malformed cells but keeps the valid ones', () => {
    const r = parseNotebook(nb4([
      null,
      { cell_type: 'unknown', source: 'x' },
      { cell_type: 'markdown', source: 'good' },
      'not a cell',
    ]));
    expect(r.cells).toHaveLength(1);
    expect(r.cells[0].source).toBe('good');
  });
});
