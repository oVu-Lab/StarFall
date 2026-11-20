import { useState } from 'react';
import { motion } from 'motion/react';
import { Home, List, Play, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { AudioManager } from '../audio/AudioManager';
import type { GameSettings } from '../types/game';
import { SettingsPanel } from './SettingsPanel';
import { ObsidianCorners, ObsidianEnergySpine, TECH_EASE } from './ui/ObsidianUI';

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
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#02040a]/78 p-5 sm:p-6">
        <SettingsPanel
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          onClose={() => setShowSettings(false)}
          closeLabel="Back"
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#02040a]/75 p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: TECH_EASE }}
        className="obsidian-monolith obsidian-scan relative w-full max-w-xs overflow-hidden"
      >
        <ObsidianEnergySpine orientation="vertical" side="left" />
        <ObsidianCorners />

        <div className="border-b border-white/8 px-6 py-5">
          {missionLabel && (
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#38bdf8]">
              {missionLabel}
            </div>
          )}
          <h2 className="mt-1 font-display text-2xl font-bold uppercase tracking-[0.14em] text-slate-50">
            Paused
          </h2>
        </div>

        <div className="flex flex-col p-4 gap-2">
          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.unlock();
              AudioManager.playUiClick('primary');
              onResume();
            }}
            className="obsidian-cta-primary obsidian-scan group flex items-center justify-center gap-2.5 px-5 py-3 font-display text-sm font-bold uppercase tracking-[0.18em] text-[#e0f2fe] focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
          >
            <Play className="h-4 w-4 fill-[#38bdf8] text-[#38bdf8] transition-transform duration-150 group-hover:translate-x-0.5" />
            <span>Resume</span>
          </button>

          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('secondary');
              setShowSettings(true);
            }}
            className="obsidian-surface obsidian-surface-interactive flex items-center justify-between px-4 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-slate-200 hover:text-[#e0f2fe]"
          >
            <span className="flex items-center gap-2.5 font-display">
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#38bdf8]" />
              <span>Settings</span>
            </span>
            <span className="font-mono text-[10px] text-slate-500">SYS</span>
          </button>

          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('secondary');
              onRestartMission();
            }}
            className="obsidian-surface obsidian-surface-interactive flex items-center justify-between px-4 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-slate-200 hover:text-[#e0f2fe]"
          >
            <span className="flex items-center gap-2.5 font-display">
              <RotateCcw className="h-3.5 w-3.5 text-[#38bdf8]" />
              <span>Restart</span>
            </span>
            <span className="font-mono text-[10px] text-slate-500">OP</span>
          </button>

          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('secondary');
              onMissionSelect();
            }}
            className="obsidian-surface obsidian-surface-interactive flex items-center justify-between px-4 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-slate-200 hover:text-[#e0f2fe]"
          >
            <span className="flex items-center gap-2.5 font-display">
              <List className="h-3.5 w-3.5 text-[#38bdf8]" />
              <span>Operations</span>
            </span>
            <span className="font-mono text-[10px] text-slate-500">MAP</span>
          </button>

          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('pause');
              onReturnToMenu();
            }}
            className="mt-1 flex items-center justify-center gap-2 border-t border-white/8 pt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400 transition-colors hover:text-slate-100"
          >
            <Home className="h-3.5 w-3.5" />
            <span>Main Menu</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
