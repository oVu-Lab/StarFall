import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { SHIP_CONFIGS } from '../config/ships';
import type { LoadingProgress } from '../types/game';

interface LoadingScreenProps {
  progress: LoadingProgress;
  onCancel?: () => void;
  onRetry?: () => void;
}

export function LoadingScreen({ progress, onCancel, onRetry }: LoadingScreenProps) {
  const ship = SHIP_CONFIGS[progress.shipId];
  const hasError = Boolean(progress.error);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#030712]/90 p-6">
      <div className="w-full max-w-md border border-cyan-500/30 bg-[#050c1d]/96 p-7">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="font-display text-xl font-bold tracking-widest text-slate-100">
              {progress.missionCode ? `${progress.missionCode} · ${progress.missionName}` : 'STARFALL'}
            </h2>
            {progress.sectorName && (
              <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                {progress.sectorName}
              </p>
            )}
          </div>
          {!hasError && (
            <span className="font-mono text-xs tabular-nums text-cyan-300">
              {Math.round(progress.percent)}%
            </span>
          )}
        </div>

        {hasError ? (
          <div className="mt-5">
            <div className="flex items-start gap-2.5 border border-red-500/40 bg-red-950/35 p-3.5 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div>
                <div className="font-semibold">Mission Asset Load Failed</div>
                <p className="mt-1 text-red-200/80">{progress.error}</p>
              </div>
            </div>
            <div className="mt-4 flex gap-2.5">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="flex flex-1 items-center justify-center gap-2 bg-cyan-500 px-4 py-2.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-400"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Retry Load</span>
                </button>
              )}
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="border border-slate-700 bg-[#081226] px-4 py-2.5 text-xs font-medium text-slate-200 transition-colors hover:border-cyan-400/60"
                >
                  Mission Select
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 h-1.5 w-full overflow-hidden bg-slate-800">
              <div
                className="h-full origin-left bg-cyan-400 transition-transform duration-150"
                style={{ transform: `scaleX(${Math.max(0.05, progress.percent / 100)})` }}
              />
            </div>

            <div className="mt-4 flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between text-slate-300">
                <span>Selected Craft</span>
                <span className="font-mono text-slate-100">
                  {ship.callsign} · {ship.name}
                </span>
              </div>
              <p className="mt-2 border-t border-slate-800 pt-2.5 font-mono text-[11px] text-cyan-300/90">
                {progress.stage}
              </p>
            </div>

            {onCancel && (
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex items-center gap-1.5 border border-slate-700/80 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Cancel</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
