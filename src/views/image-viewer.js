// Image viewer module — renders an image file into a container via <img>,
// with an optional annotation overlay (freehand pen, highlighter, eraser).
//
// Architecture mirrors pdf-viewer.js: showImage() returns a controller the
// toolbar dispatches into (setDrawMode/setTool/setColor/clearAll/saveAnnotations
// /destroy). Drawing logic lives in src/lib/drawing.js so it's testable.
//
// Loaded via the Tauri asset protocol (convertFileSrc) so the bytes never
// round-trip through JS strings. The annotation canvas is sized to match
// the image's natural (intrinsic) resolution so strokes are full-resolution
// when composited into the saved PNG.

import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { createStrokeController, DEFAULT_PALETTE, renderStrokes } from '../lib/drawing.js';

export function showImage(container, filePath) {
  container.classList.add('image-viewer');
  const src = convertFileSrc(filePath);
  const name = filePath.split(/[\\/]/).pop() || 'image';
  // Build the DOM: image + overlay canvas + filename pill. The wrap is the
  // click-to-zoom surface (matches the original inline implementation).
  container.innerHTML =
    `<div class="image-viewer-wrap" data-state="fit">
       <div class="image-canvas-stage">
         <img class="image-viewer-img" alt="${escapeAttr(name)}" draggable="false" />
         <canvas class="image-annot-overlay" aria-hidden="true"></canvas>
       </div>
       <div class="image-viewer-meta">${escapeAttr(name)}</div>
     </div>`;
  const wrap = container.querySelector('.image-viewer-wrap');
  const img = container.querySelector('.image-viewer-img');
  const canvas = container.querySelector('.image-annot-overlay');
  const stage = container.querySelector('.image-canvas-stage');

  let drawMode = false;
  let controller = null;
  let destroyed = false;

  // Click toggles fit-to-window ↔ actual-size (only when NOT drawing).
  wrap.addEventListener('click', () => {
    if (drawMode) return;
    const isFit = wrap.dataset.state === 'fit';
    wrap.dataset.state = isFit ? 'actual' : 'fit';
    // Re-fit the canvas after a layout change.
    requestAnimationFrame(resizeCanvas);
  });

  // ---------- canvas sizing ----------
  // The overlay canvas must match the rendered image's pixel box so strokes
  // line up 1:1 with what the user sees. CSS size = displayed size; canvas
  // bitmap size = displayed size × devicePixelRatio for crispness.
  function resizeCanvas() {
    if (destroyed) return;
    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    // Re-render existing strokes at the new canvas size.
    if (controller) controller.render();
  }

  // ---------- image load ----------
  img.addEventListener('load', () => {
    resizeCanvas();
  });
  // Refresh sizing on window resize (the image's display box changes).
  const resizeObserver = new ResizeObserver(() => resizeCanvas());
  resizeObserver.observe(img);
  img.src = src;

  // ---------- drawing ----------
  function applyDrawMode() {
    canvas.style.pointerEvents = drawMode ? 'auto' : 'none';
    wrap.classList.toggle('drawing-active', drawMode);
    // Toggle the cursor — crosshair while drawing, zoom affordance otherwise.
    wrap.style.cursor = drawMode ? 'crosshair' : '';
  }

  function ensureController() {
    if (!controller) {
      controller = createStrokeController(canvas, {
        onAfterStroke: () => { /* could mark dirty / schedule autosave */ },
      });
    }
    return controller;
  }

  // ---------- save ----------
  // Composite the image + strokes at the image's NATURAL resolution so the
  // saved PNG is full-fidelity (not the screen-scaled display size).
  async function saveAnnotations() {
    if (!img.naturalWidth || !img.naturalHeight) {
      return null;
    }
    const off = document.createElement('canvas');
    off.width = img.naturalWidth;
    off.height = img.naturalHeight;
    const ctx = off.getContext('2d');
    // Draw the original image.
    ctx.drawImage(img, 0, 0);
    // Re-render strokes scaled to natural resolution. Each stroke's points are
    // normalized 0..1, so they map directly onto the offscreen canvas's size.
    if (controller) {
      const strokes = controller.getAll();
      // Scale = naturalWidth / displayWidth — the drawing.js drawSingleStroke
      // multiplies lineWidth by dpr * (scale/1.5); we want strokes to render
      // at the same physical proportions, so compute the equivalent scale.
      const displayWidth = img.getBoundingClientRect().width || img.naturalWidth;
      const scaleForNatural = (img.naturalWidth / displayWidth) * 1.5 / (window.devicePixelRatio || 1);
      for (const stroke of strokes) {
        drawStrokeAtNaturalSize(ctx, stroke);
      }
    }
    // toBlob → bytes → Rust save dialog.
    const blob = await new Promise((resolve) => off.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const suggested = suggestName(name);
    try {
      const savedPath = await invoke('save_annotated_image', {
        bytes: Array.from(bytes),
        suggestedName: suggested,
      });
      return savedPath;
    } catch (e) {
      if (e === 'cancelled') return null;
      throw e;
    }
  }

  // Render a stroke onto the offscreen (natural-resolution) canvas. The stroke
  // coordinates are normalized 0..1, so we just scale them up to the canvas's
  // pixel dimensions and choose a stroke width proportional to the image size.
  function drawStrokeAtNaturalSize(ctx, stroke) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const pts = stroke.points;
    if (!pts || pts.length === 0) return;
    // Scale the stroke width from the display size to the natural size.
    const displayWidth = img.getBoundingClientRect().width || img.naturalWidth;
    const sizeRatio = img.naturalWidth / displayWidth;
    const lineWidth = stroke.width * (window.devicePixelRatio || 1) * sizeRatio;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke.color;
    if (stroke.tool === 'highlighter') ctx.globalAlpha = 0.35;
    if (pts.length === 1) {
      ctx.fillStyle = stroke.color;
      ctx.beginPath();
      ctx.arc(pts[0].x * w, pts[0].y * h, lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (pts.length === 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x * w, pts[0].y * h);
      ctx.lineTo(pts[1].x * w, pts[1].y * h);
      ctx.stroke();
    } else {
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

  function suggestName(originalName) {
    // foo.png → foo-annotated.png; preserve extension, append -annotated.
    const dot = originalName.lastIndexOf('.');
    if (dot < 0) return originalName + '-annotated.png';
    const stem = originalName.slice(0, dot);
    return stem + '-annotated.png';
  }

  // ---------- public controller ----------
  return {
    container,
    setDrawMode(on) {
      drawMode = !!on;
      if (drawMode) ensureController().attach();
      else controller?.detach();
      applyDrawMode();
    },
    setTool(t) {
      ensureController().setTool(t);
    },
    setColor(c) {
      ensureController().setColor(c);
    },
    clearAll() {
      controller?.clear();
    },
    async saveAnnotations() {
      return saveAnnotations();
    },
    rerender() {
      resizeCanvas();
    },
    destroy() {
      destroyed = true;
      controller?.detach();
      resizeObserver.disconnect();
    },
  };
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
