import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { GameRoom } from './server/gameRoom.ts';
import {
  normalizeRoomCode,
  type ClientMessage,
  type PublicRoomSummary,
  type ServerMessage,
} from './src/shared/protocol.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';
const DISCONNECT_GRACE_MS = 90_000;

interface ClientSession {
  id: string;
  ws: WebSocket;
  roomCode: string | null;
  alive: boolean;
}

const rooms = new Map<string, GameRoom>();
const sessions = new Map<WebSocket, ClientSession>();
const disconnectTimers = new Map<string, NodeJS.Timeout>();

function generateRoomCode(): string {
  // Use 4-digit numeric codes so Russian/English keyboard layouts never mismatch
  for (let attempt = 0; attempt < 40; attempt++) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  return String(10000 + (Date.now() % 89999));
}

function getPublicRoomSummaries(): PublicRoomSummary[] {
  const list: PublicRoomSummary[] = [];
  for (const room of rooms.values()) {
    if (room.members.length === 0) continue;
    const host = room.members.find((m) => m.isHost) ?? room.members[0];
    list.push({
      code: room.code,
      hostName: host?.name ?? 'Хост',
      modeType: room.modeType,
      memberCount: room.members.length,
      status: room.status,
    });
  }
  return list;
}

function sendJson(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastToRoom(roomCode: string, msg: ServerMessage) {
  const payload = JSON.stringify(msg);
  for (const session of sessions.values()) {
    if (session.roomCode === roomCode && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(payload);
    }
  }
}

function broadcastLobbyList() {
  const msg: ServerMessage = { type: 'room:listUpdate', rooms: getPublicRoomSummaries() };
  const payload = JSON.stringify(msg);
  for (const session of sessions.values()) {
    if (!session.roomCode && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(payload);
    }
  }
}

function clearDisconnectTimer(roomCode: string, playerId: string) {
  const key = `${roomCode}:${playerId}`;
  const timer = disconnectTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(key);
  }
}

function removeFromRoomImmediately(session: ClientSession) {
  if (!session.roomCode) return;
  const code = session.roomCode;
  const room = rooms.get(code);
  session.roomCode = null;
  clearDisconnectTimer(code, session.id);
  if (!room) return;

  room.removeMember(session.id);
  if (room.members.length === 0) {
    rooms.delete(code);
  } else {
    broadcastToRoom(code, {
      type: 'room:lobbyUpdate',
      roomCode: room.code,
      status: room.status,
      modeType: room.modeType,
      members: room.members,
    });
  }
  broadcastLobbyList();
}

function scheduleDisconnectCleanup(session: ClientSession) {
  if (!session.roomCode) return;
  const code = session.roomCode;
  const playerId = session.id;
  const room = rooms.get(code);
  session.roomCode = null;
  if (!room) return;

  // Check if player already has another active WebSocket session in this room
  for (const other of sessions.values()) {
    if (other !== session && other.id === playerId && other.roomCode === code && other.ws.readyState === WebSocket.OPEN) {
      return;
    }
  }

  room.markDisconnected(playerId);
  broadcastToRoom(code, {
    type: 'room:lobbyUpdate',
    roomCode: room.code,
    status: room.status,
    modeType: room.modeType,
    members: room.members,
  });

  clearDisconnectTimer(code, playerId);
  const timer = setTimeout(() => {
    disconnectTimers.delete(`${code}:${playerId}`);
    const targetRoom = rooms.get(code);
    if (!targetRoom) return;
    const member = targetRoom.members.find((m) => m.id === playerId);
    if (member && member.connected) return;

    targetRoom.removeMember(playerId);
    if (targetRoom.members.length === 0) {
      rooms.delete(code);
    } else {
      broadcastToRoom(code, {
        type: 'room:lobbyUpdate',
        roomCode: targetRoom.code,
        status: targetRoom.status,
        modeType: targetRoom.modeType,
        members: targetRoom.members,
      });
    }
    broadcastLobbyList();
  }, DISCONNECT_GRACE_MS);

  disconnectTimers.set(`${code}:${playerId}`, timer);
}

function sanitizeClientToken(token: unknown, fallbackId: string): string {
  if (typeof token === 'string') {
    const clean = token.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
    if (clean.length >= 4) return clean;
  }
  return fallbackId;
}

async function bootstrap() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: getPublicRoomSummaries() });
  });

  app.get('/api/rooms/:code', (req, res) => {
    const code = normalizeRoomCode(req.params.code || '');
    const room = rooms.get(code);
    if (!room) {
      res.status(404).json({ exists: false });
      return;
    }
    res.json({
      exists: true,
      code: room.code,
      status: room.status,
      modeType: room.modeType,
      memberCount: room.members.length,
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const fallbackId = `p-${Math.random().toString(36).slice(2, 9)}`;
    const session: ClientSession = { id: fallbackId, ws, roomCode: null, alive: true };
    sessions.set(ws, session);

    // Send initial open rooms list immediately on connect
    sendJson(ws, { type: 'room:listUpdate', rooms: getPublicRoomSummaries() });

    ws.on('pong', () => {
      session.alive = true;
    });

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }

      if (msg.type === 'ping') {
        session.alive = true;
        sendJson(ws, { type: 'pong' });
        return;
      }

      if (msg.type === 'room:list') {
        sendJson(ws, { type: 'room:listUpdate', rooms: getPublicRoomSummaries() });
        return;
      }

      if (msg.type === 'room:create') {
        removeFromRoomImmediately(session);
        session.id = sanitizeClientToken(msg.clientToken, session.id);
        const code = generateRoomCode();
        const room = new GameRoom(code, msg.modeType);
        room.addMember(session.id, msg.name, msg.styleId);
        rooms.set(code, room);
        session.roomCode = code;

        sendJson(ws, {
          type: 'room:joined',
          roomCode: code,
          playerId: session.id,
          status: room.status,
          modeType: room.modeType,
          members: room.members,
        });
        broadcastLobbyList();
        return;
      }

      if (msg.type === 'room:join' || msg.type === 'room:rejoin') {
        const code = normalizeRoomCode(msg.roomCode || '');
        const room = rooms.get(code);
        if (!room) {
          sendJson(ws, {
            type: 'room:error',
            message: `Комната «${code || msg.roomCode}» не найдена. Проверьте код или выберите комнату из списка.`,
          });
          return;
        }

        const tokenId = sanitizeClientToken(msg.clientToken, session.id);
        const existingMember = room.members.find((m) => m.id === tokenId);

        if (!existingMember && room.members.length >= 4) {
          sendJson(ws, { type: 'room:error', message: 'Комната заполнена (макс. 4 игрока)' });
          return;
        }
        if (!existingMember && room.status === 'playing') {
          sendJson(ws, { type: 'room:error', message: 'Матч в этой комнате уже идёт' });
          return;
        }

        if (session.roomCode && session.roomCode !== code) {
          removeFromRoomImmediately(session);
        }

        session.id = tokenId;
        clearDisconnectTimer(code, session.id);
        room.addMember(session.id, msg.name, msg.styleId);
        session.roomCode = code;

        sendJson(ws, {
          type: 'room:joined',
          roomCode: code,
          playerId: session.id,
          status: room.status,
          modeType: room.modeType,
          members: room.members,
        });
        broadcastToRoom(code, {
          type: 'room:lobbyUpdate',
          roomCode: room.code,
          status: room.status,
          modeType: room.modeType,
          members: room.members,
        });
        broadcastLobbyList();
        return;
      }

      if (msg.type === 'room:leave') {
        removeFromRoomImmediately(session);
        return;
      }

      if (!session.roomCode) return;
      const room = rooms.get(session.roomCode);
      if (!room) return;

      if (msg.type === 'room:updateProfile') {
        room.updateMemberProfile(session.id, {
          styleId: msg.styleId,
          name: msg.name,
          modeType: msg.modeType,
        });
        broadcastToRoom(room.code, {
          type: 'room:lobbyUpdate',
          roomCode: room.code,
          status: room.status,
          modeType: room.modeType,
          members: room.members,
        });
        broadcastLobbyList();
        return;
      }

      if (msg.type === 'room:start' || msg.type === 'room:rematch') {
        const ok = room.startMatch(session.id);
        if (ok) {
          broadcastToRoom(room.code, {
            type: 'room:lobbyUpdate',
            roomCode: room.code,
            status: room.status,
            modeType: room.modeType,
            members: room.members,
          });
          broadcastLobbyList();
          const initialTick = room.step(0.016);
          broadcastToRoom(room.code, { type: 'room:tick', state: initialTick });
        }
        return;
      }

      if (msg.type === 'player:input') {
        room.setPlayerInput(session.id, msg.input);
        return;
      }

      if (msg.type === 'player:action') {
        room.handlePlayerAction(session.id, msg.action, msg.shotCharge);
      }
    });

    ws.on('close', () => {
      scheduleDisconnectCleanup(session);
      sessions.delete(ws);
    });
  });

  // WebSocket heartbeat every 15s to prevent idle proxy/Cloud Run timeouts
  setInterval(() => {
    for (const [ws, session] of sessions.entries()) {
      if (!session.alive) {
        ws.terminate();
        continue;
      }
      session.alive = false;
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }
  }, 15_000);

  // Authoritative 30Hz server tick for active rooms
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.05, Math.max(0.01, (now - lastTick) / 1000));
    lastTick = now;

    for (const room of rooms.values()) {
      if (room.status === 'playing') {
        const state = room.step(dt);
        broadcastToRoom(room.code, { type: 'room:tick', state });
        if (state.status === 'gameover') {
          broadcastToRoom(room.code, {
            type: 'room:lobbyUpdate',
            roomCode: room.code,
            status: state.status,
            modeType: room.modeType,
            members: room.members,
          });
          broadcastLobbyList();
        }
      }
    }
  }, 33);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Kuroko Zero server running on http://0.0.0.0:${PORT}`);
  });
}

bootstrap();
