import { it, expect } from 'vitest';
import { DocumentStore } from '../src/lib/documents.js';
import { applyFileChange } from '../src/lib/file-reload.js';

it('a queued change updates its own tab, without overwriting the active file', () => {
  const store = new DocumentStore();
  const first = store.open({ path: 'C:\\notes\\first.md', content: 'first' });
  const active = store.open({ path: 'C:\\notes\\second.md', content: 'second' });
  expect(applyFileChange(store, { path: 'c:/notes/first.md', content: 'external edit' })).toEqual({ doc: first, conflict: false });
  expect(first.content).toBe('external edit');
  expect(active.content).toBe('second');
  expect(store.active()).toBe(active);
});

it('external changes preserve unsaved edits in both edit and preview modes', () => {
  for (const mode of ['edit', 'view']) {
    const store = new DocumentStore();
    const doc = store.open({ path: '/note.md', content: 'my work', mode });
    store.markDirty(doc.id);
    expect(applyFileChange(store, { path: '/note.md', content: 'disk text' })).toEqual({ doc, conflict: true });
    expect(doc.content).toBe('my work');
    expect(doc.dirty).toBe(true);
  }
});

it('ignores unknown files, legacy content-only events and canvas/binary tabs', () => {
  const store = new DocumentStore();
  for (const path of ['/photo.png', '/file.pdf', '/drawing.tldr', '/drawing.excalidraw', '/movie.mp4']) {
    store.open({ path, content: '' });
    expect(applyFileChange(store, { path, content: 'foreign text' })).toBeNull();
  }
  expect(applyFileChange(store, 'unidentified text')).toBeNull();
  expect(applyFileChange(store, { path: '/unknown.md', content: 'text' })).toBeNull();
});
