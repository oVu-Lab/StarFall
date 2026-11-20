import { ArrowLeft, CheckCircle2, Crosshair, Lock, Play, ShieldAlert, Trophy } from 'lucide-react';
import { AudioManager } from '../audio/AudioManager';
import { DIFFICULTY_PROFILES } from '../config/difficulty';
import { CAMPAIGN_MISSIONS } from '../config/missions';
import { isMissionUnlocked } from '../engine/mission/CampaignProgressStore';
import type { MissionRank } from '../types/game';
import type { CampaignSaveData, MissionDefinition } from '../types/mission';

interface MissionSelectViewProps {
  campaignSave: CampaignSaveData;
  selectedMissionId: string;
  onSelectMission: (missionId: string) => void;
  onLaunchMission: (mission: MissionDefinition) => void;
  onBack: () => void;
}

const RANK_STYLE: Record<MissionRank, string> = {
  S: 'border-cyan-400/70 bg-cyan-500/20 text-cyan-200',
  A: 'border-sky-400/60 bg-sky-500/15 text-sky-200',
  B: 'border-slate-500/70 bg-slate-700/35 text-slate-200',
  C: 'border-amber-500/60 bg-amber-500/15 text-amber-200',
};

function formatTime(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function MissionSelectView({
  campaignSave,
  selectedMissionId,
  onSelectMission,
  onLaunchMission,
  onBack,
}: MissionSelectViewProps) {
  const selected =
    CAMPAIGN_MISSIONS.find((m) => m.id === selectedMissionId) ?? CAMPAIGN_MISSIONS[0];
  const selectedRecord = campaignSave.missions[selected.id];
  const selectedUnlocked = isMissionUnlocked(selected, campaignSave);
  const unlockRequirement = selected.unlockRequirementId
    ? CAMPAIGN_MISSIONS.find((mission) => mission.id === selected.unlockRequirementId)
    : null;
  const completedCount = CAMPAIGN_MISSIONS.filter((m) => campaignSave.missions[m.id]?.completed).length;

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between bg-[#030712]/76 p-5 sm:p-8 lg:p-10">
      {/* Top Bar */}
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 border-b border-slate-800/90 pb-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('secondary');
              onBack();
            }}
            className="flex items-center gap-2 border border-slate-700/80 bg-[#050c1d]/90 px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-cyan-400/60 hover:text-cyan-200 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Main Menu</span>
          </button>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-wider text-slate-50">
              Campaign Operations
            </h1>
            <p className="text-xs text-slate-400">
              Choose an operation. Complete its objectives to unlock the next deployment.
            </p>
          </div>
        </div>

        <div className="hidden items-center gap-3 border border-slate-800 bg-[#050c1d]/90 px-4 py-2 font-mono text-xs sm:flex">
          <Trophy className="h-3.5 w-3.5 text-cyan-400" />
          <span className="text-slate-400">Progress</span>
          <span className="font-semibold text-cyan-300">
            {completedCount} / {CAMPAIGN_MISSIONS.length}
          </span>
        </div>
      </div>

      {/* Main Split Layout: Mission List + Tactical Briefing */}
      <div className="mx-auto my-5 grid w-full max-w-6xl flex-1 grid-cols-1 gap-5 overflow-y-auto lg:grid-cols-12">
        {/* Left: 5 Mission Cards */}
        <div className="flex flex-col gap-2.5 lg:col-span-5">
          {CAMPAIGN_MISSIONS.map((mission) => {
            const unlocked = isMissionUnlocked(mission, campaignSave);
            const record = campaignSave.missions[mission.id];
            const isSelected = mission.id === selected.id;
            const diffLabel = DIFFICULTY_PROFILES[mission.difficulty].label;

            return (
              <button
                key={mission.id}
                type="button"
                onMouseEnter={() => AudioManager.playUiHover()}
                onClick={() => {
                  AudioManager.playUiClick('secondary');
                  onSelectMission(mission.id);
                }}
                className={`flex items-center justify-between gap-3 border px-4 py-3.5 text-left transition-colors ${
                  isSelected
                    ? 'border-cyan-400 bg-[#081631]/95 text-slate-50'
                    : unlocked
                      ? 'border-slate-800 bg-[#050c1d]/90 text-slate-200 hover:border-slate-600'
                      : 'border-slate-800/70 bg-[#040915]/85 text-slate-500 hover:border-slate-700'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs font-semibold text-cyan-400">
                      {mission.code}
                    </span>
                    <span className="font-display text-base font-semibold tracking-wide truncate">
                      {mission.name}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-slate-400">
                    <span>{diffLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className={record?.completed ? 'text-emerald-300' : unlocked ? 'text-cyan-300' : 'text-slate-500'}>{record?.completed ? 'COMPLETED' : unlocked ? 'AVAILABLE' : 'LOCKED'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{mission.environment.sectorName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{mission.totalEnemyCount} Hostiles</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {record?.bestRank && (
                    <span
                      className={`flex h-7 w-7 items-center justify-center border font-display text-sm font-bold ${RANK_STYLE[record.bestRank]}`}
                    >
                      {record.bestRank}
                    </span>
                  )}
                  {record?.completed ? (
                    <CheckCircle2 className="h-4 w-4 text-cyan-400" aria-label="Completed" />
                  ) : !unlocked ? (
                    <Lock className="h-4 w-4 text-slate-500" aria-label="Locked" />
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: Detailed Tactical Briefing */}
        <div className="flex flex-col justify-between border border-slate-700/80 bg-[#050c1d]/94 p-6 lg:col-span-7">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2.5 font-mono text-xs text-cyan-300">
                  <span>MISSION {String(selected.number).padStart(2, '0')}</span>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span>{selected.environment.sectorName.toUpperCase()}</span>
                </div>
                <h2 className="mt-1 font-display text-3xl font-bold tracking-wide text-slate-50">
                  {selected.name}
                </h2>
              </div>

              <div className="text-right font-mono text-xs">
                <div className="text-slate-400">Threat Level</div>
                <div className="mt-0.5 text-sm font-semibold text-orange-300">
                  {DIFFICULTY_PROFILES[selected.difficulty].label.toUpperCase()}
                </div>
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              {selected.description}
            </p>

            {/* Mission Parameters */}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="border border-slate-800 bg-[#081226] px-3 py-2.5">
                <div className="text-[11px] text-slate-400">Hostiles</div>
                <div className="mt-0.5 font-mono text-sm font-semibold text-slate-100">
                  {selected.totalEnemyCount}
                </div>
              </div>
              <div className="border border-slate-800 bg-[#081226] px-3 py-2.5">
                <div className="text-[11px] text-slate-400">Waves</div>
                <div className="mt-0.5 font-mono text-sm font-semibold text-slate-100">
                  {selected.waves.length}
                </div>
              </div>
              <div className="border border-slate-800 bg-[#081226] px-3 py-2.5">
                <div className="text-[11px] text-slate-400">Par Time</div>
                <div className="mt-0.5 font-mono text-sm font-semibold text-slate-100">
                  {formatTime(selected.parTimeSec)}
                </div>
              </div>
              <div className="border border-slate-800 bg-[#081226] px-3 py-2.5">
                <div className="text-[11px] text-slate-400">Best Record</div>
                <div className="mt-0.5 font-mono text-sm font-semibold text-cyan-300">
                  {selectedRecord?.bestRank
                    ? `${selectedRecord.bestRank} · ${selectedRecord.bestScore}`
                    : 'Unranked'}
                </div>
              </div>
            </div>

            {/* Objectives List */}
            <div className="mt-5">
              <h3 className="flex items-center gap-2 font-mono text-xs tracking-wider text-slate-400">
                <Crosshair className="h-3.5 w-3.5 text-cyan-400" />
                <span>MISSION OBJECTIVES</span>
              </h3>
              <ul className="mt-2 space-y-2">
                {selected.objectives.map((obj) => (
                  <li
                    key={obj.id}
                    className="flex items-center justify-between border border-slate-800/90 bg-[#081226]/70 px-3.5 py-2 text-xs text-slate-200"
                  >
                    <span>
                      {obj.label}
                      {obj.optional && <span className="ml-2 font-mono text-[10px] text-amber-300">OPTIONAL</span>}
                    </span>
                    <span className="font-mono text-[11px] text-cyan-300">
                      {obj.type === 'recon'
                        ? `SCAN ${obj.durationSec ?? obj.scanDurationSec ?? 5}s`
                        : obj.type === 'defend'
                          ? `${obj.durationSec ?? obj.targetDurationSec ?? 0}s · ${obj.targetWaves ?? obj.targetCount ?? 0} WAVES`
                        : obj.type === 'survive_duration'
                        ? `${obj.targetDurationSec}s`
                        : obj.type === 'defeat_target' || obj.type === 'intercept' || obj.type === 'boss'
                          ? obj.targetCallsign
                          : obj.type === 'extract'
                            ? 'INTERACTION'
                          : `${obj.targetCount}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Reward & Best Time Info */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/90 pt-3 text-xs text-slate-400">
              <span>{selected.rewardLabel}</span>
              {selectedRecord?.bestTimeSec && (
                <span className="font-mono text-slate-300">
                  Best Time: {formatTime(selectedRecord.bestTimeSec)}
                </span>
              )}
            </div>
          </div>

          {/* Launch Action */}
          <div className="mt-6 border-t border-slate-800 pt-4">
            {selectedUnlocked ? (
              <button
                type="button"
                onMouseEnter={() => AudioManager.playUiHover()}
                onClick={() => {
                  AudioManager.unlock();
                  AudioManager.playUiClick('primary');
                  onLaunchMission(selected);
                }}
                className="flex w-full items-center justify-center gap-2.5 bg-cyan-500 px-6 py-3.5 text-sm font-semibold tracking-wide text-slate-950 transition-colors hover:bg-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-300"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Launch {selected.code} — {selected.name}</span>
              </button>
            ) : (
              <div className="flex items-center justify-center gap-2.5 border border-slate-700 bg-[#081226] px-5 py-3.5 text-xs text-slate-400">
                <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                <span>
                  {unlockRequirement
                    ? `Complete ${unlockRequirement.code} — ${unlockRequirement.name} to unlock this deployment.`
                    : 'This deployment is currently locked.'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quiet Footer */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>Active Craft: VX-9 Vanguard Interceptor</span>
        <span>Ranks: S (820+) · A (660+) · B (480+) · C</span>
      </div>
    </div>
  );
}
