// Renders the tab strip into #tab-strip from a DocumentStore.
// Returns nothing; main.js attaches click/close handlers after render.

import { escapeHtml } from '../lib/escape.js';
import { getIconForPath } from '../lib/file-type.js';

function titleFor(doc) {
  if (doc.path) {
    const parts = doc.path.split(/[\\/]/);
    return parts[parts.length - 1];
  }
  return 'Untitled';
}

// File-type badge for saved files; no badge for untitled tabs.
// getIconForPath picks the right glyph (SVG for special types, colored
// letter badge for code languages, generic file otherwise).
function iconFor(doc) {
  if (!doc.path) return '';
  return getIconForPath(doc.path, 'tab-icon');
}

export function renderTabs(store) {
  const strip = document.getElementById('tab-strip');
  if (!strip) return;

  const html = store.docs
    .map((d) => {
      const active = d.id === store.activeId ? ' active' : '';
      const pinned = d.pinned ? ' pinned' : '';
      const dirty = d.dirty ? '<span class="tab-dot" title="Unsaved changes">●</span>' : '';
      const icon = iconFor(d);
      const title = escapeHtml(titleFor(d));
      // Pinned tabs: title is hidden via CSS; the close × is also hidden (you
      // unpin via the context menu, not by closing). Title attribute still
      // carries the filename so hover-tooltips keep working.
      return `<div class="tab${active}${pinned}" data-id="${d.id}" title="${escapeHtml(d.path || 'Untitled')}">
        ${icon}<span class="tab-title">${title}</span>${dirty}
        <span class="tab-close" data-id="${d.id}" title="Close (Ctrl+W)">×</span>
      </div>`;
    })
    .join('');

  strip.innerHTML = html;

  // Auto-scroll the active tab into view so switching to a tab that's scrolled
  // out of view brings it visible.
  const active = strip.querySelector('.tab.active');
  if (active) {
    active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}
