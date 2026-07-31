# Minimal mode — Design

**Date:** 2026-07-31
**Feature:** A one-click toggle that hides ALL non-core features and their UI, returning mdpeek to a pure featherlight Markdown reader/editor. Nothing is deleted — fully reversible. New installs default ON.
**Approach:** One authoritative Minimal-aware predicate (`featureOn`) + one `body.minimal-mode` CSS class + a guard at the single hub chokepoint. Suppression propagates from the root instead of being patched at 14 sites.

---

## 1. Goal

mdpeek has grown ~14 opt-in features (terminal, collab, workspace hub, pomodoro, graph, SRS, prose highlights, table editor, …). Each is individually togglable, but there is no "make it all go away" switch, and the app has drifted from its `PRODUCT.md` soul ("featherlight… chrome recedes… not an IDE / notebook / knowledge base"). Minimal mode is that switch: ON = pure reader/editor; OFF = every feature the user has enabled comes back.

This is a **perceived-weight** reduction, not a build-time trim — code stays, the binary is unchanged, capabilities are unchanged. What disappears is chrome: buttons, commands, status pills, tiles. Exactly what PRODUCT.md asks for.

## 2. Non-goals (out of scope for v1)

- Deleting or rewriting any feature. (Reversible toggle only.)
- Reducing installer/binary size. (Minimal mode is runtime visibility, not build exclusion.)
- Per-document minimal state. (One global toggle.)
- A guided onboarding flow explaining Minimal mode. (The Settings UI + a toggle toast is enough.)
- Changing core reading/editing behavior in any way.

## 3. Core vs suppressed

**Always available (core):** open/read/edit/save, tabs, file explorer, find & replace, TOC sidebar, reading mode, themes, zoom, command palette, nav history, snapshots/version history.

**Suppressed in Minimal (the 14 feature flags + plain non-core settings):**
`collab`, `kanban`, `terminal`, `present`, `snippets`, `daily`, `pomodoro`, `calendar`, `tasks`, `review`, `autocomplete`, `graph`, `table-editor`, `prose-highlights` — plus the plain-overlay settings: readability score, doc insights, the prose-highlight overlay, OS notifications.

## 4. The authoritative predicate (the core design move)

The whole feature hinges on making `featureOn(name)` Minimal-aware, so every existing call site inherits suppression without per-site patches:

```js
const MINIMAL_SUPPRESSED = new Set([
  'collab','kanban','terminal','present','snippets','daily',
  'pomodoro','calendar','tasks','review','autocomplete','graph',
  'table-editor','prose-highlights',
]);

function minimalModeOn() {
  return localStorage.getItem('mdpeek-minimal-mode') === '1';
}

function featureOn(name) {
  if (minimalModeOn() && MINIMAL_SUPPRESSED.has(name)) return false;
  return localStorage.getItem(`mdpeek-feature-${name}`) !== '0';
}
```

`MINIMAL_SUPPRESSED` is the single source of truth for "what is non-core." Exported for unit testing.

## 5. Closing the leaks `featureOn` alone won't catch

Five sites read flags directly or are entry points that don't go through `featureOn`:

1. **`applyFeatureFlags()`** — extend to (a) hide the **pomodoro status pill** (currently only gated in its render fn), and (b) call a new `applyMinimalChrome()` that toggles `document.body.classList` `minimal-mode`.
2. **Hub chokepoint** — guard the top of `openKanban()` with `if (!featureOn('kanban')) { toast('Minimal mode is on — turn it off in Settings to use the Workspace hub'); return; }`. This single guard covers all five openers (More-menu button, `Ctrl+Shift+K`, palette `kanban`, palette `ws-calendar`/`ws-tasks`/`ws-review`/`ws-graph`, pomodoro pill click).
3. **Palette** — one filter clause at the end of `cmds.filter(...)`: hide any non-core command id when `minimalModeOn()`. The non-core command id set: `ws-calendar`, `ws-tasks`, `ws-review`, `ws-graph`, `pomo-start`, `terminal`, `doc-readability`, `doc-stats`, plus the already-flag-gated ones (`daily`, `start-presentation`, `start-collab`/`end-collab`, `kanban`, `snippet`, `toggle-prose-highlights`, `edit-table`) which already drop out via `featureOn`-based gates.
4. **Prose-highlight overlay** — it's a separate plain setting (`mdpeek-prose-highlights`, default off) gated by the feature flag. Since the flag returns false under Minimal, the overlay can't be toggled on via the palette (command hidden). Defensive: `proseHighlightsOn()`/`proseHighlightsPref()` also return false when `minimalModeOn()` — guarantees the overlay never renders even if the plain key is `'1'`.
5. **Welcome "Today's Note" tile** — `renderWelcome()` drops the `data-action="daily"` tile when `!featureOn('daily')` (Minimal makes it false).

## 6. Defaults — new installs are featherlight

On boot: if `mdpeek-minimal-mode` is unset (null) **and** `loadSession()` is null (genuinely new user — no prior tabs), set Minimal **ON** and persist the key. Existing users (who have a session) see no change until they toggle. This is opt-out for newcomers, opt-in for incumbents.

## 7. Settings UI

A master **"Minimal mode"** toggle at the **top of the Features panel** (before the first feature checkbox). When ON:
- The 14 individual feature checkboxes below are **disabled** (greyed out) and a one-line note appears: *"Minimal mode is on — turn it off to customize individual features."*
- Toggle handler: set the key, then `applyFeatureFlags()`, `applyMinimalChrome()`, `renderActive()`, and re-sync the disabled state of the sub-checkboxes.

`body.minimal-mode` is the visual reset hook; the Settings grey-out is a small `:has()`/JS-driven disabled attribute on the `.setting-card` containing the feature rows.

## 8. Testing

`test/minimal.test.js` (~10 tests), pure:
- `minimalModeOn()` reads the key (unset → false, `'1'` → true).
- `featureOn('terminal')` etc.: false under Minimal, true otherwise (respecting the stored flag).
- `featureOn` for a suppressed feature still respects an explicit `'0'` when Minimal is off.
- `MINIMAL_SUPPRESSED` contains exactly the 14 names and excludes any core name.
- A core feature flag is unaffected by Minimal (e.g. a hypothetical core flag still toggles normally).

DOM/wiring verified by manual smoke (`npm run tauri dev`: fresh-like state → Minimal on → hub/terminal/palette clean; toggle off → features return).

## 9. Files touched

| File | Change |
| --- | --- |
| `src/main.js` | `MINIMAL_SUPPRESSED`, `minimalModeOn`, Minimal-aware `featureOn`, extended `applyFeatureFlags` + new `applyMinimalChrome`, `openKanban` guard, palette filter clause, `renderWelcome` daily-tile gate, boot default-on, settings toggle handler + grey-out sync, `proseHighlightsOn/Pref` defensive guard. |
| `index.html` | Master "Minimal mode" checkbox at top of Features panel. |
| `src/styles/base.css` | `body.minimal-mode` reset hook + `.features-disabled` grey-out styles. |
| `test/minimal.test.js` | **New** — unit tests. |
| `CHANGELOG.md` | Entry + version bump (0.53.0 → 0.54.0). |

No Rust changes. No new dependencies. One predicate + one class + one guard.
