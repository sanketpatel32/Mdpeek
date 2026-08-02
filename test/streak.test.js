import { describe, it, expect } from 'vitest';
import {
  STREAK_KEY,
  markWritingDay,
  currentStreak,
  bestStreak,
  formatStreakChip,
} from '../src/lib/streak.js';

// A localStorage-like shim with plain state. Mirrors the test pattern in
// sessions.test.js / templates.test.js.
function makeStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem(k) { return k in data ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
  };
}

// Deterministic `now` helper — local midnight for a given date so day-stamps
// are stable regardless of when the suite runs.
const NOON = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).getTime();

describe('markWritingDay', () => {
  it('adds a stamp for the given day', () => {
    const store = makeStore();
    const set = markWritingDay(store, NOON(2026, 7, 31));
    expect(set.has('2026-07-31')).toBe(true);
    expect(set.size).toBe(1);
  });

  it('is idempotent for the same day', () => {
    const store = makeStore();
    markWritingDay(store, NOON(2026, 7, 31));
    markWritingDay(store, NOON(2026, 7, 31));
    const set = markWritingDay(store, NOON(2026, 7, 31));
    expect(set.size).toBe(1);
  });

  it('persists to the store and survives a fresh store read', () => {
    const store = makeStore();
    markWritingDay(store, NOON(2026, 7, 31));
    // Re-read via the same key — the persisted JSON should round-trip.
    const raw = store.getItem(STREAK_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw)).toContain('2026-07-31');
  });

  it('accumulates distinct days', () => {
    const store = makeStore();
    markWritingDay(store, NOON(2026, 7, 30));
    markWritingDay(store, NOON(2026, 7, 31));
    markWritingDay(store, NOON(2026, 8, 1));
    const set = markWritingDay(store, NOON(2026, 8, 2));
    expect(set.size).toBe(4);
  });

  it('never throws on a corrupt store (treats as empty and writes fresh)', () => {
    const store = makeStore({ [STREAK_KEY]: '{not valid json' });
    expect(() => markWritingDay(store, NOON(2026, 7, 31))).not.toThrow();
    // A fresh, valid array persists over the corrupt value.
    expect(JSON.parse(store.getItem(STREAK_KEY))).toContain('2026-07-31');
  });
});

describe('currentStreak', () => {
  it('returns 0 on an empty store', () => {
    expect(currentStreak(makeStore(), NOON(2026, 7, 31))).toBe(0);
  });

  it('returns 1 after a single writing day today', () => {
    const store = makeStore();
    markWritingDay(store, NOON(2026, 7, 31));
    expect(currentStreak(store, NOON(2026, 7, 31))).toBe(1);
  });

  it('counts N across N consecutive days', () => {
    const store = makeStore();
    for (let d = 28; d <= 31; d++) markWritingDay(store, NOON(2026, 7, d));
    expect(currentStreak(store, NOON(2026, 7, 31))).toBe(4);
  });

  it('resets after a gap (only counts the trailing run)', () => {
    const store = makeStore();
    markWritingDay(store, NOON(2026, 7, 28));
    markWritingDay(store, NOON(2026, 7, 29));
    // Gap on the 30th.
    markWritingDay(store, NOON(2026, 7, 31));
    expect(currentStreak(store, NOON(2026, 7, 31))).toBe(1);
  });

  it('anchors on yesterday at the midnight rollover (before today is marked)', () => {
    // Wrote yesterday and the day before; today is not yet marked.
    const store = makeStore();
    markWritingDay(store, NOON(2026, 7, 30));
    markWritingDay(store, NOON(2026, 7, 31));
    // "Now" is 2026-08-01 but today has no stamp yet — streak should still read 2.
    expect(currentStreak(store, NOON(2026, 8, 1))).toBe(2);
    // …and extends once today is marked.
    markWritingDay(store, NOON(2026, 8, 1));
    expect(currentStreak(store, NOON(2026, 8, 1))).toBe(3);
  });

  it('returns 0 when yesterday was not a writing day and today is unmarked', () => {
    const store = makeStore();
    markWritingDay(store, NOON(2026, 7, 28));
    // Two-day gap to today (2026-07-31). Anchor on 2026-07-30, no stamp → 0.
    expect(currentStreak(store, NOON(2026, 7, 31))).toBe(0);
  });

  it('is deterministic with an injected `now`', () => {
    const store = makeStore();
    markWritingDay(store, NOON(2026, 1, 1));
    // Exactly one day in, regardless of real wall-clock.
    expect(currentStreak(store, NOON(2026, 1, 1))).toBe(1);
  });
});

describe('bestStreak', () => {
  it('returns 0 for an empty store', () => {
    expect(bestStreak(makeStore())).toBe(0);
  });

  it('returns 1 for a single day', () => {
    const store = makeStore();
    markWritingDay(store, NOON(2026, 7, 31));
    expect(bestStreak(store)).toBe(1);
  });

  it('returns the longest run across gaps', () => {
    const store = makeStore();
    // Run of 2 (28, 29), gap, run of 3 (31, 1, 2).
    markWritingDay(store, NOON(2026, 7, 28));
    markWritingDay(store, NOON(2026, 7, 29));
    markWritingDay(store, NOON(2026, 7, 31));
    markWritingDay(store, NOON(2026, 8, 1));
    markWritingDay(store, NOON(2026, 8, 2));
    expect(bestStreak(store)).toBe(3);
  });

  it('handles out-of-order insertion (sorts internally)', () => {
    const store = makeStore();
    markWritingDay(store, NOON(2026, 8, 2));
    markWritingDay(store, NOON(2026, 7, 31));
    markWritingDay(store, NOON(2026, 8, 1));
    expect(bestStreak(store)).toBe(3);
  });

  it('recovers to 0 on a corrupt store', () => {
    const store = makeStore({ [STREAK_KEY]: 'not-json' });
    expect(bestStreak(store)).toBe(0);
  });
});

describe('formatStreakChip', () => {
  it('returns "" for 0', () => {
    expect(formatStreakChip(0)).toBe('');
  });

  it('returns "" for 1 (a streak starts at 2)', () => {
    expect(formatStreakChip(1)).toBe('');
  });

  it('returns "🔥 N" for N >= 2', () => {
    expect(formatStreakChip(2)).toBe('🔥 2');
    expect(formatStreakChip(7)).toBe('🔥 7');
    expect(formatStreakChip(30)).toBe('🔥 30');
  });

  it('coerces non-numbers / negatives safely', () => {
    expect(formatStreakChip(NaN)).toBe('');
    expect(formatStreakChip(-5)).toBe('');
    expect(formatStreakChip(null)).toBe('');
    expect(formatStreakChip(undefined)).toBe('');
  });
});
