# Lightweight batch — design

**Date:** 2026-08-01
**Target release:** v0.55.0 (same release as quick-capture inbox)
**Status:** Approved (pre-implementation)
**Constraint:** Lightweight only — pure JS, no new Rust/IPC commands, no new npm
dependencies, minimal persistent chrome.

Three small, cohesive features that round out the writing/readability axis that
recent releases (prose highlights v0.53, readability v0.50) built. Each is a
pure `src/lib/*.js` helper + a thin view/wiring hook, matching the project's
established pattern. They are **independent**: each can ship and be tested on
its own; order doesn't matter.

Companion to the [quick-capture inbox](2026-07-31-quick-capture-inbox-design.md)
spec (streak is the reward loop for capture's input).

---

## Feature 1 — Reading streak (status-bar chip)

### Summary
A tiny writing-day streak. Any day the user edits/saves a daily note **or**
fires a quick-capture counts as a "writing day." Consecutive days build a streak
shown as a `🔥 N` chip in the **existing** status bar (alongside the word/char
count). Zero new chrome — it reuses the status bar that's already there. The
productivity companion to quick-capture: capture is the *input*, streak is the
*reward loop*.

### `src/lib/streak.js` (new) — pure, DOM-free, unit-tested
Backed by a localStorage set of ISO date stamps under `STREAK_KEY`
(`mdpeek-writing-days`). All functions take an explicit `store`
(`{ getItem, setItem }`) so they're testable without global localStorage — the
same shim pattern `sessions.js` / `templates.js` use.

- `export const STREAK_KEY = 'mdpeek-writing-days';`
- `markWritingDay(store, now)` → returns the updated set; idempotent for the
  same day (calling twice in one day adds one stamp). Persists to `store`.
- `currentStreak(store, now)` → integer count of consecutive days ending today
  (or yesterday, so the streak doesn't break the moment you cross midnight and
  haven't written yet — see edge cases). Returns 0 if none.
- `bestStreak(store)` → longest run ever recorded (nice-to-have for the chip
  tooltip).
- `formatStreakChip(streak)` → `''` when 0/1 (no chip), `'🔥 7'` otherwise. Kept
  as a pure formatter so the status-bar render stays dumb.

`now` defaults to `Date.now()` everywhere but is injectable for deterministic
tests.

### Wiring (`src/main.js`)
- On daily-note save **and** on quick-capture success → `markWritingDay(store)`.
  (Reuses the save path; one extra call.)
- Status-bar render (the existing function that already renders word/char
  counts) appends the streak chip when `formatStreakChip` returns non-empty.
- No hotkey, no panel, no Settings flag needed (it's invisible until you have a
  streak). **Optional:** a tiny Settings checkbox to hide it — defer unless
  requested.

### Edge cases
- **Midnight rollover:** `currentStreak` counts today as the streak anchor; if
  today isn't yet a writing day, it anchors on *yesterday* so the visible streak
  doesn't drop to 0 at 00:01 before you've written. Once today is marked, it
  extends.
- **Corrupt storage:** malformed JSON recovers to an empty set (never throws) —
  mirrors `sessions.js`.
- **Time-zone:** day stamps are local-time ISO dates (`YYYY-MM-DD`), matching
  the daily-note idiom in `dates.js`.

### Tests — `test/streak.test.js` (new)
- `markWritingDay`: adds a stamp, idempotent same-day, persists, survives a
  fresh store read.
- `currentStreak`: 0 on empty; 1 after one day; N across N consecutive days;
  resets to 0 (or 1 if today marked) after a gap; midnight-rollover anchor
  behavior; deterministic with injected `now`.
- `bestStreak`: longest run, single-day, gap handling.
- `formatStreakChip`: `''` for 0/1, `'🔥 N'` otherwise.

---

## Feature 2 — Word-frequency panel (toggle overlay)

### Summary
A togglable overlay that surfaces a document's vocabulary: a small on-demand
popover listing the top words by frequency, plus an optional underline on words
used 5+ times (overuse signal). Distinct from prose-highlights (which marks
*hard* words) — this marks *repetitive* words. Strengthens the readability axis.
No **persistent** panel: the underline is a highlight pass in the existing
`enhanceDom` pipeline, and the popover is a transient command-palette-triggered
modal (opens on demand, closes on Esc) — same pattern as the table editor.

### `src/lib/wordfreq.js` (new) — pure, DOM-free, unit-tested
- `tokenize(text)` → lowercased word tokens, stripping markdown/punctuation,
  ignoring code spans/fences (reuse the code-skip approach prose.js uses), CJK-
  safe, drops a small stopword list (`the`, `a`, `and`, …).
- `wordFrequencies(text, { min = 1 })` → `Map<word, count>` sorted desc by
  count. `min` filters single-use words out of the result.
- `overusedWords(text, { threshold = 5 })` → `Set<word>` of words at/above the
  threshold. Drives the underline pass.
- `topWords(text, { limit = 20 })` → array of `[{ word, count }]` for the
  popover.

### DOM pass — new `enhanceWordFreq` step in `renderer.js` `enhanceDom`
- Add a `wordFreq` option to `enhanceDom`'s signature (alongside
  `proseHighlights`).
- When on, `enhanceWordFreq(container)` wraps occurrences of overused words in a
  `.wordfreq-mark` span (dotted underline, **distinct color** from prose-
  highlights — e.g. amber, vs prose's tip-green — so the two never read as the
  same affordance). Skips code blocks, tables, and headings (only body prose).
  Idempotent across re-renders (guard like `enhanceProseHighlights`).

### View — small popover (`src/views/wordfreq-popover.js`, new)
- Toggled by a Command Palette entry **"Word frequency…"** (gated by a feature
  flag, default on). Shows `topWords` for the active doc as a ranked list with
  counts; clicking a word scrolls to its first occurrence.
- Mirrors the lightweight modal style of `table-editor.js`.

### Gating
- New feature flag `wordfreq`. Add to the feature-flag array in `main.js` and to
  `MINIMAL_SUPPRESSED` (hidden under Minimal mode, consistent with
  `prose-highlights`).

### Edge cases
- **Empty / code-only docs:** `topWords` returns `[]`; popover shows a friendly
  "No prose to analyze."
- **Case:** tokens are lowercased so "The"/"the" merge.
- **Hyphenated / apostrophe words:** handled per the prose.js idiom.
- **Performance:** analysis runs once per render (debounced via the existing
  render throttle), not per keystroke.

### Tests
- `test/wordfreq.test.js` (new) — pure logic: tokenize (strips markdown/punct,
  skips code, stopword drop, CJK), `wordFrequencies` (counts, sort, `min`
  filter), `overusedWords` (threshold boundary), `topWords` (limit, ordering).
- `test/wordfreq-dom.test.js` (new) — DOM pass: wrapping, color distinct from
  prose, code/table/heading skips, idempotency, default-off.

---

## Feature 3 — Editor-side region folding

### Summary
**Spec audit result:** in-document folding *already exists* and is mature in the
**rendered view** (`renderer.js` `enhanceFolding`, h2–h6, caret buttons, per-
container state cache, `content.css` styles). It is explicitly **disabled** in
the editor (`editor.js:113` passes `folding: false`), and the editor has no
region folding of its own. This feature fills that exact gap: **fold/unfold
markdown sections in the editor textarea** by hiding the lines under a heading.

### `src/lib/fold.js` (new) — pure, DOM-free, unit-tested
Region math over source lines, reusing the existing `extractHeadings` scan in
`editor-logic.js` (so "where does this section end?" agrees with the jump-to-
heading picker):

- `sectionRanges(text)` → array of `{ level, headingLine, startLine, endLine }`
  where `endLine` is the line before the next heading of the same-or-higher
  level (or EOF). `extractHeadings` already tracks level + fence state; this
  extends it to compute inclusive line ranges.
- `foldedLineSet(text, collapsedHeadings)` → a `Set` of line numbers that should
  be hidden given the set of currently-collapsed heading lines. Pure; the view
  consumes this to decide what to mask.

These are the only pure helpers needed. Folding is fundamentally a *view*
operation (which lines to hide), so the complex logic is "what lines belong to
this section," not text transformation.

### View — editor integration (`src/views/editor.js`, modified)
**Concrete approach — CSS line-masking overlay (source-of-truth preserved):**

The textarea always holds the **full, true source** and is never mutated by
folding. Folding is purely visual:

- A gutter to the left of the textarea renders a `▸`/`▾` caret per heading
  (mirrors the rendered-view affordance). Clicking toggles that section's fold
  state in an in-memory `Set` of collapsed heading-line numbers.
- When a section is folded, a positioned overlay div (synchronized to the
  textarea's scroll + the editor's existing line-height math, which the syntax-
  highlight overlay already computes) covers the folded line range and shows a
  single non-editable marker chip: `⌄ N lines folded`. The masked textarea lines
  are still *present* in `.value` (so selection/caret math on surrounding text
  is unaffected) but visually hidden behind the chip.
- **Key safety properties** this guarantees:
  - Saving always writes `textarea.value` = the true source (folds never cause
    data loss).
  - Unfolding just removes the overlay (instant, lossless).
  - Editing outside a fold can't corrupt hidden text because the hidden text is
    physically still in the textarea.
- Fold state is per-document, in-memory only (not persisted across restarts) to
  match the rendered-view cache behavior and keep scope tight.

### Gating
- No feature flag needed initially — it's a core editing affordance, like the
  rendered-view folding (which also has no flag). If it proves noisy, a setting
  can be added later. Not added to `MINIMAL_SUPPRESSED` (it's core editor
  behavior; Minimal mode keeps editing).

### Edge cases
- **Editing inside the fold boundary line:** the marker line is non-editable; a
  click on it unfolds. Typing at the caret just above/below the fold preserves
  the hidden range (offset bookkeeping in `applyFold`/`unfoldBack`).
- **Nested headings:** folding an h2 hides everything until the next h2 (or h1),
  including nested h3/h4 — matches the rendered-view semantics.
- **h1:** include `h1` in editor folding (the rendered view skips it; the editor
  benefits from top-level fold too).
- **Save while folded:** writes the true source, never the masked view.
- **Find/replace across a fold:** find still searches the full source; a match
  inside a fold unfolds that section and scrolls to it.

### Tests
- `test/fold.test.js` (new) — pure logic: `sectionRanges` (flat doc, nested
  headings, h1 boundary, fence-safe, EOF handling, inclusive ranges),
  `foldedLineSet` (single fold, nested folds, overlapping heading lines,
  toggling membership, empty-when-none-collapsed).
- Editor DOM smoke (jsdom, in `test/editor-fold.test.js`, new): gutter caret
  renders per heading, click toggles fold marker, click unfolds (overlay
  removed), and the critical invariant — **`textarea.value` equals the true
  source before, during, and after folding** (no data loss).

---

## Out of scope (this batch)

- OS-wide global hotkey, OCR, triage view (carried over as follow-ups).
- Persisting editor fold state across restarts.
- A "best streak" celebration UI (the tooltip showing best is enough for now).
- Applying word-freq analysis to Reading Mode (start with edit/view only;
  Reading Mode can adopt it later).

## Release note

These three ship together with quick-capture inbox as v0.55.0. Each is gated
independently (streak: no flag; word-freq: flag + Minimal-suppressed; editor
fold: no flag) so they can be toggled/hidden independently.
