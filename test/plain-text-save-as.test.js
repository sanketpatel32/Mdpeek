// Regression test: saving an untitled plain-text note must route the "text"
// kind through save_file_as so the dialog defaults to a .txt file instead of
// silently producing a .md that reopens as Markdown.
import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(process.env.MDPEEK_REGRESSION_SOURCE || 'src/main.js', 'utf8');
const start = source.indexOf('// ---------- save ----------');
const end = source.indexOf('// v0.45.0: write a version-history snapshot');

it('untitled plain-text notes request the text Save As kind and complete the save', async () => {
  const doc = { id: 'plain-note', path: null, plain: true, content: 'hello' };
  const store = { active: () => doc, clearDirty: vi.fn() };
  const invoke = vi.fn().mockResolvedValue('C:\\notes\\hello.txt');
  const deps = { store, invoke, toast: vi.fn(), fmtErr: String, maybeSnapshot: vi.fn(), _activeExcalidraw: null, _activeTLDraw: null };
  const saveActive = new Function(...Object.keys(deps), `${source.slice(start, end)}\nreturn saveActive;`)(...Object.values(deps));
  await saveActive();
  expect(invoke).toHaveBeenCalledExactlyOnceWith('save_file_as', { content: 'hello', kind: 'text' });
  expect(doc.path).toBe('C:\\notes\\hello.txt');
  expect(store.clearDirty).toHaveBeenCalledWith(doc.id);
  expect(deps.toast).toHaveBeenCalledExactlyOnceWith('Saved');
});
