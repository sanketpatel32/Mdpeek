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

// ---------- UI polish (v0.69, injected once) ----------
// Presentation-only styles for the embedded canvas editors: a rounded canvas
// well with a subtle inset ring, a loading shimmer, a floating action cluster
// (mode chip + quick exports + collapse) with hover lift and delayed
// tooltips, a transient "Saved" pill, and a friendly corrupt-file panel.
// Id-guarded like csv-viewer's polish so repeated mounts never stack
// duplicate <style> elements. Identical to excalidraw-viewer's sheet — both
// guard on the SAME id, so whichever viewer loads first injects it once.
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
  ensurePolishStyle();
  const token = {};
  _containerOwners.set(container, token);
  const isOwner = () => _containerOwners.get(container) === token;
  container.innerHTML = loadingWellHtml('Loading TLDraw…');
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

    // v0.69: React mounts into .cvw-mount inside a rounded .cvw-well frame
    // which also hosts the overlay chrome (mode chip / quick exports /
    // collapse) and the Saved pill. Chrome goes up FIRST — handleMount can
    // fail synchronously during the render commit (corrupt snapshot) and
    // must be able to flip the badge to Read-only.
    container.innerHTML = '';
    const well = document.createElement('div');
    well.className = 'cvw-well';
    const mountDiv = document.createElement('div');
    mountDiv.className = 'cvw-mount';
    well.appendChild(mountDiv);
    container.appendChild(well);
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
           if (persist) persist(json);
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
          // writing a blank canvas. v0.69: also flip the overlay badge to
          // Read-only and disable quick exports — nothing here is editable,
          // and exporting an empty canvas would be misleading.
          console.error('TLDraw loadSnapshot failed:', e);
          loadFailed = true;
          try {
            chrome.setMode('readonly');
            chrome.setExportEnabled(false);
          } catch { /* chrome already gone */ }
          setFailed(true);
        } finally {
          suppressSave = false;
        }
      }, []);

      if (failed) {
        // v0.69: friendly corrupt-file panel (replaces the bare red banner):
        // what happened, what is safe, and a Read-only chip so the locked
        // state reads at a glance.
        return React.createElement(
          'div',
          { className: 'pdf-error' },
          React.createElement(
            'div',
            { className: 'cvw-error', role: 'alert' },
            React.createElement('span', {
              className: 'cvw-error-icon',
              dangerouslySetInnerHTML: { __html: CVW_ICONS.warn },
            }),
            React.createElement(
              'div',
              { className: 'cvw-error-title' },
              'This drawing couldn\u2019t be opened',
            ),
            React.createElement(
              'div',
              null,
              'It may be from a newer TLDraw version or the file may be corrupt.',
            ),
            React.createElement(
              'div',
              { className: 'cvw-error-note' },
              'The file on disk is unchanged \u2014 editing stays disabled so you can\u2019t overwrite it.',
            ),
            React.createElement('span', { className: 'cvw-mode', 'data-mode': 'readonly' }, 'Read-only'),
          ),
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

    // v0.69: React owns ONLY the mount div inside the well — the chrome and
    // Saved pill are siblings that must survive React's take-over of its root.
    const root = ReactDOMClient.createRoot(mountDiv);
    try {
      root.render(React.createElement(TLDrawRoot));
    } catch (renderErr) {
      try { root.unmount(); } catch {}
      throw renderErr;
    }

    const ctrl = {
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
          // toImage() indexes/maps the list — getCurrentPageShapeIds() returns
          // a Set, which has no .length/.map and would throw inside toImage.
          const shapeIds = [...editorRef.getCurrentPageShapeIds()];
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
        // Stop any in-flight "Saved" pill fade before tearing down.
        try { chrome.destroy(); } catch { /* already gone */ }
        // Flush a pending debounced save BEFORE unmounting — the caller is
        // switching away from or closing this doc, and edits made inside the
        // 1s window would otherwise be lost.
        if (saveTimer && sceneChanged && !loadFailed && persist) {
          clearTimeout(saveTimer);
          saveTimer = null;
          try {
            const json = serialize(editorRef);
            if (json) persist(json);
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
    // Late-bound handle: the chrome's export buttons start working now.
    ctrlRef = ctrl;
    return ctrl;
  } catch (e) {
    console.error('TLDraw failed to load:', e);
    if (isOwner()) {
      container.classList.remove('tldraw-host');
      container.innerHTML = errorPanelHtml({
        title: 'Could not load TLDraw',
        body: String(e?.message || e),
        note: 'Check your connection or reinstall the app, then reopen this tab.',
        readonly: true,
      });
    }
    return stub;
  }
}
