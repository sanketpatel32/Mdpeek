// SM-2 spaced-repetition scheduling (the Anki algorithm).
// Pure functions — no DOM, no I/O. Unit-tested in test/workspace.test.js.
//
// Each card's scheduling state: { ease, interval (days), reps, due (YYYY-MM-DD), last }.
// Rating scale (SuperMemo quality, mapped to 4 buttons):
//   'again'  → forgot; reset reps, short interval (1 day).
//   'hard'   → barely; small ease penalty, modest interval.
//   'good'   → normal; interval × ease (the default action).
//   'easy'   → trivial; ease boost, longer interval.
//
// References: https://www.supermemo.com/en/blog/application-of-a-computer-algorithm-to-improve-learning

import { addDays, todayStamp } from './dates.js';

export const DEFAULT_EASE = 2.5;
export const MIN_EASE = 1.3;
export const MIN_INTERVAL = 1;       // days
const MS = 1; // (kept for clarity; intervals are in days)

/** A fresh card state — never reviewed, due immediately. */
export function newCard(now = new Date()) {
  return {
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
    due: todayStamp(now),
    last: null,
  };
}

/**
 * Apply a review rating to a card, returning the next scheduling state.
 * Pure: does not mutate the input.
 *
 * @param {object} card   { ease, interval, reps, due, last }
 * @param {('again'|'hard'|'good'|'easy')} rating
 * @param {Date}   [now]
 * @returns {object} new card state with updated ease/interval/reps/due/last
 */
export function review(card, rating, now = new Date()) {
  const c = { ...newCard(now), ...card };
  let { ease, interval, reps } = c;

  // Lapse: "again" resets the learning and caps the next interval at 1 day.
  if (rating === 'again') {
    ease = Math.max(MIN_EASE, ease - 0.2);
    reps = 0;
    return {
      ease,
      interval: MIN_INTERVAL,
      reps,
      due: stampForDays(MIN_INTERVAL, now),
      last: todayStamp(now),
    };
  }

  // First successful review: fixed short intervals (SM-2 convention).
  if (reps === 0) {
    interval = rating === 'easy' ? 4 : (rating === 'hard' ? 1 : 1);
  } else if (reps === 1) {
    interval = rating === 'easy' ? 6 : (rating === 'hard' ? 3 : 3);
  } else {
    // Subsequent reviews: interval × ease, with hard/easy nudges.
    let factor = ease;
    if (rating === 'hard') factor = 1.2;
    else if (rating === 'easy') factor = ease * 1.3;
    interval = Math.max(MIN_INTERVAL, Math.round(c.interval * factor));
    // Ease nudges (SM-2 maps quality→delta; here we use a simplified 4-button form).
    if (rating === 'hard') ease = Math.max(MIN_EASE, ease - 0.15);
    else if (rating === 'good') ease = ease + 0.0; // stable
    else if (rating === 'easy') ease = ease + 0.15;
  }

  reps += 1;
  return {
    ease,
    interval: Math.max(MIN_INTERVAL, interval),
    reps,
    due: stampForDays(Math.max(MIN_INTERVAL, interval), now),
    last: todayStamp(now),
  };
}

/** Is a card due on/before today (i.e. should be reviewed now)? */
export function isDue(card, now = new Date()) {
  if (!card || !card.due) return true;
  const today = todayStamp(now);
  return card.due <= today;
}

/** Days until a card is due (negative = overdue). */
export function daysUntilDue(card, now = new Date()) {
  if (!card || !card.due) return 0;
  const today = parseToDays(todayStamp(now));
  const due = parseToDays(card.due);
  return due - today;
}

// --- internals ---------------------------------------------------------

function stampForDays(days, now) {
  const d = addDays(now, days);
  // Use the same date-only stamp as the rest of the app.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parseToDays(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(stamp));
  if (!m) return 0;
  // Days since epoch (local) — sufficient for comparisons.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.floor(d.getTime() / (24 * 60 * 60 * 1000));
}
