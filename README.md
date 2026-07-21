<div align="center">

# mdpeek

**A tiny but mighty file viewer, Markdown editor, and collaboration tool for Windows.**

Render Markdown beautifully, view PDFs / code / images / CSV / Excalidraw,
edit with live preview, present slideshows, sketch on PDFs, share a document
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
- **Code & config files** — `.js`, `.ts`, `.py`, `.json`, `.css`, `.xml`, `.yml`, `.log`, `Dockerfile`, and 60+ more open as syntax-highlighted views **and can be edited** (`Ctrl+E`)
- **Plain text** — `.txt` files open in a full-width Notepad-style editor
- **CSV / TSV viewer** — render delimited files as a sortable, paginated table
- **Image viewer** — `.png`, `.jpg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`, `.avif` with zoom + fit-to-window

### Editing
- **Live syntax highlighting in the editor** — code and Markdown get colored as you type via a transparent-text overlay (the textarea stays native: caret, selection, IME, spellcheck all work)
- **Live preview** — split-pane editor with debounced re-render (`Ctrl+E`)
- **Word count + reading time** — a status bar shows word/char counts and estimated read time, updating live
- **Line numbers** — synced gutter on the source pane (wrap-aware, never drifts on long lines)
- **Active-line highlight** — the line your caret is on gets a subtle background tint
- **Smart editing** — Tab/Shift+Tab indent, list continuation on `Enter`, auto-pair brackets/quotes, auto-close code fences
- **Markdown shortcuts** — `Ctrl+B` / `Ctrl+I` / `` Ctrl+` `` for bold / italic / code
- **Typewriter mode** — `Ctrl+Shift+T` keeps the caret vertically centered
- **Unified find & replace** — `Ctrl+F` to find, `Ctrl+H` to replace; works across view, edit, and PDF modes
- **Copy as rich text** — `Ctrl+Shift+C` copies the rendered HTML (paste into Word / Gmail / Slack with formatting intact)
- **Auto-save** indicator (●) with unsaved-changes confirmation
- **Live reload** — file changes on disk update automatically

### 🎬 Presentation mode
- Turn any Markdown document into a **fullscreen slideshow** by splitting on `---`
- Two switchable styles: **Deck** (Keynote/PowerPoint vibe) and **Reading** (your app theme)
- Navigate with keyboard (`→` `Space` `PageDown` / `←` `PageUp` / `Home` `End`), on-screen arrows, or by clicking the left/right half of the stage
- `F` toggles OS fullscreen, `S` switches style, `Esc` exits

### 👥 Live collaboration (P2P)
- **Real-time co-editing** over a direct WebRTC connection — no accounts, no servers, no setup beyond sharing a link
- **Conflict-free** (powered by **Yjs** CRDT) — both of you can type at the same cursor at the same time
- **Serverless P2P** via **Trystero** + public BitTorrent trackers as rendezvous; all traffic is direct between machines and DTLS-encrypted
- **Live cursors** — see your collaborator's caret + name in real time
- **Works on Markdown, plain text, code files, and Excalidraw canvases**
- **Host owns the file** — host's `Ctrl+S` writes to disk; receiver's tab is a transient shared view they can "Save as…"
- Invite link format: `mdpeek://join?room=<16-char-id>` (clicking opens mdpeek and prompts to join)
- Status pill in the header shows `Live · N peers`; click to reopen the share panel

### 🗂 File explorer & navigation
- **Built-in file tree** — open a folder and browse it in a sidebar (`Ctrl+Shift+E`); available in both view and edit modes
- **Full file operations** via right-click context menu — Cut / Copy / Paste / Rename (F2) / Delete (Del, sends to Recycle Bin) / Search in folder…
- **Top-level Windows Explorer integration** — right-click any file → "Open with mdpeek", any folder → "Open folder in mdpeek"
- **Back / Forward** navigation history (`Alt+Left` / `Alt+Right`)
- **Quick switcher** (`Ctrl+P`) — fuzzy-find recent files
- **Folder-wide search** — grep across an entire folder with a fuzzy match mode
- **Daily notes** — one click (or the calendar button) opens or creates `YYYY-MM-DD.md` in your chosen notes folder

### 📋 Global Kanban board
- Three columns (To do / In progress / Done), always one shortcut away (`Ctrl+Shift+K`)
- Tasks live globally (not per-document) in `localStorage` and survive app restarts
- New tasks added to **To do only** — move them by dragging
- **Drag-and-drop between columns** (pointer-event based — works reliably in the desktop build)
- Full-page view replaces the app while open; `Esc` closes

### 🎨 Multi-tab workflow
- **Multiple tabs** in one window — open many files at once, each typed (Markdown / PDF / Excalidraw / code / CSV / image)
- **Pinnable tabs** — pin frequently-used files to the tab strip
- **Recent files** — the welcome screen lists your last 10 opened files
- **Session restore** — reopen the app and your tabs come back
- **Drag-and-drop** — drop any supported file onto the window to open it
- **Single-instance** — double-clicking a file when mdpeek is running opens it as a new tab in the existing window

### ⌨️ Command palette
- `Ctrl+Shift+P` opens a fuzzy command launcher for every action in the app
- Also a quick file switcher (`Ctrl+P`)

### 🎨 Appearance
- **10 themes** — Light, Dark, Solarized Light/Dark, Dracula, Nord, GitHub, GitHub Dark, Tokyo Night, Catppuccin
- **Reading comfort controls** — font family (8 stacks), font size, line spacing
- **Focus / Zen mode** — `F11` hides the header + sidebars for distraction-free reading
- **Zoom** — `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, `Ctrl+scroll`, or the toolbar zoom widget; persists across launches

### Export & sharing
- **Export to HTML** — one click bundles the rendered Markdown + your theme's CSS + syntax colors into a self-contained `.html` file that works fully offline
- **Export to PDF** — print-quality PDF export via the browser print pipeline
- **Copy as rich text** (`Ctrl+Shift+C`) for pasting into chat apps

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

> The full list is also available in-app via `Ctrl+Shift+P` and under **Settings → Shortcuts**.

### Global

| Action | Key |
| --- | --- |
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
| Find next / previous | `Ctrl+G` / `Shift+Ctrl+G` (or `F3` / `Shift+F3`) |
| Copy as rich text | `Ctrl+Shift+C` |
| Zoom in / out / reset | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Zoom (mouse) | `Ctrl+scroll` |
| Focus / Zen mode | `F11` |
| Typewriter mode | `Ctrl+Shift+T` |
| Kanban board | `Ctrl+Shift+K` |
| Daily note | (toolbar calendar button) |
| Exit focus / close find / close Kanban | `Esc` |

### Presentation mode (Markdown only)

| Action | Key |
| --- | --- |
| Next slide | `→` / `↓` / `PageDown` / `Space` |
| Previous slide | `←` / `↑` / `PageUp` |
| First / last slide | `Home` / `End` |
| Toggle OS fullscreen | `F` |
| Switch style (Deck ↔ Reading) | `S` |
| Exit presentation | `Esc` |

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

Open with the toolbar gear icon. Seven categories:

- **General** — new tab format (Home / Markdown / Plain Text / Excalidraw), new tab opens in (View / Edit), close-button action, daily-notes folder
- **Appearance** — theme (10 options), font size, line spacing, font family
- **Editor** — line numbers, syntax highlighting in editor, find match-case default, typewriter mode
- **Shortcuts** — the full keyboard-shortcut reference
- **Tips** — usage tips for image annotation, CSV viewing, folder-wide search, pinnable tabs
- **Changelog** — recent release notes, in-app
- **About** — version, links to GitHub source + issue tracker

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

### Releasing a new version

```bash
# 1. Bump version in package.json + src-tauri/tauri.conf.json
# 2. Add an entry to CHANGELOG.md under [Unreleased] -> move to [vX.Y.Z]
# 3. Build + copy artifacts
npm run tauri:build
# 4. Commit, tag, push
git commit -m "vX.Y.Z: ..."
git tag vX.Y.Z && git push origin main --tags
# 5. Create the GitHub Release (gh release create vX.Y.Z --title vX.Y.Z --notes ...)
# 6. Sign the installer + generate latest.json + upload to the release
npm run make-release
```

Existing installs auto-detect the new version within 3 seconds of launch.

---

## 📁 Project layout

```
src/
├── lib/
│   ├── renderer.js          MD → HTML pipeline (marked + DOMPurify + hljs + KaTeX + mermaid)
│   ├── documents.js         DocumentStore + file-type classification (md/txt/pdf/excalidraw/code/csv/image)
│   ├── file-type.js         extension → kind mapping
│   ├── editor-logic.js      smart editing: indent, list continuation, auto-pair, Markdown shortcuts
│   ├── drawing.js           PDF annotation stroke geometry + hit-testing
│   ├── fuzzy.js             fuzzy matcher for command palette + quick switcher + folder search
│   ├── nav-history.js       back/forward navigation stack
│   ├── persistence.js       localStorage session + recent-files wrapper
│   ├── language-icons.js    per-language SVG icons for tabs + file tree
│   └── escape.js            shared HTML escaping
├── views/
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
│   └── command-palette.js   Ctrl+Shift+P launcher + Ctrl+P quick switcher
├── collab.js                Yjs + Trystero P2P collaboration (text + Excalidraw)
├── main.js                  app wiring: tabs, shortcuts, IPC, drag-drop, auto-update, Kanban, share modal
└── styles/                  themes.css (10 themes), base.css (layout), content.css (markdown)

src-tauri/
├── src/
│   ├── lib.rs               app entry + single-instance + tray + updater + window events
│   ├── commands.rs          IPC: open/save/save-as-html/read_file/delete_path/rename_path/copy_path/move_path
│   └── watcher.rs           file-change watcher (notify crate)
├── nsis/file-assoc.nsh      NSIS hook: registers Open With entries + mdpeek:// scheme
└── capabilities/            Tauri permission scopes

scripts/
├── copy-release.js          postbuild: copies installer + portable to releases/
└── make-release.js          signs installer, generates latest.json, uploads to GitHub

test/                        Vitest unit tests (292 tests across 10 files)
install.ps1                  PowerShell one-liner installer
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
[CHANGELOG.md](CHANGELOG.md) for the full release history.

---

## 🤝 Collaboration stack

mdpeek's live collaboration is built on two open-source libraries:

- **[Yjs](https://github.com/yjs/yjs)** — CRDT framework for conflict-free concurrent editing. Markdown / plain text / code use a `Y.Text`; Excalidraw uses a `Y.Map` of elements keyed by id.
- **[Trystero](https://github.com/dmotz/trystero)** — serverless WebRTC matchmaking. Uses public BitTorrent trackers as a rendezvous; all subsequent traffic is direct peer-to-peer, encrypted via WebRTC's DTLS.

No mdpeek-operated servers are involved in a collaboration session.

---

## 📜 License

[MIT](LICENSE) © Sanket Patel
