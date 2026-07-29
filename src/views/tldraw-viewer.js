// v0.47.0: TLDraw canvas viewer — a sibling to excalidraw-viewer.js.
//
// Mounts the TLDraw SDK v5 (`tldraw` package) into a DOM container and exposes
// a controller object with the same shape main.js expects from the Excalidraw
// controller: { setTheme, getSceneJSON, destroy }. Collaboration methods are
// intentionally absent — TLDraw collab is deferred (it uses a different sync
// engine than the app's Yjs/Excalidraw setup), so TLDraw tabs hide the Share
// button and never bind collab.
//
// Why a fresh implementation instead of sharing code with excalidraw-viewer.js?
// The two SDKs have incompatible persistence models:
//   - Excalidraw: an `onChange(elements, appState, files)` prop + a
//     `serializeAsJSON()` helper over a flat element array.
//   - TLDraw v5:  no `onChange` prop at all. You subscribe to the store inside
//     a child component via `useEditor()` + `editor.store.listen(...)`, and
//     serialize via `getSnapshot(editor.store)`.
// The shape is different enough that a shared abstraction would be more code
// than the two concrete viewers.
//
// All heavy deps (React, ReactDOM, the TLDraw SDK, TLDraw's CSS) are
// dynamic-imported on first open and cached, so TLDraw adds zero cost to the
// entry chunk until a TLDraw tab is actually opened — same lazy-load strategy
// as Excalidraw.
import { escapeHtml } from '../lib/escape.js';

// Lazy-load TLDraw's CSS once (cached so repeat opens don't re-fetch).
let _cssLoaded = false;
async function ensureCss() {
  if (_cssLoaded) return;
  _cssLoaded = true;
  await import('tldraw/tldraw.css');
}

// Collapse the app's 10 themes into TLDraw's two-mode system. Same set as the
// Excalidraw viewer so the two canvases agree on light/dark for a given theme.
const DARK_THEMES = new Set(['dark', 'solar-dark', 'dracula', 'nord', 'github-dark', 'tokyo-night', 'catppuccin']);
function tldrawThemeFor(appTheme) {
  return DARK_THEMES.has(appTheme) ? 'dark' : 'light';
}

// Debounce window for auto-save. Mirrors Excalidraw's SAVE_DELAY so the two
// canvases feel the same when typing/drawing.
const SAVE_DELAY = 1000;

// Mount TLDraw into `container` (the #document article element).
//
//   container       — the DOM host (gets the `tldraw-host` class)
//   initialData     — saved .tldr scene JSON string (parsed; blank if empty)
//   onSave(json)    — debounced callback fired with the serialized snapshot
//   initialAppTheme — the app theme name (used to pick light/dark)
//
// Returns a controller: { setTheme, getSceneJSON, destroy }.
export async function showTLDraw(container, initialData, onSave, initialAppTheme) {
  container.innerHTML = '<div class="pdf-loading">Loading TLDraw…</div>';
  container.classList.add('tldraw-host');

  try {
    const [, ReactMod, ReactDOMMod, TLDrawMod] = await Promise.all([
      ensureCss(),
      import('react'),
      import('react-dom/client'),
      import('tldraw'),
    ]);
    const React = ReactMod.default;
    const ReactDOMClient = ReactDOMMod.default;
    const { Tldraw, useEditor, getSnapshot } = TLDrawMod;

    // Parse the saved snapshot. A .tldr file is JSON.stringify(getSnapshot()),
    // i.e. { schema, document: { store, schema, assets }, session? }. If it's
    // missing/blank/corrupt we start from a fresh empty canvas.
    let parsedSnapshot = null;
    if (initialData && typeof initialData === 'string' && initialData.trim()) {
      try { parsedSnapshot = JSON.parse(initialData); } catch { /* blank canvas */ }
    }
    container.innerHTML = '';

    // Latest snapshot string, kept in sync by the store listener so
    // getSceneJSON() can force-flush on save/close even before the debounce
    // fires. Closure-scoped so the controller below can read it.
    let latestJson = initialData && typeof initialData === 'string' ? initialData : '';
    let saveTimer = null;

    // The auto-saver: a child of <Tldraw> so it can read the editor from React
    // context via useEditor(). On mount it subscribes to store changes; every
    // change resets the debounce timer and, when it fires, serializes the
    // snapshot and calls onSave. Returns null (renders nothing).
    function AutoSaver() {
      const editor = useEditor();
      React.useEffect(() => {
        if (!editor) return;
        // `listen` fires on every store mutation (shape add/move/delete, page
        // change, asset upload, etc.). `diff` would let us skip no-ops, but the
        // debounce already collapses bursts — a per-diff filter isn't worth it.
        const cleanup = editor.store.listen(() => {
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            try {
              const snap = getSnapshot(editor.store);
              latestJson = JSON.stringify(snap);
              if (onSave) onSave(latestJson);
            } catch (e) {
              console.error('TLDraw serialize failed:', e);
            }
          }, SAVE_DELAY);
        });
        return cleanup;
      }, [editor]);
      return null;
    }

    // The TLDraw host fills the pane. We need an explicit-size wrapper div
    // (TLDraw requires a sized parent); the .tldraw-host CSS makes `container`
    // full-height and this inner div flexes to fill it.
    let currentTheme = tldrawThemeFor(initialAppTheme);

    function renderTLDraw() {
      root.render(
        React.createElement(
          'div',
          { className: 'tldraw-wrap' },
          React.createElement(
            Tldraw,
            { snapshot: parsedSnapshot || undefined, colorScheme: currentTheme },
            // Child renders inside Tldraw's context so useEditor() works.
            React.createElement(AutoSaver),
          ),
        ),
      );
    }

    const root = ReactDOMClient.createRoot(container);
    try {
      renderTLDraw();
    } catch (renderErr) {
      try { root.unmount(); } catch {}
      throw renderErr;
    }

    return {
      setTheme(appTheme) {
        const next = tldrawThemeFor(appTheme);
        if (next === currentTheme) return;
        currentTheme = next;
        renderTLDraw();
      },
      getSceneJSON() {
        // Prefer the live editor snapshot (accurate even mid-debounce); fall
        // back to the last serialized string if the editor isn't ready yet.
        return latestJson || '';
      },
      destroy() {
        if (saveTimer) clearTimeout(saveTimer);
        try { root.unmount(); } catch {}
        container.classList.remove('tldraw-host');
        container.innerHTML = '';
      },
    };
  } catch (e) {
    console.error('TLDraw failed to load:', e);
    container.classList.remove('tldraw-host');
    container.innerHTML = `<div class="pdf-error">Could not load TLDraw: ${escapeHtml(String(e?.message || e))}</div>`;
    // Stub controller so the caller's teardown path doesn't crash.
    return {
      setTheme() {},
      getSceneJSON() { return ''; },
      destroy() {},
    };
  }
}
