// Save pipeline for the active document, dependency-injected so it stays
// DOM-free and unit-testable. main.js binds { invoke, toast, fmtErr, … } to
// its live collaborators; behavior mirrors the original saveActive() body
// (v1.1.2 — extracted from main.js so the regression test can import the
// real logic instead of slicing source text).
//
// Returns the saved path, or null when cancelled/failed.

/**
 * @param {object} deps { invoke, toast, fmtErr, clearDirty }
 * @param {object|null} doc the active document
 */
export async function saveActiveDoc(deps, doc) {
  if (!doc) return null;
  // Sync editor content back into the doc before saving.
  if (doc.mode === 'edit' && doc.editor) doc.content = doc.editor.getValue();
  const { content } = doc;

  if (!doc.path) {
    try {
      const kind = doc.plain ? 'text' : undefined;
      const path = await deps.invoke('save_file_as', { content, kind });
      if (!path) return null;
      doc.path = path;
      if ((doc.editor?.getValue() ?? doc.content) === content) deps.clearDirty(doc.id);
      deps.toast('Saved');
      return path;
    } catch (e) {
      if (e !== 'cancelled') deps.toast('Save failed: ' + deps.fmtErr(e));
      return null;
    }
  }
  try {
    await deps.invoke('save_file', { path: doc.path, content });
    if ((doc.editor?.getValue() ?? doc.content) === content) deps.clearDirty(doc.id);
    deps.toast('Saved');
    return doc.path;
  } catch (e) {
    deps.toast('Save failed: ' + deps.fmtErr(e));
    return null;
  }
}
