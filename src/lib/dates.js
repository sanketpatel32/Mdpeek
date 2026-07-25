// Date utilities for the Workspace hub (Calendar view + SM-2 due-date math).
// Pure functions — no DOM, no I/O. Unit-tested in test/workspace.test.js.
// Uses the native Date API (no dayjs/date-fns dependency).
//
// Convention: months are 0-indexed internally (Date-native) but the calendar
// grid helpers accept/pass 0-indexed months too; callers convert to/from the
// "YYYY-MM-DD" filename string via dateStamp().

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Format a Date as "YYYY-MM-DD" (local time). Matches the daily-note filename. */
export function dateStamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today's date as "YYYY-MM-DD". */
export function todayStamp(now = new Date()) {
  return dateStamp(now);
}

/** Parse a "YYYY-MM-DD" string into a local Date at midnight. Returns null on bad input. */
export function parseStamp(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(stamp || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Reject rollover (e.g. "2026-02-31" → March 3).
  if (d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
}

/** True if the stamp looks like a daily-note date: /^\d{4}-\d{2}-\d{2}\.md$/ */
export function isDailyNoteName(name) {
  return /^\d{4}-\d{2}-\d{2}\.md$/.test(name || '');
}

/** "July 2026" — human label for a calendar month header. */
export function monthLabel(year, month0, locale) {
  const d = new Date(year, month0, 1);
  return d.toLocaleDateString(locale || undefined, { month: 'long', year: 'numeric' });
}

/** Day-of-week short labels for the calendar header row, locale-aware.
 *  Returns ["Mo", "Tu", ...] style array starting from the locale's first day. */
export function weekdayLabels(locale, firstDayOfWeek = 1) {
  // Build 7 labels starting from `firstDayOfWeek` (1=Mon, 0=Sun).
  const out = [];
  const base = new Date(2024, 0, 7); // 2024-01-07 is a Sunday — stable reference
  for (let i = 0; i < 7; i++) {
    const day = (firstDayOfWeek + i) % 7;
    const d = new Date(base);
    d.setDate(base.getDate() + day);
    out.push(d.toLocaleDateString(locale || undefined, { weekday: 'short' }));
  }
  return out;
}

/**
 * Build a 6×7 calendar grid for a given month.
 * Each cell is { stamp, inMonth, date } where `inMonth` flags the leading/
 * trailing days from adjacent months. The grid always starts on the locale's
 * first day of the week so the columns align.
 * @param {number} year   full year (e.g. 2026)
 * @param {number} month0 0-indexed month (0=January)
 * @param {number} [firstDayOfWeek=1] 0=Sunday, 1=Monday
 * @returns {Array<{stamp:string, inMonth:boolean, date:Date}>} 42 cells (6 rows)
 */
export function calendarGrid(year, month0, firstDayOfWeek = 1) {
  const first = new Date(year, month0, 1);
  // Offset from the 1st to the grid's start cell.
  const offset = (first.getDay() - firstDayOfWeek + 7) % 7;
  const start = new Date(year, month0, 1 - offset);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({
      stamp: dateStamp(d),
      inMonth: d.getMonth() === month0,
      date: d,
    });
  }
  return cells;
}

/** Whole days between two Dates (a - b), positive if a is later. */
export function daysBetween(a, b) {
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  return Math.round((stripTime(da) - stripTime(db)) / MS_PER_DAY);
}

/** Add days to a Date, returning a new Date. */
export function addDays(date, days) {
  const d = new Date(date instanceof Date ? date : new Date(date));
  d.setDate(d.getDate() + days);
  return d;
}

/** Whether a stamp/date is today. */
export function isToday(stamp, now = new Date()) {
  const s = stamp instanceof Date ? dateStamp(stamp) : String(stamp);
  return s === todayStamp(now);
}

/** Whether a stamp/date is in the past (before today, day-level). */
export function isPast(stamp, now = new Date()) {
  const d = stamp instanceof Date ? stamp : parseStamp(stamp);
  if (!d) return false;
  return daysBetween(d, now) < 0;
}

/** Strip time-of-day, returning a Date at local midnight. */
function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Count words in a chunk of text (cheap; for calendar day-cell stats). */
export function countWords(text) {
  if (!text) return 0;
  const m = String(text).trim().match(/\S+/g);
  return m ? m.length : 0;
}
