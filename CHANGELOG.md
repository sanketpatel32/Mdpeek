# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
