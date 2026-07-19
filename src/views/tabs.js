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

function getFileIconHtml(cls, extraClass = '') {
  const extra = extraClass ? ` ${extraClass}` : '';
  if (cls === 'md') {
    return `<svg class="file-icon md${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 11v4M8 11l2 2 2-2M12 11v4"/></svg>`;
  }
  if (cls === 'pdf') {
    return `<svg class="file-icon pdf${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 11v4M9 11h2.5a1.5 1.5 0 0 0 0-3H9"/></svg>`;
  }
  if (cls === 'img') {
    return `<svg class="file-icon img${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  }
  if (cls === 'code') {
    return `<svg class="file-icon code${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
  }
  if (cls === 'ex') {
    return `<svg class="file-icon ex${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="10" height="10" rx="1"/><circle cx="15" cy="15" r="5"/><path d="M13 8h5v5"/></svg>`;
  }
  if (cls === 'txt') {
    return `<svg class="file-icon txt${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="15" x2="14" y2="15"/></svg>`;
  }
  // Default fallback icon
  return `<svg class="file-icon${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
}

// File-type badge for saved files; no badge for untitled tabs.
function iconFor(doc) {
  if (!doc.path) return '';
  const ext = (doc.path.split('.').pop() || '').toLowerCase();
  const cls = fileTypeClass(ext);
  return getFileIconHtml(cls, 'tab-icon');
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
