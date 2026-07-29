// v0.47.0: TLDraw canvas viewer — a sibling to excalidraw-viewer.js.
//
// Mounts the TLDraw SDK v5 (`tldraw` package) into a DOM container and exposes
// a controller object with the same shape main.js expects from the Excalidraw
// controller: { setTheme, getSceneJSON, destroy }. Collaboration methods are
// intentionally absent — TLDraw collab is deferred (it uses a different sync
// engine than the app's Yjs/Excalidraw setup), so TLDraw tabs hide the Share
// button and never bind collab.
//
// PERSISTENCE — how we save/load `.tldr` files in v5:
//
//   SAVE: subscribe to `editor.store` via `.listen()`; on change (debounced 1s)
//   capture the snapshot with `getSnapshot(editor.store)` and JSON.stringify it.
//   `getSnapshot` is the read side and works fine.
//
//   LOAD: do NOT pass the saved snapshot via the `snapshot` prop, and do NOT use
//   the `loadSnapshot(store, ...)` free function — both validate each record
//   strictly on insertion and reject snapshots whose shape `props` omit
//   defaulted fields (e.g. geo shapes with no `scale`), throwing:
//     "At shape(type = geo).props.scale: Expected number, got undefined"
//   Instead mount a fresh `<Tldraw>` (no store/snapshot) and load the saved
//   snapshot via `editor.loadSnapshot(...)` in `onMount`. The EDITOR-LEVEL
//   method runs the full migration + default-prop pipeline first, so the
//   records are normalized before the store sees them.
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
//   initialData     — saved scene JSON string (getSnapshot output)
//   onSave(json)    — debounced callback fired with the serialized scene
//   initialAppTheme — the app theme name (used to pick light/dark)
//
// Returns a controller: { setTheme, getSceneJSON, flush, destroy }.
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

    container.innerHTML = '';

    // Parse the saved snapshot once (getSnapshot-shaped JSON). Kept as a plain
    // object; loaded into the editor after mount via the editor method (which
    // runs migrations). null/blank/unparseable → start from an empty canvas.
    let parsedSnapshot = null;
    if (initialData && typeof initialData === 'string' && initialData.trim()) {
      try { parsedSnapshot = JSON.parse(initialData); } catch { /* blank */ }
    }

    // Latest serialized scene JSON, kept in sync by the store listener so
    // getSceneJSON()/flush() return current content even mid-debounce. Seeded
    // with the loaded content so a flush before the first edit returns it.
    let latestJson = (initialData && typeof initialData === 'string') ? initialData : '';
    let saveTimer = null;
    let editorRef = null;
    let snapshotLoaded = false;

    // Serialize the editor's current state to a JSON string. Shared by the
    // debounced auto-save and the synchronous flush(). Uses getSnapshot (the
    // read side of the format the editor.loadSnapshot method consumes).
    function serialize(editor) {
      try {
        const snap = getSnapshot(editor.store);
        latestJson = JSON.stringify(snap);
        return latestJson;
      } catch (e) {
        console.error('TLDraw serialize failed:', e);
        return latestJson || '';
      }
    }

    // Called once TLDraw has mounted and handed us the Editor instance. We load
    // the saved snapshot here via the editor-level method (runs migrations +
    // applies shape-prop defaults — the snapshot prop and store-level load both
    // validate records strictly and would throw on missing defaulted props).
    // `snapshotLoaded` guards against re-loading on theme re-renders.
    function handleMount(editor) {
      editorRef = editor;
      if (!snapshotLoaded) {
        snapshotLoaded = true;
        if (parsedSnapshot) {
          try {
            editor.loadSnapshot(parsedSnapshot);
          } catch (e) {
            console.error('TLDraw loadSnapshot failed:', e);
          }
        }
      }
    }

    let currentTheme = tldrawThemeFor(initialAppTheme);

    function renderTLDraw() {
      root.render(
        React.createElement(
          'div',
          { className: 'tldraw-wrap' },
          React.createElement(
            Tldraw,
            // No `store`/`snapshot` prop — mount fresh, load via onMount.
            { colorScheme: currentTheme, onMount: handleMount },
            React.createElement(AutoSaver),
          ),
        ),
      );
    }

    // The auto-saver: a child of <Tldraw> so it can read the editor from React
    // context via useEditor(). On mount it subscribes to store changes; every
    // change resets the debounce timer and, when it fires, serializes and calls
    // onSave. Returns null (renders nothing).
    function AutoSaver() {
      const editor = useEditor();
      React.useEffect(() => {
        if (!editor) return;
        const cleanup = editor.store.listen(() => {
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            const json = serialize(editor);
            if (onSave) onSave(json);
          }, SAVE_DELAY);
        });
        return cleanup;
      }, [editor]);
      return null;
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
        // Synchronous read of the last serialized scene. The debounced listener
        // keeps this current; main.js calls flush() on save/close to guarantee
        // no edits are lost to the debounce window.
        return latestJson || '';
      },
      flush() {
        // Force-serialize now so save/close captures edits inside the debounce
        // window. Returns the latest JSON string.
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        return editorRef ? serialize(editorRef) : (latestJson || '');
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
      flush() { return ''; },
      destroy() {},
    };
  }
}
