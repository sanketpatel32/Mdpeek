import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const themes = new Map();
const css = readFileSync('src/styles/themes.css', 'utf8');
for (const [, name, body] of css.matchAll(/:root\[data-theme="([^"]+)"\]\s*\{([^}]+)\}/g)) {
  const colors = themes.get(name) || {};
  for (const [, token, value] of body.matchAll(/--([a-z-]+):\s*(#[\da-f]{6})/gi)) colors[token] = value;
  themes.set(name, colors);
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

it.each([...themes])('%s keeps small text and filled-button labels readable', (_, colors) => {
  for (const background of ['bg', 'bg-elevated', 'surface']) {
    for (const text of ['fg', 'fg-secondary', 'fg-muted', 'accent']) {
      expect(contrast(colors[text], colors[background]), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  }
  for (const background of ['accent', 'accent-hover', 'danger']) {
    const label = background === 'danger' ? 'on-danger' : 'on-accent';
    expect(contrast(colors[label], colors[background]), `${label} on ${background}`).toBeGreaterThanOrEqual(4.5);
  }
});
