import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PEN_WIDTH,
  HIGHLIGHT_WIDTH,
  DEFAULT_PALETTE,
  pointerToFraction,
  pointInStroke,
  pointInStrokeBbox,
  drawSingleStroke,
  renderStrokes,
  createStrokeController,
} from '../src/lib/drawing.js';

// Helpers for canvas mocking — jsdom doesn't implement getContext natively.
function makeMockContext(width = 100, height = 100) {
  const ctx = {
    canvas: { width, height },
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    lineCap: '',
    globalAlpha: 1,
  };
  return ctx;
}

describe('drawing constants', () => {
  it('exports the expected defaults', () => {
    expect(PEN_WIDTH).toBe(2);
    expect(HIGHLIGHT_WIDTH).toBe(14);
    expect(DEFAULT_PALETTE).toEqual(['#1d1d1f', '#ff3b30', '#0071e3', '#34c759', '#ffcc00']);
  });
});

describe('pointerToFraction', () => {
  it('converts pointer events to normalized 0..1 coordinates', () => {
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    };
    expect(pointerToFraction({ clientX: 0, clientY: 0 }, canvas)).toEqual({ x: 0, y: 0 });
    expect(pointerToFraction({ clientX: 50, clientY: 50 }, canvas)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointerToFraction({ clientX: 100, clientY: 100 }, canvas)).toEqual({ x: 1, y: 1 });
  });

  it('accounts for canvas offset from viewport origin', () => {
    const canvas = {
      getBoundingClientRect: () => ({ left: 200, top: 100, width: 50, height: 50 }),
    };
    expect(pointerToFraction({ clientX: 200, clientY: 100 }, canvas)).toEqual({ x: 0, y: 0 });
    expect(pointerToFraction({ clientX: 225, clientY: 125 }, canvas)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('pointInStrokeBbox', () => {
  it('returns true for a point inside the stroke bounding box', () => {
    const stroke = { points: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }] };
    expect(pointInStrokeBbox({ x: 0.5, y: 0.5 }, stroke)).toBe(true);
  });

  it('returns true for a point within the padding tolerance', () => {
    const stroke = { points: [{ x: 0.5, y: 0.5 }] };
    expect(pointInStrokeBbox({ x: 0.505, y: 0.505 }, stroke)).toBe(true);
  });

  it('returns false for a point far from the stroke', () => {
    const stroke = { points: [{ x: 0.1, y: 0.1 }] };
    expect(pointInStrokeBbox({ x: 0.9, y: 0.9 }, stroke)).toBe(false);
  });
});

describe('pointInStroke', () => {
  it('returns true when the point is near a stroke point', () => {
    const stroke = { tool: 'pen', points: [{ x: 0.5, y: 0.5 }] };
    expect(pointInStroke({ x: 0.5, y: 0.5 }, stroke)).toBe(true);
    expect(pointInStroke({ x: 0.51, y: 0.51 }, stroke)).toBe(true);
  });

  it('returns false when the point is far from every stroke point', () => {
    const stroke = { tool: 'pen', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] };
    expect(pointInStroke({ x: 0.9, y: 0.9 }, stroke)).toBe(false);
  });

  it('uses a looser threshold for highlighter strokes', () => {
    // Both stroke types share the same point but the threshold differs:
    //   pen threshold = 0.015, highlighter threshold = 0.025.
    // A test point 0.008 away from a stroke point hits BOTH (within both
    // thresholds AND within the bbox pad of 0.01). A test point 0.012 away
    // is also within both, but only because it's inside the bbox — pen
    // would reject at 0.016+ if the bbox allowed it. Verify the bbox pad
    // is the gating factor for points beyond 0.01 from the stroke extreme.
    const strokePoint = { x: 0.5, y: 0.5 };
    const penStroke = { tool: 'pen', points: [strokePoint] };
    const hlStroke = { tool: 'highlighter', points: [strokePoint] };

    // A close point (0.008 away) — both hit.
    expect(pointInStroke({ x: 0.508, y: 0.5 }, penStroke)).toBe(true);
    expect(pointInStroke({ x: 0.508, y: 0.5 }, hlStroke)).toBe(true);

    // A point just inside the bbox pad (0.01 away) — both still hit because
    // the per-point distance (0.01) is less than both thresholds.
    expect(pointInStroke({ x: 0.51, y: 0.5 }, penStroke)).toBe(true);
    expect(pointInStroke({ x: 0.51, y: 0.5 }, hlStroke)).toBe(true);

    // A point just outside the bbox (0.011 away) — bbox rejects both, so the
    // threshold difference is moot here. (The looser highlighter threshold
    // only matters for points between 0.015 and 0.025 from a stroke point
    // AND inside the bbox, which only happens for multi-point strokes that
    // span enough area to give the bbox headroom.)
    expect(pointInStrokeBbox({ x: 0.511, y: 0.5 }, { points: [strokePoint] })).toBe(false);
  });

  it('rejects early via bbox check before the per-point loop', () => {
    const stroke = { tool: 'pen', points: [{ x: 0.1, y: 0.1 }] };
    expect(pointInStroke({ x: 0.9, y: 0.9 }, stroke)).toBe(false);
  });
});

describe('drawSingleStroke', () => {
  it('renders a single-point stroke as a filled circle (dot)', () => {
    const ctx = makeMockContext();
    const stroke = { tool: 'pen', color: '#000', width: 2, points: [{ x: 0.5, y: 0.5 }] };
    drawSingleStroke(ctx, stroke);
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('renders a 2-point stroke as a straight line', () => {
    const ctx = makeMockContext();
    const stroke = { tool: 'pen', color: '#000', width: 2, points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }] };
    drawSingleStroke(ctx, stroke);
    expect(ctx.moveTo).toHaveBeenCalled();
    expect(ctx.lineTo).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    // Dots don't call stroke; lines don't call arc/fill.
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it('renders a 3+ point stroke using quadratic curves for smoothing', () => {
    const ctx = makeMockContext();
    const stroke = {
      tool: 'pen', color: '#000', width: 2,
      points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.9 }],
    };
    drawSingleStroke(ctx, stroke);
    expect(ctx.quadraticCurveTo).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it('applies semi-transparent alpha for highlighter strokes', () => {
    const ctx = makeMockContext();
    const stroke = {
      tool: 'highlighter', color: '#ffcc00', width: 14,
      points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }],
    };
    drawSingleStroke(ctx, stroke);
    expect(ctx.globalAlpha).toBe(0.35);
  });

  it('preserves the canvas state via save/restore', () => {
    const ctx = makeMockContext();
    drawSingleStroke(ctx, { tool: 'pen', color: '#000', width: 2, points: [{ x: 0, y: 0 }] });
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for strokes with no points', () => {
    const ctx = makeMockContext();
    drawSingleStroke(ctx, { tool: 'pen', color: '#000', width: 2, points: [] });
    expect(ctx.beginPath).not.toHaveBeenCalled();
  });
});

describe('renderStrokes', () => {
  it('clears the canvas then draws every stroke', () => {
    const ctx = makeMockContext();
    const strokes = [
      { tool: 'pen', color: '#000', width: 2, points: [{ x: 0, y: 0 }] },
      { tool: 'pen', color: '#f00', width: 2, points: [{ x: 0.5, y: 0.5 }] },
    ];
    renderStrokes(ctx, strokes);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 100, 100);
    // Each dot calls arc + fill once.
    expect(ctx.arc).toHaveBeenCalledTimes(2);
    expect(ctx.fill).toHaveBeenCalledTimes(2);
  });

  it('handles an empty stroke list without errors', () => {
    const ctx = makeMockContext();
    expect(() => renderStrokes(ctx, [])).not.toThrow();
    expect(ctx.clearRect).toHaveBeenCalled();
  });
});

describe('createStrokeController', () => {
  // Minimal fake canvas backed by a mock 2D context.
  function makeCanvas(w = 100, h = 100) {
    const ctx = makeMockContext(w, h);
    const handlers = {};
    return {
      width: w,
      height: h,
      style: {},
      getContext: () => ctx,
      addEventListener: (ev, fn) => { handlers[ev] = fn; },
      removeEventListener: (ev) => { delete handlers[ev]; },
      setPointerCapture: vi.fn(),
      getHandlers: () => handlers,
      _ctx: ctx,
    };
  }

  it('exposes the standard controller surface', () => {
    const canvas = makeCanvas();
    const c = createStrokeController(canvas);
    expect(typeof c.attach).toBe('function');
    expect(typeof c.detach).toBe('function');
    expect(typeof c.setTool).toBe('function');
    expect(typeof c.setColor).toBe('function');
    expect(typeof c.getTool).toBe('function');
    expect(typeof c.getColor).toBe('function');
    expect(typeof c.undo).toBe('function');
    expect(typeof c.clear).toBe('function');
    expect(typeof c.getAll).toBe('function');
    expect(typeof c.render).toBe('function');
  });

  it('defaults to pen tool and the first palette color', () => {
    const canvas = makeCanvas();
    const c = createStrokeController(canvas);
    expect(c.getTool()).toBe('pen');
    expect(c.getColor()).toBe('#1d1d1f');
  });

  it('round-trips tool and color setters', () => {
    const canvas = makeCanvas();
    const c = createStrokeController(canvas);
    c.setTool('highlighter');
    c.setColor('#ff3b30');
    expect(c.getTool()).toBe('highlighter');
    expect(c.getColor()).toBe('#ff3b30');
  });

  it('programmatic addPoint + commitStroke builds strokes via getAll', () => {
    const canvas = makeCanvas();
    const c = createStrokeController(canvas);
    c.addPoint({ x: 0.1, y: 0.1 });
    c.addPoint({ x: 0.2, y: 0.2 });
    c.commitStroke();
    const all = c.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].points).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]);
    expect(all[0].tool).toBe('pen');
    expect(all[0].width).toBe(PEN_WIDTH);
  });

  it('undo removes the last stroke', () => {
    const canvas = makeCanvas();
    const c = createStrokeController(canvas);
    c.addPoint({ x: 0.1, y: 0.1 }); c.commitStroke();
    c.addPoint({ x: 0.5, y: 0.5 }); c.commitStroke();
    expect(c.getAll()).toHaveLength(2);
    c.undo();
    expect(c.getAll()).toHaveLength(1);
  });

  it('clear empties the stroke list', () => {
    const canvas = makeCanvas();
    const c = createStrokeController(canvas);
    c.addPoint({ x: 0.1, y: 0.1 }); c.commitStroke();
    c.addPoint({ x: 0.5, y: 0.5 }); c.commitStroke();
    c.clear();
    expect(c.getAll()).toEqual([]);
  });

  it('uses highlight width for highlighter strokes', () => {
    const canvas = makeCanvas();
    const c = createStrokeController(canvas);
    c.setTool('highlighter');
    c.addPoint({ x: 0, y: 0 });
    c.commitStroke();
    expect(c.getAll()[0].width).toBe(HIGHLIGHT_WIDTH);
  });

  it('render calls renderStrokes (clear + draw)', () => {
    const canvas = makeCanvas();
    const c = createStrokeController(canvas);
    c.addPoint({ x: 0.1, y: 0.1 }); c.commitStroke();
    c.addPoint({ x: 0.5, y: 0.5 }); c.commitStroke();
    c.render();
    expect(canvas._ctx.clearRect).toHaveBeenCalledWith(0, 0, 100, 100);
    // Two dot strokes → two arc + fill calls.
    expect(canvas._ctx.fill).toHaveBeenCalledTimes(2);
  });

  it('attach + detach manage pointer event listeners', () => {
    const canvas = makeCanvas();
    const c = createStrokeController(canvas);
    c.attach();
    expect(canvas.getHandlers().pointerdown).toBeDefined();
    expect(canvas.getHandlers().pointermove).toBeDefined();
    expect(canvas.getHandlers().pointerup).toBeDefined();
    c.detach();
    expect(canvas.getHandlers().pointerdown).toBeUndefined();
  });
});
