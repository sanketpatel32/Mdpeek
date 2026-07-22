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
// The terminal's `initTerminal({ cwdProvider, onToast })` export signature is
// unchanged from the previous version so main.js needs no edits at the call
// site. The pure helpers `readCssVar` and `xtermThemeFromApp` are exported for
// unit testing.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
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
// the rest of the app uses so the terminal matches the chosen theme. Falls
// back to neutral colors if a var is missing.
export function xtermThemeFromApp() {
  return {
    background: readCssVar('--bg', '#000000'),
    foreground: readCssVar('--fg', '#ffffff'),
    cursor: readCssVar('--fg', '#ffffff'),
    cursorAccent: readCssVar('--bg', '#000000'),
    selectionBackground: readCssVar('--surface-hover', 'rgba(255,255,255,0.2)'),
    black: readCssVar('--fg', '#000000'),
    red: readCssVar('--danger', '#ff0000'),
    green: '#22c55e',
    yellow: '#f59e0b',
    blue: readCssVar('--accent', '#0000ff'),
    magenta: '#c084fc',
    cyan: '#06b6d4',
    white: readCssVar('--fg', '#ffffff'),
    brightBlack: readCssVar('--fg-muted', '#666666'),
    brightRed: readCssVar('--danger', '#ff5555'),
    brightGreen: '#4ade80',
    brightYellow: '#fbbf24',
    brightBlue: readCssVar('--accent', '#5555ff'),
    brightMagenta: '#d8b4fe',
    brightCyan: '#22d3ee',
    brightWhite: readCssVar('--fg', '#ffffff'),
  };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    // The PTY owns cwd now; we expose cwdProvider() only as the initial cwd
    // for new tabs. The PWD readout is best-effort: we render the initial cwd
    // and don't try to track the live shell cwd (would require OSC-sequence
    // parsing). Matches VS Code's "we show the launch dir" approximation.
    return cwdProvider() || '.';
  }

  function updatePwdDisplay() {
    if (pwdEl) pwdEl.textContent = `PS ${getWorkingDir()}`;
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

      const baseDir = getWorkingDir() || '.';
      let savedPath = '';
      try {
        const assetsDir = baseDir.endsWith('/') || baseDir.endsWith('\\') ? `${baseDir}assets` : `${baseDir}/assets`;
        const resName = await invoke('save_image', { dir: assetsDir, filename, bytes });
        savedPath = `${assetsDir}/${resName}`.replace(/\\/g, '/');
      } catch {
        const resName = await invoke('save_image', { dir: baseDir, filename, bytes });
        savedPath = `${baseDir}/${resName}`.replace(/\\/g, '/');
      }

      const pathArg = `"${savedPath}" `;
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
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(mountEl);
    // Fit must run after open() so cols/rows reflect real pixel sizes. Defer
    // one frame so layout has settled.
    requestAnimationFrame(() => { try { fit.fit(); } catch { /* noop */ } });

    // Channel carries backend → frontend PTY events. The Tauri 2 Channel is
    // passed to invoke() as a normal arg; the backend's spawn_terminal takes
    // it and calls .send() from the reader thread. Both `new Channel()` and
    // `invoke()` need __TAURI_INTERNALS__ to be registered; if not (e.g. the
    // page is loaded in a plain browser during development), they throw. We
    // catch here so the tab still registers + renders an error instead of
    // silently failing.
    let ptyId;
    try {
      const chan = new Channel();
      chan.onmessage = (msg) => {
        if (!msg) return;
        if (msg.t === 'Data') term.write(msg.d);
        else if (msg.t === 'Exit') {
          // Render a clear "[process exited]" line so the user knows the PTY
          // died. The tab stays open until they close it (VS Code behavior).
          term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n');
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
        cwd: cwdProvider() || null,
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
    } catch (err) {
      term.write(`\x1b[31mFailed to start terminal: ${escapeHtml(String(err))}\x1b[0m\r\n`);
    }

    if (term.attachCustomKeyEventHandler) {
      term.attachCustomKeyEventHandler((arg) => {
        if (arg.type === 'keydown') {
          if ((arg.ctrlKey || arg.metaKey) && (arg.key === 'c' || arg.key === 'C') && term.hasSelection()) {
            navigator.clipboard.writeText(term.getSelection());
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
                if (text && ptyId !== undefined) {
                  invoke('write_terminal', { id: ptyId, data: text }).catch(() => {});
                }
              } catch {
                navigator.clipboard.readText().then((text) => {
                  if (text && ptyId !== undefined) {
                    invoke('write_terminal', { id: ptyId, data: text }).catch(() => {});
                  }
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

    if (ptyId !== undefined) {
      requestAnimationFrame(() => {
        try {
          fit.fit();
          invoke('resize_terminal', { id: ptyId, cols: term.cols, rows: term.rows }).catch(() => {});
        } catch { /* noop */ }
      });
    }

    const tab = {
      id,
      name: `Terminal ${tabIdCounter - 1}`,
      ptyId,
      term,
      fit,
      mountEl,
      onDataDisp,
      onResizeDisp,
    };
    tabs.push(tab);
    switchTab(id);
    term.focus();
    return tab;
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

  function closeTab(id, e) {
    if (e) e.stopPropagation();
    const idx = tabs.findIndex((t) => t.id === id);
    const tab = tabs[idx];
    if (!tab) return;

    // Kill the PTY (drop closes the ConPTY; the reader thread exits on EOF).
    if (tab.ptyId !== undefined) {
      invoke('kill_terminal', { id: tab.ptyId }).catch(() => { /* best-effort */ });
    }
    tab.onDataDisp.dispose();
    tab.onResizeDisp.dispose();
    try { tab.term.dispose(); } catch { /* noop */ }
    tab.mountEl?.remove();

    tabs = tabs.filter((t) => t.id !== id);
    if (tabs.length === 0) {
      // Recreate a fresh tab so the drawer is never empty (matches the
      // previous version's behavior).
      createTab();
      return;
    }
    if (activeTabId === id) {
      const next = tabs[Math.max(0, idx - 1)];
      switchTab(next.id);
    } else {
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

  // Public API. `destroyAll` is called from main.js on app close to prevent
  // zombie PowerShell processes when the window is closed.
  return {
    open,
    close,
    toggle,
    clear,
    execute,
    destroyAll() {
      // Kill every live PTY. Called on app shutdown.
      [...tabs].forEach((t) => closeTab(t.id));
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
  };
}
