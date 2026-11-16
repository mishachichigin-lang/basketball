import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from './gameRoom.ts';
import { normalizeRoomCode } from '../src/shared/protocol.ts';

test('GameRoom adds members, assigns teams for PvP 1v1 and Co-op 2v2, and starts match', () => {
  const room = new GameRoom('4829', 'pvp1v1');
  const host = room.addMember('p1', 'Миша', 'akashi');
  const guest = room.addMember('p2', 'Кентик', 'aomine');

  assert.equal(host.isHost, true);
  assert.equal(host.team, 'home');
  assert.equal(guest.isHost, false);
  assert.equal(guest.team, 'away');

  // Host switches to coop2v2
  room.updateMemberProfile('p1', { modeType: 'coop2v2' });
  assert.equal(guest.team, 'home');

  const started = room.startMatch('p1');
  assert.equal(started, true);
  assert.equal(room.status, 'playing');

  const tick = room.step(0.033);
  assert.equal(tick.actors.length, 4); // 2 human teammates + 2 bots
});

test('GameRoom processes player movement and Akashi Ankle Break stun authoritatively', () => {
  const room = new GameRoom('5193', 'pvp1v1');
  room.addMember('p1', 'Акаши', 'akashi');
  room.addMember('p2', 'Аомине', 'aomine');
  room.startMatch('p1');

  // Move p1 toward p2 until close enough for Ankle Break (within 4.2m)
  room.setPlayerInput('p1', { moveX: 0, moveZ: -1, sprint: true, chargingShot: false });
  for (let i = 0; i < 8; i++) {
    room.step(0.033);
  }
  const beforeTick = room.step(0.033);
  const p1Before = beforeTick.actors.find((a) => a.id === 'p1')!;
  assert.ok(p1Before.z < 3.2);

  for (let i = 0; i < 4; i++) {
    room.step(0.033);
  }
  room.handlePlayerAction('p1', 'skillQ');
  const afterTick = room.step(0.033);
  const p2After = afterTick.actors.find((a) => a.id === 'p2')!;
  assert.ok(p2After.stunTimer > 1.5);
});

test('normalizeRoomCode maps Cyrillic lookalikes and GameRoom preserves host across reconnect', () => {
  assert.equal(normalizeRoomCode(' к9рх '), 'K9PX');
  assert.equal(normalizeRoomCode('#4829'), '4829');

  const room = new GameRoom('7314', 'pvp1v1');
  const host = room.addMember('tok-host', 'Миша', 'akashi');
  assert.equal(room.markDisconnected('tok-host'), true);
  assert.equal(host.connected, false);
  assert.equal(room.members.length, 1);

  const rejoined = room.addMember('tok-host', 'Миша', 'aomine');
  assert.equal(rejoined.connected, true);
  assert.equal(rejoined.isHost, true);
  assert.equal(rejoined.styleId, 'aomine');
});
