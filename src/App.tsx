import { useEffect, useRef, useState } from 'react';
import { GameHud } from './components/GameHud';
import { GameOverModal, PauseModal } from './components/GameModals';
import { RobloxKitModal } from './components/RobloxKitModal';
import { TitleScreen } from './components/TitleScreen';
import {
  BasketballEngine,
  type HudSnapshot,
  type MatchFormat,
} from './game/BasketballEngine';
import { OnlineClient, type OnlineLobbyState } from './game/OnlineClient';
import type { StyleId } from './game/characters';
import type { OnlineModeType } from './shared/protocol';

const INITIAL_HUD: HudSnapshot = {
  mode: 'title',
  styleId: 'akashi',
  matchFormat: '2v2',
  homeScore: 0,
  awayScore: 0,
  timeRemaining: 120,
  shotClock: 24,
  stamina: 100,
  zoneCharge: 45,
  inZone: false,
  zoneRemaining: 0,
  cooldownQ: 0,
  cooldownE: 0,
  isChargingShot: false,
  shotCharge: 0,
  hasBall: true,
  possessionTeam: 'home',
  bannerEvent: null,
  bannerTone: 'accent',
  winner: null,
  shotsMade: 0,
  shotsAttempted: 0,
  stealsCount: 0,
  ankleBreaksCount: 0,
  muted: false,
  isOnline: false,
  localTeam: 'home',
};

const INITIAL_LOBBY: OnlineLobbyState = {
  connected: false,
  roomCode: null,
  playerId: null,
  status: 'lobby',
  modeType: 'pvp1v1',
  members: [],
  rooms: [],
  error: null,
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<BasketballEngine | null>(null);
  const onlineRef = useRef<OnlineClient | null>(null);
  const chargeBarRef = useRef<HTMLDivElement | null>(null);
  const chargeWrapRef = useRef<HTMLDivElement | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [robloxKitOpen, setRobloxKitOpen] = useState(false);

  const initialParams = new URLSearchParams(window.location.search);
  const urlRoom = (initialParams.get('room') || '').toUpperCase();

  const [playTab, setPlayTab] = useState<'solo' | 'online'>(urlRoom ? 'online' : 'solo');
  const [playerName, setPlayerName] = useState('Игрок');
  const [onlineLobby, setOnlineLobby] = useState<OnlineLobbyState>(INITIAL_LOBBY);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    document.body.dataset.state = 'title';
    const engine = new BasketballEngine(
      container,
      (snapshot) => {
        setHud(snapshot);
      },
      (charge, visible) => {
        if (chargeWrapRef.current) {
          chargeWrapRef.current.style.opacity = visible ? '1' : '0';
        }
        if (chargeBarRef.current) {
          chargeBarRef.current.style.transform = `scaleX(${Math.max(0, Math.min(1, charge))})`;
          chargeBarRef.current.style.backgroundColor =
            charge >= 0.72 && charge <= 0.88 ? '#10B981' : '#F59E0B';
        }
      }
    );
    engineRef.current = engine;

    const client = new OnlineClient(
      (lobby) => {
        setOnlineLobby(lobby);
        if (lobby.status === 'playing' && lobby.playerId && engineRef.current) {
          if (document.body.dataset.state !== 'playing') {
            engineRef.current.enterOnlineMatch(
              lobby.playerId,
              (input) => client.sendInput(input),
              (action, shotCharge) => client.sendAction(action, shotCharge)
            );
          }
        }
      },
      (tick) => {
        engineRef.current?.applyServerTick(tick);
      }
    );
    onlineRef.current = client;

    if (urlRoom) {
      client.connect();
    }

    if (initialParams.get('autostart') === '1') {
      engine.startMatch();
    }

    return () => {
      client.dispose();
      onlineRef.current = null;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleSelectStyle = (style: StyleId) => {
    engineRef.current?.setStyle(style);
    if (onlineLobby.roomCode) {
      onlineRef.current?.updateProfile({ styleId: style });
    }
  };

  const handleSelectFormat = (format: MatchFormat) => {
    engineRef.current?.setMatchFormat(format);
  };

  const handleChangeTab = (tab: 'solo' | 'online') => {
    setPlayTab(tab);
    if (tab === 'online') {
      onlineRef.current?.connect();
    }
  };

  const handleCreateRoom = (modeType: OnlineModeType) => {
    onlineRef.current?.createRoom(playerName, hud.styleId, modeType);
  };

  const handleJoinRoom = (code: string) => {
    onlineRef.current?.joinRoom(code, playerName, hud.styleId);
  };

  const handleChangeName = (name: string) => {
    setPlayerName(name);
    if (onlineLobby.roomCode) {
      onlineRef.current?.updateProfile({ name });
    }
  };

  const handleLeaveRoom = () => {
    onlineRef.current?.leaveRoom();
    engineRef.current?.exitOnlineMatch();
  };

  const handleReturnTitle = () => {
    if (hud.isOnline) {
      onlineRef.current?.leaveRoom();
      engineRef.current?.exitOnlineMatch();
    } else {
      engineRef.current?.returnToTitle();
    }
  };

  const handlePlayAgain = () => {
    if (hud.isOnline) {
      onlineRef.current?.rematch();
    } else {
      engineRef.current?.startMatch();
    }
  };

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#0B0E14]">
      {/* Isolated WebGL Canvas Container */}
      <div
        ref={mountRef}
        data-testid="arena-canvas-container"
        className="fixed inset-0 w-full h-full"
      />

      {hud.mode === 'title' && (
        <TitleScreen
          selectedStyle={hud.styleId}
          matchFormat={hud.matchFormat}
          playTab={playTab}
          playerName={playerName}
          initialRoomCode={urlRoom}
          onlineLobby={onlineLobby}
          onChangeTab={handleChangeTab}
          onChangeName={handleChangeName}
          onSelectStyle={handleSelectStyle}
          onSelectFormat={handleSelectFormat}
          onStartSolo={() => engineRef.current?.startMatch()}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onChangeOnlineMode={(modeType) => onlineRef.current?.updateProfile({ modeType })}
          onStartOnline={() => onlineRef.current?.startMatch()}
          onLeaveRoom={handleLeaveRoom}
          onOpenRobloxKit={() => setRobloxKitOpen(true)}
          modalOpen={robloxKitOpen}
        />
      )}

      {hud.mode === 'playing' && (
        <GameHud
          hud={hud}
          chargeBarRef={chargeBarRef}
          chargeWrapRef={chargeWrapRef}
          onPause={() => engineRef.current?.pauseMatch()}
          onRestart={handlePlayAgain}
          onToggleMute={() => engineRef.current?.toggleMute()}
          onUseSkill={(slot) => engineRef.current?.triggerSkillFromHud(slot)}
        />
      )}

      {hud.mode === 'paused' && (
        <PauseModal
          onResume={() => engineRef.current?.resumeMatch()}
          onRestart={handlePlayAgain}
          onTitle={handleReturnTitle}
          onOpenRobloxKit={() => setRobloxKitOpen(true)}
        />
      )}

      {hud.mode === 'gameover' && (
        <GameOverModal
          hud={hud}
          onPlayAgain={handlePlayAgain}
          onTitle={handleReturnTitle}
        />
      )}

      {robloxKitOpen && <RobloxKitModal onClose={() => setRobloxKitOpen(false)} />}
    </main>
  );
}
