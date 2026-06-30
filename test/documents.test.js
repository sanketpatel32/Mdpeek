import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentStore, createDocument } from '../src/lib/documents.js';

describe('createDocument', () => {
  it('creates a doc with defaults', () => {
    const d = createDocument({ path: '/a.md', content: '# hi' });
    expect(d.path).toBe('/a.md');
    expect(d.content).toBe('# hi');
    expect(d.mode).toBe('view');
    expect(d.dirty).toBe(false);
    expect(d.scrollY).toBe(0);
    expect(d.editor).toBe(null);
    expect(typeof d.id).toBe('string');
  });

  it('untitled docs have null path', () => {
    const d = createDocument({ content: '' });
    expect(d.path).toBe(null);
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
});
