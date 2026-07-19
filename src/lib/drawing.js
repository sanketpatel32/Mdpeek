// Shared drawing-core helpers for stroke-based annotation. Used by the image
// viewer's annotation mode. The PDF viewer has its own tightly-coupled copy
// of this logic in src/views/pdf-viewer.js (kept there because it shares
// state with the multi-page pdf.js render loop); this module is the
// standalone, testable version for surfaces that don't have that constraint.
//
// All coordinates are NORMALIZED (0..1 fractions of the canvas's drawing
// surface) so strokes survive resize and re-render correctly at any DPI.
//
// A stroke is `{ tool, color, width, points: [{x,y}] }` where:
//   - tool: 'pen' | 'highlighter' | 'eraser'
//   - color: CSS color string
//   - width: stroke width in canvas px at scale=1.0 (multiplied by dpr*scale)
//   - points: array of {x,y} in normalized 0..1 coordinates

export const PEN_WIDTH = 2;
export const HIGHLIGHT_WIDTH = 14;
export const DEFAULT_PALETTE = ['#1d1d1f', '#ff3b30', '#0071e3', '#34c759', '#ffcc00'];

// Convert a pointer event's clientX/Y into normalized 0..1 canvas coordinates.
export function pointerToFraction(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  };
}

// Hit-test a normalized point against a stroke. Returns true if the point is
// close enough to any of the stroke's points (within a per-tool threshold).
// Highlighter strokes have a looser threshold since they're wider.
export function pointInStroke(p, stroke) {
  if (!pointInStrokeBbox(p, stroke)) return false;
  const threshold = stroke.tool === 'highlighter' ? 0.025 : 0.015;
  for (const pt of stroke.points) {
    const dx = p.x - pt.x;
    const dy = p.y - pt.y;
    if (Math.sqrt(dx * dx + dy * dy) < threshold) return true;
  }
  return false;
}

// Cheap AABB rejection — quickly cull points that are nowhere near the stroke
// before the more expensive per-point distance check.
export function pointInStrokeBbox(p, stroke) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const pt of stroke.points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  const pad = 0.01;
  return p.x >= minX - pad && p.x <= maxX + pad && p.y >= minY - pad && p.y <= maxY + pad;
}

// Render a single stroke onto a 2D canvas context. `scale` is the ratio of
// the canvas's display size to its base size (matches the pdf-viewer pattern
// so the same stroke width reads at the same physical size across zooms).
// Handles three shapes: dot (1 point), line (2 points), smooth curve (3+).
export function drawSingleStroke(ctx, stroke, scale = 1) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const pts = stroke.points;
  if (!pts || pts.length === 0) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = stroke.width * dpr * (scale / 1.5);
  ctx.strokeStyle = stroke.color;
  if (stroke.tool === 'highlighter') {
    // Semi-transparent highlighter (alpha only — multiply muddies overlaps).
    ctx.globalAlpha = 0.35;
  }
  if (pts.length === 1) {
    const p = pts[0];
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (pts.length === 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x * w, pts[0].y * h);
    ctx.lineTo(pts[1].x * w, pts[1].y * h);
    ctx.stroke();
  } else {
    // Quadratic curves through midpoints eliminate jagged corners.
    ctx.beginPath();
    ctx.moveTo(pts[0].x * w, pts[0].y * h);
    for (let i = 1; i < pts.length - 1; i++) {
      const mid = {
        x: ((pts[i].x + pts[i + 1].x) / 2) * w,
        y: ((pts[i].y + pts[i + 1].y) / 2) * h,
      };
      ctx.quadraticCurveTo(pts[i].x * w, pts[i].y * h, mid.x, mid.y);
    }
    ctx.lineTo(pts[pts.length - 1].x * w, pts[pts.length - 1].y * h);
    ctx.stroke();
  }
  ctx.restore();
}

// Redraw every stroke in a list onto the given context (clears first).
export function renderStrokes(ctx, strokes, scale = 1) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const stroke of strokes) drawSingleStroke(ctx, stroke, scale);
}

// A self-contained stroke controller for a single canvas. Holds the strokes
// list + current tool/color, exposes mutation + iteration methods, and wires
// pointer events when active. Call attach() to start capturing, detach() to
// stop. The canvas itself is sized and re-rendered by the caller (e.g. when
// the image changes size); this controller only manages stroke data + input.
//
// Options:
//   { penWidth, highlightWidth, palette, onAfterStroke }
//     onAfterStroke: called after each committed stroke or erase — caller
//                    uses this to mark a doc dirty / trigger auto-save.
export function createStrokeController(canvas, opts = {}) {
  const penWidth = opts.penWidth ?? PEN_WIDTH;
  const highlightWidth = opts.highlightWidth ?? HIGHLIGHT_WIDTH;
  const strokes = [];
  let tool = 'pen';
  let color = (opts.palette ?? DEFAULT_PALETTE)[0];
  let activeStroke = null;
  let attached = false;

  function onPointerDown(e) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = pointerToFraction(e, canvas);
    if (tool === 'eraser') {
      // Erase the first stroke hit by the tap (one per tap, like PDF viewer).
      for (let i = strokes.length - 1; i >= 0; i--) {
        if (pointInStroke(p, strokes[i])) {
          strokes.splice(i, 1);
          break;
        }
      }
      renderStrokes(canvas.getContext('2d'), strokes);
      opts.onAfterStroke?.();
      return;
    }
    const width = tool === 'highlighter' ? highlightWidth : penWidth;
    activeStroke = { tool, color, width, points: [p] };
    strokes.push(activeStroke);
    drawSingleStroke(canvas.getContext('2d'), activeStroke);
  }

  function onPointerMove(e) {
    if (!activeStroke) return;
    activeStroke.points.push(pointerToFraction(e, canvas));
    renderStrokes(canvas.getContext('2d'), strokes);
  }

  function onPointerUp() {
    if (activeStroke) {
      renderStrokes(canvas.getContext('2d'), strokes);
      opts.onAfterStroke?.();
    }
    activeStroke = null;
  }

  return {
    attach() {
      if (attached) return;
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      attached = true;
    },
    detach() {
      if (!attached) return;
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      attached = false;
    },
    setTool(t) { tool = t; },
    setColor(c) { color = c; },
    getTool() { return tool; },
    getColor() { return color; },
    addPoint(p) {
      // Programmatic stroke-building API (used by tests).
      if (!activeStroke) {
        const width = tool === 'highlighter' ? highlightWidth : penWidth;
        activeStroke = { tool, color, width, points: [] };
        strokes.push(activeStroke);
      }
      activeStroke.points.push(p);
    },
    commitStroke() {
      // End the current programmatic stroke (used by tests).
      activeStroke = null;
    },
    undo() {
      strokes.pop();
      renderStrokes(canvas.getContext('2d'), strokes);
    },
    clear() {
      strokes.length = 0;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    getAll() { return strokes; },
    render() {
      renderStrokes(canvas.getContext('2d'), strokes);
    },
  };
}
