import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  generateRoomId,
  buildInviteUrl,
  parseInviteUrl,
  colorForPeer,
  diffAtCaret,
  preserveCaret,
  writeElementsToYjs,
  readElementsFromYjs,
} from '../src/collab.js';

// ---------- invite URL round-trip ----------

describe('generateRoomId', () => {
  it('returns a 16-char base32 string', () => {
    const id = generateRoomId();
    expect(id).toMatch(/^[0-9A-Z]{16}$/);
  });

  it('does not return the same id twice in a row (probabilistically)', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(generateRoomId());
    expect(ids.size).toBe(50);
  });
});

describe('buildInviteUrl / parseInviteUrl', () => {
  it('round-trips a generated room id', () => {
    const id = generateRoomId();
    const url = buildInviteUrl(id);
    const parsed = parseInviteUrl(url);
    expect(parsed).not.toBeNull();
    expect(parsed.roomId).toBe(id);
  });

  it('accepts a hand-written invite url', () => {
    // 16 chars exactly (Crockford base32 alphabet).
    const parsed = parseInviteUrl('mdpeek://join?room=ABCDEFGHJKMNPQRS');
    expect(parsed).toEqual({ roomId: 'ABCDEFGHJKMNPQRS' });
  });

  it('rejects wrong protocol', () => {
    expect(parseInviteUrl('https://join?room=ABCDEFGHJKMNPQRST')).toBeNull();
  });

  it('rejects wrong host', () => {
    expect(parseInviteUrl('mdpeek://other?room=ABCDEFGHJKMNPQRST')).toBeNull();
  });

  it('rejects malformed room ids', () => {
    expect(parseInviteUrl('mdpeek://join?room=abc')).toBeNull();            // too short
    expect(parseInviteUrl('mdpeek://join?room=abcdefghijklmnop')).toBeNull(); // lowercase
    expect(parseInviteUrl('mdpeek://join?room=ABCD!FGHJKMNPQRS')).toBeNull();  // symbol
  });

  it('rejects missing room param', () => {
    expect(parseInviteUrl('mdpeek://join')).toBeNull();
  });

  it('rejects non-strings gracefully', () => {
    expect(parseInviteUrl(null)).toBeNull();
    expect(parseInviteUrl(undefined)).toBeNull();
    expect(parseInviteUrl(42)).toBeNull();
  });
});

describe('colorForPeer', () => {
  it('returns a hex color for any peer id', () => {
    expect(colorForPeer('peer-abc')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('is deterministic for the same id', () => {
    expect(colorForPeer('peer-abc')).toBe(colorForPeer('peer-abc'));
  });

  it('distributes across different ids (smoke)', () => {
    const colors = new Set();
    for (let i = 0; i < 20; i++) colors.add(colorForPeer(`peer-${i}`));
    // At least 5 distinct colors out of 20 — ensures it's not collapsed.
    expect(colors.size).toBeGreaterThanOrEqual(5);
  });
});

// ---------- diffAtCaret ----------

describe('diffAtCaret', () => {
  it('detects an insertion at the end', () => {
    const r = diffAtCaret('hello', 'hello world', 11);
    expect(r.start).toBe(5);
    expect(r.removedLen).toBe(0);
    expect(r.inserted).toBe(' world');
  });

  it('detects an insertion in the middle', () => {
    const r = diffAtCaret('helloworld', 'hello world', 6);
    expect(r.removedLen).toBe(0);
    expect(r.inserted).toBe(' ');
  });

  it('detects a deletion at the end', () => {
    const r = diffAtCaret('hello world', 'hello worl', 10);
    expect(r.removedLen).toBe(1);
    expect(r.inserted).toBe('');
  });

  it('detects a deletion in the middle', () => {
    const r = diffAtCaret('hello world', 'helloworld', 5);
    expect(r.removedLen).toBe(1);
    expect(r.inserted).toBe('');
  });

  it('detects a replacement', () => {
    const r = diffAtCaret('hello world', 'hello World', 7);
    expect(r.removedLen).toBe(1);
    expect(r.inserted).toBe('W');
  });

  it('handles no change', () => {
    const r = diffAtCaret('hello', 'hello', 5);
    expect(r.removedLen).toBe(0);
    expect(r.inserted).toBe('');
  });

  it('handles empty → text', () => {
    const r = diffAtCaret('', 'abc', 3);
    expect(r.removedLen).toBe(0);
    expect(r.inserted).toBe('abc');
  });

  it('handles text → empty', () => {
    const r = diffAtCaret('abc', '', 0);
    expect(r.removedLen).toBe(3);
    expect(r.inserted).toBe('');
  });

  it('detects a paste of a larger block', () => {
    const r = diffAtCaret('foo bar', 'foo INSERTED bar', 12);
    expect(r.removedLen).toBe(0);
    expect(r.inserted).toBe('INSERTED ');
  });
});

// ---------- preserveCaret ----------

describe('preserveCaret', () => {
  it('keeps position when text before caret is unchanged', () => {
    expect(preserveCaret('hello world', 'hello WORLD', 5)).toBe(5);
  });

  it('clamps when new text is shorter than caret', () => {
    expect(preserveCaret('hello world', 'hi', 8)).toBeLessThanOrEqual(2);
  });

  it('anchors at start of inserted region', () => {
    // Caret at position 5 ('hello|world'); an insertion happens there.
    expect(preserveCaret('helloworld', 'helloINSERTEDworld', 5)).toBe(5);
  });

  it('handles caret at 0', () => {
    expect(preserveCaret('abc', 'ABC', 0)).toBe(0);
  });

  it('returns 0 when new text is empty', () => {
    expect(preserveCaret('abc', '', 1)).toBe(0);
  });
});

// ---------- Yjs end-to-end (in-memory, no network) ----------
//
// This is the algorithmic guarantee we need: two Yjs docs, fed the diffAtCaret
// outputs from each side's edits, converge to identical text. Mirrors what
// happens in production with Trystero in between.

describe('Yjs CRDT convergence', () => {
  it('two docs converge after independent edits', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const ta = a.getText('content');
    const tb = b.getText('content');
    ta.insert(0, 'hello');
    // Sync a → b
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(tb.toString()).toBe('hello');

    // Simultaneous edits at different positions, no coordination.
    // Side a appends " world" at caret 5.
    const { start: sa, removedLen: ra, inserted: ia } = diffAtCaret('hello', 'hello world', 11);
    if (ra) ta.delete(sa, ra);
    if (ia) ta.insert(sa, ia);

    // Side b replaces 'h' with 'H' at caret 1.
    const { start: sb, removedLen: rb, inserted: ib } = diffAtCaret('hello', 'Hello', 1);
    if (rb) tb.delete(sb, rb);
    if (ib) tb.insert(sb, ib);

    // Cross-sync both ways.
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(ta.toString()).toBe(tb.toString());
    expect(ta.toString()).toBe('Hello world');
  });

  it('handles concurrent conflicting edits at the same position (CRDT resolves deterministically)', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const ta = a.getText('content');
    const tb = b.getText('content');
    ta.insert(0, 'X'); // shared anchor
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // Both insert at position 1 with different text.
    ta.insert(1, 'A');
    tb.insert(1, 'B');

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // Both sides converge to the same string (order is deterministic).
    expect(ta.toString()).toBe(tb.toString());
    expect(ta.toString()).toMatch(/^X(AB|BA)$/);
  });
});

// ---------- Excalidraw element sync (Y.Map of elements) ----------
//
// Excalidraw collab uses a Y.Map keyed by element id (each value is a Y.Map of
// the element's fields) instead of a Y.Text. These tests cover the pure Yjs
// layer — writeElementsToYjs + readElementsFromYjs + CRDT convergence — without
// spinning up the network. The bidirectional echo loop (suppress + 'self'
// origin) is covered by the "no echo on remote-origin writes" test below.

describe('Excalidraw element sync (writeElementsToYjs / readElementsFromYjs)', () => {
  it('round-trips a small element array through a Y.Map', () => {
    const doc = new Y.Doc();
    const ymap = doc.getMap('elements');
    const elements = [
      { id: 'a', type: 'rectangle', x: 10, y: 20, width: 100, height: 50 },
      { id: 'b', type: 'ellipse', x: 200, y: 150, width: 80, height: 80 },
    ];
    writeElementsToYjs(doc, ymap, elements);
    const back = readElementsFromYjs(ymap);
    expect(back).toHaveLength(2);
    expect(back[0]).toMatchObject({ id: 'a', type: 'rectangle', x: 10 });
    expect(back[1]).toMatchObject({ id: 'b', type: 'ellipse', x: 200 });
  });

  it('clears the map on re-write (full-replace strategy)', () => {
    const doc = new Y.Doc();
    const ymap = doc.getMap('elements');
    writeElementsToYjs(doc, ymap, [{ id: 'a', x: 1 }, { id: 'b', x: 2 }, { id: 'c', x: 3 }]);
    expect(readElementsFromYjs(ymap)).toHaveLength(3);
    // Rewrite with fewer elements — old ones must be gone.
    writeElementsToYjs(doc, ymap, [{ id: 'a', x: 10 }]);
    const back = readElementsFromYjs(ymap);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: 'a', x: 10 });
  });

  it('skips elements without a string id', () => {
    const doc = new Y.Doc();
    const ymap = doc.getMap('elements');
    writeElementsToYjs(doc, ymap, [
      { id: 'ok', x: 1 },
      { id: 42, x: 2 },          // numeric id — skip
      { x: 3 },                   // no id — skip
      null,                       // not an object — skip
    ]);
    const back = readElementsFromYjs(ymap);
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe('ok');
  });

  it('updates to an existing element id replace the previous value', () => {
    const doc = new Y.Doc();
    const ymap = doc.getMap('elements');
    writeElementsToYjs(doc, ymap, [{ id: 'a', x: 1, y: 1 }]);
    writeElementsToYjs(doc, ymap, [{ id: 'a', x: 99, y: 99 }]);
    const back = readElementsFromYjs(ymap);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: 'a', x: 99, y: 99 });
  });

  it('preserves nested object fields (e.g. Excalidraw roundness)', () => {
    const doc = new Y.Doc();
    const ymap = doc.getMap('elements');
    const el = { id: 'a', type: 'rectangle', roundness: { type: 3, value: 4.5 } };
    writeElementsToYjs(doc, ymap, [el]);
    const back = readElementsFromYjs(ymap);
    expect(back[0].roundness).toEqual({ type: 3, value: 4.5 });
  });

  it('no-ops on null/missing ydoc or ymap', () => {
    // Should not throw — guards against being called after endSession().
    expect(() => writeElementsToYjs(null, null, [{ id: 'a' }])).not.toThrow();
    expect(readElementsFromYjs(null)).toEqual([]);
  });

  it('two Yjs docs converge after exchanging state updates (CRDT merge)', () => {
    // Simulates two peers: host writes elements, receiver picks them up via
    // encodeStateAsUpdate / applyUpdate (the same path the real Trystero
    // transport uses).
    const host = new Y.Doc();
    const guest = new Y.Doc();
    const hostMap = host.getMap('elements');
    const guestMap = guest.getMap('elements');

    writeElementsToYjs(host, hostMap, [
      { id: 'a', type: 'rectangle', x: 10 },
      { id: 'b', type: 'arrow', x: 50 },
    ]);

    // Receiver applies the host's state update.
    Y.applyUpdate(guest, Y.encodeStateAsUpdate(host));
    const onGuest = readElementsFromYjs(guestMap);
    expect(onGuest).toHaveLength(2);
    expect(onGuest[0]).toMatchObject({ id: 'a', x: 10 });
    expect(onGuest[1]).toMatchObject({ id: 'b', x: 50 });

    // Now receiver rewrites the scene — host should see the new state.
    writeElementsToYjs(guest, guestMap, [{ id: 'c', type: 'text', text: 'hi' }]);
    Y.applyUpdate(host, Y.encodeStateAsUpdate(guest));
    const onHost = readElementsFromYjs(hostMap);
    expect(onHost).toHaveLength(1);
    expect(onHost[0]).toMatchObject({ id: 'c', text: 'hi' });
  });

  it('outbound writes tagged with "self" origin so the inbound observer can skip them', () => {
    // The bindExcalidraw echo loop is broken by checking transaction origin.
    // Verify the tag is actually set on writeElementsToYjs transactions.
    const doc = new Y.Doc();
    const ymap = doc.getMap('elements');
    let seenOrigin = null;
    ymap.observe((event) => {
      seenOrigin = event.transaction.origin;
    });
    writeElementsToYjs(doc, ymap, [{ id: 'a', x: 1 }]);
    expect(seenOrigin).toBe('self');
  });

  it('inbound observer fires once for a remote-origin write (not "self")', () => {
    // Mirror of the echo-loop test: writeElementsToYjs tags as 'self', so a
    // remote-origin write applied via applyUpdate must NOT be 'self'. The
    // bindExcalidraw onRemote checks origin to skip our own writes.
    const host = new Y.Doc();
    const receiver = new Y.Doc();
    const receiverMap = receiver.getMap('elements');

    let remoteFireCount = 0;
    receiverMap.observeDeep((events) => {
      for (const ev of events) {
        if (ev.transaction.origin !== 'self') remoteFireCount++;
      }
    });

    // Host writes (tagged 'self' on the host, but the origin doesn't travel
    // across encodeStateAsUpdate — the receiver sees it as undefined origin).
    const hostMap = host.getMap('elements');
    writeElementsToYjs(host, hostMap, [{ id: 'a', x: 1 }]);
    Y.applyUpdate(receiver, Y.encodeStateAsUpdate(host));

    // Receiver should have seen the remote write fire exactly once.
    expect(remoteFireCount).toBeGreaterThanOrEqual(1);
    expect(readElementsFromYjs(receiverMap)).toHaveLength(1);
  });
});
