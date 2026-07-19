import { describe, it, expect } from 'vitest';
import { NavHistory } from '../src/lib/nav-history.js';

describe('NavHistory', () => {
  it('starts empty', () => {
    const h = new NavHistory();
    expect(h.current).toBeNull();
    expect(h.canBack).toBe(false);
    expect(h.canForward).toBe(false);
  });

  it('records a navigation', () => {
    const h = new NavHistory();
    h.navigate('a');
    expect(h.current).toBe('a');
    expect(h.canBack).toBe(false);
  });

  it('walks back and forward', () => {
    const h = new NavHistory();
    h.navigate('a');
    h.navigate('b');
    h.navigate('c');
    expect(h.current).toBe('c');
    expect(h.back()).toBe('b');
    expect(h.back()).toBe('a');
    expect(h.canBack).toBe(false);
    expect(h.back()).toBeNull();
    expect(h.forward()).toBe('b');
    expect(h.forward()).toBe('c');
    expect(h.canForward).toBe(false);
    expect(h.forward()).toBeNull();
  });

  it('truncates forward history when navigating from the middle', () => {
    const h = new NavHistory();
    h.navigate('a');
    h.navigate('b');
    h.navigate('c');
    h.back(); // now at b
    h.navigate('d'); // abandons c
    expect(h.current).toBe('d');
    expect(h.canForward).toBe(false);
    // Going back should hit b, a — not c.
    expect(h.back()).toBe('b');
    expect(h.back()).toBe('a');
    expect(h.canBack).toBe(false);
  });

  it('does not push duplicate consecutive entries', () => {
    const h = new NavHistory();
    h.navigate('a');
    h.navigate('a');
    h.navigate('a');
    expect(h.current).toBe('a');
    expect(h.canBack).toBe(false);
  });

  it('removes an id from the stack entirely', () => {
    const h = new NavHistory();
    h.navigate('a');
    h.navigate('b');
    h.navigate('c');
    h.remove('b');
    // b is gone — walking back from c should land on a directly.
    expect(h.back()).toBe('a');
    expect(h.forward()).toBe('c');
  });

  it('clamps cursor when removing the current entry', () => {
    const h = new NavHistory();
    h.navigate('a');
    h.navigate('b');
    h.navigate('c');
    h.remove('c');
    expect(h.current).toBe('b');
  });

  it('suppress() blocks navigate() calls', () => {
    const h = new NavHistory();
    h.navigate('a');
    h.suppress();
    h.navigate('b');
    expect(h.current).toBe('a'); // suppressed — no change
    h.unsuppress();
    h.navigate('b');
    expect(h.current).toBe('b');
  });

  it('ignores null and undefined navigations', () => {
    const h = new NavHistory();
    h.navigate('a');
    h.navigate(null);
    h.navigate(undefined);
    expect(h.current).toBe('a');
  });

  it('clear() resets the stack', () => {
    const h = new NavHistory();
    h.navigate('a');
    h.navigate('b');
    h.clear();
    expect(h.current).toBeNull();
    expect(h.canBack).toBe(false);
  });
});
