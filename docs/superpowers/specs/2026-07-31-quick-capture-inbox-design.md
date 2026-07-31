# Quick-capture inbox — design

**Date:** 2026-07-31
**Target release:** v0.55.0
**Status:** Approved (pre-implementation)
**Area:** Productivity / workflow

## Summary

A frictionless capture primitive for mdpeek. Hit **`Ctrl+Shift+I`** anywhere in
the app and a tiny transient HUD slides in: one input, a hint line, the
destination shown faintly. Type a thought / task / link, press `Enter`, and it
appends to **today's daily note** (`YYYY-MM-DD.md` in the notes folder) under a
`## Inbox` heading, timestamped. The HUD vanishes. Two seconds of chrome, then
it's gone — nothing left behind to manage.

This is the one universally-useful productivity tool that mdpeek lacks today,
and it embodies *"chrome recedes"* more than any persistent panel could. It
*feeds* the existing daily-notes and Tasks features rather than competing with
them: captured `- [ ]` items show up in the Tasks view, and capture lands in the
same daily note the user already opens with one click.

Non-goals (explicitly out of scope for this release):

- **OS-wide global hotkey** (would need a new Tauri plugin + capability scope +
  OS permission prompt on install). Capture is in-app only this release. Tracked
  as a documented follow-up.
- A standalone "Inbox" tab/panel or triage UI. Capture appends to the daily
  note, full stop.
- Capture across P2P collaboration sessions.

## Trigger

- **In-app hotkey** `Ctrl+Shift+I` (mnemonic: Inbox) opens the HUD. Free in the
  current keymap.
- **Command Palette** (`Ctrl+Shift+P`) → **"Capture thought…"** opens the same
  HUD. The entry only appears when `featureOn('capture')` is true.
- The HUD does **not** switch the active tab, change mode, or disrupt what the
  user is reading/editing. It is purely an overlay.

## The HUD

`src/views/capture-hud.js` — a small floating panel anchored top-center of the
window. Mirrors the modal style of `src/views/table-editor.js`.

- A single `<textarea>` / input (autofocus on open).
- A faint hint line: `Enter to capture · Esc to close · Shift+Enter for newline`.
- The destination shown faintly: `→ YYYY-MM-DD.md  (today's note)`.
- `Enter` → calls `onCapture(text)` then unmounts.
- `Shift+Enter` → inserts a newline (multi-line capture).
- `Esc` → closes without writing.
- Empty input on `Enter` → no-op close (no empty bullets).
- The input is briefly disabled during the async save to prevent double-submit,
  then re-enabled (or the HUD has already closed on success).

No long-lived state. The HUD owns no persistence of its own.

## Destination — today's daily note under `## Inbox`

Captures land in `<notes-dir>/<YYYY-MM-DD>.md` under an `## Inbox` heading.
This reuses the **exact** notes-folder path the daily-note feature uses
(localStorage `mdpeek-notes-dir`, with the `get_default_notes_dir` IPC fallback
and the folder picker prompt on first use). No new settings surface is added.

**Filename / stamp:** local time, matching the daily-note idiom in
`src/lib/dates.js` (`todayStamp()` → `YYYY-MM-DD`).

**Capture format.** Each entry is a timestamped bullet:

```
- [09:42] your captured text
```

- **Task preservation:** if the input starts with a task marker
  (`- [ ]`, `- [x]`, `* [ ]`, `* [x]`), the marker is preserved and the
  timestamp is inserted after it, e.g. `- [ ] [09:42] ship release notes`. This
  keeps the entry discoverable by the existing Tasks feature.
- **Bullet preservation:** if the input already starts with a `- ` or `* `
  bullet (non-task), preserve it and prepend `[HH:MM] ` to the text.
- **Plain text:** becomes `- [HH:MM] <text>`.
- **Multi-line (Shift+Enter):** becomes a single `- [HH:MM] <first line>` bullet
  with subsequent lines indented by two spaces (valid nested markdown under the
  bullet).
- **Timestamp:** local time, `HH:MM` (24-hour), zero-padded.

## `## Inbox` injection rules

Pure helper `injectInbox(rawNote, entry)` in `src/lib/capture.js`. Given the
daily note's current text and a formatted entry line (or multi-line block),
returns new text:

1. **Heading exists** (`## Inbox` on its own line, possibly followed by existing
   bullets) → append the new entry as the next bullet immediately after the last
   existing bullet under that heading (i.e., before the next `## ` section or
   end of doc). No duplicate heading.
2. **Heading missing** → add a new `## Inbox` section (heading + blank line +
   the bullet) **at the end of the document**. New entries always append below
   existing inbox bullets (chronological, oldest first).
3. **Trailing empty `## ` heading** (the daily-note starter ends with
   `…\n\n## \n\n`) → if the note ends with an empty `## ` heading, **replace**
   that empty heading with the `## Inbox` section (so the note never accumulates
   dead empty headings). Otherwise rule 2 applies.
4. **Note is empty / whitespace-only** → seed `# <stamp>\n\n## Inbox\n\n- [HH:MM] …`.

Rules are checked in order (1 → 2 → 3 → 4); the first that matches wins. All
cases are idempotent: injecting twice produces both bullets in order under a
single `## Inbox` heading, never two headings.

## Architecture & files

Three pieces, following the established `lib/` + `views/` + `main.js` split:

### `src/lib/capture.js` (new) — pure, DOM/IO-free, unit-tested
- `export const INBOX_HEADING = '## Inbox';`
- `formatEntry(rawText, now = Date.now())` → string (the `- [HH:MM] …` line(s)).
  Empty/whitespace input returns `''`.
- `injectInbox(rawNote, entry)` → string (the new note text). Pure: takes text
  in, returns text out. No filesystem, no localStorage.

### `src/views/capture-hud.js` (new) — the transient HUD
- `mountCaptureHud({ onCapture, destination })` (or similar) — renders the HUD
  into a container, wires focus / `Enter` / `Esc` / `Shift+Enter`, calls
  `onCapture(text)` on submit, unmounts on close. Mirrors `table-editor.js`
  structure (a small, self-contained modal).

### `src/main.js` (modified) — wiring
- New `Ctrl+Shift+I` keydown handler → open the HUD.
- New Command Palette entry: `{ id: 'capture', label: 'Capture thought…',
  keywords: 'capture inbox thought quick note task', run: openCaptureHud }`,
  gated by `featureOn('capture')`.
- `onCapture(text)` orchestrator:
  1. Resolve notes dir (`localStorage.getItem('mdpeek-notes-dir')` or
     `invoke('get_default_notes_dir')`; if both fail, prompt the folder picker —
     same path as `openDailyNote`).
  2. Build today's `YYYY-MM-DD.md` path (reuse `dates.todayStamp()`).
  3. `read_file`; on failure, create with the standard daily-note starter
     (`# <stamp>\n\n*<pretty date>*\n\n## \n\n`) first.
  4. `entry = formatEntry(text)`; `next = injectInbox(content, entry)`.
  5. `save_file({ path, content: next })`.
  6. If that path is the active doc, refresh its buffer so the bullet appears
     live; otherwise toast `Captured to today's note`.
  7. On any error: toast `Could not capture: <err>` and keep the HUD's text
     intact (don't lose what the user typed).
- Register `'capture'` in the feature-flag array (the list at the call sites in
  `main.js` that build Settings checkboxes and that disable features) and in
  Settings → Features. Default **on**.
- Refactor note: extract the shared "resolve notes dir + today path +
  read-or-create" logic between `openDailyNote` and `onCapture` into a small
  helper (e.g. `ensureTodayNote()`) so the two paths can't drift. Both call it.

### `src/lib/minimal.js` (modified) — add `'capture'` to `MINIMAL_SUPPRESSED`
- One-line addition to the set, so Minimal mode hides capture (consistent with
  `'daily'`, `'snippets'`, etc.). No other change — `isFeatureOn` already
  propagates suppression.

## Gating & feature flag

- New flag `capture`. Default **on** for non-minimal installs; suppressed under
  Minimal mode (via `MINIMAL_SUPPRESSED`).
- Settings → Features gains a **Quick capture** checkbox (labelled with its
  hotkey).
- Hotkey, palette entry, and checkbox are all hidden when the feature is off.

## Edge cases & error handling

- **Empty input** → no capture, HUD closes silently. No empty bullets written.
- **Notes folder not set** → reuse the daily-note picker. If the user cancels
  the picker, toast `No notes folder set` and abort the save while preserving
  the HUD text.
- **Today's daily note doesn't exist** → create it with the standard starter
  first, then inject. Capture works before the user has opened today's note.
- **Note open in an editor tab** → after `save_file`, refresh that tab's buffer
  if active (so the bullet appears live); otherwise save silently + toast.
- **Double-submit / rapid Enter** → input disabled during async save; HUD closes
  on first successful capture.
- **Task syntax** → preserved as specified above so the Tasks feature picks it
  up.
- **Feature off / Minimal mode** → hotkey, palette entry, Settings checkbox all
  hidden via `featureOn('capture')`.

## Testing

Follows the project's pure-helper + jsdom-DOM TDD convention.

### `test/capture.test.js` (new) — pure logic
- `formatEntry`:
  - empty / whitespace → `''`
  - plain text → `- [HH:MM] text`
  - task prefixes `- [ ]`, `- [x]`, `* [ ]`, `* [x]` preserved, timestamp after
  - bare bullet `- ` / `* ` preserved, timestamp prepended to text
  - multi-line (Shift+Enter) → first line is the bullet, rest indented two spaces
  - timestamp is local `HH:MM` 24-hour zero-padded; deterministic with injected
    `now`
- `injectInbox`:
  - heading exists → appends next bullet under it, no duplicate heading
  - heading missing, other content present → appends `## Inbox` section at end
  - trailing empty `## ` heading → replaced with `## Inbox` (no dead heading)
  - the exact daily-note starter (`# stamp\n\n*date*\n\n## \n\n`) → empty heading
    replaced with `## Inbox` (special case of the rule above)
  - blank/whitespace note → seeds header + heading + bullet
  - no duplicate headings across two injects (round-trip invariant: inject twice
    → both bullets present, in order, single heading)
  - idempotent / deterministic

### `test/capture-hud.test.js` (new) — jsdom DOM smoke (like `table-editor.test.js`)
- renders the HUD + input
- autofocus on mount
- `Enter` calls `onCapture` with the text, then unmounts
- `Esc` closes without calling `onCapture`
- `Shift+Enter` inserts a newline (does not submit)
- empty submit → no-op (does not call `onCapture`)

### `test/minimal.test.js` (extended) — one-line addition
- assert `'capture'` ∈ `MINIMAL_SUPPRESSED`
- assert `isFeatureOn('capture')` suppressed under Minimal mode, restored when
  Minimal off

Existing 1077 tests stay green.

## Out of scope / follow-ups

- **OS-wide global hotkey** (capture while mdpeek is in the tray/background).
  Needs a Tauri global-shortcut plugin + capability scope + install-time OS
  permission. Separate release.
- A dedicated Inbox/triage view. Capture appends to the daily note; triage
  happens in the normal editor + Tasks view.
- Capture into collaboration sessions.
