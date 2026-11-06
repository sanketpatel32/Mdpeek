import { describe, it, expect } from 'vitest';
import { generateQrMatrix, generateQrSvg } from '../src/lib/qrcode.js';

describe('qrcode.js pure SVG QR code generator', () => {
  it('generates a valid binary matrix for a URL', () => {
    const matrix = generateQrMatrix('http://192.168.1.104:4789');
    expect(Array.isArray(matrix)).toBe(true);
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix[0].length).toBe(matrix.length);

    // Verify finder patterns exist at corners
    // Top-left finder center (3, 3) must be true (black)
    expect(matrix[3][3]).toBe(true);
    // Outer border of finder (0, 0) must be true
    expect(matrix[0][0]).toBe(true);
    // Separator around finder (7, 0) must be false
    expect(matrix[7][0]).toBe(false);
  });

  it('generates well-formed SVG string with requested colors and dimensions', () => {
    const svg = generateQrSvg('http://192.168.1.50:4789', {
      size: 240,
      margin: 4,
      fgColor: '#1e293b',
      bgColor: '#f8fafc'
    });

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="240"');
    expect(svg).toContain('height="240"');
    expect(svg).toContain('fill="#f8fafc"');
    expect(svg).toContain('fill="#1e293b"');
    expect(svg).toContain('<path d="M');
    expect(svg).toContain('</svg>');
  });

  it('handles empty and long strings gracefully', () => {
    const shortSvg = generateQrSvg('test');
    expect(shortSvg).toContain('<svg');

    const longUrl = 'http://192.168.1.120:4789/?session=mdpeek_collab_room_9876543210_abcdef';
    const longSvg = generateQrSvg(longUrl);
    expect(longSvg).toContain('<svg');
  });
});
