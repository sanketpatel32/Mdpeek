import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const CONTENT_CSS = read('src/styles/content.css');
const BASE_CSS = read('src/styles/base.css');
const MAIN_JS = read('src/main.js');
const PDF_VIEWER_JS = read('src/views/pdf-viewer.js');
const TERMINAL_JS = read('src/views/terminal.js');

describe('Zooming improvements across CSS stylesheets', () => {
  it('code-viewer uses --content-font-size for code-gutter and code-pre', () => {
    expect(CONTENT_CSS).toMatch(/\.code-gutter\s*\{[^}]*font-size:\s*var\(--content-font-size,/);
    expect(CONTENT_CSS).toMatch(/\.code-pre\s*\{[^}]*font-size:\s*var\(--content-font-size,/);
  });

  it('csv-table uses --content-font-size', () => {
    expect(CONTENT_CSS).toMatch(/\.csv-table\s*\{[^}]*font-size:\s*var\(--content-font-size,/);
  });

  it('image-viewer scales images with --zoom-level', () => {
    expect(CONTENT_CSS).toMatch(/\.image-viewer-img\s*\{[^}]*max-width:\s*calc\(100%\s*\*\s*var\(--zoom-level/);
    expect(CONTENT_CSS).toMatch(/\.image-viewer-img\s*\{[^}]*max-height:\s*calc\(\(100vh\s*-\s*140px\)\s*\*\s*var\(--zoom-level/);
  });

  it('notebook-viewer uses --content-font-size for raw cells, prompts, and outputs', () => {
    expect(CONTENT_CSS).toMatch(/\.nb-raw-pre\s*\{[^}]*font-size:\s*var\(--content-font-size,/);
    expect(CONTENT_CSS).toMatch(/\.nb-prompt\s*\{[^}]*font-size:\s*calc\(var\(--content-font-size,/);
    expect(CONTENT_CSS).toMatch(/\.nb-output\s*\{[^}]*font-size:\s*var\(--content-font-size,/);
    expect(CONTENT_CSS).toMatch(/\.nb-output pre\s*\{[^}]*font-size:\s*var\(--content-font-size,/);
    expect(CONTENT_CSS).toMatch(/\.nb-output-img\s*\{[^}]*max-width:\s*calc\(100%\s*\*\s*var\(--zoom-level/);
  });

  it('media-viewer video and audio cards scale with --zoom-level and --content-font-size', () => {
    expect(CONTENT_CSS).toMatch(/\.media-video-el\s*\{[^}]*max-width:\s*calc\(100%\s*\*\s*var\(--zoom-level/);
    expect(CONTENT_CSS).toMatch(/\.media-audio-card\s*\{[^}]*width:\s*min\(calc\(560px\s*\*\s*var\(--zoom-level/);
    expect(CONTENT_CSS).toMatch(/\.media-audio-name\s*\{[^}]*font-size:\s*var\(--content-font-size,/);
  });

  it('diff-pane uses --content-font-size in base.css', () => {
    expect(BASE_CSS).toMatch(/\.diff-pane\s*\{[^}]*font-size:\s*var\(--content-font-size,/);
  });

  it('table-editor .te-cell uses --content-font-size in base.css', () => {
    expect(BASE_CSS).toMatch(/\.te-cell\s*\{[^}]*font-size:\s*var\(--content-font-size,/);
  });
});

describe('Zooming logic in main.js and view modules', () => {
  it('applyZoom in main.js sets --zoom-level and triggers active image rerender', () => {
    expect(MAIN_JS).toMatch(/document\.documentElement\.style\.setProperty\('--zoom-level',/);
    expect(MAIN_JS).toMatch(/_activeImage\.rerender\(\)/);
  });

  it('applyZoom debounces PDF rerenderAll', () => {
    expect(MAIN_JS).toMatch(/_pdfZoomTimer = setTimeout/);
  });

  it('applyZoom calls terminal.updateZoom when present', () => {
    expect(MAIN_JS).toMatch(/terminal\.updateZoom\(zoomLevel\)/);
  });

  it('main.js supports Numpad keys for zoom shortcuts', () => {
    expect(MAIN_JS).toMatch(/e\.code === 'NumpadAdd'/);
    expect(MAIN_JS).toMatch(/e\.code === 'NumpadSubtract'/);
    expect(MAIN_JS).toMatch(/e\.code === 'Numpad0'/);
  });

  it('pdf-viewer.js tracks render generation counter (pdfRenderGen) to prevent race conditions', () => {
    expect(PDF_VIEWER_JS).toMatch(/pdfRenderGen/);
    expect(PDF_VIEWER_JS).toMatch(/localGen !== pdfRenderGen/);
  });

  it('terminal.js exposes updateZoom API', () => {
    expect(TERMINAL_JS).toMatch(/updateZoom\(zoomLevel = 1\)/);
  });
});
