import { useState } from 'react';
import { Home, List, Play, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { AudioManager } from '../audio/AudioManager';
import type { GameSettings } from '../types/game';
import { SettingsPanel } from './SettingsPanel';

interface PauseOverlayProps {
  missionLabel?: string;
  settings: GameSettings;
  onUpdateSettings: (patch: Partial<GameSettings>) => void;
  onResume: () => void;
  onRestartMission: () => void;
  onMissionSelect: () => void;
  onReturnToMenu: () => void;
}

export function PauseOverlay({
  missionLabel,
  settings,
  onUpdateSettings,
  onResume,
  onRestartMission,
  onMissionSelect,
  onReturnToMenu,
}: PauseOverlayProps) {
  const [showSettings, setShowSettings] = useState(false);

  if (showSettings) {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#030712]/72 p-6">
        <SettingsPanel
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          onClose={() => setShowSettings(false)}
          closeLabel="Back to Pause Menu"
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#030712]/72 p-6">
      <div className="w-full max-w-sm border border-cyan-500/30 bg-[#050c1d]/96 p-7">
        <div className="border-b border-slate-800 pb-4">
          {missionLabel && (
            <div className="font-mono text-[11px] tracking-wider text-cyan-300">
              {missionLabel}
            </div>
          )}
          <h2 className="mt-0.5 font-display text-2xl font-bold tracking-wider text-slate-100">
            Flight Paused
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Pointer Lock released. Resume to re-engage continuous mouse flight.
          </p>
        </div>

        <div className="mt-5 flex flex-col gap-2.5">
          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.unlock();
              AudioManager.playUiClick('primary');
              onResume();
            }}
            className="flex items-center justify-center gap-2.5 bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-300"
          >
            <Play className="h-4 w-4 fill-current" />
            <span>Resume Flight</span>
          </button>

          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('secondary');
              setShowSettings(true);
            }}
            className="flex items-center justify-center gap-2.5 border border-slate-700 bg-[#081226] px-5 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-cyan-400/60 hover:text-cyan-200"
          >
            <SlidersHorizontal className="h-4 w-4 text-cyan-400" />
            <span>Settings</span>
          </button>

          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('secondary');
              onRestartMission();
            }}
            className="flex items-center justify-center gap-2.5 border border-slate-700 bg-[#081226] px-5 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-cyan-400/60 hover:text-cyan-200"
          >
            <RotateCcw className="h-4 w-4 text-cyan-400" />
            <span>Restart Mission</span>
          </button>

          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('secondary');
              onMissionSelect();
            }}
            className="flex items-center justify-center gap-2.5 border border-slate-700 bg-[#081226] px-5 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-cyan-400/60 hover:text-cyan-200"
          >
            <List className="h-4 w-4 text-cyan-400" />
            <span>Mission Select</span>
          </button>

          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('pause');
              onReturnToMenu();
            }}
            className="flex items-center justify-center gap-2.5 border border-slate-800 bg-transparent px-5 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-100"
          >
            <Home className="h-4 w-4" />
            <span>Main Menu</span>
          </button>
        </div>
      </div>
    </div>
  );
}
