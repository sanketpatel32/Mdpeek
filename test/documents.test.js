import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentStore, createDocument, isPlainPath, isCodePath, isImagePath, isCsvPath, langFromPath } from '../src/lib/documents.js';

describe('createDocument', () => {
  it('creates a doc with defaults', () => {
    const d = createDocument({ path: '/a.md', content: '# hi' });
    expect(d.path).toBe('/a.md');
    expect(d.content).toBe('# hi');
    expect(d.mode).toBe('view');
    expect(d.plain).toBe(false);
    expect(d.dirty).toBe(false);
    expect(d.scrollY).toBe(0);
    expect(d.editor).toBe(null);
    expect(typeof d.id).toBe('string');
  });

  it('untitled docs have null path', () => {
    const d = createDocument({ content: '' });
    expect(d.path).toBe(null);
    expect(d.plain).toBe(false);
  });

  it('marks .txt docs as plain and opens them in edit mode', () => {
    const d = createDocument({ path: 'C:\\Users\\me\\notes.txt', content: 'hi' });
    expect(d.plain).toBe(true);
    expect(d.mode).toBe('edit');
  });

  it('case-insensitive .txt detection', () => {
    expect(createDocument({ path: '/a.TXT' }).plain).toBe(true);
    expect(createDocument({ path: '/a.Txt' }).plain).toBe(true);
  });

  it('markdown and mdx docs are not plain', () => {
    expect(createDocument({ path: '/a.md' }).plain).toBe(false);
    expect(createDocument({ path: '/a.mdx' }).plain).toBe(false);
    expect(createDocument({ path: '/a.markdown' }).plain).toBe(false);
  });
});

describe('isPlainPath', () => {
  it('true only for .txt paths', () => {
    expect(isPlainPath('/a.txt')).toBe(true);
    expect(isPlainPath('/a.md')).toBe(false);
    expect(isPlainPath(null)).toBe(false);
    expect(isPlainPath('')).toBe(false);
  });
});

describe('isImagePath', () => {
  it('true for common image extensions', () => {
    expect(isImagePath('/photo.png')).toBe(true);
    expect(isImagePath('/photo.jpg')).toBe(true);
    expect(isImagePath('/photo.JPEG')).toBe(true); // case-insensitive
    expect(isImagePath('C:\\pics\\cat.gif')).toBe(true);
    expect(isImagePath('logo.svg')).toBe(true);
    expect(isImagePath('a.webp')).toBe(true);
    expect(isImagePath('a.bmp')).toBe(true);
    expect(isImagePath('a.ico')).toBe(true);
    expect(isImagePath('a.avif')).toBe(true);
  });
  it('false for non-image paths', () => {
    expect(isImagePath('/readme.md')).toBe(false);
    expect(isImagePath('/script.js')).toBe(false);
    expect(isImagePath('/doc.pdf')).toBe(false);
    expect(isImagePath(null)).toBe(false);
    expect(isImagePath('')).toBe(false);
  });
});

describe('createDocument — image flag', () => {
  it('marks png as image, read-only view mode, empty content', () => {
    const d = createDocument({ path: '/pic.png' });
    expect(d.image).toBe(true);
    expect(d.pdf).toBe(false);
    expect(d.code).toBe(false);
    expect(d.mode).toBe('view');
    expect(d.content).toBe('');
  });
  it('does not classify a .png as code', () => {
    const d = createDocument({ path: '/pic.png' });
    expect(d.code).toBe(false);
  });
});

describe('isCsvPath', () => {
  it('true for .csv and .tsv (case-insensitive)', () => {
    expect(isCsvPath('/data.csv')).toBe(true);
    expect(isCsvPath('/data.tsv')).toBe(true);
    expect(isCsvPath('/data.CSV')).toBe(true);
    expect(isCsvPath('C:\\Users\\me\\sheet.tsv')).toBe(true);
  });
  it('false for non-csv paths', () => {
    expect(isCsvPath('/readme.md')).toBe(false);
    expect(isCsvPath('/app.js')).toBe(false);
    expect(isCsvPath('/pic.png')).toBe(false);
    expect(isCsvPath(null)).toBe(false);
    expect(isCsvPath('')).toBe(false);
  });
});

describe('createDocument — csv flag', () => {
  it('marks .csv as csv, read-only view mode, keeps content', () => {
    const d = createDocument({ path: '/data.csv', content: 'a,b\n1,2' });
    expect(d.csv).toBe(true);
    expect(d.code).toBe(false);
    expect(d.mode).toBe('view');
    expect(d.content).toBe('a,b\n1,2');
  });
  it('marks .tsv as csv too', () => {
    const d = createDocument({ path: '/sheet.tsv' });
    expect(d.csv).toBe(true);
  });
  it('does not classify a .csv as code or image', () => {
    const d = createDocument({ path: '/data.csv' });
    expect(d.code).toBe(false);
    expect(d.image).toBe(false);
    expect(d.plain).toBe(false);
  });
});

describe('isCodePath', () => {
  it('true for common code/config extensions', () => {
    expect(isCodePath('/app.js')).toBe(true);
    expect(isCodePath('C:\\proj\\main.py')).toBe(true);
    expect(isCodePath('config.json')).toBe(true);
    expect(isCodePath('style.css')).toBe(true);
    expect(isCodePath('data.yml')).toBe(true);
    expect(isCodePath('build.log')).toBe(true);
    // .csv/.tsv are now their own type (isCsvPath), not code.
    expect(isCodePath('rows.csv')).toBe(false);
    expect(isCodePath('sheet.tsv')).toBe(false);
    expect(isCodePath('.env')).toBe(true);
    expect(isCodePath('Dockerfile')).toBe(true);
    expect(isCodePath('Makefile')).toBe(true);
  });
  it('false for markdown/plain/pdf/excalidraw (those have their own paths)', () => {
    expect(isCodePath('/a.md')).toBe(false);
    expect(isCodePath('/a.markdown')).toBe(false);
    expect(isCodePath('/a.txt')).toBe(false);
    expect(isCodePath('/a.pdf')).toBe(false);
    expect(isCodePath('/a.excalidraw')).toBe(false);
  });
  it('false for null/empty', () => {
    expect(isCodePath(null)).toBe(false);
    expect(isCodePath('')).toBe(false);
  });
});

describe('langFromPath', () => {
  it('maps extensions to hljs language ids', () => {
    expect(langFromPath('/app.js')).toBe('javascript');
    expect(langFromPath('main.py')).toBe('python');
    expect(langFromPath('component.tsx')).toBe('typescript');
    expect(langFromPath('config.yml')).toBe('yaml');
    expect(langFromPath('run.sh')).toBe('bash');
    expect(langFromPath('App.cs')).toBe('csharp');
    expect(langFromPath('lib.rs')).toBe('rust');
  });
  it('maps special basenames (Dockerfile, Makefile)', () => {
    expect(langFromPath('Dockerfile')).toBe('dockerfile');
    expect(langFromPath('Makefile')).toBe('makefile');
  });
  it('returns the raw extension for unknown langs (hljs may still know it)', () => {
    expect(langFromPath('weird.zig')).toBe('zig');
  });
  it('returns null for no extension', () => {
    expect(langFromPath(null)).toBe(null);
    expect(langFromPath('README')).toBe(null);
  });
});

describe('createDocument (code flag)', () => {
  it('marks .js files as code and forces view mode', () => {
    const d = createDocument({ path: '/app.js', content: 'console.log(1)' });
    expect(d.code).toBe(true);
    expect(d.mode).toBe('view');
    expect(d.plain).toBe(false);
    expect(d.pdf).toBe(false);
  });
  it('does not mark .md files as code', () => {
    const d = createDocument({ path: '/readme.md', content: '# hi' });
    expect(d.code).toBe(false);
  });
  it('explicit code override works for untitled tabs', () => {
    const d = createDocument({ path: null, content: 'x = 1', code: true });
    expect(d.code).toBe(true);
    expect(d.mode).toBe('view');
  });
});

describe('DocumentStore', () => {
  let store;
  beforeEach(() => {
    store = new DocumentStore();
  });

  it('starts empty with activeId null', () => {
    expect(store.docs).toEqual([]);
    expect(store.activeId).toBe(null);
  });

  it('open() adds a doc and activates it', () => {
    const d = store.open({ path: '/a.md', content: 'a' });
    expect(store.docs).toHaveLength(1);
    expect(store.docs[0]).toBe(d);
    expect(store.activeId).toBe(d.id);
  });

  it('open() with same path returns existing doc (no duplicate)', () => {
    const d1 = store.open({ path: '/a.md', content: 'a' });
    const d2 = store.open({ path: '/a.md', content: 'a' });
    expect(d2).toBe(d1);
    expect(store.docs).toHaveLength(1);
  });

  it('open() untitled always creates new (path=null)', () => {
    store.open({ path: null, content: '' });
    store.open({ path: null, content: '' });
    expect(store.docs).toHaveLength(2);
  });

  it('active() returns the active doc', () => {
    const d = store.open({ path: '/a.md', content: 'a' });
    expect(store.active()).toBe(d);
  });

  it('switch(id) sets activeId', () => {
    const d1 = store.open({ path: '/a.md', content: 'a' });
    const d2 = store.open({ path: '/b.md', content: 'b' });
    store.switch(d1.id);
    expect(store.activeId).toBe(d1.id);
    expect(store.active()).toBe(d1);
  });

  it('close() removes a doc; if it was active, activates neighbor', () => {
    const d1 = store.open({ path: '/a.md', content: 'a' });
    const d2 = store.open({ path: '/b.md', content: 'b' });
    const d3 = store.open({ path: '/c.md', content: 'c' });
    store.switch(d2.id);
    store.close(d2.id);
    expect(store.docs).toHaveLength(2);
    expect(store.docs.find((x) => x.id === d2.id)).toBeUndefined();
    // close() prefers the NEXT neighbor (d3, the element now at idx) over the previous.
    expect(store.activeId).toBe(d3.id);
  });

  it('close() active last tab activates the previous one', () => {
    const d1 = store.open({ path: '/a.md', content: 'a' });
    const d2 = store.open({ path: '/b.md', content: 'b' });
    store.switch(d2.id);
    store.close(d2.id); // no next neighbor → falls back to previous (d1)
    expect(store.activeId).toBe(d1.id);
  });

  it('close() last doc leaves store empty (caller handles creating Untitled)', () => {
    const d = store.open({ path: '/a.md', content: 'a' });
    store.close(d.id);
    expect(store.docs).toEqual([]);
    expect(store.activeId).toBe(null);
  });

  it('markDirty sets dirty=true; clearDirty sets false', () => {
    const d = store.open({ path: '/a.md', content: 'a' });
    store.markDirty(d.id);
    expect(d.dirty).toBe(true);
    store.clearDirty(d.id);
    expect(d.dirty).toBe(false);
  });

  it('createDocument defaults pinned=false', () => {
    const d = createDocument({ path: '/a.md' });
    expect(d.pinned).toBe(false);
  });

  it('createDocument accepts pinned override', () => {
    const d = createDocument({ path: '/a.md', pinned: true });
    expect(d.pinned).toBe(true);
  });

  it('setPinned flips the flag', () => {
    const d = store.open({ path: '/a.md', content: 'a' });
    expect(d.pinned).toBe(false);
    store.setPinned(d.id, true);
    expect(d.pinned).toBe(true);
    store.setPinned(d.id, false);
    expect(d.pinned).toBe(false);
  });

  it('setPinned(true) moves the doc before all unpinned (stable)', () => {
    const a = store.open({ path: '/a.md', content: 'a' });
    const b = store.open({ path: '/b.md', content: 'b' });
    const c = store.open({ path: '/c.md', content: 'c' });
    // Initial order: [a, b, c]. Pin c — it should move to the front.
    store.setPinned(c.id, true);
    expect(store.docs.map((d) => d.id)).toEqual([c.id, a.id, b.id]);
    // Pin a — now [c, a] (both pinned, stable relative order) + b unpinned.
    store.setPinned(a.id, true);
    expect(store.docs.map((d) => d.id)).toEqual([c.id, a.id, b.id]);
    // Unpin c — a stays pinned, c falls back into the unpinned group.
    store.setPinned(c.id, false);
    expect(store.docs.map((d) => d.id)).toEqual([a.id, c.id, b.id]);
  });

  it('setPinned is a no-op when the flag is unchanged', () => {
    const d = store.open({ path: '/a.md', content: 'a' });
    const cb = vi.fn();
    store.on('change', cb);
    store.setPinned(d.id, false); // already false
    expect(cb).not.toHaveBeenCalled();
    store.setPinned(d.id, true);  // changes — emits
    expect(cb).toHaveBeenCalledTimes(1);
    store.setPinned(d.id, true);  // already true — no emit
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('serialize writes pinned docs first', () => {
    const a = store.open({ path: '/a.md', content: 'a' });
    const b = store.open({ path: '/b.md', content: 'b' });
    store.setPinned(b.id, true);
    const snap = store.serialize();
    expect(snap.docs.map((d) => d.path)).toEqual(['/b.md', '/a.md']);
    expect(snap.docs[0].pinned).toBe(true);
    expect(snap.docs[1].pinned).toBe(false);
  });

  it('serialize preserves blank pinned untitled tabs', () => {
    // A blank untitled tab is normally filtered out at serialize time, but a
    // pinned one should survive (the user explicitly kept it around).
    const d = store.open({ path: null, content: '' });
    store.setPinned(d.id, true);
    const snap = store.serialize();
    expect(snap.docs).toHaveLength(1);
    expect(snap.docs[0].pinned).toBe(true);
  });

  it('restore reads pinned back', () => {
    const store2 = new DocumentStore();
    store2.restore({
      docs: [
        { id: 'p1', path: '/pinned.md', content: 'p', pinned: true },
        { id: 'u1', path: '/unpinned.md', content: 'u', pinned: false },
        { id: 'u2', path: '/legacy.md', content: 'l' }, // no pinned field
      ],
      activeId: 'p1',
    });
    expect(store2.docs[0].pinned).toBe(true);
    expect(store2.docs[1].pinned).toBe(false);
    // Legacy session without pinned field defaults to false.
    expect(store2.docs[2].pinned).toBe(false);
  });

  it('emits "change" on open/switch/close', () => {
    const cb = vi.fn();
    store.on('change', cb);
    const d1 = store.open({ path: '/a.md', content: 'a' });
    const d2 = store.open({ path: '/b.md', content: 'b' });
    store.switch(d1.id);
    store.close(d2.id);
    expect(cb).toHaveBeenCalledTimes(4); // open, open, switch, close
  });

  it('switch() to unknown id is a no-op (no emit, no activeId change)', () => {
    const d = store.open({ path: '/a.md', content: 'a' });
    const cb = vi.fn();
    store.on('change', cb);
    store.switch('does-not-exist');
    expect(store.activeId).toBe(d.id);
    expect(cb).not.toHaveBeenCalled();
  });

  it('switch() to already-active tab is a no-op (no spurious emit)', () => {
    const d = store.open({ path: '/a.md', content: 'a' });
    const cb = vi.fn();
    store.on('change', cb);
    store.switch(d.id); // already active
    expect(cb).not.toHaveBeenCalled();
  });

  it('on() returns an unsubscribe that stops further callbacks', () => {
    const cb = vi.fn();
    const off = store.on('change', cb);
    store.open({ path: '/a.md', content: 'a' });
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    store.open({ path: '/b.md', content: 'b' });
    expect(cb).toHaveBeenCalledTimes(1); // no new call after unsubscribe
  });

  it('restore() falls back to docs[0] when activeId points at a filtered-out doc', () => {
    // The bad doc (non-string content) gets filtered; activeId references it.
    const data = {
      docs: [
        { id: 'good', path: '/a.md', content: 'a' },
        { id: 'bad', path: '/b.md', content: 12345 }, // invalid → filtered
      ],
      activeId: 'bad',
    };
    store.restore(data);
    expect(store.docs).toHaveLength(1);
    expect(store.docs[0].id).toBe('good');
    expect(store.activeId).toBe('good'); // fell back to docs[0]
  });

  it('serialize() returns plain array; round-trips via restore()', () => {
    const d1 = store.open({ path: '/a.md', content: 'a-content' });
    store.open({ path: null, content: 'untitled-content' });
    store.switch(d1.id);
    const data = store.serialize();
    expect(Array.isArray(data.docs)).toBe(true);
    expect(data.docs).toHaveLength(2);
    expect(data.docs[0].path).toBe('/a.md');
    expect(data.activeId).toBe(d1.id);

    const s2 = new DocumentStore();
    s2.restore(data);
    expect(s2.docs).toHaveLength(2);
    expect(s2.docs[0].path).toBe('/a.md');
    expect(s2.docs[0].content).toBe('a-content');
    expect(s2.docs[1].path).toBe(null);
    expect(s2.docs[1].content).toBe('untitled-content');
    expect(s2.activeId).toBe(s2.docs[0].id);
  });

  it('restore() ignores corrupt data gracefully', () => {
    expect(() => store.restore(null)).not.toThrow();
    expect(() => store.restore({ docs: 'not-an-array' })).not.toThrow();
    expect(store.docs).toEqual([]);
  });

  it('restore() re-derives plain flag + edit mode from .txt path', () => {
    // Simulate a serialized snapshot (plain flag isn't in the serialized form —
    // it's re-derived from path on restore).
    store.restore({
      docs: [
        { id: 'x', path: '/notes.txt', content: 'plain', mode: 'view', dirty: false, scrollY: 0 },
        { id: 'y', path: '/readme.md', content: '# md', mode: 'view', dirty: false, scrollY: 0 },
      ],
      activeId: 'x',
    });
    expect(store.docs[0].plain).toBe(true);
    expect(store.docs[0].mode).toBe('edit'); // plain forces edit mode even if snapshot said view
    expect(store.docs[1].plain).toBe(false);
    expect(store.docs[1].mode).toBe('view');
  });
});
