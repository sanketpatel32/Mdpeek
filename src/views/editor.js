import { renderMarkdown, enhanceDom } from '../lib/renderer.js';
import {
  handleTab,
  handleShiftTab,
  handleEnter,
  wrapSelection,
  autoPair,
  handleBackspace,
  findMatches,
  nextMatchIndex,
  lineCount,
} from '../lib/editor-logic.js';

// Wire a textarea to a live-preview target with debounced re-render, plus the
// editor niceties: line-number gutter, smart Tab/Enter, auto-pair, markdown
// wrap shortcuts, and an inline find bar.
//
// All fiddly selection math lives in editor-logic.js (unit-tested); this module
// is the thin DOM glue that reads the textarea state, calls a logic function,
// and writes the result back.
export function initEditor({ textarea, preview, gutter = null, findBar = null, debounceMs = 150 }) {
  let timer = null;
  const listeners = []; // [target, type, fn] — cleaned up in destroy()

  // ----- live preview (debounced) -----
  async function refresh() {
    preview.innerHTML = renderMarkdown(textarea.value);
    await enhanceDom(preview);
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

    // Ctrl+F → open the find bar (owned here so the browser's native find never shows).
    if (ctrl && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      e.stopPropagation();
      openFind();
      return;
    }

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

  // ----- find bar -----
  let matches = [];
  let matchIdx = -1;

  function openFind() {
    if (!findBar) return;
    findBar.classList.remove('hidden');
    const input = findBar.querySelector('.find-input');
    if (input) {
      input.focus();
      input.select();
    }
  }
  function closeFind() {
    if (!findBar) return;
    findBar.classList.add('hidden');
    textarea.focus();
  }
  function updateCount() {
    const countEl = findBar ? findBar.querySelector('.find-count') : null;
    if (countEl) {
      countEl.textContent = matches.length === 0 ? '0/0' : `${matchIdx + 1}/${matches.length}`;
    }
  }
  function runFind(forward) {
    if (!findBar) return;
    const input = findBar.querySelector('.find-input');
    const query = input ? input.value : '';
    matches = findMatches(textarea.value, query, false);
    if (matches.length === 0) {
      matchIdx = -1;
      updateCount();
      return;
    }
    matchIdx = nextMatchIndex(matches, textarea.selectionStart, forward);
    jumpTo(matches[matchIdx]);
    updateCount();
  }
  function jumpTo(m) {
    textarea.focus();
    textarea.setSelectionRange(m.start, m.end);
    // Approximate-scroll: line number * lineHeight, centered in the viewport.
    const lineNum = textarea.value.slice(0, m.start).split('\n').length - 1;
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight);
    textarea.scrollTop = Math.max(0, lineNum * lineHeight - textarea.clientHeight / 2);
  }
  function onFindKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      runFind(!e.shiftKey); // Enter = next, Shift+Enter = prev
    } else if (e.key === 'F3') {
      e.preventDefault();
      runFind(!e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    }
  }
  // Live-update match count as the user types the query.
  function onFindInput() {
    if (!findBar) return;
    const query = findBar.querySelector('.find-input')?.value || '';
    matches = findMatches(textarea.value, query, false);
    matchIdx = matches.length === 0 ? -1 : nextMatchIndex(matches, textarea.selectionStart, true);
    updateCount();
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
  if (findBar) {
    on('keydown', findBar, onFindKey);
    const input = findBar.querySelector('.find-input');
    if (input) on('input', input, onFindInput);
    const prevBtn = findBar.querySelector('.find-prev');
    const nextBtn = findBar.querySelector('.find-next');
    const closeBtn = findBar.querySelector('.find-close');
    if (prevBtn) on('click', prevBtn, () => runFind(false));
    if (nextBtn) on('click', nextBtn, () => runFind(true));
    if (closeBtn) on('click', closeBtn, closeFind);
  }

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
    refresh,
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
    openFind,
    closeFind,
    destroy() {
      clearTimeout(timer);
      for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
      listeners.length = 0;
    },
  };
}
