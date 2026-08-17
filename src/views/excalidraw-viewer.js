// Excalidraw viewer module — mounts the full Excalidraw canvas into a container.
//
// Lazy-loaded: React, ReactDOM, @excalidraw/excalidraw, and the CSS are all
// dynamically imported only when an Excalidraw tab is opened. The scene is
// saved as JSON to doc.content (debounced) so drawings persist across tab
// switches within the session.
//
// CRITICAL: Excalidraw requires:
//   1. Its CSS (index.css) — without it the UI is completely broken.
//   2. A parent container with an explicit height — Excalidraw fills its parent
//      and collapses to 0px if the parent has no height.
//
// v0.68.0 changes:
//   - serializeAsJSON is called with the 'local' flavor. The default
//     ('database') branch strips embedded image files AND clears zoom/scroll
//     appState — every save silently destroyed pasted images. 'local' keeps
//     both, so scenes round-trip losslessly.
//   - destroy() FLUSHES a pending debounced save through onSave before
//     unmounting, so switching tabs / closing within the 1s window can no
//     longer drop the last strokes.
//   - An `isStale` callback (5th arg) lets renderActive cancel the mount after
//     the slow lazy-load resolves — a late mount used to wipe the DOM of
//     whichever tab had become active in the meantime.
//   - Corrupt saved JSON shows a dismissible warning banner instead of
//     silently starting a blank canvas (whose first save would overwrite the
//     original file).
//   - exportImage('png' | 'svg') renders the scene to image bytes via the
//     package's exportToBlob / exportToSvg, and getElementCount() feeds the
//     app's status bar.

import { escapeHtml } from '../lib/escape.js';

// Lazy-load the Excalidraw CSS once (cached so repeat opens don't re-fetch).
let _cssLoaded = false;
async function ensureCss() {
  if (_cssLoaded) return;
  _cssLoaded = true;
  await import('@excalidraw/excalidraw/index.css');
}

// Classify an mdpeek app theme into Excalidraw's two-theme system.
// Excalidraw only supports 'light' | 'dark', so we map each of our 10 themes.
const DARK_THEMES = new Set(['dark', 'solar-dark', 'dracula', 'nord', 'github-dark', 'tokyo-night', 'catppuccin', 'oled']);
function excalidrawThemeFor(appTheme) {
  return DARK_THEMES.has(appTheme) ? 'dark' : 'light';
}

// Debounce delay for save-on-change.
const SAVE_DELAY = 1000;

// v0.68.0: per-container ownership tokens. renderActive can re-enter for the
// same doc while a previous call's lazy-load is still in flight (e.g. the
// boot-time restore fires it twice). The second call claims the container
// synchronously; when the FIRST call's imports resolve it is stale and must
// NOT strip the host class or clear the DOM the second call now owns — that
// used to leave a mounted-but-invisible canvas (0px tall) after reload.
const _containerOwners = new WeakMap();

export async function showExcalidraw(container, initialData, onSave, initialAppTheme, isStale) {
  const token = {};
  _containerOwners.set(container, token);
  const isOwner = () => _containerOwners.get(container) === token;
  // Loading state + ensure the container has height while modules download.
  container.innerHTML = '<div class="pdf-loading">Loading Excalidraw…</div>';
  container.classList.add('excalidraw-host');

  // No-op controller returned when the mount is cancelled (stale render) or
  // the modules fail to load. Has every method main.js can call, so callers
  // never need null-checks.
  const stub = {
    setTheme: () => {},
    getSceneJSON: () => '',
    updateScene: () => {},
    getSceneElements: () => [],
    getElementCount: () => 0,
    exportImage: null,
    setCollabHook: () => {},
    clearCollabHook: () => {},
    destroy: () => { if (isOwner()) container.classList.remove('excalidraw-host'); },
  };

  try {
    // Load CSS + all three heavy dependencies in parallel.
    const [, ReactMod, ReactDOMMod, ExcalidrawMod] = await Promise.all([
      ensureCss(),
      import('react'),
      import('react-dom/client'),
      import('@excalidraw/excalidraw'),
    ]);
    // Stale-render guard: the user switched tabs while the modules were
    // downloading. Bail WITHOUT touching container again — the new tab's
    // render owns the DOM now (and if no newer call claimed it, we're still
    // the owner and clean up our loading state).
    if (isStale && isStale()) {
      if (isOwner()) {
        container.classList.remove('excalidraw-host');
        container.innerHTML = '';
      }
      return stub;
    }
    const React = ReactMod.default;
    const ReactDOMClient = ReactDOMMod.default;
    const Excalidraw = ExcalidrawMod.Excalidraw;
    const serializeAsJSON = ExcalidrawMod.serializeAsJSON;
    const exportToBlob = ExcalidrawMod.exportToBlob;
    const exportToSvg = ExcalidrawMod.exportToSvg;

    // Parse the initial scene (if any).
    let parsedData = null;
    let parseFailed = false;
    if (initialData && typeof initialData === 'string' && initialData.trim()) {
      try {
        parsedData = JSON.parse(initialData);
      } catch {
        // Corrupt JSON — start with a blank canvas, but tell the user: their
        // next save replaces whatever is on disk, and they should know that.
        parseFailed = true;
      }
    }

    // React mounts into an inner wrapper so a warning banner can live beside
    // the canvas without React's first commit wiping it.
    container.innerHTML = '';
    const mountDiv = document.createElement('div');
    mountDiv.className = 'excalidraw-root';
    container.appendChild(mountDiv);

    // Track the latest scene for serialization on save.
    let latestElements = parsedData?.elements || [];
    let latestAppState = parsedData?.appState || {};
    let latestFiles = parsedData?.files || {};
    // Instance-scoped debounce timer (was module-level — shared across
    // instances, which let one tab's destroy() clear another's pending save).
    let saveTimer = null;
    // True once the user has actually changed the scene — destroy() only
    // flushes through onSave when there's something newer to write, so a
    // clean open→switch doesn't spuriously mark the doc dirty.
    let sceneChanged = false;
    // Excalidraw's imperative API — captured via the `excalidrawAPI` prop
    // callback on first mount. Used for collab (updateScene from remote
    // Yjs updates) and for getSceneElements (cheap live read).
    let excalidrawAPI = null;
    // Collab outbound hook — set by collab.bindExcalidraw. When non-null,
    // every local onChange fires it immediately (NOT debounced) so remote
    // peers see strokes with low latency. Yjs handles update coalescing.
    let collabHook = null;

    // The onChange handler captures scene state + triggers a debounced save.
    // It ALSO fires the collab hook (if attached) so Yjs gets every scene
    // mutation in real time.
    const handleChange = (elements, appState, files) => {
      latestElements = elements;
      latestAppState = appState;
      latestFiles = files;
      sceneChanged = true;
      // Collab: push immediately. Yjs + the network layer do their own
      // batching; adding our 1s save debounce here would make remote
      // strokes lag by a full second.
      if (collabHook) {
        try { collabHook(elements); } catch (e) { console.error('collab hook failed:', e); }
      }
      if (onSave) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveTimer = null;
          try {
            // 'local' keeps embedded image files + zoom/scroll appState.
            const json = serializeAsJSON(elements, appState, files || {}, 'local');
            onSave(json);
          } catch (e) {
            console.error('Excalidraw serialize failed:', e);
          }
        }, SAVE_DELAY);
      }
    };

    // Mount Excalidraw using React's imperative API (no JSX needed).
    // The mount div has height (flex child of the host) — Excalidraw fills
    // 100% of its parent. If the initial render throws, unmount to avoid
    // orphaning the root.
    const root = ReactDOMClient.createRoot(mountDiv);
    let currentTheme = excalidrawThemeFor(initialAppTheme);

    function renderExcalidraw() {
      root.render(
        React.createElement(Excalidraw, {
          initialData: parsedData || { elements: [], appState: { viewBackgroundColor: '#ffffff' } },
          onChange: handleChange,
          theme: currentTheme,
          // Capture the imperative API so collab can drive the canvas via
          // updateScene() when remote Yjs updates arrive.
          excalidrawAPI: (api) => { excalidrawAPI = api; },
        })
      );
    }
    try {
      renderExcalidraw();
    } catch (renderErr) {
      // Initial render failed — unmount to avoid a leaked root, then rethrow.
      try { root.unmount(); } catch {}
      throw renderErr;
    }

    // Corrupt-file banner (sibling of the React mount div).
    if (parseFailed) {
      const warn = document.createElement('div');
      warn.className = 'canvas-warn';
      warn.innerHTML =
        '<span>Couldn\u2019t read this file\u2019s saved drawing — it may be corrupt or ' +
        'from a newer version. Starting blank; saving will replace the original file.</span>';
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'canvas-warn-dismiss';
      dismiss.setAttribute('aria-label', 'Dismiss warning');
      dismiss.textContent = '\u00d7';
      dismiss.addEventListener('click', () => warn.remove());
      warn.appendChild(dismiss);
      container.appendChild(warn);
    }

    return {
      setTheme(appTheme) {
        const next = excalidrawThemeFor(appTheme);
        if (next === currentTheme) return;
        currentTheme = next;
        renderExcalidraw();
      },
      getSceneJSON() {
        try {
          return serializeAsJSON(latestElements, latestAppState, latestFiles || {}, 'local');
        } catch {
          return '';
        }
      },
      // Push externally-driven elements into the canvas. Used by collab to
      // apply remote Yjs updates. No-op if the imperative API isn't ready yet.
      updateScene(elements) {
        if (!excalidrawAPI || !Array.isArray(elements)) return;
        try { excalidrawAPI.updateScene({ elements }); } catch (e) {
          console.error('Excalidraw updateScene failed:', e);
        }
      },
      // Read the live element array straight from Excalidraw. Used by collab
      // for the outbound diff base (more current than the latestElements
      // snapshot captured in onChange).
      getSceneElements() {
        if (!excalidrawAPI) return [];
        try { return excalidrawAPI.getSceneElements() || []; } catch { return []; }
      },
      // Element count for the status bar (canvas tabs have no words/chars).
      getElementCount() {
        return (latestElements || []).length;
      },
      // Render the current scene to image bytes. kind: 'png' (2x) | 'svg'.
      // Returns { bytes: Uint8Array, mime } or null on failure.
      async exportImage(kind) {
        try {
          const opts = {
            exportPadding: 16,
            exportWithDarkMode: currentTheme === 'dark',
          };
          if (kind === 'svg') {
            const svg = await exportToSvg(latestElements, latestAppState, latestFiles || {}, opts);
            const str = new XMLSerializer().serializeToString(svg);
            return { bytes: new TextEncoder().encode(str), mime: 'image/svg+xml' };
          }
          const blob = await exportToBlob(latestElements, latestAppState, latestFiles || {}, {
            ...opts,
            mimeType: 'image/png',
          });
          return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' };
        } catch (e) {
          console.error('Excalidraw export failed:', e);
          return null;
        }
      },
      // Collab outbound hook registration. Bind on attach, clear on detach.
      // The hook receives the elements array on every local onChange.
      setCollabHook(fn) { collabHook = typeof fn === 'function' ? fn : null; },
      clearCollabHook() { collabHook = null; },
      destroy() {
        // Flush a pending debounced save BEFORE unmounting — the caller is
        // either switching tabs or closing this doc, and this is the last
        // chance to capture edits made inside the debounce window.
        if (saveTimer && sceneChanged && onSave) {
          clearTimeout(saveTimer);
          saveTimer = null;
          try {
            const json = serializeAsJSON(latestElements, latestAppState, latestFiles || {}, 'local');
            if (json) onSave(json);
          } catch (e) {
            console.error('Excalidraw destroy-flush failed:', e);
          }
        } else if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        collabHook = null;
        try {
          root.unmount();
        } catch {}
        // Only mutate the shared container if no newer show* call claimed it
        // while we were live (see _containerOwners above).
        if (isOwner()) {
          container.classList.remove('excalidraw-host');
          container.innerHTML = '';
        }
      },
    };
  } catch (e) {
    // If any module fails to load (offline, corrupt install, etc.), show a
    // clear error instead of leaving the user staring at a blank "Loading…" text.
    if (isOwner()) {
      container.classList.remove('excalidraw-host');
      container.innerHTML = `<div class="pdf-error">Could not load Excalidraw: ${escapeHtml(String(e))}</div>`;
    }
    console.error('Excalidraw load failed:', e);
    return stub;
  }
}
