// Settings search filter (v0.65.0).
//
// Lives in src/lib (not inline in main.js) so the filtering + restore
// behavior is unit-testable — the browser harness can't synthesize key
// events for the input, so the clear/restore path needs jsdom coverage.
//
// The filter is a plain substring match on row text, lowercased. Units:
//   - .setting-row   → filtered individually inside its card
//   - .setting-card  → hidden when none of its rows match
//   - loose blocks   → .help-section / .about-card / .changelog-body match
//                      as a whole (tables and lists aren't row-filtered)
//   - .settings-panel → hidden when it contains no visible content
// The empty query restores the category view: every row/card un-hidden and
// only the active category's panel visible.

const LOOSE_BLOCKS = ':scope > .help-section, :scope > .about-card, :scope > .changelog-body';

export function filterSettingsPanels(dialog, rawQuery, activeCat) {
  const panels = [...dialog.querySelectorAll('.settings-panel')];
  const query = (rawQuery || '').trim().toLowerCase();

  if (!query) {
    panels.forEach((p) => {
      p.classList.toggle('hidden', !!activeCat && p.dataset.cat !== activeCat);
      p.querySelectorAll('.setting-row, .setting-card, .help-section, .about-card, .changelog-body')
        .forEach((n) => n.classList.remove('hidden'));
    });
    return -1; // restored (caller hides the empty-state note)
  }

  let hits = 0;
  panels.forEach((p) => {
    let panelHits = 0;
    p.querySelectorAll('.setting-card').forEach((card) => {
      const rows = card.querySelectorAll('.setting-row');
      if (!rows.length) {
        // Wrapper cards without rows (rare): match on the whole block.
        if ((card.textContent || '').toLowerCase().includes(query)) panelHits++;
        else card.classList.add('hidden');
        return;
      }
      let cardHits = 0;
      rows.forEach((row) => {
        const ok = (row.textContent || '').toLowerCase().includes(query);
        row.classList.toggle('hidden', !ok);
        if (ok) cardHits++;
      });
      card.classList.toggle('hidden', cardHits === 0);
      panelHits += cardHits;
    });
    p.querySelectorAll(LOOSE_BLOCKS).forEach((block) => {
      const ok = (block.textContent || '').toLowerCase().includes(query);
      block.classList.toggle('hidden', !ok);
      if (ok) panelHits++;
    });
    p.classList.toggle('hidden', panelHits === 0);
    hits += panelHits;
  });
  return hits;
}
