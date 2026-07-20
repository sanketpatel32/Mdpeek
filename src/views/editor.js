import { renderMarkdown, enhanceDom, prepareCodeLang } from '../lib/renderer.js';
import { escapeHtml } from '../lib/escape.js';
// Reuse the same hljs build the viewer uses (highlight.js/lib/common, ~36
// languages bundled). No new dependency — just a second consumer.
import hljs from 'highlight.js/lib/common';
import {
  handleTab,
  handleShiftTab,
  handleEnter,
  wrapSelection,
  toggleLinePrefix,
  autoPair,
  handleBackspace,
  lineCount,
} from '../lib/editor-logic.js';

// Wire a textarea to a live-preview target with debounced re-render, plus the
// editor niceties: line-number gutter, smart Tab/Enter, auto-pair, markdown
// wrap shortcuts, an inline find bar, and (since v0.19.0) live syntax
// highlighting via a transparent-text overlay.
//
// All fiddly selection math lives in editor-logic.js (unit-tested); this module
// is the thin DOM glue that reads the textarea state, calls a logic function,
// and writes the result back.
export function initEditor({ textarea, preview, gutter = null, debounceMs = 150, language = null, highlightEnabled = true }) {
  let timer = null;
  let hlTimer = null;
  const listeners = []; // [target, type, fn] — cleaned up in destroy()
  let typewriter = false; // when true, the active line stays vertically centered
  let currentLanguage = language || null;
  let highlighting = !!highlightEnabled;

  // ----- live syntax-highlight overlay (v0.19.0) -----
  // A <pre class="editor-overlay"><code class="hljs">…</code></pre> sits behind
  // the textarea with identical metrics. The textarea's text is transparent
  // (caret stays visible) so only the overlay's colored text shows through.
  // Built lazily — the wrap may not be in the DOM yet at construction time.
  let overlay = null;     // <pre class="editor-overlay">
  let codeEl = null;      // <code> inside the overlay
  function ensureOverlay() {
    if (overlay) return;
    const wrap = textarea.parentElement;
    if (!wrap) return; // not yet attached
    overlay = document.createElement('pre');
    overlay.className = 'editor-overlay';
    codeEl = document.createElement('code');
    overlay.appendChild(codeEl);
    // Insert as the first child so it sits behind the textarea in stacking
    // order (CSS z-index does the real layering; this is a sane fallback).
    wrap.insertBefore(overlay, wrap.firstChild);
    syncOverlayFont();
  }
  // Copy the textarea's resolved font-family onto the overlay. Necessary
  // because .editor's font-family has !important and uses var(--content-font-
  // family) which resolves at runtime; CSS alone can't propagate the resolved
  // value across elements.
  function syncOverlayFont() {
    if (!overlay) return;
    const cs = getComputedStyle(textarea);
    overlay.style.fontFamily = cs.fontFamily;
  }
  // Render the highlighted HTML into the overlay. Synchronous; cheap for
  // typical files (<5ms). No-op when overlay isn't built yet.
  function doHighlight() {
    if (!codeEl) return;
    const text = textarea.value;
    const lang = currentLanguage;
    let html;
    if (!lang || lang === 'plaintext') {
      html = escapeHtml(text);
    } else if (hljs.getLanguage(lang)) {
      try {
        html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      } catch {
        html = escapeHtml(text); // defensive — ignoreIllegals should prevent this
      }
    } else {
      html = escapeHtml(text); // unknown language — render as plain text
    }
    codeEl.className = `hljs language-${lang || 'plaintext'}`;
    // Trailing newline so the overlay's last line matches the textarea's
    // scrollable height (textarea always has a trailing virtual line).
    codeEl.innerHTML = html + '\n';
  }
  function scheduleHighlight() {
    // Skip when the user has disabled the feature, when no overlay exists, or
    // when the textarea itself isn't visible (view mode / non-active tab).
    if (!highlighting) return;
    if (textarea.offsetParent === null) return;
    ensureOverlay();
    clearTimeout(hlTimer);
    hlTimer = setTimeout(doHighlight, debounceMs);
  }
  // Re-highlight immediately (no debounce) — used after language changes,
  // setting toggles, and async-language-registration events.
  function highlightNow() {
    if (!highlighting) return;
    ensureOverlay();
    doHighlight();
  }
  function applyHighlightClass() {
    const wrap = textarea.parentElement;
    if (!wrap) return;
    // .highlight-on only when the feature is enabled AND there's a non-plaintext
    // language to color. Plaintext files keep the textarea's normal text color.
    const active = highlighting && !!currentLanguage;
    wrap.classList.toggle('highlight-on', active);
  }

  // ----- live preview (debounced) -----
  // Skip mermaid rendering here: it's expensive (layout engine) and the
  // edit-mode preview re-renders on every keystroke. Diagrams render fully
  // when the doc is viewed in view mode.
  async function refresh() {
    if (preview.offsetParent === null) return;
    preview.innerHTML = renderMarkdown(textarea.value);
    // Skip mermaid (expensive, re-renders on every keystroke) and folding
    // (the live preview is too transient for clickable triangles to be useful).
    await enhanceDom(preview, { mermaid: false, folding: false });
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, debounceMs);
  }

  // Apply a logic result back to the textarea: set value, caret, then refresh
  // preview + gutter + overlay. Returns false when nothing changed.
  // NOTE: programmatic textarea.value = ... does NOT fire an 'input' event,
  // so we must explicitly schedule the highlight here too — otherwise the
  // overlay would lag behind after Tab/Enter/auto-pair until the next regular
  // keystroke fires input.
  function applyResult(result) {
    if (!result) return false;
    if (result.text !== textarea.value) textarea.value = result.text;
    textarea.setSelectionRange(result.start, result.end);
    schedule();
    scheduleHighlight();
    syncGutter();
    centerActiveLine();
    return true;
  }

  // ----- gutter (line numbers synced to textarea scroll) -----
  function syncGutter() {
    if (!gutter) return;
    const n = lineCount(textarea.value);
    // Rebuild only when line count changes — avoids flicker on every keystroke.
    if (gutter.childElementCount !== n) {
      let html = '';
      for (let i = 1; i <= n; i++) html += `<div>${i}</div>`;
      gutter.innerHTML = html;
    }
  }
  function onScroll() {
    if (gutter) gutter.scrollTop = textarea.scrollTop;
    // Keep the overlay perfectly aligned with the textarea — both axes. Without
    // this the colored text drifts off the typed text the moment the user
    // scrolls. Cheap: just two property writes per scroll event.
    if (overlay) {
      overlay.scrollLeft = textarea.scrollLeft;
      overlay.scrollTop = textarea.scrollTop;
    }
  }
  // Typewriter mode: vertically center the line containing the caret. Called
  // after every input/selection change while the mode is on. Reads the
  // textarea's lineHeight (cached) and the caret offset to compute the line.
  let cachedLineHeight = 0;
  function centerActiveLine() {
    if (!typewriter) return;
    const ta = textarea;
    const { selectionStart } = ta;
    const lineNum = ta.value.slice(0, selectionStart).split('\n').length - 1;
    if (!cachedLineHeight) {
      cachedLineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 22;
    }
    const target = lineNum * cachedLineHeight - ta.clientHeight / 2 + cachedLineHeight / 2;
    ta.scrollTop = Math.max(0, target);
    if (gutter) gutter.scrollTop = ta.scrollTop;
  }

  // ----- keydown: Tab, Enter, auto-pair, wrap shortcuts, find -----
  function onKeyDown(e) {
    const { selectionStart: s, selectionEnd: en } = textarea;
    const ctrl = e.ctrlKey || e.metaKey;

    // Markdown wrap shortcuts. stopPropagation so the global Ctrl+B (sidebar
    // toggle) doesn't also fire while editing.
    if (ctrl && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      e.stopPropagation();
      applyResult(wrapSelection(textarea.value, s, en, '**'));
      return;
    }
    if (ctrl && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      e.stopPropagation();
      applyResult(wrapSelection(textarea.value, s, en, '*'));
      return;
    }
    if (ctrl && e.key === '`') {
      e.preventDefault();
      e.stopPropagation();
      applyResult(wrapSelection(textarea.value, s, en, '`'));
      return;
    }

    // Ctrl+F is owned by the global find module now — no handler here.

    if (e.key === 'Tab') {
      e.preventDefault();
      applyResult(e.shiftKey ? handleShiftTab(textarea.value, s, en) : handleTab(textarea.value, s, en));
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      const r = handleEnter(textarea.value, s, en);
      if (r.text !== textarea.value) {
        e.preventDefault();
        applyResult(r);
      }
      return;
    }

    // Auto-pair: single printable char, no selection, no ctrl/alt.
    if (e.key.length === 1 && s === en && !ctrl && !e.altKey) {
      const r = autoPair(textarea.value, s, en, e.key);
      if (r && r.handled) {
        e.preventDefault();
        applyResult(r);
      }
      return;
    }

    // Backspace: delete both chars of an empty pair.
    if (e.key === 'Backspace' && s === en && !ctrl && !e.altKey) {
      const r = handleBackspace(textarea.value, s, en);
      if (r) {
        e.preventDefault();
        applyResult(r);
      }
    }
  }

  // ----- wiring -----
  function on(type, target, fn) {
    target.addEventListener(type, fn);
    listeners.push([target, type, fn]);
  }

  on('input', textarea, () => {
    schedule();
    scheduleHighlight();
    syncGutter();
    centerActiveLine();
  });
  on('keydown', textarea, onKeyDown);
  // Re-center on caret moves that don't fire input (arrow keys, clicks).
  on('keyup', textarea, centerActiveLine);
  on('click', textarea, centerActiveLine);
  on('scroll', textarea, onScroll);

  // Re-highlight when an extra language (e.g. dockerfile, toml) finishes its
  // dynamic import. Same trick main.js uses to re-render the code viewer.
  function onLangRegistered() {
    highlightNow();
  }
  window.addEventListener('hljs-language-registered', onLangRegistered);
  listeners.push([window, 'hljs-language-registered', onLangRegistered]);

  refresh();
  syncGutter();
  // First-paint highlight + class setup. Skipped internally if the textarea
  // isn't visible yet (e.g. opening in view mode); re-runs when it becomes
  // visible via setValue / scheduleHighlight on first input.
  applyHighlightClass();
  if (highlighting) {
    ensureOverlay();
    // Kick off extra-language import for non-bundled languages (toml, ini,
    // etc.) — when it resolves, onLangRegistered re-highlights.
    if (currentLanguage && currentLanguage !== 'plaintext') {
      prepareCodeLang(currentLanguage).then(() => highlightNow()).catch(() => {});
    } else {
      highlightNow();
    }
  }

  return {
    // Set the textarea's value. Only writes when the value actually differs —
    // re-entry into renderActive (e.g. markDirty emitting 'change' on the
    // first keystroke) would otherwise clobber the textarea mid-composition
    // and swallow the user's first character.
    setValue(text) {
      if (textarea.value !== text) textarea.value = text;
      refresh();
      syncGutter();
      // Re-highlight on programmatic value changes (tab switch, file open).
      // Immediate (not debounced) so the overlay matches before paint.
      highlightNow();
    },
    getValue() {
      return textarea.value;
    },
    // Toggle typewriter mode (vertical centering of the active line).
    setTypewriter(on) {
      typewriter = !!on;
      cachedLineHeight = 0; // recompute in case font size changed since init
      if (typewriter) centerActiveLine();
      // Font-size changes from the typewriter-mode setter (if any) should
      // re-sync the overlay font too.
      syncOverlayFont();
    },
    // Set the active language for highlighting. Pass null or 'plaintext' to
    // disable. Triggers an immediate re-highlight + class update.
    setLanguage(lang) {
      const next = lang || null;
      if (next === currentLanguage) {
        // Already set — but the class might be stale if highlighting was just
        // toggled on. Re-apply defensively.
        applyHighlightClass();
        return;
      }
      currentLanguage = next;
      applyHighlightClass();
      // Kick off extra-language registration for non-bundled languages
      // (dockerfile, toml, ini, …). When it resolves, the global event listener
      // re-highlights.
      if (next && next !== 'plaintext') {
        prepareCodeLang(next).then(() => highlightNow()).catch(() => {});
      }
      highlightNow();
    },
    // Toggle the highlight feature on/off at runtime (Settings → Editor). When
    // off, the overlay is hidden via CSS (:not(.highlight-on)) and the
    // textarea's text returns to opaque.
    setHighlightEnabled(on) {
      highlighting = !!on;
      applyHighlightClass();
      if (highlighting) highlightNow();
    },
    // Insert `text` at the caret, replacing any selection, and place the caret
    // after the inserted text. Used for image drops/pastes that emit markdown.
    insertAtCursor(text) {
      const s = textarea.selectionStart;
      const en = textarea.selectionEnd;
      const before = textarea.value.slice(0, s);
      const after = textarea.value.slice(en);
      textarea.value = before + text + after;
      const caret = s + text.length;
      textarea.setSelectionRange(caret, caret);
      textarea.focus();
      schedule();
      scheduleHighlight(); // programmatic value change — see applyResult note
      syncGutter();
    },
    refresh,
    // Expose the raw textarea so the global find module can read lineHeight,
    // scrollTop, etc. without duplicating state.
    textarea: () => textarea,
    focus: () => textarea.focus(),
    // Capture caret + scroll so a tab switch away and back preserves position.
    getState() {
      return {
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
        scrollTop: textarea.scrollTop,
      };
    },
    setState(state) {
      if (!state) return;
      textarea.focus();
      textarea.setSelectionRange(state.start || 0, state.end || 0);
      textarea.scrollTop = state.scrollTop || 0;
      // Mirror scroll to the overlay so a tab switch back into edit mode shows
      // the highlighted text at the right scroll offset.
      if (overlay) {
        overlay.scrollLeft = textarea.scrollLeft;
        overlay.scrollTop = textarea.scrollTop;
      }
    },
    // Apply a markdown formatting action from the toolbar. Supports wrap-based
    // (bold/italic/code/link) and line-prefix (headings/lists/quote) styles,
    // plus a fenced code-block insert. Each is a toggle when applicable.
    format(type) {
      const s = textarea.selectionStart;
      const en = textarea.selectionEnd;
      switch (type) {
        case 'bold': return applyResult(wrapSelection(textarea.value, s, en, '**'));
        case 'italic': return applyResult(wrapSelection(textarea.value, s, en, '*'));
        case 'code': return applyResult(wrapSelection(textarea.value, s, en, '`'));
        case 'link': {
          const sel = textarea.value.slice(s, en);
          const url = sel.startsWith('http') ? sel : 'https://';
          const text = sel || 'link text';
          return applyResult({ text: textarea.value.slice(0, s) + `[${text}](${url})` + textarea.value.slice(en), start: s + text.length + 3, end: s + text.length + 3 + url.length });
        }
        case 'h1': return applyResult(toggleLinePrefix(textarea.value, s, en, '# '));
        case 'h2': return applyResult(toggleLinePrefix(textarea.value, s, en, '## '));
        case 'ul': return applyResult(toggleLinePrefix(textarea.value, s, en, '- '));
        case 'ol': return applyResult(toggleLinePrefix(textarea.value, s, en, '1. '));
        case 'quote': return applyResult(toggleLinePrefix(textarea.value, s, en, '> '));
        case 'fence': {
          const insert = '\n```\n\n```\n';
          return applyResult({ text: textarea.value.slice(0, s) + insert + textarea.value.slice(en), start: s + 5, end: s + 5 });
        }
        default: return false;
      }
    },
    destroy() {
      clearTimeout(timer);
      clearTimeout(hlTimer);
      for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
      listeners.length = 0;
      // Remove the overlay element so re-creating the editor (new tab in edit
      // mode) doesn't stack stale overlays inside .editor-wrap.
      if (overlay && overlay.parentElement) {
        overlay.parentElement.removeChild(overlay);
      }
      overlay = null;
      codeEl = null;
    },
  };
}
