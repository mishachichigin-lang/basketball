import { Code2, Play, RotateCcw } from 'lucide-react';
import type { HudSnapshot } from '../game/BasketballEngine';

interface PauseModalProps {
  onResume: () => void;
  onRestart: () => void;
  onTitle: () => void;
  onOpenRobloxKit: () => void;
}

export function PauseModal({
  onResume,
  onRestart,
  onTitle,
  onOpenRobloxKit,
}: PauseModalProps) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/65 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-title"
        className="w-full max-w-sm bg-[#0E131D] border border-white/15 rounded-xl p-6 shadow-2xl"
      >
        <h2 id="pause-title" className="font-display text-3xl font-bold text-white mb-1">
          Пауза
        </h2>
        <p className="text-xs text-slate-400 mb-5">
          Матч приостановлен. Нажмите Esc или P, чтобы вернуться на площадку.
        </p>

        <div className="space-y-2.5">
          <button
            type="button"
            onClick={onResume}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm text-white bg-[#E11D48] hover:bg-[#BE123C] cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" aria-hidden="true" />
            Продолжить
          </button>

          <button
            type="button"
            onClick={onRestart}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm text-slate-100 bg-[#182030] hover:bg-[#222D42] border border-white/10 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            Начать заново
          </button>

          <button
            type="button"
            onClick={onOpenRobloxKit}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm text-slate-100 bg-[#182030] hover:bg-[#222D42] border border-white/10 cursor-pointer"
          >
            <Code2 className="w-4 h-4 text-sky-400" aria-hidden="true" />
            Roblox Luau Скрипты
          </button>

          <button
            type="button"
            onClick={onTitle}
            className="w-full px-4 py-2.5 rounded-lg font-medium text-sm text-slate-300 hover:text-white hover:bg-white/5 cursor-pointer"
          >
            Выбор персонажа
          </button>
        </div>
      </div>
    </div>
  );
}

interface GameOverModalProps {
  hud: HudSnapshot;
  onPlayAgain: () => void;
  onTitle: () => void;
}

export function GameOverModal({ hud, onPlayAgain, onTitle }: GameOverModalProps) {
  const isWin = hud.winner === hud.localTeam;
  const isDraw = hud.winner === 'draw';
  const accuracyPct =
    hud.shotsAttempted > 0 ? Math.round((hud.shotsMade / hud.shotsAttempted) * 100) : 0;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gameover-title"
        className="w-full max-w-md bg-[#0E131D] border border-white/15 rounded-xl p-6 shadow-2xl"
      >
        <div className="text-xs font-semibold uppercase tracking-wider text-sky-400 mb-1">
          Финальная сирена
        </div>
        <h2 id="gameover-title" className="font-display text-4xl font-extrabold text-white mb-4">
          {isWin ? 'Победа команды' : isDraw ? 'Ничья' : 'Поражение'}
        </h2>

        <div className="grid grid-cols-3 gap-2.5 mb-6">
          <div className="bg-[#151C2B] border border-white/10 rounded-lg p-3">
            <div className="text-[11px] text-slate-400">Счёт</div>
            <div className="font-display text-2xl font-bold text-white tabular-nums mt-0.5">
              {hud.homeScore} : {hud.awayScore}
            </div>
          </div>

          <div className="bg-[#151C2B] border border-white/10 rounded-lg p-3">
            <div className="text-[11px] text-slate-400">Точность</div>
            <div className="font-display text-2xl font-bold text-emerald-400 tabular-nums mt-0.5">
              {accuracyPct}%
            </div>
          </div>

          <div className="bg-[#151C2B] border border-white/10 rounded-lg p-3">
            <div className="text-[11px] text-slate-400">Ankle / Отборы</div>
            <div className="font-display text-2xl font-bold text-amber-400 tabular-nums mt-0.5">
              {hud.ankleBreaksCount + hud.stealsCount}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            data-start="true"
            onClick={onPlayAgain}
            className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-semibold text-sm text-white bg-[#E11D48] hover:bg-[#BE123C] cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            Играть снова
          </button>

          <button
            type="button"
            onClick={onTitle}
            className="px-4 py-3 rounded-lg font-medium text-sm text-slate-200 bg-[#182030] hover:bg-[#222D42] border border-white/10 cursor-pointer"
          >
            Стили
          </button>
        </div>
      </div>
    </div>
  );
}
