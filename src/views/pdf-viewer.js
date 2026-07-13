// PDF viewer module — renders a .pdf file into a container using pdf.js.
//
// Lazy-loaded: pdfjs-dist is dynamically imported only when a PDF is actually
// opened, so markdown-only users pay zero bundle cost. Pages render into
// stacked <canvas> elements as you scroll (IntersectionObserver), keeping
// memory and CPU low for large PDFs.
//
// The PDF bytes are loaded via the Tauri asset protocol (convertFileSrc) — they
// never pass through doc.content or the Rust text-reading commands.

import { convertFileSrc } from '@tauri-apps/api/core';

// Render scale relative to the app's zoom level. 1.0 ≈ 96dpi screen. Zoom is
// read from the inline font-size on #document (set by applyZoom) so PDF zoom
// stays in sync with the markdown zoom controls.
function getScale(container) {
  const fs = parseFloat(container.style.fontSize) || 15;
  // 1.5 maps a typical 15px base to a crisp on-screen PDF page.
  return (fs / 15) * 1.5;
}

// Lazy pdf.js loader — resolves the module + worker once, caches the promise.
let _pdfjsPromise = null;
async function loadPdfjs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = (async () => {
    const pdfjsLib = await import('pdfjs-dist');
    // Worker via Vite's ?url import → a hashed asset URL, no inline bloat.
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjsLib;
  })();
  return _pdfjsPromise;
}

// Render a PDF into `container`. Returns a controller object with a `destroy()`
// method that tears down the viewer (cancels pending renders, clears the DOM).
export async function showPdf(container, filePath) {
  // Loading state.
  container.innerHTML = '<div class="pdf-loading">Loading PDF…</div>';
  container.classList.add('pdf-viewer');

  let pdfDoc = null;
  let destroyed = false;
  const renders = new Map(); // pageNum → RenderTask (for cancellation)
  const observers = [];      // IntersectionObservers (for disconnect)

  const scale = getScale(container);

  try {
    const pdfjsLib = await loadPdfjs();
    const url = convertFileSrc(filePath);
    pdfDoc = await pdfjsLib.getDocument({ url }).promise;
    if (destroyed) return { destroy: () => {} };
    container.innerHTML = '';
    container.dataset.pdfPages = String(pdfDoc.numPages);

    // Create a canvas placeholder for each page. Pages render when scrolled into
    // view (lazy), so a 500-page PDF doesn't try to render everything at once.
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-page';
      wrapper.dataset.pageNum = String(i);
      const canvas = document.createElement('canvas');
      wrapper.appendChild(canvas);
      container.appendChild(wrapper);
    }

    // Lazy-render each page via IntersectionObserver.
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const wrapper = entry.target;
          const num = parseInt(wrapper.dataset.pageNum, 10);
          renderPage(pdfDoc, num, wrapper.querySelector('canvas'), scale, renders);
        }
      });
    }, { rootMargin: '200px' });
    observers.push(io);
    container.querySelectorAll('.pdf-page').forEach((p) => io.observe(p));
  } catch (e) {
    container.innerHTML = `<div class="pdf-error">Could not load PDF: ${escapeHtml(String(e))}</div>`;
    console.error('PDF load failed:', e);
  }

  return {
    destroy() {
      destroyed = true;
      for (const io of observers) io.disconnect();
      observers.length = 0;
      for (const task of renders.values()) {
        try { task.cancel(); } catch {}
      }
      renders.clear();
      if (pdfDoc) {
        try { pdfDoc.destroy(); } catch {}
      }
      container.classList.remove('pdf-viewer');
      delete container.dataset.pdfPages;
      container.innerHTML = '';
    },
  };
}

// Render one page into its canvas. Re-entrant safe via the renders Map.
async function renderPage(pdfDoc, num, canvas, scale, renders) {
  // Skip if already rendering or rendered.
  if (renders.has(num)) return;
  try {
    const page = await pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale });
    const ctx = canvas.getContext('2d');
    // Device-pixel-ratio for crisp rendering on HiDPI screens.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    const task = page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    });
    renders.set(num, task);
    await task.promise;
  } catch (e) {
    // Cancellation throws — harmless. Anything else is logged but non-fatal.
    if (!String(e).includes('Rendering cancelled')) {
      console.error(`Page ${num} render failed:`, e);
    }
  } finally {
    renders.delete(num);
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
