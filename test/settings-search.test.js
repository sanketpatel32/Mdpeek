// v0.65.0: settings search filter — covers the filtering AND the
// clear/restore path (the browser harness can't synthesize key events,
// so restore behavior is verified here instead).
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { filterSettingsPanels } from '../src/lib/settings-search.js';

// Minimal settings-dialog skeleton mirroring index.html structure:
// panels → cards → rows, plus a reference panel with a loose block.
const HTML = `
<div id="settings-dialog">
  <div class="settings-panel" data-cat="general">
    <div class="setting-card">
      <div class="setting-row"><div>Close button action</div></div>
      <div class="setting-row"><div>Desktop notifications</div></div>
    </div>
  </div>
  <div class="settings-panel hidden" data-cat="appearance">
    <div class="setting-card">
      <div class="setting-row"><div>Font size</div></div>
      <div class="setting-row"><div>Line spacing</div></div>
    </div>
    <div class="setting-card">
      <div class="setting-row"><div>Theme mode</div></div>
    </div>
  </div>
  <div class="settings-panel hidden" data-cat="shortcuts">
    <div class="help-section">Global shortcuts table with Ctrl+N</div>
  </div>
  <div class="settings-panel hidden" data-cat="about">
    <div class="about-card">mdpeek version info</div>
  </div>
</div>`;

function build() {
  const dom = new JSDOM(HTML);
  const dialog = dom.window.document.getElementById('settings-dialog');
  return dialog;
}

const hidden = (el) => el.classList.contains('hidden');
const panel = (dialog, cat) => dialog.querySelector(`.settings-panel[data-cat="${cat}"]`);
const row = (dialog, text) => [...dialog.querySelectorAll('.setting-row')].find((r) => r.textContent.includes(text));

describe('filterSettingsPanels', () => {
  let dialog;
  beforeEach(() => { dialog = build(); });

  it('filters rows and cards to the query, across panels', () => {
    const hits = filterSettingsPanels(dialog, 'font size', 'general');
    expect(hits).toBe(1);
    expect(hidden(row(dialog, 'Font size'))).toBe(false);
    expect(hidden(row(dialog, 'Line spacing'))).toBe(true);
    // Non-matching card hidden entirely.
    expect(hidden(dialog.querySelectorAll('.setting-card')[2])).toBe(true);
    // Only the panel with hits is visible.
    expect(hidden(panel(dialog, 'appearance'))).toBe(false);
    expect(hidden(panel(dialog, 'general'))).toBe(true);
  });

  it('matches loose blocks (help/about) as whole units', () => {
    const hits = filterSettingsPanels(dialog, 'shortcuts', 'general');
    expect(hits).toBe(1);
    expect(hidden(panel(dialog, 'shortcuts'))).toBe(false);
    expect(hidden(panel(dialog, 'about'))).toBe(true);

    const hits2 = filterSettingsPanels(dialog, 'mdpeek', 'general');
    expect(hits2).toBe(1);
    expect(hidden(panel(dialog, 'about'))).toBe(false);
  });

  it('returns 0 and hides every panel when nothing matches', () => {
    const hits = filterSettingsPanels(dialog, 'zzz-nothing', 'general');
    expect(hits).toBe(0);
    [...dialog.querySelectorAll('.settings-panel')].forEach((p) => {
      expect(hidden(p)).toBe(true);
    });
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(filterSettingsPanels(dialog, '  FONT ', 'general')).toBe(1);
  });

  it('restores the active category panel and unhides everything on empty query', () => {
    filterSettingsPanels(dialog, 'theme', 'appearance');
    // Sanity: filtering happened.
    expect(hidden(panel(dialog, 'general'))).toBe(true);

    const hits = filterSettingsPanels(dialog, '', 'appearance');
    expect(hits).toBe(-1);
    // Active category visible, others hidden.
    expect(hidden(panel(dialog, 'appearance'))).toBe(false);
    expect(hidden(panel(dialog, 'general'))).toBe(true);
    // All rows/cards un-hidden.
    [...dialog.querySelectorAll('.setting-row, .setting-card, .help-section, .about-card')]
      .forEach((n) => expect(hidden(n)).toBe(false));
  });

  it('with no active category, empty query shows every panel', () => {
    filterSettingsPanels(dialog, 'theme', 'appearance');
    filterSettingsPanels(dialog, '', null);
    [...dialog.querySelectorAll('.settings-panel')].forEach((p) => {
      expect(hidden(p)).toBe(false);
    });
  });

  it('wrapper cards without rows match on their whole text', () => {
    const dom2 = new JSDOM(`
      <div>
        <div class="settings-panel" data-cat="x">
          <div class="setting-card"><div class="setting-row">Alpha row</div></div>
          <div class="setting-card"><p>Wrapper block gamma</p></div>
        </div>
      </div>`);
    const d2 = dom2.window.document.querySelector('.settings-panel').parentElement;
    expect(filterSettingsPanels(d2, 'gamma', 'x')).toBe(1);
    expect(hidden(d2.querySelectorAll('.setting-card')[1])).toBe(false);
    expect(hidden(d2.querySelectorAll('.setting-card')[0])).toBe(true);
  });
});
