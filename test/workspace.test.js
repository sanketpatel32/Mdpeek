// Unit tests for the v0.33.0 Workspace pure-logic modules.
// These run before any UI wiring so logic bugs surface early.
import { describe, it, expect } from 'vitest';
import {
  dateStamp, todayStamp, parseStamp, isDailyNoteName, monthLabel,
  calendarGrid, daysBetween, addDays, isToday, isPast, countWords,
} from '../src/lib/dates.js';
import {
  DEFAULT_EASE, MIN_EASE, newCard, review, isDue, daysUntilDue,
} from '../src/lib/srs.js';
import { parseFlashcards } from '../src/lib/flashcards.js';
import {
  initialState, loadState, saveState, clearState, start, pause, tick,
  skipPhase, reset, formatTime, phaseLabel, phaseSeconds,
} from '../src/lib/pomodoro.js';
import {
  normalizeNoteTasks, normalizeKanbanTasks, mergeTasks, filterTasks, sortTasks, taskStats,
} from '../src/lib/tasks.js';

describe('dates.js — calendar + stamp math', () => {
  it('dateStamp formats a Date as YYYY-MM-DD (local)', () => {
    expect(dateStamp(new Date(2026, 6, 25))).toBe('2026-07-25');
    expect(dateStamp(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('todayStamp matches dateStamp(new Date())', () => {
    const now = new Date(2026, 6, 25, 14, 30);
    expect(todayStamp(now)).toBe('2026-07-25');
  });

  it('parseStamp round-trips and rejects invalid dates', () => {
    expect(parseStamp('2026-07-25')).toEqual(new Date(2026, 6, 25));
    expect(parseStamp('2026-02-31')).toBeNull(); // rollover
    expect(parseStamp('not-a-date')).toBeNull();
    expect(parseStamp('')).toBeNull();
  });

  it('isDailyNoteName matches YYYY-MM-DD.md only', () => {
    expect(isDailyNoteName('2026-07-25.md')).toBe(true);
    expect(isDailyNoteName('2026-7-5.md')).toBe(false);
    expect(isDailyNoteName('notes.md')).toBe(false);
    expect(isDailyNoteName('2026-07-25.txt')).toBe(false);
  });

  it('monthLabel produces "July 2026"', () => {
    expect(monthLabel(2026, 6, 'en-US')).toBe('July 2026');
  });

  it('calendarGrid returns 42 cells starting on Monday', () => {
    // July 2026: the 1st is a Wednesday. Monday-start grid should begin Mon Jun 29.
    const cells = calendarGrid(2026, 6, 1);
    expect(cells.length).toBe(42);
    expect(cells[0].stamp).toBe('2026-06-29'); // Mon
    expect(cells[0].inMonth).toBe(false);
    // Find the 1st of July in the grid.
    const jul1 = cells.find((c) => c.stamp === '2026-07-01');
    expect(jul1).toBeTruthy();
    expect(jul1.inMonth).toBe(true);
    expect(jul1.date.getDay()).toBe(3); // Wednesday
  });

  it('calendarGrid with Sunday start begins on the preceding Sunday', () => {
    const cells = calendarGrid(2026, 6, 0);
    expect(cells[0].date.getDay()).toBe(0); // Sunday
  });

  it('daysBetween is whole-day diff', () => {
    expect(daysBetween(new Date(2026, 6, 27), new Date(2026, 6, 25))).toBe(2);
    expect(daysBetween(new Date(2026, 6, 25), new Date(2026, 6, 27))).toBe(-2);
  });

  it('addDays returns a new Date', () => {
    const d = new Date(2026, 6, 25);
    const e = addDays(d, 5);
    expect(dateStamp(e)).toBe('2026-07-30');
    expect(dateStamp(d)).toBe('2026-07-25'); // input untouched
  });

  it('isToday and isPast', () => {
    const now = new Date(2026, 6, 25, 12);
    expect(isToday('2026-07-25', now)).toBe(true);
    expect(isToday('2026-07-24', now)).toBe(false);
    expect(isPast('2026-07-24', now)).toBe(true);
    expect(isPast('2026-07-25', now)).toBe(false); // today is not "past"
    expect(isPast('2026-07-26', now)).toBe(false);
  });

  it('countWords counts whitespace-separated tokens', () => {
    expect(countWords('hello world')).toBe(2);
    expect(countWords('')).toBe(0);
    expect(countWords('   one   two\nthree ')).toBe(3);
  });
});

describe('srs.js — SM-2 scheduling', () => {
  it('newCard is due today with default ease', () => {
    const now = new Date(2026, 6, 25);
    const c = newCard(now);
    expect(c.ease).toBe(DEFAULT_EASE);
    expect(c.interval).toBe(0);
    expect(c.reps).toBe(0);
    expect(isDue(c, now)).toBe(true);
  });

  it('first "good" review schedules 1 day out', () => {
    const now = new Date(2026, 6, 25);
    const c = review(newCard(now), 'good', now);
    expect(c.reps).toBe(1);
    expect(c.interval).toBe(1);
    expect(daysUntilDue(c, now)).toBe(1);
  });

  it('second "good" review schedules 3 days out', () => {
    const now = new Date(2026, 6, 25);
    let c = review(newCard(now), 'good', now);
    c = review(c, 'good', now);
    expect(c.reps).toBe(2);
    expect(c.interval).toBe(3);
  });

  it('"easy" grows faster than "good"', () => {
    const now = new Date(2026, 6, 25);
    let easy = newCard(now);
    let good = newCard(now);
    for (let i = 0; i < 4; i++) {
      easy = review(easy, 'easy', now);
      good = review(good, 'good', now);
    }
    expect(easy.interval).toBeGreaterThan(good.interval);
    expect(easy.ease).toBeGreaterThanOrEqual(good.ease);
  });

  it('"again" lapses: resets reps, 1-day interval, ease penalty', () => {
    const now = new Date(2026, 6, 25);
    let c = review(newCard(now), 'good', now);
    c = review(c, 'good', now);
    expect(c.reps).toBe(2);
    const lapsed = review(c, 'again', now);
    expect(lapsed.reps).toBe(0);
    expect(lapsed.interval).toBe(1);
    expect(lapsed.ease).toBeLessThan(c.ease);
    expect(lapsed.ease).toBeGreaterThanOrEqual(MIN_EASE);
  });

  it('ease never drops below MIN_EASE', () => {
    const now = new Date(2026, 6, 25);
    let c = newCard(now);
    for (let i = 0; i < 20; i++) c = review(c, 'again', now);
    expect(c.ease).toBeGreaterThanOrEqual(MIN_EASE);
  });

  it('isDue treats future cards as not due', () => {
    const now = new Date(2026, 6, 25);
    const c = review(newCard(now), 'good', now); // due tomorrow
    expect(isDue(c, now)).toBe(false);
    // Simulate a day passing.
    const tomorrow = new Date(2026, 6, 26);
    expect(isDue(c, tomorrow)).toBe(true);
  });
});

describe('flashcards.js — parser auto-detects 3 syntaxes', () => {
  it('parses single-line Q::A (bare, bullet, and + forms)', () => {
    const text = [
      'What is 2+2? :: 4',
      '- Capital of France? :: Paris',
      '* Square root of 9? :: 3',
      '+ RGB stands for? :: Red Green Blue',
    ].join('\n');
    const cards = parseFlashcards(text, 'note.md');
    expect(cards.length).toBe(4);
    expect(cards[0]).toMatchObject({ question: 'What is 2+2?', answer: '4', syntax: 'qa', line: 1 });
    expect(cards[1]).toMatchObject({ question: 'Capital of France?', answer: 'Paris', syntax: 'qa', line: 2 });
    // v0.67.0: keys are content-based (stable across line edits), not line-based.
    expect(cards[1].key).toBe('note.md:Capital of France?');
  });

  it('rejects :: without surrounding spaces (URLs, code)', () => {
    const text = 'Visit https://example.com::path\nalso a::b without spaces';
    expect(parseFlashcards(text)).toEqual([]);
  });

  it('parses callout > [!qa] syntax', () => {
    const text = [
      'Some intro.',
      '> [!qa] What is the speed of light?',
      '> Approximately 300,000 km/s in vacuum.',
      '',
      'Normal paragraph after.',
    ].join('\n');
    const cards = parseFlashcards(text, 'physics.md');
    expect(cards.length).toBe(1);
    expect(cards[0].syntax).toBe('callout');
    expect(cards[0].question).toMatch(/speed of light/);
    expect(cards[0].answer).toMatch(/300,000 km\/s/);
    expect(cards[0].line).toBe(2);
  });

  it('parses heading + next paragraph (question-like headings only)', () => {
    const text = [
      '# Notes',
      '',
      '## What is photosynthesis?',
      'Plants converting light into chemical energy.',
      '',
      '## Introduction',  // NOT a question (no ? and no question word)
      'This section introduces the topic.',
      '',
      '### How does a neural network learn?',
      'By adjusting weights via backpropagation.',
    ].join('\n');
    const cards = parseFlashcards(text, 'bio.md');
    expect(cards.length).toBe(2);
    expect(cards[0].question).toMatch(/photosynthesis/);
    expect(cards[1].question).toMatch(/neural network/);
    expect(cards[0].syntax).toBe('heading');
  });

  it('ignores :: inside fenced code blocks', () => {
    const text = [
      'What is 1+1? :: 2',
      '```',
      'const x = a::b;  // not a card',
      '```',
      'Real? :: yes',
    ].join('\n');
    const cards = parseFlashcards(text);
    expect(cards.length).toBe(2);
    expect(cards[0].question).toBe('What is 1+1?');
    expect(cards[1].question).toBe('Real?');
  });

  it('returns empty for empty/null input', () => {
    expect(parseFlashcards('')).toEqual([]);
    expect(parseFlashcards(null)).toEqual([]);
  });
});

describe('pomodoro.js — timer state machine', () => {
  it('initialState starts a 25:00 focus phase, not running', () => {
    const s = initialState();
    expect(s.phase).toBe('focus');
    expect(s.remaining).toBe(25 * 60);
    expect(s.running).toBe(false);
    expect(s.cycle).toBe(0);
  });

  it('start/pause toggle running without changing remaining', () => {
    const s0 = initialState();
    const s1 = start(s0);
    expect(s1.running).toBe(true);
    const s2 = pause(s1);
    expect(s2.running).toBe(false);
    expect(s2.remaining).toBe(s0.remaining);
  });

  it('tick decrements remaining and reports not finished', () => {
    const s = start(initialState());
    const r = tick(s, 5);
    expect(r.finished).toBe(false);
    expect(r.state.remaining).toBe(25 * 60 - 5);
  });

  it('tick finishing a focus phase advances to break and stops running', () => {
    const s = { ...initialState(), remaining: 1, running: true, cycle: 0 };
    const r = tick(s, 1);
    expect(r.finished).toBe(true);
    expect(r.completed).toBe('focus');
    expect(r.state.phase).toBe('break');
    expect(r.state.remaining).toBe(5 * 60);
    expect(r.state.running).toBe(false);
    expect(r.state.cycle).toBe(1);
  });

  it('every longEvery focus phases → longbreak', () => {
    let s = initialState();
    s = { ...s, cycle: 3 }; // one more focus completes the 4th
    s = { ...s, phase: 'focus', remaining: 1, running: true };
    const r = tick(s, 1);
    expect(r.state.phase).toBe('longbreak');
    expect(r.state.cycle).toBe(4);
    expect(r.state.remaining).toBe(15 * 60);
  });

  it('a break ending returns to focus', () => {
    const s = { ...initialState(), phase: 'break', remaining: 1, running: true, cycle: 1 };
    const r = tick(s, 1);
    expect(r.state.phase).toBe('focus');
    expect(r.state.remaining).toBe(25 * 60);
  });

  it('formatTime renders M:SS', () => {
    expect(formatTime(25 * 60)).toBe('25:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
  });

  it('phaseLabel + phaseSeconds respect settings', () => {
    expect(phaseLabel('focus')).toBe('Focus');
    expect(phaseLabel('break')).toBe('Break');
    expect(phaseLabel('longbreak')).toBe('Long break');
    const settings = { focus: 30, break: 10, longbreak: 20, longEvery: 4 };
    expect(phaseSeconds('focus', settings)).toBe(30 * 60);
    expect(phaseSeconds('break', settings)).toBe(10 * 60);
    expect(phaseSeconds('longbreak', settings)).toBe(20 * 60);
  });

  it('skipPhase advances without running', () => {
    const s = { ...initialState(), phase: 'focus', remaining: 100, running: true, cycle: 0 };
    const n = skipPhase(s);
    expect(n.phase).toBe('break');
    expect(n.running).toBe(false);
    expect(n.remaining).toBe(5 * 60);
  });

  it('reset returns a fresh focus phase', () => {
    const s = { ...initialState(), cycle: 5, remaining: 3 };
    const r = reset();
    expect(r.cycle).toBe(0);
    expect(r.phase).toBe('focus');
    expect(r.remaining).toBe(25 * 60);
  });

  it('loadState never resumes running on reload', () => {
    saveState({ ...initialState(), running: true, remaining: 123 });
    const loaded = loadState();
    expect(loaded.running).toBe(false);
    expect(loaded.remaining).toBe(123);
    clearState();
  });

  it('clearState removes persisted state', () => {
    saveState(initialState());
    clearState();
    const loaded = loadState();
    expect(loaded.remaining).toBe(25 * 60); // fresh default, not 0
    expect(loaded.cycle).toBe(0);
  });
});

describe('tasks.js — merging Kanban + note checkboxes', () => {
  const noteHits = [
    { path: '/notes/today.md', line: 5, text: '- [ ] Write tests' },
    { path: '/notes/today.md', line: 8, text: '- [x] Ship feature' },
    { path: '/notes/junk.md', line: 1, text: 'see the - [ ] inline in prose' }, // not a real task
    { path: '/notes/today.md', line: 12, text: '* [ ] Another task' },
    { path: '/notes/today.md', line: 15, text: 'plain text with - [ ] stray' }, // prose, no bullet
  ];

  const kanban = [
    { id: 't1', status: 'todo', text: 'Design calendar', createdAt: 1000 },
    { id: 't2', status: 'progress', text: 'Build SM-2', createdAt: 2000 },
    { id: 't3', status: 'done', text: 'Setup project', createdAt: 500 },
  ];

  it('normalizeNoteTasks keeps only real GFM task lines', () => {
    const tasks = normalizeNoteTasks(noteHits);
    expect(tasks.length).toBe(3); // the prose hits are filtered out
    expect(tasks.map((t) => t.text)).toEqual(['Write tests', 'Ship feature', 'Another task']);
    expect(tasks[0].kind).toBe('note');
    expect(tasks[0].done).toBe(false);
    expect(tasks[1].done).toBe(true);
    expect(tasks[0].source).toEqual({ path: '/notes/today.md', line: 5 });
  });

  it('normalizeKanbanTasks maps status→done and skips done by default', () => {
    const tasks = normalizeKanbanTasks(kanban);
    expect(tasks.length).toBe(2); // the done one is excluded
    expect(tasks[0]).toMatchObject({ id: 'kanban:t1', kind: 'kanban', done: false, column: 'todo' });
  });

  it('normalizeKanbanTasks includeDone=true keeps all', () => {
    const tasks = normalizeKanbanTasks(kanban, true);
    expect(tasks.length).toBe(3);
    expect(tasks[2].done).toBe(true);
  });

  it('mergeTasks concatenates kanban + note', () => {
    const k = normalizeKanbanTasks(kanban);
    const n = normalizeNoteTasks(noteHits);
    const merged = mergeTasks(k, n);
    expect(merged.length).toBe(2 + 3);
  });

  it('filterTasks matches text and source path', () => {
    const k = normalizeKanbanTasks(kanban);
    const n = normalizeNoteTasks(noteHits);
    const merged = mergeTasks(k, n);
    expect(filterTasks(merged, 'tests').length).toBe(1);
    expect(filterTasks(merged, 'today.md').length).toBe(3);
    expect(filterTasks(merged, '').length).toBe(5);
  });

  it('sortTasks "source" groups notes by file', () => {
    const n = normalizeNoteTasks(noteHits);
    const sorted = sortTasks(n, 'source');
    expect(sorted[0].source.path).toBe('/notes/today.md');
    // All today.md lines should cluster before junk.md lines.
  });

  it('taskStats counts open vs done', () => {
    const k = normalizeKanbanTasks(kanban, true);
    const stats = taskStats(k);
    expect(stats).toEqual({ open: 2, done: 1, total: 3 });
  });
});
