import { motion } from 'motion/react';
import {
  ArrowRight,
  CheckCircle2,
  Coins,
  Home,
  List,
  RotateCcw,
  ShieldAlert,
  Trophy,
} from 'lucide-react';
import { AudioManager } from '../audio/AudioManager';
import { DIFFICULTY_PROFILES } from '../config/difficulty';
import type { MissionRank } from '../types/game';
import type { MissionResult } from '../types/mission';
import {
  ObsidianCorners,
  ObsidianEnergySpine,
  ObsidianGauge,
  TECH_EASE,
} from './ui/ObsidianUI';

interface MissionResultsOverlayProps {
  result: MissionResult;
  onNextMission: (() => void) | null;
  onRetryMission: () => void;
  onMissionSelect: () => void;
  onMainMenu: () => void;
}

const RANK_STYLE: Record<MissionRank, string> = {
  S: 'border-[#38bdf8] text-[#bae6fd] shadow-[0_0_28px_rgba(56,189,248,0.28)]',
  A: 'border-sky-400/80 text-sky-200 shadow-[0_0_20px_rgba(56,189,248,0.18)]',
  B: 'border-slate-400/70 text-slate-100',
  C: 'border-amber-400/80 text-amber-200',
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
    <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-[#02040a]/86 p-4 sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: TECH_EASE }}
        className="obsidian-monolith obsidian-scroll relative max-h-[92vh] w-full max-w-2xl overflow-y-auto p-6 sm:p-7"
      >
        <ObsidianEnergySpine orientation="horizontal" />
        <ObsidianCorners />

        {/* Header + Dramatic Rank Crest */}
        <div className="obsidian-scan relative flex flex-wrap items-center justify-between gap-4 overflow-hidden border-b border-white/10 pb-5">
          <div>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em]">
              {isVictory ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-[#38bdf8]" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
              )}
              <span className={isVictory ? 'text-[#38bdf8]' : 'text-rose-400'}>
                {isVictory ? 'Operation Cleared' : 'Operation Failed'}
              </span>
              <span className="text-slate-600">/</span>
              <span className="text-slate-400">
                {DIFFICULTY_PROFILES[result.difficulty].label}
              </span>
            </div>
            <h2 className="mt-1 font-display text-2xl font-bold tracking-wider text-slate-50 sm:text-3xl">
              M-{String(result.missionNumber).padStart(2, '0')} · {result.missionName}
            </h2>
          </div>

          {isVictory && result.rank ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.88 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.32, delay: 0.1, ease: TECH_EASE }}
              className="flex flex-col items-center"
            >
              <div
                className={`obsidian-surface obsidian-scan flex h-16 w-16 items-center justify-center border-2 font-display text-4xl font-bold ${RANK_STYLE[result.rank]}`}
              >
                {result.rank}
              </div>
              <span className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-slate-400">
                {result.isNewBestRank ? 'New Best' : 'Rank'}
              </span>
            </motion.div>
          ) : (
            <div className="obsidian-surface border-rose-500/60 px-4 py-2 font-display text-base font-bold uppercase tracking-[0.16em] text-rose-300">
              {result.transportRemainingHullPct === 0 ? 'Transport Lost' : 'Hull Lost'}
            </div>
          )}
        </div>

        {/* Next Operation Unlock Strip */}
        {isVictory && result.unlockedNextMissionName && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.24, delay: 0.08, ease: TECH_EASE }}
            className="obsidian-surface obsidian-scan mt-4 flex items-center justify-between border-l-2 border-l-[#38bdf8] px-4 py-2.5 font-mono text-xs text-[#bae6fd]"
          >
            <span>
              UNLOCKED // <strong className="text-slate-50">{result.unlockedNextMissionName}</strong>
            </span>
            <span className="text-[10px] tracking-[0.2em] text-[#38bdf8]">READY</span>
          </motion.div>
        )}

        {/* Inline Telemetry Readout Strip (No boxed dashboard cards) */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, delay: 0.06, ease: TECH_EASE }}
          className={`mt-5 grid grid-cols-2 gap-4 border-y border-white/8 py-3.5 font-mono ${
            result.transportRemainingHullPct != null ? 'sm:grid-cols-5' : 'sm:grid-cols-4'
          }`}
        >
          <div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-slate-500">Hostiles</div>
            <div className="mt-1 text-base font-semibold tabular-nums text-slate-100">
              {result.enemiesDefeated}/{result.totalEnemies}
            </div>
          </div>

          {result.transportRemainingHullPct != null && (
            <div>
              <div className="text-[9px] uppercase tracking-[0.2em] text-amber-300/80">Transport</div>
              <div className="mt-1 text-base font-semibold tabular-nums text-amber-200">
                {result.transportRemainingHullPct}%
              </div>
              <div className="text-[9px] text-slate-500">
                {result.status === 'completed' ? 'EXTRACTED' : 'LOST'}
              </div>
            </div>
          )}

          <div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-slate-500">Accuracy</div>
            <div className="mt-1 text-base font-semibold tabular-nums text-[#38bdf8]">
              {result.accuracyPct}%
            </div>
            <div className="text-[9px] tabular-nums text-slate-500">
              {result.shotsHit}/{result.shotsFired} HITS
            </div>
          </div>

          <div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-slate-500">Time</div>
            <div className="mt-1 text-base font-semibold tabular-nums text-slate-100">
              {formatDuration(result.timeTakenSec)}
            </div>
          </div>

          <div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-slate-500">Damage</div>
            <div className="mt-1 text-base font-semibold tabular-nums text-amber-300">
              {result.damageReceived}
            </div>
            <div className="text-[9px] tabular-nums text-slate-500">
              HULL {result.remainingHullPct}%
            </div>
          </div>
        </motion.div>

        {/* Credits & Achievement Rewards */}
        {result.rewardSummary && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, delay: 0.12, ease: TECH_EASE }}
            className="obsidian-surface obsidian-scan mt-4 border-l-2 border-l-[#38bdf8] p-4"
          >
            <div className="flex items-baseline justify-between gap-3 font-mono">
              <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-slate-400">
                <Coins className="h-3.5 w-3.5 text-[#38bdf8]" />
                <span>Credits Earned</span>
              </span>
              <div className="flex items-baseline gap-3">
                <span className="text-lg font-bold tabular-nums text-[#38bdf8]">
                  +{result.rewardSummary.creditsEarned.toLocaleString()} CR
                </span>
                <span className="text-[11px] tabular-nums text-slate-400">
                  BAL {result.rewardSummary.creditsBalance.toLocaleString()} CR
                </span>
              </div>
            </div>

            {result.rewardSummary.creditsEarned > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-white/8 pt-2.5 font-mono text-[11px] text-slate-300">
                {result.rewardSummary.firstClear > 0 && (
                  <div className="flex justify-between">
                    <span>First Clear</span>
                    <span className="tabular-nums text-[#bae6fd]">
                      +{result.rewardSummary.firstClear} CR
                    </span>
                  </div>
                )}
                {result.rewardSummary.rankImprovement > 0 && (
                  <div className="flex justify-between">
                    <span>Rank Bonus</span>
                    <span className="tabular-nums text-[#bae6fd]">
                      +{result.rewardSummary.rankImprovement} CR
                    </span>
                  </div>
                )}
                {result.rewardSummary.optionalRewards.map((reward) => (
                  <div key={reward.id} className="flex justify-between">
                    <span>Optional Objective</span>
                    <span className="tabular-nums text-[#bae6fd]">+{reward.credits} CR</span>
                  </div>
                ))}
                {result.rewardSummary.achievementRewards.map((reward) => (
                  <div key={reward.id} className="flex items-center justify-between text-amber-200">
                    <span className="flex items-center gap-1.5">
                      <Trophy className="h-3 w-3 text-amber-400" />
                      <span>{reward.name}</span>
                    </span>
                    <span className="tabular-nums text-amber-300">+{reward.credits} CR</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* Compact Score Breakdown Gauges */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, delay: 0.16, ease: TECH_EASE }}
          className="mt-5"
        >
          <div className="flex items-baseline justify-between font-mono">
            <span className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
              Score Breakdown
            </span>
            <span className="text-sm font-bold tabular-nums text-[#38bdf8]">
              {breakdown.totalScore} / 1000
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-5">
            <ObsidianGauge
              label="Primary"
              valueText={`${breakdown.requiredObjectiveScore}/400`}
              percent={breakdown.requiredObjectiveScore / 4}
            />
            <ObsidianGauge
              label="Optional"
              valueText={`${breakdown.optionalObjectiveScore}/200`}
              percent={breakdown.optionalObjectiveScore / 2}
              accentClass="from-sky-600 via-sky-400 to-sky-200"
            />
            <ObsidianGauge
              label="Combat"
              valueText={`${breakdown.combatScore}/100`}
              percent={breakdown.combatScore}
            />
            <ObsidianGauge
              label="Survival"
              valueText={`${breakdown.survivalScore}/200`}
              percent={(breakdown.survivalScore / 200) * 100}
              accentClass="from-emerald-600 via-emerald-400 to-emerald-200"
            />
            <ObsidianGauge
              label="Speed"
              valueText={`${breakdown.timeScore}/100`}
              percent={breakdown.timeScore}
              accentClass="from-amber-600 via-amber-400 to-amber-200"
            />
          </div>
        </motion.div>

        {/* Action Controls */}
        <div className="mt-6 grid grid-cols-1 gap-2.5 border-t border-white/8 pt-5 sm:grid-cols-2">
          {isVictory && onNextMission && (
            <button
              type="button"
              onMouseEnter={() => AudioManager.playUiHover()}
              onClick={() => {
                AudioManager.unlock();
                AudioManager.playUiClick('primary');
                onNextMission();
              }}
              className="obsidian-cta-primary obsidian-scan group flex items-center justify-center gap-2 px-5 py-3 font-display text-sm font-bold uppercase tracking-[0.18em] text-[#e0f2fe] sm:col-span-2"
            >
              <span>Next Operation</span>
              <ArrowRight className="h-4 w-4 text-[#38bdf8] transition-transform duration-150 group-hover:translate-x-0.5" />
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
            className={`flex items-center justify-center gap-2 px-5 py-2.5 font-display text-xs font-bold uppercase tracking-[0.16em] ${
              isVictory && onNextMission
                ? 'obsidian-surface obsidian-surface-interactive text-slate-200 hover:text-[#e0f2fe]'
                : 'obsidian-cta-primary obsidian-scan text-[#e0f2fe] sm:col-span-2'
            }`}
          >
            <RotateCcw className="h-3.5 w-3.5 text-[#38bdf8]" />
            <span>Retry</span>
          </button>

          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('secondary');
              onMissionSelect();
            }}
            className="obsidian-surface obsidian-surface-interactive flex items-center justify-center gap-2 px-5 py-2.5 font-display text-xs font-semibold uppercase tracking-[0.16em] text-slate-200 hover:text-[#e0f2fe]"
          >
            <List className="h-3.5 w-3.5 text-[#38bdf8]" />
            <span>Operations</span>
          </button>

          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('secondary');
              onMainMenu();
            }}
            className="flex items-center justify-center gap-2 pt-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400 transition-colors hover:text-slate-100 sm:col-span-2"
          >
            <Home className="h-3.5 w-3.5" />
            <span>Main Menu</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
