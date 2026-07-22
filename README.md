<div align="center">

# mdpeek

**A tiny but mighty file viewer, Markdown editor, integrated PowerShell terminal, and collaboration tool for Windows.**

Render Markdown beautifully, view PDFs / code / images / CSV / Excalidraw,
edit with live preview, run PowerShell commands, present slideshows, sketch on PDFs, share a document
for real-time P2P editing, and manage a global Kanban board — all in a ~6 MB
package that installs in seconds.

[![Made with Tauri](https://img.shields.io/badge/made%20with-tauri%202-orange)](https://tauri.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Windows](https://img.shields.io/badge/platform-windows%2010%2F11-success)](https://github.com/sanketpatel32/Mdpeek/releases/latest)
[![Installer Size](https://img.shields.io/badge/installer-~6.2MB-green)](https://github.com/sanketpatel32/Mdpeek/releases/latest)
[![Tests](https://img.shields.io/badge/tests-292%20passing-brightgreen)](#-build)

Built with **Tauri 2 + vanilla JS**. Uses the system WebView2 (no bundled
Chromium), making it ~95% smaller than Electron-based viewers like MarkText
(~90 MB) or mdview (~70 MB).

[Features](#-features) · [Install](#-install) · [Shortcuts](#-keyboard-shortcuts) · [Build](#-build) · [Changelog](CHANGELOG.md)

</div>

---

## ✨ Features

### 💻 Integrated Modern PowerShell Terminal Drawer (v0.25.0)
- **Built-in PowerShell Console (`Ctrl+\``)** — toggleable bottom shell panel powered by native Windows PowerShell process execution.
- **Image & File Drag/Drop & Paste Support** — drag files or photos directly into the terminal or paste screenshots from the clipboard (`Ctrl+V`). Images are auto-saved to your workspace and inserted as quoted file paths into your CLI prompt.
- **Command History & Directory Auto-Sync** — navigate past commands with `↑`/`↓`, clear screen with `Ctrl+L`, and automatically sync working directory (`cd`) when switching document tabs.

### 📝 Markdown rendering & Editing
- **GitHub-flavored Markdown** — headings, tables, task lists, strikethrough, footnotes
- **Syntax highlighting & Code Actions** — 190+ languages (highlight.js) with "Copy code" and **"Save code block as file"** actions auto-detecting file extensions (`.js`, `.py`, `.rs`, `.json`, etc.)
- **Snippet & Template Picker (`Ctrl+Shift+S`)** — quick launcher to insert Markdown callouts (`[!NOTE]`, `[!TIP]`, `[!WARNING]`), 3x3 tables, task lists, code blocks, KaTeX math blocks, and meeting notes
- **Selection Word & Char Counter** — status bar live selection counter displaying `Selected: X w, Y c` alongside total word/character counts
- **Math** via KaTeX — `$inline$` and `$$block$$`
- **Mermaid diagrams** — flowcharts, sequence diagrams, gantt charts (lazy-loaded)
- **Alert callouts** — GitHub-style `> [!NOTE]` / `[!TIP]` / `[!WARNING]` / `[!CAUTION]` / `[!IMPORTANT]` blocks
- **Heading IDs + table of contents** — in-document anchors and a collapsible TOC sidebar
- **Live syntax highlighting in editor** — transparent-text overlay preserving native cursor, selection, IME, and spellcheck
- **Smart editing** — Tab/Shift+Tab indent, list continuation on `Enter`, auto-pair brackets/quotes, auto-close code fences
- **Typewriter mode** — `Ctrl+Shift+T` keeps the caret vertically centered
- **Unified find & replace** — `Ctrl+F` to find, `Ctrl+H` to replace across view, edit, and PDF modes

### 📁 Beyond Markdown
- **PDF viewer** — render `.pdf` files with text selection, in-document search, and a drawing toolbar (pen, highlighter, eraser)
- **Excalidraw** — full canvas embedding for `.excalidraw` sketches, theme-synced
- **Code & config files** — `.js`, `.ts`, `.py`, `.json`, `.css`, `.xml`, `.yml`, `.log`, `Dockerfile`, and 60+ more open as syntax-highlighted views **and can be edited** (`Ctrl+E`)
- **Plain text** — `.txt` files open in a full-width Notepad-style editor
- **CSV / TSV viewer** — render delimited files as a sortable, paginated table
- **Image viewer** — `.png`, `.jpg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`, `.avif` with zoom + fit-to-window

### 🎬 Presentation mode
- Turn any Markdown document into a **fullscreen slideshow** by splitting on `---`
- Two switchable styles: **Deck** (Keynote/PowerPoint vibe) and **Reading** (your app theme)
- Navigate with keyboard (`→` `Space` `PageDown` / `←` `PageUp` / `Home` `End`), on-screen arrows, or clicking left/right stage halves
- `F` toggles OS fullscreen, `S` switches style, `Esc` exits

### 👥 Live collaboration (P2P)
- **Real-time co-editing** over direct WebRTC connection — no accounts, no servers
- **Conflict-free** (powered by **Yjs** CRDT) — simultaneous co-editing at the same cursor
- **Serverless P2P** via **Trystero** + public BitTorrent trackers; all traffic is direct and DTLS-encrypted
- **Live cursors** — see collaborator carets + names in real time
- **Supports Markdown, code files, plain text, and Excalidraw canvases**
- Invite link format: `mdpeek://join?room=<16-char-id>`

### 🗂 File explorer & Explorer Context Menu
- **Built-in file tree** — open a folder and browse it in a sidebar (`Ctrl+Shift+E`)
- **Full file operations** via right-click context menu — Cut / Copy / Paste / Rename (F2) / Delete (Recycle Bin) / Search in folder…
- **Windows Explorer right-click integration** — right-click any file → "Open with mdpeek", any folder → "Open folder in mdpeek"
- **Back / Forward** navigation history (`Alt+Left` / `Alt+Right`)
- **Quick switcher** (`Ctrl+P`) — fuzzy-find recent files

### 📋 Global Kanban board
- Three columns (To do / In progress / Done), always one shortcut away (`Ctrl+Shift+K`)
- Pointer-event based drag-and-drop between columns

### ⚙️ Settings & Feature Flags (v0.24.1)
- **Opt-out Feature Flags Category** — enable or disable non-essential features anytime (*Live Collaboration*, *Kanban Board*, *Integrated Terminal*, *Presentation Slideshow*, *Markdown Snippets*, *Daily Notes*)
- **10 Themes** — Light, Dark, Solarized Light/Dark, Dracula, Nord, GitHub, GitHub Dark, Tokyo Night, Catppuccin
- **Lazy-rendered Changelog** — instant modal tab switching without startup overhead

---

## 📥 Install

### Option 1 — Terminal (one-liner)

Open **PowerShell** and paste:

```powershell
irm https://raw.githubusercontent.com/sanketpatel32/Mdpeek/main/install.ps1 | iex
```

Fetches the latest release, downloads the installer, and runs setup. Installs to `C:\Program Files\mdpeek\` with a Start Menu shortcut.

### Option 2 — Manual download

Download from the [Releases page](https://github.com/sanketpatel32/Mdpeek/releases/latest):

| File | Description |
| --- | --- |
| `mdpeek-*-setup.exe` | NSIS installer (recommended) |
| `mdpeek-*-portable.exe` | Standalone — no install, just run |

> Requires **Windows 10 or 11**. WebView2 ships with the OS.

---

## ⌨️ Keyboard shortcuts

> The full list is also available in-app via `Ctrl+Shift+P` and under **Settings → Shortcuts**.

### Global

| Action | Key |
| --- | --- |
| Toggle terminal drawer | `Ctrl+\`` |
| Snippet / template picker | `Ctrl+Shift+S` |
| Command palette | `Ctrl+Shift+P` |
| Quick switcher (recent files) | `Ctrl+P` |
| Open file | `Ctrl+O` |
| Open folder in explorer | `Ctrl+Shift+E` |
| Back / Forward | `Alt+Left` / `Alt+Right` |
| New tab | `Ctrl+N` |
| Close tab | `Ctrl+W` |
| Save | `Ctrl+S` |
| Toggle edit / view | `Ctrl+E` |
| Toggle sidebar (TOC) | `Ctrl+B` |
| Find / Find & Replace | `Ctrl+F` / `Ctrl+H` |
| Copy as rich text | `Ctrl+Shift+C` |
| Zoom in / out / reset | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Zoom (mouse) | `Ctrl+scroll` |
| Focus / Zen mode | `F11` |
| Typewriter mode | `Ctrl+Shift+T` |
| Kanban board | `Ctrl+Shift+K` |
| Exit focus / close find / close drawer | `Esc` |

---

## 🔧 Build

**Prerequisites:** [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/) stable, Windows 10/11.

```bash
git clone https://github.com/sanketpatel32/Mdpeek.git
cd Mdpeek
npm install            # install dependencies
npm test               # run unit tests (292 tests, Vitest)
npm run tauri dev      # launch in dev mode (hot reload)
npm run tauri:build    # build production installer -> releases/
npm run make-release   # sign + publish to GitHub Releases (maintainers)
```

---

## 📁 Project layout

```
src/
├── lib/
│   ├── renderer.js          MD → HTML pipeline (marked + DOMPurify + hljs + KaTeX + mermaid + save-code-btn)
│   ├── documents.js         DocumentStore + file-type classification (md/txt/pdf/excalidraw/code/csv/image)
│   ├── file-type.js         extension → kind mapping
│   ├── editor-logic.js      smart editing: indent, list continuation, auto-pair, Markdown shortcuts
│   ├── drawing.js           PDF annotation stroke geometry + hit-testing
│   ├── fuzzy.js             fuzzy matcher for command palette + quick switcher + folder search
│   └── persistence.js       localStorage session + recent-files wrapper
├── views/
│   ├── terminal.js          integrated PowerShell terminal drawer with image paste & drag-drop
│   ├── viewer.js            view mode: render + table of contents
│   ├── editor.js            edit mode: split textarea + live preview + syntax overlay
│   ├── tabs.js              tab strip renderer (with pinned tabs)
│   ├── find-bar.js          unified find & replace (view / edit / PDF modes)
│   ├── pdf-viewer.js        PDF rendering + annotations (pdf.js)
│   ├── excalidraw-viewer.js Excalidraw canvas integration (React, lazy-loaded)
│   ├── csv-viewer.js        CSV/TSV → sortable table
│   ├── image-viewer.js      image zoom + fit-to-window
│   ├── file-tree.js         folder browser sidebar with context menu
│   ├── folder-search.js     grep across a folder with fuzzy match mode
│   └── command-palette.js   Ctrl+Shift+P launcher + Ctrl+P quick switcher + Ctrl+Shift+S snippet picker
├── collab.js                Yjs + Trystero P2P collaboration (text + Excalidraw)
├── main.js                  app wiring: tabs, shortcuts, IPC, drag-drop, auto-update, Kanban, terminal, settings
└── styles/                  themes.css (10 themes), base.css (layout + terminal), content.css (markdown)

src-tauri/
├── src/
│   ├── lib.rs               app entry + single-instance + tray + updater + window events
│   ├── commands.rs          IPC: open/save/run_shell_command/save-as-html/read_file/delete_path/rename_path
│   └── watcher.rs           file-change watcher (notify crate)
└── capabilities/            Tauri permission scopes
```

---

## 📜 License

[MIT](LICENSE) © Sanket Patel
