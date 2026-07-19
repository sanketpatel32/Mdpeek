import { describe, it, expect } from 'vitest';
import {
  fileTypeClass,
  fileTypeFromPath,
  getFileIconHtml,
  getIconForPath,
  relativeTime,
} from '../src/lib/file-type.js';
import {
  getLanguageIcon,
  getLanguageIconForPath,
  renderLanguageIcon,
  LANGUAGE_ICONS,
} from '../src/lib/language-icons.js';

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

describe('getLanguageIcon', () => {
  it('returns an icon spec for known code extensions', () => {
    expect(getLanguageIcon('js')).toBeDefined();
    expect(getLanguageIcon('py')).toBeDefined();
    expect(getLanguageIcon('rs')).toBeDefined();
    expect(getLanguageIcon('go')).toBeDefined();
    expect(getLanguageIcon('ts')).toBeDefined();
  });

  it('is case-insensitive', () => {
    expect(getLanguageIcon('JS')).toBeDefined();
    expect(getLanguageIcon('Py')).toBeDefined();
  });

  it('returns null for unknown / non-code extensions', () => {
    expect(getLanguageIcon('md')).toBeNull();
    expect(getLanguageIcon('pdf')).toBeNull();
    expect(getLanguageIcon('xyz')).toBeNull();
    expect(getLanguageIcon('')).toBeNull();
    expect(getLanguageIcon(null)).toBeNull();
  });

  it('each icon has viewBox + inner markup with at least one shape', () => {
    for (const spec of Object.values(LANGUAGE_ICONS)) {
      expect(typeof spec.viewBox).toBe('string');
      expect(spec.viewBox.length).toBeGreaterThan(0);
      expect(typeof spec.inner).toBe('string');
      // Inner content must have at least one shape element (path, circle,
      // rect, g, etc.) — graphql uses circles inside a <g> wrapper.
      expect(
        spec.inner.includes('<path') ||
        spec.inner.includes('<circle') ||
        spec.inner.includes('<rect') ||
        spec.inner.includes('<g') ||
        spec.inner.includes('<polygon')
      ).toBe(true);
    }
  });
});

describe('getLanguageIconForPath', () => {
  it('extracts the extension and returns the icon', () => {
    expect(getLanguageIconForPath('/home/me/app/main.py')).toBeDefined();
    expect(getLanguageIconForPath('C:\\dev\\src\\index.ts')).toBeDefined();
  });

  it('special-cases well-known extension-less filenames', () => {
    expect(getLanguageIconForPath('Dockerfile')).toBeDefined();
    expect(getLanguageIconForPath('/srv/app/Dockerfile')).toBeDefined();
    expect(getLanguageIconForPath('Makefile')).toBeDefined();
    expect(getLanguageIconForPath('Gemfile')).toBeDefined();
    expect(getLanguageIconForPath('CMakeLists.txt')).toBeDefined();
  });

  it('returns null for non-code paths', () => {
    expect(getLanguageIconForPath('readme.md')).toBeNull();
    expect(getLanguageIconForPath('photo.png')).toBeNull();
    expect(getLanguageIconForPath('README')).toBeNull();
  });
});

describe('renderLanguageIcon', () => {
  it('emits an svg with the lang-icon class', () => {
    const spec = getLanguageIcon('js');
    const html = renderLanguageIcon(spec);
    expect(html).toContain('<svg');
    expect(html).toContain('lang-icon');
    expect(html).toContain(spec.viewBox);
    expect(html).toContain(spec.inner);
  });

  it('appends an extra class when provided', () => {
    const html = renderLanguageIcon(getLanguageIcon('py'), 'tab-icon');
    expect(html).toContain('tab-icon');
  });

  it('returns empty string for a null spec', () => {
    expect(renderLanguageIcon(null)).toBe('');
    expect(renderLanguageIcon(undefined)).toBe('');
  });
});

describe('getIconForPath', () => {
  it('renders the special SVG glyph for markdown', () => {
    const html = getIconForPath('notes.md', 'tab-icon');
    expect(html).toContain('<svg');
    expect(html).toContain('file-icon md');
    expect(html).toContain('tab-icon');
    // Should NOT use the language-icon path (md is a special type).
    expect(html).not.toContain('lang-icon');
  });

  it('renders a real material icon for code files (js, py, rs, go)', () => {
    const js = getIconForPath('app.js');
    expect(js).toContain('<svg');
    expect(js).toContain('lang-icon');
    expect(js).toContain('#ffca28'); // JS brand color baked into the SVG

    const py = getIconForPath('script.py');
    expect(py).toContain('lang-icon');

    const rs = getIconForPath('src/main.rs');
    expect(rs).toContain('lang-icon');
  });

  it('renders the docker icon for the bare filename', () => {
    const html = getIconForPath('Dockerfile');
    expect(html).toContain('lang-icon');
  });

  it('falls back to the generic file glyph for unknown extensions', () => {
    const html = getIconForPath('weird.xyz');
    expect(html).toContain('<svg');
    expect(html).toContain('file-icon');
    expect(html).not.toContain('lang-icon');
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
