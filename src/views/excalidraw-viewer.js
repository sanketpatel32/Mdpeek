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

// ---------- UI polish (v0.69, injected once) ----------
// Presentation-only styles for the embedded canvas editors: a rounded canvas
// well with a subtle inset ring, a loading shimmer, a floating action cluster
// (mode chip + quick exports + collapse) with hover lift and delayed
// tooltips, a transient "Saved" pill, and a friendly corrupt-file panel.
// Id-guarded like csv-viewer's polish so repeated mounts never stack
// duplicate <style> elements. TLDraw injects the identical sheet under the
// same id — whichever viewer loads first pays for it, both use it.
const POLISH_CSS = `
#document.excalidraw-host,
#document.tldraw-host {
  padding: var(--sp-2);
  gap: var(--sp-2);
}
/* Rounded canvas well: inset ring + soft shadow frame the editor surface. */
#document.excalidraw-host > .cvw-well,
#document.tldraw-host > .cvw-well {
  position: relative;
  flex: 1;
  min-height: 0;
  height: auto;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--surface);
  box-shadow:
    inset 0 0 0 1px var(--border-subtle),
    var(--shadow-sm);
}
/* The canvas mounts absolutely inside the well so it always resolves a
   concrete size (both libs collapse to 0px without an explicit height). */
.cvw-well > .excalidraw-root,
.cvw-well > .cvw-mount {
  position: absolute;
  inset: 0;
}

/* Loading state: shimmer sweep across the empty well + a quiet label pill. */
.cvw-well--loading { display: flex; align-items: center; justify-content: center; }
.cvw-well--loading::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: linear-gradient(100deg, transparent 25%, color-mix(in srgb, var(--fg) 7%, transparent) 50%, transparent 75%);
  background-size: 200% 100%;
  animation: cvw-shimmer 1400ms linear infinite;
}
@keyframes cvw-shimmer {
  from { background-position-x: -50%; }
  to   { background-position-x: 150%; }
}
.cvw-loading-label {
  position: relative;
  z-index: 1;
  padding: var(--sp-1) var(--sp-4);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-elevated) 85%, transparent);
  box-shadow: var(--shadow-sm);
  font-size: 12px;
  letter-spacing: 0.02em;
  color: var(--fg-muted);
}

/* Floating overlay chrome — top-right corner of the well. */
.cvw-chrome {
  position: absolute;
  top: var(--sp-2);
  right: var(--sp-2);
  z-index: 800;
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-1);
  border-radius: var(--radius);
  border: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: var(--shadow-md);
}
.cvw-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 24px;
  min-width: 24px;
  padding: 0 var(--sp-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-secondary);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition:
    transform var(--dur-1) var(--ease-spring),
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out);
}
.cvw-btn:hover {
  background: var(--accent-soft);
  color: var(--accent);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.cvw-btn:active { transform: translateY(0); }
.cvw-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.cvw-btn svg { width: 13px; height: 13px; flex: none; }
.cvw-btn--icon { width: 24px; padding: 0; }
.cvw-btn:disabled { opacity: 0.45; cursor: default; }
.cvw-btn:disabled:hover {
  background: transparent;
  color: var(--fg-secondary);
  transform: none;
  box-shadow: none;
}

/* Delayed tooltips below the cluster (inverted fg/bg works in every theme). */
.cvw-btn[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  top: calc(100% + 7px);
  right: 0;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--fg) 94%, transparent);
  color: var(--bg);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: normal;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translateY(-2px);
  transition:
    opacity var(--dur-2) var(--ease-out) var(--dur-3),
    transform var(--dur-2) var(--ease-out) var(--dur-3);
  z-index: 5;
}
.cvw-btn[data-tip]:hover::after,
.cvw-btn[data-tip]:focus-visible::after { opacity: 1; transform: none; }

/* Mode chip — visual distinction between editable and locked scenes. */
.cvw-mode {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 var(--sp-2);
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  user-select: none;
}
.cvw-mode::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
}
.cvw-mode[data-mode='edit'] { color: var(--accent); background: var(--accent-soft); }
.cvw-mode[data-mode='readonly'] { color: var(--warning); background: color-mix(in srgb, var(--warning) 14%, transparent); }
.cvw-sep { flex: none; width: 1px; height: 16px; background: var(--border-subtle); }

/* Collapsed state: only the expand chevron remains of the cluster. */
.cvw-chrome .cvw-btn--expand { display: none; }
.cvw-chrome.cvw-collapsed :is(.cvw-mode, .cvw-sep) { display: none; }
.cvw-chrome.cvw-collapsed .cvw-btn:not(.cvw-btn--expand) { display: none; }
.cvw-chrome.cvw-collapsed .cvw-btn--expand { display: inline-flex; }

/* "Saved" pill — bottom-right, fades in on each persisted autosave. */
.cvw-saved {
  position: absolute;
  right: var(--sp-3);
  bottom: var(--sp-3);
  z-index: 700;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--success, #34c759) 35%, transparent);
  background: color-mix(in srgb, var(--success, #34c759) 12%, var(--bg-elevated));
  color: var(--success, #34c759);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  box-shadow: var(--shadow-sm);
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity var(--dur-3) var(--ease-out),
    transform var(--dur-3) var(--ease-out);
  pointer-events: none;
}
.cvw-saved.cvw-show { opacity: 1; transform: none; }
.cvw-saved svg { width: 11px; height: 11px; flex: none; }

/* Friendly corrupt-file / load-failure panel (replaces bare red text). */
.pdf-error .cvw-error { margin: 0; }
.cvw-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  max-width: 400px;
  padding: var(--sp-6) var(--sp-7);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
  text-align: center;
  color: var(--fg-secondary);
  font-size: 12.5px;
  line-height: 1.55;
  animation: cvw-error-in var(--dur-3) var(--ease-out);
}
@keyframes cvw-error-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
.cvw-error-icon,
.cvw-error-icon > svg { width: 34px; height: 34px; color: var(--warning); }
.cvw-error-title { font-size: 14px; font-weight: 650; color: var(--fg); }
.cvw-error-note { font-size: 11.5px; color: var(--fg-muted); }
.cvw-error .cvw-mode { margin-top: var(--sp-1); }
`;

function ensurePolishStyle() {
  if (document.getElementById('cvw-polish-style')) return;
  const style = document.createElement('style');
  style.id = 'cvw-polish-style';
  style.textContent = POLISH_CSS;
  document.head.appendChild(style);
}

// Loading skeleton: the rounded well with a shimmer sweep + quiet label.
const loadingWellHtml = (label) =>
  '<div class="cvw-well cvw-well--loading" role="status" aria-live="polite">' +
  `<span class="cvw-loading-label">${escapeHtml(label)}</span></div>`;

// Friendly error-panel markup for module-load failures. `readonly` appends
// the read-only chip — nothing in these states is editable.
function errorPanelHtml({ title, body, note, readonly }) {
  return (
    '<div class="pdf-error"><div class="cvw-error" role="alert">' +
    `<span class="cvw-error-icon">${CVW_ICONS.warn}</span>` +
    `<div class="cvw-error-title">${escapeHtml(title)}</div>` +
    `<div>${escapeHtml(body)}</div>` +
    (note ? `<div class="cvw-error-note">${escapeHtml(note)}</div>` : '') +
    (readonly ? '<span class="cvw-mode" data-mode="readonly">Read-only</span>' : '') +
    '</div></div>'
  );
}

// Inline stroke icons (currentColor) for the overlay cluster + panels.
const CVW_ICONS = {
  warn:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>' +
    '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  png:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/>' +
    '<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
  svgIcon:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 18C8 6 16 6 20 18"/><rect x="2" y="16" width="4" height="4" rx="1"/><rect x="18" y="16" width="4" height="4" rx="1"/></svg>',
  collapse:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
  expand:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
};

// Build the floating overlay chrome into `well`: mode chip, PNG/SVG quick
// exports, a collapse toggle, and the transient "Saved" pill. Returns small
// imperative handles for the controller: flashSaved/setMode/setExportEnabled/
// destroy. Exports go through ctrl.exportImage() then the Tauri native save
// dialog (save_annotated_image — same command as main.js's header export),
// falling back to a plain browser download when running outside Tauri.
function mountCanvasChrome(well, opts) {
  const bar = document.createElement('div');
  bar.className = 'cvw-chrome';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Canvas actions');

  const mode = document.createElement('span');
  mode.className = 'cvw-mode';
  mode.dataset.mode = 'edit';
  mode.textContent = 'Edit';

  const sep = document.createElement('span');
  sep.className = 'cvw-sep';
  sep.setAttribute('aria-hidden', 'true');

  const mkBtn = (cls, tip, icon, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls ? `cvw-btn ${cls}` : 'cvw-btn';
    b.setAttribute('data-tip', tip);
    b.innerHTML = icon + (label ? `<span>${escapeHtml(label)}</span>` : '');
    return b;
  };
  const pngBtn = mkBtn(null, 'Export as PNG', CVW_ICONS.png, 'PNG');
  const svgBtn = mkBtn(null, 'Export as SVG', CVW_ICONS.svgIcon, 'SVG');
  const collapseBtn = mkBtn('cvw-btn--icon', 'Hide controls', CVW_ICONS.collapse, '');
  collapseBtn.setAttribute('aria-label', 'Hide canvas controls');
  const expandBtn = mkBtn('cvw-btn--icon cvw-btn--expand', 'Show controls', CVW_ICONS.expand, '');
  expandBtn.setAttribute('aria-label', 'Show canvas controls');

  async function doExport(kind) {
    try {
      const ctrl = typeof opts.getCtrl === 'function' ? opts.getCtrl() : null;
      if (!ctrl || typeof ctrl.exportImage !== 'function') return;
      const res = await ctrl.exportImage(kind);
      if (!res || !res.bytes) return;
      const suggestedName = `${opts.fileBase || 'drawing'}.${kind}`;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('save_annotated_image', { bytes: Array.from(res.bytes), suggestedName, kind });
      } catch (err) {
        if (err === 'cancelled') return; // native save dialog dismissed
        // Dev/browser fallback: plain blob download.
        const url = URL.createObjectURL(new Blob([res.bytes], { type: res.mime || 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = suggestedName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      console.error('canvas export failed:', e);
    }
  }
  pngBtn.addEventListener('click', () => doExport('png'));
  svgBtn.addEventListener('click', () => doExport('svg'));
  collapseBtn.addEventListener('click', () => bar.classList.add('cvw-collapsed'));
  expandBtn.addEventListener('click', () => bar.classList.remove('cvw-collapsed'));

  bar.append(mode, sep, pngBtn, svgBtn, collapseBtn, expandBtn);
  well.appendChild(bar);

  // Transient "Saved" pill — fades out after each persisted autosave.
  const pill = document.createElement('div');
  pill.className = 'cvw-saved';
  pill.setAttribute('aria-live', 'polite');
  pill.innerHTML = CVW_ICONS.check + '<span>Saved</span>';
  well.appendChild(pill);

  let savedTimer = null;
  return {
    flashSaved() {
      if (!pill.isConnected) return;
      pill.classList.add('cvw-show');
      if (savedTimer) clearTimeout(savedTimer);
      savedTimer = setTimeout(() => pill.classList.remove('cvw-show'), 1500);
    },
    setMode(m) {
      mode.dataset.mode = m === 'readonly' ? 'readonly' : 'edit';
      mode.textContent = m === 'readonly' ? 'Read-only' : 'Edit';
    },
    setExportEnabled(on) {
      pngBtn.disabled = !on;
      svgBtn.disabled = !on;
    },
    destroy() { if (savedTimer) clearTimeout(savedTimer); savedTimer = null; },
  };
}

export async function showExcalidraw(container, initialData, onSave, initialAppTheme, isStale) {
  ensurePolishStyle();
  const token = {};
  _containerOwners.set(container, token);
  const isOwner = () => _containerOwners.get(container) === token;
  // Loading state: the shimmering rounded well doubles as the height donor
  // while the modules download.
  container.innerHTML = loadingWellHtml('Loading Excalidraw…');
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
    // the canvas without React's first commit wiping it. v0.69: the wrapper
    // sits inside a rounded .cvw-well frame which also hosts the overlay
    // chrome (mode chip / quick exports / collapse) and the Saved pill.
    container.innerHTML = '';
    const well = document.createElement('div');
    well.className = 'cvw-well';
    const mountDiv = document.createElement('div');
    mountDiv.className = 'excalidraw-root';
    well.appendChild(mountDiv);
    container.appendChild(well);

    // Overlay chrome. getCtrl is a late-bound handle: the buttons come alive
    // as soon as the controller object below exists.
    let ctrlRef = null;
    const chrome = mountCanvasChrome(well, { fileBase: 'drawing', getCtrl: () => ctrlRef });
    // Persistence hook with UI feedback: every debounced autosave that goes
    // through onSave also flashes the "Saved" pill. The caller's flow is
    // untouched — flash failures can never block a save.
    const persist = onSave
      ? (json) => {
          onSave(json);
          try { chrome.flashSaved(); } catch { /* cosmetic only */ }
        }
      : null;

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
      if (persist) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveTimer = null;
          try {
            // 'local' keeps embedded image files + zoom/scroll appState.
            const json = serializeAsJSON(elements, appState, files || {}, 'local');
            persist(json);
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

    const ctrl = {
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
          // v0.68.0 exports take ONE options object (positional args throw:
          // the helpers destructure {elements, appState, files} from it).
          const opts = { exportPadding: 16 };
          const appState = { ...latestAppState, exportWithDarkMode: currentTheme === 'dark' };
          if (kind === 'svg') {
            const svg = await exportToSvg({
              elements: latestElements,
              appState,
              files: latestFiles || {},
              ...opts,
            });
            const str = new XMLSerializer().serializeToString(svg);
            return { bytes: new TextEncoder().encode(str), mime: 'image/svg+xml' };
          }
          const blob = await exportToBlob({
            elements: latestElements,
            appState,
            files: latestFiles || {},
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
        // Stop any in-flight "Saved" pill fade before tearing down.
        try { chrome.destroy(); } catch { /* already gone */ }
        // Flush a pending debounced save BEFORE unmounting — the caller is
        // either switching tabs or closing this doc, and this is the last
        // chance to capture edits made inside the debounce window.
        if (saveTimer && sceneChanged && persist) {
          clearTimeout(saveTimer);
          saveTimer = null;
          try {
            const json = serializeAsJSON(latestElements, latestAppState, latestFiles || {}, 'local');
            if (json) persist(json);
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
    // Late-bound handle: the chrome's export buttons start working now.
    ctrlRef = ctrl;
    return ctrl;
  } catch (e) {
    // If any module fails to load (offline, corrupt install, etc.), show a
    // friendly error card instead of leaving the user staring at a blank
    // "Loading…" text.
    if (isOwner()) {
      container.classList.remove('excalidraw-host');
      container.innerHTML = errorPanelHtml({
        title: 'Could not load Excalidraw',
        body: String(e?.message || e),
        note: 'Check your connection or reinstall the app, then reopen this tab.',
        readonly: true,
      });
    }
    console.error('Excalidraw load failed:', e);
    return stub;
  }
}
