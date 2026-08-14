// Dev-only browser shim — lets the UI boot in a plain browser (vite dev on
// :1420) for CSS/DOM work without the Tauri backend.
//
// In a real Tauri window `window.__TAURI_INTERNALS__` is injected before any
// app JS runs, so this module is a no-op there. In a plain browser the
// internals object is missing and `getCurrentWindow()` (main.js, module
// scope) throws, aborting the whole module — the known "blank in browser
// dev" failure. Installing a minimal fake keeps the module alive; every
// `invoke()` still rejects, which the existing try/catch paths already
// degrade from gracefully (no files, no terminal — chrome only).
if (!window.__TAURI_INTERNALS__) {
  // Collect runtime errors + unhandled rejections so browser-side debugging
  // (and the ?term=1 / ?settings=1 previews) can be diagnosed via
  // window.__devErrors instead of a detached DevTools console.
  window.__devErrors = [];
  window.addEventListener('error', (e) => window.__devErrors.push(String(e.error || e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__devErrors.push('unhandled: ' + String(e.reason)));

  let cbId = 0;
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main' },
    },
    // Event (un)listen resolves so `listen()` chains settle instead of
    // producing unhandled rejections; handlers simply never fire.
    invoke: (cmd) =>
      cmd === 'plugin:event|listen' || cmd === 'plugin:event|unlisten'
        ? Promise.resolve(++cbId)
        : Promise.reject(new Error(`dev shim: no backend for "${cmd}"`)),
    transformCallback: (cb) => {
      const id = ++cbId;
      Object.defineProperty(window, `_${id}`, {
        value: (ev) => cb(ev),
        writable: false,
        configurable: true,
      });
      return id;
    },
  };

  // Deterministic browser previews for UI work / visual regression:
  //   ?theme=dark        — force a theme for this load (manual mode)
  //   &settings=1        — auto-open the settings dialog once wired
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme');
  if (theme) {
    localStorage.setItem('mdpeek-theme-mode', 'manual');
    localStorage.setItem('mdpeek-theme', theme);
  }
  if (params.get('settings') === '1') {
    setTimeout(() => document.getElementById('btn-settings')?.click(), 600);
    // Optionally deep-link to a settings category (?settings=1&panel=appearance).
    const panel = params.get('panel');
    if (panel) {
      setTimeout(() => {
        document.querySelector(`.settings-cat[data-cat="${panel}"]`)?.click();
      }, 1200);
    }
  }
  if (params.get('term') === '1') {
    setTimeout(() => document.getElementById('btn-terminal')?.click(), 900);
  }
  // Seed a sample document (session restore) so rendered-markdown styling is
  // screenshotable in a plain browser. Seeds once, then reloads so main.js
  // restores it through the normal boot path (sessionStorage flag breaks the
  // seed→reload cycle).
  if (params.get('doc') === '1' && !sessionStorage.getItem('mdpeek-dev-doc')) {
    const sample = [
      '# Markdown preview', '',
      'A paragraph with **bold**, *italic*, `inline code`, a [link](https://example.com) and ==highlight==.', '',
      '> A blockquote with an accent stripe — quotes read as pulled prose.', '',
      '## Sections', '',
      '1. Ordered items', '2. Render with rhythm', '',
      '- [ ] Task lists', '- [x] stay interactive', '',
      '```js', '// fenced code keeps the mono stack', 'const hello = () => "world";', '```', '',
      '| Column | Another |', '| --- | --- |', '| tables | hover |', '| render | cleanly |', '',
      '---', '',
      '### Smaller heading', '',
      'Final paragraph after a divider.',
    ].join('\n');
    localStorage.setItem('mdpeek-session', JSON.stringify({
      docs: [{ id: 'preview-doc', path: null, content: sample, mode: 'view', dirty: false, scrollY: 0 }],
      activeId: 'preview-doc',
    }));
    sessionStorage.setItem('mdpeek-dev-doc', '1');
    location.reload();
  }
}
