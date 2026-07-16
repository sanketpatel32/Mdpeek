# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
