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
//
// Polish layer (injected, id-guarded): a Fit / 100% control cluster with a
// live tabular-nums zoom badge, grab/grabbing drag-pan cursors on scrollable
// images, refined checkerboard backdrop, and loading-spinner / error states.

import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { createStrokeController, DEFAULT_PALETTE, renderStrokes } from '../lib/drawing.js';

// ---------- injected polish styles ----------
// Idempotent: one <style id="image-viewer-polish-style"> in <head>; appended
// after content.css so equal-specificity overrides win without !important.
const POLISH_CSS = `
@keyframes image-spin { to { transform: rotate(360deg); } }

.image-viewer {
  position: relative; /* anchors the loader / error overlays */
}

/* Backdrop polish: finer checker squares + soft vignette so the frame feels
   like a canvas, not a pattern wall. */
.image-viewer-wrap {
  position: relative;
  background-size: 16px 16px !important;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0 !important;
}
.image-viewer-wrap::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center,
    transparent 55%,
    color-mix(in srgb, var(--bg) 45%, transparent) 100%);
}
.image-canvas-stage { z-index: 1; }
.image-viewer-meta { position: relative; z-index: 1; }

/* Image fade-in once decoded (stacked onto the existing size transition). */
.image-viewer-img {
  opacity: 0;
  transition:
    opacity var(--dur-2, 180ms) var(--ease-out, ease),
    max-height var(--dur-2, 180ms) var(--ease-out, ease),
    max-width var(--dur-2, 180ms) var(--ease-out, ease);
}
.image-viewer.is-loaded .image-viewer-img { opacity: 1; }
.image-viewer.has-error .image-viewer-img { display: none; }

/* Drag-pan cursor states. applyDrawMode() clears inline cursor styles so
   classes own the affordance; in draw mode neither pan class is present,
   so content.css's .drawing-active crosshair applies untouched. */
.image-viewer-wrap.is-pannable { cursor: grab; }
.image-viewer-wrap.is-panning { cursor: grabbing !important; }

/* Floating zoom cluster pinned to the bottom of the scroller. */
.image-controls-dock {
  position: sticky;
  bottom: var(--sp-4, 12px);
  height: 0;
  display: flex;
  justify-content: center;
  z-index: 5;
}
.image-zoom-controls {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-md);
}
.image-zoom-btn {
  border: none;
  background: transparent;
  color: var(--fg-muted);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  cursor: pointer;
  transition:
    background-color var(--dur-1, 120ms) var(--ease-out, ease),
    color var(--dur-1, 120ms) var(--ease-out, ease),
    transform var(--dur-1, 120ms) var(--ease-out, ease);
}
.image-zoom-btn:hover { background: var(--surface-hover); color: var(--fg); }
.image-zoom-btn:active {
  transform: scale(0.94);
  background: color-mix(in srgb, var(--accent-soft, transparent) 70%, var(--surface-hover));
}
.image-zoom-btn:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent);
}
.image-zoom-btn[disabled] { opacity: 0.4; cursor: default; transform: none; }
/* Toggle clarity: exactly one button carries the active state at a time. */
.image-zoom-btn.is-active {
  background: var(--accent-soft);
  color: var(--fg);
}
.image-zoom-badge {
  min-width: 46px;
  padding: 0 var(--sp-2, 6px);
  text-align: center;
  font-size: 11px;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  border-left: 1px solid var(--border-subtle);
  user-select: none;
}

/* Loading spinner overlay. */
.image-loading {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity var(--dur-2, 180ms) var(--ease-out, ease);
}
.image-loading-spin {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--border-subtle);
  border-top-color: var(--accent);
  animation: image-spin 0.8s linear infinite;
}
.image-viewer.is-loaded .image-loading,
.image-viewer.has-error .image-loading { opacity: 0; pointer-events: none; }

/* Error state panel. */
.image-error {
  position: absolute;
  inset: 0;
  z-index: 7;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1, 4px);
  text-align: center;
  animation: image-fade-in var(--dur-3, 240ms) var(--ease-out, ease);
}
.image-error.hidden { display: none; }
@keyframes image-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}
.image-error-glyph {
  width: 30px;
  height: 30px;
  margin-bottom: var(--sp-2, 6px);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-weight: 700;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 13%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 26%, transparent);
}
.image-error-title { font-size: 13px; font-weight: 600; color: var(--fg); }
.image-error-path {
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--fg-muted);
}
`;

function injectPolishStyle() {
  if (document.getElementById('image-viewer-polish-style')) return;
  const style = document.createElement('style');
  style.id = 'image-viewer-polish-style';
  style.textContent = POLISH_CSS;
  document.head.appendChild(style);
}

export function showImage(container, filePath) {
  container.classList.add('image-viewer');
  const src = convertFileSrc(filePath);
  const name = filePath.split(/[\\/]/).pop() || 'image';
  // Build the DOM: image + overlay canvas + filename pill. The wrap is the
  // click-to-zoom surface (matches the original inline implementation).
  // A sticky dock holds the zoom cluster; loader/error overlays are siblings
  // of the wrap so their clicks never reach the fit↔actual toggle.
  container.innerHTML =
    `<div class="image-viewer-wrap" data-state="fit" role="button" tabindex="0" aria-label="Toggle fit / actual size">
       <div class="image-canvas-stage">
         <img class="image-viewer-img" alt="${escapeAttr(name)}" draggable="false" />
         <canvas class="image-annot-overlay" aria-hidden="true"></canvas>
       </div>
       <div class="image-viewer-meta">${escapeAttr(name)}</div>
     </div>
     <div class="image-controls-dock">
       <div class="image-zoom-controls" role="group" aria-label="Zoom controls">
         <button class="image-zoom-btn is-active" data-zoom="fit" type="button" aria-pressed="true">Fit</button>
         <button class="image-zoom-btn" data-zoom="actual" type="button" aria-pressed="false">100%</button>
         <span class="image-zoom-badge" title="Current zoom">\u2014</span>
       </div>
     </div>
     <div class="image-loading" aria-hidden="true"><span class="image-loading-spin"></span></div>
     <div class="image-error hidden" role="alert">
       <span class="image-error-glyph">!</span>
       <span class="image-error-title">Couldn\u2019t load image</span>
       <span class="image-error-path">${escapeAttr(name)}</span>
     </div>`;
  const wrap = container.querySelector('.image-viewer-wrap');
  const img = container.querySelector('.image-viewer-img');
  const canvas = container.querySelector('.image-annot-overlay');
  const stage = container.querySelector('.image-canvas-stage');
  const badgeEl = container.querySelector('.image-zoom-badge');
  const errorEl = container.querySelector('.image-error');

  let drawMode = false;
  let controller = null;
  let destroyed = false;

  // ---------- zoom state ----------
  // Single source of truth for fit ↔ actual; both the wrap toggle and the
  // Fit / 100% buttons funnel through here so the active-button state and
  // the badge can never drift apart.
  function setZoomState(state) {
    if (wrap.dataset.state === state) return;
    wrap.dataset.state = state;
    syncZoomControls();
    updateMeta();
    // Re-fit the canvas after a layout change.
    requestAnimationFrame(() => { resizeCanvas(); refreshPanState(); });
  }

  function syncZoomControls() {
    const isFit = wrap.dataset.state === 'fit';
    container.querySelectorAll('.image-zoom-btn').forEach((btn) => {
      const active = (btn.dataset.zoom === 'fit') === isFit;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  // Live zoom percentage vs the image's natural size (transform-aware via
  // getBoundingClientRect). '—' until intrinsic dimensions exist.
  function updateZoomBadge() {
    if (!badgeEl) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h || destroyed) { badgeEl.textContent = '\u2014'; return; }
    const rect = img.getBoundingClientRect();
    if (!rect.width) { badgeEl.textContent = '\u2014'; return; }
    const pct = Math.max(1, Math.round((rect.width / w) * 100));
    badgeEl.textContent = `${pct}%`;
  }

  const metaEl = container.querySelector('.image-viewer-meta');
  // v0.67.0: meta pill shows dimensions; zoom moved to its own badge.
  const updateMeta = () => {
    if (!metaEl) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    metaEl.textContent = w && h ? `${name} · ${w}×${h}` : name;
  };
  img.addEventListener('load', () => { updateMeta(); updateZoomBadge(); }, { once: true });

  // Click (or Enter/Space — the wrap is a focusable button now) toggles
  // fit-to-window ↔ actual-size. No-op while drawing or right after a drag-pan.
  const toggleFit = () => {
    if (drawMode) return;
    setZoomState(wrap.dataset.state === 'fit' ? 'actual' : 'fit');
  };
  let panMoved = false; // suppress the click that follows a pan gesture
  wrap.addEventListener('click', () => {
    if (panMoved) { panMoved = false; return; }
    toggleFit();
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleFit();
    }
  });

  // Zoom buttons sit outside the wrap, but guard draw mode anyway.
  container.querySelectorAll('.image-zoom-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (drawMode) return;
      setZoomState(btn.dataset.zoom === 'fit' ? 'fit' : 'actual');
    });
  });

  // ---------- drag-pan ----------
  // When the rendered image overflows the scroller, dragging pans it with
  // grab/grabbing affordances instead of relying only on wheel/scrollbars.
  let panning = false;
  let panStartX = 0;
  let panStartY = 0;
  let scrollStartX = 0;
  let scrollStartY = 0;

  function refreshPanState() {
    if (destroyed) return;
    const overflows =
      container.scrollWidth > container.clientWidth + 1 ||
      container.scrollHeight > container.clientHeight + 1;
    wrap.classList.toggle('is-pannable', overflows && !drawMode);
  }

  wrap.addEventListener('pointerdown', (e) => {
    if (drawMode || e.button !== 0 || !wrap.classList.contains('is-pannable')) return;
    panning = true;
    panMoved = false;
    panStartX = e.clientX;
    panStartY = e.clientY;
    scrollStartX = container.scrollLeft;
    scrollStartY = container.scrollTop;
    wrap.classList.add('is-panning');
    try { wrap.setPointerCapture(e.pointerId); } catch { /* detached */ }
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!panning) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    if (!panMoved && Math.hypot(dx, dy) > 3) panMoved = true;
    container.scrollLeft = scrollStartX - dx;
    container.scrollTop = scrollStartY - dy;
  });
  const endPan = () => {
    panning = false;
    wrap.classList.remove('is-panning');
  };
  wrap.addEventListener('pointerup', endPan);
  wrap.addEventListener('pointercancel', endPan);

  // ---------- loading / error states ----------
  img.addEventListener('load', () => {
    container.classList.add('is-loaded');
    refreshPanState();
  }, { once: true });
  img.addEventListener('error', () => {
    if (destroyed) return;
    container.classList.add('has-error');
    errorEl?.classList.remove('hidden');
    container.querySelectorAll('.image-zoom-btn').forEach((b) => { b.disabled = true; });
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
    updateZoomBadge();
    // Re-render existing strokes at the new canvas size.
    if (controller) controller.render();
  }

  // ---------- image load ----------
  img.addEventListener('load', () => {
    resizeCanvas();
  });
  // Refresh sizing on window resize (the image's display box changes).
  const resizeObserver = new ResizeObserver(() => { resizeCanvas(); refreshPanState(); });
  resizeObserver.observe(img);
  img.src = src;

  // ---------- drawing ----------
  function applyDrawMode() {
    canvas.style.pointerEvents = drawMode ? 'auto' : 'none';
    wrap.classList.toggle('drawing-active', drawMode);
    // Cursor comes from classes (crosshair while drawing, otherwise the
    // grab/grabbing pan affordance) — no inline style to fight the cascade.
    wrap.style.cursor = '';
    refreshPanState();
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
    // drawing.js draws at width*dpr*(scale/1.5) on a bitmap displayWidth*dpr
    // wide, so the on-image fraction is width/(1.5*display); reproduce that
    // same fraction at natural resolution (no dpr factor).
    const displayWidth = img.getBoundingClientRect().width || img.naturalWidth;
    const sizeRatio = img.naturalWidth / displayWidth;
    const lineWidth = (stroke.width / 1.5) * sizeRatio;
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
      refreshPanState();
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
