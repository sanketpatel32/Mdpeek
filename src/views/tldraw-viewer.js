// TLDraw canvas viewer — deprecated in favor of Excalidraw.
// Exposes the controller interface expected by main.js:
// { setTheme, getSceneJSON, flush, destroy, getElementCount, exportImage }.

const _containerOwners = new WeakMap();

export async function showTLDraw(container, initialData, onSave, initialAppTheme, isStale) {
  const token = {};
  _containerOwners.set(container, token);
  const isOwner = () => _containerOwners.get(container) === token;

  if (isStale && isStale()) {
    if (isOwner()) {
      container.classList.remove('tldraw-host');
      container.innerHTML = '';
    }
    return {
      setTheme() {},
      getSceneJSON() { return initialData || ''; },
      flush() { return initialData || ''; },
      getElementCount() { return 0; },
      exportImage: null,
      destroy() {
        if (isOwner()) {
          container.classList.remove('tldraw-host');
          container.innerHTML = '';
        }
      },
    };
  }

  container.classList.add('tldraw-host');
  container.innerHTML = `
    <div class="cvw-well" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 2.5rem; text-align: center; height: 100%; box-sizing: border-box;">
      <div style="width: 48px; height: 48px; border-radius: 12px; background: color-mix(in srgb, var(--accent) 15%, transparent); display: flex; align-items: center; justify-content: center; margin-bottom: 1rem; color: var(--accent);">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <div style="font-size: 1.15rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--fg);">TLDraw Canvas Retired</div>
      <div style="max-width: 440px; font-size: 0.875rem; color: var(--fg-secondary); line-height: 1.5; margin-bottom: 1.5rem;">
        TLDraw has been retired in favor of Excalidraw to keep mdpeek featherlight and reduce bundle size. Please use Excalidraw for infinite canvas diagrams.
      </div>
    </div>
  `;

  return {
    setTheme() {},
    getSceneJSON() { return initialData || ''; },
    flush() { return initialData || ''; },
    getElementCount() { return 0; },
    exportImage: null,
    destroy() {
      if (isOwner()) {
        container.classList.remove('tldraw-host');
        container.innerHTML = '';
      }
    },
  };
}
