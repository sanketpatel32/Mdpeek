// Save pipeline for the active document, dependency-injected so it stays
// DOM-free and unit-testable. main.js binds { invoke, toast, fmtErr, … } to
// its live collaborators; behavior mirrors the original saveActive() body
// (v1.1.2 — extracted from main.js so the regression test can import the
// real logic instead of slicing source text).
//
// Canvas scenes are force-flushed before saving because their onChange saves
// are debounced; the file-kind passed to save_file_as keeps the Save As
// dialog's filter + default extension honest (.tldr / .excalidraw / .txt).
//
// Returns the saved path, or null when cancelled/failed.

/**
 * @param {object} deps { invoke, toast, fmtErr, clearDirty, maybeSnapshot?,
 *                        excalidraw?, tldraw? }
 * @param {object|null} doc the active document
 */
export async function saveActiveDoc(deps, doc) {
  if (!doc) return null;
  // Sync editor content back into the doc before saving.
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  // Flush the Excalidraw scene (the onChange save is debounced — force it now).
  if (doc.excalidraw && deps.excalidraw) {
    const json = deps.excalidraw.getSceneJSON();
    if (json) doc.content = json;
  }
  // Force-flush the TLDraw scene synchronously so Ctrl+S captures any edits
  // inside the debounce window.
  if (doc.tldraw && deps.tldraw) {
    const json = deps.tldraw.flush();
    if (json) doc.content = json;
  }
  const { content } = doc;

  if (!doc.path) {
    try {
      const kind = doc.tldraw ? 'tldraw' : doc.excalidraw ? 'excalidraw' : doc.plain ? 'text' : undefined;
      const path = await deps.invoke('save_file_as', { content, kind });
      doc.path = path;
      deps.clearDirty(doc.id);
      deps.toast('Saved');
      // Snapshot for version history (markdown text only; fire-and-forget —
      // a snapshot miss must never block a save).
      deps.maybeSnapshot?.(doc, content);
      return path;
    } catch (e) {
      if (e !== 'cancelled') deps.toast('Save failed: ' + deps.fmtErr(e));
      return null;
    }
  }
  try {
    await deps.invoke('save_file', { path: doc.path, content });
    deps.clearDirty(doc.id);
    deps.toast('Saved');
    deps.maybeSnapshot?.(doc, content);
    return doc.path;
  } catch (e) {
    deps.toast('Save failed: ' + deps.fmtErr(e));
    return null;
  }
}
