import { describe, it, expect, beforeEach } from 'vitest';
import { getTemplates, saveTemplate, deleteTemplate, TEMPLATES_KEY } from '../src/lib/templates.js';

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

describe('getTemplates', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(getTemplates(store)).toEqual([]);
  });

  it('returns an empty array when the stored JSON is malformed', () => {
    store.setItem(TEMPLATES_KEY, '{ not json');
    expect(getTemplates(store)).toEqual([]);
  });

  it('returns an empty array when stored value is not an array', () => {
    store.setItem(TEMPLATES_KEY, JSON.stringify({ name: 'x', content: 'y' }));
    expect(getTemplates(store)).toEqual([]);
  });

  it('filters out malformed entries', () => {
    store.setItem(TEMPLATES_KEY, JSON.stringify([
      { name: 'Good', content: 'body' },
      { name: 'NoContent' },           // missing content → dropped
      { content: 'NoName' },            // missing name → dropped
      { name: 123, content: 'x' },      // wrong name type → dropped
      null,
    ]));
    expect(getTemplates(store)).toEqual([{ name: 'Good', content: 'body' }]);
  });
});

describe('saveTemplate', () => {
  it('appends a new template', () => {
    const list = saveTemplate(store, 'Meeting', '# Meeting\n\n- ');
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ name: 'Meeting', content: '# Meeting\n\n- ' });
    expect(getTemplates(store)).toEqual(list);
  });

  it('overwrites an existing template with the same name (upsert)', () => {
    saveTemplate(store, 'Note', 'old');
    const list = saveTemplate(store, 'Note', 'new');
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe('new');
  });

  it('preserves other templates when upserting', () => {
    saveTemplate(store, 'A', 'a-body');
    saveTemplate(store, 'B', 'b-body');
    const list = saveTemplate(store, 'A', 'a-updated');
    expect(list).toHaveLength(2);
    expect(list.find((t) => t.name === 'A').content).toBe('a-updated');
    expect(list.find((t) => t.name === 'B').content).toBe('b-body');
  });

  it('ignores an empty or invalid name', () => {
    const list = saveTemplate(store, '', 'whatever');
    expect(list).toEqual([]);
  });
});

describe('deleteTemplate', () => {
  it('removes a template by name', () => {
    saveTemplate(store, 'A', 'a');
    saveTemplate(store, 'B', 'b');
    const list = deleteTemplate(store, 'A');
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('B');
  });

  it('is a no-op when the name does not exist', () => {
    saveTemplate(store, 'A', 'a');
    const list = deleteTemplate(store, 'Nope');
    expect(list).toHaveLength(1);
  });
});
