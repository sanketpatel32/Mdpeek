<div align="center">

# mdpeek

**A lightweight Markdown viewer for Windows.**

Its single job: render Markdown beautifully — with an optional live-edit mode.

Built with Tauri 2 + vanilla JS. The installer is a few megabytes because it
uses the system WebView2 (no bundled Chromium), making it ~95% smaller than
Electron-based viewers like MarkText (~90 MB) or mdview (~70 MB).

[Features](#features) · [Install](#install) · [Build](#build) · [Changelog](CHANGELOG.md)

</div>

---

## Features

- **GitHub-flavored Markdown** rendering
- **Syntax highlighting** for code blocks (highlight.js)
- **Math** via KaTeX — `$inline$` and `$$block$$`
- **Mermaid diagrams** — ```` ```mermaid ```` fences
- **Live preview** while editing — toggle with `Ctrl+E`
- **Live reload** when the open file changes on disk
- **Light / dark theme** with smooth transitions
- **Drag-and-drop** a `.md` file onto the window to open it
- **Sanitized output** (DOMPurify) — safe to open untrusted files

### Keyboard shortcuts

| Action            | Key       |
| ----------------- | --------- |
| Open file         | `Ctrl+O`  |
| Save file         | `Ctrl+S`  |
| Toggle edit/view  | `Ctrl+E`  |
| Toggle theme      | toolbar ☀/☾ |

## Install

### Option 1 — Terminal (one-liner)

Open **PowerShell** (built into Windows 10/11) and paste:

```powershell
irm https://raw.githubusercontent.com/sanketpatel32/Mdpeek/main/install.ps1 | iex
```

This fetches the latest release, downloads the installer, and runs it (you'll
get a UAC prompt — click **Yes**, then the setup wizard appears). Installs to
`C:\Program Files\mdpeek\` with a Start Menu shortcut. Always installs the
newest release.

> Requires Windows 10 or 11. WebView2 ships with the OS.

### Option 2 — Manual download

Grab `mdpeek-<version>-setup.exe` from the [`releases/`](./releases) folder or
the [Releases page](https://github.com/sanketpatel32/Mdpeek/releases) and
double-click it.

A portable single-file exe (`mdpeek-<version>-portable.exe`) is also provided —
no install required, just run it.

### After install

- **Start menu** → mdpeek
- **Right-click any `.md` file → Open with → mdpeek** (or set it as default)
- The app checks for updates automatically on launch

## Build

**Prerequisites:** Node.js 18+, Rust stable, Windows 10/11.

```bash
npm install            # install dependencies
npm test               # run unit tests (10 tests, Vitest)
npm run tauri dev      # launch in dev mode (hot reload)
npm run tauri:build    # build production installer -> releases/
```

`npm run tauri:build` produces versioned artifacts in `releases/`:

```
releases/
├── mdpeek-0.0.2-setup.exe      # NSIS GUI installer
└── mdpeek-0.0.2-portable.exe   # standalone binary, no install
```

## Project layout

```
src/lib/renderer.js     MD -> HTML pipeline (marked + DOMPurify + hljs + KaTeX + mermaid)
src/views/viewer.js     view mode: render + table of contents
src/views/editor.js     edit mode: split textarea + live preview
src/main.js             app wiring: open/save/toggle/theme, IPC, drag-drop
src/styles/             themes.css (design tokens), base.css (layout), content.css (markdown)
src-tauri/src/          Rust backend: commands.rs (open/save), watcher.rs (live reload)
scripts/copy-release.js postbuild: copies installer + portable exe into releases/
test/                   Vitest unit tests + fixtures
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, and
[CHANGELOG.md](CHANGELOG.md) for release history.

## License

[MIT](LICENSE) © sanketpatel32
