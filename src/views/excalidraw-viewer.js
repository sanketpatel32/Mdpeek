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
const DARK_THEMES = new Set(['dark', 'solar-dark', 'dracula', 'nord', 'github-dark', 'tokyo-night', 'catppuccin']);
function excalidrawThemeFor(appTheme) {
  return DARK_THEMES.has(appTheme) ? 'dark' : 'light';
}

// Debounce delay for save-on-change.
const SAVE_DELAY = 1000;

export async function showExcalidraw(container, initialData, onSave, initialAppTheme) {
  // Loading state + ensure the container has height while modules download.
  container.innerHTML = '<div class="pdf-loading">Loading Excalidraw…</div>';
  container.classList.add('excalidraw-host');

  try {
    // Load CSS + all three heavy dependencies in parallel.
    const [_, ReactMod, ReactDOMMod, ExcalidrawMod] = await Promise.all([
      ensureCss(),
      import('react'),
      import('react-dom/client'),
      import('@excalidraw/excalidraw'),
    ]);
    const React = ReactMod.default;
    const ReactDOMClient = ReactDOMMod.default;
    const Excalidraw = ExcalidrawMod.Excalidraw;
    const serializeAsJSON = ExcalidrawMod.serializeAsJSON;

    // Parse the initial scene (if any).
    let parsedData = null;
    if (initialData && typeof initialData === 'string' && initialData.trim()) {
      try {
        parsedData = JSON.parse(initialData);
      } catch {
        // Corrupt JSON — start with a blank canvas.
      }
    }

    // Clear the loading indicator.
    container.innerHTML = '';

    // Track the latest scene for serialization on save.
    let latestElements = parsedData?.elements || [];
    let latestAppState = parsedData?.appState || {};
    let latestFiles = parsedData?.files || {};
    // Instance-scoped debounce timer (was module-level — shared across
    // instances, which let one tab's destroy() clear another's pending save).
    let saveTimer = null;

    // The onChange handler captures scene state + triggers a debounced save.
    const handleChange = (elements, appState, files) => {
      latestElements = elements;
      latestAppState = appState;
      latestFiles = files;
      if (onSave) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          try {
            const json = serializeAsJSON(elements, appState, files || {});
            onSave(json);
          } catch (e) {
            console.error('Excalidraw serialize failed:', e);
          }
        }, SAVE_DELAY);
      }
    };

    // Mount Excalidraw using React's imperative API (no JSX needed).
    // The container must have height — Excalidraw fills 100% of its parent.
    // If the initial render throws, we must unmount to avoid orphaning the root.
    const root = ReactDOMClient.createRoot(container);
    let currentTheme = excalidrawThemeFor(initialAppTheme);
    let mounted = false;

    function renderExcalidraw() {
      root.render(
        React.createElement(Excalidraw, {
          initialData: parsedData || { elements: [], appState: { viewBackgroundColor: '#ffffff' } },
          onChange: handleChange,
          theme: currentTheme,
        })
      );
      mounted = true;
    }
    try {
      renderExcalidraw();
    } catch (renderErr) {
      // Initial render failed — unmount to avoid a leaked root, then rethrow.
      try { root.unmount(); } catch {}
      throw renderErr;
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
          return serializeAsJSON(latestElements, latestAppState, latestFiles || {});
        } catch {
          return '';
        }
      },
      destroy() {
        clearTimeout(saveTimer);
        try {
          root.unmount();
        } catch {}
        container.classList.remove('excalidraw-host');
        container.innerHTML = '';
      },
    };
  } catch (e) {
    // If any module fails to load (offline, corrupt install, etc.), show a
    // clear error instead of leaving the user staring at a blank "Loading…" text.
    container.innerHTML = `<div class="pdf-error">Could not load Excalidraw: ${escapeHtml(String(e))}</div>`;
    console.error('Excalidraw load failed:', e);
    return { getSceneJSON: () => '', destroy: () => {} };
  }
}
