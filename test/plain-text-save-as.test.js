// Regression test: saving an untitled plain-text note must route the "text"
// kind through save_file_as so the dialog defaults to a .txt file instead of
// silently producing a .md that reopens as Markdown.
import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(process.env.MDPEEK_REGRESSION_SOURCE || 'src/main.js', 'utf8');
const start = source.indexOf('// ---------- save ----------');
const end = source.indexOf('// v0.45.0: write a version-history snapshot');

it.each(['src/main.js'])('untitled plain-text notes default to a .txt Save As dialog', async () => {
  const store = { active: () => ({ plain: true, content: 'hello' }) };
  const invoke = vi.fn().mockResolvedValue('C:\\notes\\hello.txt');
  const deps = { store, invoke, toast: vi.fn(), fmtErr: String, maybeSnapshot: vi.fn(), _activeExcalidraw: null, _activeTLDraw: null };
  const saveActive = new Function(...Object.keys(deps), `${source.slice(start, end)}\nreturn saveActive;`)(...Object.values(deps));
  await saveActive();
  expect(invoke).toHaveBeenCalledWith('save_file_as', { content: 'hello', kind: 'text' });
});
