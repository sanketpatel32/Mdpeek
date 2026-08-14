import { renderMarkdown, enhanceDom } from '../lib/renderer.js';
import {
  handleTab,
  handleShiftTab,
  handleEnter,
  wrapSelection,
  toggleLinePrefix,
  autoPair,
  handleBackspace,
  insertLink,
  lineCount,
  duplicateLines,
  moveLines,
  toggleComment,
  tableCellNav,
  transposeChars,
  joinLine,
  selectLine,
  extractHeadings,
} from '../lib/editor-logic.js';
import { sectionRanges, foldedLineSet, foldedLineCount } from '../lib/fold.js';

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
  // v0.46.0: Ctrl+L select-line repeat detection. Tracks the last press time
  // and the selection anchor so a second Ctrl+L within 1.5s extends downward.
  let _lastSelectLineAt = 0;
  let _selectLineAnchor = null;

  // Older releases used this class to hide the textarea text and show a second
  // highlighted copy underneath. Always clear stale state so the native
  // textarea is the only text renderer and the cursor cannot drift from glyphs.
  textarea.parentElement?.classList.remove('highlight-on');
  // Soft-wrap long lines instead of forcing horizontal scrolling (the #1
  // editor complaint — a single long sentence used to overflow by 1000+ px and
  // the user couldn't see what they typed). The gutter, active-line marker,
  // and typewriter mode all read positions from the mirror (below) so they
  // stay aligned even when a source line wraps to multiple visual rows.
  // v0.37.0: wrap is configurable via mdpeek-word-wrap (default soft). Reading
  // localStorage here matches the mdpeek-active-line pattern at line 196.
  const wrapPref = (() => { try { return localStorage.getItem('mdpeek-word-wrap'); } catch { return null; } })();
  textarea.setAttribute('wrap', wrapPref === '0' ? 'off' : 'soft');

  // ----- hidden mirror (wrap-aware measurement) -----
  // A visibility:hidden div that echoes the textarea's text one <div> per
  // source line, with identical font/padding/width. The browser lays it out
  // natively, so offsetTop/offsetHeight on a mirror line account for wrapping.
  // This is the standard technique (used by GitHub's comment box, VS Code's
  // simple editors) for measuring wrapped-text positions without a real
  // editor framework. Created once per initEditor; rebuilt on every input.
  const wrap = textarea.parentElement;
  let mirror = wrap?.querySelector('.editor-mirror');
  if (!mirror && wrap) {
    mirror = document.createElement('div');
    mirror.className = 'editor-mirror';
    mirror.setAttribute('aria-hidden', 'true');
    wrap.appendChild(mirror);
  }
  // Sync the mirror's typography + box to the textarea so wrapping points
  // match exactly. Called on every updateMirror + on resize.
  function syncMirrorBox() {
    if (!mirror) return;
    const cs = getComputedStyle(textarea);
    mirror.style.fontFamily = cs.fontFamily;
    mirror.style.fontSize = cs.fontSize;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.paddingTop = cs.paddingTop;
    mirror.style.paddingRight = cs.paddingRight;
    mirror.style.paddingBottom = cs.paddingBottom;
    mirror.style.paddingLeft = cs.paddingLeft;
    mirror.style.borderWidth = cs.borderWidth;
    mirror.style.boxSizing = cs.boxSizing;
    // clientWidth excludes the scrollbar, matching the textarea's content box.
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.style.tabSize = cs.tabSize;
  }
  // Rebuild the mirror's per-line children from the textarea's current text.
  function updateMirror() {
    if (!mirror) return;
    syncMirrorBox();
    const lines = textarea.value.split('\n');
    // Build one <div> per source line. textContent auto-escapes. Empty lines
    // get a <br> so they occupy one line-height (a bare <div></DIV> collapses).
    let html = '';
    for (const line of lines) {
      html += '<div>';
      html += line.length ? line : '<br>';
      html += '</div>';
    }
    mirror.innerHTML = html;
  }

  // ----- live preview (debounced) -----
  // Skip mermaid rendering here: it's expensive (layout engine) and the
  // edit-mode preview re-renders on every keystroke. Diagrams render fully
  // when the doc is viewed in view mode.
  async function refresh() {
    if (!preview || preview.offsetParent === null) return;
    let html;
    try {
      html = renderMarkdown(textarea.value);
    } catch (e) {
      // Don't blank the pane on a parse error — show a small inline note so
      // the user knows their markdown has an issue without losing context.
      console.error('[mdpeek] preview renderMarkdown failed:', e);
      return;
    }
    preview.innerHTML = html;
    // Skip mermaid (expensive, re-renders on every keystroke) and folding
    // (the live preview is too transient for clickable triangles to be useful).
    // Line numbers on fenced blocks follow the mdpeek-code-line-numbers setting.
    let lineNumbers = false;
    try { lineNumbers = localStorage.getItem('mdpeek-code-line-numbers') === '1'; }
    catch { /* jsdom / SSR — default off */ }
    await enhanceDom(preview, { mermaid: false, folding: false, lineNumbers });
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, debounceMs);
  }

  // Replace the whole value while KEEPING the native undo stack. Direct
  // `.value =` assignment wipes Chromium's textarea undo (Ctrl+Z stops working
  // after any smart-key edit). execCommand('insertText') over a select-all
  // replacement records an undoable step; when unavailable/refused we fall
  // back to the direct assignment (undo lost, editing still works).
  function setValueUndoable(newText) {
    textarea.focus();
    textarea.select();
    let applied = false;
    try { applied = document.execCommand('insertText', false, newText); } catch { applied = false; }
    if (!applied) textarea.value = newText;
  }

  // Apply a logic result back to the textarea: set value, caret, then refresh
  // preview + gutter. Returns false when nothing changed.
  function applyResult(result) {
    if (!result) return false;
    if (result.text !== textarea.value) setValueUndoable(result.text);
    textarea.setSelectionRange(result.start, result.end);
    schedule();
    syncGutter();
    centerActiveLine();
    return true;
  }

  // ----- gutter (line numbers synced to textarea scroll) -----
  // Wrap-aware: each gutter row's height = the corresponding mirror line's
  // offsetHeight, which reflects how many visual rows that source line
  // wrapped to. A line that wraps to 3 visual rows gets a 3×lineHeight gutter
  // row; the number renders on the first visual row (top of the row).
  function syncGutter() {
    if (!gutter) return;
    updateMirror();
    const n = textarea.value.length ? textarea.value.split('\n').length : 1;
    if (gutter.childElementCount !== n || gutter.dataset.lastCount !== String(n)) {
      let html = '';
      for (let i = 1; i <= n; i++) html += `<div>${i}</div>`;
      gutter.innerHTML = html;
      gutter.dataset.lastCount = String(n);
      // Rebuilding resets the gutter's scroll — re-align with the textarea
      // (numbers used to jump to the top after any line-count change).
      gutter.scrollTop = textarea.scrollTop;
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
    // KEY CHANGE: each gutter row is as tall as the wrapped mirror line, so
    // numbers stay aligned with text that spans multiple visual rows.
    const mirrorLines = mirror?.children || [];
    const kids = gutter.children;
    for (let i = 0; i < n && i < mirrorLines.length; i++) {
      if (kids[i] && mirrorLines[i]) {
        const h = mirrorLines[i].offsetHeight;
        kids[i].style.height = h ? `${h}px` : linePxStr;
        kids[i].style.lineHeight = linePxStr;
      } else if (kids[i]) {
        kids[i].style.height = linePxStr;
        kids[i].style.lineHeight = linePxStr;
      }
    }
  }
  function onScroll() {
    if (gutter) gutter.scrollTop = textarea.scrollTop;
    // Re-position the active-line marker so it scrolls with the text.
    updateActiveLineMarker();
    // Re-position the fold overlay so markers scroll with the text.
    syncFolds();
  }
  // Typewriter mode: vertically center the line containing the caret. Called
  // after every input/selection change while the mode is on. Reads the line's
  // position from the mirror so it works on wrapped lines.
  let cachedLineHeight = 0;
  function centerActiveLine() {
    updateActiveLineMarker();
    if (!typewriter) return;
    const before = textarea.value.slice(0, textarea.selectionStart);
    const lineIdx = before.split('\n').length - 1;
    const mirrorLine = mirror?.children[lineIdx];
    if (!mirrorLine) return;
    const lineCenter = mirrorLine.offsetTop + mirrorLine.offsetHeight / 2;
    textarea.scrollTop = Math.max(0, lineCenter - textarea.clientHeight / 2);
    if (gutter) gutter.scrollTop = textarea.scrollTop;
  }
  // Active-line highlight: paint a thin background strip on the caret line so
  // the user always sees where they are. We do this by setting two CSS vars on
  // the wrap:
  //   --active-line-top, --active-line-h (in px, scroll-relative)
  // and a thin ::before pseudo on .editor-wrap renders the highlight. JS keeps
  // the offsets fresh on input, scroll, click, and resize. Position is read
  // from the mirror so it tracks wrapped lines correctly.
  function updateActiveLineMarker() {
    if (!textarea || !textarea.isConnected) return;
    const wrap = textarea.parentElement;
    if (!wrap) return;
    if (localStorage.getItem('mdpeek-active-line') === '0') {
      wrap.style.setProperty('--active-line-opacity', '0');
      return;
    }
    wrap.style.setProperty('--active-line-opacity', '1');

    const cs = getComputedStyle(textarea);
    const fs = parseFloat(cs.fontSize) || 13.5;
    const rawLh = parseFloat(cs.lineHeight);
    const linePx = Math.max(1, Math.round(rawLh || (fs * 1.6)));
    cachedLineHeight = linePx;

    const before = textarea.value.slice(0, textarea.selectionStart);
    const lineIdx = before.split('\n').length - 1;
    const mirrorLine = mirror?.children[lineIdx];
    if (!mirrorLine) return;
    // offsetTop is relative to the mirror's padding box; subtract the
    // textarea's scrollTop to convert to a scroll-relative position. The
    // mirror's own offsetTop (its top within .editor-wrap) is 0 since it's
    // positioned at top:0, but include it defensively.
    const top = mirrorLine.offsetTop + (mirror?.offsetTop || 0) - textarea.scrollTop;
    const h = mirrorLine.offsetHeight || linePx;
    wrap.style.setProperty('--active-line-top', `${top}px`);
    wrap.style.setProperty('--active-line-h', `${h}px`);
  }

  // ----- keydown: Tab, Enter, auto-pair, wrap shortcuts, find -----
  function onKeyDown(e) {
    // v0.67.0: IME guard — keydowns during composition (isComposing / the
    // legacy 229 keyCode) must reach the IME, not our Enter/auto-pair logic.
    if (e.isComposing || e.keyCode === 229) return;
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
    // Ctrl/Cmd+K → insert `[selection](url)` link. Try to read a URL from the
    // clipboard first (best-effort; may be blocked). If the clipboard has a
    // URL, pre-fill it; otherwise leave the URL slot empty. Mirrors VS Code.
    if (ctrl && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      e.stopPropagation();
      const text = textarea.value;
      const insert = (url) => applyResult(insertLink(text, s, en, url));
      if (navigator.clipboard && navigator.clipboard.readText) {
        // Race the clipboard read against a short timeout so a blocked/empty
        // clipboard doesn't hang the insert. Either way, we insert exactly once.
        let done = false;
        const run = () => {
          if (done) return;
          done = true;
          insert('');
        };
        navigator.clipboard.readText().then((clip) => {
          if (done) return;
          const trimmed = (clip || '').trim();
          done = true;
          insert(/^https?:\/\//i.test(trimmed) && trimmed.length < 2048 ? trimmed : '');
        }).catch(run);
        setTimeout(run, 120); // fallback if clipboard hangs
      } else {
        insert('');
      }
      return;
    }

    // Ctrl+D → duplicate line(s) downward. Matches VS Code / Sublime muscle
    // memory. (Note: VS Code also uses Ctrl+D for "add next occurrence" — we
    // don't have multi-cursor, so duplicate is the more useful binding here.)
    if (ctrl && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      e.stopPropagation();
      applyResult(duplicateLines(textarea.value, s, en));
      return;
    }
    // Ctrl+Shift+X → strikethrough (wrap in ~~). Mirrors the toolbar button.
    if (ctrl && e.shiftKey && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      e.stopPropagation();
      applyResult(wrapSelection(textarea.value, s, en, '~~'));
      return;
    }
    // Ctrl+Shift+H → highlight (wrap in ==). Renders as <mark>.
    if (ctrl && e.shiftKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      e.stopPropagation();
      applyResult(wrapSelection(textarea.value, s, en, '=='));
      return;
    }
    // Ctrl+Shift+. → toggle blockquote prefix (> ). Mirrors the toolbar button;
    // gives quote a keybind to match bold/italic/code.
    if (ctrl && e.shiftKey && e.key === '.') {
      e.preventDefault();
      e.stopPropagation();
      applyResult(toggleLinePrefix(textarea.value, s, en, '> '));
      return;
    }
    // Ctrl+/ → toggle HTML comment around selection (or current line).
    if (ctrl && e.key === '/') {
      e.preventDefault();
      e.stopPropagation();
      applyResult(toggleComment(textarea.value, s, en));
      return;
    }
    // Alt+Up / Alt+Down → move line(s) up/down. No-op at the doc's edge leaves
    // the text untouched (applyResult returns false and writes nothing).
    if (e.altKey && !ctrl && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      applyResult(moveLines(textarea.value, s, en, dir));
      return;
    }
    // Ctrl+T → transpose characters around the caret (B1, v0.46.0). Classic
    // Unix-editing keybind; no-op at line start. Only fires when there's no
    // selection (transpose is a caret operation).
    if (ctrl && !e.shiftKey && (e.key === 't' || e.key === 'T') && s === en) {
      e.preventDefault();
      e.stopPropagation();
      applyResult(transposeChars(textarea.value, s));
      return;
    }
    // Ctrl+J → join current line with the next (B2, v0.46.0). No-op on the
    // last line. Caret lands at the join point.
    if (ctrl && !e.shiftKey && e.key === 'j' && s === en) {
      e.preventDefault();
      e.stopPropagation();
      applyResult(joinLine(textarea.value, s));
      return;
    }
    // Ctrl+L → select the current line (B4, v0.46.0). First press selects the
    // whole line; repeat within 1.5s extends the selection one line down.
    if (ctrl && !e.shiftKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      const isRepeat = _lastSelectLineAt && (now - _lastSelectLineAt < 1500) && _selectLineAnchor != null;
      if (isRepeat) {
        const r = selectLine(textarea.value, en, { anchor: _selectLineAnchor, extend: true });
        textarea.setSelectionRange(r.start, r.end);
      } else {
        const r = selectLine(textarea.value, s, { anchor: s, extend: false });
        textarea.setSelectionRange(r.start, r.end);
        _selectLineAnchor = r.start;
      }
      _lastSelectLineAt = now;
      return;
    }

    // Ctrl+F is owned by the global find module now — no handler here.

    if (e.key === 'Tab') {
      // v0.44.0: inside a markdown table row, Tab/Shift+Tab jump cell-to-cell
      // instead of inserting/removing indent. Falls through to handleTab when
      // the caret isn't in a table cell.
      const nav = tableCellNav(textarea.value, s, e.shiftKey ? -1 : 1);
      if (nav) {
        e.preventDefault();
        textarea.setSelectionRange(nav.caret, nav.caret);
        return;
      }
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
    if (e.key.length === 1 && !ctrl && !e.altKey) {
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

  // ----- region folding (v0.55.0) -----
  // Pure line-math lives in fold.js; this block is the DOM glue. The textarea
  // ALWAYS holds the true source — folding is purely visual (an overlay masks
  // the folded lines + a chip marks the fold). Fold state is a per-editor,
  // in-memory Set of 1-indexed heading lines. State is keyed by line number, so
  // a doc edit that shifts headings drops stale entries (syncFolds reconciles).
  const collapsedHeadings = new Set(); // 1-indexed heading lines currently folded
  let foldLayer = null; // .editor-folds overlay (sibling of the textarea)
  const wrapEl = textarea.parentElement;

  function ensureFoldLayer() {
    if (foldLayer || !wrapEl) return;
    foldLayer = document.createElement('div');
    foldLayer.className = 'editor-folds';
    foldLayer.setAttribute('aria-hidden', 'true');
    // Click on a fold marker unfolds that section. The layer itself is
    // pointer-events:none; markers re-enable pointer events.
    foldLayer.addEventListener('click', (e) => {
      const marker = e.target.closest('.fold-marker');
      if (!marker) return;
      const line = parseInt(marker.dataset.headingLine, 10);
      if (Number.isFinite(line)) { collapsedHeadings.delete(line); syncFolds(); }
    });
    wrapEl.appendChild(foldLayer);
  }

  // Mark each heading's gutter row with a fold caret and dim folded body rows.
  function syncFoldCarets(headings, hidden) {
    if (!gutter) return;
    const rows = gutter.children;
    const headingSet = new Set(headings.map((h) => h.line));
    for (let i = 0; i < rows.length; i++) {
      const lineNo = i + 1;
      const row = rows[i];
      const isHeading = headingSet.has(lineNo);
      const isHidden = hidden.has(lineNo);
      row.classList.toggle('folded-line', isHidden);
      if (isHeading) {
        row.classList.add('has-fold');
        // Inject/refresh the caret. Reuse the existing one to avoid resetting
        // the row's layout on every sync.
        let caret = row.querySelector('.fold-caret');
        if (!caret) {
          caret = document.createElement('span');
          // The gutter is aria-hidden, so role/aria-label here were inert —
          // keep it honest: decorative glyph with a tooltip. Keyboard folding
          // lives in the command palette ("Toggle current fold").
          caret.className = 'fold-caret';
          caret.title = 'Toggle fold';
          row.insertBefore(caret, row.firstChild);
        }
        caret.textContent = collapsedHeadings.has(lineNo) ? '▾' : '▸';
        caret.dataset.headingLine = String(lineNo);
      } else if (row.classList.contains('has-fold')) {
        // Was a heading, no longer is (doc changed) — clean up.
        row.classList.remove('has-fold');
        const caret = row.querySelector('.fold-caret');
        if (caret) caret.remove();
      }
    }
  }

  // Reposition fold markers over the masked line ranges. Uses the mirror's
  // per-line offsetTop/offsetHeight (which already reflect wrapping) so the
  // markers sit exactly over the hidden text.
  function renderFoldMarkers(ranges, hidden) {
    if (!foldLayer) return;
    // Build a fast lookup: line number → mirror child index.
    const mirrorKids = mirror?.children || [];
    const foldedRanges = ranges.filter((r) => collapsedHeadings.has(r.headingLine));
    // Clear and rebuild. Cheap (few folds at once).
    foldLayer.innerHTML = '';
    if (foldedRanges.length === 0) return;
    const cs = getComputedStyle(textarea);
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const width = parseFloat(cs.width) || textarea.clientWidth || 0;
    for (const r of foldedRanges) {
      const bodyStart = r.headingLine; // mirror index = headingLine - 1
      const bodyEnd = r.endLine;       // mirror index = endLine - 1
      const startKid = mirrorKids[bodyStart - 1];
      const endKid = mirrorKids[bodyEnd - 1];
      if (!startKid) continue;
      const top = (startKid.offsetTop || 0) + padTop - textarea.scrollTop;
      const bottomKid = endKid || startKid;
      const bottom = (bottomKid.offsetTop || 0) + (bottomKid.offsetHeight || 0) + padTop - textarea.scrollTop;
      const height = Math.max(20, bottom - top);
      const count = foldedLineCount(textarea.value, r.headingLine);
      const marker = document.createElement('div');
      marker.className = 'fold-marker';
      marker.dataset.headingLine = String(r.headingLine);
      marker.style.top = `${top}px`;
      marker.style.left = `${padLeft}px`;
      marker.style.width = `${Math.max(40, width - padLeft * 2)}px`;
      marker.style.height = `${height}px`;
      marker.innerHTML = `<span class="fold-chip">⌄ ${count} line${count === 1 ? '' : 's'} folded</span>`;
      foldLayer.appendChild(marker);
    }
  }

  // Reconcile fold state with the current source: drop stale entries, refresh
  // carets + markers. Called on input, scroll, resize, and after explicit
  // toggles. Never mutates textarea.value.
  function syncFolds() {
    if (!wrapEl) return;
    const text = textarea.value;
    const headings = extractHeadings(text);
    const ranges = sectionRanges(text);
    const validHeadingLines = new Set(headings.map((h) => h.line));
    // Drop collapsed entries whose line is no longer a heading.
    for (const ln of [...collapsedHeadings]) {
      if (!validHeadingLines.has(ln)) collapsedHeadings.delete(ln);
    }
    const hidden = foldedLineSet(text, collapsedHeadings);
    syncFoldCarets(headings, hidden);
    renderFoldMarkers(ranges, hidden);
  }

  function toggleFoldAt(headingLine) {
    if (!Number.isFinite(headingLine)) return;
    if (collapsedHeadings.has(headingLine)) collapsedHeadings.delete(headingLine);
    else collapsedHeadings.add(headingLine);
    syncFolds();
  }

  // Fold/unfold the heading that owns the current caret line. Used by a palette
  // command / shortcut. No-op when the caret isn't on a heading line.
  function toggleFoldAtCaret() {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const lineNo = before.split('\n').length;
    const headings = extractHeadings(textarea.value);
    if (!headings.some((h) => h.line === lineNo)) return false;
    toggleFoldAt(lineNo);
    return true;
  }

  function unfoldAll() {
    if (collapsedHeadings.size === 0) return;
    collapsedHeadings.clear();
    syncFolds();
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
    syncFolds();
  });
  on('keydown', textarea, onKeyDown);
  // Re-center on caret moves that don't fire input (arrow keys, clicks).
  on('keyup', textarea, centerActiveLine);
  on('click', textarea, centerActiveLine);
  on('scroll', textarea, onScroll);
  // Gutter click: a click on a fold caret toggles that section. Other gutter
  // clicks fall through (no default gutter-click behavior today).
  if (gutter) {
    on('click', gutter, (e) => {
      const caret = e.target.closest('.fold-caret');
      if (!caret) return;
      const line = parseInt(caret.dataset.headingLine, 10);
      if (Number.isFinite(line)) {
        e.preventDefault();
        toggleFoldAt(line);
      }
    });
  }
  // Re-sync gutter when font metrics or the textarea size changes.
  let gutterResizeObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    gutterResizeObserver = new ResizeObserver(() => {
      syncGutter();
      cachedLineHeight = 0; // force re-measure in case font-size changed
      updateActiveLineMarker();
      syncFolds();
    });
    gutterResizeObserver.observe(textarea);
  }

  ensureFoldLayer();
  refresh();
  syncGutter();
  updateActiveLineMarker();
  syncFolds();

  return {
    // Set the textarea's value. Only writes when the value actually differs —
    // re-entry into renderActive (e.g. markDirty emitting 'change' on the
    // first keystroke) would otherwise clobber the textarea mid-composition
    // and swallow the user's first character.
    setValue(text) {
      if (textarea.value !== text) textarea.value = text;
      refresh();
      syncGutter();
      syncFolds();
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
      setValueUndoable(before + text + after);
      const caret = s + text.length;
      textarea.setSelectionRange(caret, caret);
      textarea.focus();
      schedule();
      syncGutter();
    },
    // Read the current selection offsets. Used by the snippet picker
    // (insertSnippetIntoEditor in main.js) and the status bar's selection
    // word-count. Returns { start, end }.
    getSelection() {
      return { start: textarea.selectionStart, end: textarea.selectionEnd };
    },
    // Replace [start, end) with `text`, place the caret at the end of the
    // inserted text, and refresh preview + gutter. Used by the snippet picker.
    replaceRange(start, end, text) {
      const before = textarea.value.slice(0, start);
      const after = textarea.value.slice(end);
      setValueUndoable(before + text + after);
      const caret = start + text.length;
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
    // v0.55.0: region folding — toggle the section that owns the caret line,
    // unfold everything, or force a re-render of the fold overlay. Folding is
    // purely visual; textarea.value is never mutated.
    toggleFoldAtCaret,
    unfoldAll,
    syncFolds,
    format(type) {
      const s = textarea.selectionStart;
      const en = textarea.selectionEnd;
      switch (type) {
        case 'bold': return applyResult(wrapSelection(textarea.value, s, en, '**'));
        case 'italic': return applyResult(wrapSelection(textarea.value, s, en, '*'));
        case 'strike': return applyResult(wrapSelection(textarea.value, s, en, '~~'));
        case 'highlight': return applyResult(wrapSelection(textarea.value, s, en, '=='));
        case 'code': return applyResult(wrapSelection(textarea.value, s, en, '`'));
        case 'link': {
          const sel = textarea.value.slice(s, en);
          const url = sel.startsWith('http') ? sel : 'https://';
          const text = sel || 'link text';
          return applyResult({ text: textarea.value.slice(0, s) + `[${text}](${url})` + textarea.value.slice(en), start: s + text.length + 3, end: s + text.length + 3 + url.length });
        }
        case 'h1': return applyResult(toggleLinePrefix(textarea.value, s, en, '# '));
        case 'h2': return applyResult(toggleLinePrefix(textarea.value, s, en, '## '));
        case 'h3': return applyResult(toggleLinePrefix(textarea.value, s, en, '### '));
        case 'ul': return applyResult(toggleLinePrefix(textarea.value, s, en, '- '));
        case 'ol': return applyResult(toggleLinePrefix(textarea.value, s, en, '1. '));
        case 'task': return applyResult(toggleLinePrefix(textarea.value, s, en, '- [ ] '));
        case 'quote': return applyResult(toggleLinePrefix(textarea.value, s, en, '> '));
        case 'fence': {
          const insert = '\n```\n\n```\n';
          return applyResult({ text: textarea.value.slice(0, s) + insert + textarea.value.slice(en), start: s + 5, end: s + 5 });
        }
        case 'table': {
          // 3x3 skeleton (matches the snippet). Caret lands on the first
          // header cell so the user can rename it immediately.
          const insert = '\n| Column A | Column B | Column C |\n| --- | --- | --- |\n| cell | cell | cell |\n| cell | cell | cell |\n\n';
          return applyResult({ text: textarea.value.slice(0, s) + insert + textarea.value.slice(en), start: s + 4, end: s + 12 });
        }
        case 'hr': {
          const insert = '\n---\n\n';
          return applyResult({ text: textarea.value.slice(0, s) + insert + textarea.value.slice(en), start: s + insert.length, end: s + insert.length });
        }
        case 'image': {
          // Placeholder; caret selects the alt text so the user can type it.
          const insert = `![](https://)`;
          return applyResult({ text: textarea.value.slice(0, s) + insert + textarea.value.slice(en), start: s + 2, end: s + 2 });
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
