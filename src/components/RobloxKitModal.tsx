import { useState } from 'react';
import { Check, Copy, Download, X } from 'lucide-react';
import { ROBLOX_LUAU_SCRIPTS } from '../data/robloxLuauScripts';

interface RobloxKitModalProps {
  onClose: () => void;
}

export function RobloxKitModal({ onClose }: RobloxKitModalProps) {
  const [activeId, setActiveId] = useState(ROBLOX_LUAU_SCRIPTS[0].id);
  const [copied, setCopied] = useState(false);

  const activeFile =
    ROBLOX_LUAU_SCRIPTS.find((f) => f.id === activeId) ?? ROBLOX_LUAU_SCRIPTS[0];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback ignored in restricted frames
    }
  };

  const handleDownload = () => {
    const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-4 md:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="roblox-kit-title"
        className="w-full max-w-4xl max-h-[88vh] flex flex-col bg-[#0B0E14] border border-white/15 rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-white/10">
          <div>
            <h2 id="roblox-kit-title" className="font-display text-2xl font-bold text-white">
              Roblox Studio Luau Kit — Акаши, Аомине, Куроко
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Готовые скрипты для переноса механик Basketball Zero в твой плейс в Roblox Studio
            </p>
          </div>
          <button
            type="button"
            aria-label="Закрыть окно Roblox Studio кода"
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/12 flex items-center justify-center text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* File Tabs */}
        <div className="flex items-center gap-1.5 px-5 py-2.5 bg-[#0F141F] border-b border-white/10 overflow-x-auto">
          {ROBLOX_LUAU_SCRIPTS.map((file) => {
            const active = file.id === activeFile.id;
            return (
              <button
                key={file.id}
                type="button"
                onClick={() => {
                  setActiveId(file.id);
                  setCopied(false);
                }}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  active
                    ? 'bg-sky-500 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:text-white hover:bg-white/8'
                }`}
              >
                {file.filename}
              </button>
            );
          })}
        </div>

        {/* File Location & Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-[#111723] border-b border-white/10">
          <div className="text-xs">
            <div className="font-semibold text-slate-200">{activeFile.location}</div>
            <div className="text-slate-400 mt-0.5">{activeFile.summary}</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold bg-white/10 hover:bg-white/15 text-white cursor-pointer whitespace-nowrap"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Скопировано
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Копировать код
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Скачать
            </button>
          </div>
        </div>

        {/* Scrollable Code Block */}
        <pre className="flex-1 overflow-auto p-5 text-xs leading-relaxed font-mono text-slate-200 bg-[#080B10] m-0">
          <code>{activeFile.content}</code>
        </pre>
      </div>
    </div>
  );
}
