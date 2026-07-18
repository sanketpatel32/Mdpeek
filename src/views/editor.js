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

  // ----- live preview (debounced) -----
  // Skip mermaid rendering here: it's expensive (layout engine) and the
  // edit-mode preview re-renders on every keystroke. Diagrams render fully
  // when the doc is viewed in view mode.
  async function refresh() {
    preview.innerHTML = renderMarkdown(textarea.value);
    await enhanceDom(preview, { mermaid: false });
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
  });
  on('keydown', textarea, onKeyDown);
  on('scroll', textarea, onScroll);

  refresh();
  syncGutter();

  return {
    setValue(text) {
      textarea.value = text;
      refresh();
      syncGutter();
    },
    getValue() {
      return textarea.value;
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
    },
  };
}
