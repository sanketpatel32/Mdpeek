// v0.51.0: Thin, fail-safe wrapper around @tauri-apps/plugin-notification.
//
// Centralizes the OS-notification opt-in gate + permission flow so the rest of
// the app never imports the plugin directly. The plugin call is behind an
// injectable boundary (setNotifyPlugin) so the unit tests can stub it without
// touching localStorage or the real OS.
//
// Design: opt-in. OS notifications default OFF (mdpeek-os-notifications) so a
// fresh install never surprises the user with a permission prompt. When the
// gate is on, notifyOs requests permission on first use + sends; it never
// throws — failures (plugin unavailable in dev/browser, permission denied)
// resolve to false so callers fall back to an in-app toast.

const NOTIFY_KEY = 'mdpeek-os-notifications';

// The real plugin module is imported lazily (dynamic import) so this file has
// no static dependency on it — tests + non-Tauri environments load fine. The
// injected plugin (if set) takes precedence, which is how tests stub it.
let _injected = null;

// Inject a fake plugin (for tests). Shape:
//   { isPermissionGranted(): Promise<bool>, requestPermission(): Promise<string>, sendNotification(opts): void }
export function setNotifyPlugin(plugin) {
  _injected = plugin || null;
}

// Read the opt-in gate. Default OFF (null/undefined → false). ON only when the
// setting is explicitly '1'. `store` defaults to localStorage; injectable.
export function osNotificationsEnabled(store = globalThis.localStorage) {
  try {
    return !!(store && store.getItem(NOTIFY_KEY) === '1');
  } catch {
    return false; // localStorage unavailable (private mode) → treat as off
  }
}

// Set the gate (used by the settings toggle). `store` defaults to localStorage.
export function setOsNotificationsEnabled(on, store = globalThis.localStorage) {
  try {
    if (store) store.setItem(NOTIFY_KEY, on ? '1' : '0');
  } catch { /* storage unavailable — ignore */ }
}

// Load the plugin module (injected or real). Returns null if unavailable.
async function loadPlugin() {
  if (_injected) return _injected;
  try {
    return await import('@tauri-apps/plugin-notification');
  } catch {
    return null; // not in Tauri (dev/browser) — degrade silently
  }
}

// Send an OS notification if the gate is on + permission is granted.
// Resolves to true if a notification was actually sent, false otherwise
// (gate off, plugin missing, or permission denied). Never rejects.
export async function notifyOs({ title, body } = {}) {
  if (!osNotificationsEnabled()) return false;
  const plugin = await loadPlugin();
  if (!plugin) return false;
  try {
    let granted = await plugin.isPermissionGranted();
    if (!granted) {
      const perm = await plugin.requestPermission();
      granted = perm === 'granted';
    }
    if (!granted) return false;
    plugin.sendNotification({ title: title || 'mdpeek', body: body || '' });
    return true;
  } catch {
    return false; // any plugin error → swallow, caller falls back to toast
  }
}
