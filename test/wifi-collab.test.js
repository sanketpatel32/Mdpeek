import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as wifiCollab from '../src/lib/wifi-collab.js';

describe('wifi-collab.js controller', () => {
  beforeEach(async () => {
    await wifiCollab.stopWifiCollab();
  });

  it('starts Wi-Fi collaboration session and tracks status', async () => {
    const info = await wifiCollab.startWifiCollab({
      title: 'iPad Test Note',
      language: 'markdown',
      content: '# Hello iPad',
    });

    expect(info.active).toBe(true);
    expect(info.ip).toBe('192.168.1.104');
    expect(info.url).toContain('http://192.168.1.104:');

    const status = wifiCollab.getWifiCollabStatus();
    expect(status.active).toBe(true);
    expect(status.url).toBe(info.url);
  });

  it('stops Wi-Fi collaboration session cleanly', async () => {
    await wifiCollab.startWifiCollab({ title: 'Test' });
    expect(wifiCollab.getWifiCollabStatus().active).toBe(true);

    await wifiCollab.stopWifiCollab();
    expect(wifiCollab.getWifiCollabStatus().active).toBe(false);
  });

  it('notifies status change listeners', async () => {
    const listener = vi.fn();
    const unsub = wifiCollab.onWifiStatusChange(listener);

    await wifiCollab.startWifiCollab({ title: 'Listener Test' });
    expect(listener).toHaveBeenCalled();

    unsub();
    listener.mockClear();

    await wifiCollab.stopWifiCollab();
    expect(listener).not.toHaveBeenCalled();
  });

  it('binds and unbinds editor safely', () => {
    const mockTa = {
      value: 'Initial text',
      selectionStart: 0,
      selectionEnd: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const mockEditor = {
      textarea: () => mockTa,
      setValue: vi.fn((val) => { mockTa.value = val; }),
    };

    wifiCollab.bindEditor(mockEditor);
    expect(mockTa.addEventListener).toHaveBeenCalledWith('input', expect.any(Function));

    wifiCollab.unbindEditor();
    expect(mockTa.removeEventListener).toHaveBeenCalledWith('input', expect.any(Function));
  });

  it('binds and unbinds Excalidraw controller', () => {
    const mockCtrl = {
      setCollabHook: vi.fn(),
      clearCollabHook: vi.fn(),
      updateScene: vi.fn(),
    };

    wifiCollab.bindExcalidraw(mockCtrl);
    expect(mockCtrl.setCollabHook).toHaveBeenCalled();

    wifiCollab.unbindExcalidraw();
    expect(mockCtrl.clearCollabHook).toHaveBeenCalled();
  });

  it('provides an in-app companion preview modal without opening external browser tabs', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    expect(html).toContain('id="wifi-open-btn"');
    expect(html).toContain('>In-App Preview</button>');
    expect(html).toContain('id="wifi-preview-dialog"');
    expect(html).toContain('id="wifi-preview-frame"');
    expect(html).toContain('id="wifi-preview-close"');
    // Ensure wifi-open-btn is never wired to open in an external browser
    const mainJs = readFileSync(resolve(__dirname, '../src/main.js'), 'utf8');
    expect(mainJs).not.toMatch(/el\.wifiOpenBtn.*openUrl/);
    expect(mainJs).not.toMatch(/el\.wifiOpenBtn.*window\.open/);
  });
});
