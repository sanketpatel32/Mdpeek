import { isPdfPath, isImagePath, isMediaPath } from './documents.js';

// Unsaved buffers win over disk, for both startup and named workspaces.
export function restoreSessionDocs(docs, invoke) {
  return Promise.all(docs.map(async (doc) => {
    if (!doc.path || doc.dirty) return doc;
    if (isPdfPath(doc.path) || isImagePath(doc.path) || isMediaPath(doc.path)) return { ...doc, content: '', dirty: false };
    try {
      const content = await invoke('read_file', { path: doc.path });
      return { ...doc, content, dirty: false };
    } catch {
      return { ...doc, dirty: true }; // keep the recovered buffer saveable
    }
  }));
}
