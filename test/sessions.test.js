import { describe, it, expect, beforeEach } from 'vitest';
import { getSessions, saveSession, deleteSession, SESSIONS_KEY } from '../src/lib/sessions.js';

// Minimal localStorage shim. Behaves like the real one but in-memory.
function makeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    _map: map,
  };
}

let store;
beforeEach(() => { store = makeStore(); });

describe('getSessions', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(getSessions(store)).toEqual([]);
  });

  it('returns an empty array when the stored JSON is malformed', () => {
    store.setItem(SESSIONS_KEY, '{ not json');
    expect(getSessions(store)).toEqual([]);
  });

  it('returns an empty array when stored value is not an array', () => {
    store.setItem(SESSIONS_KEY, JSON.stringify({ name: 'x' }));
    expect(getSessions(store)).toEqual([]);
  });

  it('drops malformed entries but keeps valid ones', () => {
    store.setItem(SESSIONS_KEY, JSON.stringify([
      { name: 'Good', root: '/proj', explorerVisible: true, snapshot: { docs: [], activeId: null } },
      { name: 'NoSnapshot' },        // missing snapshot → kept with default
      { root: '/proj' },             // missing name → dropped
      { name: 123 },                 // wrong name type → dropped
      null,
    ]));
    const out = getSessions(store);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe('Good');
    expect(out[0].root).toBe('/proj');
    expect(out[1].name).toBe('NoSnapshot');
    expect(out[1].snapshot).toEqual({ docs: [], activeId: null });
  });
});

describe('saveSession', () => {
  it('appends a new session', () => {
    saveSession(store, 'work', { root: '/work', explorerVisible: true, snapshot: { docs: [{ id: '1' }], activeId: '1' } });
    const out = getSessions(store);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'work', root: '/work', explorerVisible: true });
    expect(out[0].createdAt).toBeGreaterThan(0);
    expect(out[0].snapshot.docs).toHaveLength(1);
  });

  it('upserts by name (replaces an existing session, preserves createdAt)', () => {
    saveSession(store, 'work', { root: '/old' });
    const first = getSessions(store)[0];
    saveSession(store, 'work', { root: '/new' });
    const out = getSessions(store);
    expect(out).toHaveLength(1);
    expect(out[0].root).toBe('/new');
    expect(out[0].createdAt).toBe(first.createdAt); // preserved across the update
  });

  it('coerces optional fields to safe defaults', () => {
    saveSession(store, 'x', {});
    const out = getSessions(store)[0];
    expect(out.root).toBeNull();
    expect(out.explorerVisible).toBe(true);
    expect(out.snapshot).toEqual({ docs: [], activeId: null });
  });

  it('ignores an empty/non-string name', () => {
    saveSession(store, '', { root: '/x' });
    saveSession(store, null, { root: '/y' });
    expect(getSessions(store)).toEqual([]);
  });

  it('keeps other sessions untouched when adding/updating one', () => {
    saveSession(store, 'a', { root: '/a' });
    saveSession(store, 'b', { root: '/b' });
    saveSession(store, 'a', { root: '/a2' });
    const out = getSessions(store);
    expect(out.map((s) => s.name).sort()).toEqual(['a', 'b']);
    expect(out.find((s) => s.name === 'a').root).toBe('/a2');
  });
});

describe('deleteSession', () => {
  it('removes the named session', () => {
    saveSession(store, 'a', { root: '/a' });
    saveSession(store, 'b', { root: '/b' });
    deleteSession(store, 'a');
    const out = getSessions(store);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('b');
  });

  it('is a no-op when the name is absent', () => {
    saveSession(store, 'a', { root: '/a' });
    deleteSession(store, 'missing');
    expect(getSessions(store)).toHaveLength(1);
  });
});
