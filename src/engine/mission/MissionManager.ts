import type * as THREE from 'three';
import { DIFFICULTY_PROFILES } from '../../config/difficulty';
import { getNextMission } from '../../config/missions';
import type { DamageEvent, DestructionEvent } from '../../types/combat';
import type {
  MissionDefinition,
  MissionEvent,
  MissionHudSnapshot,
  MissionResult,
} from '../../types/mission';
import type { CombatManager } from '../combat/CombatManager';
import { MissionEventAdapter } from './MissionEventAdapter';
import { MissionRuntime } from './MissionRuntime';
import { CombatMissionWorldAdapter, type MissionWorldAdapter } from './MissionWorldAdapter';
import { calculateMissionScore } from './RankCalculator';

export type MissionRunStatus = 'idle' | 'active' | 'completed' | 'failed';

export interface MissionManagerCallbacks {
  onHudUpdate?: (snapshot: MissionHudSnapshot) => void;
  onMissionEnd?: (result: MissionResult) => void;
}

/** Coordinates world actions and forwards event batches to the definition-driven runtime. */
export class MissionManager {
  private mission: MissionDefinition | null = null;
  private combat: CombatManager | null = null;
  private world: MissionWorldAdapter | null = null;
  private readonly runtime = new MissionRuntime();
  private readonly eventAdapter = new MissionEventAdapter();
  private status: MissionRunStatus = 'idle';
  private elapsedSec = 0;
  private currentWaveIdx = 0;
  private completedWaves = new Set<number>();
  private pendingWaveDelay = -1;
  private announcement: string | null = null;
  private announcementKind: 'info' | 'complete' | 'warning' = 'info';
  private announcementTimer = 0;
  private lastHudElapsedSec = 0;
  private readonly pendingEvents: MissionEvent[] = [];
  private callbacks: MissionManagerCallbacks = {};

  public setCallbacks(callbacks: MissionManagerCallbacks): void {
    this.callbacks = callbacks;
  }

  public getStatus(): MissionRunStatus {
    return this.status;
  }

  public getActiveMission(): MissionDefinition | null {
    return this.mission;
  }

  public getWorldActors() {
    const state = this.runtime.getState();
    return state && this.world ? this.world.getSnapshot(state) : null;
  }

  public getHudSnapshot(): MissionHudSnapshot | null {
    if (!this.mission || !this.world) return null;
    const state = this.runtime.getState();
    if (!state) return null;
    const world = this.world.getSnapshot(state);
    const stage = this.mission.stages.find((candidate) => candidate.id === state.currentStageId);
    return {
      missionId: this.mission.id,
      missionCode: this.mission.code,
      missionName: this.mission.name,
      difficultyLabel: DIFFICULTY_PROFILES[this.mission.difficulty].label,
      waveIndex: Math.min(this.currentWaveIdx + 1, this.mission.waves.length),
      totalWaves: this.mission.waves.length,
      stageId: state.currentStageId,
      stageLabel: stage?.label ?? '',
      elapsedSec: state.elapsedSec,
      objectives: Object.values(state.objectives),
      announcement: this.announcement,
      announcementKind: this.announcementKind,
      transport: world.transport,
      relay: world.relay,
      interaction: world.interaction,
    };
  }

  public startMission(
    mission: MissionDefinition,
    combat: CombatManager,
    playerMaxHull: number,
    playerPos: THREE.Vector3,
  ): MissionHudSnapshot {
    this.mission = mission;
    this.combat = combat;
    this.world = new CombatMissionWorldAdapter(combat);
    this.status = 'active';
    this.elapsedSec = 0;
    this.currentWaveIdx = 0;
    this.completedWaves.clear();
    this.pendingWaveDelay = -1;
    this.pendingEvents.length = 0;
    this.announcementTimer = 0;
    this.lastHudElapsedSec = 0;

    this.runtime.start(mission);
    this.world.start(mission, playerMaxHull, playerPos);
    if (mission.waves[0]) {
      this.world.spawnWave(mission, 0, playerPos);
      this.runtime.processEvents([{ type: 'wave_started', waveNumber: mission.waves[0].waveNumber }]);
    }
    const firstWave = mission.waves[0];
    this.setAnnouncement(`${mission.code} · ${mission.name.toUpperCase()} — ${firstWave?.label ?? 'ENGAGE'}`, 'info', 3.4);
    this.emitHud();
    return this.getHudSnapshot()!;
  }

  public abortMission(): void {
    this.world?.cleanup();
    this.world = null;
    this.mission = null;
    this.combat = null;
    this.status = 'idle';
    this.pendingEvents.length = 0;
    this.announcement = null;
    this.announcementTimer = 0;
    this.pendingWaveDelay = -1;
  }

  /** Combat callbacks are queued so a simulation frame is resolved as one ordered event batch. */
  public handleDestruction(event: DestructionEvent): void {
    this.pendingEvents.push(...this.eventAdapter.fromDestruction(event));
  }

  public handleDamage(event: DamageEvent): void {
    this.pendingEvents.push(...this.eventAdapter.fromDamage(event));
    if (this.mission && event.targetId === this.mission.relay?.id) {
      this.setAnnouncement(
        event.destroyed ? 'COBALT RELAY LOST · DEFENSE LINE BREACHED' : `COBALT RELAY HIT · ${Math.ceil(event.remainingHealth)} INTEGRITY`,
        event.destroyed ? 'warning' : 'info',
        2.2,
      );
    } else if (event.targetId === 'transport-1') {
      this.setAnnouncement(
        event.destroyed ? 'TRANSPORT HULL CRITICAL · EXTRACTION COMPROMISED' : `TRANSPORT HIT · ${Math.ceil(event.remainingHealth)} HULL REMAINING`,
        'warning',
        2.2,
      );
    }
  }

  public update(dt: number, _combat: CombatManager, playerPos: THREE.Vector3, interactHeld = false): void {
    if (this.status !== 'active' || !this.mission || !this.world || !this.combat) return;
    const safeDt = Math.min(Math.max(dt, 0.0001), 0.05);
    this.elapsedSec += safeDt;
    const state = this.runtime.getState();
    if (!state) return;
    const events = this.pendingEvents.splice(0);
    events.push(...this.world.update(safeDt, playerPos, interactHeld, state));
    events.push({ type: 'timer_elapsed', deltaSec: safeDt, elapsedSec: this.elapsedSec });

    const activeEnemies = this.world.getActiveEnemyCount();
    const currentWave = this.mission.waves[this.currentWaveIdx];
    if (currentWave && activeEnemies === 0 && !this.completedWaves.has(currentWave.waveNumber)) {
      this.completedWaves.add(currentWave.waveNumber);
      events.push({ type: 'wave_cleared', waveNumber: currentWave.waveNumber });
      const nextWave = this.mission.waves[this.currentWaveIdx + 1];
      if (nextWave) {
        this.pendingWaveDelay = Math.max(0.1, nextWave.triggerDelaySec);
        const hasBoss = nextWave.enemies.some((enemy) => enemy.isPriorityTarget);
        this.setAnnouncement(
          hasBoss
            ? `WAVE ${nextWave.waveNumber}/${this.mission.waves.length} INCOMING — COMMAND WING DETECTED`
            : `WAVE ${nextWave.waveNumber}/${this.mission.waves.length} INCOMING — ${nextWave.label.toUpperCase()}`,
          hasBoss ? 'warning' : 'info',
          Math.max(2.6, nextWave.triggerDelaySec + 1.2),
        );
      }
    }

    if (this.pendingWaveDelay > 0) {
      this.pendingWaveDelay -= safeDt;
      if (this.pendingWaveDelay <= 0 && this.currentWaveIdx + 1 < this.mission.waves.length) {
        this.pendingWaveDelay = -1;
        this.currentWaveIdx += 1;
        const nextWave = this.mission.waves[this.currentWaveIdx];
        this.world.spawnWave(this.mission, this.currentWaveIdx, playerPos);
        events.push({ type: 'wave_started', waveNumber: nextWave.waveNumber });
      }
    }

    if (this.announcementTimer > 0) {
      this.announcementTimer = Math.max(0, this.announcementTimer - safeDt);
      if (this.announcementTimer <= 0) this.announcement = null;
    }

    this.runtime.processEvents(events);
    const runtimeState = this.runtime.getState();
    if (!runtimeState) return;
    this.elapsedSec = runtimeState.elapsedSec;
    if (runtimeState.status !== 'active') {
      this.status = runtimeState.status;
      this.finishMission(runtimeState.status, this.combat);
      return;
    }

    const activeScan = runtimeState.objectives && Object.values(runtimeState.objectives).some(
      (objective) => objective.type === 'recon' && objective.status === 'active',
    );
    const timerTick = Math.floor(runtimeState.elapsedSec) !== Math.floor(this.lastHudElapsedSec);
    const eventNeedsUpdate = events.some((event) =>
      event.type !== 'timer_elapsed' && event.type !== 'actor_progress' && event.type !== 'scan_progress',
    );
    const scanNeedsUpdate = activeScan && interactHeld && runtimeState.elapsedSec - this.lastHudElapsedSec >= 0.08;
    if (eventNeedsUpdate || timerTick || scanNeedsUpdate) {
      this.lastHudElapsedSec = runtimeState.elapsedSec;
      this.emitHud();
    }
  }

  private finishMission(outcome: 'completed' | 'failed', combat: CombatManager): void {
    if (!this.mission || this.status !== outcome) return;
    const runtime = this.runtime.getState();
    const remainingHull = Math.max(0, combat.playerHealth.current);
    const maxHull = Math.max(1, combat.playerHealth.max);
    const scoreBreakdown = calculateMissionScore({
      enemiesDefeated: combat.stats.kills,
      totalEnemies: this.mission.totalEnemyCount,
      shotsFired: combat.stats.shotsFired,
      shotsHit: combat.stats.shotsHit,
      remainingHull,
      maxHull,
      damageReceived: combat.stats.damageTaken,
      timeTakenSec: runtime?.elapsedSec ?? this.elapsedSec,
      parTimeSec: this.mission.parTimeSec,
      completed: outcome === 'completed',
      completedRequiredObjectives: runtime ? this.mission.objectives.filter((objective) => !objective.optional && runtime.objectives[objective.id]?.status === 'completed').length : 0,
      totalRequiredObjectives: Math.max(1, this.mission.objectives.filter((objective) => !objective.optional).length),
      completedOptionalObjectives: runtime ? this.mission.objectives.filter((objective) => objective.optional && runtime.objectives[objective.id]?.status === 'completed').length : 0,
      totalOptionalObjectives: this.mission.objectives.filter((objective) => objective.optional).length,
      transportRemainingRatio: combat.transport
        ? combat.transport.health.current / combat.transport.health.max
        : undefined,
    });
    const nextMission = outcome === 'completed' ? getNextMission(this.mission.id) : null;
    const accuracyPct = combat.stats.shotsFired > 0
      ? Math.round((combat.stats.shotsHit / combat.stats.shotsFired) * 100)
      : 0;
    const result: MissionResult = {
      missionId: this.mission.id,
      missionNumber: this.mission.number,
      missionName: this.mission.name,
      difficulty: this.mission.difficulty,
      status: outcome,
      rank: outcome === 'completed' ? scoreBreakdown.rank : null,
      scoreBreakdown,
      enemiesDefeated: combat.stats.kills,
      totalEnemies: this.mission.totalEnemyCount,
      shotsFired: combat.stats.shotsFired,
      shotsHit: combat.stats.shotsHit,
      accuracyPct,
      timeTakenSec: runtime?.elapsedSec ?? this.elapsedSec,
      damageReceived: Math.round(combat.stats.damageTaken),
      remainingHullPct: Math.round((remainingHull / maxHull) * 100),
      transportRemainingHullPct: combat.transport
        ? Math.round((combat.transport.health.current / combat.transport.health.max) * 100)
        : null,
      unlockedNextMissionId: nextMission?.id ?? null,
      unlockedNextMissionName: nextMission ? `${nextMission.code} — ${nextMission.name}` : null,
      isNewBestRank: false,
      isNewBestScore: false,
      completedObjectiveIds: runtime ? this.mission.objectives.filter((objective) => runtime.objectives[objective.id]?.status === 'completed').map((objective) => objective.id) : [],
      optionalObjectiveIds: this.mission.objectives.filter((objective) => objective.optional).map((objective) => objective.id),
    };
    this.emitHud();
    this.callbacks.onMissionEnd?.(result);
  }

  private setAnnouncement(text: string, kind: 'info' | 'complete' | 'warning', durationSec: number): void {
    this.announcement = text;
    this.announcementKind = kind;
    this.announcementTimer = durationSec;
  }

  private emitHud(): void {
    const snapshot = this.getHudSnapshot();
    if (snapshot) this.callbacks.onHudUpdate?.(snapshot);
  }
}
