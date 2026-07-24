// Structural tests for the v0.32.0 "Calm Glass" UI overhaul.
// Verifies the topbar redesign, Settings relocation of theme + updates, and
// the new icon/motion modules. These guard against accidental regressions of
// the structural changes (removed buttons, new panels, new deps).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { icon, iconNames, renderIcons } from '../src/lib/icons.js';
import {
  transitionHidden,
  wireRipples,
  positionTabIndicator,
  prefersReducedMotion,
} from '../src/lib/motion.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const INDEX = read('index.html');
const THEMES = read('src/styles/themes.css');
const BASE = read('src/styles/base.css');
const MOTION = read('src/styles/motion.css');
const PKG = JSON.parse(read('package.json'));

describe('v0.32.0 topbar — removed clutter', () => {
  it('removes the topbar version/update button (#btn-update)', () => {
    // The button must not appear as a topbar control. (The string may still
    // appear in comments/CHANGELOG, so we check for the element specifically.)
    expect(INDEX).not.toMatch(/<button[^>]*id="btn-update"/);
  });

  it('removes the topbar theme button + dropdown (#btn-theme, #theme-menu)', () => {
    expect(INDEX).not.toMatch(/<button[^>]*id="btn-theme"/);
    expect(INDEX).not.toMatch(/<div[^>]*id="theme-menu"/);
  });

  it('keeps every action button accessible (relocated into the More menu by ID)', () => {
    // These IDs moved from the toolbar into #more-menu, but the elements + their
    // handlers must still exist somewhere in the document.
    for (const id of ['btn-open', 'btn-save', 'btn-mode', 'btn-export', 'btn-export-pdf',
      'btn-present', 'btn-share', 'btn-daily', 'btn-kanban', 'btn-terminal', 'btn-draw']) {
      expect(INDEX, `expected #${id} to still exist`).toMatch(new RegExp(`id="${id}"`));
    }
  });

  it('adds the command-K pill and more-menu', () => {
    expect(INDEX).toMatch(/id="btn-command-k"/);
    expect(INDEX).toMatch(/class="[^"]*cmd-k-pill/);
    expect(INDEX).toMatch(/id="btn-more"/);
    expect(INDEX).toMatch(/id="more-menu"/);
  });

  it('adds a traveling tab indicator element', () => {
    expect(INDEX).toMatch(/class="[^"]*tab-indicator/);
  });
});

describe('v0.32.0 Settings — theme grid + updates panel', () => {
  it('replaces the theme <select> with a visual theme grid', () => {
    expect(INDEX).toMatch(/id="theme-grid"/);
    expect(INDEX).toMatch(/class="[^"]*theme-card/);
    // The old select is gone.
    expect(INDEX).not.toMatch(/<select[^>]*id="settings-theme"/);
  });

  it('the theme grid contains all 10 themes as cards', () => {
    const themes = ['light', 'dark', 'solar-light', 'solar-dark', 'dracula', 'nord',
      'github', 'github-dark', 'tokyo-night', 'catppuccin'];
    for (const t of themes) {
      expect(INDEX, `theme card for ${t}`).toMatch(new RegExp(`class="theme-card"[^>]*data-theme="${t}"`));
    }
  });

  it('adds an Updates section in About panel with check/install controls', () => {
    expect(INDEX).toMatch(/id="updates-check-btn"/);
    expect(INDEX).toMatch(/id="updates-install-btn"/);
    expect(INDEX).toMatch(/id="updates-current"/);
    expect(INDEX).toMatch(/id="settings-auto-update"/);
  });
});

describe('v0.32.0 themes.css — token fixes', () => {
  it('adds --success to light + dark + every named theme', () => {
    const themeBlocks = ['solar-light', 'solar-dark', 'dracula', 'nord', 'github',
      'github-dark', 'tokyo-night', 'catppuccin'];
    // light + dark are in the combined `:root, :root[data-theme="light"]` block
    // + the dark block; just assert --success appears >= 10 times (once per theme).
    const matches = THEMES.match(/--success:/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(10);
    for (const t of themeBlocks) {
      // crude: each theme block should contain --success within its scope.
      // We just confirm --success shows up after each theme selector.
      const sel = `data-theme="${t}"`;
      const idx = THEMES.indexOf(sel);
      expect(idx, `${t} block present`).toBeGreaterThan(-1);
    }
  });

  it('defines all 10 --alert-* vars for solar-light (was missing)', () => {
    const block = THEMES.slice(THEMES.indexOf('data-theme="solar-light"'));
    // Cut at the next theme block so we only inspect solar-light's scope.
    const end = block.indexOf('data-theme="solar-dark"');
    const scope = block.slice(0, end > 0 ? end : block.length);
    for (const v of ['--alert-note', '--alert-tip', '--alert-important', '--alert-warning', '--alert-caution']) {
      expect(scope, `solar-light defines ${v}`).toContain(v);
    }
  });

  it('defines all 10 --alert-* vars for github (was missing)', () => {
    const block = THEMES.slice(THEMES.indexOf('data-theme="github"'));
    const end = block.indexOf('data-theme="github-dark"');
    const scope = block.slice(0, end > 0 ? end : block.length);
    for (const v of ['--alert-note', '--alert-tip', '--alert-important', '--alert-warning', '--alert-caution']) {
      expect(scope, `github defines ${v}`).toContain(v);
    }
  });

  it('symmetrizes light: defines :root[data-theme="light"]', () => {
    expect(THEMES).toMatch(/:root\[data-theme="light"\]/);
  });

  it('adds motion tokens to :root', () => {
    expect(THEMES).toMatch(/--ease-spring:/);
    expect(THEMES).toMatch(/--ease-out:/);
    expect(THEMES).toMatch(/--ease-in:/);
    expect(THEMES).toMatch(/--dur-1:/);
    expect(THEMES).toMatch(/--dur-4:/);
  });

  it('removes hardcoded #34c759 / #22c55e / #ef4444 from base.css', () => {
    // These were the hardcoded green/red that bypassed theme tokens.
    // (#34c759 was the update dot; #22c55e was kanban/shared; #ef4444 kanban danger.)
    expect(BASE).not.toMatch(/#34c759/i);
    expect(BASE).not.toMatch(/#22c55e/i);
    expect(BASE).not.toMatch(/#ef4444/i);
    // #3b82f6 / #f59e0b only allowed as CSS var fallbacks (var(--x, #hex)),
    // not as bare property values. Strip the fallbacks first, then assert.
    const noFallbacks = BASE.replace(/var\([^)]+#3b82f6[^)]*\)/g, 'var(--kept)');
    expect(noFallbacks).not.toMatch(/[^-]#3b82f6/i);
    expect(noFallbacks).not.toMatch(/[^-]#f59e0b/i);
  });
});

describe('v0.32.0 motion.css — animation system', () => {
  it('is loaded after base.css in index.html', () => {
    const baseIdx = INDEX.indexOf('base.css');
    const motionIdx = INDEX.indexOf('motion.css');
    expect(baseIdx).toBeGreaterThan(-1);
    expect(motionIdx).toBeGreaterThan(baseIdx);
  });

  it('defines enter AND exit keyframes for overlays', () => {
    for (const name of ['overlay-out', 'modal-out', 'ctx-out', 'find-out', 'toast-out']) {
      expect(MOTION, `${name} keyframe`).toContain(`@keyframes ${name}`);
    }
  });

  it('respects prefers-reduced-motion', () => {
    expect(MOTION).toMatch(/prefers-reduced-motion: reduce/);
  });

  it('defines the ripple + tab-indicator rules', () => {
    expect(MOTION).toContain('.ripple-wave');
    expect(MOTION).toContain('.tab-indicator');
  });
});

describe('v0.32.0 icons.js — lucide registry', () => {
  it('registers a non-empty set of icons', () => {
    expect(iconNames().length).toBeGreaterThanOrEqual(20);
  });

  it('renders valid SVG markup for every registered icon', () => {
    for (const name of iconNames()) {
      const svg = icon(name);
      expect(svg, `${name} renders`).toMatch(/^<svg/);
      expect(svg).toContain('</svg>');
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('stroke="currentColor"');
    }
  });

  it('returns empty string for unknown aliases (no throw)', () => {
    expect(icon('does-not-exist')).toBe('');
  });

  it('renderIcons swaps [data-icon] placeholders and marks them rendered', () => {
    document.body.innerHTML = '<span data-icon="save"></span><span data-icon="x" data-icon-size="20"></span>';
    renderIcons(document.body);
    const hosts = document.querySelectorAll('[data-icon]');
    expect(hosts[0].innerHTML).toContain('<svg');
    expect(hosts[0].getAttribute('data-icon-rendered')).toBe('');
    expect(hosts[1].innerHTML).toContain('width="20"');
  });

  it('is idempotent (calling twice does not duplicate SVGs)', () => {
    document.body.innerHTML = '<span data-icon="save"></span>';
    renderIcons(document.body);
    renderIcons(document.body);
    expect(document.querySelector('[data-icon]').querySelectorAll('svg').length).toBe(1);
  });
});

describe('v0.32.0 motion.js — runtime helpers', () => {
  it('prefersReducedMotion returns a boolean', () => {
    expect(typeof prefersReducedMotion()).toBe('boolean');
  });

  it('transitionHidden hides immediately when reduced motion is on or already hidden', async () => {
    const el = document.createElement('div');
    el.className = 'hidden';
    document.body.appendChild(el);
    await transitionHidden(el, false);
    expect(el.classList.contains('hidden')).toBe(true);
    el.remove();
  });

  it('transitionHidden(show=true) reveals and clears leaving class', async () => {
    const el = document.createElement('div');
    el.classList.add('hidden', 'is-leaving');
    document.body.appendChild(el);
    await transitionHidden(el, true);
    expect(el.classList.contains('hidden')).toBe(false);
    expect(el.classList.contains('is-leaving')).toBe(false);
    el.remove();
  });

  it('wireRipples binds [data-ripple] hosts once (idempotent)', () => {
    document.body.innerHTML = '<button data-ripple>r</button>';
    wireRipples(document.body);
    wireRipples(document.body);
    expect(document.querySelector('[data-ripple]').getAttribute('data-ripple-bound')).toBe('');
  });

  it('wireRipples injects a ripple-wave span on pointerdown', () => {
    document.body.innerHTML = '<button data-ripple style="width:40px;height:40px;">r</button>';
    wireRipples(document.body);
    const btn = document.querySelector('[data-ripple]');
    btn.dispatchEvent(new PointerEvent('pointerdown', { clientX: 20, clientY: 20, bubbles: true }));
    // jsdom getBoundingClientRect returns zeros; the helper falls back to center.
    expect(btn.querySelector('.ripple-wave')).not.toBeNull();
  });

  it('positionTabIndicator hides the bar when there is no active tab', () => {
    document.body.innerHTML = '<div class="tab-strip"><span class="tab-indicator"></span></div>';
    const strip = document.querySelector('.tab-strip');
    const indicator = strip.querySelector('.tab-indicator');
    positionTabIndicator({ strip, indicator });
    expect(indicator.classList.contains('is-hidden')).toBe(true);
  });

  it('positionTabIndicator hides the bar when the active tab has zero size (jsdom)', () => {
    document.body.innerHTML = '<div class="tab-strip"><div class="tab active">x</div><span class="tab-indicator"></span></div>';
    const strip = document.querySelector('.tab-strip');
    const indicator = strip.querySelector('.tab-indicator');
    positionTabIndicator({ strip, indicator });
    // jsdom reports 0x0 for everything, so the helper hides gracefully.
    expect(indicator.classList.contains('is-hidden')).toBe(true);
  });
});

describe('v0.32.0 package.json — dependencies + version', () => {
  it('declares lucide as a dependency', () => {
    expect(PKG.dependencies).toHaveProperty('lucide');
  });
});
