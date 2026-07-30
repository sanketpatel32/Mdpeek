import { describe, it, expect, beforeEach } from 'vitest';
import {
  osNotificationsEnabled,
  setOsNotificationsEnabled,
  notifyOs,
  setNotifyPlugin,
} from '../src/lib/notify.js';

// A minimal localStorage shim (Map-backed) + a fake plugin for testing.
function makeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _dump: () => m,
  };
}

function makePlugin({ granted = true, permResult = 'granted', throws = false } = {}) {
  const calls = { isPermissionGranted: 0, requestPermission: 0, sendNotification: 0 };
  return {
    calls,
    async isPermissionGranted() { calls.isPermissionGranted++; return granted; },
    async requestPermission() { calls.requestPermission++; return permResult; },
    sendNotification(opts) { calls.sendNotification++; calls.lastOpts = opts; if (throws) throw new Error('boom'); },
  };
}

describe('osNotificationsEnabled', () => {
  it('defaults to off when the key is unset', () => {
    expect(osNotificationsEnabled(makeStore())).toBe(false);
  });

  it('is on only when explicitly set to "1"', () => {
    const s = makeStore();
    s.setItem('mdpeek-os-notifications', '1');
    expect(osNotificationsEnabled(s)).toBe(true);
  });

  it('is off when set to "0"', () => {
    const s = makeStore();
    s.setItem('mdpeek-os-notifications', '0');
    expect(osNotificationsEnabled(s)).toBe(false);
  });

  it('returns false when storage throws', () => {
    const broken = { getItem() { throw new Error('denied'); } };
    expect(osNotificationsEnabled(broken)).toBe(false);
  });

  it('returns false when store is null', () => {
    expect(osNotificationsEnabled(null)).toBe(false);
  });
});

describe('setOsNotificationsEnabled', () => {
  it('writes "1" when on and "0" when off', () => {
    const s = makeStore();
    setOsNotificationsEnabled(true, s);
    expect(s.getItem('mdpeek-os-notifications')).toBe('1');
    setOsNotificationsEnabled(false, s);
    expect(s.getItem('mdpeek-os-notifications')).toBe('0');
  });

  it('does not throw when storage is unavailable', () => {
    expect(() => setOsNotificationsEnabled(true, null)).not.toThrow();
  });
});

describe('notifyOs', () => {
  beforeEach(() => {
    setNotifyPlugin(null);
  });

  it('returns false (no-op) when the gate is off', async () => {
    const plugin = makePlugin();
    setNotifyPlugin(plugin);
    const store = makeStore(); // gate off by default
    // notifyOs reads the global localStorage; we can't inject the store into
    // notifyOs directly, so verify the gate-off path via the plugin call count
    // by ensuring the real localStorage gate is off for this test.
    const realPrev = localStorage.getItem('mdpeek-os-notifications');
    localStorage.removeItem('mdpeek-os-notifications');
    try {
      const sent = await notifyOs({ title: 'T', body: 'B' });
      expect(sent).toBe(false);
      expect(plugin.calls.sendNotification).toBe(0);
    } finally {
      if (realPrev !== null) localStorage.setItem('mdpeek-os-notifications', realPrev);
    }
  });

  it('sends a notification when enabled + permission already granted', async () => {
    const plugin = makePlugin({ granted: true });
    setNotifyPlugin(plugin);
    const prev = localStorage.getItem('mdpeek-os-notifications');
    localStorage.setItem('mdpeek-os-notifications', '1');
    try {
      const sent = await notifyOs({ title: 'Pomodoro', body: 'Focus complete!' });
      expect(sent).toBe(true);
      expect(plugin.calls.isPermissionGranted).toBe(1);
      expect(plugin.calls.requestPermission).toBe(0); // already granted
      expect(plugin.calls.sendNotification).toBe(1);
      expect(plugin.calls.lastOpts).toEqual({ title: 'Pomodoro', body: 'Focus complete!' });
    } finally {
      if (prev === null) localStorage.removeItem('mdpeek-os-notifications');
      else localStorage.setItem('mdpeek-os-notifications', prev);
    }
  });

  it('requests permission when not yet granted, then sends if approved', async () => {
    const plugin = makePlugin({ granted: false, permResult: 'granted' });
    setNotifyPlugin(plugin);
    const prev = localStorage.getItem('mdpeek-os-notifications');
    localStorage.setItem('mdpeek-os-notifications', '1');
    try {
      const sent = await notifyOs({ title: 'X' });
      expect(sent).toBe(true);
      expect(plugin.calls.requestPermission).toBe(1);
      expect(plugin.calls.sendNotification).toBe(1);
    } finally {
      if (prev === null) localStorage.removeItem('mdpeek-os-notifications');
      else localStorage.setItem('mdpeek-os-notifications', prev);
    }
  });

  it('does not send when permission is denied', async () => {
    const plugin = makePlugin({ granted: false, permResult: 'denied' });
    setNotifyPlugin(plugin);
    const prev = localStorage.getItem('mdpeek-os-notifications');
    localStorage.setItem('mdpeek-os-notifications', '1');
    try {
      const sent = await notifyOs({ title: 'X' });
      expect(sent).toBe(false);
      expect(plugin.calls.sendNotification).toBe(0);
    } finally {
      if (prev === null) localStorage.removeItem('mdpeek-os-notifications');
      else localStorage.setItem('mdpeek-os-notifications', prev);
    }
  });

  it('never throws — swallows plugin errors and returns false', async () => {
    const plugin = makePlugin({ granted: true, throws: true });
    setNotifyPlugin(plugin);
    const prev = localStorage.getItem('mdpeek-os-notifications');
    localStorage.setItem('mdpeek-os-notifications', '1');
    try {
      const sent = await notifyOs({ title: 'X' });
      expect(sent).toBe(false);
    } finally {
      if (prev === null) localStorage.removeItem('mdpeek-os-notifications');
      else localStorage.setItem('mdpeek-os-notifications', prev);
    }
  });

  it('returns false when no plugin is available (non-Tauri)', async () => {
    setNotifyPlugin(null); // no injected plugin + dynamic import will fail in jsdom
    const prev = localStorage.getItem('mdpeek-os-notifications');
    localStorage.setItem('mdpeek-os-notifications', '1');
    try {
      const sent = await notifyOs({ title: 'X' });
      expect(sent).toBe(false);
    } finally {
      if (prev === null) localStorage.removeItem('mdpeek-os-notifications');
      else localStorage.setItem('mdpeek-os-notifications', prev);
    }
  });

  it('uses a default title when none provided', async () => {
    const plugin = makePlugin({ granted: true });
    setNotifyPlugin(plugin);
    const prev = localStorage.getItem('mdpeek-os-notifications');
    localStorage.setItem('mdpeek-os-notifications', '1');
    try {
      await notifyOs({ body: 'b' });
      expect(plugin.calls.lastOpts.title).toBe('mdpeek');
    } finally {
      if (prev === null) localStorage.removeItem('mdpeek-os-notifications');
      else localStorage.setItem('mdpeek-os-notifications', prev);
    }
  });
});
