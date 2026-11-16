import type { StyleId } from './characters';
import {
  normalizeRoomCode,
  type ClientMessage,
  type OnlineModeType,
  type PlayerInputPayload,
  type PublicRoomSummary,
  type RoomMemberInfo,
  type RoomTickPayload,
  type ServerMessage,
} from '../shared/protocol';

export interface OnlineLobbyState {
  connected: boolean;
  roomCode: string | null;
  playerId: string | null;
  status: 'lobby' | 'playing' | 'gameover';
  modeType: OnlineModeType;
  members: RoomMemberInfo[];
  rooms: PublicRoomSummary[];
  error: string | null;
}

function getOrCreateClientToken(): string {
  try {
    const key = 'kuroko_zero_client_token';
    const existing = window.sessionStorage.getItem(key);
    if (existing && existing.length >= 4) return existing;
    const created = `p-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    return `p-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export class OnlineClient {
  private ws: WebSocket | null = null;
  private onLobbyChange: (lobby: OnlineLobbyState) => void;
  private onTick: (tick: RoomTickPayload) => void;
  private pendingQueue: ClientMessage[] = [];
  private disposed = false;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private readonly clientToken: string;
  private lastName = 'Игрок';
  private lastStyleId: StyleId = 'akashi';

  public state: OnlineLobbyState = {
    connected: false,
    roomCode: null,
    playerId: null,
    status: 'lobby',
    modeType: 'pvp1v1',
    members: [],
    rooms: [],
    error: null,
  };

  constructor(
    onLobbyChange: (lobby: OnlineLobbyState) => void,
    onTick: (tick: RoomTickPayload) => void
  ) {
    this.onLobbyChange = onLobbyChange;
    this.onTick = onTick;
    this.clientToken = getOrCreateClientToken();
  }

  public connect() {
    if (this.disposed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.state = { ...this.state, connected: true, error: null };
      this.onLobbyChange({ ...this.state });

      if (this.state.roomCode) {
        ws.send(
          JSON.stringify({
            type: 'room:rejoin',
            roomCode: this.state.roomCode,
            clientToken: this.clientToken,
            name: this.lastName,
            styleId: this.lastStyleId,
          } satisfies ClientMessage)
        );
      } else {
        ws.send(JSON.stringify({ type: 'room:list' } satisfies ClientMessage));
      }

      while (this.pendingQueue.length > 0) {
        const msg = this.pendingQueue.shift()!;
        ws.send(JSON.stringify(msg));
      }

      if (this.pingTimer !== null) clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'ping' } satisfies ClientMessage));
        }
      }, 15_000);
    };

    ws.onmessage = (evt) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(evt.data)) as ServerMessage;
      } catch {
        return;
      }

      if (msg.type === 'pong') return;

      if (msg.type === 'room:listUpdate') {
        this.state = { ...this.state, rooms: msg.rooms };
        this.onLobbyChange({ ...this.state });
      } else if (msg.type === 'room:joined') {
        this.state = {
          ...this.state,
          roomCode: msg.roomCode,
          playerId: msg.playerId,
          status: msg.status,
          modeType: msg.modeType,
          members: msg.members,
          error: null,
        };
        this.onLobbyChange({ ...this.state });
      } else if (msg.type === 'room:lobbyUpdate') {
        this.state = {
          ...this.state,
          roomCode: msg.roomCode,
          status: msg.status,
          modeType: msg.modeType,
          members: msg.members,
          error: null,
        };
        this.onLobbyChange({ ...this.state });
      } else if (msg.type === 'room:tick') {
        this.onTick(msg.state);
      } else if (msg.type === 'room:error') {
        this.state = { ...this.state, error: msg.message };
        this.onLobbyChange({ ...this.state });
      }
    };

    ws.onerror = () => {
      if (!this.state.connected) {
        this.state = {
          ...this.state,
          error: 'Не удалось подключиться к онлайн-серверу. Проверьте интернет или обновите страницу.',
        };
        this.onLobbyChange({ ...this.state });
      }
    };

    ws.onclose = () => {
      if (this.pingTimer !== null) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      this.state = { ...this.state, connected: false };
      this.onLobbyChange({ ...this.state });
      if (!this.disposed && this.state.roomCode) {
        this.reconnectTimer = window.setTimeout(() => this.connect(), 1500);
      }
    };
  }

  private send(msg: ClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingQueue.push(msg);
      this.connect();
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  public refreshRooms() {
    this.send({ type: 'room:list' });
  }

  public createRoom(name: string, styleId: StyleId, modeType: OnlineModeType) {
    this.lastName = name;
    this.lastStyleId = styleId;
    this.send({
      type: 'room:create',
      name,
      styleId,
      modeType,
      clientToken: this.clientToken,
    });
  }

  public joinRoom(roomCode: string, name: string, styleId: StyleId) {
    this.lastName = name;
    this.lastStyleId = styleId;
    const cleanCode = normalizeRoomCode(roomCode);
    this.send({
      type: 'room:join',
      roomCode: cleanCode,
      name,
      styleId,
      clientToken: this.clientToken,
    });
  }

  public updateProfile(updates: { styleId?: StyleId; name?: string; modeType?: OnlineModeType }) {
    if (updates.name !== undefined) this.lastName = updates.name;
    if (updates.styleId !== undefined) this.lastStyleId = updates.styleId;
    if (!this.state.roomCode) return;
    this.send({ type: 'room:updateProfile', ...updates });
  }

  public startMatch() {
    this.send({ type: 'room:start' });
  }

  public rematch() {
    this.send({ type: 'room:rematch' });
  }

  public leaveRoom() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'room:leave' }));
    }
    this.state = {
      ...this.state,
      roomCode: null,
      playerId: null,
      status: 'lobby',
      members: [],
      error: null,
    };
    this.onLobbyChange({ ...this.state });
    this.refreshRooms();
  }

  public sendInput(input: PlayerInputPayload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'player:input', input }));
    }
  }

  public sendAction(
    action: 'shoot' | 'skillQ' | 'skillE' | 'skillZ' | 'pass' | 'steal' | 'jump',
    shotCharge?: number
  ) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'player:action', action, shotCharge }));
    }
  }

  public dispose() {
    this.disposed = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }
}
