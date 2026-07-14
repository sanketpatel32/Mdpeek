// Renders the tab strip into #tab-strip from a DocumentStore.
// Returns nothing; main.js attaches click/close handlers after render.

function titleFor(doc) {
  if (doc.path) {
    const parts = doc.path.split(/[\\/]/);
    return parts[parts.length - 1];
  }
  return 'Untitled';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// File-type badge for saved files; no badge for untitled tabs.
function iconFor(doc) {
  if (!doc.path) return '';
  if (doc.pdf) return '<span class="tab-icon">PDF</span>';
  if (doc.excalidraw) return '<span class="tab-icon">EX</span>';
  return '<span class="tab-icon">M&#8203;D</span>';
}

export function renderTabs(store) {
  const strip = document.getElementById('tab-strip');
  if (!strip) return;

  const html = store.docs
    .map((d) => {
      const active = d.id === store.activeId ? ' active' : '';
      const dirty = d.dirty ? '<span class="tab-dot" title="Unsaved changes">●</span>' : '';
      const icon = iconFor(d);
      const title = escapeHtml(titleFor(d));
      return `<div class="tab${active}" data-id="${d.id}" title="${escapeHtml(d.path || 'Untitled')}">
        ${icon}<span class="tab-title">${title}</span>${dirty}
        <span class="tab-close" data-id="${d.id}" title="Close (Ctrl+W)">×</span>
      </div>`;
    })
    .join('');

  strip.innerHTML = `${html}<button id="tab-new" class="tab-new" title="New tab (Ctrl+N)">+</button>`;
}
