<div align="center">

<img src="assets/logo.svg" alt="mdpeek logo" width="80" height="80" />

# mdpeek

**A quiet, fast native Markdown reader and editor.**

Mdpeek is being rebuilt as a pure Rust desktop application using GPUI. The former Tauri/JavaScript implementation has been removed from the main application path; the native crate is now the product.

[![License: MIT](https://img.shields.io/github/license/sanketpatel32/Mdpeek)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-windows%20%C2%B7%20linux%20%C2%B7%20macos-blue)](https://github.com/sanketpatel32/Mdpeek/releases/latest)

</div>

## Current native feature set

- Multi-tab Markdown, text, code, CSV/TSV, and image documents
- Split, editor-only, and preview-only modes
- Markdown rendering with GFM tables, task lists, frontmatter, MDX parsing, alert/callout surfaces, and local images
- Source editing with line numbers, indentation guides, folding, syntax highlighting, and editor search/replace
- Clickable preview task checkboxes that update the Markdown source
- Inline and block math fallback rendering with Unicode/script compaction
- Wiki links (`[[Page]]`) and relative Markdown links open as documents
- File explorer, quick open (`Ctrl+P`), reopen closed tab, and reading mode (`F11`)
- Session restoration for open documents, workspace, sidebar, theme, and active tab
- Automatic reload for externally changed clean files
- HTML and plain-text export
- Copy table contents as Markdown, CSV, or TSV; copy fenced code blocks
- Light and dark themes

## Build and run

Requirements: a current stable Rust toolchain and the platform system libraries required by GPUI.

```bash
cargo run -p mdpeek
```

Run checks:

```bash
cargo fmt --check
cargo clippy -p mdpeek -- -D warnings
cargo test -p mdpeek
cargo build --release -p mdpeek
```

Open files or folders directly:

```bash
cargo run -p mdpeek -- README.md path/to/workspace
```

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| New document | `Ctrl+N` |
| Open file | `Ctrl+O` |
| Quick open | `Ctrl+P` |
| Open folder | `Ctrl+Shift+E` |
| Save | `Ctrl+S` |
| Save as | `Ctrl+Alt+S` |
| Close tab | `Ctrl+W` |
| Reopen closed tab | `Ctrl+Alt+T` |
| Edit/preview | `Ctrl+E` |
| Sidebar | `Ctrl+B` |
| Reading mode | `F11` |
| Reload | `Ctrl+R` |
| Theme | `Ctrl+Shift+L` |
| Export HTML/text | `Ctrl+Shift+H` / `Ctrl+Shift+T` |
| Next/previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Quit | `Ctrl+Q` or `Alt+F4` |

## Rebuild status

This is an alpha native rebuild. Core document workflows are implemented in Rust/GPUI, but the legacy application had a much larger feature surface. Not yet ported: Mermaid diagrams, full KaTeX-typeset math, PDF printing, visual table editing, daily notes, project-wide search/replace, workspace collaboration/graph/calendar views, installer signing, and automatic updates.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Commit small, focused changes using conventional commit messages.
