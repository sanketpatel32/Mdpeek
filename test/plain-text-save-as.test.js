// Regression test: saving an untitled plain-text note must route the "text"
// kind through save_file_as so the dialog defaults to a .txt file instead of
// silently producing a .md that reopens as Markdown.
// v1.1.2: imports the extracted save pipeline directly (src/lib/save-doc.js)
// instead of slicing main.js source text.
import { it, expect, vi } from 'vitest';
import { saveActiveDoc } from '../src/lib/save-doc.js';

it('keeps newer edits dirty while an earlier save is in flight', async () => {
  const doc = { id: 'race', path: '/note.md', content: 'first version', dirty: true };
  let complete;
  const deps = { invoke: vi.fn(() => new Promise((resolve) => { complete = resolve; })), clearDirty: vi.fn(), toast: vi.fn(), fmtErr: String };
  const saving = saveActiveDoc(deps, doc);
  doc.content = 'newer unsaved work';
  complete();
  await saving;
  expect(deps.clearDirty).not.toHaveBeenCalled();
  expect(deps.invoke).toHaveBeenCalledWith('save_file', { path: '/note.md', content: 'first version' });
});

it('a null Save As result leaves the document unsaved', async () => {
  const doc = { id: 'cancel', path: null, content: 'work', dirty: true };
  const deps = { invoke: vi.fn().mockResolvedValue(null), clearDirty: vi.fn(), toast: vi.fn(), fmtErr: String };
  expect(await saveActiveDoc(deps, doc)).toBeNull();
  expect(doc.path).toBeNull();
  expect(deps.clearDirty).not.toHaveBeenCalled();
  expect(deps.toast).not.toHaveBeenCalled();
});

it('untitled plain-text notes request the text Save As kind and complete the save', async () => {
  const doc = { id: 'plain-note', path: null, plain: true, content: 'hello' };
  const invoke = vi.fn().mockResolvedValue('C:\\notes\\hello.txt');
  const deps = {
    invoke,
    toast: vi.fn(),
    fmtErr: String,
    clearDirty: vi.fn(),
    maybeSnapshot: vi.fn(),
    excalidraw: null,
    tldraw: null,
  };
  await saveActiveDoc(deps, doc);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('save_file_as', { content: 'hello', kind: 'text' });
  expect(doc.path).toBe('C:\\notes\\hello.txt');
  expect(deps.clearDirty).toHaveBeenCalledWith(doc.id);
  expect(deps.toast).toHaveBeenCalledExactlyOnceWith('Saved');
});

it('named docs save in place via save_file and clear the dirty flag', async () => {
  const doc = { id: 'named', path: 'C:\\notes\\a.md', content: 'hi', mode: 'view' };
  const invoke = vi.fn().mockResolvedValue(null);
  const deps = {
    invoke,
    toast: vi.fn(),
    fmtErr: String,
    clearDirty: vi.fn(),
    maybeSnapshot: vi.fn(),
    excalidraw: null,
    tldraw: null,
  };
  await saveActiveDoc(deps, doc);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('save_file', { path: 'C:\\notes\\a.md', content: 'hi' });
  expect(deps.clearDirty).toHaveBeenCalledWith(doc.id);
  expect(deps.toast).toHaveBeenCalledWith('Saved');
});

it('canvas tabs request their own file kind', async () => {
  const tldrawDoc = { id: 'tl', path: null, tldraw: true, content: '{}' };
  const excalidrawDoc = { id: 'ex', path: null, excalidraw: true, content: '{"elements":[]}' };
  const invoke = vi.fn().mockResolvedValue('C:\\notes\\drawing.tldr');
  const deps = {
    invoke,
    toast: vi.fn(),
    fmtErr: String,
    clearDirty: vi.fn(),
    maybeSnapshot: vi.fn(),
    excalidraw: null,
    tldraw: { flush: () => '{}' },
  };
  await saveActiveDoc(deps, tldrawDoc);
  expect(invoke).toHaveBeenCalledWith('save_file_as', { content: '{}', kind: 'tldraw' });

  deps.invoke = vi.fn().mockResolvedValue('C:\\notes\\drawing.excalidraw');
  await saveActiveDoc({ ...deps, invoke: deps.invoke }, excalidrawDoc);
  expect(deps.invoke).toHaveBeenCalledWith('save_file_as', { content: '{"elements":[]}', kind: 'excalidraw' });
});

it("cancelled Save As keeps the doc pathless and stays quiet", async () => {
  const doc = { id: 'cancel-me', path: null, plain: true, content: 'x' };
  const deps = {
    invoke: vi.fn().mockRejectedValue('cancelled'),
    toast: vi.fn(),
    fmtErr: String,
    clearDirty: vi.fn(),
    maybeSnapshot: vi.fn(),
    excalidraw: null,
    tldraw: null,
  };
  const out = await saveActiveDoc(deps, doc);
  expect(out).toBeNull();
  expect(doc.path).toBeNull();
  expect(deps.toast).not.toHaveBeenCalled();
});
