import { motion } from 'motion/react';
import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { SHIP_CONFIGS } from '../config/ships';
import type { LoadingProgress } from '../types/game';
import { ObsidianCorners, ObsidianEnergySpine, TECH_EASE } from './ui/ObsidianUI';

interface LoadingScreenProps {
  progress: LoadingProgress;
  onCancel?: () => void;
  onRetry?: () => void;
}

export function LoadingScreen({ progress, onCancel, onRetry }: LoadingScreenProps) {
  const ship = SHIP_CONFIGS[progress.shipId];
  const hasError = Boolean(progress.error);
  const clampedPct = Math.max(4, Math.min(100, Math.round(progress.percent)));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#02040a]/90 p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: TECH_EASE }}
        className="obsidian-monolith obsidian-scan relative w-full max-w-md overflow-hidden p-6 sm:p-7"
      >
        <ObsidianEnergySpine orientation="horizontal" />
        <ObsidianCorners />

        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            {progress.sectorName && (
              <div className="truncate font-mono text-[10px] uppercase tracking-[0.24em] text-[#38bdf8]">
                {progress.sectorName}
              </div>
            )}
            <h2 className="mt-1 truncate font-display text-2xl font-bold tracking-wider text-slate-50">
              {progress.missionCode ? `${progress.missionCode} · ${progress.missionName}` : 'STARFALL'}
            </h2>
          </div>

          {!hasError && (
            <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-[#38bdf8]">
              {clampedPct}%
            </span>
          )}
        </div>

        {hasError ? (
          <div className="mt-5 flex flex-col gap-4">
            <div className="obsidian-surface flex items-start gap-2.5 border-l-2 border-l-rose-400 p-3.5 text-xs text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <div>
                <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-rose-300">
                  Sector Load Failed
                </div>
                <p className="mt-1 text-rose-200/80">{progress.error}</p>
              </div>
            </div>

            <div className="flex gap-2.5">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="obsidian-cta-primary obsidian-scan flex flex-1 items-center justify-center gap-2 px-4 py-2.5 font-display text-xs font-bold uppercase tracking-[0.16em] text-[#e0f2fe]"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-[#38bdf8]" />
                  <span>Retry</span>
                </button>
              )}
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="obsidian-surface obsidian-surface-interactive px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-slate-300 hover:text-[#38bdf8]"
                >
                  Back
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Precision Energy Progress Track */}
            <div className="mt-5 h-[3px] w-full overflow-hidden bg-slate-800/80">
              <div
                className="h-full origin-left bg-gradient-to-r from-[#0284c7] via-[#38bdf8] to-[#bae6fd] shadow-[0_0_12px_rgba(56,189,248,0.65)] transition-transform duration-150"
                style={{ transform: `scaleX(${clampedPct / 100})` }}
              />
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-white/8 pt-3 font-mono text-[11px]">
              <span className="truncate text-[#38bdf8]/90">{progress.stage}</span>
              <span className="ml-3 shrink-0 text-slate-400">{ship.callsign}</span>
            </div>

            {onCancel && (
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500 transition-colors hover:text-[#38bdf8]"
                >
                  <X className="h-3 w-3" />
                  <span>Abort</span>
                </button>
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
