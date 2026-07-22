// Integrated Terminal Drawer module (v0.25.0)
// Provides a modern PowerShell terminal with command history, image/file paste & drag-and-drop support.

import { invoke } from '@tauri-apps/api/core';

export function initTerminal({ cwdProvider, onToast }) {
  const drawer = document.getElementById('terminal-drawer');
  const body = document.getElementById('terminal-body');
  const historyEl = document.getElementById('terminal-history');
  const input = document.getElementById('terminal-input');
  const pwdEl = document.getElementById('terminal-pwd');
  const clearBtn = document.getElementById('terminal-clear-btn');
  const closeBtn = document.getElementById('terminal-close-btn');
  const tabsEl = document.getElementById('terminal-tabs');
  const newTabBtn = document.getElementById('terminal-new-tab');

  let tabs = [];
  let activeTabId = null;
  let tabIdCounter = 1;

  function createTab(name) {
    const id = `term-${tabIdCounter++}`;
    const initialCwd = cwdProvider() || '.';
    const tab = {
      id,
      name: name || `Terminal ${tabIdCounter - 1}`,
      cwd: initialCwd,
      historyHtml: '',
      commandHistory: [],
      historyIndex: -1,
      isExecuting: false,
    };
    tabs.push(tab);
    switchTab(id);
    renderTabs();
    return tab;
  }

  function switchTab(id) {
    const active = getActiveTab();
    if (active) {
      active.historyHtml = historyEl ? historyEl.innerHTML : '';
    }
    activeTabId = id;
    const nextActive = getActiveTab();
    if (nextActive && historyEl) {
      historyEl.innerHTML = nextActive.historyHtml;
      updatePwdDisplay();
      if (input) {
        input.value = '';
        input.focus();
      }
    }
    renderTabs();
  }

  function closeTab(id, e) {
    if (e) e.stopPropagation();
    if (tabs.length <= 1) {
      // Keep at least one tab open
      const tab = tabs[0];
      tab.historyHtml = '';
      tab.commandHistory = [];
      tab.historyIndex = -1;
      if (historyEl) historyEl.innerHTML = '';
      updatePwdDisplay();
      renderTabs();
      return;
    }
    const idx = tabs.findIndex((t) => t.id === id);
    tabs = tabs.filter((t) => t.id !== id);
    if (activeTabId === id) {
      const nextTab = tabs[Math.max(0, idx - 1)];
      activeTabId = nextTab.id;
      if (historyEl) historyEl.innerHTML = nextTab.historyHtml;
      updatePwdDisplay();
    }
    renderTabs();
  }

  function getActiveTab() {
    return tabs.find((t) => t.id === activeTabId) || tabs[0];
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

  function getWorkingDir() {
    const tab = getActiveTab();
    return (tab && tab.cwd) || cwdProvider() || '.';
  }

  function updatePwdDisplay() {
    const dir = getWorkingDir();
    if (pwdEl) pwdEl.textContent = `PS ${dir}`;
  }

  // Init first tab
  createTab('Terminal 1');

  function open() {
    if (!drawer) return;
    drawer.classList.remove('hidden');
    updatePwdDisplay();
    setTimeout(() => {
      if (input) input.focus();
    }, 50);
  }

  function close() {
    if (!drawer) return;
    drawer.classList.add('hidden');
  }

  function toggle() {
    if (!drawer) return;
    if (drawer.classList.contains('hidden')) open();
    else close();
  }

  function clear() {
    if (historyEl) historyEl.innerHTML = '';
  }

  function appendEntry(cmd, stdout, stderr, exitCode, cwd) {
    if (!historyEl) return;
    const entry = document.createElement('div');
    entry.className = 'terminal-entry';

    const cmdLine = document.createElement('div');
    cmdLine.className = 'terminal-cmd-line';
    cmdLine.innerHTML = `<span>PS ${escapeHtml(cwd || getWorkingDir())}&gt;</span> <span>${escapeHtml(cmd)}</span>`;
    entry.appendChild(cmdLine);

    if (stdout && stdout.trim()) {
      const out = document.createElement('div');
      out.className = 'terminal-output';
      out.textContent = stdout;
      entry.appendChild(out);
    }
    if (stderr && stderr.trim()) {
      const err = document.createElement('div');
      err.className = `terminal-output ${exitCode !== 0 ? 'error' : ''}`;
      err.textContent = stderr;
      entry.appendChild(err);
    }

    historyEl.appendChild(entry);
    body.scrollTop = body.scrollHeight;
  }

    if (newTabBtn) {
    newTabBtn.addEventListener('click', () => createTab());
  }

  async function execute(cmdStr) {
    const trimmed = cmdStr.trim();
    const active = getActiveTab();
    if (!trimmed || (active && active.isExecuting)) return;
    if (active) active.isExecuting = true;

    if (input) input.value = '';
    if (active) {
      active.commandHistory.push(trimmed);
      active.historyIndex = active.commandHistory.length;
    }

    // Local clear command
    if (trimmed.toLowerCase() === 'cls' || trimmed.toLowerCase() === 'clear') {
      clear();
      if (active) active.isExecuting = false;
      return;
    }

    // Local cd command
    if (trimmed.toLowerCase().startsWith('cd') || trimmed.toLowerCase().startsWith('cd ') || trimmed.toLowerCase().startsWith('cd..')) {
      let targetDir = trimmed.replace(/^cd\s*/i, '').trim().replace(/^['"]|['"]$/g, '');
      if (!targetDir) targetDir = '.';
      const baseDir = getWorkingDir();

      try {
        const res = await invoke('run_shell_command', {
          command: `cd /d "${targetDir}" && cd`,
          cwd: baseDir,
        });
        if (res.exit_code === 0 && res.stdout.trim()) {
          const resolvedPath = res.stdout.trim().split('\r\n').pop().trim();
          if (active) active.cwd = resolvedPath;
          updatePwdDisplay();
          appendEntry(trimmed, '', '', 0, resolvedPath);
        } else {
          appendEntry(trimmed, '', res.stderr || 'The system cannot find the path specified.', res.exit_code, baseDir);
        }
      } catch (err) {
        appendEntry(trimmed, '', String(err), -1, baseDir);
      }
      if (active) active.isExecuting = false;
      return;
    }

    const runCwd = getWorkingDir();
    try {
      const res = await invoke('run_shell_command', {
        command: trimmed,
        cwd: runCwd,
      });
      appendEntry(trimmed, res.stdout, res.stderr, res.exit_code, res.cwd || runCwd);
      if (res.cwd && active) {
        active.cwd = res.cwd;
        updatePwdDisplay();
      }
    } catch (err) {
      appendEntry(trimmed, '', String(err), -1, runCwd);
    } finally {
      if (active) active.isExecuting = false;
    }
  }

  // Handle Drag & Drop of files/photos into terminal
  if (drawer) {
    drawer.addEventListener('dragover', (e) => {
      e.preventDefault();
      drawer.classList.add('dragover');
    });
    drawer.addEventListener('dragleave', () => {
      drawer.classList.remove('dragover');
    });
    drawer.addEventListener('drop', (e) => {
      e.preventDefault();
      drawer.classList.remove('dragover');
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0) {
        const paths = files.map((f) => `"${f.path || f.name}"`).join(' ');
        if (input) {
          input.value += (input.value ? ' ' : '') + paths;
          input.focus();
        }
      }
    });
  }

  // Resizable Terminal Drawer height handler
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

  // Handle Paste of images and file items
  if (input) {
    input.addEventListener('paste', async (e) => {
      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      const items = Array.from(clipboardData.items || []);
      const imageItem = items.find((it) => it.type.startsWith('image/'));

      if (imageItem) {
        e.preventDefault();
        const file = imageItem.getAsFile();
        if (file) {
          try {
            const buffer = await file.arrayBuffer();
            const bytes = Array.from(new Uint8Array(buffer));
            const filename = `terminal-pasted-${Date.now()}.png`;
            const runCwd = getWorkingDir();
            const relativePath = await invoke('save_image', {
              dir: runCwd,
              filename,
              bytes,
            });
            const fullPastedPath = `"${runCwd}/${relativePath}"`;
            input.value += (input.value ? ' ' : '') + fullPastedPath;
            if (onToast) onToast(`Image pasted: ${filename}`);
          } catch (err) {
            if (onToast) onToast('Failed to paste image: ' + String(err));
          }
        }
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        execute(input.value);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const active = getActiveTab();
        if (active && active.historyIndex > 0) {
          active.historyIndex--;
          input.value = active.commandHistory[active.historyIndex] || '';
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const active = getActiveTab();
        if (active) {
          if (active.historyIndex < active.commandHistory.length - 1) {
            active.historyIndex++;
            input.value = active.commandHistory[active.historyIndex] || '';
          } else {
            active.historyIndex = active.commandHistory.length;
            input.value = '';
          }
        }
      } else if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        clear();
      }
    });
  }

  if (clearBtn) clearBtn.addEventListener('click', clear);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (body) body.addEventListener('click', () => input && input.focus());

  return { open, close, toggle, clear, execute };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
