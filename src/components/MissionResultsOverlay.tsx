import { ArrowRight, CheckCircle2, Home, List, RotateCcw, ShieldAlert } from 'lucide-react';
import { AudioManager } from '../audio/AudioManager';
import { DIFFICULTY_PROFILES } from '../config/difficulty';
import type { MissionRank } from '../types/game';
import type { MissionResult } from '../types/mission';

interface MissionResultsOverlayProps {
  result: MissionResult;
  onNextMission: (() => void) | null;
  onRetryMission: () => void;
  onMissionSelect: () => void;
  onMainMenu: () => void;
}

const RANK_COLORS: Record<MissionRank, string> = {
  S: 'border-cyan-400 bg-cyan-500/20 text-cyan-200',
  A: 'border-sky-400 bg-sky-500/15 text-sky-200',
  B: 'border-slate-400 bg-slate-700/35 text-slate-100',
  C: 'border-amber-400 bg-amber-500/15 text-amber-200',
};

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const tenths = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

export function MissionResultsOverlay({
  result,
  onNextMission,
  onRetryMission,
  onMissionSelect,
  onMainMenu,
}: MissionResultsOverlayProps) {
  const isVictory = result.status === 'completed';
  const breakdown = result.scoreBreakdown;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#030712]/84 p-5 overflow-y-auto">
      <div className="w-full max-w-2xl border border-slate-700/90 bg-[#050c1d]/96 p-6 sm:p-8">
        {/* Header Row */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="flex items-center gap-2 font-mono text-xs tracking-wider">
              {isVictory ? (
                <CheckCircle2 className="h-4 w-4 text-cyan-400" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-red-400" />
              )}
              <span className={isVictory ? 'text-cyan-300' : 'text-red-400'}>
                {isVictory ? 'MISSION COMPLETED' : 'MISSION FAILED'}
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-slate-400">
                {DIFFICULTY_PROFILES[result.difficulty].label.toUpperCase()}
              </span>
            </div>
            <h2 className="mt-1 font-display text-3xl font-bold tracking-wide text-slate-50">
              M-{String(result.missionNumber).padStart(2, '0')} · {result.missionName}
            </h2>
          </div>

          {isVictory && result.rank ? (
            <div className="flex flex-col items-center">
              <div
                className={`flex h-16 w-16 items-center justify-center border-2 font-display text-4xl font-bold ${RANK_COLORS[result.rank]}`}
              >
                {result.rank}
              </div>
              <span className="mt-1 font-mono text-[10px] tracking-widest text-slate-400">
                {result.isNewBestRank ? 'NEW BEST RANK' : 'FINAL RANK'}
              </span>
            </div>
          ) : (
            <div className="border border-red-500/50 bg-red-950/40 px-4 py-2 font-display text-lg font-bold tracking-wider text-red-300">
              HULL LOST
            </div>
          )}
        </div>

        {/* Unlock Notification Banner */}
        {isVictory && result.unlockedNextMissionName && (
          <div className="mt-4 flex items-center justify-between border border-cyan-500/40 bg-cyan-950/35 px-4 py-2.5 text-xs text-cyan-200">
            <span>Next Operation Unlocked: <strong>{result.unlockedNextMissionName}</strong></span>
            <span className="font-mono text-[11px] text-cyan-300">READY</span>
          </div>
        )}

        {/* Primary Telemetry Stats Grid */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="border border-slate-800 bg-[#081226] px-3.5 py-3">
            <div className="text-[11px] text-slate-400">Enemies Defeated</div>
            <div className="mt-1 font-mono text-base font-semibold text-slate-100">
              {result.enemiesDefeated} / {result.totalEnemies}
            </div>
          </div>
          <div className="border border-slate-800 bg-[#081226] px-3.5 py-3">
            <div className="text-[11px] text-slate-400">Accuracy</div>
            <div className="mt-1 font-mono text-base font-semibold text-cyan-300">
              {result.accuracyPct}%
            </div>
            <div className="font-mono text-[10px] text-slate-500">
              {result.shotsHit} / {result.shotsFired} hits
            </div>
          </div>
          <div className="border border-slate-800 bg-[#081226] px-3.5 py-3">
            <div className="text-[11px] text-slate-400">Time Taken</div>
            <div className="mt-1 font-mono text-base font-semibold text-slate-100">
              {formatDuration(result.timeTakenSec)}
            </div>
          </div>
          <div className="border border-slate-800 bg-[#081226] px-3.5 py-3">
            <div className="text-[11px] text-slate-400">Damage Received</div>
            <div className="mt-1 font-mono text-base font-semibold text-orange-300">
              {result.damageReceived}
            </div>
            <div className="font-mono text-[10px] text-slate-500">
              Hull {result.remainingHullPct}%
            </div>
          </div>
        </div>

        {/* Deterministic Score Breakdown */}
        <div className="mt-5 border border-slate-800 bg-[#071022] p-4">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-xs tracking-wider text-slate-400">
              PERFORMANCE BREAKDOWN
            </span>
            <span className="font-mono text-sm font-bold text-cyan-300">
              {breakdown.totalScore} / 1000 PTS
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs sm:grid-cols-4">
            <div>
              <div className="flex justify-between text-slate-400">
                <span>Combat</span>
                <span className="font-mono text-slate-200">{breakdown.combatScore}/400</span>
              </div>
              <div className="mt-1 h-1.5 bg-slate-800">
                <div
                  className="h-full bg-cyan-400"
                  style={{ width: `${(breakdown.combatScore / 400) * 100}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-slate-400">
                <span>Accuracy</span>
                <span className="font-mono text-slate-200">{breakdown.accuracyScore}/250</span>
              </div>
              <div className="mt-1 h-1.5 bg-slate-800">
                <div
                  className="h-full bg-sky-400"
                  style={{ width: `${(breakdown.accuracyScore / 250) * 100}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-slate-400">
                <span>Survival</span>
                <span className="font-mono text-slate-200">{breakdown.survivalScore}/200</span>
              </div>
              <div className="mt-1 h-1.5 bg-slate-800">
                <div
                  className="h-full bg-emerald-400"
                  style={{ width: `${(breakdown.survivalScore / 200) * 100}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-slate-400">
                <span>Speed</span>
                <span className="font-mono text-slate-200">{breakdown.timeScore}/150</span>
              </div>
              <div className="mt-1 h-1.5 bg-slate-800">
                <div
                  className="h-full bg-amber-400"
                  style={{ width: `${(breakdown.timeScore / 150) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {isVictory && onNextMission && (
            <button
              type="button"
              onMouseEnter={() => AudioManager.playUiHover()}
              onClick={() => {
                AudioManager.unlock();
                AudioManager.playUiClick('primary');
                onNextMission();
              }}
              className="flex items-center justify-center gap-2 bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 sm:col-span-2"
            >
              <span>Next Mission</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.unlock();
              AudioManager.playUiClick(isVictory ? 'secondary' : 'primary');
              onRetryMission();
            }}
            className={`flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold transition-colors ${
              isVictory && onNextMission
                ? 'border border-slate-700 bg-[#081226] text-slate-100 hover:border-cyan-400/60 hover:text-cyan-200'
                : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400 sm:col-span-2'
            }`}
          >
            <RotateCcw className="h-4 w-4" />
            <span>Retry Mission</span>
          </button>

          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('secondary');
              onMissionSelect();
            }}
            className="flex items-center justify-center gap-2 border border-slate-700 bg-[#081226] px-5 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-cyan-400/60 hover:text-cyan-200"
          >
            <List className="h-4 w-4 text-cyan-400" />
            <span>Mission Select</span>
          </button>

          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('secondary');
              onMainMenu();
            }}
            className="flex items-center justify-center gap-2 border border-slate-800 bg-transparent px-5 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-100 sm:col-span-2"
          >
            <Home className="h-4 w-4" />
            <span>Main Menu</span>
          </button>
        </div>
      </div>
    </div>
  );
}
