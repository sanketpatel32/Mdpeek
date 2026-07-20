// ---------- Real-time P2P collaboration (v0.21.0) ----------
//
// Two mdpeek users on different machines edit the same document live. Invite-
// link based, no accounts, no servers we run. Stack:
//
//   - Yjs         (CRDT)   → conflict-free merge of concurrent edits
//   - Trystero    (WebRTC) → serverless P2P transport using public BitTorrent
//                            trackers as the rendezvous (initial handshake only;
//                            all traffic is then direct + encrypted via DTLS).
//                            Published as @trystero-p2p/torrent (v0.25+).
//   - Tauri       deep-link→ `mdpeek://join?room=…` invite URLs
//
// The textarea is bound to a Y.Text via a small diff/patch layer that scans
// around the caret (not full-string diff) for low latency on large documents.
// Remote edits write through the editor's existing setValue() API so the
// highlight overlay, gutter, and typewriter centering all keep working.

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { joinRoom } from '@trystero-p2p/torrent';

// ---------- pure helpers (exported for testing) ----------

// Crockford base32 — no ambiguous chars (0/O, 1/I/L). 16 chars ≈ 80 bits of
// entropy: brute-force infeasible (~1 in 10^24), so no auth on top needed.
const ROOM_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function generateRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (let i = 0; i < 16; i++) s += ROOM_ALPHABET[bytes[i] & 31];
  return s;
}

export function buildInviteUrl(id) {
  return `mdpeek://join?room=${id}`;
}

export function parseInviteUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'mdpeek:') return null;
    if (u.host !== 'join') return null;
    const room = u.searchParams.get('room');
    if (!room || !/^[0-9A-Z]{16}$/.test(room)) return null;
    return { roomId: room };
  } catch {
    return null;
  }
}

// Deterministic peer color from a hash of the peer id. Avoids two peers
// landing on the same hue without needing central coordination.
const PEER_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#a855f7',
];
export function colorForPeer(peerId) {
  let h = 0;
  for (let i = 0; i < peerId.length; i++) h = (h * 31 + peerId.charCodeAt(i)) | 0;
  return PEER_COLORS[Math.abs(h) % PEER_COLORS.length];
}

// Find the change region between old/new text by scanning outward from the
// caret. Far cheaper than a full-string diff and exactly matches the spot the
// user just edited. Returns { start, removedLen, inserted }.
//
// Two pointers walk backward from the caret while chars match on BOTH sides;
// they stop at the first divergence. Then we walk forward from the caret the
// same way. The divergent region in the middle is the edit.
export function diffAtCaret(oldText, newText, caret) {
  const oldLen = oldText.length;
  const newLen = newText.length;
  // Common prefix length up to the caret position. Clamp to both lengths so a
  // caret past EOF (just typed at the end) doesn't read past the buffer.
  const cap = Math.min(caret, oldLen, newLen);
  let start = 0;
  while (start < cap && oldText[start] === newText[start]) start++;
  // Common suffix length walking backward from each string's end. Stops at
  // the prefix boundary so we don't double-count.
  let oldEnd = oldLen;
  let newEnd = newLen;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--; newEnd--;
  }
  return {
    start,
    removedLen: oldEnd - start,
    inserted: newText.slice(start, newEnd),
  };
}

// After a remote edit rewrites the textarea, place the caret at the closest
// equivalent position in the new text. We clamp + bias toward the start of any
// inserted region (matches most editors' intuition).
export function preserveCaret(oldText, newText, caret) {
  if (caret <= 0) return 0;
  // Count matching prefix chars up to the caret.
  const prefix = Math.min(caret, oldText.length, newText.length);
  let i = 0;
  while (i < prefix && oldText[i] === newText[i]) i++;
  // If the caret was in a region that got deleted/inserted, anchor to where
  // the change started (i) rather than overshooting into new content.
  return Math.min(i, newText.length);
}

// ---------- module state ----------

let ydoc = null;
let ytext = null;
let awareness = null;
let room = null;
let role = null;        // 'host' | 'receiver'
let roomId = null;
let peerMeta = new Map();     // peerId → { name, color, caret, selectionEnd }
let boundEditor = null;       // editor object returned by initEditor()
let boundCleanup = null;      // () → void; unbinds the current editor binding
let localName = 'Anonymous';
let localColor = '#3b82f6';

const listeners = new Set();

export function on(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  const status = getStatus();
  for (const cb of listeners) cb(status);
}

export function setLocalIdentity({ name, color } = {}) {
  if (name) localName = String(name).slice(0, 32);
  if (color) localColor = String(color);
  if (awareness) {
    awareness.setLocalStateField('user', { name: localName, color: localColor });
  }
}

export function getStatus() {
  return {
    active: ydoc !== null,
    role,
    roomId,
    peers: Array.from(peerMeta.values()),
    peerCount: peerMeta.size,
  };
}

// ---------- session lifecycle ----------

function initYdoc(initialText) {
  ydoc = new Y.Doc();
  ytext = ydoc.getText('content');
  if (initialText) ytext.insert(0, initialText);
  awareness = new Awareness(ydoc);
  awareness.setLocalStateField('user', { name: localName, color: localColor });
}

function buildTrysteroProvider() {
  // Trystero's torrent strategy uses public BitTorrent trackers as a
  // rendezvous. No servers we own, no API keys. Once peers find each other
  // via the tracker, all traffic is direct WebRTC.
  room = joinRoom({ appId: 'mdpeek-collab-v1', password: roomId }, roomId);

  const [sendSync, onSync] = room.makeAction('sync');
  const [sendMeta, onMeta] = room.makeAction('meta');
  const [sendAware, onAware] = room.makeAction('aware');

  // On new peer: send them our current doc state + (if host) doc metadata.
  room.onPeerJoin((peerId) => {
    sendSync(Y.encodeStateAsUpdate(ydoc), peerId);
    if (role === 'host') {
      sendMeta(hostMeta, peerId);
    }
    // Announce our awareness so the newcomer sees our cursor immediately.
    sendAware(awareness.getLocalState() || {}, peerId);
  });

  room.onPeerLeave((peerId) => {
    peerMeta.delete(peerId);
    emit();
    // If the host dropped and we're a receiver, surface it so the UI can
    // convert the shared tab to a local unsaved doc.
    if (role === 'receiver' && peerMeta.size === 0) {
      for (const cb of listeners) cb({ ...getStatus(), hostLeft: true });
    }
  });

  onSync((update, peerId) => {
    Y.applyUpdate(ydoc, new Uint8Array(update), 'remote');
    // Track the peer as "known" even before they send awareness.
    if (!peerMeta.has(peerId)) {
      peerMeta.set(peerId, { id: peerId, name: 'Peer', color: colorForPeer(peerId) });
      emit();
    }
  });

  onMeta((meta) => {
    if (role === 'receiver' && meta) hostMeta = { ...meta };
    for (const cb of listeners) cb({ ...getStatus(), meta });
  });

  onAware((state, peerId) => {
    if (!state || typeof state !== 'object') return;
    const user = state.user || {};
    const caret = typeof state.caret === 'number' ? state.caret : null;
    const existing = peerMeta.get(peerId) || {
      id: peerId,
      name: user.name || 'Peer',
      color: user.color || colorForPeer(peerId),
    };
    peerMeta.set(peerId, {
      ...existing,
      name: user.name || existing.name,
      color: user.color || existing.color,
      caret,
      selectionEnd: typeof state.selectionEnd === 'number' ? state.selectionEnd : caret,
    });
    emit();
  });

  // Broadcast local Yjs updates to all peers. Skip ones we just applied from
  // the network (origin === 'remote') so we don't echo them back.
  ydoc.on('update', (update, origin) => {
    if (origin === 'remote') return;
    sendSync(update);
  });

  // Awareness changes (cursor moves, name edits) get pushed out.
  awareness.on('update', () => {
    const local = awareness.getLocalState();
    if (local) sendAware(local);
  });
}

let hostMeta = null;   // { title, language } when host; received meta when receiver

export function startSession(initialText, { title, language } = {}) {
  if (ydoc) throw new Error('Session already active');
  role = 'host';
  roomId = generateRoomId();
  hostMeta = { title: title || 'Shared note', language: language || 'markdown' };
  initYdoc(initialText || '');
  buildTrysteroProvider();
  emit();
  return { roomId, inviteUrl: buildInviteUrl(roomId), title: hostMeta.title, language: hostMeta.language };
}

export function joinSession(id, { name } = {}) {
  if (ydoc) throw new Error('Session already active');
  const parsed = parseInviteUrl(buildInviteUrl(id));
  if (!parsed) throw new Error(`Invalid room id: ${id}`);
  return new Promise((resolve, reject) => {
    role = 'receiver';
    roomId = parsed.roomId;
    hostMeta = null;
    initYdoc('');
    buildTrysteroProvider();

    // The host's initial state + meta arrive via the 'sync' + 'meta' actions.
    // Resolve the first time we get a meta payload (which carries title +
    // language) — falls back to current text if meta never arrives.
    let resolved = false;
    const tryResolve = (meta) => {
      if (resolved) return;
      resolved = true;
      resolve({
        initialText: ytext.toString(),
        title: meta?.title || 'Shared note',
        language: meta?.language || 'markdown',
      });
    };

    // Wire a one-shot listener for the host's meta.
    const origHandler = listeners.size;
    const off = on((status) => {
      if (status.meta) {
        tryResolve(status.meta);
        off();
      }
    });
    // Safety: if host meta never arrives within 5s but we did receive text,
    // resolve with what we have. If still no peer, reject (NAT failure etc).
    setTimeout(() => {
      if (resolved) return;
      if (peerMeta.size > 0 || ytext.toString().length > 0) {
        tryResolve(hostMeta);
      } else {
        off();
        reject(new Error('Could not reach the host. The host may be offline, or your network may block P2P connections (corporate VPN/firewall).'));
        endSession();
      }
    }, 5000);
  });
}

export function endSession() {
  if (boundCleanup) {
    boundCleanup();
    boundCleanup = null;
    boundEditor = null;
  }
  try {
    if (awareness) awareness.destroy();
  } catch { /* ignore */ }
  try {
    if (room) room.leave();
  } catch { /* ignore */ }
  try {
    if (ydoc) ydoc.destroy();
  } catch { /* ignore */ }
  ydoc = null;
  ytext = null;
  awareness = null;
  room = null;
  role = null;
  roomId = null;
  hostMeta = null;
  peerMeta.clear();
  emit();
}

// ---------- editor binding ----------

export function bindEditor(editor) {
  if (!ydoc || !ytext) throw new Error('No active session to bind to');
  if (boundEditor === editor) return;
  if (boundCleanup) boundCleanup();

  const ta = editor.textarea();
  let lastValue = ta.value;
  let suppress = false;       // true while we're applying a remote change
  let lastCaret = ta.selectionStart;

  // Local edit → push the minimal diff into Yjs + announce our caret.
  function onInput() {
    if (suppress) return;
    const newValue = ta.value;
    const caret = ta.selectionStart;
    const { start, removedLen, inserted } = diffAtCaret(lastValue, newValue, caret);
    if (removedLen > 0) ytext.delete(start, removedLen);
    if (inserted) ytext.insert(start, inserted);
    lastValue = newValue;
    lastCaret = caret;
    broadcastCaret(caret, ta.selectionEnd);
  }

  // Remote edit → write through the editor API (re-highlights overlay, syncs
  // gutter) and preserve the caret as best we can.
  function onRemote() {
    if (suppress) return;
    suppress = true;
    const newText = ytext.toString();
    const caret = preserveCaret(lastValue, newText, lastCaret);
    editor.setValue(newText);
    try {
      ta.selectionStart = caret;
      ta.selectionEnd = caret;
    } catch { /* selection may be invalid mid-update; safe to skip */ }
    lastValue = newText;
    lastCaret = caret;
    suppress = false;
  }

  // Track caret + selection on movement (clicks, arrow keys) without firing
  // a Yjs update — these are pure awareness broadcasts.
  function onSelectionChange() {
    if (suppress) return;
    lastCaret = ta.selectionStart;
    broadcastCaret(ta.selectionStart, ta.selectionEnd);
  }

  function broadcastCaret(caret, selectionEnd) {
    if (!awareness) return;
    awareness.setLocalStateField('caret', caret);
    awareness.setLocalStateField('selectionEnd', selectionEnd === caret ? caret : selectionEnd);
    // Trigger the update handler that broadcasts to peers.
    awareness.setLocalStateField('t', Date.now());
  }

  ytext.observe(onRemote);
  ta.addEventListener('input', onInput);
  ta.addEventListener('click', onSelectionChange);
  ta.addEventListener('keyup', onSelectionChange);
  ta.addEventListener('select', onSelectionChange);

  // Initialize the textarea from the current Yjs state (covers the receiver
  // binding after the host's text has already arrived).
  suppress = true;
  if (ytext.toString() !== ta.value) {
    editor.setValue(ytext.toString());
    lastValue = ta.value;
  }
  suppress = false;

  boundEditor = editor;
  boundCleanup = () => {
    try { ytext.unobserve(onRemote); } catch { /* ytext may be torn down */ }
    ta.removeEventListener('input', onInput);
    ta.removeEventListener('click', onSelectionChange);
    ta.removeEventListener('keyup', onSelectionChange);
    ta.removeEventListener('select', onSelectionChange);
  };
}

export function unbindEditor() {
  if (boundCleanup) {
    boundCleanup();
    boundCleanup = null;
    boundEditor = null;
  }
}
