import { it, expect, vi } from 'vitest';
import { restoreSessionDocs } from '../src/lib/restore-session.js';
import { DocumentStore } from '../src/lib/documents.js';

it('recovers unsaved named and untitled buffers without reading over them', async () => {
  const docs = [
    { id: 'named', path: '/note.md', content: 'unsaved work', dirty: true, mode: 'edit' },
    { id: 'scratch', path: null, content: 'scratch work', dirty: true, mode: 'edit' },
    { id: 'clean', path: '/clean.md', content: 'old version', dirty: false },
  ];
  const invoke = vi.fn().mockResolvedValue('fresh disk version');
  const restored = await restoreSessionDocs(docs, invoke);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('read_file', { path: '/clean.md' });
  const store = new DocumentStore();
  store.restore({ docs: restored, activeId: 'named' });
  expect(store.active()).toMatchObject({ content: 'unsaved work', dirty: true, mode: 'edit' });
  expect(store.docs[1]).toMatchObject({ content: 'scratch work', dirty: true });
  expect(store.docs[2]).toMatchObject({ content: 'fresh disk version', dirty: false });
});

it('keeps missing files as recovered buffers and never reads binary files as text', async () => {
  const invoke = vi.fn().mockRejectedValue('missing');
  const docs = [
    { path: '/missing.md', content: 'last known work' },
    { path: '/document.pdf', content: '' },
    { path: '/photo.png', content: '' },
    { path: '/movie.mp4', content: '' },
  ];
  const restored = await restoreSessionDocs(docs, invoke);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(restored[0]).toMatchObject({ content: 'last known work', dirty: true });
  expect(restored.slice(1).every((doc) => doc.content === '' && !doc.dirty)).toBe(true);
});
