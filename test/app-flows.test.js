import { beforeAll, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const backend = vi.hoisted(() => ({ invoke: vi.fn(), events: new Map(), files: new Map(), terminal: { toggle: vi.fn(), isOpen: () => false }, collab: { active: false, role: null, joinSession: vi.fn(), endSession: vi.fn(), bindEditor: vi.fn() } }));
vi.mock('../src/views/terminal.js', () => ({ initTerminal: () => backend.terminal }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: backend.invoke, convertFileSrc: (path) => path }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '1.4.2' }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async (event, callback) => { backend.events.set(event, callback); return () => {}; } }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => new Proxy({}, { get: () => async () => false }) }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: async (callback) => { backend.events.set('deep-link', callback); return () => {}; } }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: async () => null }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('../src/collab.js', () => ({
  getStatus: () => backend.collab,
  on: () => () => {},
  parseInviteUrl: () => ({ roomId: 'ABCDEFGHIJKLMNOP' }),
  setLocalIdentity: vi.fn(),
  joinSession: (...args) => backend.collab.joinSession(...args),
  endSession: () => { backend.collab.active = false; backend.collab.role = null; backend.collab.endSession(); },
  bindEditor: (...args) => backend.collab.bindEditor(...args),
  unbindEditor: vi.fn(),
}));

const click = (selector) => document.querySelector(selector).click();
const type = (value) => {
  const editor = document.querySelector('#editor');
  editor.value = value;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (key, modifiers = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, ...modifiers }));
const buffer = () => document.querySelector('#editor').value;

beforeAll(async () => {
  localStorage.clear();
  localStorage.setItem('mdpeek-autosave', '0');
  localStorage.setItem('mdpeek-minimal-mode', '0');
  window.__TAURI_INTERNALS__ = {};
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  Element.prototype.scrollIntoView = () => {};
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.parentElement; } });
  backend.invoke.mockImplementation(async (command, args) => {
    if (command === 'save_file_as') { backend.files.set('/notes/saved.md', args.content); return '/notes/saved.md'; }
    if (command === 'save_file') { backend.files.set(args.path, args.content); return; }
    if (command === 'read_file') return backend.files.get(args.path) || '';
    if (command === 'get_notes_dir') return '/notes';
    if (command === 'list_dir') return [];
    return null;
  });
  const html = readFileSync('index.html', 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  await import('../src/main.js');
  await vi.waitFor(() => expect(document.querySelector('.welcome')).not.toBeNull());
}, 20000);

it('new notes focus the editor; nested tasks and Save As update the real document', async () => {
  click('.welcome-action[data-action="new"]');
  expect(document.activeElement.id).toBe('editor');
  type('# Test note\n\n- [ ] first\n\n## More\n\n- [ ] second\n  - [ ] nested');
  await vi.waitFor(() => expect(document.querySelectorAll('#preview input[type="checkbox"]')).toHaveLength(3));
  click('#preview input[aria-label="nested"]');
  expect(buffer()).toContain('  - [x] nested');
  expect(buffer()).toContain('- [ ] first');
  click('#btn-save');
  await vi.waitFor(() => expect(document.querySelector('.tab.active .tab-title').textContent).toBe('saved.md'));
  expect(backend.files.get('/notes/saved.md')).toContain('  - [x] nested');
  expect(JSON.parse(localStorage.getItem('mdpeek-session')).docs[0].path).toBe('/notes/saved.md');
});

it('modified shortcuts launch their action without saving or toggling edit mode', async () => {
  backend.invoke.mockClear();
  document.querySelector('#editor').focus();
  key('S', { shiftKey: true });
  expect(document.querySelector('.palette-overlay:not(.hidden)')).not.toBeNull();
  expect(backend.invoke.mock.calls.some(([command]) => command.startsWith('save_file'))).toBe(false);
  key('Escape', { ctrlKey: false });
  document.querySelector('#editor').focus();
  key('E', { shiftKey: true });
  expect(document.querySelector('#edit-mode').classList.contains('hidden')).toBe(false);
});

it('the terminal shortcut runs once and leaves markdown untouched; disabled features stay hidden', () => {
  document.querySelector('#editor').focus();
  const content = buffer();
  key('`');
  expect(backend.terminal.toggle).toHaveBeenCalledTimes(1);
  expect(buffer()).toBe(content);
  localStorage.setItem('mdpeek-feature-terminal', '0');
  click('#btn-command-k');
  const search = document.querySelector('.palette-overlay:not(.hidden) input');
  search.value = 'terminal';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  expect(document.querySelector('.palette-overlay:not(.hidden)').textContent).not.toContain('Toggle terminal');
  key('Escape', { ctrlKey: false });
  localStorage.removeItem('mdpeek-feature-terminal');
});

it('external changes keep unsaved editor and preview content intact', async () => {
  type('# My unsaved work');
  backend.events.get('file-changed')({ payload: { path: '/notes/saved.md', content: '# External edit' } });
  expect(buffer()).toBe('# My unsaved work');
  click('#btn-mode');
  await vi.waitFor(() => expect(document.querySelector('#document h1')?.textContent).toBe('My unsaved work'));
  backend.events.get('file-changed')({ payload: { path: '/notes/saved.md', content: '# External edit' } });
  expect(document.querySelector('#document h1').textContent).toBe('My unsaved work');
});

it('quoted preview tasks toggle their own source line', async () => {
  click('#btn-mode');
  type('> - [ ] quoted\n\n- [ ] outside');
  await vi.waitFor(() => expect(document.querySelectorAll('#preview input[type="checkbox"]')).toHaveLength(2));
  click('#preview input[aria-label="quoted"]');
  expect(buffer()).toBe('> - [x] quoted\n\n- [ ] outside');
});

it('cancelling a join prevents a late connection from opening a shared tab', async () => {
  const tabs = document.querySelectorAll('.tab').length;
  let resolveJoin;
  backend.collab.joinSession.mockImplementationOnce(() => {
    backend.collab.active = true;
    backend.collab.role = 'receiver';
    return new Promise((resolve) => { resolveJoin = resolve; });
  });
  backend.events.get('deep-link')(['mdpeek://join?room=ABCDEFGHIJKLMNOP']);
  click('#join-confirm-btn');
  expect(document.querySelector('#join-confirm-btn').disabled).toBe(true);
  click('#join-cancel-btn');
  expect(backend.collab.endSession).toHaveBeenCalledTimes(1);
  resolveJoin({ initialText: 'Late text', language: 'markdown', title: 'Late note' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(document.querySelectorAll('.tab')).toHaveLength(tabs);
  expect(buffer()).not.toContain('Late text');
});

it('joining plain text immediately uses the full-width plain editor', async () => {
  backend.collab.joinSession.mockResolvedValueOnce({ initialText: '# Literal text', language: null, title: 'Shared text' });
  backend.events.get('deep-link')(['mdpeek://join?room=ABCDEFGHIJKLMNOP']);
  click('#join-confirm-btn');
  await vi.waitFor(() => expect(buffer()).toBe('# Literal text'));
  expect(document.querySelector('#edit-mode').classList.contains('plain')).toBe(true);
});
