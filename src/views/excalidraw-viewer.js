// Excalidraw viewer module — mounts the full Excalidraw canvas into a container.
//
// Lazy-loaded: React, ReactDOM, and @excalidraw/excalidraw are dynamically
// imported only when an Excalidraw tab is opened, so markdown/PDF users pay
// zero bundle cost. The scene is saved as JSON to doc.content (debounced) so
// drawings persist across tab switches within the session.
//
// Mount uses React imperatively (no JSX, no build pipeline change):
// ReactDOM.createRoot(container).render(React.createElement(Excalidraw, props))

// Debounced save callback — set by the caller (main.js) to write the scene
// back to doc.content + mark dirty.
let _saveTimer = null;
const SAVE_DELAY = 1000;

export async function showExcalidraw(container, initialData, onSave) {
  // Loading state while the heavy modules download.
  container.innerHTML = '<div class="pdf-loading">Loading Excalidraw…</div>';
  container.classList.add('excalidraw-host');

  // Lazy-load all three heavy dependencies.
  const React = (await import('react')).default;
  const ReactDOMClient = (await import('react-dom/client')).default;
  const ExcalidrawMod = await import('@excalidraw/excalidraw');
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

  container.innerHTML = '';

  // Track the latest scene for serialization on save.
  let latestElements = parsedData?.elements || [];
  let latestAppState = parsedData?.appState || {};
  let latestFiles = parsedData?.files || {};

  // The onChange handler captures scene state + triggers a debounced save.
  const handleChange = (elements, appState, files) => {
    latestElements = elements;
    latestAppState = appState;
    latestFiles = files;
    if (onSave) {
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => {
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
  const root = ReactDOMClient.createRoot(container);
  root.render(
    React.createElement(Excalidraw, {
      initialData: parsedData || { elements: [], appState: { viewBackgroundColor: '#ffffff' } },
      onChange: handleChange,
      // Let Excalidraw handle its own UI (top toolbar, zoom, etc).
      UIOptions: {},
    })
  );

  return {
    // Get the current scene as a JSON string (for Ctrl+S save to disk).
    getSceneJSON() {
      try {
        return serializeAsJSON(latestElements, latestAppState, latestFiles || {});
      } catch {
        return '';
      }
    },
    destroy() {
      clearTimeout(_saveTimer);
      try {
        root.unmount();
      } catch {}
      container.classList.remove('excalidraw-host');
      container.innerHTML = '';
    },
  };
}
