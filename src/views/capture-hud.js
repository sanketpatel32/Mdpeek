// v0.55.0: Quick-capture HUD — a tiny transient overlay anchored top-center.
// One input, a hint line, the destination shown faintly. Type a thought,
// press Enter → onCapture(text) → the HUD closes. Esc closes without writing.
// Mirrors the singleton modal pattern of table-editor.js: one overlay appended
// to <body>, shown/hidden via .hidden, focus saved + restored on close.
//
// The HUD owns no persistence of its own — the caller's onCapture orchestrator
// (main.js) resolves the notes dir, builds the entry via capture.js, and writes
// the daily note. The HUD stays disabled during the async save so a rapid
// second Enter can't double-submit; on failure the text is kept so the user
// doesn't lose what they typed.

let created = false;
let overlay;        // #capture-hud
let input;          // textarea
let destEl;         // .capture-dest
let cardEl;         // .capture-hud-card (gets .capture-error on failure)
let onCaptureCb = null;
let prevFocus = null;
let saving = false;
let drag = null;    // {dx,dy} while dragging via .capture-grip

// UI-polish styles owned by this view. Injected once as an id-guarded <style>;
// every value references global tokens so all themes pick these up.
function injectPolishStyles() {
  if (document.getElementById('capture-hud-polish-style')) return;
  const style = document.createElement('style');
  style.id = 'capture-hud-polish-style';
  style.textContent = `
    /* Entrance: a longer spring than base.css's default settle so the HUD
       lands with a little overshoot — quick-capture should feel snappy but
       alive, not abrupt. */
    .capture-hud-card {
      animation-duration: var(--dur-4, 360ms);
      animation-timing-function: var(--ease-spring);
    }
    /* Focus ring polish: accent caret + accent-tinted selection tie typing to
       the focused state that base.css already draws around the card. */
    .capture-input { caret-color: var(--accent); }
    .capture-input::selection {
      background: var(--accent-soft);
      color: var(--fg);
    }
    /* Save feedback flash: while the write is in flight the card pulses a
       soft accent ring (reduced-motion users get the static accent border
       only). Success closes immediately; failure keeps .capture-error. */
    .capture-hud-card.is-saving { border-color: var(--accent); }
    @media (prefers-reduced-motion: no-preference) {
      .capture-hud-card.is-saving {
        animation: capture-pulse calc(var(--dur-3, 240ms) * 2) var(--ease-out) infinite alternate;
      }
      @keyframes capture-pulse {
        from { box-shadow: var(--shadow-lg); }
        to { box-shadow: var(--shadow-lg), 0 0 0 4px var(--accent-soft); }
      }
    }
    /* Esc-hint footer: keys read as keycaps so "how do I leave?" is scannable;
       the Esc keycap gets the accent tint since it's the exit everyone looks
       for first. */
    .capture-hint kbd {
      display: inline-block;
      padding: 1px 5px;
      margin: 0 1px;
      border: 1px solid var(--border);
      border-bottom-width: 2px;
      border-radius: var(--radius-sm, 4px);
      background: var(--surface, transparent);
      font-family: inherit;
      font-size: 10px;
      font-weight: 600;
      line-height: 1.4;
      color: var(--fg-secondary);
    }
    .capture-hint kbd.kbd-esc {
      color: var(--accent);
      border-color: color-mix(in srgb, var(--accent) 40%, transparent);
      background: var(--accent-soft);
    }
    /* Drag handle affordance: quiet dot-matrix strip; grabs attention only on
       hover, and switches to a grabbing cursor mid-drag. */
    .capture-grip {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 3px;
      padding: 6px 0 0;
      cursor: grab;
      user-select: none;
      touch-action: none;
      transition: color var(--dur-1) var(--ease-out);
    }
    .capture-grip span {
      width: 18px;
      height: 3px;
      border-radius: 999px;
      background: currentColor;
      color: var(--fg-muted);
      opacity: 0.55;
    }
    .capture-grip:hover span { opacity: 1; }
    .capture-grip:active { cursor: grabbing; }
  `;
  document.head.appendChild(style);
}

function build() {
  overlay = document.createElement('div');
  overlay.id = 'capture-hud';
  overlay.className = 'capture-hud hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'false');
  overlay.setAttribute('aria-label', 'Capture a thought');
  overlay.innerHTML = ''
    + '<div class="capture-hud-card">'
    +   '<div class="capture-grip" title="Drag to move · double-click to reset" aria-hidden="true"><span></span><span></span></div>'
    +   '<textarea class="capture-input" rows="1" placeholder="Capture a thought…" aria-label="Capture text" autocomplete="off" spellcheck="true"></textarea>'
    +   '<div class="capture-meta">'
    +     '<span class="capture-dest" title=""></span>'
    +     '<span class="capture-hint"><kbd>Enter</kbd> capture · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline · <kbd class="kbd-esc">Esc</kbd> close</span>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(overlay);
  input = overlay.querySelector('.capture-input');
  destEl = overlay.querySelector('.capture-dest');
  cardEl = overlay.querySelector('.capture-hud-card');

  // Enter = submit (Shift+Enter = newline). Empty input = silent no-op close.
  // While saving (awaiting onCapture), input is disabled so rapid Enter can't
  // double-submit.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!saving) submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  // Auto-grow the textarea up to ~6 lines instead of scrolling inside it.
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  });
  // Stop the global keymap from intercepting keys while typing in the HUD
  // (e.g. Ctrl+Shift+I would otherwise re-toggle). Let normal typing through.
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return; // handled above
    e.stopPropagation();
  });

  // Drag handle: pointer-drag the grip to reposition; double-click snaps back
  // to the default top-center spot. Presentation-grade — position is not
  // persisted across opens (open() resets it).
  const grip = overlay.querySelector('.capture-grip');
  grip.addEventListener('pointerdown', (e) => {
    if (!isOpen()) return;
    const rect = overlay.getBoundingClientRect();
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.transform = 'none';
    drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    try { grip.setPointerCapture(e.pointerId); } catch (_) { /* jsdom */ }
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag || !isOpen()) return;
    const w = overlay.offsetWidth || 0;
    const h = overlay.offsetHeight || 0;
    // Keep at least a 4px sliver inside the viewport.
    const x = Math.min(Math.max(e.clientX - drag.dx, 4), Math.max(4, window.innerWidth - w - 4));
    const y = Math.min(Math.max(e.clientY - drag.dy, 4), Math.max(4, window.innerHeight - h - 4));
    overlay.style.left = x + 'px';
    overlay.style.top = y + 'px';
  });
  const endDrag = () => { drag = null; };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);
  grip.addEventListener('dblclick', resetPosition);
}

// Back to the default top-center anchor (clears any drag overrides).
function resetPosition() {
  if (!overlay) return;
  overlay.style.left = '';
  overlay.style.top = '';
  overlay.style.transform = '';
}

function isOpen() {
  return created && overlay && !overlay.classList.contains('hidden');
}

// Submit the current text. Empty → no-op close. Otherwise: disable the input,
// await onCapture; on success close; on failure re-enable and surface the error
// text in the destination slot so the user can retry without losing input.
async function submit() {
  const text = input.value;
  if (!text.trim()) { close(); return; }
  saving = true;
  input.disabled = true;
  input.setAttribute('aria-busy', 'true');
  if (cardEl) cardEl.classList.add('is-saving');
  try {
    if (onCaptureCb) await onCaptureCb(text);
    close();
  } catch (err) {
    // Keep the HUD open with the user's text intact. Surface the failure in
    // the destination line (mirrors how the spec wants errors visible).
    saving = false;
    input.disabled = false;
    input.removeAttribute('aria-busy');
    if (cardEl) cardEl.classList.remove('is-saving');
    if (cardEl) cardEl.classList.add('capture-error');
    const msg = err && err.message ? err.message : String(err);
    if (destEl) destEl.textContent = '⚠ Could not capture: ' + msg;
    // Refocus so the user can tweak + retry, or hit Esc to give up.
    if (input) input.focus();
  }
}

export function initCaptureHud() {
  if (created) return { open, close, isOpen };
  injectPolishStyles();
  build();
  created = true;
  return { open, close, isOpen };
}

// opts: { destination: string, onCapture: async (text) => void }
// destination is shown faintly (e.g. "→ 2026-08-01.md  (today's note)").
function open(opts = {}) {
  if (!created) return;
  onCaptureCb = typeof opts.onCapture === 'function' ? opts.onCapture : null;
  if (destEl) destEl.textContent = opts.destination || '';
  if (cardEl) cardEl.classList.remove('capture-error');
  input.value = '';
  input.style.height = 'auto';
  input.disabled = false;
  input.removeAttribute('aria-busy');
  if (cardEl) cardEl.classList.remove('is-saving');
  saving = false;
  resetPosition();
  prevFocus = document.activeElement;
  overlay.classList.remove('hidden');
  // Autofocus on open. requestAnimationFrame avoids a race where the textarea
  // isn't yet focusable in the just-unhidden overlay.
  requestAnimationFrame(() => { if (input) input.focus(); });
}

function close() {
  if (!created || !overlay) return;
  overlay.classList.add('hidden');
  onCaptureCb = null;
  saving = false;
  drag = null;
  if (cardEl) cardEl.classList.remove('is-saving');
  if (input) {
    input.disabled = false;
    input.removeAttribute('aria-busy');
  }
  if (prevFocus && typeof prevFocus.focus === 'function') {
    try { prevFocus.focus(); } catch (_) { /* element may be gone */ }
    prevFocus = null;
  }
}
