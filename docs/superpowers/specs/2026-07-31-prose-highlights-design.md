# Prose Highlights — Design

**Date:** 2026-07-31
**Feature:** A toggle that, when on, visually marks complex words (3+ syllables) and tints dense/hard-to-read paragraphs in the rendered Markdown view. The visual companion to the readability score (v0.50.0).
**Approach:** Layered — pure word/paragraph analysis in a new `src/lib/prose.js` (DOM-free, unit-tested, reusing `countSyllables` from `readability.js`), a post-render DOM pass wired into the existing `enhanceDom` in `renderer.js`, and a toggle command in `main.js`.

---

## 1. Goal

Writers are a core mdpeek user. The readability score (v0.50.0) tells you *that* a doc is hard to read; it doesn't show you *where*. This feature points at the problem in the rendered text itself — underlining the jargon-heavy words and tinting the paragraphs where sentences run long. Toggle on to edit, toggle off to read. Quiet, precise, fits the iA Writer register.

## 2. Non-goals (out of scope for v1)

- Per-word replacement suggestions or a thesaurus (highlight only).
- Adverb / passive-voice detection (syllable density + sentence length only).
- Highlights in the **editor** textarea (view + reading mode only — the editor already has its own syntax overlay; mixing prose marks there would clash).
- Highlights inside code blocks, inline code, links, the `==highlight==` `<mark>`, tables, or blockquotes (prose paragraphs only).
- A separate panel/legend UI (a toast on toggle is enough; the colors are self-explanatory).
- Persistence of *which* words were hard (computed live each render).

## 3. Architecture

Three layers, cleanly separated:

```
src/lib/prose.js          ← pure: find complex words + flag dense paragraphs (unit-tested)
src/lib/renderer.js       ← enhanceProseHighlights(container): wrap words + tint paragraphs (DOM pass)
main.js                   ← toggle: mdpeek-prose-highlights flag, palette command, re-render
```

### Why a DOM pass, not a parser extension

The `==highlight==` feature is a marked tokenizer extension (sees inline tokens). Prose highlights can't be, because (a) syllable analysis needs the *final* text after all markdown is resolved, and (b) it must skip code/links/tables selectively. So it's a post-render DOM walk inside the existing `enhanceDom` — the same pattern `enhanceTaskProgress`, `enhanceImages`, etc. already use. Crucially, `enhanceDom` runs **after** `renderMarkdown`'s output is set as `innerHTML`, so it sees the real rendered tree. The render cache (keyed on raw markdown) is unaffected — highlighting is a pure DOM transform layered on cached HTML.

## 4. Pure module — `src/lib/prose.js`

DOM-free. Two responsibilities, both pure + unit-testable.

### API

```js
// Does `word` count as "complex" (hard)? Reuses countSyllables: 3+ syllables.
// Exported so the DOM pass and tests share one definition.
isComplexWord(word) → boolean

// Find complex words in a plain-text string. Returns offsets into that string.
// Skips tokens that aren't Latin-script words (numbers, CJK, punctuation).
//   findComplexWords('The utilization was significant.') → [{ start: 4, end: 16 }, { start: 21, end: 32 }]
findComplexWords(text) → [{ start, end }, …]

// Score a paragraph's text and return whether it's "dense" (hard to read).
// Dense = above thresholds on BOTH avg sentence length AND complex-word ratio,
// with a minimum word count so short paragraphs never flag. Conservative —
// false positives are worse than false negatives for a visual tint.
//   isDenseParagraph(text) → boolean
isDenseParagraph(text) → boolean
```

### Heuristics (deliberately conservative)

- **Complex word:** `countSyllables(word) >= 3` (matches the readability panel's existing definition).
- **Dense paragraph:** `words >= 12` AND (`avgWordsPerSentence > 24` OR `complexRatio > 0.20`), where `complexRatio = complexWords / words`. The 12-word floor prevents tinting headings/short notes; the dual threshold means a paragraph needs to be both long-winded *and* jargon-heavy.

Non-throwing on empty / non-string / CJK-only input (returns `[]` / `false`).

## 5. DOM pass — `enhanceProseHighlights(container)`

Lives in `renderer.js`, called from `enhanceDom` when the new `proseHighlights` option is true. Idempotent (guarded by `container.__proseWired`) so re-renders don't double-wrap.

- Selects only prose paragraphs: `container.querySelectorAll('p')`, **excluding** any `p` inside `pre`, `table`, `blockquote.markdown-alert`, and any `p` that is a table cell.
- For each qualifying paragraph:
  1. If `isDenseParagraph(p.textContent)` → add class `prose-dense` (tints the whole paragraph subtly).
  2. Walk its **text nodes only** (skip `code`, `a`, `mark`, `strong`, `em` children? — *no*: walk all text nodes, but only wrap word matches; existing inline elements stay intact because we split/wrap at text-node granularity using `Range`/`splitText`).
  3. For each text node, run `findComplexWords(node.textContent)` and wrap each match's character range in `<mark class="prose-complex">…</mark>` via `splitText`. Non-overlapping, left-to-right.

### Avoiding the `==highlight==` clash

The bare `.markdown-body mark` rule (content.css:159) styles *any* `<mark>` yellow. Our marks use a class, `<mark class="prose-complex">`, and we add a higher-specificity rule `.markdown-body mark.prose-complex` with a distinct color (squiggly underline + faint tint, using `--alert-tip` green or `--accent` blue — distinctly *not* the warning yellow).

### Performance

- Pure offset computation is O(words). DOM wrapping is O(matches) and only touches text nodes that actually contain a complex word (skip-empty fast path).
- Documents are bounded (this is a local file viewer); even a 10k-word doc has at most a few thousand wraps. Acceptable. The flag is opt-in, so the default render path is unchanged.

## 6. Option plumbing

- `enhanceDom(container, opts)` gains a `proseHighlights = false` option (default off → no behavior change for existing callers).
- `showDocument` in `viewer.js` reads `localStorage.getItem('mdpeek-prose-highlights') === '1'` and passes `proseHighlights: proseHighlightsOn()`.
- The reading-mode path in `main.js` (~line 2892) passes the same flag.

## 7. Toggle + persistence

- Key: `mdpeek-prose-highlights` (default **OFF** — opt-in, like line-numbers; readability is a "show me on demand" tool, not always-on chrome). Stored `'1'`/`'0'`.
- Command: `{ id: 'toggle-prose-highlights', label: 'Toggle prose highlights', keywords: 'prose highlights readability hard complex words sentences difficult writing', run: toggleProseHighlights }`, slotted after the readability command (main.js:1164).
- `toggleProseHighlights()` mirrors `toggleReadability` but **calls `renderActive()`** after flipping the flag (like the code-line-numbers toggle, since the change must show in the rendered view), with a `.catch()` log per the v0.49.1 containment work. Toasts the new state.
- Works in both view and reading mode (both render through `enhanceDom`). In edit mode, it's a no-op toast ("Switch to view or reading mode").

## 8. Gating

Add a **Prose highlights** feature flag (default **ON** — the feature itself defaults off, but the *availability* defaults on), following the established `mdpeek-feature-<name>` system:
- Append `'prose-highlights'` to both `features` array literals (main.js).
- Add a `settings-feature-prose-highlights` checkbox in `index.html`.
- Gate the palette command availability in `getCommands`' filter.

## 9. Testing

`test/prose.test.js` (~18 tests), pure module only:
- `isComplexWord`: 3+ syllable words true, short words false, numbers/CJK/punctuation false, empty safe.
- `findComplexWords`: offset correctness on a sample sentence; skips numbers and CJK; empty/whitespace returns `[]`; non-overlapping ranges.
- `isDenseParagraph`: a clearly dense paragraph true; a short paragraph false; a long-but-simple paragraph false (jargon threshold not met); a jargon-heavy-but-short paragraph false (word floor); empty safe.
- Consistency: every word `findComplexWords` returns satisfies `isComplexWord`.

The DOM pass is verified by the existing renderer tests' shape + manual smoke (it follows the established `enhance*` pattern, which is already proven).

## 10. Files touched

| File | Change |
| --- | --- |
| `src/lib/prose.js` | **New** — pure word/paragraph analysis. |
| `src/lib/renderer.js` | Add `enhanceProseHighlights` + thread `proseHighlights` option through `enhanceDom`. |
| `src/views/viewer.js` | Read the flag, pass the option to `enhanceDom`. |
| `main.js` | Reader-path option, `toggleProseHighlights` command, `proseHighlightsOn()` helper, feature-flag arrays. |
| `index.html` | `settings-feature-prose-highlights` checkbox. |
| `src/styles/content.css` | `.prose-complex` (underline+tint) + `.prose-dense` (paragraph tint) styles. |
| `test/prose.test.js` | **New** — unit tests. |
| `CHANGELOG.md` | Entry + version bump. |

No Rust changes. No new dependencies. ~1 new lib, small edits to renderer/viewer/main/CSS/HTML.
