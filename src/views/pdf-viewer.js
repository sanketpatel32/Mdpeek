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
  const pageSizes = new Map();     // pageNum → { width, height } (CSS px at scale 1)
  const observers = [];
  const strokesByPage = new Map(); // pageNum → Stroke[]
  let drawMode = false;
  let drawTool = 'pen';
  let drawColor = PALETTE[0];

  const scale = getScale(container);

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
          renderPage(pdfjsLib, pdfDoc, num, wrapper, scale, renders, textLayers, textCache, pageSizes);
        }
      });
    }, { rootMargin: '200px' });
    observers.push(io);
    container.querySelectorAll('.pdf-page').forEach((p) => io.observe(p));
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
    // Incremental draw: just draw the last segment for speed.
    drawIncrement(canvas, activeStroke);
  }

  function onPointerUp(e) {
    if (activeStroke) {
      // Full re-render of the stroke for a clean finish.
      const canvas = e.currentTarget;
      renderStrokesOnCanvas(canvas, parseInt(canvas.parentElement.dataset.pageNum, 10));
    }
    activeStroke = null;
  }

  // Erase: remove any stroke whose bbox contains the point.
  function eraseStroke(num, p) {
    const strokes = strokesByPage.get(num) || [];
    const before = strokes.length;
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (pointInStrokeBbox(p, strokes[i])) {
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
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = stroke.width * (window.devicePixelRatio || 1);
    ctx.strokeStyle = stroke.color;
    if (stroke.tool === 'highlighter') {
      ctx.globalAlpha = 0.35;
      ctx.globalCompositeOperation = 'multiply';
    }
    ctx.beginPath();
    for (let i = 0; i < stroke.points.length; i++) {
      const pt = stroke.points[i];
      const x = pt.x * w;
      const y = pt.y * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    // A single-point stroke (a dot) needs a short line to be visible.
    if (stroke.points.length === 1) {
      const pt = stroke.points[0];
      ctx.moveTo(pt.x * w, pt.y * h);
      ctx.lineTo(pt.x * w + 0.5, pt.y * h + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Fast incremental: draw only the last segment.
  function drawIncrement(canvas, stroke) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const pts = stroke.points;
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = stroke.width * (window.devicePixelRatio || 1);
    ctx.strokeStyle = stroke.color;
    if (stroke.tool === 'highlighter') {
      ctx.globalAlpha = 0.35;
      ctx.globalCompositeOperation = 'multiply';
    }
    ctx.beginPath();
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
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

  // Re-render strokes for all visible pages (called after zoom).
  function rerenderAllStrokes() {
    container.querySelectorAll('.pdf-page').forEach((wrapper) => {
      const num = parseInt(wrapper.dataset.pageNum, 10);
      const drawCanvas = wrapper.querySelector('.pdf-draw');
      if (drawCanvas) {
        // Resize the draw canvas to match the page render canvas.
        const renderCanvas = wrapper.querySelector('canvas:not(.pdf-draw)');
        if (renderCanvas) {
          drawCanvas.width = renderCanvas.width;
          drawCanvas.height = renderCanvas.height;
          drawCanvas.style.width = renderCanvas.style.width;
          drawCanvas.style.height = renderCanvas.style.height;
        }
        renderStrokesOnCanvas(drawCanvas, num);
      }
    });
  }

  return {
    pdfDoc,
    textLayers,
    textCache,
    pageSizes,
    container,
    setDrawMode(on) { drawMode = !!on; applyDrawMode(); },
    setTool(t) { drawTool = t; },
    setColor(c) { drawColor = c; },
    clearAll,
    rerenderAllStrokes,
    isDrawing() { return drawMode; },
    destroy() {
      destroyed = true;
      activeStroke = null;
      for (const io of observers) io.disconnect();
      observers.length = 0;
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
async function renderPage(pdfjsLib, pdfDoc, num, wrapper, scale, renders, textLayers, textCache, pageSizes) {
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
    pageSizes.set(num, { width: viewport.width / scale, height: viewport.height / scale });
  } catch (e) {
    if (!String(e).includes('Rendering cancelled')) {
      console.error(`Page ${num} render failed:`, e);
    }
  } finally {
    renders.delete(num);
  }
}

export { PALETTE };
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
