// Dev-only browser shim — lets the UI boot in a plain browser (vite dev on
// :1420) for CSS/DOM work without the Tauri backend.
//
// In a real Tauri window `window.__TAURI_INTERNALS__` is injected before any
// app JS runs, so this module is a no-op there. In a plain browser the
// internals object is missing and `getCurrentWindow()` (main.js, module
// scope) throws, aborting the whole module — the known "blank in browser
// dev" failure. Installing a minimal fake keeps the module alive; every
// `invoke()` still rejects, which the existing try/catch paths already
// degrade from gracefully (no files — chrome only).
import { getIconForPath } from './lib/file-type.js';

if (!window.__TAURI_INTERNALS__) {
  // Collect runtime errors + unhandled rejections so browser-side debugging
  // (and the ?settings=1 previews) can be diagnosed via
  // window.__devErrors instead of a detached DevTools console.
  window.__devErrors = [];
  window.addEventListener('error', (e) => window.__devErrors.push(String(e.error || e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__devErrors.push('unhandled: ' + String(e.reason)));

  let cbId = 0;
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main' },
    },
    // Event (un)listen resolves so `listen()` chains settle instead of
    // producing unhandled rejections; handlers simply never fire.
    invoke: (cmd, args = {}) => {
      if (cmd === 'plugin:event|listen' || cmd === 'plugin:event|unlisten') {
        return Promise.resolve(++cbId);
      }
      return Promise.reject(new Error(`dev shim: no backend for "${cmd}"`));
    },
    transformCallback: (cb) => {
      const id = ++cbId;
      Object.defineProperty(window, `_${id}`, {
        value: (ev) => cb(ev),
        writable: false,
        configurable: true,
      });
      return id;
    },
  };

  // Deterministic browser previews for UI work / visual regression:
  //   ?theme=dark          — force a theme for this load (manual mode)
  //   &doc=1               — seed a sample document (view mode)
  //   &edit=1              — seed it in edit mode instead (implies doc=1)
  //   &settings=1&panel=x  — open the settings dialog, deep-link a category
  //   &ui=more|palette|find|explorer|confirm|toast|folder-search|dropzone|reader
  //                        — open that surface after boot
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme');
  if (theme) {
    localStorage.setItem('mdpeek-theme-mode', 'manual');
    localStorage.setItem('mdpeek-theme', theme);
  }
  if (params.get('settings') === '1') {
    setTimeout(() => document.getElementById('btn-settings')?.click(), 600);
    // Optionally deep-link to a settings category (?settings=1&panel=appearance).
    const panel = params.get('panel');
    if (panel) {
      setTimeout(() => {
        document.querySelector(`.settings-cat[data-cat="${panel}"]`)?.click();
        // The panel-switch fade runs on the real clock, which headless
        // --virtual-time-budget can screenshot mid-flight (and rAF may not
        // fire at all). A virtual timer + finish() settles it for captures.
        setTimeout(() => {
          document.getElementById('settings-dialog')
            ?.getAnimations({ subtree: true })
            .forEach((a) => { try { a.finish(); } catch { /* infinite anims */ } });
        }, 80);
      }, 1200);
    }
  }
  const SAMPLE_DOC = [
      '# Markdown preview', '',
      'A paragraph with **bold**, *italic*, `inline code`, a [link](https://example.com) and ==highlight==.', '',
      'A quiet place to read and write Markdown is worth building carefully. The content should own the screen while the chrome recedes to thin hairlines and muted labels. Typography carries the hierarchy: headings, hairlines and whitespace do the work that boxes and shadows used to do. When the palette is this restrained, a single accent color goes a long way.', '',
      '> A blockquote reads as pulled prose — left rule, secondary color, no box.', '',
      '> [!NOTE]', '> A GFM alert keeps a colored left edge on a tinted fill.', '',
      '## Sections', '',
      '1. Ordered items', '2. Render with rhythm', '   - nested child item', '   - another nested item', '',
      '- [ ] Task lists', '- [x] stay interactive', '',
      '```js', '// fenced code keeps the mono stack', 'const hello = () => "world";', '```', '',
      '| Column | Another |', '| --- | --- |', '| tables | hover |', '| render | cleanly |', '',
      '---', '',
      '### Smaller heading', '',
      '#### An h4 for completeness', '',
      'Final paragraph after a divider, with a footnote.[^1]', '',
      '[^1]: Footnotes render small and muted below a top hairline.',
    ].join('\n');
  const SAMPLE_CSV = [
    'name,role,team,shipped',
    'Ada Lovelace,Engineer,Core,142',
    'Grace Hopper,Engineer,Compiler,87',
    'Edsger Dijkstra,Research,Algorithms,54',
    'Katherine Johnson,Analyst,Flight,31',
    'Alan Turing,Research,Theory,19',
  ].join('\n');
  const SAMPLE_CODE = [
    '// sample code preview',
    'export function greet(name) {',
    '  const msg = `Hello, ${name}!`;',
    '  console.log(msg);',
    '  return msg;',
    '}',
    '',
    "for (const who of ['Ada', 'Grace', 'Edsger']) {",
    '  greet(who);',
    '}',
  ].join('\n');

  // Seed a sample document (session restore) so rendered-markdown styling is
  // screenshotable in a plain browser. Seeds once, then reloads so main.js
  // restores it through the normal boot path (sessionStorage flag breaks the
  // seed->reload cycle). doc=csv/doc=code seed a .csv/.js path so the session
  // store derives the viewer kind from the extension on restore.
  const docKind = params.get('doc');
  const wantsDoc = docKind === '1' || docKind === 'csv' || docKind === 'code' || params.get('edit') === '1';
  if (wantsDoc && !sessionStorage.getItem('mdpeek-dev-doc')) {
    const doc = { id: 'preview-doc', path: null, content: SAMPLE_DOC, mode: 'view', dirty: false, scrollY: 0 };
    if (docKind === 'csv') { doc.path = 'C:\\demo\\expenses.csv'; doc.content = SAMPLE_CSV; }
    else if (docKind === 'code') { doc.path = 'C:\\demo\\hello.js'; doc.content = SAMPLE_CODE; }
    else if (params.get('edit') === '1') { doc.mode = 'edit'; }
    localStorage.setItem('mdpeek-session', JSON.stringify({ docs: [doc], activeId: 'preview-doc' }));
    sessionStorage.setItem('mdpeek-dev-doc', '1');
    location.reload();
  }
  // &rects=1 — dump layout rects + scroll offsets into document.title for
  // headless debugging (read via --dump-dom).
  if (params.get('rects') === '1') {
    setTimeout(() => {
      const q = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return sel + '=none';
        const r = el.getBoundingClientRect();
        return sel + `=${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      };
      const errs = (window.__devErrors || []).join('|');
      const sp = document.querySelector('.settings-panel:not(.hidden)');
      const scs = sp ? getComputedStyle(sp) : null;
      const sc = document.querySelector('.settings-content');
      document.title = [q('.app-header'), q('.workspace-container'), q('#view-mode'), q('.edit-mode'),
        q('.editor-pane'), q('.pane-resizer'), q('.preview-pane'), q('#editor'), q('.app'),
        'body.scrollY=' + window.scrollY, 'docEl.h=' + document.documentElement.clientHeight,
        'SP=' + (scs ? `${sp.dataset.cat}:${scs.opacity} anim=${scs.animationName} inline=${sp.getAttribute('style') || '-'} searching=${sc ? sc.classList.contains('searching') : '?'}` : 'none'),
        'ERRS=' + errs].join(' ;; ');
    }, 1600);
  }

  // &ui=<surface> — open a UI surface after boot for screenshots.
  const ui = params.get('ui');
  if (ui) {
    setTimeout(() => {
      try {
        if (ui === 'more') {
          document.getElementById('btn-more')?.click();
        } else if (ui === 'palette') {
          document.getElementById('btn-command-k')?.click();
        } else if (ui === 'find') {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
        } else if (ui === 'explorer') {
          const tree = document.getElementById('file-tree');
          // toggleExplorer() diverts to a folder picker when no explorer root is
          // stored; reveal the aside directly for a deterministic screenshot.
          tree?.classList.remove('hidden');
          const body = document.getElementById('file-tree-body');
          if (body && !body.querySelector('.tree-row')) {
            const chev = '<svg class="tree-chevron open" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><polyline points="6 4 10 8 6 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            const dirIco = '<svg class="tree-icon dir" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
            const fileRow = (name, depth, cls) =>
              `<div class="tree-row is-file ${cls}" data-depth="${depth}" data-path="notes/${name}" tabindex="-1" style="padding-left:${depth * 12 + 8}px"><span class="tree-chevron-spacer"></span>${getIconForPath(name, 'tree-icon file')}<span class="tree-name">${name}</span></div>`;
            body.innerHTML = [
              '<div class="tree-root-label">notes</div>',
              `<div class="tree-row is-dir expanded" data-depth="0" data-path="notes/work" tabindex="-1" style="padding-left:8px">${chev}${dirIco}<span class="tree-name">work</span></div>`,
              fileRow('meeting-notes.md', 1, ''),
              fileRow('roadmap.md', 1, ''),
              fileRow('readme.md', 0, 'active'),
            ].join('');
          }
        } else if (ui === 'confirm') {
          const dlg = document.getElementById('confirm-dialog');
          if (dlg) {
            dlg.querySelector('#confirm-title').textContent = 'Discard changes?';
            dlg.querySelector('#confirm-text').textContent = 'This document has unsaved changes. Closing it will discard them.';
            const iconEl = dlg.querySelector('#confirm-icon');
            // Real confirms get the warn glyph (WARN_ICON in main.js).
            iconEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
            iconEl.style.display = 'flex';
            dlg.querySelector('#confirm-actions').innerHTML =
              '<button class="modal-btn modal-btn-secondary">Cancel</button>' +
              '<button class="modal-btn modal-btn-danger">Discard</button>';
            dlg.classList.remove('hidden');
          }
        } else if (ui === 'toast') {
          const toast = document.getElementById('toast');
          if (toast) {
            toast.textContent = 'Document saved';
            toast.classList.remove('hidden');
          }
        } else if (ui === 'folder-search') {
          // folderSearch.open() needs a real folder path from the backend;
          // reveal the card directly for a deterministic screenshot.
          const overlay = document.getElementById('folder-search-overlay');
          if (overlay) {
            overlay.classList.remove('hidden');
            const folder = overlay.querySelector('.folder-search-folder');
            if (folder && !folder.textContent.trim()) folder.textContent = 'notes';
          }
        } else if (ui === 'dropzone') {
          document.getElementById('dropzone')?.classList.remove('hidden');
        } else if (ui === 'reader') {
          const reader = document.getElementById('reader');
          if (reader) {
            // openReader() normally stamps these; set them directly so the
            // preset selectors match (default medium width/font).
            reader.dataset.readerTheme = params.get('theme') === 'dark' ? 'dark' : 'light';
            reader.dataset.readerWidth = 'medium';
            reader.dataset.readerFont = 'medium';
            reader.classList.remove('hidden');
            const title = document.getElementById('reader-title');
            if (title) title.textContent = 'Markdown preview';
            const meta = document.getElementById('reader-meta');
            if (meta) meta.textContent = '2 min read · 320 words';
            const article = document.getElementById('reader-article');
            if (article && !article.innerHTML.trim()) {
              import('./lib/renderer.js')
                .then((m) => { article.innerHTML = m.renderMarkdown(SAMPLE_DOC); })
                .catch((err) => window.__devErrors.push('reader render: ' + String(err)));
            }
          }
        }
      } catch (err) {
        window.__devErrors.push('ui param: ' + String(err));
      }
    }, 900);
  }
}
