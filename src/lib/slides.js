// Slideshow speaker-notes parser (v0.40.0) + presentation-mode polish layer.
//
// Part 1 — parser (pure function — no DOM):
// Strips speaker notes out of a slide's markdown source so they don't render
// on the visible slide, and returns them separately for the speaker-notes
// panel. Two syntaxes are supported (both case-insensitive):
//
//   note: remember to mention the deadline      ← bare line, anywhere
//   <!-- note: this stays hidden on the slide --> ← HTML comment form
//
// The `note:` line form anchors at the start of a line (after optional
// leading spaces/tabs), so a `note:` mid-paragraph or inside a code block
// (which is indented 4+ spaces or fenced) is NOT treated as a speaker note
// unless it happens to sit at column 0 of its own line — the same convention
// other note-aware tools (Marp, reveal.js) use.
//
// Part 2 — presentation-mode UI polish (interaction only; slide parsing and
// main.js's slideshow state machine are untouched). This module is imported
// by main.js at startup, so it self-wires to the static #slideshow markup in
// index.html. Everything here:
//   • rides the global motion tokens (--dur-1..4, --ease-out) with literal
//     fallbacks so it degrades gracefully outside the app shell,
//   • injects its stylesheet once, id-guarded,
//   • no-ops entirely under prefers-reduced-motion (transitions become the
//     instant class swap main.js already performs),
//   • guards every hook so jsdom tests (no #slideshow) are unaffected.

const NOTE_LINE = /^[ \t]*note:[ \t]?(.*)$/gmi;
const NOTE_COMMENT = /<!--\s*note:[ \t]?(.*?)\s*-->/gsi;

export function extractSpeakerNotes(slideMd) {
  if (!slideMd) return { cleanMd: '', note: '' };
  const notes = [];

  // HTML comments first — `.` with the `s` flag spans newlines, so a comment
  // can wrap multiple lines. Collect the body, drop the whole comment.
  let clean = slideMd.replace(NOTE_COMMENT, (_whole, body) => {
    const text = body && body.trim();
    if (text) notes.push(text);
    return '';
  });

  // Then bare `note:` lines. The `m` flag makes `^` match every line start.
  clean = clean.replace(NOTE_LINE, (_whole, body) => {
    const text = body && body.trim();
    if (text) notes.push(text);
    return '';
  });

  // Collapse the runs of blank lines left behind by the removals so the slide
  // doesn't end up with awkward vertical gaps.
  clean = clean.replace(/\n{3,}/g, '\n\n').trim();

  return { cleanMd: clean, note: notes.join('\n') };
}

// ---------- presentation-mode polish (UI only) ----------
//
// What's wired, all from inside this file:
//   1. Direction-aware slide transitions — a MutationObserver watches the
//      .slide-stage for `.active` flips made by main.js's updateSlide() and
//      runs a WAAPI slide+fade on the incoming slide (direction inferred from
//      DOM order). The outgoing slide is already display:none'd by the class
//      flip, so only the entrance animates.
//   2. Auto-fading chrome — arrows, progress bar/chip, hint, exit + style
//      buttons fade out after 2s idle and reappear on any pointer/key/
//      focus activity. Focused controls stay visible (:focus-visible guard).
//   3. Deck↔reading crossfade — S key and the style button are intercepted
//      on the capture phase *only while presenting*, the stage dissolves
//      out, then the original handler is re-triggered via btn.click(), and
//      the stage dissolves back in. Reduced-motion users bypass all of it
//      (instant snap, zero interception).
//   4. Speaker-notes resize affordance — a drag handle on the panel's top
//      edge drives a --notes-h custom property on #slideshow; injected CSS
//      derives both the panel height and the slide's max-height from it.

const IDLE_MS = 2000;

/** True if the OS asks for minimized motion. Safe in non-DOM environments. */
function reduceMotion() {
  try {
    return !!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/** Read a numeric ms token off :root, e.g. token('--dur-3', 240). */
function tokenMs(name, fallback) {
  try {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Read an easing token off :root as a raw string. */
function tokenEase(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Direction-aware slide/fade transition between slides (WAAPI).
 *
 * @param {HTMLElement|null} _fromEl outgoing slide (already hidden by the
 *   `.active` flip — kept in the signature for symmetry/future use)
 * @param {HTMLElement|null} toEl    incoming slide (gets the entrance)
 * @param {number}           dir     1 = forward (next), -1 = back (prev)
 * @returns {Animation|undefined} the WAAPI animation, if one ran
 */
export function slideTransition(_fromEl, toEl, dir) {
  if (!toEl || dir === 0 || reduceMotion()) return undefined;
  if (typeof toEl.animate !== 'function') return undefined; // jsdom / old WebView

  // Suppress base.css's CSS slide-in while the WAAPI entrance plays so the
  // two don't stack (main.js restarts that animation itself each flip).
  // Rapid nav: cancel any in-flight entrance; only its own cleanup may
  // restore style.animation, so a superseded run can't clobber ours.
  if (toEl.__slideAnim) { try { toEl.__slideAnim.cancel(); } catch { /* already gone */ } }
  toEl.style.animation = 'none';
  const d = tokenMs('--dur-4', 360);
  const ease = tokenEase('--ease-out', 'cubic-bezier(0.16, 1, 0.3, 1)');
  const anim = toEl.animate(
    [
      { opacity: 0, transform: `translateX(${dir * 48}px)` },
      { opacity: 1, transform: 'translateX(0)' },
    ],
    { duration: d, easing: ease },
  );
  toEl.__slideAnim = anim;
  const done = () => {
    if (toEl.__slideAnim !== anim) return; // superseded by a newer entrance
    toEl.__slideAnim = null;
    toEl.style.animation = '';
  };
  anim.finished.then(done).catch(done); // finished rejects on .cancel()
  return anim;
}

/**
 * Wire auto-fading presentation chrome on the slideshow root: controls fade
 * after IDLE_MS of no pointer/key activity and reappear on any activity.
 * Idempotent via data-guard. Returns a disposer (tests / hygiene).
 */
export function wireSlideControls(root) {
  if (!root || root.hasAttribute('data-idle-bound')) return () => {};
  root.setAttribute('data-idle-bound', '');

  let timer = 0;
  const wake = () => {
    root.classList.remove('slide-idle');
    clearTimeout(timer);
    timer = setTimeout(() => {
      // Only hide while actually presenting; never leave a stale idle class.
      if (document.body.classList.contains('presenting')) root.classList.add('slide-idle');
    }, IDLE_MS);
  };
  const wakeIfPresenting = () => { if (document.body.classList.contains('presenting')) wake(); };

  root.addEventListener('pointermove', wake);
  root.addEventListener('pointerdown', wake);
  root.addEventListener('wheel', wake, { passive: true });
  root.addEventListener('focusin', wake);
  // Keyboard nav happens on window (main.js) — any key while presenting wakes.
  document.addEventListener('keydown', wakeIfPresenting, true);

  wake(); // start visible; the clock starts now
  return () => {
    clearTimeout(timer);
    root.classList.remove('slide-idle');
  };
}

/**
 * Crossfade the slide stage around a style swap: dissolve out, run `apply`
 * (the actual deck↔reading class flip), dissolve back in. Reduced motion →
 * apply() runs immediately (the snap main.js does today).
 *
 * @param {HTMLElement} slideshowEl the #slideshow overlay
 * @param {() => void}  apply       performs the mode flip synchronously
 * @returns {Promise<void>}
 */
export async function crossfadeStyleToggle(slideshowEl, apply) {
  const stage = slideshowEl?.querySelector?.('.slide-stage');
  if (!stage || typeof stage.animate !== 'function' || reduceMotion()) {
    apply();
    return;
  }
  const half = tokenMs('--dur-2', 180);
  const easeIn = tokenEase('--ease-in', 'cubic-bezier(0.7, 0, 0.84, 0)');
  const easeOut = tokenEase('--ease-out', 'cubic-bezier(0.16, 1, 0.3, 1)');
  await stage.animate([{ opacity: 1 }, { opacity: 0 }],
    { duration: half, easing: easeIn }).finished.catch(() => {});
  apply();
  stage.animate([{ opacity: 0 }, { opacity: 1 }],
    { duration: tokenMs('--dur-3', 240), easing: easeOut });
}

/**
 * Add a resize affordance to the speaker-notes panel: a drag handle on its
 * top edge writes a `--notes-h` px custom property onto the slideshow root;
 * injected CSS (below) derives the panel height and the slide max-height
 * from it. Double-click resets. Arrow keys nudge when the handle is focused.
 * Idempotent via data-guard.
 */
export function wireNotesResizer(slideshowEl) {
  const panel = slideshowEl?.querySelector?.('.speaker-notes');
  if (!panel || panel.querySelector('.speaker-notes-resize-handle')) return;

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'speaker-notes-resize-handle';
  handle.setAttribute('aria-label', 'Resize speaker notes (drag, arrow keys, double-click to reset)');
  handle.title = 'Drag to resize notes · double-click to reset';

  const MIN_H = 56;
  const MAX_H = Math.round(window.innerHeight * 0.5) || 320;
  const setH = (px) => {
    const h = `${Math.max(MIN_H, Math.min(MAX_H, Math.round(px)))}px`;
    slideshowEl.style.setProperty('--notes-h', h);
  };

  let startY = 0;
  let startH = 0;
  const onDown = (e) => {
    e.preventDefault();
    startY = e.clientY;
    const cur = parseFloat(getComputedStyle(slideshowEl).getPropertyValue('--notes-h')) || panel.offsetHeight;
    startH = Number.isFinite(cur) ? cur : panel.offsetHeight;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };
  // Panel grows downward visually? No — it sits below the stage, so growing
  // it pushes into the slide's space: dragging up grows the notes area.
  const onMove = (e) => setH(startH + (startY - e.clientY));
  const onUp = () => window.removeEventListener('pointermove', onMove);

  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('dblclick', () => {
    slideshowEl.style.removeProperty('--notes-h');
  });
  handle.addEventListener('keydown', (e) => {
    const cur = parseFloat(getComputedStyle(slideshowEl).getPropertyValue('--notes-h')) || panel.offsetHeight;
    if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setH(cur + 16); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setH(cur - 16); }
  });

  panel.appendChild(handle);
}

// Polish stylesheet — injected once, id-guarded. Scoped under #slideshow so
// nothing leaks into the editing surfaces. Tokens carry literal fallbacks
// matching themes.css values (120/180/240/360ms).
const POLISH_CSS = `
  /* 1 — direction-aware transitions ride WAAPI; keep base.css's CSS keyframe
     from fighting it by neutralizing it here (WAAPI sets style.animation). */
  #slideshow .slide { will-change: opacity, transform; }

  /* 2 — auto-fading chrome. Merge each element's existing base.css
     transition list so hover/press feedback survives the override. */
  #slideshow .slide-arrow {
    transition: opacity var(--dur-3, 240ms) var(--ease-out, ease),
      background-color var(--dur-1, 120ms) var(--ease-out, ease),
      transform var(--dur-1, 120ms) var(--ease-spring, ease),
      border-color var(--dur-1, 120ms) var(--ease-out, ease);
  }
  #slideshow .slide-exit-btn,
  #slideshow .slide-style-btn {
    transition: opacity var(--dur-3, 240ms) var(--ease-out, ease),
      background-color var(--dur-1, 120ms) var(--ease-out, ease),
      border-color var(--dur-1, 120ms) var(--ease-out, ease),
      color var(--dur-1, 120ms) var(--ease-out, ease);
  }
  #slideshow .slide-progress-bar::after {
    transition: width var(--dur-3, 240ms) var(--ease-out, ease);
  }
  #slideshow .slide-progress {
    font-feature-settings: 'tnum' 1;   /* reinforce tabular counter */
    letter-spacing: 0.02em;
    transition: opacity var(--dur-3, 240ms) var(--ease-out, ease);
  }
  #slideshow .slide-hint {
    transition: opacity var(--dur-3, 240ms) var(--ease-out, ease);
  }

  /* Idle: chrome melts away; the focused control stays put for keyboard users. */
  #slideshow.slide-idle :is(.slide-arrow, .slide-progress-bar, .slide-progress,
    .slide-hint, .slide-exit-btn, .slide-style-btn) {
    opacity: 0;
  }
  #slideshow.slide-idle :is(.slide-arrow, .slide-progress-bar, .slide-progress,
    .slide-hint, .slide-exit-btn, .slide-style-btn):focus-visible {
    opacity: 1;
  }

  /* 3 — speaker-notes resize handle + variable-driven layout. */
  #slideshow .speaker-notes { position: relative; }
  #slideshow .speaker-notes:not(.hidden) {
    height: var(--notes-h, auto);
    max-height: var(--notes-h, 22vh);
  }
  /* Slide yields exactly what the notes take (base.css hardcodes 60vh). */
  #slideshow:has(.speaker-notes:not(.hidden)) .slide {
    max-height: calc(86vh - var(--notes-h, 22vh) - 12px);
  }
  #slideshow .speaker-notes-body {
    color: var(--fg-strong, var(--fg));   /* contrast bump over the label */
  }
  #slideshow .speaker-notes-resize-handle {
    position: absolute;
    top: -6px; left: 0; right: 0;
    height: 12px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: ns-resize;
    z-index: 4;
  }
  #slideshow .speaker-notes-resize-handle::after {
    content: "";
    position: absolute;
    left: 50%; top: 50%;
    width: 36px; height: 4px;
    border-radius: 999px;
    transform: translate(-50%, -50%);
    background: color-mix(in srgb, var(--fg, #888) 25%, transparent);
    transition: background-color var(--dur-1, 120ms) var(--ease-out, ease),
      width var(--dur-1, 120ms) var(--ease-out, ease);
  }
  #slideshow .speaker-notes-resize-handle:hover::after,
  #slideshow .speaker-notes-resize-handle:focus-visible::after {
    width: 56px;
    background: var(--accent, currentColor);
  }
  #slideshow .speaker-notes-resize-handle:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 2px rgba(125, 125, 125, 0.5));
    border-radius: 999px;
  }

  /* Reduced motion: everything above snaps instead of gliding. */
  @media (prefers-reduced-motion: reduce) {
    #slideshow *, #slideshow *::before, #slideshow *::after {
      transition-duration: 0ms !important;
      animation-duration: 0ms !important;
    }
  }
`;

function ensurePolishStyles() {
  const id = 'mdpeek-slide-polish-css';
  let style = document.getElementById(id);
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    document.head.appendChild(style);
  }
  style.textContent = POLISH_CSS;
}

/**
 * Watch main.js's `.active` flips on the stage and run the directional
 * entrance. Rebuilds (innerHTML = '') reset the tracked index so re-entering
 * a presentation doesn't animate slide 0 like a "next".
 */
function wireTransitions(stage) {
  let prevIdx = -1;
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') { prevIdx = -1; continue; }
      const el = m.target;
      if (!(el instanceof Element) || !el.classList.contains('slide') || !el.classList.contains('active')) continue;
      const kids = Array.prototype.slice.call(stage.children);
      const idx = kids.indexOf(el);
      if (idx === prevIdx) continue;               // same slide re-synced
      const dir = idx > prevIdx ? 1 : -1;          // prevIdx < 0 → still 1/-1 but guarded below
      const known = prevIdx >= 0;
      prevIdx = idx;
      if (known) slideTransition(null, el, dir);   // first activation: no motion
    }
  }).observe(stage, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
}

/**
 * Intercept ONLY the deck↔reading style toggle (S key + style button) while
 * presenting, wrap it in the stage crossfade, then re-trigger main.js's own
 * handler via btn.click(). Capture-phase listeners here fire before main.js's
 * window-bubble keydown / direct button click, so stopPropagation cleanly
 * defers the flip until the dissolve-out lands. Any failure falls through to
 * btn.click() immediately — the toggle must never be lost.
 */
function interceptStyleToggle(slideshowEl) {
  const btn = slideshowEl.querySelector('#slide-style-btn');
  let busy = false;

  const run = () => {
    busy = true;
    crossfadeStyleToggle(slideshowEl, () => {
      try { if (btn) btn.click(); } catch { /* toggle lost only if btn missing */ }
    }).finally(() => { busy = false; });
  };
  const wants = (e) => {
    if (busy || reduceMotion()) return false;
    if (!document.body.classList.contains('presenting')) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false; // leave Ctrl+S etc. alone
    return true;
  };

  document.addEventListener('keydown', (e) => {
    if ((e.key !== 's' && e.key !== 'S') || !wants(e)) return;
    e.preventDefault();
    e.stopPropagation();
    run();
  }, true);

  if (btn) {
    slideshowEl.addEventListener('click', (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('#slide-style-btn') || !wants(e)) return;
      e.preventDefault();
      e.stopPropagation();
      run();
    }, true);
  }
}

/**
 * Idempotent entry point: inject styles and wire every hook to the static
 * slideshow markup. Safe to call repeatedly (guards everywhere); called once
 * automatically below when a DOM exists. Exported so tests / future wiring
 * can invoke it explicitly.
 */
export function installSlideshowPolish(root = document) {
  const slideshowEl = root.getElementById ? root.getElementById('slideshow') : null;
  if (!slideshowEl || slideshowEl.hasAttribute('data-polish-bound')) return;
  slideshowEl.setAttribute('data-polish-bound', '');
  ensurePolishStyles();
  wireSlideControls(slideshowEl);
  const stage = slideshowEl.querySelector('.slide-stage');
  if (stage) wireTransitions(stage);
  interceptStyleToggle(slideshowEl);
  wireNotesResizer(slideshowEl);
}

// Self-install. ES modules execute after HTML parsing, so #slideshow exists;
// in jsdom there is no slideshow markup and this is a silent no-op.
if (typeof document !== 'undefined') {
  installSlideshowPolish();
}
