import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('Codebase bug fixes & hardening audit', () => {
  it('defines missing CSS design tokens in themes.css', () => {
    const themes = read('src/styles/themes.css');
    expect(themes).toMatch(/--radius-md\s*:/);
    expect(themes).toMatch(/--mono-font\s*:/);
    expect(themes).toMatch(/--reader-surface\s*:/);
    expect(themes).toMatch(/--reader-surface-hover\s*:/);
  });

  it('keeps package-lock.json and package.json version in sync', () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
  });

  it('highlights matched characters across all matching rows in command-palette.js', () => {
    const palette = read('src/views/command-palette.js');
    expect(palette).not.toMatch(/i === 0 \? s\.indices : null/);
    expect(palette).toMatch(/highlight\(s\.item\.label,\s*s\.indices,\s*query\)/);
  });

  it('guards lightbox keydown handler against firing when closed', () => {
    const renderer = read('src/lib/renderer.js');
    expect(renderer).toMatch(/if \(!overlay\.classList\.contains\('open'\)\) return;/);
  });

  it('provides safe pointer-capture handling on media viewer scrubber', () => {
    const mediaViewer = read('src/views/media-viewer.js');
    expect(mediaViewer).toMatch(/setPointerCapture/);
    expect(mediaViewer).toMatch(/releasePointerCapture/);
    expect(mediaViewer).toMatch(/pointercancel/);
  });

  it('includes save-as command and safeCssEscape in main.js', () => {
    const main = read('src/main.js');
    expect(main).toMatch(/id:\s*'save-as'/);
    expect(main).toMatch(/async function saveActiveAs\(\)/);
    expect(main).toMatch(/function safeCssEscape\(/);
    expect(main).toMatch(/safeCssEscape\(id\)/);
  });
});
