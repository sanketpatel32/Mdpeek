// PDF viewer module — renders a .pdf file into a container using pdf.js.
//
// Three layers per page (front-to-back):
//   1. render canvas  — the visible page pixels
//   2. .textLayer     — transparent text spans for native selection + search
//   3. canvas.pdf-draw— annotation drawing (pointer-events toggled by draw mode)
//
// Lazy-loaded: pdfjs-dist is dynamically imported only when a PDF is opened.
// The controller returned by showPdf() exposes everything the find bar and the
// drawing toolbar need: pdfDoc, textLayers, stroke state, and mode setters.

import { convertFileSrc } from '@tauri-apps/api/core';
import { escapeHtml } from '../lib/escape.js';

// Render scale relative to the app's zoom level.
function getScale(container) {
  const fs = parseFloat(container.style.fontSize) || 15;
  return (fs / 15) * 1.5;
}

// Lazy pdf.js loader — resolves the module + worker once, caches the promise.
let _pdfjsPromise = null;
async function loadPdfjs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = (async () => {
    const pdfjsLib = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjsLib;
  })();
  return _pdfjsPromise;
}

// Drawing tool defaults.
const PEN_WIDTH = 2;
const HIGHLIGHT_WIDTH = 14;
const PALETTE = ['#1d1d1f', '#ff3b30', '#0071e3', '#34c759', '#ffcc00'];

export async function showPdf(container, filePath) {
  container.innerHTML = '<div class="pdf-loading">Loading PDF…</div>';
  container.classList.add('pdf-viewer');

  let pdfDoc = null;
  let destroyed = false;
  const renders = new Map();       // pageNum → RenderTask
  const textLayers = new Map();    // pageNum → TextLayer
  const textCache = new Map();     // pageNum → string (for search)
  const observers = [];
  const _cleanup = [];             // teardown fns (scroll listeners, timers, etc.)
  const strokesByPage = new Map(); // pageNum → Stroke[]
  let drawMode = false;
  let drawTool = 'pen';
  let drawColor = PALETTE[0];

  // Mutable scale — re-read from the container's font-size (set by applyZoom)
  // whenever the app's zoom level changes. Kept as a `let` (not const) so
  // rerenderAll() can update it and force every page to re-render.
  let scale = getScale(container);

  try {
    const pdfjsLib = await loadPdfjs();
    const url = convertFileSrc(filePath);
    pdfDoc = await pdfjsLib.getDocument({ url }).promise;
    if (destroyed) return { destroy: () => {} };
    container.innerHTML = '';

    // Build page wrappers with the three-layer structure.
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-page';
      wrapper.dataset.pageNum = String(i);

      const renderCanvas = document.createElement('canvas');
      wrapper.appendChild(renderCanvas);

      const textDiv = document.createElement('div');
      textDiv.className = 'textLayer';
      wrapper.appendChild(textDiv);

      const drawCanvas = document.createElement('canvas');
      drawCanvas.className = 'pdf-draw';
      wrapper.appendChild(drawCanvas);

      container.appendChild(wrapper);
      strokesByPage.set(i, []);
    }

    // Lazy-render each page via IntersectionObserver.
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const wrapper = entry.target;
          const num = parseInt(wrapper.dataset.pageNum, 10);
          renderPage(pdfjsLib, pdfDoc, num, wrapper, scale, renders, textLayers, textCache);
        }
      });
    }, { rootMargin: '200px' });
    observers.push(io);
    container.querySelectorAll('.pdf-page').forEach((p) => io.observe(p));

    // ---------- page-number badge ----------
    // Shows "X / Y" at the bottom-center while scrolling, fades out when idle.
    const badge = document.getElementById('pdf-page-badge');
    if (badge) {
      badge.textContent = `1 / ${pdfDoc.numPages}`;
      badge.classList.remove('hidden', 'fading');
    }
    let badgeTimer = null;
    const onScroll = () => {
      // Find the page nearest the viewport top.
      const containerTop = container.getBoundingClientRect().top;
      let current = 1;
      for (const page of container.querySelectorAll('.pdf-page')) {
        const rect = page.getBoundingClientRect();
        // A page is "current" when its top passes above the viewport midline.
        if (rect.top - containerTop <= container.clientHeight / 3) {
          current = parseInt(page.dataset.pageNum, 10);
        } else break;
      }
      if (badge) {
        badge.textContent = `${current} / ${pdfDoc.numPages}`;
        badge.classList.remove('hidden', 'fading');
        clearTimeout(badgeTimer);
        badgeTimer = setTimeout(() => badge.classList.add('fading'), 1200);
      }
    };
    container.addEventListener('scroll', onScroll);
    // Clean up on destroy — store the handler so destroy() can remove it.
    _cleanup.push(() => {
      container.removeEventListener('scroll', onScroll);
      clearTimeout(badgeTimer);
      if (badge) {
        badge.classList.add('hidden');
        badge.classList.remove('fading');
      }
    });
  } catch (e) {
    container.innerHTML = `<div class="pdf-error">Could not load PDF: ${escapeHtml(String(e))}</div>`;
    console.error('PDF load failed:', e);
  }

  // ---------- drawing ----------
  function applyDrawMode() {
    // Toggle pointer-events on every draw canvas + text layer.
    container.querySelectorAll('.pdf-draw').forEach((c) => {
      c.style.pointerEvents = drawMode ? 'auto' : 'none';
    });
    container.querySelectorAll('.textLayer').forEach((t) => {
      t.style.pointerEvents = drawMode ? 'none' : 'auto';
    });
    container.classList.toggle('drawing-active', drawMode);
  }

  let activeStroke = null;

  function pointerToPage(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,   // normalized 0..1
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  function onPointerDown(e) {
    if (!drawMode) return;
    const canvas = e.currentTarget;
    const num = parseInt(canvas.parentElement.dataset.pageNum, 10);
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = pointerToPage(canvas, e);

    if (drawTool === 'eraser') {
      eraseStroke(num, p);
      return;
    }

    const width = drawTool === 'highlighter' ? HIGHLIGHT_WIDTH : PEN_WIDTH;
    activeStroke = { tool: drawTool, color: drawColor, width, points: [p] };
    strokesByPage.get(num).push(activeStroke);
    // Draw the first dot immediately.
    drawSingleStroke(canvas, activeStroke);
  }

  function onPointerMove(e) {
    if (!activeStroke || !drawMode) return;
    const canvas = e.currentTarget;
    const p = pointerToPage(canvas, e);
    activeStroke.points.push(p);
    // Full re-render of the active stroke for smoothness. Clearing + one
    // quadratic-curved path is sub-millisecond, far smoother than incremental
    // segment drawing (which leaves visible joints between segments).
    const num = parseInt(canvas.parentElement.dataset.pageNum, 10);
    renderStrokesOnCanvas(canvas, num);
  }

  function onPointerUp(e) {
    if (activeStroke) {
      // Full re-render of the stroke for a clean finish.
      const canvas = e.currentTarget;
      renderStrokesOnCanvas(canvas, parseInt(canvas.parentElement.dataset.pageNum, 10));
    }
    activeStroke = null;
  }

  // Erase: remove any stroke that is clicked.
  function eraseStroke(num, p) {
    const strokes = strokesByPage.get(num) || [];
    const before = strokes.length;
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (pointInStroke(p, strokes[i])) {
        strokes.splice(i, 1);
        break; // one stroke per eraser tap
      }
    }
    if (strokes.length !== before) {
      const wrapper = container.querySelector(`.pdf-page[data-page-num="${num}"]`);
      const canvas = wrapper?.querySelector('.pdf-draw');
      if (canvas) renderStrokesOnCanvas(canvas, num);
    }
  }

  function pointInStroke(p, stroke) {
    if (!pointInStrokeBbox(p, stroke)) return false;

    const threshold = stroke.tool === 'highlighter' ? 0.025 : 0.015;
    for (const pt of stroke.points) {
      const dx = p.x - pt.x;
      const dy = p.y - pt.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < threshold) return true;
    }
    return false;
  }

  function pointInStrokeBbox(p, stroke) {
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const pt of stroke.points) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
    const pad = 0.01; // tolerance
    return p.x >= minX - pad && p.x <= maxX + pad && p.y >= minY - pad && p.y <= maxY + pad;
  }

  // Draw all strokes for a page onto its canvas (full re-render).
  function renderStrokesOnCanvas(canvas, num) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokesByPage.get(num) || []) {
      drawSingleStroke(canvas, stroke);
    }
  }

  function drawSingleStroke(canvas, stroke) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const pts = stroke.points;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = stroke.width * (window.devicePixelRatio || 1) * (scale / 1.5);
    ctx.strokeStyle = stroke.color;
    if (stroke.tool === 'highlighter') {
      // Semi-transparent highlighter — alpha only, no multiply (multiply muddies
      // overlaps on transparent canvas backgrounds).
      ctx.globalAlpha = 0.35;
    }
    if (pts.length === 1) {
      // A dot — draw a small filled circle.
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
      // Smooth the stroke with quadratic curves through midpoints — eliminates
      // the jagged corners that straight lineTo segments produce.
      ctx.beginPath();
      ctx.moveTo(pts[0].x * w, pts[0].y * h);
      for (let i = 1; i < pts.length - 1; i++) {
        const mid = {
          x: (pts[i].x + pts[i + 1].x) / 2 * w,
          y: (pts[i].y + pts[i + 1].y) / 2 * h,
        };
        ctx.quadraticCurveTo(pts[i].x * w, pts[i].y * h, mid.x, mid.y);
      }
      // Final segment to the last point.
      ctx.lineTo(pts[pts.length - 1].x * w, pts[pts.length - 1].y * h);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Wire pointer events on every draw canvas (once).
  container.querySelectorAll('.pdf-draw').forEach((c) => {
    c.addEventListener('pointerdown', onPointerDown);
    c.addEventListener('pointermove', onPointerMove);
    c.addEventListener('pointerup', onPointerUp);
  });

  function clearAll() {
    for (const [num] of strokesByPage) {
      strokesByPage.set(num, []);
      const wrapper = container.querySelector(`.pdf-page[data-page-num="${num}"]`);
      const canvas = wrapper?.querySelector('.pdf-draw');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  }

  // Full re-render of every page at the new scale (called after a zoom change).
  // Cancels in-flight renders, tears down old text layers, then re-renders each
  // page's canvas + text layer + draw canvas from scratch.
  async function rerenderAll() {
    if (!pdfDoc) return;
    // Re-read the scale from the container's current font-size (set by applyZoom).
    scale = getScale(container);
    // Cancel any in-flight page renders.
    for (const task of renders.values()) { try { task.cancel(); } catch {} }
    renders.clear();
    // Tear down existing text layers so the new ones don't double up.
    for (const tl of textLayers.values()) { try { tl.cancel(); } catch {} }
    textLayers.clear();
    // Clear text-layer DOM so pdf.js can rebuild it cleanly.
    container.querySelectorAll('.textLayer').forEach((tl) => (tl.innerHTML = ''));
    // Re-render every page at the new scale. Sequential to avoid hammering the
    // pdf.js worker with all pages at once; the IntersectionObserver is for the
    // initial lazy load only.
    const pdfjsLib = await loadPdfjs();
    if (destroyed) return;
    for (const wrapper of container.querySelectorAll('.pdf-page')) {
      if (destroyed) return;
      const num = parseInt(wrapper.dataset.pageNum, 10);
      // eslint-disable-next-line no-await-in-loop
      await renderPage(pdfjsLib, pdfDoc, num, wrapper, scale, renders, textLayers, textCache);
      // Re-apply draw mode pointer-events to the fresh canvases.
      applyDrawMode();
    }
  }

  return {
    pdfDoc,
    textLayers,
    textCache,
    container,
    setDrawMode(on) { drawMode = !!on; applyDrawMode(); },
    setTool(t) { drawTool = t; },
    setColor(c) { drawColor = c; },
    clearAll,
    rerenderAll,
    destroy() {
      destroyed = true;
      activeStroke = null;
      for (const io of observers) io.disconnect();
      observers.length = 0;
      for (const fn of _cleanup) { try { fn(); } catch {} }
      _cleanup.length = 0;
      for (const task of renders.values()) { try { task.cancel(); } catch {} }
      renders.clear();
      for (const tl of textLayers.values()) { try { tl.cancel(); } catch {} }
      textLayers.clear();
      if (pdfDoc) { try { pdfDoc.destroy(); } catch {} }
      container.classList.remove('pdf-viewer', 'drawing-active');
      delete container.dataset.pdfPages;
      container.innerHTML = '';
    },
  };
}

// Render one page: canvas pixels + text layer + size the draw canvas.
async function renderPage(pdfjsLib, pdfDoc, num, wrapper, scale, renders, textLayers, textCache) {
  if (renders.has(num)) return;
  try {
    const page = await pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale });

    // --- render canvas ---
    const renderCanvas = wrapper.querySelector('canvas:not(.pdf-draw)');
    const ctx = renderCanvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    renderCanvas.width = viewport.width * dpr;
    renderCanvas.height = viewport.height * dpr;
    renderCanvas.style.width = Math.floor(viewport.width) + 'px';
    renderCanvas.style.height = Math.floor(viewport.height) + 'px';
    // Size the wrapper to the page so the text/draw layers anchor correctly.
    wrapper.style.width = Math.floor(viewport.width) + 'px';
    wrapper.style.height = Math.floor(viewport.height) + 'px';

    const task = page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    });
    renders.set(num, task);
    await task.promise;

    // --- draw canvas (size to match) ---
    const drawCanvas = wrapper.querySelector('.pdf-draw');
    drawCanvas.width = renderCanvas.width;
    drawCanvas.height = renderCanvas.height;
    drawCanvas.style.width = renderCanvas.style.width;
    drawCanvas.style.height = renderCanvas.style.height;

    // --- text layer (transparent, for selection + search) ---
    const textDiv = wrapper.querySelector('.textLayer');
    // Set the scale factor so the CSS calc (font-size: --text-scale-factor *
    // --font-height) positions spans at the right size for selection.
    textDiv.style.setProperty('--scale-factor', String(scale));
    const textContent = await page.getTextContent();
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: textDiv,
      viewport,
    });
    await textLayer.render();
    textLayers.set(num, textLayer);

    // Cache the page's text for fast search (filter out marked-content items).
    const flat = textContent.items
      .filter((it) => typeof it.str === 'string')
      .map((it) => it.str)
      .join('');
    textCache.set(num, flat);
  } catch (e) {
    if (!String(e).includes('Rendering cancelled')) {
      console.error(`Page ${num} render failed:`, e);
    }
  } finally {
    renders.delete(num);
  }
}

