# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.31.2] - 2026-07-24

### Fixed — Restored Missing Toolbar Action Buttons & Prevented Blank Window Render Failure

- **Restored Complete Header Toolbar (`index.html`)**: Rebuilt all required tool buttons (`btn-open`, `btn-save`, `btn-mode`, `btn-draw`, `btn-sidebar`, `btn-explorer`, `btn-export`, `btn-export-pdf`, `btn-present`, `btn-share`, `btn-daily`, `btn-kanban`, `btn-terminal`, `btn-zoom-in`, `btn-zoom-out`), restoring full feature accessibility.
- **Defensive DOM Binding Safeguards (`main.js`)**: Added safe optional chaining (`el.save?.classList`, `syncToolbarForDoc`) to prevent `TypeError` exceptions from crashing `renderActive()`, ensuring the welcome screen and active documents render reliably on launch.

## [0.31.1] - 2026-07-24

### Fixed — Post-Installation Startup & Tray Icon Rust Panic Safeguards

- **Safe Tray Icon Initialization (`lib.rs`)**: Replaced panicking `.unwrap()` on `default_window_icon()` with safe pattern matching (`if let Some(icon)`), preventing instant startup crashes on cold launch or post-installation NSIS setup runs.
- **PTY Mutex Lock Safety (`pty.rs`)**: Replaced direct `.unwrap()` locks on terminal PTY state with `.unwrap_or_else(|e| e.into_inner())` to prevent thread panics from corrupting app state.
- **Promise Rejection Safeguards (`main.js`)**: Added `.catch()` error bounds to `getVersion()` and session initialization promises to ensure corrupted local state or IPC latency never causes a blank window.

## [0.31.0] - 2026-07-24

### Added & Changed — Rich Micro-Motion Engine & Responsive Theme UI Polish

- **Spring-Physics Micro-Motion Engine**: Integrated tactile spring animations (`cubic-bezier(0.16, 1, 0.3, 1)`) across all tabs, buttons, modals, and interactive controls, introducing responsive hover lifts (`translateY(-1.5px)`), active press scales (`scale(0.95)`), and animated tab appearance keyframes.
- **Glowing Accent Tab Indicators**: Enhanced active tabs with floating card depth (`shadow-md`), animated gradient glow lines (`linear-gradient`), and rotating micro-close (`×`) button transitions.
- **Universal Theme Fidelity**: Validated and polished solid elevated surfaces, glow accents, and WCAG AA contrast across all 8 themes (**Light, Dark, Solarized Light, Solarized Dark, Nord, Dracula, Tokyo Night, Catppuccin**).

## [0.30.0] - 2026-07-24

### Added & Changed — macOS Glassmorphism UI & Out-of-the-Box Penrose Branding

- **macOS Translucent Glassmorphism (`backdrop-filter`)**: Upgraded the app header, command palette, modal overlays, popovers, and sidebars with authentic macOS translucency (`backdrop-filter: blur(24px) saturate(190%)`), hairline glass borders, and popover shadow depth (`--shadow-popover`).
- **Apple Fluid Motion Curves**: Replaced legacy transition timing with native Apple spring easing curves (`cubic-bezier(0.16, 1, 0.3, 1)`), providing instant response and smooth deceleration on tabs, buttons, modals, and dropdown menus.
- **Floating Pill Tab Bar**: Refined the header tab bar with floating glass pill tabs, subtle active shadows, and tactile micro-scale active click states (`transform: scale(0.97)`).
- **Out-of-the-Box Penrose Origami Logo**: Replaced generic AI-style app icons with a bespoke, handcrafted Penrose Isometric Ribbon monogram (`M` + `P`) vector logo across all desktop executable formats (`.ico`, `.icns`, `.png`, StoreLogos).

## [0.29.2] - 2026-07-23

### Changed — Hallmark design overhaul & theme contrast accessibility

- **Hallmark Design System Integration**: Redesigned the Home Screen welcome hub using anti-slop design principles (structural variety, restraint, high-signal typography, and clean 2-column layout with a 310px action sidebar and flexible recent files list).
- **Streamlined Action Cards**: Replaced nested icon containers with unified action cards (`Open File`, `New Note`, `Today's Note`, `Open Folder`) featuring inline Lucide SVG icons and right-aligned `<kbd>` shortcut badges (`Ctrl+O`, `Ctrl+N`, `Ctrl+Shift+E`).
- **Enhanced Theme Contrast & Readability**: Boosted `--fg-muted` text contrast across Solarized Light (`#657b83`), Solarized Dark (`#839496`), Dracula (`#8092c4`), Nord (`#7e8eab`), Tokyo Night (`#747ca8`), and Catppuccin (`#7f849c`) to ensure file paths, timestamps, and secondary text meet WCAG AA standards.
- **Header Alignment & Radial Backdrops**: Aligned brand logo (42px, 10px radius), version badge (`v0.29.2`), and tagline while preserving theme-aware radial background glows on the Home View.

## [0.29.0] - 2026-07-23

### Added — Centralized asset storage & icon standardization

- **Central Asset Storage (`%LOCALAPPDATA%\mdpeek\assets\`)**: Pasted or dropped images in Markdown documents and the terminal drawer now save to a central app data directory using SHA-256 content hashes, preventing scattered `assets/` subfolders across project directories.
- **Tauri Asset Protocol Resolution**: Updated the Markdown preview renderer (`src/lib/renderer.js`) to automatically resolve local image paths and `file://` URLs via Tauri's native `convertFileSrc` handler.
- **Standardized Action & Explorer Icons**: Updated Open File buttons to use `file-up` icons and File Explorer toggles to use `folder-open` icons across the top toolbar, welcome screen, and file-tree sidebar.

## [0.28.3] - 2026-07-23

### Fixed
- **Welcome screen overflow when expanding terminal drawer**: Resolved card content spilling outside card boundary when moving the terminal pane upwards or resizing short viewports. Added container scrolling, flex centering, card overflow containment, and responsive height adjustments.
- **Open file icon updated**: Replaced the closed folder SVG icon on the "Open file" toolbar button and welcome action with an open folder icon (`folder-open`).

## [0.28.2] - 2026-07-22

### Fixed — the editor no longer forces horizontal scrolling (soft-wrap + wrap-aware gutter)

The editor was reported as "shit and unusable" the moment you clicked Edit. Root cause: the textarea had `wrap="off"` hardcoded (`src/views/editor.js:32`), so **any long line overflowed horizontally** — a single long sentence overflowed by 1444px and you couldn't see what you typed without scrolling right. `wrap="off"` was set deliberately (commit `9ebf337`) to keep the line-number gutter aligned after removing the old syntax-highlight overlay, because the gutter, active-line marker, and typewriter mode all assumed "1 source line = 1 visual row" via the naive `lineNum × linePx` formula. Soft-wrap broke all three.

**The fix introduces a hidden mirror element** — the industry-standard technique (used by GitHub's comment box, VS Code's simple editors, Stack Exchange) for measuring wrapped-text positions without a real editor framework:

- **Soft-wrap is ON.** The textarea is now `wrap="soft"`, `white-space: pre-wrap`, `overflow-wrap: break-word`, `word-break: break-word`. Long lines wrap at the editor's right edge instead of scrolling.
- **A visibility-hidden `.editor-mirror` div** is appended to `.editor-wrap`. It echoes the textarea's text one `<div>` per source line, with identical font/padding/width. The browser lays it out natively, so `offsetTop`/`offsetHeight` on each mirror line reflect the real wrapped height. No visible rendering — pure measurement.
- **Wrap-aware gutter.** `syncGutter()` now sets each gutter row's height to the corresponding mirror line's `offsetHeight`. A line that wraps to 3 visual rows gets a 3×lineHeight gutter row; the number renders on the first visual row (top-aligned), continuation rows are blank — exactly GitHub's behavior. Verified: gutter heights match mirror heights to the pixel.
- **Wrap-aware active-line marker + typewriter.** Both now read the caret line's `offsetTop`/`offsetHeight` from the mirror instead of computing `lineNum × linePx`. Eliminates drift on wrapped lines.
- **Mirror width syncs to `textarea.clientWidth`** on every update and on resize, so wrapping points match even when a scrollbar appears/disappears.

### Fixed — two dead-code bugs in the editor controller

Found during the editor exploration:

- **Snippet picker was broken in edit mode.** `insertSnippetIntoEditor` (main.js:870) called `doc.editor.getSelection()` and `doc.editor.replaceRange(...)` — neither method was ever implemented on the editor controller, so the snippet picker silently no-op'd. Added both methods to the controller: `getSelection()` returns `{start, end}`, `replaceRange(start, end, text)` splices + refreshes. The existing call sites now resolve.
- **Status bar selection word-count was broken in edit mode** (main.js:2911) — same root cause, same fix.

### Tests
- Updated `test/editor-gutter.test.js` to reflect soft-wrap (3 tests adjusted + 1 new test verifying gutter row heights are always set from the mirror). All **300 tests pass** (299 + 1 new).

## [0.28.1] - 2026-07-22

### Changed — active line highlight refinement & app stability

- **Refined Active Line Highlight**: Replaced heavy opaque line background blocks with a subtle transparent accent tint (`--accent-soft`) and a 2px left border indicator next to the gutter. Removed laggy position transition for zero-delay cursor tracking.
- **Active Line Settings Toggle**: Added an "Active Line Highlight" checkbox in Settings → Editor so users can toggle line highlighting ON or OFF anytime.
- **Improved App & PTY Process Cleanup**: Updated `kill_terminal` backend command in Rust (`src-tauri/src/pty.rs`) to explicitly call `_child.kill()` when closing terminal tabs to avoid orphaned subprocesses.
- **Global Exception Guarding**: Added global handlers for unhandled promise rejections and ResizeObserver loop limit warnings to prevent non-fatal error dialogs/console noise.

## [0.28.0] - 2026-07-22

### Changed — modern Kanban Board UI & feature overhaul

- **Visual Refresh:** Redesigned the Kanban board with a modern header toolbar, subtle glassmorphism backdrop, colored column top-borders (`To Do` blue, `In Progress` amber, `Done` emerald), elevated card shadows (`box-shadow`), smooth drag rotation, and hover micro-animations.
- **Completion Progress Bar & Live Task Stats:** Added an interactive header progress bar displaying overall completion percentage alongside live task counts (`N of M done (X%)`).
- **Real-Time Task Filtering:** Integrated a instant search/filter bar in the Kanban header to filter cards across columns.
- **Task Checkboxes & Inline Editing:** Added task completion checkboxes on cards for one-click status toggling and supported double-clicking task text for seamless inline editing.
- **Auto-Parsed Tag Badges & Timestamps:** Automatically parses hashtags (`#bug`, `#feat`, `[High]`) into colorful pill badges and displays formatted relative timestamps (`Just now`, `5m ago`, `2h ago`).
- **Clear Completed Action:** Added a "Clear Done" toolbar button to flush completed tasks in one click.

## [0.27.3] - 2026-07-22

### Fixed — image pasting support & xterm text descender clipping

- **Font Descender Rendering Fix:** Resolved character descender clipping (`g` rendering like `q`, `y` like `v`) by removing raw CSS `var(...)` functions from `xterm.js` Canvas font family initialization and adding `getTerminalFontFamily()` + `lineHeight: 1.25`.
- **Clipboard Image Paste to Terminal:** Added automatic image clipboard handling for `Ctrl+V` and DOM `paste` events. When pasting an image into the terminal (for Claude CLI / LLM tools), the image is saved to disk and its quoted path is inserted directly into the shell input line.

## [0.27.2] - 2026-07-22

### Fixed — integrated terminal input and dimension sync

- **Persistent PTY Stdin Writer:** Fixed a critical issue in `src-tauri/src/pty.rs` where `spawn_terminal` took and dropped the PTY writer as a smoke test, closing the process stdin. `TermEntry` now retains the writer handle persistently so `write_terminal` executes keystrokes correctly.
- **Initial Viewport & Resize Sync:** Synchronized `fit.fit()` layout calculations and attached viewport listeners prior to invoking `resize_terminal` so terminal rows and columns stay aligned with xterm.js right from startup.
- **Clipboard Operations:** Added custom key handlers for `Ctrl+C` (copy active text selection) and `Ctrl+V` (paste clipboard text).

## [0.27.1] - 2026-07-22

### Fixed — terminal "backend did not respond" error

v0.27.0's terminal spawn had a **4-second frontend timeout** that was too aggressive. On machines with PowerShell 7 installed, the cold-launch sequence (probe `pwsh.exe --version` + spawn the ConPTY + PowerShell profile load + first IPC round-trip) regularly exceeded 4s, so the frontend gave up and showed *"Failed to start terminal: terminal backend did not respond"*. The backend was actually working — verified via `eprintln!` logs showing spawn completes in well under a second; the timeout was racing against unrelated IPC/profile overhead.

Two fixes:

- **Frontend timeout raised from 4s → 15s.** PowerShell cold-start with a heavy `$PROFILE` can take several seconds on first launch; 15s gives comfortable headroom while still failing cleanly if the backend is genuinely absent.
- **PowerShell-7 probe made non-blocking.** The `pwsh.exe --version` detection used to run synchronously on the IPC thread via `Command::output()`. If `pwsh.exe` on PATH misbehaved (hung waiting for input, slow profile load), it could block the whole `spawn_terminal` command. Now the probe runs on a worker thread with stdin/stdout/stderr wired to `Stdio::null()` and a hard **1.5s `recv_timeout`** — on any doubt we fall back to the universally-installed `powershell.exe`.
- Added diagnostic `eprintln!` logging at every checkpoint in `spawn_terminal` (openpty, probe result, spawn_command pid, slave drop, master move, take_writer, return id) so future spawn issues are immediately diagnosable in `tauri dev` output.

## [0.27.0] - 2026-07-22

### Changed — the terminal is now a real PTY (VS Code-style)

The integrated terminal was completely rewritten. Previous versions (v0.25.0–v0.26.1) used a **fake, request/response shell**: each Enter spawned a fresh `cmd.exe /C "<cmd>"`, blocked to completion, and dumped all stdout+stderr as plain text into a `<div>`. That broke streaming output (`npm install`), ANSI colors, interactive commands (`node`, `python`), Ctrl+C, persistent `cd`/env/aliases, and the prompt said PowerShell while running cmd.exe.

**v0.27.0 replaces the fake shell with a real pseudo-terminal**, the same architecture VS Code uses:

- **Backend:** the [`portable-pty`](https://crates.io/crates/portable-pty) crate spawns a real **ConPTY** (Windows 10 1809+) running PowerShell. Output streams byte-by-byte over a typed Tauri 2 `Channel`. Keystrokes are written back via `invoke`. Four new commands: `spawn_terminal`, `write_terminal`, `kill_terminal`, `resize_terminal`. Lives in a new `src-tauri/src/pty.rs`.
- **Frontend:** [`@xterm/xterm`](https://github.com/xtermjs/xterm.js) (the exact renderer VS Code's terminal uses) replaces the `<div>` + `<input>` combo. Keystrokes pipe straight to the PTY; PTY bytes pipe straight to xterm.js. ANSI escapes are parsed natively, so colors, cursor movement, and TUI apps all work.
- **Shell:** prefers PowerShell 7 (`pwsh.exe`) when installed, falls back to Windows PowerShell 5.1 (`powershell.exe`). Launched with `-NoLogo`. The old behavior of running `cmd.exe` while labeling the prompt `PS >` is gone.
- **Multi-tab:** preserved. Each tab is one independent PTY + one xterm.js instance. Switching tabs preserves scrollback (the Terminal instance is kept alive; only its mount div is hidden).
- **Drag-and-drop:** preserved. Dropping a file onto the terminal writes its quoted path into the live shell input line (matching real terminal behavior — the path becomes part of the next command).
- **Lifecycle:** closing a tab kills its PTY. Closing the drawer keeps PTYs running in the background (VS Code behavior). Quitting the app kills every live PTY to prevent zombie PowerShell processes.
- **Theme sync:** xterm.js theme is derived from the app's CSS vars (`--bg`, `--fg`, `--accent`, `--danger`, …) and re-applied on every theme switch, so the terminal matches Dracula / Tokyo Night / Light / etc.
- **Resize:** the drawer resize handle + window resize both trigger `fit()` → `onResize` → `resize_terminal`, propagating the new cols/rows to the ConPTY.

### Removed
- `run_shell_command` Rust command and its `CommandOutput` struct (the fake-shell backend). No remaining callers; no tests referenced it.

### Tests
- New `test/terminal.test.js` (7 tests) covering the pure helpers (`readCssVar`, `xtermThemeFromApp`) — the ANSI 16-color palette mapping, fallbacks, and trimming. Establishes the first Tauri IPC mock pattern in the suite (`vi.mock('@tauri-apps/api/core', …)`) for future modules that need to test `invoke`/`Channel` consumers.
- All 299 tests pass (292 existing + 7 new).

### Out of scope (deferred)
- Shell picker UI (PowerShell / cmd / Git Bash dropdown) — PowerShell only for v0.27.0.
- SSH / remote terminals.
- In-terminal search (Ctrl+F) — needs the `@xterm/addon-search` addon.
- Per-tab profile / icon customization.
- Persistent terminal sessions across app restart.

## [0.26.1] - 2026-07-22

### Fixed — Instant Pure-JS `cd` / `cd..` Resolution (Subshell-Free)
- **Instant `cd` Execution:** Removed subshell execution delay for directory navigation commands (`cd`, `cd..`, `cd <dir>`, `cd \path`). `cd` operations now resolve in 0ms synchronously in JS, instant like a native shell prompt.

## [0.26.0] - 2026-07-22

### Added & Fixed — Multi-Tab Terminal & Directory Resolution Fix
- **Multi-Tab Terminal Drawer:** Added multi-tab support (`+` button, tab strip, close tab `✕`) allowing users to open and switch between multiple concurrent terminal sessions with independent working directories and command histories.
- **`cd` & `cd..` Command Resolution:** Rewrote terminal directory navigation handling to support relative paths (`cd ..`, `cd subdir`, `cd /d D:\path`), updating prompt prefix and execution working directory cleanly.
- **Dynamic Layout Shrinking:** Ensured open terminal drawer resizes main workspace area vertically without overlapping document viewer or file tree.

## [0.25.2] - 2026-07-22

### Fixed — File Explorer Chevrons & Layout Push-Down
- **Folder Chevron Direction Fix:** Fixed directory chevron icons in the File Explorer sidebar so right-pointing chevron (`>`) indicates a collapsed folder and down-pointing chevron (`v`) indicates an expanded folder.
- **Non-overlapping Terminal Layout:** Refactored the main workspace layout container into a vertical flex column (`.workspace-container` -> `.workspace-main` + `.terminal-drawer`). Opening the Terminal Drawer now pushes up and resizes the file explorer, viewer, and editor panes cleanly without overlapping.
- **Lightning-Fast Command Execution:** Switched backend command dispatch to `cmd.exe /C` on Windows for instant response times.
- **Base Folder Auto-Sync:** Terminal directory automatically defaults to the open Explorer root directory.

## [0.25.1] - 2026-07-22

### Added — Resizable Layout Blocks & Terminal Drawer Polish
- **Dynamic Terminal Height Resizer:** Added a top drag handle to the Terminal Drawer (`#terminal-resize-handle`) allowing smooth mouse-drag height adjustment between 120px and 80vh.
- **Edit Mode Split Pane Resizer:** Added a middle vertical drag handle (`#pane-resizer`) between the Source Editor and Live Preview panes for customizable split ratios.

## [0.25.0] - 2026-07-22

### Added — Modern Integrated PowerShell Terminal Drawer (`Ctrl+\``)
- **Built-in PowerShell Console:** Toggleable bottom shell panel (`Ctrl+\`` or top bar terminal icon) powered by native Windows PowerShell process execution.
- **Image & File Drag/Drop & Paste Support:** Drag and drop files/photos directly into the terminal or paste screenshots directly from the clipboard (`Ctrl+V`). Images are auto-saved to the active workspace and inserted as quoted file paths into your active CLI prompt.
- **Command History & Directory Auto-Sync:** Navigate past commands with `↑`/`↓`, clear screen with `Ctrl+L`, and automatically sync working directory when switching tabs or using `cd`.

## [0.24.1] - 2026-07-22

### Fixed — Settings Modal Tab Switching Lag
- **Lazy Changelog Rendering:** Resolved modal tab switching lag by rendering the Markdown CHANGELOG on demand when clicking the Changelog tab, rather than eagerly re-parsing it every time Settings opens.

### Added — Settings Feature Flags Category
- **Opt-out Non-essential Features:** Added a dedicated **Features** tab under Settings allowing users to disable/enable non-essential features (*Live Collaboration*, *Kanban Board*, *Presentation Slideshow*, *Markdown Snippets & Templates*, *Daily Notes*).
- **Windows Explorer Right-click Integration:** Preserved and surfaced the *Open with mdpeek* / *Open folder in mdpeek* context menu toggle under Settings → General.

## [0.24.0] - 2026-07-22

### Added — Save Code Block Action Button
- **Direct Code Snippet Download:** Added a "Save code block" button next to "Copy code" on rendered code blocks in view mode. Automatically detects language extensions (`.js`, `.py`, `.ts`, `.json`, `.css`, `.html`, `.sql`, `.sh`, `.rs`, `.cpp`, `.go`) and saves snippet directly to disk.

### Added — Markdown Template & Snippet Picker (`Ctrl+Shift+S`)
- **Quick Snippet Inserter:** Added a dedicated template launcher (`Ctrl+Shift+S`) and command palette action to insert Markdown callout blocks (`[!NOTE]`, `[!TIP]`, `[!WARNING]`), 3x3 tables, task lists, code fences, KaTeX math blocks, and meeting notes templates.

### Added — Selection Word & Character Counter
- **Dynamic Status Bar Selection Counter:** Highlighting text in the editor or view pane now displays `Selected: X w, Y c` alongside total word and character counts in the status bar.

### Fixed — Zoom & UI Polish
- **Document & Editor Zoom:** Fixed CSS `var(--content-font-size)` binding so Zoom In / Out buttons and `Ctrl + Mouse Wheel` scale all rendered Markdown, preview, editor, and PDF views smoothly.
- **Header Alignment & Live Collab Sharing:** Centered the `Live · waiting` collaboration status pill in the top header and restored the Share collaboration icon for code file tabs.

## [0.23.1] - 2026-07-21

### Changed — Live Collaboration Status Pill Polish
- **Compact & Minimalist Pill Design:** Redesigned the top-bar P2P Live Collaboration status indicator (`Live · waiting` / `Live · N peers`) to match the 26px compact height, theme surface variables, and subtle border styling of the top toolbar.
- **Refined Interactivity:** Added active scale transitions and subtle danger highlight on the session end (`×`) button.

## [0.23.0] - 2026-07-21

### Changed — Minimalist Top Bar Redesign
- **Organized toolbar controls into clean, rounded surface groups:** Buttons are now neatly grouped into logical clusters (History Navigation, Document Actions, View/Explorer Toggles, Tools & Productivity, Zoom Control, App Settings).
- **Reduced visual clutter & button sizes:** Scaled toolbar icons and buttons down to a sleek 28px height with 16px icon dimensions and subtle borders, matching native macOS / Windows 11 Fluent editor aesthetics.
- **Retained 100% of features:** All quick actions (Back/Forward, Open/Save, Edit Mode, PDF Annotations, TOC, File Explorer, Folder Search, HTML/PDF Export, Presentation, Share, Daily Notes, Kanban, Zoom, Themes, Settings) remain fully accessible and shortcut-enabled.

### Changed — Redesigned Settings Changelog View
- **Modern Timeline & Card Layout:** Upgraded the Settings Changelog tab with styled version banners, accent category badges (`### Fixed`, `### Changed`, etc.), code block borders, and clean typography.
- **Improved Scannability:** Increased line-height and contrast for release notes so reviewing past updates is effortless.

## [0.22.3] - 2026-07-21

### Fixed — Kanban drag-and-drop actually works in the desktop app
- **Cards couldn't be moved between columns in the desktop (Tauri) build.** v0.22.2 used the HTML5 drag-and-drop API (`draggable="true"`, `dragstart`/`dragover`/`drop`), which works in a plain browser but is silently intercepted by Tauri 2's WebView2 at the OS layer on Windows. The events never reached the DOM, so dropping a card on another column did nothing.
- **Rewrote the drag-and-drop on pointer events** (`pointerdown` / `pointermove` / `pointerup`). Pointer events bypass the OS drag-drop interception entirely and work in every environment (Tauri desktop + plain browser + touch). The lifecycle:
  - `pointerdown` on a card (left button, not on the delete button) records the start position and id.
  - `pointermove` past a 4-pixel slack threshold creates a floating ghost card that follows the cursor and highlights the column under the pointer.
  - `pointerup` drops into the column under the cursor (if any), then tears down the ghost + highlights.
- A plain click on a card (no movement) is now a no-op — the slack threshold prevents accidental drags when the user just wanted to focus the card.
- **Visuals unchanged from v0.22.2:** source card still dims to 40% while dragged, target column still tints with the accent color, ghost is a fresh floating clone with an accent border + shadow.
- Removed the `draggable="true"` attribute from cards (no longer needed). Added `touch-action: none` so pointer events fire reliably on touch devices.

## [0.22.2] - 2026-07-21

### Changed — Kanban is now a full-page view with drag-and-drop
- **The board is now a full-page view** (not a modal). Toggled via `body.kanban-mode`, mirroring the slideshow's `body.presenting` pattern. The view replaces the entire app surface while open — no more cramped modal card, the board gets the full window.
- **Tasks can ONLY be added to the "To do" column.** The In progress + Done columns no longer have add inputs — their footers are gone. The only way to populate them is to **drag cards in from another column**.
- **HTML5 drag-and-drop between columns.** Every card is `draggable="true"`; every column is a drop target. While a card is being dragged over a column, that column tints with the accent color so it's obvious where the drop will land. The card being dragged dims to 40% opacity (the "you're holding this" cue).
- Moved cards land at the bottom of their new column (bumped `createdAt`), so the most-recently-moved card is always last.
- The `Ctrl+Shift+K` shortcut now **toggles** the board (open if closed, close if open). **Esc also closes** the board. No click-outside-to-close because there's no overlay anymore.

### Layout / visual polish
- New toolbar-style header (`.kanban-toolbar`) with the title + a Done button on the right. The Done button has an inline × icon and "Done" label.
- Three-column grid fills the page with 16px gutters + 20px outer padding. Each column scrolls internally, not the board.
- Column header dots moved into a `.kanban-column-header-label` span so the layout is title + dot on the left, count badge on the right.
- Subtle 160ms fade-in animation on open (matches the slideshow).

### Tests
- No new automated tests (drag-and-drop is browser-interaction glue; the underlying `moveKanbanTask` is a 5-line function not worth pinning down in jsdom).
- Existing 292/292 tests pass unchanged.

### Verified end-to-end in the running app
- Full-page layout (view replaces the app surface when open).
- Only the To-Do column has an Add input (In progress + Done have no footer).
- New tasks always land in To-Do regardless of which status the caller passes.
- Dragging a card from To-Do to Done moves it (todo count 3 → 2, done count 1 → 2); the moved card appears in the Done column; localStorage reflects the new status.
- Esc closes; Ctrl+Shift+K toggles open/closed.

## [0.22.1] - 2026-07-21

### Added — global Kanban board
- **A simple three-column task board — To do / In progress / Done — accessible from anywhere in the app via a toolbar button, the command palette, or `Ctrl+Shift+K`.** Tasks live globally (not per-document) in `localStorage` under `mdpeek-kanban-tasks`, so the board is the same across every tab and survives app restarts. No accounts, no sync — just local persistence.
- Each column has its own "Add a task…" input at the bottom; press Enter or click Add to append a card. Cards can be deleted individually via the × button on each card. There is intentionally **no drag-and-drop, no priorities, no due dates** — the board is meant to be "very simple and sorted" as requested.
- The board re-renders from data on every change (cheap; typical usage is <50 tasks), so no per-card event listeners leak across renders. Card text is HTML-escaped on render; user input is capped at 280 chars.
- A colored dot on each column header (gray / amber / green) gives a quick visual cue for the three statuses.

### Conventions followed
- Toolbar button (`#btn-kanban`) added next to the daily-notes button, with the standard `tool-btn icon-only` class + inline feather-style SVG.
- Modal markup mirrors the existing `#share-dialog` pattern (`.modal-overlay.hidden` + `.modal` card). Toggle is via `classList.add/remove('hidden')`, matching every other dialog in the app.
- `Ctrl+Shift+K` shortcut added to the capture-phase keydown handler alongside `Ctrl+Shift+E` (explorer) and `Ctrl+Shift+C` (copy rich).
- Command palette entry: `{ id: 'kanban', label: 'Open Kanban board', hint: 'Ctrl+Shift+K', keywords: 'kanban board tasks todo done progress' }`.
- The `mdpeek-kanban-tasks` key is intentionally **NOT** in the `SETTING_KEYS` array — resetting all settings from the Settings panel should not wipe user tasks.

### Tests
- No new automated tests (the Kanban is pure DOM glue; the persistence layer is one-line `localStorage` wrappers and the rendering is a single template string — no logic worth pinning down in jsdom).
- Existing 292/292 tests pass unchanged.

## [0.22.0] - 2026-07-21

### Added — live collaboration on plain text, code files, and Excalidraw canvases
- **`.txt` (plain text) files can now be shared.** The Share button was previously hidden for plain-text docs; the gate (`doc.plain`) is removed. Host shares a `.txt` exactly like a markdown file — Yjs text CRDT, same Trystero transport, same Share modal. Receivers join into a plain-text tab (no markdown preview pane) that matches the host's UX.
- **Excalidraw (`.excalidraw`) files can now be shared.** Full canvas collaboration: draw on one machine, see it appear on the other in real time. New `collab.startSessionExcalidraw` + `collab.bindExcalidraw` entry points in `src/collab.js` bind a `Y.Map<elementId, Y.Map<field, value>>` to the canvas via Excalidraw's imperative `updateScene` API. Each Excalidraw element becomes a Yjs map entry keyed by its stable string id; remote updates reassemble the elements array and push to the canvas. The bidirectional echo loop (canvas → Yjs → canvas) is broken by a `suppress` flag around inbound `updateScene` calls plus the `'self'` transaction origin on outbound writes.
- The `excalidraw-viewer` controller (`src/views/excalidraw-viewer.js`) is extended with four new methods: `updateScene(elements)`, `getSceneElements()`, `setCollabHook(fn)`, `clearCollabHook()`. The hook is called from `handleChange` on every local canvas edit (immediately, NOT debounced — Yjs + the network handle coalescing, so the 1s save debounce would add a full second of latency for remote peers).
- **Race-condition fix for receiver canvas mount.** On the receiver, `showExcalidraw` is async (lazy-loads React), so the canvas doesn't exist when `confirmJoin`'s `requestAnimationFrame` fires. Binding now happens inside the `showExcalidraw().then()` callback in `renderActive` once the controller is ready.

### Changed — Share button visibility
- The Share button is now hidden only when a session is already active (use End instead). The per-viewer branches (PDF/image/csv/welcome) still hide it for read-only formats as before; the plain-text gate is gone, and the Excalidraw branch now shows it.

### Fixed — receiver language propagation (now inert, but documented)
- Previously, the host's `language` metadata was discarded on the receiver (`confirmJoin` stored only `result.title`). The receiver now branches on `result.language` to decide what kind of tab to create (`'excalidraw'` → Excalidraw canvas, `null` → plain text, anything else → text). Note: since the recent editor refactor removed per-language syntax highlighting, the language metadata is currently informational only — it round-trips correctly so future language-aware features can use it.

### Tests
- 9 new tests in `test/collab.test.js` covering the Excalidraw Yjs layer: round-trip, full-replace semantics, invalid-element skipping, nested object preservation, null-state safety, two-peer CRDT convergence via `encodeStateAsUpdate`/`applyUpdate`, and the `'self'` origin tagging that breaks the echo loop.
- 2 new tests in `test/documents.test.js` locking `shared + plain` (`.txt` collaboration) and `shared + excalidraw` (canvas collaboration) combinations on the document model.
- **292/292 tests pass** (was 281).

### Limitations (documented)
- Image elements embedded in an Excalidraw scene sync their metadata but the binary `files` dict is NOT synced over Yjs — the receiver sees placeholders for embedded images. Future work.
- Excalidraw cursor awareness (seeing the other peer's pointer move on your canvas) is not wired up; Yjs awareness supports it but Excalidraw's `onPointerUpdate` plumbing is a separate feature.
- The full-replace Yjs strategy sends the entire Y.Map on every change. Fine for typical drawings (<1k elements); per-field Y.Map merging is a future optimization for very large scenes.

## [0.21.11] - 2026-07-21

### Fixed — editor text and cursor alignment
- Removed the separate syntax-highlight overlay from edit mode. Visible text and the cursor now come from the same native textarea, eliminating cross-layer font, DPI, scroll, and wrapping drift.
- Disabled source-line wrapping in edit mode. Every source line now occupies one fixed-height visual row and matches exactly one gutter number; long lines scroll horizontally.
- Removed the obsolete editor syntax-highlighting setting and the hidden wrap-measurement mirror.
- Added regression coverage that rejects a second text-rendering layer and enforces fixed source rows.

## [0.21.10] - 2026-07-21

### Fixed — editor text, line numbers, and active row stay aligned
- Matched the syntax-highlight overlay width and height to the textarea's actual client area. The textarea's vertical scrollbar previously made its text viewport narrower than the overlay, so the two layers wrapped long lines at different words and every following line appeared one row apart.
- Removed the overlay-only `word-break` rule so both text layers use the same wrapping algorithm.
- Added a regression test that locks the overlay to the textarea viewport, including the scrollbar-reduced width.

## [0.21.9] - 2026-07-21

### Fixed — syntax-highlight overlay drift on wrapped lines (the "cursor points to one line but the text is elsewhere" bug)
- **The colored syntax-highlight overlay did not soft-wrap, but the textarea did.** The textarea is `white-space: pre-wrap; overflow-wrap: break-word` by default; `.editor-overlay` and its inner `<code>` were pinned to `white-space: pre`. So as soon as any line in the buffer was long enough to wrap, the overlay's colored text overflowed horizontally while the textarea's actual text wrapped onto a second visual row. Every line below the wrap then rendered the *overlay's* colors on a different row than the *textarea's* actual caret — colored text drifted upward, away from where you were actually editing. Fixed by setting `white-space: pre-wrap; overflow-wrap: break-word` on both `.editor-overlay` and `.editor-overlay > code` so the overlay's wrap rules are byte-identical to the textarea's. Also switched `.editor-overlay` from `overflow: auto` → `overflow: hidden` (with wrapping on, horizontal scroll is no longer needed or wanted).
- **Active-line highlight strip was on the wrong visual row after any wrapped line.** `updateActiveLineMarker()` used the formula `top = padTop + lineNum × linePx − scrollTop`, which assumes every logical line is exactly one visual row tall. The moment any prior line soft-wrapped, the strip landed on the wrong row. Rewrote it to sum the *actual* per-line heights from the gutter children (which already carry wrap-aware heights computed via the mirror element in `syncGutter`). Falls back to the simple formula only before the gutter is populated (first paint). Regression test added in `test/editor-gutter.test.js`.
- Measured against the running app: after the fix, overlay-line-top matches textarea-text-line-top within 0 px for every line in a buffer with wraps, and the active-line strip top matches the gutter number top within 0 px. Pre-fix these were off by 22 px per wrapped row above the caret.

## [0.21.8] - 2026-07-21

### Fixed — zero-drift editor line number gutter
- **Subpixel line-height drift completely eliminated.** Enforced integer pixel `linePx` (`Math.round(lineHeight)`) explicitly on `<textarea>`, `.gutter`, `.editor-overlay`, and `gutterMirror`. This forces native `<textarea>` line box heights to match `.gutter` DOM row heights to 0.00px precision across documents of any length.

## [0.21.7] - 2026-07-21

### Fixed — editor line number gutter typography alignment
- **Line numbers (gutter) vertical alignment fixed.** Synchronized `fontSize`, `lineHeight`, `paddingTop`, `paddingBottom`, and `fontFamily` from the editor `<textarea>` directly to `.gutter` and its child row elements (`.gutter > div`). This ensures line numbers match the exact line-box height and vertical baseline position of editor lines regardless of document length, font settings, or zoom level.
- **Zoom & font scaling gutter sync.** `applyZoom()` now scales `el.gutter.style.fontSize` and triggers `syncGutter()` on editor zoom/font updates so line numbers re-align dynamically.

## [0.21.6] - 2026-07-21

### Fixed — caret invisible under syntax highlighting
- **The text cursor (caret) was invisible in markdown and other highlighted files.** When `.highlight-on` flipped the textarea's text to `transparent` (so the colored syntax overlay could show through), browsers computed `caret-color` from `color` — which meant the caret inherited `transparent` and vanished. Pinned `caret-color: var(--fg)` on `.editor` so the caret is always a solid themed color regardless of the transparent-text overlay state. The previous comment claiming "caret-color is left untouched so the caret remains visible" was wrong; this fixes the actual bug.
- Editor `.editor::selection` now pins selection background to `var(--accent-soft)` so selected text is visible across all themes even when the editor text is transparent.

### Added — active-line highlight
- **A subtle tinted strip now marks the line containing the caret**, so you can always see where you are even when the text itself is transparent under the syntax overlay. The strip is painted by `.editor-wrap::before` and positioned via two CSS vars (`--active-line-top`, `--active-line-h`) updated by `editor.js` on input, click, scroll, and resize. The strip sits behind the textarea + overlay (z-index: 0) so it never obscures text or syntax colors.

### Changed — editor layering discipline
- `.editor` now has unconditional `position: relative; z-index: 1` (previously only under `.highlight-on`). This ensures the textarea paints above the wrap's `::before` active-line strip in both highlight-on and -off states.

## [0.21.5] - 2026-07-21

### Fixed — comprehensive editor layout overhaul
- **Line numbers (gutter) and text alignment fixed.** Previously the gutter was a flex sibling of the textarea, and the highlight overlay spanned the full editor-wrap width — so the overlay's text rendered ON TOP of the gutter area (where line numbers live) whenever syntax highlighting was on. Reworked the layout:
  - Gutter is now `position: absolute` (out of flex flow) at the left edge with its own opaque background and `z-index: 3` so it paints over anything underneath.
  - Textarea and overlay both span the FULL editor-wrap width and share the same coordinate system, with `padding-left: 64px` (= 44 gutter + 20 text inset) so their text starts AFTER the gutter strip. Their text positions are now perfectly aligned by construction.
- **Gutter numbers now align with soft-wrapped lines.** Previously each logical line got exactly one gutter row (22px) regardless of how many visual rows it wrapped to — so long paragraphs would drift the numbers below them out of sync. Now `syncGutter()` measures each logical line's rendered height via a hidden mirror element (matching the textarea's font, padding, and width) and sizes the corresponding gutter row to `rows × lineHeight`. Empty/short lines get one row; wrapped paragraphs get multiple rows. The result: line numbers always line up with their text, no matter how the content wraps.
- A `ResizeObserver` on the textarea re-syncs the gutter on window resize, sidebar toggle, theme change, or any other resize — so the alignment survives layout shifts.
- `.editor-wrap` now provides the visible editor background; the textarea's background is transparent (when highlight-on) so the syntax overlay behind it actually shows.

### Improved — share modal UX
- **End Session button redesigned**: now has an inline disconnect icon, becomes prominent (solid red, white text, bold) only when a session is actually active, and stays quiet/hidden before then. Clicking it correctly closes the share modal AND dismisses the "Live" status pill in the header.
- **Share modal status box** is now a styled card with a pulsing colored dot — green/accent when peers are connected, red on errors, grey when waiting. Reads as a real status indicator instead of plain text.
- Share modal is now slightly wider (`min-width: 480px`) so the invite URL + Copy button sit comfortably without truncation.
- The invite-link block (input + footnote) collapses with a transition once a peer connects — no need to keep showing "Copy" when the session is already live.

## [0.21.4] - 2026-07-21

### Fixed
- **MAJOR: editor text was invisible when syntax highlighting was on.** The textarea had `background: var(--bg)` (solid color) which completely covered the highlight overlay sitting behind it at z-index:0. Even though the textarea's text was made transparent (per the overlay technique), the solid background hid the overlay's colored text — so users saw a blank white editor pane while typing.
  - Fix: textarea background is now `transparent` when `.highlight-on` is active; the editor-wrap parent provides the visible background instead.
  - Verified with a headless browser + OCR: editor text now appears in both highlight-on and highlight-off modes (previously only worked in highlight-off).

## [0.21.3] - 2026-07-21

### Fixed
- **MAJOR: edit-mode preview was collapsing to ~96px wide**, causing rendered markdown to wrap one-word-per-line. The root cause was a CSS rule from v0.16.5 (`.markdown-body { width: 0 }`) that's correct for `#document` in view mode (where it's a row flex item and `width: 0 + flex: 1` means "grow to fill"), but wrong for `#preview` in edit mode (where it sits inside `.preview-pane`, a column flex container — there `width: 0` literally zeroes the width and `align-items: stretch` can't override an explicit width).Scoped `width: 0` to `.view-mode` only and added an explicit `width: 100%` rule for `.preview-pane > .markdown-body`. Verified with a headless browser + OCR: preview pane is now 631px wide and paragraphs wrap naturally across multiple words. This regression had been present since v0.16.5 but only became visible after the v0.21.0 collab work led users into edit mode more often.

## [0.21.2] - 2026-07-21

### Fixed
- **Share modal status logic was brittle:** opening Share while a session was already active reset the status to "Waiting…" even when peers were connected, and the End Session button only appeared after a peer joined (so the host couldn't cancel a stuck "waiting" session). Reworked into a single `refreshShareModal(status)` helper that drives the status text, link row visibility, and End button state from one place. The End Session button is now always available once a session is active.
- **Host-left wasn't tearing down the receiver's session:** when the host disconnected, the receiver's UI was notified but the underlying Yjs/Trystero session stayed alive, leaving a zombie session that blocked starting a new one. The host-left handler now reads the final Yjs state into the doc, marks it dirty (so the user is prompted to save), then calls `endSession()` cleanly.
- **Connection lifecycle hardening:** all `collab.bindEditor` / `collab.endSession` / `collab.unbindEditor` calls in main.js are now wrapped in try/catch so a collab hiccup never blocks normal editing or tab switching. The receiver's requestAnimationFrame after `joinSession` also re-checks `getStatus().active` before binding (defends against the user canceling mid-connect).
- **Receiver's tab now keeps its edits when the host leaves:** the doc content is captured from the live editor before teardown, and the tab flips to a normal unsaved doc (dirty flag set) so "Save as…" preserves the work.
- **Status pill now has an inline × button** to end the session without having to open the Share panel. The pill body still opens the panel.

### Changed
- **Share modal's "Close" button renamed to "Hide panel"** to make clear it doesn't end the session (the End Session button is the destructive action). Removed the `hidden` class from End Session in the markup — visibility is now driven entirely by `refreshShareModal` based on session state.

## [0.21.1] - 2026-07-20

### Fixed
- **"Could not start session: object is not iterable" when clicking Share:** the Trystero v0.25 API returns action objects (`{ send, onMessage, onReceiveProgress }`), not `[send, onMessage]` tuples. Updated the provider to use the object form. Also corrected `onPeerJoin`/`onPeerLeave` (now settable properties, not callback registrars) and the per-peer targeting option (`target`, not `to`).
- **Editing markdown felt broken after attempting to share:** local edits were echoing back through `setValue()` because the Yjs update from our own keystroke triggered our own remote-update handler, clobbering the caret on every key. Now tag our own edits with `transaction.origin = 'self'` and skip them in the remote handler.
- **Failed `startSession` left the Yjs doc + state half-initialized,** so subsequent Share attempts wrongly thought a session was already running. Now both `startSession` and `joinSession` tear down cleanly on failure.

## [0.21.0] - 2026-07-20

### Added
- **Real-time P2P collaboration:** invite someone to edit your document live, Google-Docs-style, over a direct peer-to-peer connection. No accounts, no servers, no setup beyond sharing a link.
  - **How to start:** open any markdown or plain-text document, click the new **Share** button in the toolbar (next to Present), copy the invite link, and send it to your collaborator. They click the link, mdpeek opens, and a shared tab appears with both of you editing the same document.
  - **Invite links:** `mdpeek://join?room=<16-char-id>`. Clicking the link on a machine with mdpeek installed opens the app and prompts to join. The custom URL scheme is registered with Windows at install time.
  - **Conflict-free editing:** powered by **Yjs** (a CRDT library). Both of you can type at the same cursor at the same time — concurrent edits merge deterministically and never conflict.
  - **Serverless P2P:** uses **Trystero** (WebRTC) with public BitTorrent trackers as a rendezvous. All traffic is direct between the two machines and encrypted via WebRTC's DTLS. We don't run any servers for this.
  - **Live cursors:** see your collaborator's cursor position + name in real time, rendered as a colored bar over the editor.
  - **Host owns the file:** the host's Save (Ctrl+S) writes to disk normally; the receiver's tab is a transient shared view. If the host ends the session, the receiver's tab converts to a local unsaved document they can "Save as…" to keep their copy.
  - **Status pill:** a pulsing "Live · N peers" indicator in the header shows the connection state. Click it to reopen the share panel.
  - **Smart close guards:** closing the shared tab, closing the app window, or quitting all prompt before tearing down the session (so you don't accidentally end a live session).
  - **Installer growth: +71 KB** (6.13 MB → 6.20 MB) — Yjs + Trystero + the deep-link plugin combined.
  - **Command palette:** "Share for live collaboration" and "End collaboration session" entries.

### Notes
- **Works on most home networks** out of the box. Strict corporate VPNs/firewalls and some cellular NATs may block WebRTC connections — in that case, the receiver sees a "could not reach the host" error and should try a different network. A paid TURN relay would fix this but isn't included (out of scope for v0.21.0).
- **Anyone with the invite link can edit.** Room IDs are 80-bit random (guessing is infeasible), but there is no authentication layer. Don't share sensitive documents publicly.
- **`mdpeek://` scheme registration** happens at install time. Users who upgrade from v0.20.0 (rather than installing fresh) may need to re-run the installer for the scheme to be registered.
- One collaboration session per app instance for MVP. Multiple simultaneous shared docs + chat sidebar + voice + mobile are out of scope for this release.
- Shared tabs are not persisted across restarts — they're tied to the live network session.

## [0.20.0] - 2026-07-20

### Added
- **Presentation mode:** turn any markdown document into a fullscreen slideshow by splitting on `---` (three or more hyphens on their own line). Click the new Present button in the toolbar (next to Export PDF) or use the command palette ("Start presentation"). Each slide gets its own centered article; navigate with the keyboard or by clicking the screen.
  - **Keyboard:** `→` `↓` `PageDown` `Space` = next, `←` `↑` `PageUp` = previous, `Home`/`End` = jump to first/last, `F` = OS fullscreen, `S` = toggle style, `Esc` = exit.
  - **Click:** on-screen arrows, or click the left/right half of the stage.
  - **Two switchable styles** (press `S`): **Deck** (dark backdrop, big centered text — looks like Keynote/PowerPoint) and **Reading** (uses your app theme + normal text size). Persists across sessions.
  - **YAML front-matter** is stripped automatically so it isn't read as slide 1.
  - **Docs with no `---`** still work — they open as a single-slide fullscreen reading view.
  - **Zero installer growth** (6.13 MB, same as v0.19.0) — no new dependencies; reuses the existing markdown renderer + app theme tokens.
  - Toolbar button + command palette entry are visible only for Markdown documents.

### Notes
- External file edits during a presentation are not live-synced to the slides; exit + re-enter to pick up changes.
- `---` inside a code fence is treated as a slide break (rare edge case; correct handling would require AST parsing).

## [0.19.0] - 2026-07-20

### Added
- **Live syntax highlighting in the editor:** code and markdown files now get colored as you type in edit mode. Uses a transparent-text overlay technique — the textarea stays native (caret, selection, IME, spellcheck all unchanged) while a `<pre><code class="hljs">` layer behind it shows the highlighted text.
  - Reuses the already-bundled highlight.js (~36 languages built-in, plus on-demand loading for extras like `dockerfile`, `toml`, `ini`).
  - **Zero installer growth** (6.13 MB, same as v0.18.3) — no new dependencies, just CSS + JS reuse.
  - Theme-aware: colors follow the active app theme automatically (light/dark/dracula/nord/etc.).
  - Works for markdown too — headings, bold, code spans, links, and fenced blocks get subtle color.
- **New setting:** Settings → Editor → "Syntax highlighting in editor" (default on). Toggle live without restart.

### Changed
- `initEditor` accepts `language` + `highlightEnabled` options; the shared editor instance re-applies the language on every tab switch.
- Editor `applyResult` / `insertAtCursor` now also re-highlight the overlay (programmatic value changes don't fire `input`).

## [0.18.3] - 2026-07-19

### Added
- **File operations in the explorer:** right-click any file or folder in the file tree to get a full context menu — **Cut** (Ctrl+X), **Copy** (Ctrl+C), **Paste** (Ctrl+V), **Rename** (F2), **Delete** (Del), plus "Search in folder…" on directories. Standard Windows-explorer UX backed by four new Rust commands:
  - `delete_path` — moves to the OS Recycle Bin via the `trash` crate (recoverable, never permanent).
  - `rename_path` — atomic rename with full-path destination + overwrite guard.
  - `copy_path` — recursive copy of files OR directories, always produces a non-colliding name (`foo (copy).md`, `foo (copy 2).md`, …).
  - `move_path` — Cut+Paste: fast atomic rename first, copy+trash fallback for cross-volume edge cases.
- **Inline rename editor in the tree:** Rename turns the row's name into a focused text input prefilled with the current name. For files, the extension stays unselected (matching Explorer). Enter commits, Esc cancels, blur commits. Rejects illegal Windows filename characters (`\ / : * ? " < > |`).
- **Keyboard shortcuts for tree ops:** Ctrl+X / Ctrl+C / Ctrl+V / Delete / F2 fire on the last-clicked tree row — but only when focus isn't in the editor or an input field, so normal text editing is never hijacked.
- **Cut visual feedback:** rows on the clipboard via Cut are dimmed + struck-through until pasted.
- **Smart delete confirmation:** the delete dialog lists how many open tabs will close (and how many have unsaved changes) BEFORE the delete happens, so you're not surprised by a second unsaved-changes prompt afterwards.

### Fixed
- **Settings → Changelog panel was invisible:** the `#changelog-content` div had a `markdown-body` class whose `width: 0` rule (intentional for the flex-driven document pane) collapsed the panel to nothing. Removed the class; the standalone `.changelog-body` CSS now styles every element (h1/h2/h3/p/ul/ol/li/a/code/pre/hr/strong) itself.

## [0.18.2] - 2026-07-19

### Added
- **"Open folder" action on the home screen:** The welcome card now has a fourth primary action alongside Open file / New note / Today's note. Opens the folder picker directly so the tiny folder icon in the explorer header is no longer the only way in. Shortcut hint `Ctrl+Shift+E` shown on the button.
- **Settings → Changelog panel:** Bundles `CHANGELOG.md` at build time (via Vite's `?raw` import — zero config, no new deps) and renders it as sanitized markdown inside a new dedicated settings category. Links in the changelog open in the system browser via the existing `plugin-opener` routing.
- **Settings → About panel:** New category with app logo, version, tagline, and two prominent buttons: **"View on GitHub"** (opens `https://github.com/sanketpatel32/Mdpeek`) and **"Report an issue"** (opens the issue tracker). Designed for discoverability of the project's source and contribution entry points.
- **Settings → Tips panel:** Split out from the old combined "Help" category into its own panel, with refreshed content covering image annotation, CSV viewing, folder-wide search, and pinnable tabs (all features added in v0.17–v0.18 that weren't previously documented in-app).

### Changed
- **Settings sidebar reorganized into 7 flat categories:** General, Appearance, Editor, Shortcuts, Tips, Changelog, About. The previous single "Help" category is split into Shortcuts + Tips, with Changelog and About added as new top-level entries. Each topic is now one click away.
- **Home screen responsive sizing:** Card width changed from a fixed `760px` cap to `min(820px, 94vw)` so wider windows use the extra room. Padding switched to `clamp()` so small windows get tighter spacing without overflowing. Added a mid-tier breakpoint at `880px` for ~700–900px windows.
- **Toolbar declutter — Save button now hides when not applicable:** The Save button (Ctrl+S) was previously always visible, including on the welcome screen and on read-only viewers (PDF / image / CSV / Excalidraw) where it does nothing. New `syncToolbarForDoc(doc)` helper, called once per render, hides it in those contexts. All other toolbar buttons were already correctly gated per-branch.

### Fixed
- **Toolbar button consistency:** Consolidated scattered visibility logic so the rules are documented in one place (`syncToolbarForDoc`), making future additions obvious.

## [0.16.5] - 2026-07-19

### Fixed
- **Root-cause fix for welcome screen height:** Properly established the full flex-chain from `body → .workspace-container → main#view-mode → article#document`. Changed `.view-mode` to `display: flex; flex-direction: row` (so TOC and document sit side-by-side) and gave `#document (.markdown-body)` `flex: 1; overflow-y: auto` so it claims all remaining space and scrolls independently. The `has-welcome` article now expands to fill the entire viewport height through native flexbox, without needing `height: 100%` hacks.

## [0.16.4] - 2026-07-19

### Fixed
- **Fixed startup welcome screen rendering:** Unified the welcome page startup path by routing empty launch states and error fallbacks through `renderActive()`. This ensures that class assignments, styling bounds, and Table of Contents (TOC) sidebar auto-collapsing are fully loaded and applied at initial startup, preventing sidebar shift on cold start.
- **Glassmorphism Welcome Card & Centering Scroll:** Added frosted-glass backdrop blurring (`backdrop-filter`) to the welcome card overlay. Changed alignment to `margin: auto` to prevent vertical overflow cutoff bugs on smaller screens, ensuring it scrolls gracefully without clipping.

## [0.16.3] - 2026-07-19

### Added
- **Material-style custom file glyphs:** Replaced generic file outline icons with distinct, lightweight SVG shapes for each file category: Markdown (M-symbol document), PDF (P-symbol document), Code (brackets `<>`), Image (mountains/sun outline), Vector Drawing (square/circle geometry), and Text (document lines).
- **Absolute Welcome Screen Centering:** Removed static height declarations and replaced them with robust, flexbox-native viewport adjustments to prevent vertical offset overflows.

## [0.16.2] - 2026-07-19

### Fixed
- **Fixed file type icons collapsing:** Added explicit CSS dimensions (`width`/`height` and `min-width`/`min-height`) to the `.file-icon` class in `base.css` to prevent browser flex layout engines from collapsing SVGs in tabs and directory tree views to 0px.
- **Fixed Welcome Screen off-center layout:** Gated the Table of Contents (`#toc`) sidebar visibility in `renderActive()` to collapse the sidebar when showing non-markdown documents (PDF, Excalidraw, Code files) and the Welcome Screen. This ensures that the Welcome card centers vertically and horizontally in the window without shifting.

## [0.16.1] - 2026-07-19

### Added
- **Explorer context menu settings toggle:** Added a toggle switch in the General Settings panel to register/unregister the "Open with mdpeek" context menu options in Windows Explorer (writing to current user registry HKCU, avoiding admin UAC requests).

## [0.16.0] - 2026-07-19

### Added
- **Frosted ambient home screen design:** Redesigned the welcome page to use modern radial-gradient ambient glow backdrops.
- **Fixed home screen layout alignment:** Fixed the layout vertical centering/height issue by adding flex column constraints and 100% height configuration to the `.markdown-body.has-welcome` layout parent.

## [0.15.9] - 2026-07-19

### Fixed
- **Optimized editor preview rendering:** Prevented Markdown preview parsing and DOM rendering tasks from running in the background when the preview pane is hidden (e.g., when editing `.txt` files or code files). Checking visibility via `offsetParent` bypasses unnecessary CPU overhead on every keystroke.

## [0.15.8] - 2026-07-19

### Added
- **Unified File Icons:** Replaced text badges in tabs with modern, lightweight SVG document icons that match the file explorer sidebar.
- **Harmonious File Type Color Palette:** Extended CSS file-icon color mappings to tabs and directory explorer for markdown (violet), pdf (red), image (green), code (purple), excalidraw (orange), and plain text (warm sand), creating a cohesive and scannable visual language.

## [0.15.7] - 2026-07-19

### Added
- **Editable code documents:** Enabled editing support for all code and configuration files (JavaScript, Python, JSON, CSS, TOML, YAML, etc.). Code files can now be toggled between a read-only syntax-highlighted preview and a full-width code editor (`Ctrl+E` or edit toggle).
- **Disk changes sync for editing code files:** Extended the file watcher disk reload functionality to hot-reload code files when edited externally, safely matching the unsaved edits preservation behavior used for Markdown files.
- **Images read-only restriction enforcement:** Enforced read-only safety for image documents in the mode toggle system.

## [0.15.6] - 2026-07-19

### Fixed
- **Lazy syntax highlighting update:** Dispatched a custom `hljs-language-registered` event when extra languages are dynamically loaded, prompting the active document to immediately re-render with syntax highlighting without requiring a tab switch or edit event.
- **PDF annotation zoom scaling:** Scaled drawing strokes (pen, highlighter) in the PDF viewer canvas by the current zoom level (`scale / 1.5`), maintaining stroke weight proportion relative to PDF content.
- **Accurate PDF drawing eraser:** Improved the eraser hit logic in `pdf-viewer.js` to perform a precise distance check to the stroke's coordinates, preventing accidental deletion of large/diagonal lines from hits in their bounding box empty space.

## [0.15.5] - 2026-07-19

### Added
- **Top-level Windows Explorer Context Menu integration:** Added top-level context menu options "Open with mdpeek" for all files and "Open folder in mdpeek" for directories via Windows Registry.
- **Explorer another folder picker:** Added an icon button in the File Explorer sidebar header to open another folder, and an "Open folder..." button in the empty file tree state.
- **Improved editor font family support:** Linked the editor's textarea font directly to the user-selected reading comfort font setting (supports Cascadia Code, Monospace, Serif, Helvetica, Inter, etc. with `!important` guards to secure overrides).
- **Settings page UI visual redesign:** Enhanced settings card layouts with elevated surfaces (`var(--bg-elevated)`), rounded card edges (`var(--radius-lg)`), soft shadows, and added click-scale active animations on sidebar categories and segmented button controls.

## [0.15.4] - 2026-07-19

### Fixed
- **File Explorer availability in Edit Mode:** Restructured the HTML workspace layout so that the File Explorer sidebar is a sibling to both View and Edit modes inside a common `.workspace-container`. This keeps the file tree sidebar fully accessible and interactive in both View and Edit modes.
- **Focus mode outline hiding:** Updated focus (zen) mode to also hide the file explorer sidebar when activated.

## [0.15.3] - 2026-07-19

### Added
- **Active outline section highlighting:** The Table of Contents sidebar now dynamically highlights the section header corresponding to the content currently scrolled into view.
- **Active tab accent line:** Active tabs now have a subtle accent bottom border indicating the selected document clearly.
- **Floating rounded scrollbars:** Scrollbar thumbs now use transparent borders and `background-clip: padding-box` to float beautifully without contrasting borders on sidebar and document views.
- **Welcome screen visual polish:** Welcome cards now utilize elevated backgrounds with a softer shadow, and primary/secondary buttons have premium hover shadow and translateY lift animations.
- **Active command palette line:** Active items in the command palette / quick switcher now have a distinct left border accent.

## [0.15.2] - 2026-07-19

### Added
- **Code line numbers:** Added a line-number gutter to the code viewer.
- **Clearer daily notes path configuration:** Added an explanatory dialog before the folder picker and displayed the path with a 'Choose...' button in settings.
- **Settings resize fix:** Fixed settings layout container height to prevent dialog resizing.

## [0.8.7] - 2026-07-16

### Fixed
- **The + button works again.** Moving the + button outside the scrollable tab
  strip (in v0.8.5) broke its click handler — it was caught by the tab-strip
  listener that no longer covered it. Now has its own dedicated listener.

## [0.8.6] - 2026-07-16

### Added — expanded font options
- **5 more font choices** in Settings → Appearance → Font: Inter / SF Pro,
  Helvetica / Arial, Verdana, Times New Roman, and Cascadia Code (in addition
  to System Sans, Serif, and Monospace). All use OS-installed font stacks —
  zero download, zero bundle cost. Falls back gracefully if a specific font
  isn't installed.

## [0.8.5] - 2026-07-16

### Fixed — tab scrolling
- **The + button no longer scrolls away.** The tab strip now has a pinned
  container: the scrollable tab list on the left, the + button fixed on the
  right. Scrolling through many tabs keeps + accessible at all times.
- **Mouse-wheel scrolling.** Vertical wheel now translates to horizontal scroll
  on the tab strip — standard mice (without trackpads) can now scroll through
  many tabs.
- **Active tab auto-scrolls into view.** Switching to a tab that's scrolled out
  of view now smoothly brings it visible.

### Added — font family setting
- **Font option in Settings → Appearance.** Choose between System Sans (default),
  Serif (Georgia), or Monospace for document text. Applied live via a CSS
  variable; persists across sessions.

## [0.8.4] - 2026-07-15

### Fixed — Excalidraw session persistence
- **Untitled Excalidraw tabs survive a restart.** Previously the `excalidraw`
  type flag was re-derived from the file path on restore — but untitled tabs
  have `path: null`, so the flag was lost. The tab restored as a markdown doc
  and displayed the raw Excalidraw JSON as text. Now `serialize()` persists the
  `plain`, `pdf`, and `excalidraw` flags explicitly, and `restore()` prefers
  the persisted flag over path-only derivation.

## [0.8.3] - 2026-07-15

### Fixed — stability (6 HIGH + 5 MEDIUM from code audit)
- **Confirm dialog listener leak** — `{ once: true }` listeners that never fired
  (resolved via button click) accumulated across dialog opens. Now properly
  removed in `done()`.
- **Tab-switch race condition** — rapid switching while PDF/Excalidraw was loading
  could leak controllers. Fixed with a monotonic render-generation counter;
  stale async results are torn down.
- **Unhandled async rejections** — `toggleMode()`, `closeTab()` (middle-click,
  context menu), and `win-maximize` now have `.catch()` guards.
- **File-changed data loss** — if a file changes on disk while you're mid-edit
  with unsaved changes, the external change is no longer silently clobbering
  your work. A toast notifies you and your edits are kept.
- **Find-bar NaN scroll** — `line-height: normal` (non-numeric) caused
  `scrollTop = NaN`. Added a `|| 20` fallback.
- **Excalidraw React root orphan** — if the initial React render threw, the root
  was orphaned. Now unmounts on failure before rethrowing.
- **Null guards** — `icoMax`/`icoRestore` in `syncMaxIcon()` now null-checked.
- **Shared `escapeHtml`** — consolidated 3 inline copies (pdf-viewer,
  excalidraw-viewer, tabs) into one shared `src/lib/escape.js` that escapes
  quotes too.
- **Dead code removed** — unused `PALETTE` export from pdf-viewer.js.

### Changed — settings UI redesign
- **Section grouping** — settings now organized into 3 sections (General,
  Appearance, Editor) with card-style containers and section titles, like macOS
  System Settings.
- **Hover rows** — individual setting rows highlight on hover within their card.
- **Row dividers** — hairline separators between rows in a section.
- **Sticky footer** — the Reset/Done footer has a top border separator; the
  Reset button is de-emphasized and turns red on hover.
- **Responsive** — on narrow windows, setting rows stack vertically (label on
  top, control below).
- **Toggle sizing** — toggle track normalized from 22px → 24px to match the
  height of selects and segmented controls.

## [0.8.2] - 2026-07-15

### Fixed — Excalidraw theme sync
- **Excalidraw canvas now follows the app theme.** Switching to a dark theme
  (Dracula, Nord, Tokyo Night, etc.) now switches the Excalidraw canvas to dark
  mode too. Switching back to a light theme reverts it. Works live — no tab
  re-open needed.

## [0.8.1] - 2026-07-14

### Fixed — Excalidraw rendering + startup stability
- **Excalidraw now actually renders.** The `store.open()` call was silently
  dropping the `excalidraw: true` flag, so new Excalidraw tabs were created as
  plain empty docs (hitting the welcome screen instead of the canvas).
- **Excalidraw CSS loaded.** The library ships its own stylesheet
  (`dist/prod/index.css`) which was never imported — without it the UI was
  completely unstyled. Now lazy-loaded alongside the JS modules.
- **Container height fix.** Excalidraw fills its parent and collapses to 0px
  without explicit height. The host container now has `height: 100%` +
  `overflow: hidden`.
- **Startup crash recovery.** The entire startup IIFE is now wrapped in a
  try/catch — if anything throws (corrupt session, render error, module load
  failure), the app falls back to the welcome screen instead of leaving the
  user staring at a blank window ("sometimes it doesn't open").
- **`renderActive()` errors caught.** The `store.on('change')` handler now
  catches render errors and shows the welcome screen as a last-resort fallback,
  preventing the app from freezing on a tab switch.

## [0.8.0] - 2026-07-14

### Added — Excalidraw canvas
- **Full Excalidraw integration** — a new tab type that gives you the complete
  Excalidraw drawing canvas: shapes, text, arrows, freehand, images, eraser,
  laser, pan/zoom, selection/move/resize, and built-in export (PNG/SVG via
  Excalidraw's hamburger menu).
- **Three ways to open:** Settings → New tab format → Excalidraw, then click `+`;
  or drag-drop a `.excalidraw` file; or double-click a `.excalidraw` file in
  Explorer (mdpeek registers in the "Open with" menu).
- **Auto-save** — drawings are saved to the tab's content as JSON (debounced 1s),
  so switching tabs and back preserves your work. Ctrl+S saves to disk as a
  standard `.excalidraw` file, openable in any Excalidraw instance.
- **Lazy-loaded** — React + ReactDOM + Excalidraw (~390 KB gzip combined) only
  download when you open an Excalidraw tab. Markdown and PDF users pay zero
  cost; startup time is unchanged.
- Tab badges now show the file type: **MD** for markdown, **PDF** for PDFs,
  **EX** for Excalidraw (previously all saved files showed "MD").

### Weight
- Installer: 4.48 MB → **~5.3 MB** (React + Excalidraw bundled into `dist/`,
  fetched on demand only when an Excalidraw tab is opened).

## [0.7.2] - 2026-07-14

### Added
- **PDF page-number badge** — a small "X / Y" pill appears at the bottom-center
  of the document pane while scrolling a PDF, showing your current page and the
  total. It auto-fades after 1.2s of inactivity.

### Confirmed
- The drawing/annotation toolbar button is verified PDF-only (it was already
  hidden on non-PDF tabs; this confirms and documents the behavior).

## [0.7.1] - 2026-07-14

### Fixed — PDF marker + text selection
- **Text selection now works.** The text-layer CSS was missing the
  `font-size: calc(var(--text-scale-factor) * var(--font-height))` rule that
  pdf.js relies on — without it, the transparent spans were zero-sized and
  invisible to selection. Also sets `--scale-factor` on the container so the
  calc resolves at the right size.
- **Drawing is smooth.** Strokes now use quadratic curve smoothing (midpoint
  method) instead of straight line segments, eliminating the jagged corners at
  high drawing speed. Active strokes are full-re-rendered on each pointer move
  (sub-millisecond) for seamless curves.
- **Highlighter looks clean.** Removed `globalCompositeOperation: multiply`
  (which produced muddy dark overlaps on transparent canvas) — highlighter now
  uses `globalAlpha: 0.35` only, matching how real highlighters layer.
- Single-point strokes (dots) now render as filled circles instead of
  invisible zero-length lines.

## [0.7.0] - 2026-07-13

### Added — PDF text selection, search, and drawing annotations
- **Text selection** — drag to select text inside a PDF, just like a normal web
  page. Copy with Ctrl+C. Works via a transparent text layer (pdf.js
  `TextLayer`) overlaid on each page.
- **In-PDF search** — Ctrl+F now searches inside PDFs. Matches are highlighted
  across all pages; next/prev scrolls through them. The find bar dispatches to
  a dedicated PDF search path that extracts text per page (cached after first
  search for instant next/prev).
- **Drawing annotations** — a floating toolbar (pen, highlighter, eraser, 5
  colors, clear-all) lets you mark up PDFs. Click the pen/pencil icon in the
  toolbar (appears only on PDF tabs) to open it. Annotations are session-only
  (clear on tab close). Strokes re-render correctly on zoom.

## [0.6.0] - 2026-07-13

### Added — PDF viewing
- **Open and view `.pdf` files** inside mdpeek. Drag-drop, Ctrl+O, or
  double-click a PDF in Explorer (mdpeek registers in the "Open with" menu).
  Pages render cleanly as stacked canvases with crisp HiDPI support.
- **Lazy-loaded** — pdf.js (~125 KB + worker) only downloads when you actually
  open a PDF. Markdown-only users pay zero cost; startup time is unchanged.
- **Read-only** — PDFs have no edit mode (the toggle is hidden). Zoom (Ctrl+= /
  Ctrl+-) scales the rendered pages.
- **Memory-safe** — switching away from a PDF tab tears down the viewer
  (cancels pending renders, frees the pdf.js document). Switching back reloads
  and restores your scroll position.
- Pages render lazily as you scroll (IntersectionObserver), so large PDFs
  don't try to render everything at once.
- Corrupt or encrypted PDFs show a friendly error instead of crashing.
- The PDF bytes are loaded via the Tauri asset protocol — they never pass
  through the text-based content channel, so binary never touches String.

### Changed
- File dialog now offers a PDF filter (and "All files").
- The Rust file-reading commands return empty content for `.pdf` paths instead
  of failing on UTF-8 decode of binary bytes.
- `.pdf` registered as a Windows file association (mdpeek appears in "Open with").

## [0.5.2] - 2026-07-13

### Added
- **Line numbers toggle** in Settings — turn the editor's line-number gutter on
  or off. Off gives a cleaner, distraction-free writing surface (the editor
  expands to full width). Default on. Applies immediately and persists.

## [0.5.1] - 2026-07-13

### Added — 4 new themes + reading comfort
- **GitHub** and **GitHub Dark** — GitHub.com's actual palettes (cool grey
  surfaces, GitHub-blue links).
- **Tokyo Night** — Enkia's deep-blue nightscape with pastel accents.
- **Catppuccin (Mocha)** — the cozy warm-dark palette with soft pastels.
- All four appear in both the theme dropdown and the settings dialog, each with
  a color-swatch preview.
- **Font size** setting (Small / Medium / Large / Extra Large) — the base size
  for document text. Zoom multiplies this, so the controls compose naturally.
- **Line spacing** setting (Compact / Normal / Relaxed) — vertical rhythm
  between lines.

### Changed — theme polish
- **Alert callouts are now theme-aware.** GFM `> [!NOTE]` / `[!TIP]` /
  `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` callouts previously used
  hardcoded GitHub-light colors that looked wrong on Dracula, Nord, Solarized
  Dark, and other dark themes. Each theme now defines its own alert palette via
  CSS variables.
- Nord's muted-text color tuned down (`#81a1c1` → `#6c7a93`) so secondary text
  reads as muted rather than as a second accent.
- New dark themes get per-theme shadow tuning so elevated surfaces (modals,
  cards) read clearly.

## [0.5.0] - 2026-07-13

### Added — markdown engine overhaul
- **Footnotes** — `text[^1]` with a `[^1]: note` definition now renders a real,
  clickable footnote reference and a footnotes section at the bottom of the
  document. Previously this syntax produced a broken link.
- **Heading IDs** — every heading gets a GitHub-style slugified id
  (`## Hello World` → `id="hello-world"`), so in-document `#anchor` links and
  the table of contents point at stable targets. Duplicate headings get
  `-2`, `-3` suffixes.
- **GFM alert callouts** — `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`,
  and `[!CAUTION]` blockquotes render as themed callout boxes with a colored
  left border, tinted background, and an icon + title line (matching GitHub).
- **Task list styling** — `- [x]` / `- [ ]` checkboxes now render as custom
  accent-colored boxes with a check mark; completed items are muted.
- **More syntax-highlight languages** — Dockerfile, TOML, INI, Makefile, LaTeX,
  Nginx, Diff, Protobuf, and Groovy are now highlighted (dynamically loaded on
  first use, so they add zero KB to the initial download).
- **Link hardening** — every link in rendered markdown now carries
  `target="_blank"` + `rel="noopener noreferrer"` (defense in depth alongside
  the system-browser routing).
- **Render cache** — identical markdown is now cached (LRU, 64 entries), so
  tab switches and repeated edit-mode preview renders skip re-parsing.

### Changed
- `buildToc` reuses the renderer's slugified heading ids instead of always
  assigning generic `h-N` ids.

### Tests
- Renderer tests grew from 14 → 22 (heading ids + dedupe, footnotes, alerts,
  task lists, link hardening, render cache). 89/89 pass.

## [0.4.6] - 2026-07-13

### Added — settings dialog
- **Settings modal** — a gear icon in the toolbar opens a single dialog listing
  every preference. No more hunting through separate menus.
- **New tab format** — choose whether the `+` button (and Ctrl+N) creates a
  Markdown document or a Plain Text document. Plain-text tabs open as a
  full-width editor with no preview, just like `.txt` files.
- **New tab opens in** — set whether new Markdown tabs start in View or Edit
  mode.
- **Theme** picker, **close-button action** (Ask / Tray / Quit), and **Find:
  match case** default are all surfaced here too. Theme and find-case apply
  live; the rest take effect on the next relevant action.
- **Reset to defaults** restores everything in one click.
- Esc or clicking outside the card closes the dialog.

### Changed
- `createDocument` and `store.open` now accept an explicit `plain` override so
  a fresh Untitled tab can be plain text without a `.txt` path. Existing
  callers are unaffected (the param is optional with the old derive-from-path
  behavior as the default).

## [0.4.5] - 2026-07-13

### Fixed — find bar focus bugs
- **Find bar no longer loses focus while typing** (Issue 1). Previously every
  keystroke in the find input triggered a re-search that called
  `editor.focus()`, yanking focus back to the textarea — so typing "m" would
  disconnect the bar and you had to click back in for each letter. The
  background search now updates the textarea selection WITHOUT stealing focus;
  focus moves to the editor only on explicit navigation (Enter / next / prev).
- **First character no longer swallowed after find** (Issue 2). The match
  selection left in the textarea could eat the first character typed after
  closing find. Closing the bar now collapses the selection to a caret so the
  next keystroke inserts cleanly.

## [0.4.4] - 2026-07-13

### Added — unified find (Ctrl+F)
- **Find now works in BOTH view and edit mode.** Previously Ctrl+F only
  searched the editor textarea; in view mode (the default) it did nothing.
  Now one find bar handles both.
- **In view mode**, matches are highlighted inline in the rendered document
  (`<mark>` chips), the current match is emphasized, and the view scrolls to
  it. Matches inside code blocks (highlight.js spans) are found too.
- **Idempotent bar.** Pressing Ctrl+F repeatedly never stacks listeners or
  duplicates the bar — one element, created once, toggled via `.hidden`.
- **Case-sensitive toggle** (the `Aa` button) — default case-insensitive,
  click to match exact case. Remembered across sessions.
- **Seed from selection** — opening find with text selected pre-fills the
  query (single-line selections only).
- **F3 / Ctrl+G repeat** — F3 or Ctrl+G finds the next match, Shift+F3 or
  Ctrl+Shift+G the previous, even after the bar is closed.
- **Esc clears then closes** — first Esc clears the query and highlights,
  a second Esc closes the bar.
- **Count display** shows `n/total`; the input outline turns red when there
  are no matches.

### Changed
- The find bar moved out of `editor.js` into a standalone global module
  (`src/views/find-bar.js`) that owns the whole feature. The editor's public
  API gained `textarea()` and `focus()` accessors so the find module can drive
  selection without duplicating state.

## [0.4.3] - 2026-07-13

### Changed — custom window controls
- **Custom title bar buttons** — replaced the OS-native minimize / maximize /
  close buttons with mdpeek-styled controls in the top-right. Minimalist glyphs
  (`−`, `□`/`❐`, `✕`) that pick up the active theme; the close button turns red
  on hover (Windows / Edge convention).
- **Draggable header** — the empty header area now moves the window, and
  double-clicking it toggles maximize, as expected for a frameless window.
- The maximize button icon automatically swaps between the box and the restore
  glyphs, staying correct even when you maximize via `Win+Up` or snap layouts.
- **Minimize vs. close, clarified** — the `−` button minimizes to the taskbar;
  the `✕` button still opens the existing Minimize-to-tray / Quit dialog
  (unchanged from v0.4.0). Added the required window permissions to the
  capability file.

## [0.4.2] - 2026-07-13

### Added — theme picker
- **Six themes** — the light/dark toggle is now a dropdown with **Light**, **Dark**,
  **Solarized Light**, **Solarized Dark**, **Dracula**, and **Nord**. Each theme
  restyles the whole UI (surfaces, accents, syntax highlighting) consistently.
- **Color-swatch previews** — each theme in the dropdown shows a two-tone chip so
  you can tell themes apart at a glance. The active theme is marked with a check.
- **Matching code highlighting** — code blocks swap their highlight.js theme
  (github / github-dark / solarized-light / solarized-dark / dracula / nord) to
  stay consistent with the selected UI theme.
- Your choice persists across sessions; the dropdown closes on outside-click or
  `Esc`.

## [0.4.1] - 2026-07-13

### Changed
- **Unsaved-tab warning redesigned** — replaced the OS-native `confirm()` dialog
  with an in-app modal that matches mdpeek's aesthetic (rounded card, macOS-style
  shadows, warning icon, danger-colored discard button).
- Single-tab close now offers three choices: **Cancel**, **Save first**, and
  **Discard**. "Save first" runs the save flow and only closes once saved.
- Multi-tab close (Close others / Close to the right / Close all) shows one
  combined dialog with the dirty-tab count.

## [0.4.0] - 2026-07-13

### Added — system tray + minimize-to-tray
- **System tray icon** — mdpeek now lives in the Windows system tray (bottom-right
  icon area). Left-click the tray icon (or double-click) to show the window.
  Right-click for a menu: **Show mdpeek** / **Quit mdpeek**.
- **Close dialog** — clicking the window close button no longer exits. Instead
  a dialog asks: **Minimize to tray** or **Quit**? A "Always do this (don't ask
  again)" checkbox remembers your choice for future closes.
- Reset the remembered choice by clearing site data, or it can be extended
  later with a settings panel.

### Changed
- This is a minor version bump (0.3 → 0.4) because the close behavior changed
  meaningfully: the app stays alive in the background by default until you
  explicitly quit.

## [0.3.5] - 2026-07-13

### Fixed
- **Zoom shortcuts (Ctrl+= / Ctrl+- / Ctrl+0) now actually fire.** The handler
  was on the bubble phase; when the editor textarea had focus, WebView2's
  default zoom handling could consume the keystroke before it reached our
  window-level listener. Moved to the capture phase so we intercept the keys
  before the webview's defaults run.

## [0.3.4] - 2026-07-13

### Fixed
- **Zoom shortcuts now match reliably** — Ctrl+= / Ctrl+- / Ctrl+0 were checking
  the raw `e.key` instead of the normalized lowercase value, causing them to
  miss on some keyboard layouts. Now uses the same normalized key as the other
  shortcuts, and also handles `_` (Shift+-) as a zoom-out trigger.
- **Edit button works on untitled tabs** — clicking Edit on a fresh Untitled
  tab used to do nothing (the welcome-screen check blocked it). Now it opens
  the editor so you can start writing immediately. The welcome screen only
  shows for view mode; edit mode always shows the editor.

## [0.3.3] - 2026-07-13

### Added
- **Version status button** in the toolbar (pill-shaped, right of zoom-in).
  Shows the current version with a colored status dot:
  - **Grey, pulsing** — checking for updates
  - **Green** — you're on the latest version
  - **Blue, pulsing** — an update is available
  - **Red** — update check failed (network error, etc.)
  Click the button to manually check for updates, or to install a pending
  update immediately instead of waiting for the toast.

## [0.3.2] - 2026-07-13

### Fixed — critical bugs (from code-quality audit)
- **Multi-tab editor corruption** — switching between edit-mode tabs stacked
  duplicate keydown/input listeners on the shared `<textarea>`. Every editor
  action (Tab, Enter, auto-pair, Ctrl+B) applied N times, corrupting content.
  The outgoing tab's editor instance is now destroyed on switch.
- **Session data loss** — the session only persisted on the FIRST edit per tab
  (markDirty emitted 'change' once). A crash after typing a paragraph lost
  everything but the first character. Now re-persists 1s after typing stops.
- **Edit-mode typing lag** — mermaid diagrams (expensive layout engine) were
  re-rendering on every keystroke in the live preview. Now skipped in edit
  mode; diagrams render fully in view mode.
- **Dropzone blur broken on WebKit** — added missing `-webkit-backdrop-filter`.
- **Re-render flicker** — the global `body *` color transition was animating
  freshly rendered markdown elements on every keystroke. Scoped to UI chrome.

### Changed — macOS premium design
- **Refined color palette** — warmer neutrals (Apple-style `#1d1d1f` text,
  `#f9f9fb` surface), macOS system blue (`#0071e3`), softer borders.
- **Dark mode overhaul** — true macOS dark-mode neutrals (`#1c1c1e` bg,
  `#2c2c2e` elevated), brighter accent (`#0a84ff`).
- **Softer shadows** — two-layer macOS-style shadows (ambient + key) replace
  the flat single-layer ones.
- **Larger radii** — 8px default (was 6px), 12px large (was 10px), 5px small
  (was 4px) for friendlier, more polished corners.
- **Header** — hairline border replaces heavy box-shadow for a cleaner top bar.
- **Welcome screen** — larger 84px logo with deeper shadow, tighter heading
  letter-spacing (-0.02em).
- **Active tabs** — subtle shadow + softer border for a floating-card feel.

## [0.3.1] - 2026-07-06

### Added — smooth animations throughout
- **Welcome screen** staggered entrance: logo, title, description, and hints
  cascade in with a fade-up over ~500ms.
- **Document content** fades + rises in subtly when you switch tabs or open a
  file (view mode only; the edit-mode live preview doesn't flicker).
- **Sidebar** now slides away smoothly instead of snapping (width + opacity
  transition replaces the old `display: none` toggle).
- **Toast** springs in with a subtle overshoot (back-out easing) for a more
  tactile feel.
- **Context menu** scales in from the click point.
- **Copy button** on code blocks scales in on hover instead of a bare fade.

### Changed — micro-interactions
- **Tabs** lift 1px on hover; active tabs stay grounded.
- **Toolbar buttons** depress (scale 0.94) on click.
- **Close buttons** scale from 0.7 → 1 on hover, with a bump to 1.12 on hover.
- **New-tab (+) button** scales up on hover, down on press.
- Shared `--ease` token (ease-out-quart) added for consistent motion curves.

## [0.3.0] - 2026-07-06

### Changed — UI refinement pass (impeccable)
- **Blockquotes redesigned** — removed the colored side-stripe border (a banned
  pattern) in favor of a full border + neutral surface tint. Reads as a calmer,
  more integrated callout.
- **Tinted neutrals** — the light theme no longer uses clinical pure `#ffffff`
  for the page background. Neutrals are tinted ~0.5% toward the blue accent,
  giving surfaces subtle warmth without being perceptibly "blue." Shadow colors
  also shifted off pure black.
- **Motion curves** — all transitions and the toast animation now use an
  ease-out-quart cubic-bezier instead of generic `ease`, per the motion law.
  State changes decelerate naturally.
- **Keyboard focus on tabs** — tabs now show a visible focus ring on keyboard
  navigation (previously only mouse hover/active states existed).

### Fixed
- Removed em dashes from user-facing copy (tooltips, toasts) per copy rules.

## [0.2.9] - 2026-07-06

### Changed — startup performance
- **61% smaller entry bundle** — switched from the full `highlight.js` build
  (190+ languages, ~1MB) to the curated "common" subset (~36 languages, ~300KB).
  Covers js, ts, python, rust, go, java, c, cpp, c#, bash, json, yaml, sql, html,
  css, markdown, and more — unknown languages still fall back to plaintext
  gracefully. Entry chunk: 1,271 KB → 498 KB (413 KB → 161 KB gzipped).
- **Parallel session restore** — when reopening the app with multiple tabs,
  file contents are now read from disk concurrently instead of one at a time.
  Restoring N tabs is now a single round-trip's wait, not N.

## [0.2.8] - 2026-07-06

### Fixed
- **Links now open in the system browser** — clicking an `http(s)` / `mailto` /
  `tel` / `sms` link inside rendered markdown used to navigate the app's own
  WebView, leaving mdpeek showing the linked page instead of the document.
  External links are now routed through the OS default browser via
  `tauri-plugin-opener`. In-document `#anchor` links (table-of-contents
  navigation, footnotes) still scroll within the document as before.

## [0.2.7] - 2026-07-06

### Added
- **Right-click context menu on tabs** — Close, Close others, Close to the
  right, Close all. Items that would be no-ops are disabled (e.g. "Close to
  the right" is greyed out on the rightmost tab). When closing multiple tabs,
  a single combined confirm covers all unsaved changes instead of one dialog
  per tab.

## [0.2.6] - 2026-07-03

### Added
- **Notepad-style editing for `.txt` files** — plain-text files now open
  directly in a full-width editor with no markdown preview pane, no "Source"
  header, and no view/edit toggle. Markdown features (smart Tab, list
  continuation, auto-pair, find bar, gutter) still work; only the preview and
  its affordances are hidden. `Ctrl+E` is a no-op for plain docs.

## [0.2.5] - 2026-07-02

### Fixed — stability & cleanup pass
- **View-mode scroll now restores on tab switch** — `scrollY` was persisted and
  restored but never actually applied; switching away from a doc and back used
  to lose your reading position.
- **Unhandled promise rejections** in the `file-changed` and `open-file`
  listeners are now caught and surfaced as toasts instead of failing silently.
- **Mermaid render IDs** switched from `Math.random()` to a monotonic counter,
  preventing duplicate SVG IDs during rapid re-renders in edit mode.
- **Mermaid error nodes** now clear any partial SVG before showing the error
  placeholder, preventing DOM accumulation across re-renders.
- **Release script** (`make-release.js`) rewritten so any failure exits
  non-zero — previously a thrown error inside the dynamic import left the script
  reporting success with no updater manifest uploaded.

### Removed — dead code
- Collapsed a confused dead branch in `handleEnter` (both ternary arms were
  identical) to a single clear line.
- Removed unused `clearSession` export from `persistence.js`.
- Un-exported internal `enhanceCodeBlocks` helper from `renderer.js`.
- Normalized error messages via a `fmtErr()` helper (handles JS Errors, strings,
  and unknown rejections consistently).

## [0.2.4] - 2026-07-02

### Added
- **`.txt` file support** — plain text files now open the same way as Markdown
  (double-click → Open With, drag-and-drop, file dialog). Registered as a
  separate "Plain Text" association (distinct ProgID) so it shows correctly in
  the Windows Open With menu rather than being labelled "Markdown Document".

## [0.2.3] - 2026-07-02

### Changed
- **Redesigned app icon** — replaced the document+arrow design with a bold,
  unambiguous white "M" (for Markdown) on a blue rounded tile. The simpler
  shape stays crisp and recognizable at every size, from 16px taskbar to 512px
  welcome screen.
- **Icon consistency fix** — the welcome-screen/favicon icon is now generated
  from the same source as the taskbar and installer icons (previously each was
  resized independently, causing visible differences).
- Stopped tracking mobile (`android/`/`ios/`) icon sets that `tauri icon`
  regenerates — not used by this Windows-only app.

## [0.2.2] - 2026-07-02

### Added
- **Copy button on code blocks** — hover any fenced code block in the rendered
  view to reveal a copy button (top-right). One click copies the code to the
  clipboard with a checkmark confirmation. Works in both view and edit-preview
  panes.

## [0.2.1] - 2026-07-01

### Changed
- **New app icon** — replaced the previous illustration with a clean,
  simple logo (blue rounded tile + white document + down-arrow) that renders
  crisply at all sizes, including the 16px taskbar. Eliminates the black jagged
  edges visible on the old icon at small sizes.

### Removed
- Dropped the redundant filename label from the right side of the toolbar —
  the active file's name is already shown in its tab.

## [0.2.0] - 2026-07-01

### Added — editor overhaul
- **Line-number gutter** on the source pane, synced to scroll.
- **Smart Tab / Shift+Tab** — inserts 2 spaces at the caret; indents or outdents
  every selected line.
- **List continuation** — pressing `Enter` on a `- item` or `1. item` line
  inserts a new matching marker (ordered lists increment). `Enter` on an empty
  list item exits the list. `Enter` after an unclosed ` ``` ` fence closes it.
- **Auto-pair** — typing `(` `[` `{` inserts the closer and skips over it when
  retyped; `"` `'` `` ` `` pair when not adjacent to a word char; Backspace on
  an empty pair deletes both.
- **Markdown wrap shortcuts** — `Ctrl+B` / `Ctrl+I` / `` Ctrl+` `` wrap the
  selection in `**` / `*` / `` ` `` (toggle off if already wrapped).
- **Find** — `Ctrl+F` opens a find bar with live match count and next/prev
  navigation (`Enter` / `Shift+Enter` / `F3`), `Esc` to close.

### Fixed
- Switching tabs in edit mode no longer loses the caret position or scroll
  offset — each tab's editor state is now captured on switch and restored on
  return (previously only the text was preserved).

## [0.1.4] - 2026-07-01

### Added
- **Zoom in / zoom out**: toolbar buttons (magnifier ±) or `Ctrl+=` / `Ctrl+-`.
  `Ctrl+0` resets to 100%. Zoom level persists across launches. Range 50%–300%.

### Fixed
- Sidebar toggle now reliably collapses/expands the TOC pane (the `.toc:empty
  { display: none }` rule was interfering; removed it and switched the collapsed
  state to a clean `display: none`).

## [0.1.3] - 2026-07-01

### Added
- **Sidebar toggle**: collapse/expand the table-of-contents sidebar with the
  toolbar button (panel icon) or `Ctrl+B`. State persists across launches.

## [0.1.2] - 2026-07-01

### Fixed
- Switching to an empty/new tab no longer leaves the previous document's table
  of contents visible in the sidebar. The TOC is cleared when the welcome
  screen is shown.

## [0.1.1] - 2026-07-01

### Fixed
- Clicking `+` (new tab) now shows the welcome screen, not a blank page. Any
  empty untouched tab displays the welcome hero until content is added.
- Tab styling polished: clearer active state (surface background + border),
  subtle "MD" file-type badge on saved-file tabs, close button fades in on
  hover, close-on-hover turns red, better spacing.

## [0.1.0] - 2026-07-01

### Changed
- **Tabs merged into the header** (browser/VS Code style): tabs sit on the left
  edge of the top bar; toolbar buttons (Open/Save/Edit/Theme) moved to the right.
  The separate tab strip below the header is gone — one clean row.
- Toolbar buttons are now icon-only (no text labels) to save horizontal space
  for tabs. Tooltips explain each.
- Edit-mode toggle button shows an active (accent) state when editing.
- Active tab shown with accent-soft highlight instead of a bottom border.

### Fixed
- Fresh launch now reliably shows the welcome screen. Blank untouched Untitled
  tabs are no longer persisted to / restored from the session, so a relaunch
  with no real files shows the welcome hero (not an empty tab).

## [0.0.9] - 2026-06-30

### Changed
- Fresh launch now shows the welcome screen (Open / drag-drop / shortcut hints)
  instead of an empty Untitled tab. A blank tab is still one Ctrl+N away.
- Removed the mdpeek logo + wordmark from the toolbar; the toolbar now spans
  the full header width (more room for the file name and future controls).
  The logo still appears on the welcome screen.

## [0.0.8] - 2026-06-30

### Added
- **Multi-tab editing**: open multiple files as tabs in one window. Open via
  drag-drop/Ctrl+O, Ctrl+N for a new blank tab, or double-click a .md while
  mdpeek is running (opens as a tab in the existing window, not a new one).
- **Session restore**: reopen mdpeek and your tabs come back. Open file paths +
  active tab + Untitled-tab contents persist to localStorage; file contents are
  re-read from disk on launch.
- Tab strip UI: clickable tabs, × or middle-click to close, dirty indicator (●),
  unsaved-changes confirm dialog on close.
- Single-instance: a second launch focuses the running window and forwards the
  opened file as a new tab.
- New shortcuts: `Ctrl+N` new tab, `Ctrl+W` close tab.
- Multi-file drag-drop: dropping several .md files opens each as its own tab.

### Changed
- Major internal refactor: single-document `state` replaced by a `DocumentStore`
  (pure-logic, 29 unit tests). Toolbar/shortcuts/watcher/live-reload all
  operate on the active document.

### Fixed
- (Refactor-quality) Switching away from an edit-mode tab now preserves unsaved
  textarea content; closing a tab frees its editor listeners.

## [0.0.7] - 2026-06-30

### Changed
- Document content now fills the full window width (removed the 1100px
  `max-width` cap and the `margin: 0 auto` centering that left empty side
  margins). The scrollbar sits flush at the right edge of the window, aligned
  with the content. Side padding scales down on narrow windows (≤900px).

## [0.0.6] - 2026-06-30

### Fixed
- Double-clicking a `.md` file (with mdpeek set as default) now actually opens
  it. Root cause: the old `setup` hook emitted an `open-file` event during app
  startup, before the frontend listener was registered — a race the event lost.
  Replaced with a pull-based `get_initial_file` command the frontend invokes
  once the DOM is ready, so there's no race.

## [0.0.5] - 2026-06-30

### Fixed
- Welcome-screen logo was broken in the installed app (404 on `/icon.png`).
  Root cause: Vite only bundles files under `public/` or imported assets; the
  root `icon.png` wasn't served. Fixed by adding `public/icon.png`.
### Changed
- Document pane now uses the full window width up to ~1100px (was capped at
  780px, leaving large empty side margins). Side padding scales with window
  width; widens further on large monitors (≥1400px).

## [0.0.4] - 2026-06-30

### Added
- Version badge on the welcome screen (visible marker for confirming the
  running version after an auto-update).
- `scripts/copy-release.js` now matches the exact version being built, so it
  can't pick up a stale installer left in the nsis output dir from a previous
  build. (This was a real bug found during install testing — v0.0.3 builds
  were shipping the v0.0.1 binary.)

## [0.0.3] - 2026-06-30

### Added
- **File association**: `.md`, `.markdown`, `.mdx` now appear in the Windows
  "Open with" menu. Double-clicking a file with mdpeek set as default opens it
  directly. Registered via a custom NSIS hook (`src-tauri/nsis/file-assoc.nsh`).
- **Auto-update**: on startup the app checks GitHub Releases for a new version;
  if found, a click-to-install toast appears (downloads the signed installer,
  launches it elevated, and relaunches). Configured via `tauri-plugin-updater`
  with a self-generated signing keypair. Per-machine install means UAC prompts
  on each update — expected for Program Files apps.
- `scripts/make-release.js`: signs the installer, generates `latest.json`, and
  uploads both to the GitHub Release for the current version.

### Changed
- Updated bundled `latest.json` endpoint to `github.com/sanketpatel32/Mdpeek`.

## [0.0.2] - 2026-06-30

### Added
- Modern minimal UI redesign: branded header with logo + wordmark, icon toolbar
  buttons with hover/active states, grouped toolbar with separators, styled
  scrollbars, slide-in toast, and a proper welcome hero / empty state.
- Per-machine installer: mdpeek now installs to `C:\Program Files\mdpeek\`
  (like VS Code) with a machine-wide Start Menu shortcut.
- `releases/` folder: `npm run tauri:build` copies the installer + portable
  binary into a clean top-level location.
- Project files: `.gitattributes`, `.editorconfig`, `CHANGELOG.md`,
  `CONTRIBUTING.md`, `LICENSE`.

### Changed
- Inline SVG icons replace text buttons (Open, Save, Edit, Theme).
- Theme toggle now swaps a sun/moon icon; smooth color transitions on switch.
- Refined markdown typography: better headings, accent-colored blockquotes,
  bordered code blocks, striped tables.

### Removed
- iOS and Android icon assets (35 files) — this is a Windows desktop app.
- Scaffolded `.vscode/extensions.json`.

## [0.0.1] - 2026-06-30

### Added
- Initial release.
- GitHub-flavored Markdown rendering (marked) with XSS sanitization (DOMPurify).
- Syntax-highlighted code blocks (highlight.js).
- Math rendering via KaTeX (`$inline$` and `$$block$$`).
- Mermaid diagram rendering (```` ```mermaid ```` fences).
- View mode with auto-generated table of contents.
- Edit mode with split-pane live preview (debounced).
- Live reload when the open file changes on disk (notify watcher).
- Drag-and-drop a `.md` file to open it.
- Light / dark theme.
- Keyboard shortcuts: `Ctrl+O` open, `Ctrl+S` save, `Ctrl+E` toggle edit.
- NSIS Windows installer (~3.2 MB).
- Unit tests for the renderer pipeline (10 passing).

[Unreleased]: https://github.com/sanketpatel32/mdpeek/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/sanketpatel32/mdpeek/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/sanketpatel32/mdpeek/releases/tag/v0.0.1
