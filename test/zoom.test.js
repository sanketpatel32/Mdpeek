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

  it('table-editor .te-cell uses --content-font-size in base.css', () => {
    expect(BASE_CSS).toMatch(/\.te-cell\s*\{[^}]*font-size:\s*var\(--content-font-size,/);
  });
});

describe('Zooming logic in main.js and view modules', () => {
  it('applyZoom in main.js sets --zoom-level and triggers active image rerender', () => {
    expect(MAIN_JS).toMatch(/document\.documentElement\.style\.setProperty\('--zoom-level',/);
    expect(MAIN_JS).toMatch(/_activeImage\.rerender\(\)/);
  });

  it('main.js supports Numpad keys for zoom shortcuts', () => {
    expect(MAIN_JS).toMatch(/e\.code === 'NumpadAdd'/);
    expect(MAIN_JS).toMatch(/e\.code === 'NumpadSubtract'/);
    expect(MAIN_JS).toMatch(/e\.code === 'Numpad0'/);
  });
});
