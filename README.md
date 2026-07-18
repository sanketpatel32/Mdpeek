<div align="center">

# mdpeek

**A lightweight file viewer + Markdown editor for Windows.**

Render Markdown beautifully, view PDFs and code, sketch with Excalidraw, edit
with live preview, and manage everything in tabs — all in a tiny package that
installs in seconds.

[![Made with Tauri](https://img.shields.io/badge/made%20with-tauri%202-orange)](https://tauri.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Windows](https://img.shields.io/badge/platform-windows%2010%2F11-success)](https://github.com/sanketpatel32/Mdpeek/releases/latest)
[![Installer Size](https://img.shields.io/badge/installer-~6MB-green)](https://github.com/sanketpatel32/Mdpeek/releases/latest)

Built with **Tauri 2 + vanilla JS**. Uses the system WebView2 (no bundled
Chromium), making it ~95% smaller than Electron-based viewers like MarkText
(~90 MB) or mdview (~70 MB).

[Features](#-features) · [Install](#-install) · [Shortcuts](#-keyboard-shortcuts) · [Build](#-build) · [Changelog](CHANGELOG.md)

</div>

---

## ✨ Features

### Markdown rendering
- **GitHub-flavored Markdown** — headings, tables, task lists, strikethrough, footnotes
- **Syntax highlighting** for 190+ languages (highlight.js) with a copy button on every code block
- **Math** via KaTeX — `$inline$` and `$$block$$`
- **Mermaid diagrams** — flowcharts, sequence diagrams, gantt charts (lazy-loaded)
- **Alert callouts** — GitHub-style `> [!NOTE]` / `[!TIP]` / `[!WARNING]` blocks
- **Heading IDs + table of contents** — in-document anchors and a collapsible TOC sidebar
- **Sanitized output** (DOMPurify) — safe to open untrusted files

### Beyond Markdown
- **PDF viewer** — render `.pdf` files with text selection, in-document search, and a drawing toolbar (pen, highlighter, eraser)
- **Excalidraw** — full canvas embedding for `.excalidraw` sketches, theme-synced
- **Code & config files** — `.js`, `.ts`, `.py`, `.json`, `.css`, `.xml`, `.yml`, `.log`, `Dockerfile`, and 60+ more open as read-only syntax-highlighted views
- **Plain text** — `.txt` files open in a full-width Notepad-style editor

### Editing
- **Live preview** — split-pane editor with debounced re-render (`Ctrl+E`)
- **Word count + reading time** — a status bar shows word/char counts and estimated read time, updating live
- **Line numbers** — synced gutter on the source pane (toggleable)
- **Smart editing** — Tab/Shift+Tab indent, list continuation on `Enter`, auto-pair brackets/quotes, auto-close code fences
- **Markdown shortcuts** — `Ctrl+B` / `Ctrl+I` / `` Ctrl+` `` for bold / italic / code
- **Unified find** — `Ctrl+F` searches across view, edit, and PDF modes
- **Auto-save** indicator (●) with unsaved-changes confirmation
- **Live reload** — file changes on disk update automatically

### Export & sharing
- **Export to HTML** — one click bundles the rendered Markdown + your theme's CSS + syntax colors into a self-contained `.html` file that works fully offline

### Multi-tab workflow
- **Multiple tabs** in one window — open many files at once, each typed (Markdown / PDF / Excalidraw / code)
- **Recent files** — the welcome screen lists your last 10 opened files for one-click reopening
- **Session restore** — reopen the app and your tabs come back
- **Drag-and-drop** — drop any text/code/Markdown/PDF file onto the window to open it
- **Single-instance** — double-clicking a file when mdpeek is running opens it as a new tab in the existing window

### Appearance
- **10 themes** — Light, Dark, Solarized Light/Dark, Dracula, Nord, GitHub, GitHub Dark, Tokyo Night, Catppuccin
- **Reading comfort controls** — font family (8 stacks), font size, line spacing
- **Focus / Zen mode** — `F11` hides the header + sidebar for distraction-free reading
- **Zoom** — `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, `Ctrl+scroll`, or the toolbar zoom widget; persists across launches

### System integration
- **Installs to** `C:\Program Files\mdpeek\` (like VS Code)
- **File associations** — `.md`, `.markdown`, `.mdx`, `.txt`, `.pdf`, `.excalidraw` appear in Windows "Open with"
- **System tray** — minimize to tray on close (configurable: ask / always tray / always quit)
- **Custom window controls** — bespoke titlebar with min/max/close
- **Auto-update** — checks GitHub for new versions on launch; one-click install
- **Terminal install** — one PowerShell command, no manual download

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

> The full list is also available in-app under **Settings → Help**.

### Global

| Action | Key |
| --- | --- |
| Open file | `Ctrl+O` |
| New tab | `Ctrl+N` |
| Close tab | `Ctrl+W` |
| Save | `Ctrl+S` |
| Toggle edit / view | `Ctrl+E` |
| Toggle sidebar (TOC) | `Ctrl+B` |
| Find | `Ctrl+F` |
| Find next / previous | `Ctrl+G` / `Shift+Ctrl+G` (or `F3` / `Shift+F3`) |
| Zoom in / out / reset | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Zoom (mouse) | `Ctrl+scroll` |
| Focus / Zen mode | `F11` |
| Exit focus / close find | `Esc` |

### Edit mode only

| Action | Key |
| --- | --- |
| Bold | `Ctrl+B` (wraps selection in `**`) |
| Italic | `Ctrl+I` (wraps selection in `*`) |
| Inline code | `` Ctrl+` `` (wraps selection in `` ` ``) |
| Indent / outdent | `Tab` / `Shift+Tab` (2 spaces; indents selected lines) |
| List continuation | `Enter` on a `- item` / `1. item` line |
| Close code fence | `Enter` after an unclosed ` ``` ` line |

> Note: `Ctrl+B` is **bold** while the editor is focused and **sidebar toggle**
> while viewing — the editor captures it so both can share the same chord.

---

## ⚙️ Settings

Open with the toolbar gear icon. Four categories:

- **General** — new tab format (Home / Markdown / Plain Text / Excalidraw), new tab opens in (View / Edit), close-button action
- **Appearance** — theme (10 options), font size, line spacing, font family
- **Editor** — line numbers, find match-case default
- **Help** — the full keyboard-shortcut reference + usage tips

---

## 🔧 Build

**Prerequisites:** [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/) stable, Windows 10/11.

```bash
git clone https://github.com/sanketpatel32/Mdpeek.git
cd Mdpeek
npm install            # install dependencies
npm test               # run unit tests (99 tests, Vitest)
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
git tag v0.11.0 && git push origin main --tags
```

Existing installs auto-detect the new version within 3 seconds of launch.

---

## 📁 Project layout

```
src/
├── lib/
│   ├── renderer.js       MD → HTML pipeline (marked + DOMPurify + hljs + KaTeX + mermaid)
│   ├── documents.js      DocumentStore + file-type classification (md/txt/pdf/excalidraw/code)
│   ├── persistence.js    localStorage session + recent-files wrapper
│   └── escape.js         shared HTML escaping
├── views/
│   ├── viewer.js         view mode: render + table of contents
│   ├── editor.js         edit mode: split textarea + live preview
│   ├── tabs.js           tab strip renderer
│   ├── find-bar.js       unified find (view / edit / PDF modes)
│   ├── pdf-viewer.js     PDF rendering + annotations (pdf.js)
│   └── excalidraw-viewer.js  Excalidraw canvas integration (React, lazy-loaded)
├── main.js               app wiring: tabs, shortcuts, IPC, drag-drop, auto-update
└── styles/               themes.css (10 themes), base.css (layout), content.css (markdown)

src-tauri/
├── src/
│   ├── lib.rs            app entry + single-instance + tray + updater
│   ├── commands.rs       IPC: open/save/save-as-html/read_file
│   └── watcher.rs        file-change watcher (notify crate)
├── nsis/file-assoc.nsh   NSIS hook: registers Open With entries
└── capabilities/         Tauri permission scopes

scripts/
├── copy-release.js       postbuild: copies installer + portable to releases/
└── make-release.js       signs installer, generates latest.json, uploads to GitHub

test/                     Vitest unit tests (99 tests)
install.ps1               PowerShell one-liner installer
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
[CHANGELOG.md](CHANGELOG.md) for the full release history.

---

## 📜 License

[MIT](LICENSE) © Sanket Patel
