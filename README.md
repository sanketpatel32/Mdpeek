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
- Markdown rendering with GFM tables, task lists, frontmatter, MDX parsing, alert/callout surfaces, basic Mermaid flowcharts, and local images
- Source editing with line numbers, indentation guides, folding, syntax highlighting, editor search/replace, Markdown autocomplete, and line operations
- Clickable preview task checkboxes that update the Markdown source
- Inline and block math fallback rendering with Unicode/script compaction
- Wiki links (`[[Page]]`) and relative Markdown links open as documents
- File explorer, heading outline, quick open (`Ctrl+P`), workspace content search (`Ctrl+Shift+F`), project-wide replace (`Ctrl+Shift+R`), daily notes (`Ctrl+Shift+D`), reopen closed tab, and reading mode (`F11`)
- Session restoration for open documents, workspace, sidebar, theme, and active tab
- Automatic reload for externally changed clean files
- HTML, plain-text, and simple PDF export
- Visual table editing at the cursor (`Ctrl+Alt+M`) with cell, row, column, movement, deletion, and alignment controls; copy tables as Markdown/CSV/TSV and fenced code blocks
- Markdown snippet picker (`Ctrl+Shift+S`) for common blocks and structures
- Zoom controls for previews and image documents
- Freehand image annotation with color/size controls and non-destructive PNG export
- Document link checking (`Ctrl+Alt+I`)
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
| Command palette | `Ctrl+Alt+P` |
| Workspace search | `Ctrl+Shift+F` |
| Workspace replace | `Ctrl+Shift+R` |
| Insert snippet | `Ctrl+Shift+S` |
| Edit table at cursor | `Ctrl+Alt+M` |
| Go to line | `Ctrl+G` |
| Duplicate line | `Ctrl+D` |
| Move line up/down | `Alt+Up` / `Alt+Down` |
| Join line with next | `Ctrl+J` |
| Daily note | `Ctrl+Shift+D` |
| Check links | `Ctrl+Alt+I` |
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
| Export HTML/text/PDF | `Ctrl+Shift+H` / `Ctrl+Shift+T` / `Ctrl+Shift+P` |
| Next/previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Quit | `Ctrl+Q` or `Alt+F4` |

## Rebuild status

This is an alpha native rebuild. Core document workflows are implemented in Rust/GPUI, but the legacy application had a much larger feature surface. Mermaid flowcharts, visual table operations, image annotation, and editor line operations are now ported. Not yet ported: full KaTeX-typeset math, sequence/class/other Mermaid diagram families, rich system print preview, typewriter scrolling, and automatic updates in the native application. The current PDF export is intentionally simple and is not a pixel-perfect print pipeline.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Commit small, focused changes using conventional commit messages.
