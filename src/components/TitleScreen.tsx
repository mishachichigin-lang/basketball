import { useEffect, useState } from 'react';
import { Check, Code2, Copy, Link2, Play, Users } from 'lucide-react';
import { CHARACTER_STYLES, PLAYABLE_STYLES, type StyleId } from '../game/characters';
import type { MatchFormat } from '../game/BasketballEngine';
import type { OnlineLobbyState } from '../game/OnlineClient';
import { normalizeRoomCode, type OnlineModeType } from '../shared/protocol';

interface TitleScreenProps {
  selectedStyle: StyleId;
  matchFormat: MatchFormat;
  playTab: 'solo' | 'online';
  playerName: string;
  initialRoomCode: string;
  onlineLobby: OnlineLobbyState;
  onChangeTab: (tab: 'solo' | 'online') => void;
  onChangeName: (name: string) => void;
  onSelectStyle: (style: StyleId) => void;
  onSelectFormat: (format: MatchFormat) => void;
  onStartSolo: () => void;
  onCreateRoom: (modeType: OnlineModeType) => void;
  onJoinRoom: (code: string) => void;
  onChangeOnlineMode: (modeType: OnlineModeType) => void;
  onStartOnline: () => void;
  onLeaveRoom: () => void;
  onOpenRobloxKit: () => void;
  modalOpen: boolean;
}

export function TitleScreen({
  selectedStyle,
  matchFormat,
  playTab,
  playerName,
  initialRoomCode,
  onlineLobby,
  onChangeTab,
  onChangeName,
  onSelectStyle,
  onSelectFormat,
  onStartSolo,
  onCreateRoom,
  onJoinRoom,
  onChangeOnlineMode,
  onStartOnline,
  onLeaveRoom,
  onOpenRobloxKit,
  modalOpen,
}: TitleScreenProps) {
  const activeChar = CHARACTER_STYLES[selectedStyle];
  const [joinCode, setJoinCode] = useState(initialRoomCode);
  const [copiedLink, setCopiedLink] = useState(false);

  const isHost = Boolean(
    onlineLobby.members.find((m) => m.id === onlineLobby.playerId)?.isHost
  );

  useEffect(() => {
    if (initialRoomCode) setJoinCode(initialRoomCode);
  }, [initialRoomCode]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (modalOpen) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.code === 'Enter' || e.code === 'Space') {
        if (playTab === 'solo') {
          e.preventDefault();
          onStartSolo();
        } else if (onlineLobby.roomCode && isHost) {
          e.preventDefault();
          onStartOnline();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, playTab, onlineLobby.roomCode, isHost, onStartSolo, onStartOnline]);

  const isDevPreviewHost =
    typeof window !== 'undefined' && window.location.hostname.startsWith('ais-dev-');
  const sharedOrigin =
    typeof window !== 'undefined' && isDevPreviewHost
      ? window.location.origin.replace('://ais-dev-', '://ais-pre-')
      : typeof window !== 'undefined'
        ? window.location.origin
        : '';

  const handleCopyInvite = async () => {
    if (!onlineLobby.roomCode) return;
    const url = `${window.location.origin}/?room=${onlineLobby.roomCode}`;
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        copied = false;
      }
    }
    if (copied) {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    }
  };

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-5 md:p-9">
      {/* Asymmetric Left Staging Panel */}
      <div className="pointer-events-auto max-w-[500px] w-full bg-[#0B0E14]/94 border border-white/12 rounded-xl p-5 shadow-2xl">
        {/* Bespoke SVG Title Emblem */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 48 48" className="w-10 h-10 shrink-0" aria-hidden="true">
              <circle cx="24" cy="24" r="21" fill="#0F172A" stroke="#38BDF8" strokeWidth="2.5" />
              <path
                d="M9 24 H39 M24 3 V45 M12 10 Q24 24 12 38 M36 10 Q24 24 36 38"
                fill="none"
                stroke="#F97316"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <path
                d="M15 30 L25 14 L23 22 L33 17 L22 34 L24 26 Z"
                fill="#F8FAFC"
                stroke="#0F172A"
                strokeWidth="1.2"
              />
            </svg>
            <div>
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-white leading-none uppercase">
                Kuroko Zero
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                3D Арена · Онлайн с другом и Roblox Kit
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenRobloxKit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-[#161E2E] hover:bg-[#1E293B] border border-white/15 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Code2 className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
            Roblox Luau
          </button>
        </div>

        {/* Mode Tabs: Solo vs Online with a Friend */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#111622] border border-white/10 rounded-lg mb-4">
          <button
            type="button"
            onClick={() => onChangeTab('solo')}
            className={`py-2 px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              playTab === 'solo'
                ? 'bg-slate-100 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Одиночная (с ботами)
          </button>
          <button
            type="button"
            onClick={() => onChangeTab('online')}
            className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              playTab === 'online'
                ? 'bg-sky-400 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" aria-hidden="true" />
            Онлайн с другом
          </button>
        </div>

        {/* Character Style Selector (Akashi / Aomine / Kuroko) */}
        <div className="mb-3.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-300">Выбор персонажа</span>
            <span className="text-xs text-slate-400 tabular-nums">
              #{activeChar.number} · {activeChar.schoolRu}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {PLAYABLE_STYLES.map((char) => {
              const isSelected = char.id === selectedStyle;
              return (
                <button
                  key={char.id}
                  type="button"
                  onClick={() => onSelectStyle(char.id as StyleId)}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                    isSelected
                      ? 'bg-[#161D2B] border-sky-400 text-white'
                      : 'bg-[#101520] border-white/10 text-slate-300 hover:border-white/25 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-display text-base font-bold leading-tight whitespace-nowrap truncate">
                      {char.nameRu.split(' ')[0]}
                    </span>
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{ backgroundColor: char.primaryColor }}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 whitespace-nowrap truncate">
                    #{char.number} · {char.schoolRu}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {playTab === 'solo' ? (
          <>
            {/* Active Character Skills Preview */}
            <div className="bg-[#111622] border border-white/8 rounded-lg p-3 mb-4 space-y-1.5">
              <div className="flex items-baseline justify-between gap-2 pb-1 border-b border-white/8">
                <span className="font-display text-base font-bold text-white">
                  {activeChar.nameRu}
                </span>
                <span className="text-xs text-slate-400">{activeChar.roleRu}</span>
              </div>
              {activeChar.skills.map((sk) => (
                <div key={sk.key} className="flex items-start gap-2 text-xs">
                  <span className="font-mono-num font-bold text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-white shrink-0">
                    {sk.key}
                  </span>
                  <div className="leading-snug">
                    <span className="font-semibold text-slate-100">{sk.nameRu}</span>
                    <span className="text-slate-400"> — {sk.descriptionRu}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-3.5">
              <span className="text-xs text-slate-400 mr-1">Формат:</span>
              {(['1v1', '2v2'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => onSelectFormat(fmt)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                    matchFormat === fmt
                      ? 'bg-slate-100 text-slate-950 border-slate-100'
                      : 'bg-[#101520] text-slate-300 border-white/10 hover:text-white'
                  }`}
                >
                  {fmt === '1v1' ? '1 на 1' : '2 на 2 (с пасом)'}
                </button>
              ))}
            </div>

            <button
              type="button"
              data-start="true"
              onClick={onStartSolo}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-semibold text-sm text-white bg-[#E11D48] hover:bg-[#BE123C] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              Начать матч
            </button>
          </>
        ) : !onlineLobby.roomCode ? (
          /* Online Create or Join Room */
          <div className="space-y-3">
            {isDevPreviewHost && (
              <div className="text-[11px] leading-snug text-amber-200 bg-amber-950/50 border border-amber-400/30 rounded-lg px-3 py-2">
                Вы в окне разработчика. Чтобы играть с другом с разных устройств, откройте оба{' '}
                <a
                  href={sharedOrigin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-semibold text-sky-300 hover:text-sky-200"
                >
                  публичную версию (Shared App)
                </a>{' '}
                и создайте комнату там.
              </div>
            )}

            <div>
              <label htmlFor="player-nickname" className="block text-xs text-slate-300 mb-1">
                Ваш никнейм
              </label>
              <input
                id="player-nickname"
                type="text"
                maxLength={18}
                value={playerName}
                onChange={(e) => onChangeName(e.target.value)}
                placeholder="Например: Миша"
                className="w-full px-3 py-2 rounded-lg bg-[#111622] border border-white/15 text-sm text-white focus:outline-none focus:border-sky-400"
              />
            </div>

            {onlineLobby.error && (
              <div className="text-xs text-rose-300 bg-rose-950/60 border border-rose-500/35 rounded-md px-3 py-2">
                {onlineLobby.error}
              </div>
            )}

            <button
              type="button"
              onClick={() => onCreateRoom('pvp1v1')}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm text-white bg-[#E11D48] hover:bg-[#BE123C] transition-colors cursor-pointer"
            >
              <Users className="w-4 h-4" aria-hidden="true" />
              Создать комнату для друга
            </button>

            <div className="pt-2 border-t border-white/10">
              <label htmlFor="room-code-input" className="block text-xs text-slate-400 mb-1.5">
                Или войдите по коду комнаты от друга
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="room-code-input"
                  type="text"
                  maxLength={8}
                  value={joinCode}
                  onChange={(e) => setJoinCode(normalizeRoomCode(e.target.value))}
                  placeholder="КОД (напр. 4829)"
                  className="flex-1 px-3 py-2 rounded-lg bg-[#111622] border border-white/15 text-sm font-mono-num uppercase tracking-widest text-white focus:outline-none focus:border-sky-400"
                />
                <button
                  type="button"
                  onClick={() => {
                    const normalized = normalizeRoomCode(joinCode);
                    if (normalized) onJoinRoom(normalized);
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-sky-400 hover:bg-sky-300 text-slate-950 cursor-pointer whitespace-nowrap"
                >
                  Войти
                </button>
              </div>
            </div>

            {onlineLobby.rooms.length > 0 && (
              <div className="pt-2 border-t border-white/10 space-y-1.5">
                <div className="text-[11px] font-medium text-slate-400">
                  Открытые комнаты на сервере
                </div>
                <div className="max-h-28 overflow-y-auto space-y-1">
                  {onlineLobby.rooms.map((r) => (
                    <div
                      key={r.code}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-[#111622] border border-white/10 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono-num font-bold text-sky-400">{r.code}</span>
                        <span className="text-slate-200 truncate">{r.hostName}</span>
                        <span className="text-slate-400 shrink-0">
                          {r.memberCount}/4 · {r.modeType === 'pvp1v1' ? '1v1' : '2v2'}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={r.status === 'playing' || r.memberCount >= 4}
                        onClick={() => onJoinRoom(r.code)}
                        className="px-2.5 py-1 rounded bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-slate-950 font-semibold text-[11px] cursor-pointer shrink-0"
                      >
                        {r.status === 'playing' ? 'Идёт' : 'Войти'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Active Online Room Lobby */
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 bg-[#111622] border border-sky-400/35 rounded-lg px-3.5 py-2.5">
              <div>
                <div className="text-[11px] text-slate-400">Код комнаты (скажите другу)</div>
                <div
                  data-testid="room-code-display"
                  className="font-mono-num text-xl font-bold tracking-widest text-sky-400"
                >
                  {onlineLobby.roomCode}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyInvite}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-white/10 hover:bg-white/15 text-white cursor-pointer whitespace-nowrap"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Ссылка скопирована
                  </>
                ) : (
                  <>
                    <Link2 className="w-3.5 h-3.5 text-sky-400" />
                    <Copy className="w-3 h-3" />
                    Пригласить друга
                  </>
                )}
              </button>
            </div>

            {isHost && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onChangeOnlineMode('pvp1v1')}
                  className={`flex-1 py-1.5 px-2.5 rounded-md text-xs font-semibold border cursor-pointer ${
                    onlineLobby.modeType === 'pvp1v1'
                      ? 'bg-slate-100 text-slate-950 border-slate-100'
                      : 'bg-[#101520] text-slate-300 border-white/10'
                  }`}
                >
                  1 на 1 (друг против друга)
                </button>
                <button
                  type="button"
                  onClick={() => onChangeOnlineMode('coop2v2')}
                  className={`flex-1 py-1.5 px-2.5 rounded-md text-xs font-semibold border cursor-pointer ${
                    onlineLobby.modeType === 'coop2v2'
                      ? 'bg-slate-100 text-slate-950 border-slate-100'
                      : 'bg-[#101520] text-slate-300 border-white/10'
                  }`}
                >
                  2 на 2 (вместе vs боты)
                </button>
              </div>
            )}

            <div className="bg-[#111622] border border-white/10 rounded-lg p-3 space-y-2">
              <div className="text-xs text-slate-400">
                Игроки в комнате ({onlineLobby.members.length}/4)
              </div>
              {onlineLobby.members.map((m) => {
                const st = CHARACTER_STYLES[m.styleId];
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between text-xs py-1 border-b border-white/6 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-xs"
                        style={{ backgroundColor: st.primaryColor }}
                        aria-hidden="true"
                      />
                      <span className="font-semibold text-white">
                        {m.name}
                        {m.id === onlineLobby.playerId ? ' (вы)' : ''}
                      </span>
                      {m.isHost && <span className="text-amber-400">· Хост</span>}
                    </div>
                    <span className="text-slate-300">
                      {st.nameRu.split(' ')[0]} · {m.team === 'home' ? 'Дом' : 'Гости'}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              {isHost ? (
                <button
                  type="button"
                  data-start="true"
                  onClick={onStartOnline}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm text-white bg-[#E11D48] hover:bg-[#BE123C] cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                  Начать онлайн-матч
                </button>
              ) : (
                <div className="flex-1 text-center py-2.5 px-3 rounded-lg bg-[#161E2E] text-xs font-medium text-sky-300 border border-sky-400/25">
                  Ожидаем запуска от хоста...
                </div>
              )}

              <button
                type="button"
                onClick={onLeaveRoom}
                className="px-3.5 py-2.5 rounded-lg text-xs font-medium text-slate-300 bg-[#141A26] hover:text-white border border-white/10 cursor-pointer"
              >
                Выйти
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Flat borderless single-line control hint */}
      <div className="text-xs text-slate-300/90 tracking-wide text-stroke-hud">
        WASD Движение · Shift Рывок · Space Бросок · ПКМ / F Пас · Q / E Навыки · Z Зона · ЛКМ / V Перехват
      </div>
    </div>
  );
}
