import { describe, it, expect } from 'vitest';
import { formatSnapshotTime, toSnapshotEntries, formatBytes, pruneList } from '../src/lib/snapshots.js';

describe('formatSnapshotTime', () => {
  const now = new Date('2026-07-28T12:00:00Z').getTime();

  it('returns "just now" for < 45s', () => {
    expect(formatSnapshotTime(now - 10000, now)).toBe('just now');
    expect(formatSnapshotTime(now - 44000, now)).toBe('just now');
  });

  it('returns "N min ago" for minutes', () => {
    expect(formatSnapshotTime(now - 60000, now)).toBe('1 min ago');
    expect(formatSnapshotTime(now - 5 * 60000, now)).toBe('5 min ago');
  });

  it('returns "N hr ago" for hours', () => {
    expect(formatSnapshotTime(now - 3 * 3600000, now)).toBe('3 hr ago');
  });

  it('returns "N days ago" for days within a week', () => {
    expect(formatSnapshotTime(now - 24 * 3600000, now)).toBe('1 day ago');
    expect(formatSnapshotTime(now - 3 * 24 * 3600000, now)).toBe('3 days ago');
  });

  it('returns an absolute date for older than a week', () => {
    const old = now - 30 * 24 * 3600000; // ~30 days ago
    const label = formatSnapshotTime(old, now);
    // Exact format varies by locale, but it should NOT contain "ago".
    expect(label).not.toContain('ago');
    expect(label.length).toBeGreaterThan(0);
  });

  it('handles invalid timestamps', () => {
    expect(formatSnapshotTime(NaN)).toBe('');
    expect(formatSnapshotTime(undefined)).toBe('');
  });
});

describe('formatBytes', () => {
  it('formats bytes / KB / MB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1234)).toBe('1.2 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
  it('rejects invalid input', () => {
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(NaN)).toBe('');
  });
});

describe('toSnapshotEntries', () => {
  const now = Date.now();
  it('sorts newest-first and adds labels', () => {
    const raw = [
      { ts: now - 60000, size: 100 },
      { ts: now - 120000, size: 200 },
      { ts: now - 30000, size: 50 },
    ];
    const out = toSnapshotEntries(raw);
    expect(out[0].ts).toBe(now - 30000);
    expect(out[0].label).toBe('just now');
    expect(out[1].label).toBe('1 min ago');
    expect(out[2].size).toBe('200 B');
  });

  it('handles an empty list', () => {
    expect(toSnapshotEntries([])).toEqual([]);
    expect(toSnapshotEntries(null)).toEqual([]);
  });
});

describe('pruneList', () => {
  it('keeps the N newest', () => {
    const raw = Array.from({ length: 30 }, (_, i) => ({ ts: 1000 + i }));
    const pruned = pruneList(raw, 25);
    expect(pruned).toHaveLength(25);
    // Newest first → ts 1029 on top.
    expect(pruned[0].ts).toBe(1029);
  });

  it('returns all when under the cap', () => {
    const raw = [{ ts: 1 }, { ts: 2 }];
    expect(pruneList(raw, 25)).toHaveLength(2);
  });
});
