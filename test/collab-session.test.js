import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import * as Y from 'yjs';

const transport = vi.hoisted(() => ({ rooms: [] }));
vi.mock('@trystero-p2p/torrent', () => ({
  joinRoom: () => {
    const actions = Object.fromEntries(['sync', 'meta', 'aware'].map(name => [name, { send: vi.fn().mockResolvedValue(undefined) }]));
    const room = { actions, makeAction: name => actions[name], leave: vi.fn() };
    transport.rooms.push(room);
    return room;
  },
}));
import { startSession, joinSession, endSession, getStatus, bindExcalidraw } from '../src/collab.js';

const roomId = 'ABCDEFGHJKMNPQRS';
beforeEach(() => { vi.useFakeTimers(); transport.rooms = []; });
afterEach(() => { endSession(); vi.useRealTimers(); });

it('plain-text hosts announce a null language and receivers preserve it', async () => {
  const host = startSession('# Plain text', { title: 'plain.txt', language: null });
  expect(host.language).toBeNull();
  transport.rooms[0].onPeerJoin('guest');
  expect(transport.rooms[0].actions.meta.send).toHaveBeenCalledWith({ title: 'plain.txt', language: null }, { target: 'guest' });
  endSession();
  const joined = joinSession(roomId);
  const room = transport.rooms.at(-1);
  const source = new Y.Doc();
  source.getText('content').insert(0, '# Plain text');
  room.actions.sync.onMessage(Y.encodeStateAsUpdate(source), { peerId: 'host' });
  room.actions.meta.onMessage({ title: 'plain.txt', language: null }, { peerId: 'host' });
  expect(await joined).toEqual({ title: 'plain.txt', language: null, initialText: '# Plain text' });
  source.destroy();
});

it('drawing receivers bind and paint the scene that arrived before mounting', async () => {
  const joined = joinSession(roomId);
  const room = transport.rooms[0];
  const source = new Y.Doc();
  const element = new Y.Map(Object.entries({ id: 'rectangle', type: 'rectangle', x: 10 }));
  source.getMap('elements').set('rectangle', element);
  room.actions.sync.onMessage(Y.encodeStateAsUpdate(source), { peerId: 'host' });
  room.actions.meta.onMessage({ title: 'drawing.excalidraw', language: 'excalidraw' }, { peerId: 'host' });
  expect((await joined).language).toBe('excalidraw');
  const controller = { updateScene: vi.fn(), setCollabHook: vi.fn(), clearCollabHook: vi.fn() };
  expect(() => bindExcalidraw(controller)).not.toThrow();
  expect(controller.updateScene).toHaveBeenCalledWith([{ id: 'rectangle', type: 'rectangle', x: 10 }]);
  source.destroy();
});

it('ending a pending join rejects it and cannot later tear down a replacement session', async () => {
  let rejection;
  const pending = joinSession(roomId).catch(error => { rejection = error; });
  endSession();
  await Promise.resolve();
  expect(rejection?.message).toContain('cancelled');
  const replacement = startSession('Replacement');
  await vi.advanceTimersByTimeAsync(5100);
  expect(getStatus().roomId).toBe(replacement.roomId);
  expect(getStatus().active).toBe(true);
  await pending;
});

it('an unreachable host rejects the join and leaves the app ready to retry', async () => {
  const pending = joinSession(roomId).catch(error => error);
  await vi.advanceTimersByTimeAsync(5100);
  expect((await pending).message).toContain('Could not reach the host');
  expect(getStatus().active).toBe(false);
  expect(() => startSession('Retry')).not.toThrow();
});
