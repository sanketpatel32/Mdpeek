<div align="center">

# mdpeek

**A lightweight Markdown viewer + editor for Windows.**

Render Markdown beautifully, edit with live preview, and manage multiple files
in tabs — all in a tiny package that installs in seconds.

[![Made with Tauri](https://img.shields.io/badge/made%20with-tauri%202-orange)](https://tauri.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Windows](https://img.shields.io/badge/platform-windows%2010%2F11-success)](https://github.com/sanketpatel32/Mdpeek/releases/latest)
[![Installer Size](https://img.shields.io/badge/installer-~5.5MB-green)](https://github.com/sanketpatel32/Mdpeek/releases/latest)

Built with **Tauri 2 + vanilla JS**. Uses the system WebView2 (no bundled
Chromium), making it ~95% smaller than Electron-based viewers like MarkText
(~90 MB) or mdview (~70 MB).

[Features](#-features) · [Install](#-install) · [Shortcuts](#-keyboard-shortcuts) · [Build](#-build) · [Changelog](CHANGELOG.md)

</div>

---

## ✨ Features

### Rendering
- **GitHub-flavored Markdown** — headings, tables, task lists, strikethrough
- **Syntax highlighting** for 190+ languages (highlight.js)
- **Copy button** on every fenced code block — hover to reveal, one click to copy
- **Math** via KaTeX — `$inline$` and `$$block$$`
- **Mermaid diagrams** — flowcharts, sequence diagrams, gantt charts
- **Sanitized output** (DOMPurify) — safe to open untrusted files

### Editing
- **Live preview** — split-pane editor with debounced re-render (`Ctrl+E`)
- **Plain-text mode** — `.txt` files open in a full-width editor with no preview
  (Notepad-style); markdown files keep the split view
- **Line numbers** — synced gutter on the source pane
- **Smart editing** — Tab/Shift+Tab indent, list continuation on `Enter`,
  auto-pair brackets/quotes, auto-close code fences
- **Markdown shortcuts** — `Ctrl+B` / `Ctrl+I` / `` Ctrl+` `` for bold / italic / code
- **Find** — `Ctrl+F` with match count and next/prev navigation
- **Auto-save** indicator (●) with unsaved-changes confirmation
- **Live reload** — file changes on disk update automatically

### Multi-tab workflow
- **Multiple tabs** in one window — open many files at once
- **Session restore** — reopen the app and your tabs come back
- **Drag-and-drop** one or more `.md` files to open them as tabs
- **Single-instance** — double-clicking a file when mdpeek is running opens it
  as a new tab in the existing window (not a new process)
- **New blank tab** — `Ctrl+N` for a scratch document

### System integration
- **Installs to** `C:\Program Files\mdpeek\` (like VS Code)
- **File associations** — `.md`, `.markdown`, `.mdx`, `.txt` appear in Windows "Open with"
- **Auto-update** — checks GitHub for new versions on launch; one-click install
- **Terminal install** — one PowerShell command, no manual download

### UI
- **Light / dark theme** with smooth transitions
- **Collapsible sidebar** (table of contents)
- **Zoom** — `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, persists across launches
- **Welcome screen** on fresh launch with quick-start hints

---

## 📥 Install

### Option 1 — Terminal (one-liner)

Open **PowerShell** and paste:

```powershell
irm https://raw.githubusercontent.com/sanketpatel32/Mdpeek/main/install.ps1 | iex
```

Fetches the latest release, downloads the installer, and runs it (UAC prompt →
setup wizard). Installs to `C:\Program Files\mdpeek\` with a Start Menu shortcut.

### Option 2 — Manual download

Download from the [Releases page](https://github.com/sanketpatel32/Mdpeek/releases/latest):

| File | Description |
| --- | --- |
| `mdpeek-*-setup.exe` | NSIS installer (recommended) |
| `mdpeek-*-portable.exe` | Standalone — no install, just run |

> Requires **Windows 10 or 11**. WebView2 ships with the OS.

### After install

- **Start Menu** → mdpeek
- **Right-click any `.md` → Open with → mdpeek** (or set as default)
- Updates check automatically on each launch

---

## ⌨️ Keyboard shortcuts

| Action | Key |
| --- | --- |
| Open file | `Ctrl+O` |
| New tab | `Ctrl+N` |
| Close tab | `Ctrl+W` |
| Save | `Ctrl+S` |
| Toggle edit / view | `Ctrl+E` |
| Toggle sidebar | `Ctrl+B` |
| Zoom in / out / reset | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Toggle theme | toolbar ☀/☾ |

**Edit mode only:**

| Action | Key |
| --- | --- |
| Bold | `Ctrl+B` (wraps selection in `**`) |
| Italic | `Ctrl+I` (wraps selection in `*`) |
| Inline code | `` Ctrl+` `` (wraps selection in `` ` ``) |
| Find | `Ctrl+F` (Enter / Shift+Enter = next / prev, Esc closes) |
| Indent / outdent | `Tab` / `Shift+Tab` (2 spaces; indents selected lines) |
| List continuation | `Enter` on a `- item` / `1. item` line |
| Close code fence | `Enter` after an unclosed ` ``` ` line |

> Note: `Ctrl+B` is **bold** while the editor is focused and **sidebar toggle**
> while viewing — the editor captures it so both can share the same chord.

---

## 🔧 Build

**Prerequisites:** [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/) stable, Windows 10/11.

```bash
git clone https://github.com/sanketpatel32/Mdpeek.git
cd Mdpeek
npm install            # install dependencies
npm test               # run unit tests (29 tests, Vitest)
npm run tauri dev      # launch in dev mode (hot reload)
npm run tauri:build    # build production installer -> releases/
npm run make-release   # sign + publish to GitHub Releases (maintainers)
```

### Releasing a new version

```bash
# 1. Bump version in package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml
# 2. Build + copy artifacts
npm run tauri:build
# 3. Sign the installer + generate latest.json + upload to GitHub
npm run make-release
# 4. Commit, tag, push
git tag v0.1.5 && git push origin main --tags
```

Existing installs auto-detect the new version within 3 seconds of launch.

---

## 📁 Project layout

```
src/
├── lib/
│   ├── renderer.js       MD → HTML pipeline (marked + DOMPurify + hljs + KaTeX + mermaid)
│   ├── documents.js      DocumentStore — multi-tab state (pure logic, unit-tested)
│   └── persistence.js    localStorage session wrapper
├── views/
│   ├── viewer.js         view mode: render + table of contents
│   ├── editor.js         edit mode: split textarea + live preview
│   └── tabs.js           tab strip renderer
├── main.js               app wiring: tabs, shortcuts, IPC, drag-drop, auto-update
└── styles/               themes.css (tokens), base.css (layout), content.css (markdown)

src-tauri/
├── src/
│   ├── lib.rs            app entry + single-instance + updater plugin
│   ├── commands.rs       IPC: open/save/read_file
│   └── watcher.rs        file-change watcher (notify crate)
├── nsis/file-assoc.nsh   NSIS hook: registers .md Open With entries
└── capabilities/         Tauri permission scopes

scripts/
├── copy-release.js       postbuild: copies installer + portable to releases/
└── make-release.js       signs installer, generates latest.json, uploads to GitHub

test/                     Vitest unit tests + fixtures (29 tests)
install.ps1               PowerShell one-liner installer
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
[CHANGELOG.md](CHANGELOG.md) for the full release history.

---

## 📜 License

[MIT](LICENSE) © Sanket Patel
