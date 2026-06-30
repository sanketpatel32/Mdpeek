# mdpeek — Lightweight Markdown Viewer (v0.0.1)

**Date:** 2026-06-30
**Version:** 0.0.1
**Status:** Approved

## What & Why

A minimal desktop app whose single job is rendering Markdown beautifully, with an optional edit mode. Built with **Tauri 2 + Vanilla JS** to keep the installer ~6–10MB (vs. 70MB+ for Electron-based viewers like MarkText / `khatastroffik/mdview`).

### Why not an existing repo

| Repo | Stack | Installer | Verdict |
|---|---|---|---|
| [MarkText](https://github.com/marktext/marktext) | Electron | ~90MB | Too heavy |
| [khatastroffik/mdview](https://github.com/khatastroffik/mdview) | Electron | ~70MB | View-only but bloated |
| [Markpad](https://github.com/alecdotdev/Markpad) | Tauri | ~8MB | Editor-first, not view-first |
| [MDHero](https://mdhero.app/blogs/building-native-viewer-8mb/) | Tauri | <8MB | Closed-source |

We build **view-first** with edit as a toggle — matches "soul job to view".

## Architecture

```
┌─────────────────────────────────────────────┐
│  Tauri 2 Window (Rust shell, ~3MB)          │
│  ┌───────────────────────────────────────┐  │
│  │  WebView2 (system-provided, no bundle)│  │
│  │  ┌────────────────────────────────────┤  │
│  │  │  Frontend (vanilla JS, ~50KB core) │  │
│  │  │  • marked    → MD→HTML (~30KB)     │  │
│  │  │  • DOMPurify → XSS safety (~20KB)  │  │
│  │  │  • highlight.js core (~15KB)       │  │
│  │  │  • KaTeX (~280KB, lazy)            │  │
│  │  │  • mermaid (~400KB, lazy)          │  │
│  │  └────────────────────────────────────┤  │
│  └─────────────────────────────────────────┘  │
│         ▲ IPC (Tauri invoke / events)        │
│  ┌──────┴──────────────────────────────────┐ │
│  │  Rust backend (src-tauri)               │ │
│  │  • read_file, save_file, file_dialog    │ │
│  │  • file watcher → live reload           │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## Components

| Component | Purpose | Dependencies |
|---|---|---|
| **Rust backend** (`src-tauri/`) | File I/O, native dialogs, file-watching via `notify` crate | `tauri`, `notify`, `serde` |
| **Renderer** (`src/lib/renderer.js`) | MD→HTML pipeline: marked + sanitize + highlight + math + diagrams | `marked`, `dompurify`, `highlight.js`, `katex`, `mermaid` |
| **Editor view** (`src/views/editor.js`) | Toggle-able `<textarea>` + live preview split-pane | none (vanilla) |
| **Main view** (`src/views/viewer.js`) | Rendered, scrollable document with TOC sidebar | none |
| **App shell** (`src/main.js`, `index.html`) | Wiring: menu, file open, view-mode switching, theme | none |
| **Styles** (`src/styles/`) | GitHub-like light/dark themes, minimal CSS | none |

## Data Flow

1. **Open file** — User drags .md onto window OR File→Open → Rust `dialog::open` → `fs::read_to_string` → IPC → renderer
2. **Render** — raw MD → `marked.parse()` → `DOMPurify.sanitize()` → inject into DOM → run `highlight.js` on `<code>` blocks → run KaTeX on math → run `mermaid.run()` on diagram fences
3. **Edit toggle** — User presses `Ctrl+E` → swap to split-pane → on each keystroke, debounce 150ms → re-render preview
4. **Live reload (view mode)** — `notify` crate watches the open file → on change → IPC event → re-read + re-render
5. **Save (edit mode)** — `Ctrl+S` → IPC → `fs::write` → toast confirmation

## Error Handling

- **Unreadable file:** toast + keep last good render
- **Malformed MD:** marked's built-in fallback (renders what it can), never crashes
- **Mermaid / KaTeX parse failure:** show raw block in `<pre>` with subtle error styling, don't break page
- **Missing WebView2:** Tauri's bundled bootstrapper prompts user to install (one-time)

## Testing Strategy (v0.0.1 — pragmatic)

- **Renderer unit tests (Vitest):** sample .md fixtures → assert HTML output for each feature (GFM, code, math, mermaid, XSS attempt blocked)
- **Manual smoke test:** the 5 data-flow paths above with a sample document
- **No Rust unit tests yet** — backend is thin I/O wrappers; defer to v0.0.2

## Out of Scope (v0.0.1) — YAGNI

- ❌ Multiple tabs / multi-file browser
- ❌ Settings/preferences UI (theme via single toggle, persisted to localStorage)
- ❌ Export to PDF/HTML
- ❌ Auto-update (Tauri updater wired but no signing key yet — silent in v0.0.1)
- ❌ File associations installer (defer — needs registry work)

## Deliverables

- Source tree under `Makedown-preview/`
- `npm run tauri build` → `src-tauri/target/release/bundle/nsis/*.exe` (NSIS installer, ~6–10MB)
- README with build instructions + screenshot
- This design doc

## Build Environment (verified present)

- Node v24.11.1, npm 11.6.2
- Rust 1.95.0, Cargo 1.95.0
- Windows 11 (build 26200) — WebView2 runtime ships with OS
