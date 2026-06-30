import { renderMarkdown, enhanceDom } from '../lib/renderer.js';

// Wire a textarea to a live-preview target with debounced re-render.
export function initEditor({ textarea, preview, debounceMs = 150 }) {
  let timer = null;

  async function refresh() {
    preview.innerHTML = renderMarkdown(textarea.value);
    await enhanceDom(preview);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, debounceMs);
  }

  textarea.addEventListener('input', schedule);
  refresh();

  return {
    setValue(text) {
      textarea.value = text;
      refresh();
    },
    getValue() {
      return textarea.value;
    },
    refresh,
    destroy() {
      clearTimeout(timer);
    },
  };
}
