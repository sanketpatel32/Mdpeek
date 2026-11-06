// ---------- Local Wi-Fi Collaboration for iPad & mobile devices ----------
//
// Allows an iPad (or any device on the same local Wi-Fi) to join live editing
// and drawing sessions via Safari by scanning a QR code or entering a local URL.
// Backed by the lightweight embedded Rust HTTP/SSE server in src-tauri/src/wifi_collab.rs.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

let isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);

let status = {
  active: false,
  ip: '',
  port: 0,
  url: '',
  peerCount: 0,
};

const listeners = new Set();
let unlistenInbound = null;
let unlistenPeers = null;

let boundEditor = null;
let boundEditorCleanup = null;
let boundExcalidraw = null;
let boundExcalidrawCleanup = null;
let isApplyingRemote = false;

function emit() {
  const current = getWifiCollabStatus();
  for (const cb of listeners) {
    try {
      cb(current);
    } catch (e) {
      console.error('[wifi-collab] listener error:', e);
    }
  }
}

export function onWifiStatusChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getWifiCollabStatus() {
  return { ...status };
}

async function invokeTauri(cmd, args = {}) {
  if (isTauri) {
    return invoke(cmd, args);
  }
  // Mock fallback for browser dev mode and unit tests
  if (cmd === 'start_wifi_collab') {
    return {
      active: true,
      ip: '192.168.1.104',
      port: args.port || 4789,
      url: `http://192.168.1.104:${args.port || 4789}`,
      peer_count: 0,
    };
  }
  if (cmd === 'stop_wifi_collab') return;
  if (cmd === 'get_wifi_collab_status') {
    return {
      active: status.active,
      ip: status.ip || '192.168.1.104',
      port: status.port || 4789,
      url: status.url || 'http://192.168.1.104:4789',
      peer_count: status.peerCount,
    };
  }
  if (cmd === 'update_wifi_collab_doc' || cmd === 'sync_wifi_collab_outbound') return;
  return null;
}

export async function startWifiCollab({ title = 'Shared Note', language = 'markdown', content = '', elements = null, port = 4789 } = {}) {
  try {
    const info = await invokeTauri('start_wifi_collab', { port });
    status = {
      active: true,
      ip: info.ip,
      port: info.port,
      url: info.url,
      peerCount: info.peer_count || 0,
    };

    // Update document payload on server
    await invokeTauri('update_wifi_collab_doc', {
      title,
      language,
      content,
      elements: elements || [],
    });

    // Listen for inbound edits and peer updates from the Rust server
    if (isTauri) {
      if (!unlistenInbound) {
        unlistenInbound = await listen('wifi-collab-inbound', (event) => {
          handleInboundEdit(event.payload);
        });
      }

      if (!unlistenPeers) {
        unlistenPeers = await listen('wifi-collab-peers', (event) => {
          status.peerCount = Number(event.payload) || 0;
          emit();
        });
      }
    }

    emit();
    return getWifiCollabStatus();
  } catch (err) {
    status.active = false;
    emit();
    throw err;
  }
}

export async function stopWifiCollab() {
  try {
    await invokeTauri('stop_wifi_collab');
  } catch { /* ignore */ }

  status = {
    active: false,
    ip: '',
    port: 0,
    url: '',
    peerCount: 0,
  };

  unbindEditor();
  unbindExcalidraw();

  if (unlistenInbound) {
    try { unlistenInbound(); } catch {}
    unlistenInbound = null;
  }
  if (unlistenPeers) {
    try { unlistenPeers(); } catch {}
    unlistenPeers = null;
  }

  emit();
}

export async function pushOutboundDocUpdate({ title, language, content, elements }) {
  if (!status.active) return;
  await invokeTauri('update_wifi_collab_doc', {
    title: title || 'Shared Note',
    language: language || 'markdown',
    content: content || '',
    elements: elements || [],
  });
}

// Inbound edit from iPad (via SSE/POST on Rust server)
const inboundListeners = new Set();
export function onInboundEdit(cb) {
  inboundListeners.add(cb);
  return () => inboundListeners.delete(cb);
}

function handleInboundEdit(payload) {
  if (!payload || !payload.type) return;

  for (const cb of inboundListeners) {
    try { cb(payload); } catch (e) { console.error('[wifi-collab] inbound listener error:', e); }
  }

  if (payload.type === 'text' && boundEditor) {
    if (typeof payload.content === 'string') {
      applyRemoteText(payload.content, payload.caret);
    }
  } else if (payload.type === 'canvas' && boundExcalidraw) {
    if (Array.isArray(payload.elements)) {
      applyRemoteCanvas(payload.elements);
    }
  }
}

function applyRemoteText(newText, remoteCaret) {
  if (!boundEditor || isApplyingRemote) return;
  const ta = boundEditor.textarea();
  if (ta.value === newText) return;

  isApplyingRemote = true;
  const caret = ta.selectionStart;
  boundEditor.setValue(newText);
  try {
    ta.selectionStart = Math.min(caret, newText.length);
    ta.selectionEnd = Math.min(caret, newText.length);
  } catch {}
  isApplyingRemote = false;
}

function applyRemoteCanvas(elements) {
  if (!boundExcalidraw || isApplyingRemote) return;
  isApplyingRemote = true;
  try {
    if (typeof boundExcalidraw.updateScene === 'function') {
      boundExcalidraw.updateScene(elements);
    }
  } catch (err) {
    console.error('[wifi-collab] canvas updateScene error:', err);
  }
  isApplyingRemote = false;
}

// ---------- Editor Binding ----------
export function bindEditor(editor) {
  if (boundEditor === editor) return;
  unbindEditor();
  if (!editor || typeof editor.textarea !== 'function') return;

  const ta = editor.textarea();
  let syncTimer = null;

  function onInput() {
    if (isApplyingRemote || !status.active) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const content = ta.value;
      const caret = ta.selectionStart;
      const selection_end = ta.selectionEnd;
      invokeTauri('sync_wifi_collab_outbound', {
        payload: {
          type: 'text_change',
          content,
          caret,
          selection_end,
        },
      }).catch(() => {});
    }, 20);
  }

  ta.addEventListener('input', onInput);

  boundEditor = editor;
  boundEditorCleanup = () => {
    clearTimeout(syncTimer);
    ta.removeEventListener('input', onInput);
  };
}

export function unbindEditor() {
  if (boundEditorCleanup) {
    boundEditorCleanup();
    boundEditorCleanup = null;
    boundEditor = null;
  }
}

// ---------- Excalidraw Canvas Binding ----------
export function bindExcalidraw(ctrl) {
  if (boundExcalidraw === ctrl) return;
  unbindExcalidraw();
  if (!ctrl) return;

  let canvasTimer = null;
  function onLocalCanvasChange(elements) {
    if (isApplyingRemote || !status.active) return;
    clearTimeout(canvasTimer);
    canvasTimer = setTimeout(() => {
      invokeTauri('sync_wifi_collab_outbound', {
        payload: {
          type: 'canvas_change',
          elements,
        },
      }).catch(() => {});
    }, 25);
  }

  if (typeof ctrl.setCollabHook === 'function') {
    ctrl.setCollabHook(onLocalCanvasChange);
  }

  boundExcalidraw = ctrl;
  boundExcalidrawCleanup = () => {
    clearTimeout(canvasTimer);
    if (typeof ctrl.clearCollabHook === 'function') {
      ctrl.clearCollabHook();
    }
  };
}

export function unbindExcalidraw() {
  if (boundExcalidrawCleanup) {
    boundExcalidrawCleanup();
    boundExcalidrawCleanup = null;
    boundExcalidraw = null;
  }
}
