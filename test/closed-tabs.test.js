import { describe, it, expect } from 'vitest';
import { snapshotDoc, pushClosedTab, popClosedTab } from '../src/lib/closed-tabs.js';

describe('closed-tabs', () => {
  it('snapshots the essential doc fields', () => {
    const snap = snapshotDoc({ path: '/a.md', content: 'hi', mode: 'edit', plain: false, code: false, editor: {}, editorState: { x: 1 } });
    expect(snap.path).toBe('/a.md');
    expect(snap.content).toBe('hi');
    expect(snap.mode).toBe('edit');
    expect(snap.editor).toBeUndefined(); // live editor dropped
    expect(snap.editorState).toBeUndefined();
    expect(snap.closedAt).toBeGreaterThan(0);
  });

  it('returns null for a null doc', () => {
    expect(snapshotDoc(null)).toBeNull();
  });

  it('push + pop in LIFO order', () => {
    let s = [];
    s = pushClosedTab(s, snapshotDoc({ path: '/a.md', content: 'a' }));
    s = pushClosedTab(s, snapshotDoc({ path: '/b.md', content: 'b' }));
    const { entry, rest } = popClosedTab(s);
    expect(entry.path).toBe('/b.md'); // most recent first
    expect(rest).toHaveLength(1);
    expect(rest[0].path).toBe('/a.md');
  });

  it('caps the stack at max entries', () => {
    let s = [];
    for (let i = 0; i < 25; i++) s = pushClosedTab(s, snapshotDoc({ path: `/f${i}.md`, content: '' }), 20);
    expect(s).toHaveLength(20);
    // Oldest (f0..f4) dropped; newest (f24) on top.
    expect(s[0].path).toBe('/f24.md');
    expect(s[19].path).toBe('/f5.md');
  });

  it('dedupes by path (same file closed twice collapses)', () => {
    let s = [];
    s = pushClosedTab(s, snapshotDoc({ path: '/a.md', content: 'old' }));
    s = pushClosedTab(s, snapshotDoc({ path: '/b.md', content: 'b' }));
    s = pushClosedTab(s, snapshotDoc({ path: '/a.md', content: 'new' }));
    expect(s).toHaveLength(2);
    expect(s[0].path).toBe('/a.md');
    expect(s[0].content).toBe('new');
  });

  it('does not dedupe untitled docs (path === null)', () => {
    let s = [];
    s = pushClosedTab(s, snapshotDoc({ path: null, content: 'one' }));
    s = pushClosedTab(s, snapshotDoc({ path: null, content: 'two' }));
    expect(s).toHaveLength(2);
  });

  it('pop on empty stack returns null entry', () => {
    const { entry, rest } = popClosedTab([]);
    expect(entry).toBeNull();
    expect(rest).toEqual([]);
  });

  it('push does not mutate the input array', () => {
    const orig = [];
    const next = pushClosedTab(orig, snapshotDoc({ path: '/a.md', content: '' }));
    expect(orig).toHaveLength(0); // unchanged
    expect(next).toHaveLength(1);
  });
});
