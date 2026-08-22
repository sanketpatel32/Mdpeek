// v0.49.0: Audio/video viewer. Binary files streamed via the Tauri asset
// protocol (convertFileSrc) — bytes never ride doc.content, exactly like the
// image viewer. Mirrors showImage()'s controller shape: showMedia() returns
// { container, destroy() }.
//
// Polish layer (injected, id-guarded): replaces the bare native controls with
// a themed custom control bar (play/pause, scrubber, volume, fullscreen/PiP),
// a centered play/pause overlay that scale-pops on every pause, hover-growth
// scrubber thumbs, tabular-nums metadata (name + duration), and a designed
// decode-error card with retry. Presentation/interaction only — streaming and
// the controller contract are unchanged.

import { convertFileSrc } from '@tauri-apps/api/core';

// Audio extensions → audio player card. Everything else (mp4/webm/mov/...) →
// video stage. Pure, exported for testing.
export function mediaKind(path) {
  if (/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(path)) return 'audio';
  return 'video';
}

// ---------- injected polish styles ----------
// Idempotent: one <style id="media-polish-style"> in <head>, re-entry is a
// no-op. Tokens come from themes.css (--sp-*, --dur-*, --radius*, --accent…)
// with literal fallbacks so the bar still renders if injected before theme
// load. The control surface uses a dark scrim (like real players) so it reads
// over both bright videos and light/dark app themes alike.
const MEDIA_POLISH_CSS = `
@keyframes mc-pop {
  from { opacity: 0; transform: scale(0.62); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes media-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}

/* The raw <audio> keeps streaming alive but is fully replaced visually by
   the custom bar inside the card (no native chrome, no stray layout gap). */
.media-audio-el { display: none; }

/* Stage: positions the overlay + floating bar over the video. */
.media-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md, 8px);
}
.media-stage:fullscreen {
  background: #000;
  justify-content: center;
  padding: 0;
}
.media-stage:fullscreen .media-video-el {
  max-width: 100vw;
  max-height: 100vh;
  border-radius: 0;
}

/* Control bar: dark glass scrim shared by the video stage and audio card. */
.mc-bar {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 10px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: var(--sp-1, 4px);
  padding: var(--sp-2, 6px) var(--sp-3, 8px);
  border-radius: var(--radius-lg, 12px);
  background: rgba(14, 15, 19, 0.78);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  box-shadow:
    0 6px 22px rgba(0, 0, 0, 0.32),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  /* Auto-hide while playing: revealed on hover/focus or whenever paused. */
  opacity: 0;
  transform: translateY(6px);
  pointer-events: none;
  transition:
    opacity var(--dur-2, 180ms) var(--ease-out, ease),
    transform var(--dur-2, 180ms) var(--ease-out, ease);
}
.media-stage:hover .mc-bar,
.media-stage:focus-within .mc-bar,
.media-stage[data-playing="0"] .mc-bar,
.media-stage:fullscreen .mc-bar {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
/* Audio variant sits in normal flow inside the card, always visible. */
.mc-bar-flow {
  position: static;
  width: 100%;
  opacity: 1;
  transform: none;
  pointer-events: auto;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

/* Buttons: ghost circles; play is the accent hook. */
.mc-btn {
  width: 32px;
  height: 32px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 0;
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.92);
  cursor: pointer;
  transition:
    background-color var(--dur-1, 120ms) var(--ease-out, ease),
    filter var(--dur-1, 120ms) var(--ease-out, ease),
    transform var(--dur-1, 120ms) var(--ease-out, ease);
}
.mc-btn:hover { background: rgba(255, 255, 255, 0.14); }
.mc-btn:active { transform: scale(0.92); }
.mc-btn:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--accent, #4a90d9);
}
.mc-btn svg { width: 17px; height: 17px; display: block; }
.mc-play { background: var(--accent, #4a90d9); color: #fff; }
.mc-play:hover { background: var(--accent-hover, var(--accent, #4a90d9)); }

/* Play/pause icon swap driven by [data-playing] on the stage/card root. */
.media-stage[data-playing="1"] .mc-ic-play,
.media-audio-card[data-playing="1"] .mc-ic-play { display: none; }
.media-stage[data-playing="0"] .mc-ic-pause,
.media-audio-card[data-playing="0"] .mc-ic-pause { display: none; }
.mc-mute[data-muted="1"] .mc-ic-vol { display: none; }
.mc-mute:not([data-muted="1"]) .mc-ic-volx { display: none; }

/* Times + duration chip: aligned digits. */
.mc-time {
  min-width: 40px;
  text-align: center;
  font-size: 11.5px;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.85);
  font-variant-numeric: tabular-nums;
  user-select: none;
}

/* Scrubber: accent fill grows left→right via --fill; thumb pops on hover. */
.mc-scrub {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  min-width: 60px;
  height: 4px;
  margin: 0 var(--sp-2, 6px);
  border-radius: 999px;
  cursor: pointer;
  background: linear-gradient(
    90deg,
    var(--accent, #4a90d9) var(--fill, 0%),
    rgba(255, 255, 255, 0.26) var(--fill, 0%)
  );
  transition: height var(--dur-1, 120ms) var(--ease-out, ease);
}
.mc-scrub:hover { height: 6px; }
.mc-scrub::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  transition: transform var(--dur-1, 120ms) var(--ease-out, ease);
}
.mc-scrub:hover::-webkit-slider-thumb,
.mc-scrub:focus-visible::-webkit-slider-thumb { transform: scale(1.35); }
.mc-scrub:focus-visible { outline: 2px solid var(--accent, #4a90d9); outline-offset: 3px; }

/* Volume: same fill treatment; widens on bar hover to invite adjusting. */
.mc-vol {
  -webkit-appearance: none;
  appearance: none;
  width: 68px;
  height: 4px;
  border-radius: 999px;
  cursor: pointer;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.92) var(--fill, 100%),
    rgba(255, 255, 255, 0.26) var(--fill, 100%)
  );
  transition: width var(--dur-2, 180ms) var(--ease-out, ease);
}
.mc-bar:hover .mc-vol,
.mc-vol:focus-visible { width: 96px; }
.mc-vol::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  transition: transform var(--dur-1, 120ms) var(--ease-out, ease);
}
.mc-vol:hover::-webkit-slider-thumb { transform: scale(1.3); }
.mc-vol:focus-visible { outline: 2px solid var(--accent, #4a90d9); outline-offset: 3px; }

/* Centered play/pause overlay: scale-pop on mount and on every pause. */
.mc-overlay {
  position: absolute;
  inset: 0;
  margin: auto;
  z-index: 2;
  width: 76px;
  height: 76px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 0;
  border-radius: 999px;
  color: #fff;
  background: rgba(12, 13, 16, 0.55);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  box-shadow:
    0 8px 28px rgba(0, 0, 0, 0.35),
    inset 0 0 0 1px rgba(255, 255, 255, 0.14);
  cursor: pointer;
  animation: mc-pop var(--dur-3, 240ms) var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
  transition:
    opacity var(--dur-2, 180ms) var(--ease-out, ease),
    transform var(--dur-2, 180ms) var(--ease-out, ease);
}
.mc-overlay svg { width: 30px; height: 30px; margin-left: 2px; }
.mc-overlay:hover { background: rgba(12, 13, 16, 0.7); }
.media-stage[data-playing="1"] .mc-overlay {
  opacity: 0;
  transform: scale(0.82);
  pointer-events: none;
}

/* Metadata line: name in UI type, duration chip with tabular digits. */
.media-meta {
  display: flex;
  align-items: center;
  gap: var(--sp-2, 6px);
  margin-top: var(--sp-3, 8px);
  max-width: min(calc(720px * var(--zoom-level, 1)), 100%);
  font-size: 12px;
}
.media-meta-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--fg-secondary, var(--fg));
}
.media-meta-chip {
  flex: none;
  margin-left: auto;
  padding: 0 var(--sp-2, 6px);
  border-radius: 999px;
  border: 1px solid var(--border-subtle, #e6e7ed);
  background: var(--bg-elevated, #fff);
  font-size: 11px;
  line-height: 18px;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.media-audio-namerow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2, 6px);
  max-width: 100%;
}

/* Decode error state: designed card with danger tint + retry affordance. */
.media-error-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2, 6px);
  max-width: 420px;
  padding: var(--sp-7, 24px) var(--sp-8, 32px);
  text-align: center;
  border-radius: var(--radius-lg, 12px);
  border: 1px solid color-mix(in srgb, var(--danger, #ff3b30) 30%, var(--border-subtle, #e6e7ed));
  background: color-mix(in srgb, var(--danger, #ff3b30) 6%, var(--bg-elevated, #fff));
  animation: media-fade-in var(--dur-3, 240ms) var(--ease-out, ease);
}
.media-error-glyph {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--danger, #ff3b30);
  background: color-mix(in srgb, var(--danger, #ff3b30) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger, #ff3b30) 24%, transparent);
}
.media-error-glyph svg { width: 18px; height: 18px; }
.media-error-title { font-size: 13.5px; font-weight: 600; color: var(--fg); }
.media-error-msg { font-size: 12px; color: var(--fg-muted); word-break: break-word; }
.media-error-retry {
  margin-top: var(--sp-2, 6px);
  padding: var(--sp-1, 4px) var(--sp-4, 12px);
  border: none;
  border-radius: var(--radius-sm, 5px);
  background: var(--accent, #4a90d9);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    filter var(--dur-1, 120ms) var(--ease-out, ease),
    transform var(--dur-1, 120ms) var(--ease-out, ease);
}
.media-error-retry:hover { filter: brightness(1.07); }
.media-error-retry:active { transform: scale(0.96); }

@media (prefers-reduced-motion: reduce) {
  .mc-overlay { animation: none; }
  .mc-bar, .mc-overlay, .mc-btn, .mc-vol { transition: none; }
  .mc-scrub, .mc-scrub::-webkit-slider-thumb, .mc-vol::-webkit-slider-thumb { transition: none; }
}
`;

function ensureMediaPolishStyle() {
  if (document.getElementById('media-polish-style')) return;
  const style = document.createElement('style');
  style.id = 'media-polish-style';
  style.textContent = MEDIA_POLISH_CSS;
  document.head.appendChild(style);
}

const IC_PLAY =
  '<svg class="mc-ic mc-ic-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72L19 12z"/></svg>';
const IC_PAUSE =
  '<svg class="mc-ic mc-ic-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const IC_VOL =
  '<svg class="mc-ic mc-ic-vol" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12z"/></svg>';
const IC_VOLX =
  '<svg class="mc-ic mc-ic-volx" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm18.5 3-2.24-2.24-1.06 1.06L20.44 13l-2.24 2.24 1.06 1.06L21.5 14.06l2.24 2.24 1.06-1.06L22.56 13l2.24-2.24-1.06-1.06z"/></svg>';
const IC_PIP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><rect x="12" y="11.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none"/></svg>';
const IC_FULL =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';

function controlBarHtml(kind) {
  const isVideo = kind === 'video';
  return (
    `<div class="mc-bar${isVideo ? '' : ' mc-bar-flow'}" role="group" aria-label="${isVideo ? 'Video' : 'Audio'} controls">` +
    `<button type="button" class="mc-btn mc-play" data-mc="play" aria-label="Play or pause">${IC_PLAY}${IC_PAUSE}</button>` +
    `<span class="mc-time" data-mc="cur">0:00</span>` +
    `<input class="mc-scrub" data-mc="scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Seek" />` +
    `<span class="mc-time" data-mc="dur">&ndash;:&ndash;&ndash;</span>` +
    `<button type="button" class="mc-btn mc-mute" data-mc="mute" aria-label="Mute">${IC_VOL}${IC_VOLX}</button>` +
    `<input class="mc-vol" data-mc="vol" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume" />` +
    (isVideo
      ? `<button type="button" class="mc-btn mc-pip" data-mc="pip" aria-label="Picture-in-picture" title="Picture-in-picture">${IC_PIP}</button>` +
        `<button type="button" class="mc-btn" data-mc="full" aria-label="Fullscreen" title="Fullscreen">${IC_FULL}</button>`
      : '') +
    `</div>`
  );
}

function fmtTime(t) {
  if (!Number.isFinite(t)) return '\u2013:\u2013\u2013';
  const total = Math.max(0, Math.floor(t));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function showMedia(container, filePath) {
  container.classList.add('media-viewer');
  ensureMediaPolishStyle();
  const src = convertFileSrc(filePath);
  const name = filePath.split(/[\\/]/).pop() || 'media';
  const kind = mediaKind(filePath);
  let destroyed = false;

  function render() {
    if (destroyed) return;
    if (kind === 'audio') {
      container.innerHTML =
        `<div class="media-viewer-wrap">` +
        `<div class="media-audio-card" data-playing="0">` +
        `<div class="media-audio-icon" aria-hidden="true">` +
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>` +
        `</div>` +
        `<div class="media-audio-namerow">` +
        `<div class="media-audio-name">${escapeAttr(name)}</div>` +
        `<span class="media-meta-chip" data-mc="metadur">&ndash;:&ndash;&ndash;</span>` +
        `</div>` +
        `<audio class="media-audio-el" preload="metadata" src="${escapeAttr(src)}"></audio>` +
        controlBarHtml('audio') +
        `</div>` +
        `</div>`;
      wireControls(
        container.querySelector('.media-audio-card'),
        container.querySelector('audio'),
        'audio',
      );
    } else {
      container.innerHTML =
        `<div class="media-viewer-wrap">` +
        `<div class="media-stage" data-playing="0">` +
        `<video class="media-video-el" preload="metadata" src="${escapeAttr(src)}"></video>` +
        `<button type="button" class="mc-overlay" data-mc="overlay" aria-label="Play">${IC_PLAY}</button>` +
        controlBarHtml('video') +
        `</div>` +
        `<div class="media-meta">` +
        `<span class="media-meta-name">${escapeAttr(name)}</span>` +
        `<span class="media-meta-chip" data-mc="metadur">&ndash;:&ndash;&ndash;</span>` +
        `</div>` +
        `</div>`;
      wireControls(container.querySelector('.media-stage'), container.querySelector('video'), 'video');
    }
  }

  // Decode failure → designed error card instead of an inert black box.
  // Retry rebuilds the player (re-runs render()); the returned controller's
  // destroy() keeps working because it queries the live container.
  function showError(msg) {
    if (destroyed) return;
    container.innerHTML =
      `<div class="media-viewer-wrap">` +
      `<div class="media-error-card" role="alert">` +
      `<div class="media-error-glyph" aria-hidden="true">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>` +
      `</div>` +
      `<span class="media-error-title">Couldn&rsquo;t play &ldquo;${escapeAttr(name)}&rdquo;</span>` +
      `<span class="media-error-msg">${escapeAttr(msg)}</span>` +
      `<button type="button" class="media-error-retry">Retry</button>` +
      `</div>` +
      `</div>`;
    container.querySelector('.media-error-retry').addEventListener('click', render);
  }

  function wireControls(root, el, kind) {
    if (!root || !el) return;
    const $ = (sel) => root.querySelector(`[data-mc="${sel}"]`);
    const curEl = $('cur');
    const durEl = $('dur');
    const metaDur = $('metadur');
    const scrub = $('scrub');
    const vol = $('vol');
    const muteBtn = $('mute');
    const pipBtn = $('pip');
    let seeking = false;

    function syncTime() {
      curEl.textContent = fmtTime(el.currentTime);
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) {
        durEl.textContent = fmtTime(d);
        if (metaDur) metaDur.textContent = fmtTime(d);
        if (!seeking) scrub.value = String((el.currentTime / d) * 1000);
        scrub.style.setProperty('--fill', `${(el.currentTime / d) * 100}%`);
      } else {
        scrub.style.setProperty('--fill', '0%');
      }
    }
    function syncPlay() {
      root.dataset.playing = el.paused ? '0' : '1';
      // Re-trigger the scale-pop each time the overlay reappears.
      if (el.paused) {
        const ov = $('overlay');
        if (ov) {
          ov.style.animation = 'none';
          void ov.offsetWidth;
          ov.style.animation = '';
        }
      }
    }
    function syncVol() {
      vol.style.setProperty('--fill', `${Math.round(el.volume * 100)}%`);
      muteBtn.dataset.muted = el.muted || el.volume === 0 ? '1' : '0';
      muteBtn.setAttribute('aria-label', el.muted ? 'Unmute' : 'Mute');
    }
    function togglePlay() {
      if (el.paused) el.play().catch(() => {});
      else el.pause();
    }
    function toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
    }

    el.addEventListener('play', syncPlay);
    el.addEventListener('pause', syncPlay);
    el.addEventListener('timeupdate', syncTime);
    el.addEventListener('loadedmetadata', syncTime);
    el.addEventListener('volumechange', syncVol);
    el.addEventListener('error', () => {
      showError(el.error && el.error.message ? el.error.message : 'The file could not be decoded or found.');
    });

    $('play').addEventListener('click', togglePlay);
    const overlayBtn = $('overlay');
    if (overlayBtn) {
      overlayBtn.addEventListener('click', togglePlay);
      // Click video = toggle (debounced so double-click can still fullscreen).
      let clickTimer = null;
      el.addEventListener('click', () => {
        if (clickTimer) return;
        clickTimer = setTimeout(() => {
          clickTimer = null;
          togglePlay();
        }, 240);
      });
      el.addEventListener('dblclick', () => {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        toggleFullscreen();
      });
    }
    scrub.addEventListener('input', () => {
      const d = el.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      const frac = Number(scrub.value) / 1000;
      scrub.style.setProperty('--fill', `${frac * 100}%`);
      curEl.textContent = fmtTime(frac * d);
      el.currentTime = frac * d;
    });
    scrub.addEventListener('pointerdown', () => { seeking = true; });
    scrub.addEventListener('pointerup', () => { seeking = false; });
    vol.addEventListener('input', () => {
      el.volume = Number(vol.value);
      if (el.muted && el.volume > 0) el.muted = false;
    });
    muteBtn.addEventListener('click', () => { el.muted = !el.muted; });
    $('full').addEventListener('click', toggleFullscreen);
    if (pipBtn) {
      if (document.pictureInPictureEnabled && typeof el.requestPictureInPicture === 'function') {
        pipBtn.addEventListener('click', () => {
          if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
          else el.requestPictureInPicture().catch(() => {});
        });
      } else {
        pipBtn.style.display = 'none'; // unsupported WebView → hide the hook
      }
    }

    syncPlay();
    syncVol();
    syncTime();
  }

  render();

  return {
    container,
    destroy() {
      destroyed = true;
      // Pausing releases the underlying stream promptly on tab switch.
      const el = container.querySelector('audio,video');
      if (el) try { el.pause(); } catch { /* noop */ }
    },
  };
}
