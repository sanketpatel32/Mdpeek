// v0.47.0: TLDraw canvas viewer — a sibling to excalidraw-viewer.js.
//
// Mounts the TLDraw SDK v5 (`tldraw` package) into a DOM container and exposes
// a controller object with the same shape main.js expects from the Excalidraw
// controller: { setTheme, getSceneJSON, flush, destroy }. Collaboration methods
// are intentionally absent — TLDraw collab is deferred (it uses a different sync
// engine than the app's Yjs/Excalidraw setup), so TLDraw tabs hide the Share
// button and never bind collab.
//
// THEME (v0.48.0): colorScheme is held in React useState inside TLDrawRoot, so a
// theme change re-renders the <Tldraw> element IN PLACE (prop update) rather than
// unmounting + remounting the whole React tree. The previous design re-called
// root.render() on every theme toggle, which flickered and re-ran onMount.
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
//   LOAD FAILURE (v0.48.0): if loadSnapshot throws (e.g. a `.tldr` from a newer
//   TLDraw version whose schema can't migrate), we surface a visible error
//   banner AND set `loadFailed`. While loadFailed, flush()/getSceneJSON() return
//   the ORIGINAL file content verbatim — never the empty re-serialized store —
//   so a Ctrl+S can't silently overwrite the user's real drawing with blank.
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
const DARK_THEMES = new Set(['dark', 'solar-dark', 'dracula', 'nord', 'github-dark', 'tokyo-night', 'catppuccin', 'oled']);
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

    // Parse the saved snapshot once. null/blank/unparseable → blank canvas.
    let parsedSnapshot = null;
    if (initialData && typeof initialData === 'string' && initialData.trim()) {
      try { parsedSnapshot = JSON.parse(initialData); } catch { /* blank */ }
    }

    // Shared mutable state between the React tree and the imperative controller.
    // These are closed-over by both the component definitions below and the
    // returned controller, so setTheme/flush can reach into the live editor.
    let latestJson = '';                 // last serialized scene (never seeded with raw initialData — see F2)
    let saveTimer = null;
    let editorRef = null;
    let loadFailed = false;              // true if loadSnapshot threw → flush preserves the original file
    let setSchemeRef = null;             // captured setState from TLDrawRoot (set by the component on mount)

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
        }, { source: 'user', scope: 'document' });
       return cleanup;
      }, [editor]);
      return null;
    }

    // TLDrawRoot: holds colorScheme in useState so theme changes update the
    // <Tldraw> prop IN PLACE (no remount). Captures the setState into
    // setSchemeRef so the controller's setTheme can call it. Also runs the
    // one-time snapshot load + failure handling in onMount.
    function TLDrawRoot() {
      const [scheme, setScheme] = React.useState(tldrawThemeFor(initialAppTheme));
      React.useEffect(() => { setSchemeRef = setScheme; }, [setScheme]);

      const handleMount = React.useCallback((editor) => {
        editorRef = editor;
        if (parsedSnapshot) {
          try {
            editor.loadSnapshot(parsedSnapshot);
          } catch (e) {
            // Schema mismatch (e.g. a .tldr from a newer TLDraw version) or
            // corrupt snapshot. Surface a banner and mark loadFailed so flush
            // preserves the original file instead of writing a blank canvas.
            console.error('TLDraw loadSnapshot failed:', e);
            loadFailed = true;
            showLoadError(container, initialData);
          }
        }
      }, []);

      return React.createElement(
        'div',
        { className: 'tldraw-wrap' },
        React.createElement(
          Tldraw,
          // No `store`/`snapshot` prop — mount fresh, load via onMount.
          { colorScheme: scheme, onMount: handleMount },
          React.createElement(AutoSaver),
        ),
      );
    }

    const root = ReactDOMClient.createRoot(container);
    try {
      root.render(React.createElement(TLDrawRoot));
    } catch (renderErr) {
      try { root.unmount(); } catch {}
      throw renderErr;
    }

    return {
      setTheme(appTheme) {
        // In-place re-render via the captured setState — no unmount/remount.
        if (setSchemeRef) setSchemeRef(tldrawThemeFor(appTheme));
      },
      getSceneJSON() {
        // If load failed, return the original file content verbatim so a flush
        // never overwrites it with the empty store's serialization.
        if (loadFailed) return (initialData && typeof initialData === 'string') ? initialData : '';
        return latestJson || '';
      },
      flush() {
        // Force-serialize now so save/close captures edits inside the debounce
        // window. On loadFailed, preserve the original file (see getSceneJSON).
        if (loadFailed) return (initialData && typeof initialData === 'string') ? initialData : '';
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

// Replace the canvas with an error banner explaining the file couldn't be
// loaded. The original file on disk is untouched (flush preserves it).
function showLoadError(container, initialData) {
  // Only show if there was real saved content (a brand-new blank tab has
  // nothing to "fail to load" meaningfully).
  if (!initialData || !initialData.trim()) return;
  try {
    container.innerHTML =
      `<div class="pdf-error">This .tldr file couldn't be loaded — it may be` +
      ` from a newer TLDraw version or be corrupt. The file on disk is unchanged.` +
      `<br><br>Do not edit and save this tab; that would replace the original.</div>`;
  } catch { /* container may be gone during teardown */ }
}
