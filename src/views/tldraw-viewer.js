// v0.47.0: TLDraw canvas viewer — a sibling to excalidraw-viewer.js.
//
// Mounts the TLDraw SDK v5 (`tldraw` package) into a DOM container and exposes
// a controller object with the same shape main.js expects from the Excalidraw
// controller: { setTheme, getSceneJSON, flush, destroy }. Collaboration methods
// are intentionally absent — TLDraw collab is deferred (it uses a different sync
// engine than the app's Yjs/Excalidraw setup), so TLDraw tabs hide the Share
// button and never bind collab.
//
// THEME (v0.68.0): DO NOT pass the `colorScheme` prop to <Tldraw>. In tldraw
// 5.x that prop lands in TldrawEditor's editor-construction dependency array,
// so a theme change DISPOSES AND RECREATES the whole Editor — onMount re-fires,
// the open-time snapshot is re-loaded over the user's edits, and the autosaver
// then persists that reversion. Instead we set the theme imperatively at mount
// and on setTheme() via `editor.user.updateUserPreferences({ colorScheme })`
// (the same API tldraw's own color-scheme menu uses) — no editor recreation.
//
// PERSISTENCE — how we save/load `.tldr` files in v5:
//
//   SAVE: subscribe to `editor.store` via `.listen()`; on change (debounced 1s)
//   capture the snapshot with `getSnapshot(editor.store)` and JSON.stringify it.
//   `getSnapshot` is the read side and works fine. The initial load is
//   suppressed (`suppressSave`) — loadStoreSnapshot is a user-source put, so
//   without the flag every freshly opened .tldr would flip to "dirty" ~1s
//   later with zero edits.
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
//   TLDraw version whose schema can't migrate), we flip TLDrawRoot into an
//   error state — React unmounts the <Tldraw> tree cleanly and shows a banner
//   (v0.68.0: the banner used to be injected by swapping container.innerHTML
//   under the still-mounted root, leaving a zombie React tree). While
//   loadFailed, flush()/getSceneJSON() return the ORIGINAL file content
//   verbatim — never the empty re-serialized store — so a Ctrl+S can't
//   silently overwrite the user's real drawing with blank.
//
// v0.68.0 also adds: destroy() flushes the pending debounced save through
// onSave before unmounting (edits inside the 1s window survive tab switch /
// close / quit), an `isStale` callback (5th arg) so a late lazy-load can't
// wipe another tab's DOM, exportImage('png'|'svg') via the editor's public
// toImage(), and getElementCount() for the status bar.
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

// v0.68.0: per-container ownership tokens (same rationale as
// excalidraw-viewer.js): a stale call whose lazy-load just resolved must not
// strip the host class / clear the DOM of a newer call that already claimed
// the container — that left a mounted-but-collapsed canvas after the
// boot-time double render.
const _containerOwners = new WeakMap();

// Mount TLDraw into `container` (the #document article element).
//
//   container       — the DOM host (gets the `tldraw-host` class)
//   initialData     — saved scene JSON string (getSnapshot output)
//   onSave(json)    — debounced callback fired with the serialized scene
//   initialAppTheme — the app theme name (used to pick light/dark)
//   isStale         — () => boolean; if it returns true after the modules have
//                     loaded, bail without touching the DOM (another tab's
//                     render owns the container now)
//
// Returns a controller: { setTheme, getSceneJSON, flush, destroy }.
export async function showTLDraw(container, initialData, onSave, initialAppTheme, isStale) {
  const token = {};
  _containerOwners.set(container, token);
  const isOwner = () => _containerOwners.get(container) === token;
  container.innerHTML = '<div class="pdf-loading">Loading TLDraw…</div>';
  container.classList.add('tldraw-host');

  // No-op controller for cancelled mounts / failed loads.
  const stub = {
    setTheme() {},
    getSceneJSON() { return ''; },
    flush() { return ''; },
    getElementCount() { return 0; },
    exportImage: null,
    destroy() { if (isOwner()) container.classList.remove('tldraw-host'); },
  };

  try {
    const [, ReactMod, ReactDOMMod, TLDrawMod] = await Promise.all([
      ensureCss(),
      import('react'),
      import('react-dom/client'),
      import('tldraw'),
    ]);
    if (isStale && isStale()) {
      if (isOwner()) {
        container.classList.remove('tldraw-host');
        container.innerHTML = '';
      }
      return stub;
    }
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
    let suppressSave = false;            // true while the initial snapshot load runs → no spurious dirty
    let snapshotLoaded = false;          // belt-and-braces: loadSnapshot must never run twice per controller
    let sceneChanged = false;            // true once the user actually edited — gates destroy()'s flush

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
         if (suppressSave || loadFailed) return;
         sceneChanged = true;
         if (saveTimer) clearTimeout(saveTimer);
         saveTimer = setTimeout(() => {
           saveTimer = null;
           const json = serialize(editor);
           if (onSave) onSave(json);
         }, SAVE_DELAY);
        }, { source: 'user', scope: 'document' });
       return cleanup;
      }, [editor]);
      return null;
    }

    // TLDrawRoot: stateless wrapper around <Tldraw> (theme is applied
    // imperatively — see the header comment). Runs the one-time snapshot load
    // + failure handling in onMount; on failure it swaps the whole tree for an
    // error banner via React state.
    function TLDrawRoot() {
      const [failed, setFailed] = React.useState(false);

      const handleMount = React.useCallback((editor) => {
        editorRef = editor;
        // Theme via user preferences — NOT the colorScheme prop (see header).
        try {
          editor.user.updateUserPreferences({ colorScheme: tldrawThemeFor(initialAppTheme) });
        } catch (e) {
          console.error('TLDraw theme init failed:', e);
        }
        if (!parsedSnapshot || snapshotLoaded) return;
        snapshotLoaded = true;
        suppressSave = true;
        try {
          editor.loadSnapshot(parsedSnapshot);
        } catch (e) {
          // Schema mismatch (e.g. a .tldr from a newer TLDraw version) or
          // corrupt snapshot. Flip to the error state (unmounts <Tldraw>) and
          // mark loadFailed so flush preserves the original file instead of
          // writing a blank canvas.
          console.error('TLDraw loadSnapshot failed:', e);
          loadFailed = true;
          setFailed(true);
        } finally {
          suppressSave = false;
        }
      }, []);

      if (failed) {
        return React.createElement(
          'div',
          { className: 'pdf-error' },
          'This .tldr file couldn\u2019t be loaded — it may be from a newer TLDraw version or be corrupt. The file on disk is unchanged.',
          React.createElement('br'),
          React.createElement('br'),
          'Do not edit and save this tab; that would replace the original.',
        );
      }
      return React.createElement(
        'div',
        { className: 'tldraw-wrap' },
        React.createElement(
          Tldraw,
          // No `store`/`snapshot`/`colorScheme` prop — mount fresh, load via
          // onMount, theme via user preferences.
          { onMount: handleMount },
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
        // Imperative user-preference update — the editor instance survives.
        try {
          editorRef?.user.updateUserPreferences({ colorScheme: tldrawThemeFor(appTheme) });
        } catch (e) {
          console.error('TLDraw setTheme failed:', e);
        }
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
      // Shape count for the status bar (canvas tabs have no words/chars).
      getElementCount() {
        try {
          return editorRef ? editorRef.getCurrentPageShapes().length : 0;
        } catch {
          return 0;
        }
      },
      // Render the current scene to image bytes via the editor's public
      // toImage(). kind: 'png' (2x) | 'svg'. Returns { bytes, mime } or null.
      async exportImage(kind) {
        if (!editorRef || loadFailed) return null;
        try {
          const shapeIds = editorRef.getCurrentPageShapeIds();
          const res = await editorRef.toImage(shapeIds, {
            format: kind === 'svg' ? 'svg' : 'png',
            pixelRatio: kind === 'svg' ? undefined : 2,
            scale: 1,
          });
          if (!res?.blob) return null;
          return {
            bytes: new Uint8Array(await res.blob.arrayBuffer()),
            mime: res.blob.type || (kind === 'svg' ? 'image/svg+xml' : 'image/png'),
          };
        } catch (e) {
          console.error('TLDraw export failed:', e);
          return null;
        }
      },
      destroy() {
        // Flush a pending debounced save BEFORE unmounting — the caller is
        // switching away from or closing this doc, and edits made inside the
        // 1s window would otherwise be lost.
        if (saveTimer && sceneChanged && !loadFailed && onSave) {
          clearTimeout(saveTimer);
          saveTimer = null;
          try {
            const json = serialize(editorRef);
            if (json) onSave(json);
          } catch (e) {
            console.error('TLDraw destroy-flush failed:', e);
          }
        } else if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        try { root.unmount(); } catch {}
        // Only mutate the shared container if no newer show* call claimed it.
        if (isOwner()) {
          container.classList.remove('tldraw-host');
          container.innerHTML = '';
        }
      },
    };
  } catch (e) {
    console.error('TLDraw failed to load:', e);
    if (isOwner()) {
      container.classList.remove('tldraw-host');
      container.innerHTML = `<div class="pdf-error">Could not load TLDraw: ${escapeHtml(String(e?.message || e))}</div>`;
    }
    return stub;
  }
}
