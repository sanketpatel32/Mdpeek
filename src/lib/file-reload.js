// A queued watcher event may belong to the tab we just left. Match the path
// before touching any buffer, and keep unsaved text authoritative.
export function applyFileChange(store, payload) {
  if (!payload || typeof payload.path !== 'string' || typeof payload.content !== 'string') return null;
  const normalize = (path) => path?.replace(/\\/g, '/').toLowerCase();
  const doc = store.docs.find((doc) => normalize(doc.path) === normalize(payload.path));
  if (!doc || doc.pdf || doc.image || doc.media || doc.excalidraw || doc.tldraw) return null;
  if (doc.dirty) return { doc, conflict: true };
  doc.content = payload.content;
  return { doc, conflict: false };
}
