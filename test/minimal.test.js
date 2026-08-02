import { describe, it, expect, beforeEach } from 'vitest';
import { MINIMAL_SUPPRESSED, minimalModeOn, isFeatureOn } from '../src/lib/minimal.js';

// A localStorage-like store we fully control. Real localStorage defaults
// feature flags ON (absence !== '0'), so unset = enabled — mirrored here.
function makeStore(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

describe('minimalModeOn', () => {
  it('returns false when the key is unset', () => {
    expect(minimalModeOn(makeStore())).toBe(false);
  });
  it("returns true only when the key is '1'", () => {
    expect(minimalModeOn(makeStore({ 'mdpeek-minimal-mode': '1' }))).toBe(true);
    expect(minimalModeOn(makeStore({ 'mdpeek-minimal-mode': '0' }))).toBe(false);
  });
  it('returns false (never throws) when storage is unavailable', () => {
    const broken = { getItem: () => { throw new Error('denied'); } };
    expect(minimalModeOn(broken)).toBe(false);
  });
});

describe('isFeatureOn — suppressed under Minimal mode', () => {
  const suppressed = ['collab', 'kanban', 'terminal', 'present', 'snippets', 'daily', 'pomodoro', 'calendar', 'tasks', 'review', 'autocomplete', 'graph', 'table-editor', 'prose-highlights', 'capture', 'wordfreq'];
  for (const name of suppressed) {
    it(`returns false for '${name}' when Minimal mode is on`, () => {
      const store = makeStore({ 'mdpeek-minimal-mode': '1' });
      expect(isFeatureOn(name, store)).toBe(false);
    });
  }
});

describe('isFeatureOn — respects the per-feature flag when Minimal is off', () => {
  it("returns true by default (unset key !== '0')", () => {
    expect(isFeatureOn('terminal', makeStore())).toBe(true);
  });
  it("returns false when explicitly disabled with '0'", () => {
    expect(isFeatureOn('terminal', makeStore({ 'mdpeek-feature-terminal': '0' }))).toBe(false);
  });
  it("returns true when explicitly enabled with '1'", () => {
    expect(isFeatureOn('graph', makeStore({ 'mdpeek-feature-graph': '1' }))).toBe(true);
  });
});

describe('isFeatureOn — toggling Minimal restores a previously-enabled feature', () => {
  it('a feature re-appears once Minimal is turned off', () => {
    const store = makeStore({ 'mdpeek-minimal-mode': '1' });
    expect(isFeatureOn('kanban', store)).toBe(false);
    store.setItem('mdpeek-minimal-mode', '0');
    expect(isFeatureOn('kanban', store)).toBe(true);
  });
});

describe('MINIMAL_SUPPRESSED', () => {
  it('contains exactly the 16 non-core feature names', () => {
    expect([...MINIMAL_SUPPRESSED].sort()).toEqual([
      'autocomplete', 'calendar', 'capture', 'collab', 'daily', 'graph',
      'kanban', 'pomodoro', 'present', 'prose-highlights', 'review',
      'snippets', 'table-editor', 'tasks', 'terminal', 'wordfreq',
    ]);
    expect(MINIMAL_SUPPRESSED.size).toBe(16);
  });
  it('excludes core capabilities (a core feature would never be suppressed)', () => {
    // There are no "core feature flags" today, but the predicate must not
    // suppress anything outside the set even under Minimal mode.
    const store = makeStore({ 'mdpeek-minimal-mode': '1' });
    expect(isFeatureOn('some-core-thing', store)).toBe(true);
  });
});
