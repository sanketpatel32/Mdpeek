// v0.49.0: Jupyter notebook (.ipynb) parsing. Pure, DOM-free — the view layer
// (src/views/notebook-viewer.js) consumes the result and renders cells via the
// existing renderMarkdown / renderCode primitives.
//
// The .ipynb format is JSON with two major revisions:
//   • nbformat 3 — cells live under `worksheets[0].cells`.
//   • nbformat 4 — cells live under top-level `cells`.
// Each cell has a `cell_type` of 'markdown' | 'code' | 'raw', and a `source`
// field that is EITHER a string OR an array of line-strings (v4 favours the
// array form). We normalize both to a single string. Code cells additionally
// carry an `outputs` array; each output has an `output_type` of:
//   • 'stream'           → text in `text` (str|array) keyed by `name` (stdout/stderr)
//   • 'execute_result'   → data dict keyed by mime, 'text/plain' is the repr
//   • 'display_data'     → same shape as execute_result (no execution count)
//   • 'error'            → `ename` + `evalue` + `traceback` (array)
// Output `data` may include `image/png` / `image/jpeg` as base64 — surfaced so
// the viewer can render them via data URIs.
//
// This module is NON-throwing: malformed JSON or a non-notebook shape returns
// `{ cells: [], error: '…' }` so the viewer can show a friendly banner instead
// of a blank canvas. Unit-tested in test/notebook.test.js.

// Join a source field that may be a string or an array of line-strings.
// Jupyter stores line-strings WITHOUT trailing newlines (the newline is
// implicit between array entries), so we join with '\n'. A bare string is
// returned as-is. Returns '' for missing/odd shapes.
export function joinSource(src) {
  if (typeof src === 'string') return src;
  if (Array.isArray(src)) return src.map((s) => (typeof s === 'string' ? s : '')).join('');
  return '';
}

// Normalize a single output dict into a flat { kind, ...payload } object.
// `kind` ∈ 'stream' | 'result' | 'display' | 'error'. Unknown output_types
// are dropped (return null) — better than rendering junk.
export function normalizeOutput(out) {
  if (!out || typeof out !== 'object') return null;
  const type = out.output_type;
  if (type === 'stream') {
    return { kind: 'stream', name: typeof out.name === 'string' ? out.name : 'stdout', text: joinSource(out.text) };
  }
  if (type === 'execute_result' || type === 'display_data') {
    const data = (out.data && typeof out.data === 'object') ? out.data : {};
    const text = joinSource(data['text/plain']);
    const png = typeof data['image/png'] === 'string' ? data['image/png'].replace(/\n/g, '') : null;
    const jpeg = typeof data['image/jpeg'] === 'string' ? data['image/jpeg'].replace(/\n/g, '') : null;
    return {
      kind: type === 'execute_result' ? 'result' : 'display',
      text,
      png,
      jpeg,
      executionCount: out.execution_count,
    };
  }
  if (type === 'error') {
    const tb = Array.isArray(out.traceback) ? out.traceback.filter((t) => typeof t === 'string') : [];
    return {
      kind: 'error',
      ename: typeof out.ename === 'string' ? out.ename : 'Error',
      evalue: typeof out.evalue === 'string' ? out.evalue : '',
      traceback: tb,
    };
  }
  return null;
}

// Normalize a raw nbformat cell into { type, source, outputs?, language?, execCount? }.
function normalizeCell(cell, kernelLanguage) {
  if (!cell || typeof cell !== 'object') return null;
  const ct = cell.cell_type;
  const source = joinSource(cell.source);
  if (ct === 'markdown') return { type: 'markdown', source };
  if (ct === 'raw') return { type: 'raw', source };
  if (ct === 'code') {
    const outputs = Array.isArray(cell.outputs)
      ? cell.outputs.map(normalizeOutput).filter(Boolean)
      : [];
    return {
      type: 'code',
      source,
      outputs,
      language: kernelLanguage,
      execCount: cell.execution_count,
    };
  }
  return null;
}

// Extract the kernel's primary language from nbformat metadata, e.g.
// metadata.language_info.name = 'python'. Falls back to 'python' (the typical
// notebook) when absent — harmless if wrong: renderCode still highlights, just
// possibly with the wrong grammar.
function kernelLanguageFrom(nb) {
  const li = nb && nb.metadata && nb.metadata.language_info;
  if (li && typeof li.name === 'string') return li.name;
  // nbformat 3 stored the kernel language under metadata.kernelspec.language.
  const ks = nb && nb.metadata && nb.metadata.kernelspec;
  if (ks && typeof ks.language === 'string') return ks.language;
  return 'python';
}

// Map a kernel language name to a highlight.js id where they differ. Most
// languages match their hljs id verbatim; the few exceptions are tabled.
const HLJS_OVERRIDES = { python3: 'python', 'c++': 'cpp', 'c#': 'csharp', 'f#': 'fsharp', js: 'javascript', ts: 'typescript' };
export function hljsLangFor(language) {
  if (typeof language !== 'string' || !language) return 'python';
  const lower = language.toLowerCase();
  return HLJS_OVERRIDES[lower] || lower;
}

// Parse raw notebook JSON text into a normalized shape. Non-throwing.
//
// Returns { cells: [...], language, error? } where:
//   cells   — normalized cell objects (markdown/raw/code), in order
//   language — the kernel's hljs language id (for code-cell highlighting)
//   error   — a human-readable string when the input isn't a valid notebook;
//             cells is [] in that case
export function parseNotebook(json) {
  if (typeof json !== 'string' || !json.trim()) {
    return { cells: [], language: 'python', error: 'This notebook is empty.' };
  }
  let nb;
  try {
    nb = JSON.parse(json);
  } catch (e) {
    return { cells: [], language: 'python', error: 'This file is not valid JSON (corrupt or truncated).' };
  }
  if (!nb || typeof nb !== 'object' || Array.isArray(nb)) {
    return { cells: [], language: 'python', error: 'This file is not a Jupyter notebook.' };
  }
  const language = hljsLangFor(kernelLanguageFrom(nb));
  // nbformat 4 → top-level `cells`. nbformat 3 → `worksheets[0].cells`.
  let rawCells = null;
  if (Array.isArray(nb.cells)) rawCells = nb.cells;
  else if (Array.isArray(nb.worksheets)) {
    const ws0 = nb.worksheets.find((w) => w && Array.isArray(w.cells));
    if (ws0) rawCells = ws0.cells;
  }
  if (!rawCells) {
    return { cells: [], language, error: 'This notebook has no cells (unsupported nbformat or empty).' };
  }
  const cells = rawCells.map((c) => normalizeCell(c, language)).filter(Boolean);
  if (cells.length === 0) {
    return { cells: [], language, error: 'This notebook contains no renderable cells.' };
  }
  return { cells, language };
}
