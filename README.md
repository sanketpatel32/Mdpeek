# mdpeek

A lightweight Markdown viewer/editor for Windows. Single job: render Markdown
beautifully, with an optional live-edit mode.

Built with **Tauri 2 + vanilla JS**. The installer is a few megabytes because it
uses the system WebView2 — no bundled Chromium (unlike Electron-based viewers
such as MarkText or mdview, which weigh 70 MB+).

## Features (v0.0.1)

- GitHub-flavored Markdown rendering
- Syntax-highlighted code blocks (highlight.js)
- Math rendering via KaTeX (`$inline$` and `$$block$$`)
- Mermaid diagrams (```` ```mermaid ```` fences)
- Live preview while editing (`Ctrl+E` to toggle)
- Live reload when the open file changes on disk
- Light / dark theme
- Drag-and-drop a `.md` file onto the window to open it
- Sanitized HTML output (DOMPurify) — safe to open untrusted files

## Shortcuts

| Action            | Key       |
| ----------------- | --------- |
| Open file         | `Ctrl+O`  |
| Save file         | `Ctrl+S`  |
| Toggle edit/view  | `Ctrl+E`  |
| Toggle theme      | toolbar ☾ |

## Build

Requires Node 18+, Rust (stable), and Windows 10/11 (WebView2 ships with the OS).

```bash
npm install
npm test            # renderer unit tests (Vitest)
npm run tauri dev   # run locally
npm run tauri build # produce installer in src-tauri/target/release/bundle/nsis/
```

## Project layout

```
src/lib/renderer.js     MD -> HTML pipeline (marked + DOMPurify + hljs + KaTeX + mermaid)
src/views/viewer.js     view mode: render + table of contents
src/views/editor.js     edit mode: split textarea + live preview
src/main.js             app wiring: open/save/toggle/theme, IPC, drag-drop
src/styles/             themes.css (vars), base.css (layout), content.css (markdown)
src-tauri/src/          Rust backend: commands.rs (open/save), watcher.rs (live reload)
test/                   Vitest unit tests + fixtures
```

## License

MIT
