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

  let currentCwd = null;
  let commandHistory = [];
  let historyIndex = -1;
  let isExecuting = false;

  function getWorkingDir() {
    return currentCwd || cwdProvider() || '.';
  }

  function updatePwdDisplay() {
    const dir = getWorkingDir();
    if (pwdEl) pwdEl.textContent = `PS ${dir}`;
  }

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

  async function execute(cmdStr) {
    const trimmed = cmdStr.trim();
    if (!trimmed || isExecuting) return;
    isExecuting = true;

    if (input) input.value = '';
    commandHistory.push(trimmed);
    historyIndex = commandHistory.length;

    // Local clear command
    if (trimmed.toLowerCase() === 'cls' || trimmed.toLowerCase() === 'clear') {
      clear();
      isExecuting = false;
      return;
    }

    // Local cd command
    if (trimmed.toLowerCase().startsWith('cd ')) {
      const targetDir = trimmed.substring(3).trim().replace(/^['"]|['"]$/g, '');
      const baseDir = getWorkingDir();
      const newPath = targetDir.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(targetDir)
        ? targetDir
        : `${baseDir}/${targetDir}`;

      try {
        const res = await invoke('run_shell_command', {
          command: `Set-Location "${newPath}"; Get-Location | Select-Object -ExpandProperty Path`,
          cwd: baseDir,
        });
        if (res.exit_code === 0 && res.stdout.trim()) {
          currentCwd = res.stdout.trim();
          updatePwdDisplay();
          appendEntry(trimmed, '', '', 0, currentCwd);
        } else {
          appendEntry(trimmed, '', res.stderr || 'Directory not found', res.exit_code, baseDir);
        }
      } catch (err) {
        appendEntry(trimmed, '', String(err), -1, baseDir);
      }
      isExecuting = false;
      return;
    }

    const runCwd = getWorkingDir();
    try {
      const res = await invoke('run_shell_command', {
        command: trimmed,
        cwd: runCwd,
      });
      appendEntry(trimmed, res.stdout, res.stderr, res.exit_code, res.cwd || runCwd);
      if (res.cwd) {
        currentCwd = res.cwd;
        updatePwdDisplay();
      }
    } catch (err) {
      appendEntry(trimmed, '', String(err), -1, runCwd);
    } finally {
      isExecuting = false;
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
        if (historyIndex > 0) {
          historyIndex--;
          input.value = commandHistory[historyIndex] || '';
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex < commandHistory.length - 1) {
          historyIndex++;
          input.value = commandHistory[historyIndex] || '';
        } else {
          historyIndex = commandHistory.length;
          input.value = '';
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
