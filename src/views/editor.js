import { renderMarkdown, enhanceDom } from '../lib/renderer.js';
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
// wrap shortcuts, and an inline find bar.
//
// All fiddly selection math lives in editor-logic.js (unit-tested); this module
// is the thin DOM glue that reads the textarea state, calls a logic function,
// and writes the result back.
export function initEditor({ textarea, preview, gutter = null, debounceMs = 150 }) {
  let timer = null;
  const listeners = []; // [target, type, fn] — cleaned up in destroy()
  let typewriter = false; // when true, the active line stays vertically centered

  // Older releases used this class to hide the textarea text and show a second
  // highlighted copy underneath. Always clear stale state so the native
  // textarea is the only text renderer and the cursor cannot drift from glyphs.
  textarea.parentElement?.classList.remove('highlight-on');
  // One source line must always occupy one visual row. This makes the native
  // textarea and gutter share the same simple line-height model; long lines
  // scroll horizontally instead of silently shifting every later line number.
  textarea.setAttribute('wrap', 'off');

  // ----- live preview (debounced) -----
  // Skip mermaid rendering here: it's expensive (layout engine) and the
  // edit-mode preview re-renders on every keystroke. Diagrams render fully
  // when the doc is viewed in view mode.
  async function refresh() {
    if (!preview || preview.offsetParent === null) return;
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
  // preview + gutter. Returns false when nothing changed.
  function applyResult(result) {
    if (!result) return false;
    if (result.text !== textarea.value) textarea.value = result.text;
    textarea.setSelectionRange(result.start, result.end);
    schedule();
    syncGutter();
    centerActiveLine();
    return true;
  }

  // ----- gutter (line numbers synced to textarea scroll) -----
  // Wrapping is disabled, so each source line is exactly one visual row.
  function syncGutter() {
    if (!gutter) return;
    const text = textarea.value;
    const n = text.length ? text.split('\n').length : 1;
    if (gutter.childElementCount !== n || gutter.dataset.lastCount !== String(n)) {
      let html = '';
      for (let i = 1; i <= n; i++) html += `<div>${i}</div>`;
      gutter.innerHTML = html;
      gutter.dataset.lastCount = String(n);
    }
    const cs = getComputedStyle(textarea);
    const fs = parseFloat(cs.fontSize) || 13.5;
    const rawLh = parseFloat(cs.lineHeight);
    const linePx = Math.max(1, Math.round(rawLh || (fs * 1.6)));
    const linePxStr = linePx + 'px';

    textarea.style.lineHeight = linePxStr;
    gutter.style.fontFamily = cs.fontFamily;
    gutter.style.fontSize = cs.fontSize;
    gutter.style.lineHeight = linePxStr;
    gutter.style.paddingTop = cs.paddingTop;
    gutter.style.paddingBottom = cs.paddingBottom;

    cachedLineHeight = linePx;
    const kids = gutter.children;

    for (let i = 0; i < n; i++) {
      if (kids[i]) {
        kids[i].style.height = linePxStr;
        kids[i].style.lineHeight = linePxStr;
      }
    }
  }
  function onScroll() {
    if (gutter) gutter.scrollTop = textarea.scrollTop;
    // Re-position the active-line marker so it scrolls with the text.
    updateActiveLineMarker();
  }
  // Typewriter mode: vertically center the line containing the caret. Called
  // after every input/selection change while the mode is on. Reads the
  // textarea's lineHeight (cached) and the caret offset to compute the line.
  let cachedLineHeight = 0;
  function centerActiveLine() {
    updateActiveLineMarker();
    if (!typewriter) return;
    const ta = textarea;
    const { selectionStart } = ta;
    const lineNum = ta.value.slice(0, selectionStart).split('\n').length - 1;
    const lh = cachedLineHeight || 22;
    const target = lineNum * lh - ta.clientHeight / 2 + lh / 2;
    ta.scrollTop = Math.max(0, target);
    if (gutter) gutter.scrollTop = ta.scrollTop;
  }
  // Active-line highlight: paint a thin background strip on the caret line so
  // the user always sees where they are. We do this by setting two CSS vars on
  // the wrap:
  //   --active-line-top, --active-line-h (in px, scroll-relative)
  // and a thin ::before pseudo on .editor-wrap renders the highlight. JS keeps
  // the offsets fresh on input, scroll, click, and resize.
  //
  function updateActiveLineMarker() {
    const wrap = textarea.parentElement;
    if (!wrap) return;
    const cs = getComputedStyle(textarea);
    const fs = parseFloat(cs.fontSize) || 13.5;
    const rawLh = parseFloat(cs.lineHeight);
    const linePx = Math.max(1, Math.round(rawLh || (fs * 1.6)));
    cachedLineHeight = linePx;

    const padTop = parseFloat(cs.paddingTop) || 0;
    const before = textarea.value.slice(0, textarea.selectionStart);
    const lineNum = before.split('\n').length - 1;

    const top = padTop + (lineNum * linePx) - textarea.scrollTop;
    wrap.style.setProperty('--active-line-top', `${top}px`);
    wrap.style.setProperty('--active-line-h', `${linePx}px`);
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
    syncGutter();
    centerActiveLine();
  });
  on('keydown', textarea, onKeyDown);
  // Re-center on caret moves that don't fire input (arrow keys, clicks).
  on('keyup', textarea, centerActiveLine);
  on('click', textarea, centerActiveLine);
  on('scroll', textarea, onScroll);
  // Re-sync gutter when font metrics or the textarea size changes.
  let gutterResizeObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    gutterResizeObserver = new ResizeObserver(() => {
      syncGutter();
      cachedLineHeight = 0; // force re-measure in case font-size changed
      updateActiveLineMarker();
    });
    gutterResizeObserver.observe(textarea);
  }

  refresh();
  syncGutter();
  updateActiveLineMarker();

  return {
    // Set the textarea's value. Only writes when the value actually differs —
    // re-entry into renderActive (e.g. markDirty emitting 'change' on the
    // first keystroke) would otherwise clobber the textarea mid-composition
    // and swallow the user's first character.
    setValue(text) {
      if (textarea.value !== text) textarea.value = text;
      refresh();
      syncGutter();
    },
    getValue() {
      return textarea.value;
    },
    // Toggle typewriter mode (vertical centering of the active line).
    setTypewriter(on) {
      typewriter = !!on;
      cachedLineHeight = 0; // recompute in case font size changed since init
      if (typewriter) centerActiveLine();
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
    },
    // Apply a markdown formatting action from the toolbar. Supports wrap-based
    // (bold/italic/code/link) and line-prefix (headings/lists/quote) styles,
    // plus a fenced code-block insert. Each is a toggle when applicable.
    syncGutter() {
      syncGutter();
    },
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
      for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
      listeners.length = 0;
      if (gutterResizeObserver) { gutterResizeObserver.disconnect(); gutterResizeObserver = null; }
    },
  };
}
