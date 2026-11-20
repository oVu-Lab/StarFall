import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  CheckCircle2,
  Crosshair,
  Lock,
  Play,
  ShieldAlert,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { AudioManager } from '../audio/AudioManager';
import { DIFFICULTY_PROFILES } from '../config/difficulty';
import { CAMPAIGN_MISSIONS } from '../config/missions';
import { SHIP_CONFIGS } from '../config/ships';
import { isMissionUnlocked } from '../engine/mission/CampaignProgressStore';
import type { MissionRank, ShipId } from '../types/game';
import type { CampaignSaveData, MissionDefinition, ObjectiveDefinition } from '../types/mission';
import { TacticalSectorMap } from './TacticalSectorMap';
import { ObsidianEnergySpine, TECH_EASE } from './ui/ObsidianUI';

interface MissionSelectViewProps {
  campaignSave: CampaignSaveData;
  selectedMissionId: string;
  onSelectMission: (missionId: string) => void;
  onLaunchMission: (mission: MissionDefinition) => void;
  onBack: () => void;
}

const RANK_STYLE: Record<MissionRank, string> = {
  S: 'border-[#38bdf8] bg-[#38bdf8]/15 text-[#bae6fd]',
  A: 'border-sky-400/70 bg-sky-500/12 text-sky-200',
  B: 'border-slate-500/70 bg-slate-700/25 text-slate-200',
  C: 'border-amber-400/70 bg-amber-500/12 text-amber-200',
};

function formatTime(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatObjectiveTag(obj: ObjectiveDefinition): string {
  if (obj.type === 'recon') return `SCAN ${obj.durationSec ?? obj.scanDurationSec ?? 5}s`;
  if (obj.type === 'defend') {
    return `${obj.durationSec ?? obj.targetDurationSec ?? 0}s · ${obj.targetWaves ?? obj.targetCount ?? 0}W`;
  }
  if (obj.type === 'survive_duration') return `${obj.targetDurationSec}s`;
  if (obj.type === 'defeat_target' || obj.type === 'intercept' || obj.type === 'boss') {
    return obj.targetCallsign ?? 'TARGET';
  }
  if (obj.type === 'extract') return 'EXTRACT';
  return `×${obj.targetCount ?? 1}`;
}

export function MissionSelectView({
  campaignSave,
  selectedMissionId,
  onSelectMission,
  onLaunchMission,
  onBack,
}: MissionSelectViewProps) {
  const reducedMotion = useReducedMotion();
  const launchingRef = useRef(false);
  // First opening plays the Spatial Materialization sequence (~1080ms).
  // Subsequent mission switches keep the existing fast data-sync transition unchanged.
  const [syncCount, setSyncCount] = useState(0);
  const isInitialDeploy = syncCount === 0;

  const selected =
    CAMPAIGN_MISSIONS.find((m) => m.id === selectedMissionId) ?? CAMPAIGN_MISSIONS[0];
  const selectedRecord = campaignSave.missions[selected.id];
  const selectedUnlocked = isMissionUnlocked(selected, campaignSave);
  const unlockRequirement = selected.unlockRequirementId
    ? CAMPAIGN_MISSIONS.find((mission) => mission.id === selected.unlockRequirementId)
    : null;
  const completedCount = CAMPAIGN_MISSIONS.filter((m) => campaignSave.missions[m.id]?.completed).length;
  const activeShipId = (campaignSave.collection?.selectedShipId ?? 'interceptor') as ShipId;
  const activeShip = SHIP_CONFIGS[activeShipId] ?? SHIP_CONFIGS.interceptor;

  const primaryObjectives = selected.objectives.filter((obj) => !obj.optional);
  const optionalObjectives = selected.objectives.filter((obj) => obj.optional);

  useEffect(() => {
    launchingRef.current = false;
  }, [selected.id]);

  const handleSelect = (missionId: string) => {
    if (missionId === selected.id) return;
    AudioManager.playUiClick('secondary');
    setSyncCount((c) => c + 1);
    onSelectMission(missionId);
  };

  const handleDeploy = () => {
    if (!selectedUnlocked || launchingRef.current) return;
    launchingRef.current = true;
    AudioManager.unlock();
    AudioManager.playUiClick('primary');
    onLaunchMission(selected);
  };

  const d = (initialSec: number, switchSec: number) =>
    reducedMotion ? 0 : isInitialDeploy ? initialSec : switchSec;

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between overflow-hidden bg-[#02040a]/86 p-4 sm:p-6 lg:p-8">
      {/* Top Command Bar */}
      <motion.header
        initial={{ opacity: 0, y: reducedMotion ? 0 : -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: TECH_EASE }}
        className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 border-b border-white/10 pb-3"
      >
        <div className="flex items-center gap-4">
          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('secondary');
              onBack();
            }}
            className="obsidian-surface obsidian-surface-interactive group flex shrink-0 items-center gap-2 px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-200 hover:text-[#38bdf8]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#38bdf8] transition-transform duration-150 group-hover:-translate-x-0.5" />
            <span>Menu</span>
          </button>

          <div className="border-l border-white/10 pl-4">
            <span className="font-mono text-[9px] uppercase tracking-[0.26em] text-[#38bdf8]">
              Tactical Command
            </span>
            <h1 className="font-display text-lg font-bold uppercase tracking-[0.14em] text-slate-50 sm:text-xl">
              Operations
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="hidden text-slate-500 md:inline">CRAFT // {activeShip.callsign}</span>
          <div className="obsidian-surface flex items-center gap-2.5 px-3.5 py-1.5">
            <Trophy className="h-3.5 w-3.5 text-[#38bdf8]" />
            <span className="font-semibold tabular-nums text-[#38bdf8]">
              {completedCount}/{CAMPAIGN_MISSIONS.length}
            </span>
          </div>
        </div>
      </motion.header>

      {/* Main Split: Left Operations Index + Right Machined Obsidian Tactical Terminal */}
      <div className="mx-auto my-4 flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-5 overflow-hidden lg:flex-row">
        {/* Left: Compact Operations Index */}
        <motion.nav
          aria-label="Campaign operations"
          initial={{ opacity: 0, x: reducedMotion ? 0 : -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.28, ease: TECH_EASE }}
          className="obsidian-monolith obsidian-scroll relative flex max-h-[30vh] shrink-0 flex-col divide-y divide-white/6 overflow-y-auto lg:max-h-none lg:w-[20.5rem] xl:w-[22rem]"
        >
          <ObsidianEnergySpine orientation="vertical" side="left" />

          {CAMPAIGN_MISSIONS.map((mission) => {
            const unlocked = isMissionUnlocked(mission, campaignSave);
            const record = campaignSave.missions[mission.id];
            const isSelected = mission.id === selected.id;

            return (
              <button
                key={mission.id}
                type="button"
                onMouseEnter={() => AudioManager.playUiHover()}
                onClick={() => handleSelect(mission.id)}
                aria-pressed={isSelected}
                className={`relative flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#38bdf8] ${
                  isSelected
                    ? 'bg-[#38bdf8]/[0.1] text-slate-50'
                    : unlocked
                      ? 'text-slate-200 hover:bg-white/[0.025]'
                      : 'text-slate-500 hover:bg-white/[0.015]'
                }`}
              >
                {isSelected && (
                  <motion.div
                    layoutId="mission-active-beam"
                    transition={{ duration: 0.2, ease: TECH_EASE }}
                    className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-[#38bdf8] shadow-[0_0_14px_#38bdf8]"
                  />
                )}

                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`font-mono text-[11px] font-semibold tracking-wider ${
                        isSelected ? 'text-[#38bdf8]' : unlocked ? 'text-[#38bdf8]/75' : 'text-slate-600'
                      }`}
                    >
                      {mission.code}
                    </span>
                    <span className="truncate font-display text-sm font-semibold tracking-wide">
                      {mission.name}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-slate-500">
                    <span className="truncate">{mission.environment.sectorName}</span>
                    <span aria-hidden="true">/</span>
                    <span
                      className={
                        record?.completed
                          ? 'text-emerald-300/90'
                          : unlocked
                            ? 'text-[#38bdf8]/80'
                            : 'text-slate-600'
                      }
                    >
                      {record?.completed ? 'CLEARED' : unlocked ? 'READY' : 'LOCKED'}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {record?.bestRank && (
                    <span
                      className={`flex h-6 w-6 items-center justify-center border font-display text-xs font-bold ${RANK_STYLE[record.bestRank]}`}
                    >
                      {record.bestRank}
                    </span>
                  )}
                  {record?.completed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-label="Completed" />
                  ) : !unlocked ? (
                    <Lock className="h-3.5 w-3.5 text-slate-600" aria-label="Locked" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-[#38bdf8]" aria-hidden="true" />
                  )}
                </div>
              </button>
            );
          })}
        </motion.nav>

        {/* Right: Machined Chamfered Obsidian Tactical Mission Terminal — Spatial Materialization */}
        <div className="relative min-h-0 min-w-0 flex-1">
          {/* STAGE 1 — Spatial Activation: Concentrated right-side emitter node + directional energy rays */}
          {!reducedMotion && (
            <>
              <div
                className="spatial-emitter-core pointer-events-none absolute left-[90%] top-1/2 z-30 h-8 w-8 rounded-full"
                style={{
                  background:
                    'radial-gradient(circle, rgba(224,242,254,0.98) 0%, rgba(56,189,248,0.8) 32%, rgba(56,189,248,0) 72%)',
                }}
                aria-hidden="true"
              />
              <div
                className="spatial-emitter-ray-v pointer-events-none absolute inset-y-0 left-[90%] z-20 w-[1.5px] -translate-x-1/2 origin-center bg-gradient-to-b from-transparent via-[#7dd3fc] to-transparent shadow-[0_0_12px_#38bdf8]"
                aria-hidden="true"
              />
              <div
                className="spatial-emitter-ray-h pointer-events-none absolute inset-x-0 top-1/2 z-20 h-[1.5px] -translate-y-1/2 origin-right bg-gradient-to-l from-[#e0f2fe] via-[#38bdf8] to-transparent shadow-[0_0_12px_#38bdf8]"
                aria-hidden="true"
              />
            </>
          )}

          {/* STAGE 1B — Holographic Wireframe Boundary & Internal Structural Ribs */}
          <svg
            className="pointer-events-none absolute inset-0 z-20 h-full w-full"
            viewBox="0 0 1000 600"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M 1000 300 L 1000 0 L 22 0 L 0 22 L 0 600 L 978 600 L 1000 578 L 1000 300"
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              pathLength={1}
              className="spatial-wireframe-path"
            />
            {!reducedMotion && (
              <>
                <path
                  d="M 1000 112 L 0 112"
                  fill="none"
                  stroke="#7dd3fc"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                  pathLength={1}
                  className="spatial-rib-path"
                />
                <path
                  d="M 590 112 L 590 505"
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                  pathLength={1}
                  className="spatial-rib-path"
                />
              </>
            )}
          </svg>

          {/* STAGE 2A — Leading Holographic Blue Lattice unfolding ahead of solid obsidian */}
          {!reducedMotion && (
            <div
              className="spatial-holo-lattice pointer-events-none absolute inset-0 z-10"
              aria-hidden="true"
            />
          )}

          {/* STAGE 2B — Solid Polished Black Obsidian Terminal Materializing in 3D Depth */}
          <div
            className={`obsidian-terminal obsidian-scroll relative flex h-full flex-col justify-between overflow-y-auto p-6 sm:p-7 ${
              reducedMotion ? '' : 'spatial-obsidian-entry'
            }`}
          >
            {/* STAGE 3 — Power Synchronization Wave awakening obsidian reflections */}
            {!reducedMotion && (
              <div
                className="spatial-power-wave pointer-events-none absolute inset-y-0 left-0 z-20 w-1/2"
                aria-hidden="true"
              />
            )}

            {/* Mission-Switch Fast Data-Sync Scan Beam (unchanged behavior for subsequent switches) */}
            {syncCount > 0 && (
              <div
                key={`sync-${syncCount}`}
                className="terminal-sync-scan pointer-events-none absolute inset-y-0 left-0 z-20 w-1/2"
                aria-hidden="true"
              />
            )}

            {/* Stage 5 — Calm Ambient Left-Spine Energy Conduit */}
            <ObsidianEnergySpine orientation="vertical" side="left" />

            {/* STAGE 4 — Choreographed Mission Data Appearance (Initial) / Fast Sync (Switching) */}
            <AnimatePresence mode="wait">
              <motion.section
                key={selected.id}
                aria-label={`Tactical briefing for ${selected.name}`}
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
                transition={{ duration: 0.14, ease: TECH_EASE }}
                className="relative z-10 flex flex-1 flex-col justify-between gap-5"
              >
                <div className="flex flex-col gap-5">
                  {/* Top Tactical Header Deck */}
                  <div className="relative flex flex-wrap items-end justify-between gap-4 pb-4">
                    <motion.div
                      initial={reducedMotion ? { scaleX: 1 } : { scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.36, delay: d(0.52, 0.02), ease: TECH_EASE }}
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-right bg-gradient-to-l from-[#38bdf8]/65 via-white/15 to-transparent"
                      aria-hidden="true"
                    />

                    <div className="min-w-0">
                      {/* 4.1 Operation Identifier & Sector — Precision horizontal aperture wipe */}
                      <motion.div
                        initial={
                          reducedMotion
                            ? { opacity: 0 }
                            : { opacity: 0, clipPath: 'inset(0 100% 0 0)' }
                        }
                        animate={{ opacity: 1, clipPath: 'inset(0 0% 0 0)' }}
                        transition={{ duration: 0.24, delay: d(0.56, 0.02), ease: TECH_EASE }}
                        className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.26em] text-[#38bdf8]"
                      >
                        <span className="border border-[#38bdf8]/45 bg-[#38bdf8]/10 px-1.5 py-0.5 font-semibold text-[#bae6fd]">
                          {selected.code}
                        </span>
                        <span>{selected.subtitle}</span>
                        <span className="text-slate-600">/</span>
                        <span className="text-slate-400">{selected.environment.sectorName}</span>
                      </motion.div>

                      {/* 4.2 Hero Mission Title — Masked baseline rise */}
                      <motion.h2
                        initial={
                          reducedMotion
                            ? { opacity: 0 }
                            : { opacity: 0, y: 12, clipPath: 'inset(0 0 100% 0)' }
                        }
                        animate={{ opacity: 1, y: 0, clipPath: 'inset(0 0 0% 0)' }}
                        transition={{ duration: 0.28, delay: d(0.61, 0.05), ease: TECH_EASE }}
                        className="mt-2 font-display text-3xl font-bold uppercase tracking-[0.06em] text-slate-50 sm:text-4xl"
                      >
                        {selected.name}
                      </motion.h2>
                    </div>

                    {/* 4.3 Threat Level Segments + Status + Best Rank */}
                    <motion.div
                      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.24, delay: d(0.66, 0.08), ease: TECH_EASE }}
                      className="flex items-center gap-3.5"
                    >
                      {selectedRecord?.bestRank && (
                        <div
                          className={`obsidian-surface flex h-11 w-11 items-center justify-center border font-display text-xl font-bold ${RANK_STYLE[selectedRecord.bestRank]}`}
                          title={`Best Rank: ${selectedRecord.bestRank}`}
                        >
                          {selectedRecord.bestRank}
                        </div>
                      )}

                      <div className="flex flex-col items-end font-mono">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em]">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              selectedRecord?.completed
                                ? 'bg-emerald-400'
                                : selectedUnlocked
                                  ? 'bg-[#38bdf8]'
                                  : 'bg-amber-400'
                            }`}
                          />
                          <span className="text-slate-300">
                            {DIFFICULTY_PROFILES[selected.difficulty].label}
                          </span>
                        </div>
                        <div
                          className="mt-1.5 flex items-center gap-1"
                          aria-label={`Difficulty ${selected.difficultyNumeric} of 5`}
                        >
                          {[1, 2, 3, 4, 5].map((lvl) => (
                            <span
                              key={lvl}
                              className={`h-1.5 w-4 transition-colors ${
                                lvl <= selected.difficultyNumeric
                                  ? lvl >= 4
                                    ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.45)]'
                                    : 'bg-[#38bdf8] shadow-[0_0_8px_rgba(56,189,248,0.45)]'
                                  : 'bg-slate-800/90'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  </div>

                  {/* Asymmetric 2-Column Tactical Body */}
                  <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    {/* Left (~7 cols): Concise Directive Summary & Operational Objectives */}
                    <div className="flex flex-col gap-5 xl:col-span-7">
                      <motion.p
                        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.22, delay: d(0.68, 0.08), ease: TECH_EASE }}
                        className="border-l border-[#38bdf8]/40 pl-3.5 text-xs leading-relaxed text-slate-300 sm:text-[13px]"
                      >
                        {selected.description}
                      </motion.p>

                      {/* 4.4 Primary Operational Directives — Synchronized horizontal clip-wipe */}
                      <div>
                        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-[#38bdf8]">
                          <Crosshair className="h-3.5 w-3.5" />
                          <span>Primary Directives</span>
                        </div>
                        <ul className="mt-2.5 divide-y divide-white/6 border-y border-white/8">
                          {primaryObjectives.map((obj, idx) => (
                            <motion.li
                              key={obj.id}
                              initial={
                                reducedMotion
                                  ? { opacity: 0 }
                                  : { opacity: 0, x: 10, clipPath: 'inset(0 100% 0 0)' }
                              }
                              animate={{ opacity: 1, x: 0, clipPath: 'inset(0 0% 0 0)' }}
                              transition={{
                                duration: 0.22,
                                delay: d(0.72 + idx * 0.04, 0.1 + idx * 0.03),
                                ease: TECH_EASE,
                              }}
                              className="flex items-center justify-between gap-3 py-2.5 text-xs text-slate-100"
                            >
                              <span className="flex items-center gap-2.5">
                                <span className="font-mono text-[10px] text-[#38bdf8]/75">
                                  0{idx + 1}
                                </span>
                                <span>{obj.label}</span>
                              </span>
                              <span className="shrink-0 border border-[#38bdf8]/25 bg-[#040812] px-2 py-0.5 font-mono text-[10px] tabular-nums text-[#38bdf8]">
                                {formatObjectiveTag(obj)}
                              </span>
                            </motion.li>
                          ))}
                        </ul>
                      </div>

                      {/* 4.5 Bonus Directives (when present) */}
                      {optionalObjectives.length > 0 && (
                        <motion.div
                          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.22, delay: d(0.8, 0.14), ease: TECH_EASE }}
                        >
                          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-amber-300/90">
                            <Sparkles className="h-3.5 w-3.5" />
                            <span>Bonus Directives</span>
                          </div>
                          <ul className="mt-2 divide-y divide-white/6 border-y border-white/8">
                            {optionalObjectives.map((obj) => (
                              <li
                                key={obj.id}
                                className="flex items-center justify-between gap-3 py-2 text-xs text-slate-300"
                              >
                                <span>{obj.label}</span>
                                <span className="shrink-0 font-mono text-[10px] tabular-nums text-amber-300">
                                  {formatObjectiveTag(obj)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </motion.div>
                      )}
                    </div>

                    {/* Right (~5 cols): Optical Well opens via horizontal aperture iris */}
                    <motion.div
                      initial={
                        reducedMotion
                          ? { opacity: 0 }
                          : { opacity: 0, clipPath: 'inset(0 50% 0 50%)' }
                      }
                      animate={{ opacity: 1, clipPath: 'inset(0 0% 0 0%)' }}
                      transition={{ duration: 0.3, delay: d(0.66, 0.08), ease: TECH_EASE }}
                      className="flex flex-col gap-3 xl:col-span-5"
                    >
                      <TacticalSectorMap mission={selected} />

                      {/* Compact Real Operation Parameters */}
                      <div className="grid grid-cols-3 divide-x divide-white/8 border border-white/8 bg-[#04060c]/90 py-2 text-center font-mono">
                        <div>
                          <div className="text-[8px] uppercase tracking-[0.2em] text-slate-500">
                            Hostiles
                          </div>
                          <div className="mt-0.5 text-xs font-semibold tabular-nums text-slate-100">
                            {selected.totalEnemyCount}
                          </div>
                        </div>
                        <div>
                          <div className="text-[8px] uppercase tracking-[0.2em] text-slate-500">
                            Waves
                          </div>
                          <div className="mt-0.5 text-xs font-semibold tabular-nums text-slate-100">
                            {selected.waves.length}
                          </div>
                        </div>
                        <div>
                          <div className="text-[8px] uppercase tracking-[0.2em] text-slate-500">
                            Par
                          </div>
                          <div className="mt-0.5 text-xs font-semibold tabular-nums text-[#38bdf8]">
                            {formatTime(selected.parTimeSec)}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                </div>

                {/* STAGE 5 — Ready State: Rewards Strip & Armed Deployment Control */}
                <motion.div
                  initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, delay: d(0.84, 0.16), ease: TECH_EASE }}
                  className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 font-mono">
                    <div className="text-[9px] uppercase tracking-[0.22em] text-slate-500">
                      Operation Reward
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-200">
                      {selected.rewardLabel}
                      {selectedRecord?.bestScore ? (
                        <span className="ml-2.5 text-[#38bdf8]">
                          · BEST {selectedRecord.bestScore}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {selectedUnlocked ? (
                    <button
                      type="button"
                      onMouseEnter={() => AudioManager.playUiHover()}
                      onClick={handleDeploy}
                      className="obsidian-cta-primary obsidian-scan group flex shrink-0 items-center justify-center gap-2.5 px-7 py-3 font-display text-sm font-bold uppercase tracking-[0.22em] text-[#e0f2fe] focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
                    >
                      <Play className="h-4 w-4 fill-[#38bdf8] text-[#38bdf8] transition-transform duration-150 group-hover:translate-x-0.5" />
                      <span>Deploy · {selected.code}</span>
                    </button>
                  ) : (
                    <div className="obsidian-surface flex shrink-0 items-center justify-center gap-2 border-amber-400/45 px-5 py-3 font-mono text-[11px] text-amber-200">
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span>
                        {unlockRequirement
                          ? `Requires ${unlockRequirement.code}`
                          : 'Locked'}
                      </span>
                    </div>
                  )}
                </motion.div>
              </motion.section>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
