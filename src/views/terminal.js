// Integrated Terminal Drawer module (v0.23.0).
//
// Real PTY (ConPTY on Windows) backend wired to xterm.js. Replaces the old
// request/response fake shell. The flow:
//
//   frontend xterm.js  ──onData(str)──►  invoke('write_terminal', {id, str})
//        ▲                                        │
//        └── write(UTF-8 decode of Channel) ◄─────┤
//                ▲                                │
//                └── Channel onmessage ──◄── pty.rs reader thread
//
// v0.64.0 (Terax-inspired): WebGL renderer with graceful DOM fallback,
// in-terminal search (Ctrl+F), OSC-based live cwd + tab-title tracking,
// real exit codes with press-Enter-to-restart, and bracketed-paste-safe
// clipboard paste. The terminal's `initTerminal({ cwdProvider, onToast })`
// export signature is unchanged from the previous version so main.js needs
// no edits at the call site. The pure helpers `readCssVar` and
// `xtermThemeFromApp` are exported for unit testing.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { invoke, Channel } from '@tauri-apps/api/core';

// Read a CSS custom property from :root, returning `fallback` if unset or if
// the computed value is empty. Stripped of surrounding whitespace.
export function readCssVar(name, fallback = '') {
  if (typeof window === 'undefined' || !window.getComputedStyle) return fallback;
  const v = window.getComputedStyle(document.documentElement).getPropertyValue(name);
  const trimmed = (v || '').trim();
  return trimmed || fallback;
}

// Compute a concrete font family stack for xterm.js Canvas context. Canvas 2D
// font properties cannot evaluate CSS `var(...)` expressions.
export function getTerminalFontFamily() {
  const fontVar = readCssVar('--mono-font', '');
  if (fontVar) {
    const cleanFont = fontVar.replace(/^["']|["']$/g, '');
    return `"${cleanFont}", "Cascadia Code", Consolas, "Fira Code", monospace`;
  }
  return '"Cascadia Code", Consolas, "Fira Code", monospace';
}

// Build an xterm.js theme object from the app's active theme CSS vars. xterm.js
// expects hex strings (or `#rrggbb` / `rgba(...)`); we hand it the same colors
// the rest of the app uses so the terminal matches the chosen theme.
//
// The ANSI 16-color palette is derived from the theme's accent / alert tokens
// (each theme tunes `--alert-*` to its signature palette — Dracula's greens,
// Solarized's yellows, Nord's frosts) so the terminal finally *looks* like the
// theme instead of generic Tailwind colors. Fallbacks are a sane neutral
// palette close to xterm.js defaults, valid if the vars are read before the
// theme stylesheet has applied (e.g. during first paint).
export function xtermThemeFromApp() {
  const fg     = readCssVar('--fg', '#e8e8e8');
  const bg     = readCssVar('--bg', '#000000');
  const muted  = readCssVar('--fg-muted', '#888888');
  const red     = readCssVar('--danger',          '#ff5555');
  const green   = readCssVar('--success',         '#50fa7b');
  const yellow  = readCssVar('--alert-warning',   '#f1fa8c');
  const blue    = readCssVar('--accent',          '#8be9fd');
  const magenta = readCssVar('--alert-important', '#ff79c6');
  const cyan    = readCssVar('--alert-note',      '#8be9fd');
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: readCssVar('--surface-active', 'rgba(255,255,255,0.2)'),
    black: muted,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white: fg,
    brightBlack: muted,
    brightRed: red,
    brightGreen: green,
    brightYellow: yellow,
    brightBlue: blue,
    brightMagenta: magenta,
    brightCyan: cyan,
    brightWhite: fg,
  };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Normalize an OSC 7 / OSC 9;9 cwd report into a display path.
// OSC 7 payloads look like `file://hostname/C:/Users/foo` (Windows drive) or
// `file://hostname/home/foo` (WSL/Unix); OSC 9;9 payloads are bare Windows
// paths (`C:\Users\foo`). Percent-encoding is decoded when possible; drive
// paths get backslashes for native display.
export function normalizeOscCwd(raw) {
  if (!raw) return '';
  let p = String(raw);
  try { p = decodeURIComponent(p); } catch { /* keep raw on malformed input */ }
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(p);
  if (m) {
    p = m[1];
    // 'file://host/C:/…' carries the path '/C:/…' — drop the wrapper slash
    // so the drive letter starts the string.
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  }
  if (/^[A-Za-z]:/.test(p)) return p.replace(/\//g, '\\');
  return p;
}

export function initTerminal({ cwdProvider, onToast }) {
  const drawer = document.getElementById('terminal-drawer');
  const body = document.getElementById('terminal-body');
  const clearBtn = document.getElementById('terminal-clear-btn');
  const closeBtn = document.getElementById('terminal-close-btn');
  const tabsEl = document.getElementById('terminal-tabs');
  const newTabBtn = document.getElementById('terminal-new-tab');
  const pwdEl = document.getElementById('terminal-pwd');

  // One entry per open terminal tab. The xterm.js Terminal + the PTY id + the
  // disposers for its event subscriptions are all kept here so we can fully
  // tear down a tab on close.
  let tabs = [];
  let activeTabId = null;
  let tabIdCounter = 1;

  function getActiveTab() {
    return tabs.find((t) => t.id === activeTabId) || tabs[0];
  }

  function getWorkingDir() {
    // Live when the shell reports its cwd via OSC 7 / OSC 9;9 (pwsh shell
    // integration, git-bash, WSL + oh-my-posh); otherwise the launch dir —
    // the same "we show where it started" approximation VS Code uses.
    const active = getActiveTab();
    return (active && active.cwd) || cwdProvider() || '.';
  }

  function updatePwdDisplay() {
    if (pwdEl) pwdEl.textContent = getWorkingDir();
  }

  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    tabs.forEach((t) => {
      const tabDiv = document.createElement('div');
      tabDiv.className = `terminal-tab ${t.id === activeTabId ? 'active' : ''}`;
      tabDiv.innerHTML = `<span>${escapeHtml(t.name)}</span><span class="terminal-tab-close" title="Close tab">✕</span>`;
      tabDiv.addEventListener('click', () => switchTab(t.id));
      const closeSpan = tabDiv.querySelector('.terminal-tab-close');
      if (closeSpan) closeSpan.addEventListener('click', (e) => closeTab(t.id, e));
      tabsEl.appendChild(tabDiv);
    });
  }

  function makeMountEl() {
    // Each tab gets its own <div> inside #terminal-body. xterm.js opens into
    // this div; switching tabs just toggles display, leaving the Terminal
    // instance (and its scrollback) alive.
    const mountEl = document.createElement('div');
    mountEl.className = 'terminal-mount';
    if (body) body.appendChild(mountEl);
    return mountEl;
  }

  async function handlePastedImageBlob(blob) {
    const active = getActiveTab();
    if (!active || active.ptyId === undefined) return;
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(arrayBuffer));
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('jpeg') || blob.type.includes('jpg') ? 'jpg' : 'png';
      const timestamp = Date.now();
      const filename = `pasted_image_${timestamp}.${ext}`;

      const savedPath = await invoke('save_image', { dir: 'global', filename, bytes });
      const normalizedPath = savedPath.replace(/\\/g, '/');

      const pathArg = `"${normalizedPath}" `;
      await invoke('write_terminal', { id: active.ptyId, data: pathArg });
      if (onToast) onToast(`Pasted image path to terminal: ${filename}`);
    } catch (err) {
      console.error('Failed to paste image to terminal:', err);
      if (onToast) onToast('Failed to paste image');
    }
  }

  async function createTab() {
    const id = `term-${tabIdCounter++}`;
    const mountEl = makeMountEl();

    const term = new Terminal({
      fontFamily: getTerminalFontFamily(),
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      theme: xtermThemeFromApp(),
      scrollback: 10000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    const search = new SearchAddon();
    term.loadAddon(search);
    term.open(mountEl);

    // GPU-accelerated renderer (Terax-style). Falls back silently to the
    // default DOM renderer when WebGL is unavailable (remote desktop, locked
    // GPU, jsdom); on context loss the addon is disposed and we keep running.
    let webgl = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => { try { webgl?.dispose(); } catch { /* noop */ } webgl = null; });
      term.loadAddon(webgl);
    } catch {
      webgl = null;
    }

    // Fit must run after open() so cols/rows reflect real pixel sizes. Defer
    // one frame so layout has settled.
    requestAnimationFrame(() => { try { fit.fit(); } catch { /* noop */ } });

    let ptyId;        // undefined until a PTY is attached (and after final failure)
    let exited = false; // true after the child exits — Enter respawns
    let lastCwd = cwdProvider() || null;
    let spawning = false; // guards double respawn: repeated Enters while a spawn is in flight

    // Live cwd + tab-title tracking via OSC sequences. Shells that emit them
    // (pwsh with shell integration, git-bash, WSL + oh-my-posh) keep the PWD
    // readout and tab label in sync; shells that don't simply keep showing
    // the launch dir (the previous behavior).
    term.parser.registerOscHandler(7, (data) => {
      const p = normalizeOscCwd(data);
      if (p) { lastCwd = p; updatePwdDisplay(); }
      return false;
    });
    term.parser.registerOscHandler(9, (data) => {
      if (typeof data === 'string' && data.startsWith('9;')) {
        const p = data.slice(2);
        if (p) { lastCwd = p; updatePwdDisplay(); }
        return false;
      }
      return false; // other OSC 9;* (growl notifications etc.) pass through
    });
    const titleHandler = (data) => {
      const t = String(data || '').trim();
      if (t) renameTab(id, t);
      return false;
    };
    term.parser.registerOscHandler(0, titleHandler);
    term.parser.registerOscHandler(2, titleHandler);

    const tab = {
      id,
      name: `Terminal ${tabIdCounter - 1}`,
      term,
      fit,
      search,
      mountEl,
      onDataDisp: null,
      onResizeDisp: null,
    };
    // ptyId is a live view: respawns rebind it without touching every call site.
    Object.defineProperty(tab, 'ptyId', { get: () => ptyId });
    // Live cwd: updated by OSC handlers as the shell moves around.
    Object.defineProperty(tab, 'cwd', { get: () => lastCwd });

    // Spawn (or respawn after exit) a PTY for this terminal. Reuses the last
    // known cwd so a restarted shell lands where the user left off.
    async function attachPty() {
      if (spawning) return false; // a respawn is already in flight — don't double-spawn
      spawning = true;
      try {
        const chan = new Channel();
        chan.onmessage = (msg) => {
          if (!msg) return;
          if (msg.t === 'Data') term.write(msg.d);
          else if (msg.t === 'Exit') {
            // Mark exited and render a clear status line. The tab stays open;
            // pressing Enter spawns a fresh shell in the same terminal
            // (scrollback preserved) instead of leaving a dead pane around.
            exited = true;
            term.write(`\r\n\x1b[90m[process exited${msg.d ? ` (code ${msg.d})` : ''} — press Enter to restart]\x1b[0m\r\n`);
          }
        };

        // Race the spawn against a timeout so a missing backend (e.g. the page
        // loaded outside Tauri, or the Rust command hung) doesn't strand the
        // tab forever with no PTY wired up. 15s is generous: a cold-started
        // PowerShell on a slow machine with a heavy $PROFILE can take several
        // seconds before its first byte. On timeout we render an error line and
        // leave ptyId undefined — the rest of the module is no-op-safe for that
        // case (onDataDisp / onResizeDisp check ptyId !== undefined).
        const spawnPromise = invoke('spawn_terminal', {
          onEvent: chan,
          cwd: lastCwd,
          cols: term.cols,
          rows: term.rows,
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('terminal backend did not respond within 15s')),
            15000,
          ),
        );
        const res = await Promise.race([spawnPromise, timeoutPromise]);
        ptyId = res.id;
        exited = false;
        if (ptyId !== undefined) {
          requestAnimationFrame(() => {
            try {
              fit.fit();
              invoke('resize_terminal', { id: ptyId, cols: term.cols, rows: term.rows }).catch(() => {});
            } catch { /* noop */ }
          });
        }
        return true;
      } catch (err) {
        term.write(`\x1b[31mFailed to start terminal: ${escapeHtml(String(err))}\x1b[0m\r\n`);
        return false;
      } finally {
        spawning = false;
      }
    }

    await attachPty();

    if (term.attachCustomKeyEventHandler) {
      term.attachCustomKeyEventHandler((arg) => {
        if (arg.type === 'keydown') {
          if ((arg.ctrlKey || arg.metaKey) && (arg.key === 'c' || arg.key === 'C') && term.hasSelection()) {
            navigator.clipboard.writeText(term.getSelection());
            return false;
          }
          if ((arg.ctrlKey || arg.metaKey) && (arg.key === 'f' || arg.key === 'F')) {
            openSearchBar(term.hasSelection() ? term.getSelection() : '');
            return false;
          }
          if ((arg.ctrlKey || arg.metaKey) && (arg.key === 'v' || arg.key === 'V')) {
            (async () => {
              try {
                if (navigator.clipboard.read) {
                  const items = await navigator.clipboard.read();
                  for (const item of items) {
                    const imageType = item.types.find((t) => t.startsWith('image/'));
                    if (imageType) {
                      const blob = await item.getType(imageType);
                      await handlePastedImageBlob(blob);
                      return;
                    }
                  }
                }
                const text = await navigator.clipboard.readText();
                if (text) {
                  // term.paste() routes through the bracketed-paste path so
                  // multi-line pastes arrive as one block instead of being
                  // executed line-by-line by the shell.
                  term.paste(text);
                }
              } catch {
                navigator.clipboard.readText().then((text) => {
                  if (text) term.paste(text);
                }).catch(() => {});
              }
            })();
            return false;
          }
        }
        return true;
      });
    }

    // Pipe keystrokes → PTY. onData fires on every key, including Ctrl+C
    // (\x03), Enter (\r), arrows, etc. — xterm.js does the keyboard mapping.
    const onDataDisp = term.onData((str) => {
      if (exited) {
        // The shell died; Enter restarts it in the same terminal.
        if (str === '\r') attachPty();
        return;
      }
      if (ptyId === undefined) return;
      invoke('write_terminal', { id: ptyId, data: str }).catch((e) =>
        console.error('write_terminal:', e),
      );
    });
    // Pipe viewport resize → PTY. fit() recomputes cols/rows from the parent
    // size; onResize fires; we forward to the backend which resizes the ConPTY.
    const onResizeDisp = term.onResize(({ cols, rows }) => {
      if (ptyId === undefined) return;
      invoke('resize_terminal', { id: ptyId, cols, rows }).catch(() => { /* best-effort */ });
    });
    tab.onDataDisp = onDataDisp;
    tab.onResizeDisp = onResizeDisp;

    tabs.push(tab);
    switchTab(id);
    term.focus();
    return tab;
  }

  // Rename a tab (OSC 0/2 title tracking). Truncated for the tab strip.
  function renameTab(id, title) {
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    const short = title.length > 24 ? title.slice(0, 22) + '…' : title;
    if (t.name === short) return;
    t.name = short;
    renderTabs();
  }

  function switchTab(id) {
    tabs.forEach((t) => {
      if (t.mountEl) t.mountEl.style.display = t.id === id ? '' : 'none';
    });
    activeTabId = id;
    const active = getActiveTab();
    if (active) {
      // fit() needs the mount visible to measure, and switching tabs unhides
      // it on the line above — but layout hasn't flushed yet, so defer.
      requestAnimationFrame(() => {
        try { active.fit.fit(); } catch { /* noop */ }
        active.term.focus();
      });
    }
    renderTabs();
    updatePwdDisplay();
  }

  function closeTab(id, e, opts = {}) {
    if (e) e.stopPropagation();
    const idx = tabs.findIndex((t) => t.id === id);
    const tab = tabs[idx];
    if (!tab) return;

    // Kill the PTY (drop closes the ConPTY; the reader thread exits on EOF).
    // Skipped during destroyAll, which drains the whole map in one shot via
    // kill_all_terminals (faster, and avoids spawning a worker thread per tab).
    if (!opts.destroy && tab.ptyId !== undefined) {
      invoke('kill_terminal', { id: tab.ptyId }).catch(() => { /* best-effort */ });
    }
    tab.onDataDisp.dispose();
    tab.onResizeDisp.dispose();
    try { tab.term.dispose(); } catch { /* noop */ }
    tab.mountEl?.remove();

    tabs = tabs.filter((t) => t.id !== id);
    if (tabs.length === 0 && !opts.destroy) {
      // Recreate a fresh tab so the drawer is never empty (matches the
      // previous version's behavior). The `destroy` opt skips this so app
      // shutdown doesn't race a fresh spawn_terminal against app.exit(0) —
      // which was the root cause of the "Not Responding on close" freeze.
      createTab();
      return;
    }
    if (tabs.length > 0 && activeTabId === id) {
      const next = tabs[Math.max(0, idx - 1)];
      switchTab(next.id);
    } else if (tabs.length > 0) {
      renderTabs();
    }
  }

  // Initial tab — created lazily on first open() so we don't spawn a PTY for a
  // drawer the user hasn't opened yet (saves one PowerShell process at startup).
  let bootstrapped = false;
  function bootstrapIfEmpty() {
    if (bootstrapped) return;
    bootstrapped = true;
    createTab();
  }

  function open() {
    if (!drawer) return;
    drawer.classList.remove('hidden');
    bootstrapIfEmpty();
    updatePwdDisplay();
    // Fit after the drawer is visible (one frame) so cols/rows are real.
    requestAnimationFrame(() => {
      const active = getActiveTab();
      if (active) {
        try { active.fit.fit(); } catch { /* noop */ }
        active.term.focus();
      }
    });
  }

  function close() {
    if (drawer) drawer.classList.add('hidden');
  }

  function toggle() {
    if (!drawer) return;
    if (drawer.classList.contains('hidden')) open();
    else close();
  }

  function clear() {
    const active = getActiveTab();
    if (active) active.term.clear();
  }

  // Shim for the old `execute(cmd)` API: writes the command + Enter to the
  // active PTY. No longer called internally (keystrokes go straight through
  // xterm.js's onData), but kept for any external caller that exists.
  function execute(cmdStr) {
    const active = getActiveTab();
    if (!active || active.ptyId === undefined) return;
    invoke('write_terminal', { id: active.ptyId, data: (cmdStr || '') + '\r' }).catch(() => {});
  }

  // Drag-and-drop & paste: drop or paste files/images into the terminal.
  if (drawer) {
    drawer.addEventListener('paste', async (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      if (imageItem) {
        e.preventDefault();
        e.stopPropagation();
        const blob = imageItem.getAsFile();
        if (blob) await handlePastedImageBlob(blob);
      }
    });
    drawer.addEventListener('dragover', (e) => {
      e.preventDefault();
      drawer.classList.add('dragover');
    });
    drawer.addEventListener('dragleave', () => drawer.classList.remove('dragover'));
    drawer.addEventListener('drop', (e) => {
      e.preventDefault();
      drawer.classList.remove('dragover');
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) return;
      const active = getActiveTab();
      if (!active || active.ptyId === undefined) return;
      const paths = files.map((f) => `"${f.path || f.name}"`).join(' ');
      // Write the path string directly into the PTY so the shell receives it
      // as if the user had typed it at the prompt.
      invoke('write_terminal', { id: active.ptyId, data: paths }).catch(() => {});
    });
  }

  // Resizable drawer — same as before. On mouseup we re-fit so the new height
  // propagates to cols/rows and the PTY is resized accordingly.
  const resizeHandle = document.getElementById('terminal-resize-handle');
  if (resizeHandle && drawer) {
    let startY = 0;
    let startH = 0;
    const onMouseMove = (e) => {
      const deltaY = startY - e.clientY;
      const newH = Math.min(Math.max(startH + deltaY, 120), window.innerHeight * 0.8);
      drawer.style.height = `${newH}px`;
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Re-fit the active terminal to its new container size, then forward
      // the new cols/rows to the PTY (onResize handler does the invoke).
      const active = getActiveTab();
      if (active) {
        try { active.fit.fit(); } catch { /* noop */ }
      }
    };
    resizeHandle.addEventListener('mousedown', (e) => {
      startY = e.clientY;
      startH = drawer.getBoundingClientRect().height;
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    });
  }

  // Window resize → re-fit so the terminal recomputes cols/rows. Cheaper than
  // debouncing for typical resize drags; xterm.js handles coalescing.
  window.addEventListener('resize', () => {
    const active = getActiveTab();
    if (active && !drawer?.classList.contains('hidden')) {
      try { active.fit.fit(); } catch { /* noop */ }
    }
  });

  if (newTabBtn) newTabBtn.addEventListener('click', () => createTab());
  if (clearBtn) clearBtn.addEventListener('click', clear);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (body) body.addEventListener('click', () => {
    const active = getActiveTab();
    if (active) active.term.focus();
  });

  // ---- In-terminal search (Terax-style inline find, v0.64.0) --------------
  // A compact find bar in the terminal header driving the active tab's
  // SearchAddon: Enter/↓ next, Shift+Enter/↑ previous, Esc closes and
  // returns focus to the terminal.
  const searchWrap = document.getElementById('terminal-search');
  const searchInput = document.getElementById('terminal-search-input');
  const searchPrevBtn = document.getElementById('terminal-search-prev');
  const searchNextBtn = document.getElementById('terminal-search-next');
  const searchCloseBtn = document.getElementById('terminal-search-close');

  function closeSearchBar() {
    if (!searchWrap) return;
    searchWrap.classList.add('hidden');
    const active = getActiveTab();
    if (active) {
      try { active.search.clearActiveDecoration?.(); } catch { /* noop */ }
      active.term.focus();
    }
  }

  function runSearch(backwards = false) {
    if (!searchInput) return;
    const q = searchInput.value || '';
    if (!q) return;
    const active = getActiveTab();
    if (!active) return;
    try {
      if (backwards) active.search.findPrevious(q, { caseSensitive: false });
      else active.search.findNext(q, { caseSensitive: false });
    } catch { /* noop */ }
  }

  function openSearchBar(seed = '') {
    if (!searchWrap || !searchInput) return;
    if (drawer?.classList.contains('hidden')) open();
    searchWrap.classList.remove('hidden');
    searchInput.value = seed;
    searchInput.focus();
    searchInput.select();
    if (seed) runSearch();
  }

  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runSearch(e.shiftKey); }
      else if (e.key === 'Escape') { e.preventDefault(); closeSearchBar(); }
      e.stopPropagation(); // keep app-level shortcuts out while typing
    });
    searchInput.addEventListener('input', () => runSearch());
  }
  if (searchPrevBtn) searchPrevBtn.addEventListener('click', () => runSearch(true));
  if (searchNextBtn) searchNextBtn.addEventListener('click', () => runSearch(false));
  if (searchCloseBtn) searchCloseBtn.addEventListener('click', closeSearchBar);

  // Public API. `destroyAll` is called from main.js on app close to prevent
  // zombie PowerShell processes when the window is closed.
  return {
    open,
    close,
    toggle,
    clear,
    execute,
    destroyAll() {
      // Kill every live PTY. Called on app shutdown. Two things matter here:
      //  1. Don't respawn a fresh tab when the last one closes (closeTab's
      //     `destroy` opt) — that would race a new spawn_terminal against
      //     app.exit(0) and freeze the window.
      //  2. Drain the backend map in a single kill_all_terminals call so the
      //     Rust side empties TermState before quit_app drops it.
      [...tabs].forEach((t) => closeTab(t.id, null, { destroy: true }));
      tabs = [];
      activeTabId = null;
      invoke('kill_all_terminals').catch(() => { /* best-effort */ });
      bootstrapped = false;
    },
    // Apply a new xterm theme to every open terminal. Called by main.js when
    // the user switches app theme.
    setTheme() {
      const theme = xtermThemeFromApp();
      const fontFamily = getTerminalFontFamily();
      tabs.forEach((t) => {
        t.term.options.theme = theme;
        t.term.options.fontFamily = fontFamily;
        try { t.term.refresh(0, t.term.rows - 1); } catch { /* best effort */ }
      });
    },
    updateZoom(zoomLevel = 1) {
      const baseFs = 13;
      const nextFs = Math.round(baseFs * zoomLevel * 10) / 10;
      tabs.forEach((t) => {
        if (t.term) {
          t.term.options.fontSize = nextFs;
          try { t.fit.fit(); } catch { /* best effort */ }
        }
      });
    },
  };
}
