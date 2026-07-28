// v0.45.0: Pure helpers for the local version-history feature. The Rust side
// (write_snapshot / list_snapshots / read_snapshot) owns the filesystem; this
// module shapes the picker data and formats timestamps so the logic is unit-
// testable in isolation. main.js wires these into the "Restore version…"
// command.

// Format a snapshot timestamp (unix ms) as a relative label for "just now" /
// "N min ago" / "N hr ago" / "N days ago", falling back to an absolute local
// date for anything older than a week. Kept pure by accepting a `now` arg
// (defaults to Date.now()) so tests are deterministic.
export function formatSnapshotTime(ts, now = Date.now()) {
  if (!Number.isFinite(ts)) return '';
  const diffMs = Math.max(0, now - ts);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  // Older than a week → absolute local date. The leading check guards against
  // invalid dates (NaN → '' above).
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Build picker entries from a raw [{ ts, size }] list. Adds a relative-time
// label and a human-readable size. Sorted newest-first (the Rust command
// already sorts, but we re-sort defensively in case the caller didn't).
export function toSnapshotEntries(raw) {
  const list = (raw || []).slice().sort((a, b) => b.ts - a.ts);
  return list.map((s) => ({
    ts: s.ts,
    label: formatSnapshotTime(s.ts),
    size: formatBytes(s.size || 0),
  }));
}

// Format a byte count as a short human string (e.g. 1234 → "1.2 KB").
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Prune a raw snapshot list to the N newest (the Rust command already prunes
// server-side; this is a pure mirror for tests + any client-side limiting).
export function pruneList(raw, keep = 25) {
  return (raw || []).slice().sort((a, b) => b.ts - a.ts).slice(0, keep);
}
