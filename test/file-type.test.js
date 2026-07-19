import { describe, it, expect } from 'vitest';
import {
  fileTypeClass,
  fileTypeFromPath,
  getFileIconHtml,
  getCodeBadge,
  getCodeBadgeForPath,
  getCodeBadgeHtml,
  getIconForPath,
  relativeTime,
} from '../src/lib/file-type.js';

describe('fileTypeClass', () => {
  it('maps markdown extensions to md', () => {
    expect(fileTypeClass('md')).toBe('md');
    expect(fileTypeClass('markdown')).toBe('md');
    expect(fileTypeClass('mdx')).toBe('md');
  });

  it('maps image extensions to img', () => {
    expect(fileTypeClass('png')).toBe('img');
    expect(fileTypeClass('jpg')).toBe('img');
    expect(fileTypeClass('jpeg')).toBe('img');
    expect(fileTypeClass('gif')).toBe('img');
    expect(fileTypeClass('webp')).toBe('img');
    expect(fileTypeClass('svg')).toBe('img');
    expect(fileTypeClass('ico')).toBe('img');
    expect(fileTypeClass('bmp')).toBe('img');
  });

  it('maps code extensions to code', () => {
    expect(fileTypeClass('js')).toBe('code');
    expect(fileTypeClass('ts')).toBe('code');
    expect(fileTypeClass('json')).toBe('code');
    expect(fileTypeClass('py')).toBe('code');
    expect(fileTypeClass('rs')).toBe('code');
    expect(fileTypeClass('yaml')).toBe('code');
    expect(fileTypeClass('yml')).toBe('code');
  });

  it('maps other known types', () => {
    expect(fileTypeClass('pdf')).toBe('pdf');
    expect(fileTypeClass('excalidraw')).toBe('ex');
    expect(fileTypeClass('txt')).toBe('txt');
    expect(fileTypeClass('log')).toBe('txt');
  });

  it('is case-insensitive', () => {
    expect(fileTypeClass('MD')).toBe('md');
    expect(fileTypeClass('JSON')).toBe('code');
    expect(fileTypeClass('PDF')).toBe('pdf');
  });

  it('returns empty string for unknown extensions or empty input', () => {
    expect(fileTypeClass('xyz')).toBe('');
    expect(fileTypeClass('')).toBe('');
    expect(fileTypeClass(null)).toBe('');
    expect(fileTypeClass(undefined)).toBe('');
  });
});

describe('fileTypeFromPath', () => {
  it('extracts the extension and classifies', () => {
    expect(fileTypeFromPath('C:\\Users\\me\\Notes\\hello.md')).toBe('md');
    expect(fileTypeFromPath('/home/me/code/main.rs')).toBe('code');
    expect(fileTypeFromPath('report.pdf')).toBe('pdf');
  });

  it('returns empty string for paths without extension', () => {
    expect(fileTypeFromPath('README')).toBe('');
    expect(fileTypeFromPath('')).toBe('');
    expect(fileTypeFromPath(null)).toBe('');
  });

  it('handles dotted filenames where the last segment is the extension', () => {
    expect(fileTypeFromPath('my.notes.md')).toBe('md');
    expect(fileTypeFromPath('archive.tar.gz')).toBe('');
  });
});

describe('getFileIconHtml', () => {
  it('emits an SVG with the file-icon class', () => {
    const html = getFileIconHtml('md');
    expect(html).toContain('<svg');
    expect(html).toContain('file-icon');
    expect(html).toContain('md');
  });

  it('appends an extra class when provided', () => {
    const html = getFileIconHtml('pdf', 'recent-icon');
    expect(html).toContain('recent-icon');
  });

  it('falls back to a generic file glyph for unknown types', () => {
    const unknown = getFileIconHtml('');
    expect(unknown).toContain('<svg');
    expect(unknown).not.toContain('md');
    expect(unknown).not.toContain('pdf');
  });
});

describe('getCodeBadge', () => {
  it('returns a badge spec for known code extensions', () => {
    expect(getCodeBadge('js')).toEqual({ label: 'JS', color: '#f7df1e' });
    expect(getCodeBadge('py')).toEqual({ label: 'PY', color: '#3776ab' });
    expect(getCodeBadge('rs')).toEqual({ label: 'RS', color: '#dea584' });
    expect(getCodeBadge('go')).toEqual({ label: 'GO', color: '#00add8' });
  });

  it('is case-insensitive', () => {
    expect(getCodeBadge('JS').label).toBe('JS');
    expect(getCodeBadge('Py').label).toBe('PY');
  });

  it('returns null for unknown / non-code extensions', () => {
    expect(getCodeBadge('md')).toBeNull();
    expect(getCodeBadge('pdf')).toBeNull();
    expect(getCodeBadge('xyz')).toBeNull();
    expect(getCodeBadge('')).toBeNull();
    expect(getCodeBadge(null)).toBeNull();
  });
});

describe('getCodeBadgeForPath', () => {
  it('extracts the extension and returns the badge', () => {
    expect(getCodeBadgeForPath('/home/me/app/main.py').label).toBe('PY');
    expect(getCodeBadgeForPath('C:\\dev\\src\\index.ts').label).toBe('TS');
  });

  it('special-cases well-known extension-less filenames', () => {
    expect(getCodeBadgeForPath('Dockerfile').label).toBe('🐳');
    expect(getCodeBadgeForPath('/srv/app/Dockerfile').label).toBe('🐳');
    expect(getCodeBadgeForPath('Makefile').label).toBe('MK');
    expect(getCodeBadgeForPath('Gemfile').label).toBe('GEM');
    expect(getCodeBadgeForPath('CMakeLists.txt').label).toBe('CMK');
  });

  it('returns null for non-code paths', () => {
    expect(getCodeBadgeForPath('readme.md')).toBeNull();
    expect(getCodeBadgeForPath('photo.png')).toBeNull();
    expect(getCodeBadgeForPath('README')).toBeNull();
  });
});

describe('getCodeBadgeHtml', () => {
  it('emits a span with the badge color as a CSS var', () => {
    const html = getCodeBadgeHtml({ label: 'JS', color: '#f7df1e' });
    expect(html).toContain('class="code-badge"');
    expect(html).toContain('--badge-color: #f7df1e');
    expect(html).toContain('>JS<');
  });

  it('appends an extra class when provided', () => {
    const html = getCodeBadgeHtml({ label: 'PY', color: '#3776ab' }, 'tab-icon');
    expect(html).toContain('tab-icon');
  });

  it('returns empty string for a null spec', () => {
    expect(getCodeBadgeHtml(null)).toBe('');
    expect(getCodeBadgeHtml(undefined)).toBe('');
  });
});

describe('getIconForPath', () => {
  it('renders an SVG glyph for special types (md)', () => {
    const html = getIconForPath('notes.md', 'tab-icon');
    expect(html).toContain('<svg');
    expect(html).toContain('file-icon md');
    expect(html).toContain('tab-icon');
  });

  it('renders a colored badge for code files (js, py, rs)', () => {
    const js = getIconForPath('app.js');
    expect(js).toContain('code-badge');
    expect(js).toContain('>JS<');
    expect(js).toContain('#f7df1e');

    const py = getIconForPath('script.py');
    expect(py).toContain('>PY<');

    const rs = getIconForPath('src/main.rs');
    expect(rs).toContain('>RS<');
  });

  it('renders a Dockerfile badge for the bare filename', () => {
    const html = getIconForPath('Dockerfile');
    expect(html).toContain('code-badge');
    expect(html).toContain('🐳');
  });

  it('falls back to the generic file glyph for unknown extensions', () => {
    const html = getIconForPath('weird.xyz');
    expect(html).toContain('<svg');
    expect(html).toContain('file-icon');
    // Should not carry any type class.
    expect(html).not.toContain('md');
    expect(html).not.toContain('code-badge');
  });

  it('falls back to the generic glyph for empty paths', () => {
    const html = getIconForPath('');
    expect(html).toContain('<svg');
  });
});

describe('relativeTime', () => {
  const NOW = new Date('2026-07-19T12:00:00Z').getTime();

  it('returns empty string for missing timestamp', () => {
    expect(relativeTime(0, NOW)).toBe('');
    expect(relativeTime(null, NOW)).toBe('');
    expect(relativeTime(undefined, NOW)).toBe('');
  });

  it('returns "just now" for very recent timestamps', () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe('just now');
    expect(relativeTime(NOW - 40_000, NOW)).toBe('just now');
  });

  it('returns minutes for sub-hour deltas', () => {
    expect(relativeTime(NOW - 60_000, NOW)).toBe('1m ago');
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    expect(relativeTime(NOW - 59 * 60_000, NOW)).toBe('59m ago');
  });

  it('returns hours for sub-day deltas', () => {
    expect(relativeTime(NOW - 60 * 60_000, NOW)).toBe('1h ago');
    expect(relativeTime(NOW - 3 * 60 * 60_000, NOW)).toBe('3h ago');
    expect(relativeTime(NOW - 23 * 60 * 60_000, NOW)).toBe('23h ago');
  });

  it('returns "yesterday" for a 1-day delta', () => {
    expect(relativeTime(NOW - 24 * 60 * 60_000, NOW)).toBe('yesterday');
  });

  it('returns "Nd ago" for sub-week deltas', () => {
    expect(relativeTime(NOW - 2 * 24 * 60 * 60_000, NOW)).toBe('2d ago');
    expect(relativeTime(NOW - 6 * 24 * 60 * 60_000, NOW)).toBe('6d ago');
  });

  it('returns a month-day stamp beyond a week', () => {
    // 14 days before NOW (2026-07-19) is 2026-07-05.
    const out = relativeTime(NOW - 14 * 24 * 60 * 60_000, NOW);
    expect(out).toMatch(/Jul/);
    expect(out).toMatch(/5/);
  });

  it('clamps future timestamps to "just now" rather than going negative', () => {
    expect(relativeTime(NOW + 60_000, NOW)).toBe('just now');
  });
});
