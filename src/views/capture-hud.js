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
let onCaptureCb = null;
let prevFocus = null;
let saving = false;

function build() {
  overlay = document.createElement('div');
  overlay.id = 'capture-hud';
  overlay.className = 'capture-hud hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'false');
  overlay.setAttribute('aria-label', 'Capture a thought');
  overlay.innerHTML = ''
    + '<div class="capture-hud-card">'
    +   '<textarea class="capture-input" rows="1" placeholder="Capture a thought…" aria-label="Capture text" autocomplete="off" spellcheck="true"></textarea>'
    +   '<div class="capture-meta">'
    +     '<span class="capture-dest" title=""></span>'
    +     '<span class="capture-hint">Enter to capture · Shift+Enter for newline · Esc to close</span>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(overlay);
  input = overlay.querySelector('.capture-input');
  destEl = overlay.querySelector('.capture-dest');

  // Enter = submit (Shift+Enter = newline). Empty input = silent no-op close.
  // While saving (awaiting onCapture), input is disabled so rapid Enter can't
  // double-submit.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!saving) submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  // Stop the global keymap from intercepting keys while typing in the HUD
  // (e.g. Ctrl+Shift+I would otherwise re-toggle). Let normal typing through.
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return; // handled above
    e.stopPropagation();
  });
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
  try {
    if (onCaptureCb) await onCaptureCb(text);
    close();
  } catch (err) {
    // Keep the HUD open with the user's text intact. Surface the failure in
    // the destination line (mirrors how the spec wants errors visible).
    saving = false;
    input.disabled = false;
    input.removeAttribute('aria-busy');
    const msg = err && err.message ? err.message : String(err);
    if (destEl) destEl.textContent = '⚠ Could not capture: ' + msg;
    // Refocus so the user can tweak + retry, or hit Esc to give up.
    if (input) input.focus();
  }
}

export function initCaptureHud() {
  if (created) return { open, close, isOpen };
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
  input.value = '';
  input.disabled = false;
  input.removeAttribute('aria-busy');
  saving = false;
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
  if (input) {
    input.disabled = false;
    input.removeAttribute('aria-busy');
  }
  if (prevFocus && typeof prevFocus.focus === 'function') {
    try { prevFocus.focus(); } catch (_) { /* element may be gone */ }
    prevFocus = null;
  }
}
