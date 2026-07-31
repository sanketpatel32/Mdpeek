import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initTableEditor } from '../src/views/table-editor.js';

// DOM smoke tests for the visual table-editor modal. The pure model logic
// lives in table.test.js; these guard the rendering + input/event glue that
// the build can't catch (the colCount-in-colControlHtml bug this fixes was a
// runtime ReferenceError that compiled fine).

function makeModel() {
  return { rows: [['Name', 'Age'], ['Ada', '36']], aligns: [null, null] };
}

describe('table-editor view', () => {
  let te;
  beforeEach(() => {
    te = initTableEditor();
  });
  afterEach(() => {
    // The modal is a singleton that persists across tests; close it so one
    // test's open state doesn't leak into the next.
    te.close();
  });

  it('renders a header row + one input per cell + column controls', () => {
    te.open({ model: makeModel() });
    const overlay = document.getElementById('te-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.classList.contains('hidden')).toBe(false);
    const cells = overlay.querySelectorAll('input.te-cell');
    // 2 columns × 2 rows = 4 cells.
    expect(cells.length).toBe(4);
    // 2 column-control strips (+ the "+ Col" button).
    expect(overlay.querySelectorAll('.te-col-ctl').length).toBe(2);
  });

  it('seeds inputs with current cell values', () => {
    te.open({ model: makeModel() });
    const cells = document.querySelectorAll('#te-overlay input.te-cell');
    expect(cells[0].value).toBe('Name');
    expect(cells[1].value).toBe('Age');
    expect(cells[2].value).toBe('Ada');
    expect(cells[3].value).toBe('36');
  });

  it('hands the emitted markdown to onApply on confirm', () => {
    let applied = null;
    te.open({ model: makeModel(), onApply: (md) => { applied = md; } });
    document.querySelector('#te-overlay .te-apply').click();
    // emitTable produces a header + delimiter + body row.
    expect(applied).toContain('| Name | Age |');
    expect(applied).toContain('| ---- | --- |');
    expect(applied).toContain('| Ada  | 36  |');
  });

  it('removes a body row via the row remove button', () => {
    const m = { rows: [['H'], ['a'], ['b']], aligns: [null] };
    te.open({ model: m });
    const removeBtns = document.querySelectorAll('#te-overlay [data-act="rremove"]');
    expect(removeBtns.length).toBe(2); // two body rows
    removeBtns[1].click(); // remove second body row ('b')
    const cells = document.querySelectorAll('#te-overlay input.te-cell');
    expect(cells.length).toBe(2); // header + one body row remain
  });

  it('cycles column alignment via the align button', () => {
    te.open({ model: makeModel() });
    // Each click re-renders the strip (innerHTML rebuilt), so re-query the
    // button between clicks — the old reference is detached after render().
    const btn0 = () => document.querySelector('#te-overlay [data-act="align"][data-col="0"]');
    expect(btn0().textContent).toBe('·'); // null alignment
    btn0().click();
    expect(btn0().textContent).toBe('⟸'); // left
    btn0().click();
    expect(btn0().textContent).toBe('⇔'); // center
  });

  it('does not render the modal when opened without a model', () => {
    te.open({ onApply: () => {} });
    const overlay = document.getElementById('te-overlay');
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('appends a row via the + Row footer button', () => {
    te.open({ model: makeModel() });
    document.querySelector('#te-overlay .te-add-row').click();
    const cells = document.querySelectorAll('#te-overlay input.te-cell');
    expect(cells.length).toBe(6); // 2 cols × 3 rows
  });
});

