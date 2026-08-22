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

// ----- formatting toolbar polish (presentation only) -----
// The .fmt-tools toolbar markup lives in index.html and its click delegation in
// main.js — this module only layers on visual/affordance upgrades:
//   1. Divider spans between logical button groups.
//   2. Tooltip shortcut hints for buttons whose keybind had none.
//   3. Active-state sync (.is-active + aria-pressed) so toggleable formats
//      show whether the caret/selection is currently formatted that way.
//   4. A brief accent flash on the button that triggered an apply (click OR
//      its keyboard equivalent).
// All rules are injected once, reference global theme tokens, and respect
// prefers-reduced-motion. No click handlers are added here.
const FMT_GROUPS = [
  ['h1', 'h2', 'h3'],
  ['bold', 'italic', 'strike', 'highlight', 'code', 'link'],
  ['ul', 'ol', 'task', 'quote'],
  ['fence', 'table', 'hr', 'image'],
];
// Only formats that actually have a keybind but lacked the hint in their title.
const FMT_SHORTCUTS = { link: 'Ctrl+K', quote: 'Ctrl+Shift+.' };
// Wrap markers per toggleable inline format (mirrors wrapSelection usage).
const FMT_WRAP = { bold: '**', strike: '~~', highlight: '==', code: '`' };
// Line prefixes per toggleable block format (mirrors toggleLinePrefix usage).
const FMT_PREFIX = { h1: '# ', h2: '## ', h3: '### ', ul: '- ', ol: '1. ', task: '- [ ] ', quote: '> ' };

let _toolbarCssInjected = false;
const _chromeApplied = new WeakSet(); // toolbars already given dividers/titles
const _flashing = new WeakSet();      // buttons mid-flash (don't restart)

function ensureToolbarChrome(toolbar) {
  if (!toolbar || _chromeApplied.has(toolbar)) return;
  _chromeApplied.add(toolbar);

  if (!_toolbarCssInjected && typeof document !== 'undefined' && document.head) {
    _toolbarCssInjected = true;
    const style = document.createElement('style');
    style.textContent = [
      '.fmt-divider{width:1px;height:16px;margin:0 var(--sp-1,4px);background:var(--border-subtle);flex:0 0 auto;}',
      '.fmt-btn.is-active{background:var(--accent-soft);color:var(--accent);border-color:var(--accent-soft);}',
      '.fmt-btn.is-active:hover{border-color:var(--accent);}',
      // Drag-over affordance: copy cursor while text/files hover the textarea.
      '.editor.is-drop-target{cursor:copy;}',
      '@media (prefers-reduced-motion: no-preference){',
      '  @keyframes mdpeek-fmt-flash{from{background:var(--accent-soft);color:var(--accent);border-color:var(--accent);}}',
      '  .fmt-btn.is-flash{animation:mdpeek-fmt-flash var(--dur-3,240ms) ease-out;}',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // Dividers before the first button of every group after the first.
  for (let g = 1; g < FMT_GROUPS.length; g++) {
    const first = toolbar.querySelector(`.fmt-btn[data-fmt="${FMT_GROUPS[g][0]}"]`);
    if (!first || first.previousElementSibling?.classList.contains('fmt-divider')) continue;
    const divider = document.createElement('span');
    divider.className = 'fmt-divider';
    divider.setAttribute('aria-hidden', 'true'); // purely visual grouping
    first.before(divider);
  }

  // Append shortcut hints to titles (keeps the existing "(Ctrl+B)" pattern).
  for (const [fmt, shortcut] of Object.entries(FMT_SHORTCUTS)) {
    const btn = toolbar.querySelector(`.fmt-btn[data-fmt="${fmt}"]`);
    if (!btn || btn.title.includes(shortcut)) continue;
    btn.title = `${btn.title} (${shortcut})`;
  }
}

// True when [s,e) sits exactly between a pair of marker `m` (the same test
// wrapSelection uses to decide a toggle-off).
function wrapMarkerAround(text, s, e, m) {
  return s >= m.length && text.slice(s - m.length, s) === m && text.slice(e, e + m.length) === m;
}

// True when every line touched by [s,e) starts with `prefix` — the exact
// condition toggleLinePrefix uses to decide a toggle-off, so the indicator
// always tells the truth about what clicking the button will do.
function linePrefixOnEveryTouchedLine(text, s, e, prefix) {
  const from = Math.min(s, e);
  const lineStart = from > 0 ? text.lastIndexOf('\n', from - 1) + 1 : 0;
  const block = text.slice(lineStart, Math.max(s, e));
  if (!block) return false;
  return block.split('\n').every((l) => l.startsWith(prefix));
}

function syncToolbarState(toolbar, textarea) {
  if (!toolbar) return;
  const text = textarea.value;
  const s = textarea.selectionStart;
  const e = textarea.selectionEnd;
  const active = {};
  for (const [fmt, m] of Object.entries(FMT_WRAP)) active[fmt] = wrapMarkerAround(text, s, e, m);
  // Italic: single asterisks that are NOT part of a '**' pair on either side.
  active.italic = s >= 1 && text[s - 1] === '*' && text.slice(s - 2, s) !== '**'
    && text[e] === '*' && text.slice(e, e + 2) !== '**';
  for (const [fmt, prefix] of Object.entries(FMT_PREFIX)) {
    active[fmt] = linePrefixOnEveryTouchedLine(text, s, e, prefix);
  }
  for (const btn of toolbar.querySelectorAll('.fmt-btn[data-fmt]')) {
    const on = !!active[btn.dataset.fmt];
    btn.classList.toggle('is-active', on);
    // Cheap aria-pressed sync — only writes when it actually changed.
    if (btn.getAttribute('aria-pressed') !== String(on)) btn.setAttribute('aria-pressed', String(on));
  }
}

function flashToolbarButton(toolbar, fmt) {
  if (!toolbar || !fmt) return;
  const btn = toolbar.querySelector(`.fmt-btn[data-fmt="${fmt}"]`);
  if (!btn || _flashing.has(btn)) return;
  _flashing.add(btn);
  btn.classList.remove('is-flash');
  void btn.offsetWidth; // force reflow so rapid repeats restart the animation
  btn.classList.add('is-flash');
  const clear = () => { btn.classList.remove('is-flash'); _flashing.delete(btn); };
  btn.addEventListener('animationend', clear, { once: true });
  setTimeout(clear, 400); // reduced-motion fallback (no animationend will fire)
}

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
  // Toolbar chrome: the shared .fmt-tools toolbar (dividers, shortcut hints,
  // aria-pressed sync, apply-flash). May be null (tests / plain docs).
  const toolbar = textarea.closest('.editor-pane')?.querySelector('.fmt-tools') || null;
  ensureToolbarChrome(toolbar);
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
  // v0.69.0: the wrap attribute alone is not enough — the .editor CSS pins
  // white-space: pre-wrap, which overrides the attribute and made wrap="off"
  // a silent no-op (long lines kept wrapping). Force the inline value so off
  // really scrolls horizontally; '' restores the CSS default for soft wrap.
  textarea.style.whiteSpace = wrapPref === '0' ? 'pre' : '';

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
    // v0.69.0: copy the wrapping regime too. The mirror used to be pinned to
    // pre-wrap by CSS, so with word wrap off it kept wrapping long lines while
    // the textarea scrolled horizontally — every long line desynced the gutter
    // rows below it. Copying the computed values keeps the two in lockstep in
    // both modes (and picks up any letter-spacing that would shift wrap points).
    mirror.style.whiteSpace = cs.whiteSpace;
    mirror.style.overflowWrap = cs.overflowWrap;
    mirror.style.wordBreak = cs.wordBreak;
    mirror.style.letterSpacing = cs.letterSpacing;
  }
  // Rebuild the mirror's per-line children from the textarea's current text.
  function updateMirror() {
    if (!mirror) return;
    syncMirrorBox();
    const lines = textarea.value.split('\n');
    // Build one <div> per source line. Lines are HTML-escaped — they must be
    // measured as literal text, never parsed as markup. Empty lines get a
    // <br> so they occupy one line-height (a bare <div></div> collapses).
    let html = '';
    for (const line of lines) {
      html += '<div>';
      html += line.length ? line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '<br>';
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
  // preview + gutter. `fmtType` (optional) names the toolbar format that
  // triggered the apply so the matching button can flash. Returns false when
  // nothing changed.
  function applyResult(result, fmtType) {
    if (!result) return false;
    if (result.text !== textarea.value) setValueUndoable(result.text);
    textarea.setSelectionRange(result.start, result.end);
    syncEmptyHook();
    if (fmtType) flashToolbarButton(toolbar, fmtType);
    syncToolbarState(toolbar, textarea);
    schedule();
    syncGutter();
    centerActiveLine();
    return true;
  }

  // Placeholder styling hook: `.editor.is-empty` flips on when the doc has no
  // content so CSS can restyle ::placeholder without JS knowing about styles.
  function syncEmptyHook() {
    textarea.classList.toggle('is-empty', textarea.value.length === 0);
  }

  // ----- gutter (line numbers synced to textarea scroll) -----
  // Wrap-aware: each gutter row's height = the corresponding mirror line's
  // offsetHeight, which reflects how many visual rows that source line
  // wrapped to. A line that wraps to 3 visual rows gets a 3×lineHeight gutter
  // row; the number renders on the first visual row (top of the row).
  function syncGutter() {
    if (!gutter) return;
    // v0.69.0: derive line-height from the live CSS ratio instead of trusting
    // the textarea's own inline px. The inline value is a pin (integer px so
    // gutter rows and text rows advance by the same whole pixels) — but it
    // used to be re-read as-is after a zoom, so line-height stayed at the
    // pre-zoom value forever: zoomed text grew taller than its line boxes and
    // visibly slid off the numbers. Clear the pin, read the ratio-driven
    // computed value, then re-pin the rounded result.
    textarea.style.lineHeight = '';
    const cs = getComputedStyle(textarea);
    const fs = parseFloat(cs.fontSize) || 13.5;
    const rawLh = parseFloat(cs.lineHeight);
    const ratio = rawLh > 0 && fs > 0 ? rawLh / fs : 1.6;
    const linePx = Math.max(1, Math.round(fs * ratio));
    const linePxStr = linePx + 'px';
    // Pin the textarea BEFORE building the mirror so the mirror lays out with
    // the exact line-height the text will use (it copies the inline value).
    textarea.style.lineHeight = linePxStr;
    gutter.style.fontFamily = cs.fontFamily;
    gutter.style.fontSize = cs.fontSize;
    gutter.style.lineHeight = linePxStr;
    gutter.style.paddingTop = cs.paddingTop;
    gutter.style.paddingBottom = cs.paddingBottom;

    cachedLineHeight = linePx;
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
      applyResult(wrapSelection(textarea.value, s, en, '**'), 'bold');
      return;
    }
    if (ctrl && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      e.stopPropagation();
      applyResult(wrapSelection(textarea.value, s, en, '*'), 'italic');
      return;
    }
    if (ctrl && e.key === '`') {
      e.preventDefault();
      e.stopPropagation();
      applyResult(wrapSelection(textarea.value, s, en, '`'), 'code');
      return;
    }
    // Ctrl/Cmd+K → insert `[selection](url)` link. Try to read a URL from the
    // clipboard first (best-effort; may be blocked). If the clipboard has a
    // URL, pre-fill it; otherwise leave the URL slot empty. Mirrors VS Code.
    if (ctrl && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      e.stopPropagation();
      const insert = (url) => {
        // Read state fresh: the clipboard read/fallback can resolve long after
        // this keydown, and a captured text/selection snapshot would clobber
        // anything the user typed in between.
        const t = textarea.value;
        const cs = textarea.selectionStart;
        const ce = textarea.selectionEnd;
        applyResult(insertLink(t, cs, ce, url), 'link');
      };
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
      applyResult(wrapSelection(textarea.value, s, en, '~~'), 'strike');
      return;
    }
    // Ctrl+Shift+H → highlight (wrap in ==). Renders as <mark>.
    if (ctrl && e.shiftKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      e.stopPropagation();
      applyResult(wrapSelection(textarea.value, s, en, '=='), 'highlight');
      return;
    }
    // Ctrl+Shift+. → toggle blockquote prefix (> ). Mirrors the toolbar button;
    // gives quote a keybind to match bold/italic/code.
    if (ctrl && e.shiftKey && e.key === '.') {
      e.preventDefault();
      e.stopPropagation();
      applyResult(toggleLinePrefix(textarea.value, s, en, '> '), 'quote');
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
    // pointer-events:none; markers re-enable pointer events. Registered via
    // on() so destroy() removes it (a direct listener would leak the closure).
    on('click', foldLayer, (e) => {
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
    syncEmptyHook();
    syncToolbarState(toolbar, textarea);
    syncGutter();
    centerActiveLine();
    syncFolds();
  });
  on('keydown', textarea, onKeyDown);
  // Re-center on caret moves that don't fire input (arrow keys, clicks), and
  // keep the toolbar's active-format state in step with the new selection.
  const onCaretMoved = () => { centerActiveLine(); syncToolbarState(toolbar, textarea); };
  on('keyup', textarea, onCaretMoved);
  on('click', textarea, onCaretMoved);
  // Drag-drop affordance: show a copy cursor while a drag hovers the text.
  // Class-only — drop handling itself stays owned by main.js.
  const dropOn = () => textarea.classList.add('is-drop-target');
  const dropOff = () => textarea.classList.remove('is-drop-target');
  on('dragenter', textarea, dropOn);
  on('dragover', textarea, dropOn);
  on('dragleave', textarea, dropOff);
  on('drop', textarea, dropOff);
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
  syncEmptyHook();
  syncToolbarState(toolbar, textarea);
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
      syncEmptyHook();
      syncToolbarState(toolbar, textarea);
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
        case 'bold': return applyResult(wrapSelection(textarea.value, s, en, '**'), type);
        case 'italic': return applyResult(wrapSelection(textarea.value, s, en, '*'), type);
        case 'strike': return applyResult(wrapSelection(textarea.value, s, en, '~~'), type);
        case 'highlight': return applyResult(wrapSelection(textarea.value, s, en, '=='), type);
        case 'code': return applyResult(wrapSelection(textarea.value, s, en, '`'), type);
        case 'link': {
          const sel = textarea.value.slice(s, en);
          const url = sel.startsWith('http') ? sel : 'https://';
          const text = sel || 'link text';
          return applyResult({ text: textarea.value.slice(0, s) + `[${text}](${url})` + textarea.value.slice(en), start: s + text.length + 3, end: s + text.length + 3 + url.length }, type);
        }
        case 'h1': return applyResult(toggleLinePrefix(textarea.value, s, en, '# '), type);
        case 'h2': return applyResult(toggleLinePrefix(textarea.value, s, en, '## '), type);
        case 'h3': return applyResult(toggleLinePrefix(textarea.value, s, en, '### '), type);
        case 'ul': return applyResult(toggleLinePrefix(textarea.value, s, en, '- '), type);
        case 'ol': return applyResult(toggleLinePrefix(textarea.value, s, en, '1. '), type);
        case 'task': return applyResult(toggleLinePrefix(textarea.value, s, en, '- [ ] '), type);
        case 'quote': return applyResult(toggleLinePrefix(textarea.value, s, en, '> '), type);
        case 'fence': {
          const insert = '\n```\n\n```\n';
          return applyResult({ text: textarea.value.slice(0, s) + insert + textarea.value.slice(en), start: s + 5, end: s + 5 }, type);
        }
        case 'table': {
          // 3x3 skeleton (matches the snippet). Caret lands on the first
          // header cell so the user can rename it immediately.
          const insert = '\n| Column A | Column B | Column C |\n| --- | --- | --- |\n| cell | cell | cell |\n| cell | cell | cell |\n\n';
          return applyResult({ text: textarea.value.slice(0, s) + insert + textarea.value.slice(en), start: s + 3, end: s + 11 }, type);
        }
        case 'hr': {
          const insert = '\n---\n\n';
          return applyResult({ text: textarea.value.slice(0, s) + insert + textarea.value.slice(en), start: s + insert.length, end: s + insert.length }, type);
        }
        case 'image': {
          // Placeholder; caret selects the alt text so the user can type it.
          const insert = `![](https://)`;
          return applyResult({ text: textarea.value.slice(0, s) + insert + textarea.value.slice(en), start: s + 2, end: s + 2 }, type);
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
