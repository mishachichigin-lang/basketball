import type { AllCharacterId, StyleId } from '../game/characters.ts';
import type { MatchWinner } from '../game/rules.ts';

export type OnlineModeType = 'pvp1v1' | 'coop2v2';

const CYRILLIC_LOOKALIKES: Record<string, string> = {
  А: 'A',
  В: 'B',
  С: 'C',
  Е: 'E',
  Н: 'H',
  К: 'K',
  М: 'M',
  О: 'O',
  Р: 'P',
  Т: 'T',
  Х: 'X',
  І: 'I',
};

/**
 * Normalizes room codes typed on Russian or English keyboard layouts,
 * stripping whitespace/punctuation and mapping Cyrillic lookalikes to Latin.
 */
export function normalizeRoomCode(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .split('')
    .map((ch) => CYRILLIC_LOOKALIKES[ch] ?? ch)
    .join('')
    .replace(/[^A-Z0-9]/g, '');
}

export interface RoomMemberInfo {
  id: string;
  name: string;
  styleId: StyleId;
  team: 'home' | 'away';
  isHost: boolean;
  connected: boolean;
}

export interface PublicRoomSummary {
  code: string;
  hostName: string;
  modeType: OnlineModeType;
  memberCount: number;
  status: 'lobby' | 'playing' | 'gameover';
}

export interface NetActorState {
  id: string;
  name: string;
  styleId: AllCharacterId;
  team: 'home' | 'away';
  x: number;
  z: number;
  vx: number;
  vz: number;
  jumpY: number;
  yaw: number;
  stunTimer: number;
  cloakTimer: number;
  inZone: boolean;
  zoneTimer: number;
  stamina: number;
  zoneCharge: number;
  cooldownQ: number;
  cooldownE: number;
}

export interface NetBallState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ownerId: string | null;
  inFlight: boolean;
}

export interface NetEventEffect {
  kind: 'sfx' | 'particles' | 'banner' | 'trauma';
  sfx?: 'dribble' | 'swish' | 'clank' | 'ankle' | 'zone' | 'whoosh' | 'whistle';
  x?: number;
  y?: number;
  z?: number;
  color?: string;
  count?: number;
  bannerText?: string;
  bannerTone?: 'accent' | 'score' | 'zone' | 'alert';
  trauma?: number;
}

export interface RoomTickPayload {
  roomCode: string;
  status: 'lobby' | 'playing' | 'gameover';
  modeType: OnlineModeType;
  homeScore: number;
  awayScore: number;
  timeRemaining: number;
  shotClock: number;
  possessionTeam: 'home' | 'away';
  winner: MatchWinner;
  actors: NetActorState[];
  ball: NetBallState;
  events: NetEventEffect[];
}

export interface PlayerInputPayload {
  moveX: number;
  moveZ: number;
  sprint: boolean;
  chargingShot: boolean;
}

export type ClientMessage =
  | { type: 'ping' }
  | { type: 'room:list' }
  | { type: 'room:create'; name: string; styleId: StyleId; modeType: OnlineModeType; clientToken?: string }
  | { type: 'room:join'; roomCode: string; name: string; styleId: StyleId; clientToken?: string }
  | { type: 'room:rejoin'; roomCode: string; clientToken: string; name: string; styleId: StyleId }
  | { type: 'room:updateProfile'; styleId?: StyleId; name?: string; modeType?: OnlineModeType }
  | { type: 'room:start' }
  | { type: 'room:rematch' }
  | { type: 'room:leave' }
  | { type: 'player:input'; input: PlayerInputPayload }
  | { type: 'player:action'; action: 'shoot' | 'skillQ' | 'skillE' | 'skillZ' | 'pass' | 'steal' | 'jump'; shotCharge?: number };

export type ServerMessage =
  | { type: 'pong' }
  | { type: 'room:listUpdate'; rooms: PublicRoomSummary[] }
  | {
      type: 'room:joined';
      roomCode: string;
      playerId: string;
      status: 'lobby' | 'playing' | 'gameover';
      modeType: OnlineModeType;
      members: RoomMemberInfo[];
    }
  | {
      type: 'room:lobbyUpdate';
      roomCode: string;
      status: 'lobby' | 'playing' | 'gameover';
      modeType: OnlineModeType;
      members: RoomMemberInfo[];
    }
  | { type: 'room:tick'; state: RoomTickPayload }
  | { type: 'room:error'; message: string };
