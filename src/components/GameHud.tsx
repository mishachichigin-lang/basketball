import { type RefObject } from 'react';
import { CHARACTER_STYLES } from '../game/characters';
import type { HudSnapshot } from '../game/BasketballEngine';

interface GameHudProps {
  hud: HudSnapshot;
  chargeBarRef: RefObject<HTMLDivElement | null>;
  chargeWrapRef: RefObject<HTMLDivElement | null>;
  onPause: () => void;
  onRestart: () => void;
  onToggleMute: () => void;
  onUseSkill: (slot: 'Q' | 'E' | 'Z') => void;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

export function GameHud({
  hud,
  chargeBarRef,
  chargeWrapRef,
  onPause,
  onRestart,
  onToggleMute,
  onUseSkill,
}: GameHudProps) {
  const style = CHARACTER_STYLES[hud.styleId];
  const zoneReady = hud.zoneCharge >= 100 && !hud.inZone;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none flex flex-col justify-between p-4 md:p-5">
      {/* Top Row: Scoreboard Center + Utility Icons Right */}
      <div className="relative flex items-start justify-center">
        {/* Compact Arena Scoreboard */}
        <div
          className="bg-[#0B0E14]/90 border border-white/15 rounded-lg px-5 py-2 flex items-center gap-5 shadow-lg"
          aria-label="Счёт матча"
        >
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-sky-400 font-semibold">
              {hud.localTeam === 'home' ? `Вы · #${style.number}` : 'Дом'}
            </div>
            <div
              data-testid="score-home"
              className="font-display text-3xl font-extrabold leading-none text-white tabular-nums"
            >
              {hud.homeScore}
            </div>
          </div>

          <div className="flex flex-col items-center px-3 border-x border-white/10">
            <div className="font-mono-num text-base font-bold text-white leading-tight">
              {formatClock(hud.timeRemaining)}
            </div>
            <div className="font-mono-num text-[11px] text-amber-400">
              24с: {Math.ceil(hud.shotClock)}
            </div>
          </div>

          <div className="text-left">
            <div className="text-[10px] uppercase tracking-wider text-rose-400 font-semibold">
              {hud.localTeam === 'away' ? `Вы · #${style.number}` : 'Гости'}
            </div>
            <div
              data-testid="score-away"
              className="font-display text-3xl font-extrabold leading-none text-white tabular-nums"
            >
              {hud.awayScore}
            </div>
          </div>
        </div>

        {/* Top-Right Compact Square Utility Controls */}
        <div className="pointer-events-auto absolute right-0 top-0 flex items-center gap-2">
          <button
            type="button"
            tabIndex={-1}
            aria-label={hud.muted ? 'Включить звук (M)' : 'Выключить звук (M)'}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            className="w-10 h-10 rounded-lg bg-[#0B0E14]/90 border border-white/15 hover:border-white/35 flex items-center justify-center text-slate-200 cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              {hud.muted ? (
                <path d="M22 9l-6 6M16 9l6 6" />
              ) : (
                <path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" />
              )}
            </svg>
          </button>

          {!hud.isOnline && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Перезапустить матч (R)"
              onClick={(e) => {
                e.currentTarget.blur();
                onRestart();
              }}
              className="w-10 h-10 rounded-lg bg-[#0B0E14]/90 border border-white/15 hover:border-white/35 flex items-center justify-center text-slate-200 cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
          )}

          <button
            type="button"
            tabIndex={-1}
            aria-label="Пауза (P)"
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            className="w-10 h-10 rounded-lg bg-[#0B0E14]/90 border border-white/15 hover:border-white/35 flex items-center justify-center text-slate-200 cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Transient Event Callout Banner (Fixed high above backboard) */}
      {hud.bannerEvent && (
        <div className="fixed top-[74px] left-1/2 -translate-x-1/2 pointer-events-none">
          <div
            className="px-4 py-1 rounded-md font-display text-lg font-bold tracking-wide text-white text-stroke-hud whitespace-nowrap"
            style={{
              backgroundColor:
                hud.bannerTone === 'zone'
                  ? 'rgba(225, 29, 72, 0.9)'
                  : hud.bannerTone === 'score'
                    ? 'rgba(16, 185, 129, 0.9)'
                    : 'rgba(15, 23, 42, 0.9)',
            }}
          >
            {hud.bannerEvent}
          </div>
        </div>
      )}

      {/* Shot Release Timing Bar (Bottom-center, keeps center court unobstructed) */}
      <div
        ref={chargeWrapRef}
        className="fixed bottom-5 left-1/2 -translate-x-1/2 transition-opacity duration-75 pointer-events-none"
        style={{ opacity: 0 }}
      >
        <div className="bg-[#0B0E14]/95 border border-white/20 rounded-md p-2 w-64 shadow-lg">
          <div className="flex justify-between text-[11px] text-slate-300 mb-1 px-0.5">
            <span>Сила броска</span>
            <span className="text-emerald-400 font-semibold">Идеал · 80%</span>
          </div>
          <div className="relative h-3 bg-slate-800 rounded overflow-hidden">
            {/* Sweet spot target marker around 72% - 88% */}
            <div
              className="absolute top-0 bottom-0 bg-emerald-500/35 border-x border-emerald-400"
              style={{ left: '72%', width: '16%' }}
            />
            <div
              ref={chargeBarRef}
              className="h-full bg-amber-400 origin-left"
              style={{ transform: 'scaleX(0)' }}
            />
          </div>
        </div>
      </div>

      {/* Bottom Perimeter Clusters: Left Gauges + Right Ability Slots */}
      <div className="mt-auto flex items-end justify-between gap-4">
        {/* Bottom-Left: Stamina & Zone Meter */}
        <div className="bg-[#0B0E14]/90 border border-white/12 rounded-lg p-3 w-56 space-y-2.5">
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="font-semibold text-slate-200">Выносливость</span>
              <span className="font-mono-num text-slate-300">{Math.round(hud.stamina)}%</span>
            </div>
            <div className="h-2 bg-slate-800 rounded-sm overflow-hidden">
              <div
                className="h-full bg-sky-400 transition-all duration-100"
                style={{ width: `${Math.round(hud.stamina)}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="font-semibold text-white">
                {hud.inZone ? 'ЗОНА АКТИВНА' : 'Шкала Зоны'}
              </span>
              <span className="font-mono-num text-amber-300">
                {hud.inZone ? `${hud.zoneRemaining.toFixed(1)}с` : `${Math.round(hud.zoneCharge)}%`}
              </span>
            </div>
            <div className="h-2.5 bg-slate-800 rounded-sm overflow-hidden">
              <div
                className="h-full transition-all duration-100"
                style={{
                  width: `${hud.inZone ? Math.round((hud.zoneRemaining / 15) * 100) : Math.round(hud.zoneCharge)}%`,
                  backgroundColor: hud.inZone ? style.zoneAuraColor : zoneReady ? '#F59E0B' : style.primaryColor,
                }}
              />
            </div>
          </div>
        </div>

        {/* Bottom-Right: 3 Ability Slots [Q], [E], [Z] */}
        <div className="pointer-events-auto flex items-end gap-2">
          {style.skills.map((sk) => {
            const cd = sk.key === 'Q' ? hud.cooldownQ : sk.key === 'E' ? hud.cooldownE : 0;
            const isZone = sk.key === 'Z';
            const ready = isZone ? zoneReady : cd <= 0;
            return (
              <button
                key={sk.key}
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onUseSkill(sk.key);
                }}
                className={`min-w-[144px] rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer ${
                  isZone && hud.inZone
                    ? 'bg-rose-950/90 border-rose-400 text-white'
                    : ready
                      ? 'bg-[#0B0E14]/92 border-white/20 hover:border-sky-400 text-white'
                      : 'bg-[#0B0E14]/80 border-white/10 text-slate-400'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-mono-num text-[11px] font-bold px-1.5 py-0.5 rounded bg-white/12 text-white">
                    {sk.key}
                  </span>
                  <span className="font-mono-num text-[11px]">
                    {isZone
                      ? hud.inZone
                        ? `${hud.zoneRemaining.toFixed(1)}с`
                        : zoneReady
                          ? 'Готово'
                          : `${Math.round(hud.zoneCharge)}%`
                      : cd > 0
                        ? `${cd.toFixed(1)}с`
                        : 'Готово'}
                  </span>
                </div>
                <div className="text-xs font-semibold whitespace-nowrap">
                  {sk.nameRu}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
