import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { saveActiveDoc } from '../src/lib/save-doc.js';

const canvas = vi.hoisted(() => ({ props: null, invoke: vi.fn(), exportBlob: vi.fn() }));
vi.mock('react-dom/client', () => ({ default: { createRoot: () => ({ render: (element) => { canvas.props = element.props; }, unmount() {} }) } }));
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: () => null,
  serializeAsJSON: (elements, appState, files) => JSON.stringify({ elements, appState, files }),
  exportToBlob: canvas.exportBlob,
  exportToSvg: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: canvas.invoke }));
import { showExcalidraw } from '../src/views/excalidraw-viewer.js';

let host, ctrl;
beforeEach(() => {
  vi.useFakeTimers();
  canvas.invoke.mockReset();
  document.body.innerHTML = '<article></article>';
  host = document.querySelector('article');
  window.__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  ctrl?.destroy();
  ctrl = null;
  delete window.__TAURI_INTERNALS__;
  vi.useRealTimers();
});

it('explicit save captures a drawing and cancels the pending dirty callback', async () => {
  const onSave = vi.fn();
  ctrl = await showExcalidraw(host, '', onSave, 'light');
  canvas.props.onChange([{ id: 'rectangle', type: 'rectangle' }], {}, {});
  const doc = { id: 'drawing', path: '/drawing.excalidraw', excalidraw: true, content: '', dirty: true };
  const deps = { invoke: vi.fn().mockResolvedValue(undefined), toast: vi.fn(), fmtErr: String,
    clearDirty: () => { doc.dirty = false; }, excalidraw: ctrl };
  await saveActiveDoc(deps, doc);
  expect(JSON.parse(deps.invoke.mock.calls[0][1].content).elements[0].id).toBe('rectangle');
  await vi.advanceTimersByTimeAsync(1100);
  expect(onSave).not.toHaveBeenCalled();
  expect(doc.dirty).toBe(false);
});

it('corrupt drawings stay read-only and retain their original bytes on save', async () => {
  const original = '{broken drawing';
  const onSave = vi.fn();
  ctrl = await showExcalidraw(host, original, onSave, 'light');
  expect(canvas.props.viewModeEnabled).toBe(true);
  canvas.props.onChange([{ id: 'replacement' }], {}, {});
  await vi.advanceTimersByTimeAsync(1100);
  expect(ctrl.flush()).toBe(original);
  expect(onSave).not.toHaveBeenCalled();
  expect(host.querySelector('.canvas-warn[role="alert"]').textContent).toContain('Editing is disabled');
  expect(host.querySelector('.cvw-btn').disabled).toBe(true);
});

it('failed native exports show an actionable error and restore the controls', async () => {
  ctrl = await showExcalidraw(host, '', vi.fn(), 'light');
  ctrl.exportImage = vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), mime: 'image/png' });
  canvas.invoke.mockRejectedValue('Permission denied');
  const png = host.querySelector('button[data-tip="Export as PNG"]');
  png.click();
  await vi.waitFor(() => expect(host.querySelector('.cvw-chrome [role="alert"]').textContent).toContain('Permission denied'));
  expect(png.disabled).toBe(false);
  expect(host.querySelector('.cvw-chrome [role="alert"]').hidden).toBe(false);
});

it('cancelled exports leave no error; empty drawing exports explain the failure', async () => {
  ctrl = await showExcalidraw(host, '', vi.fn(), 'light');
  ctrl.exportImage = vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]) });
  canvas.invoke.mockRejectedValue('cancelled');
  const png = host.querySelector('button[data-tip="Export as PNG"]');
  png.click();
  await vi.waitFor(() => expect(png.disabled).toBe(false));
  expect(host.querySelector('.cvw-chrome [role="alert"]').hidden).toBe(true);
  ctrl.exportImage.mockResolvedValue(null);
  png.click();
  await vi.waitFor(() => expect(host.querySelector('.cvw-chrome [role="alert"]').textContent).toContain('Add a shape'));
});
