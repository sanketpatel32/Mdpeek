// Shared HTML-escape utility. Escapes &, <, >, ", and ' — safe for both
// element text content AND attribute values. Consolidates the inline copies
// that previously lived in pdf-viewer.js, excalidraw-viewer.js, and tabs.js.
export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
