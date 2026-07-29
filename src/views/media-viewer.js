// v0.49.0: Audio/video viewer. Binary files streamed via the Tauri asset
// protocol (convertFileSrc) — bytes never ride doc.content, exactly like the
// image viewer. Mirrors showImage()'s controller shape: showMedia() returns
// { container, destroy() }.

import { convertFileSrc } from '@tauri-apps/api/core';

// Audio extensions → <audio controls>. Everything else (mp4/webm/mov/...) →
// <video controls>. Pure, exported for testing.
export function mediaKind(path) {
  if (/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(path)) return 'audio';
  return 'video';
}

export function showMedia(container, filePath) {
  container.classList.add('media-viewer');
  const src = convertFileSrc(filePath);
  const name = filePath.split(/[\\/]/).pop() || 'media';
  const kind = mediaKind(filePath);

  if (kind === 'audio') {
    container.innerHTML =
      `<div class="media-viewer-wrap">` +
      `<div class="media-audio-card">` +
      `<div class="media-audio-icon" aria-hidden="true">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>` +
      `</div>` +
      `<div class="media-audio-name">${escapeAttr(name)}</div>` +
      `<audio class="media-audio-el" controls preload="metadata" src="${escapeAttr(src)}"></audio>` +
      `</div>` +
      `</div>`;
  } else {
    container.innerHTML =
      `<div class="media-viewer-wrap">` +
      `<video class="media-video-el" controls preload="metadata" src="${escapeAttr(src)}"></video>` +
      `</div>`;
  }

  let destroyed = false;
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

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
