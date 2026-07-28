import { describe, it, expect } from 'vitest';
import { goalProgress, formatGoalChip, GOAL_KEY, SESSION_KEY } from '../src/lib/writing-goal.js';

describe('goalProgress', () => {
  it('returns null when no goal is set', () => {
    expect(goalProgress(100, 0)).toBeNull();
    expect(goalProgress(100, null)).toBeNull();
    expect(goalProgress(100, undefined)).toBeNull();
    expect(goalProgress(100, NaN)).toBeNull();
    expect(goalProgress(100, -5)).toBeNull();
  });

  it('computes basic progress from session start', () => {
    // Goal 500, started at 100 words, now at 312 → 212 written, 42%.
    const p = goalProgress(312, 500, 100);
    expect(p.written).toBe(212);
    expect(p.goal).toBe(500);
    expect(p.pct).toBe(42);
    expect(p.done).toBe(false);
    expect(p.remaining).toBe(288);
  });

  it('caps percentage at 100 and marks done when goal met', () => {
    // Goal 100, started at 0, now at 250 → 250 written, capped at 100%.
    const p = goalProgress(250, 100, 0);
    expect(p.pct).toBe(100);
    expect(p.done).toBe(true);
    expect(p.remaining).toBe(0);
  });

  it('never shows negative progress when words drop below session start', () => {
    // Started at 200, deleted down to 150 — written should be 0, not -50.
    const p = goalProgress(150, 100, 200);
    expect(p.written).toBe(0);
    expect(p.pct).toBe(0);
    expect(p.done).toBe(false);
    expect(p.remaining).toBe(100);
  });

  it('treats missing session as starting from zero', () => {
    const p = goalProgress(50, 100);
    expect(p.written).toBe(50);
    expect(p.pct).toBe(50);
    expect(p.sessionWords).toBe(0);
  });

  it('coerces non-numeric words/goal safely', () => {
    const p = goalProgress('42', '100', '0');
    expect(p.written).toBe(42);
    expect(p.pct).toBe(42);
  });
});

describe('formatGoalChip', () => {
  it('returns empty string when no progress', () => {
    expect(formatGoalChip(null)).toBe('');
    expect(formatGoalChip(undefined)).toBe('');
  });

  it('formats as "written / goal (pct%)"', () => {
    expect(formatGoalChip(goalProgress(312, 500, 100))).toBe('212 / 500 (42%)');
  });
});

describe('keys', () => {
  it('exports stable localStorage key names', () => {
    expect(GOAL_KEY).toBe('mdpeek-writing-goal');
    expect(SESSION_KEY).toBe('mdpeek-writing-session');
  });
});
