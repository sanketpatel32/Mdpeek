import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAllDocThemes,
  getDocTheme,
  setDocTheme,
  clearDocTheme,
  DOC_THEME_KEY,
} from '../src/lib/doc-theme.js';

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

describe('getDocTheme / getAllDocThemes', () => {
  it('returns null / empty when nothing is stored', () => {
    expect(getAllDocThemes(store)).toEqual({});
    expect(getDocTheme('C:\\notes\\Foo.md', store)).toBeNull();
  });

  it('returns null when path has no entry', () => {
    setDocTheme('a.md', 'dracula', store);
    expect(getDocTheme('b.md', store)).toBeNull();
  });

  it('returns the pinned theme for a path', () => {
    setDocTheme('a.md', 'nord', store);
    expect(getDocTheme('a.md', store)).toBe('nord');
  });

  it('returns null for an empty/null path', () => {
    expect(getDocTheme('', store)).toBeNull();
    expect(getDocTheme(null, store)).toBeNull();
  });

  it('recovers from malformed JSON', () => {
    store.setItem(DOC_THEME_KEY, '{ broken');
    expect(getAllDocThemes(store)).toEqual({});
    expect(getDocTheme('a.md', store)).toBeNull();
  });
});

describe('setDocTheme', () => {
  it('adds an entry to an empty map', () => {
    const map = setDocTheme('notes/Bar.md', 'solar-dark', store);
    expect(map).toEqual({ 'notes/Bar.md': 'solar-dark' });
    expect(getDocTheme('notes/Bar.md', store)).toBe('solar-dark');
  });

  it('preserves other entries', () => {
    setDocTheme('a.md', 'nord', store);
    const map = setDocTheme('b.md', 'dracula', store);
    expect(map).toEqual({ 'a.md': 'nord', 'b.md': 'dracula' });
  });

  it('overwrites the theme for an existing path', () => {
    setDocTheme('a.md', 'nord', store);
    const map = setDocTheme('a.md', 'tokyo-night', store);
    expect(map).toEqual({ 'a.md': 'tokyo-night' });
  });

  it('ignores invalid path or themeId', () => {
    expect(setDocTheme('', 'nord', store)).toEqual({});
    expect(setDocTheme('a.md', null, store)).toEqual({});
  });
});

describe('clearDocTheme', () => {
  it('removes the entry for a path', () => {
    setDocTheme('a.md', 'nord', store);
    setDocTheme('b.md', 'dracula', store);
    const map = clearDocTheme('a.md', store);
    expect(map).toEqual({ 'b.md': 'dracula' });
    expect(getDocTheme('a.md', store)).toBeNull();
  });

  it('is a no-op for a path with no entry', () => {
    setDocTheme('a.md', 'nord', store);
    const map = clearDocTheme('b.md', store);
    expect(map).toEqual({ 'a.md': 'nord' });
  });

  it('is a no-op for an empty path', () => {
    setDocTheme('a.md', 'nord', store);
    expect(clearDocTheme('', store)).toEqual({ 'a.md': 'nord' });
  });
});
