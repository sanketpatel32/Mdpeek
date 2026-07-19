// Renders the tab strip into #tab-strip from a DocumentStore.
// Returns nothing; main.js attaches click/close handlers after render.

import { escapeHtml } from '../lib/escape.js';

function titleFor(doc) {
  if (doc.path) {
    const parts = doc.path.split(/[\\/]/);
    return parts[parts.length - 1];
  }
  return 'Untitled';
}

// File-type badge for saved files; no badge for untitled tabs.
function iconFor(doc) {
  if (!doc.path) return '';
  const ext = (doc.path.split('.').pop() || '').toLowerCase();
  const cls = fileTypeClass(ext);
  return `<svg class="tab-icon file-icon ${cls}" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
}

function fileTypeClass(ext) {
  if (['md', 'markdown', 'mdx'].includes(ext)) return 'md';
  if (['txt', 'log'].includes(ext)) return 'txt';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['excalidraw'].includes(ext)) return 'ex';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return 'img';
  if (['js', 'ts', 'json', 'html', 'css', 'py', 'go', 'rs', 'java', 'cpp', 'c', 'sh', 'bash', 'zsh', 'yaml', 'yml', 'toml'].includes(ext)) return 'code';
  return '';
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

  strip.innerHTML = html;

  // Auto-scroll the active tab into view so switching to a tab that's scrolled
  // out of view brings it visible.
  const active = strip.querySelector('.tab.active');
  if (active) {
    active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}
