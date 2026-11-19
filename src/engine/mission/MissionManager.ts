import type * as THREE from 'three';
import { DIFFICULTY_PROFILES } from '../../config/difficulty';
import { getNextMission } from '../../config/missions';
import type { DestructionEvent } from '../../types/combat';
import type {
  MissionDefinition,
  MissionHudSnapshot,
  MissionResult,
  ObjectiveRuntimeState,
} from '../../types/mission';
import type { CombatManager } from '../combat/CombatManager';
import { calculateMissionScore } from './RankCalculator';

export type MissionRunStatus = 'idle' | 'active' | 'completed' | 'failed';

export interface MissionManagerCallbacks {
  onHudUpdate?: (snapshot: MissionHudSnapshot) => void;
  onMissionEnd?: (result: MissionResult) => void;
}

/**
 * Decoupled single-player campaign mission runtime.
 * Orchestrates mission waves, real-time objective evaluation (eliminate_all, survive_duration,
 * defeat_target, survive_waves), mission completion/failure detection, and deterministic ranking.
 * Never coupled to React — emits discrete HUD snapshots only on meaningful state transitions.
 */
export class MissionManager {
  private mission: MissionDefinition | null = null;
  private status: MissionRunStatus = 'idle';
  private elapsedSec = 0;
  private currentWaveIdx = 0;
  private completedWaves = 0;
  private pendingWaveDelay = -1;
  private defeatedEnemies = 0;
  private defeatedCallsigns = new Set<string>();
  private objectives: ObjectiveRuntimeState[] = [];
  private announcement: string | null = null;
  private announcementKind: 'info' | 'complete' | 'warning' = 'info';
  private announcementTimer = 0;
  private lastPublishedWholeSec = -1;
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

  public getHudSnapshot(): MissionHudSnapshot | null {
    if (!this.mission) return null;
    return {
      missionId: this.mission.id,
      missionCode: this.mission.code,
      missionName: this.mission.name,
      difficultyLabel: DIFFICULTY_PROFILES[this.mission.difficulty].label,
      waveIndex: Math.min(this.currentWaveIdx + 1, this.mission.waves.length),
      totalWaves: this.mission.waves.length,
      elapsedSec: this.elapsedSec,
      objectives: this.objectives.map((o) => ({ ...o })),
      announcement: this.announcement,
      announcementKind: this.announcementKind,
    };
  }

  public startMission(
    mission: MissionDefinition,
    combat: CombatManager,
    playerMaxHull: number,
    playerPos: THREE.Vector3,
  ): MissionHudSnapshot {
    this.mission = mission;
    this.status = 'active';
    this.elapsedSec = 0;
    this.currentWaveIdx = 0;
    this.completedWaves = 0;
    this.pendingWaveDelay = -1;
    this.defeatedEnemies = 0;
    this.defeatedCallsigns.clear();
    this.lastPublishedWholeSec = 0;

    this.objectives = mission.objectives.map((def) => ({
      id: def.id,
      type: def.type,
      label: def.label,
      status: 'active',
      currentCount: 0,
      targetCount: def.targetCount ?? (def.type === 'defeat_target' ? 1 : mission.totalEnemyCount),
      elapsedSec: 0,
      targetDurationSec: def.targetDurationSec ?? 0,
      targetCallsign: def.targetCallsign,
    }));

    combat.clearCombatState(playerMaxHull, true);

    const firstWave = mission.waves[0];
    if (firstWave) {
      combat.spawnMissionWave(firstWave, mission.difficulty, mission.difficultyNumeric, playerPos);
    }

    this.setAnnouncement(
      `${mission.code} · ${mission.name.toUpperCase()} — ${firstWave?.label ?? 'ENGAGE'}`,
      'info',
      3.4,
    );

    const snapshot = this.getHudSnapshot()!;
    this.callbacks.onHudUpdate?.(snapshot);
    return snapshot;
  }

  public abortMission(): void {
    this.status = 'idle';
    this.mission = null;
    this.objectives = [];
    this.announcement = null;
    this.announcementTimer = 0;
    this.pendingWaveDelay = -1;
  }

  public handleDestruction(evt: DestructionEvent, combat: CombatManager): void {
    if (this.status !== 'active' || !this.mission) return;

    if (evt.faction === 'player') {
      this.finishMission('failed', combat);
      return;
    }

    if (evt.faction === 'enemy') {
      this.defeatedEnemies += 1;
      if (evt.callsign) {
        this.defeatedCallsigns.add(evt.callsign);
      }
      this.evaluateObjectives(combat);
      this.emitHud();
    }
  }

  public update(dt: number, combat: CombatManager, playerPos: THREE.Vector3): void {
    if (this.status !== 'active' || !this.mission) return;

    const safeDt = Math.min(Math.max(dt, 0.0001), 0.05);
    this.elapsedSec += safeDt;

    let shouldEmitHud = false;

    // 1. Decay transient tactical banner announcement
    if (this.announcementTimer > 0) {
      this.announcementTimer = Math.max(0, this.announcementTimer - safeDt);
      if (this.announcementTimer <= 0 && this.announcement !== null) {
        this.announcement = null;
        shouldEmitHud = true;
      }
    }

    // 2. Check player destruction safeguard (in case collision killed player)
    if (combat.playerHealth.isDestroyed) {
      this.finishMission('failed', combat);
      return;
    }

    // 3. Advance timed survival objectives
    const wholeSec = Math.floor(this.elapsedSec);
    for (let i = 0; i < this.objectives.length; i++) {
      const obj = this.objectives[i];
      if (obj.status !== 'active') continue;
      if (obj.type === 'survive_duration') {
        obj.elapsedSec = Math.min(obj.targetDurationSec, this.elapsedSec);
        if (obj.elapsedSec >= obj.targetDurationSec) {
          obj.status = 'completed';
          this.setAnnouncement(`OBJECTIVE COMPLETE · ${obj.label.toUpperCase()}`, 'complete', 2.8);
          shouldEmitHud = true;
        }
      }
    }

    if (wholeSec !== this.lastPublishedWholeSec) {
      this.lastPublishedWholeSec = wholeSec;
      const hasTimedObjective = this.objectives.some(
        (o) => o.type === 'survive_duration' && o.status === 'active',
      );
      if (hasTimedObjective) {
        shouldEmitHud = true;
      }
    }

    // 4. Wave progression check
    const activeEnemies = combat.getActiveEnemyCount();
    const totalWaves = this.mission.waves.length;

    if (activeEnemies === 0) {
      // Current wave cleared
      if (this.completedWaves < this.currentWaveIdx + 1) {
        this.completedWaves = this.currentWaveIdx + 1;
        this.evaluateObjectives(combat);
        shouldEmitHud = true;

        // If another wave exists, schedule its entry with tactical announcement
        if (this.currentWaveIdx + 1 < totalWaves) {
          const nextWave = this.mission.waves[this.currentWaveIdx + 1];
          this.pendingWaveDelay = Math.max(0.1, nextWave.triggerDelaySec);
          const hasBoss = nextWave.enemies.some((e) => e.isPriorityTarget);
          this.setAnnouncement(
            hasBoss
              ? `WAVE ${nextWave.waveNumber}/${totalWaves} INCOMING — COMMAND WING DETECTED`
              : `WAVE ${nextWave.waveNumber}/${totalWaves} INCOMING — ${nextWave.label.toUpperCase()}`,
            hasBoss ? 'warning' : 'info',
            Math.max(2.6, nextWave.triggerDelaySec + 1.2),
          );
        }
      }

      if (this.pendingWaveDelay > 0) {
        this.pendingWaveDelay -= safeDt;
        if (this.pendingWaveDelay <= 0 && this.currentWaveIdx + 1 < totalWaves) {
          this.pendingWaveDelay = -1;
          this.currentWaveIdx += 1;
          const nextWave = this.mission.waves[this.currentWaveIdx];
          combat.spawnMissionWave(
            nextWave,
            this.mission.difficulty,
            this.mission.difficultyNumeric,
            playerPos,
          );
          shouldEmitHud = true;
        }
      }
    }

    // 5. Evaluate completion across all objectives
    const allComplete = this.evaluateObjectives(combat);
    if (allComplete) {
      this.finishMission('completed', combat);
      return;
    }

    if (shouldEmitHud) {
      this.emitHud();
    }
  }

  private evaluateObjectives(combat: CombatManager): boolean {
    if (!this.mission) return false;
    let allComplete = true;

    for (let i = 0; i < this.objectives.length; i++) {
      const obj = this.objectives[i];

      if (obj.type === 'eliminate_all') {
        obj.currentCount = Math.min(obj.targetCount, this.defeatedEnemies);
        if (obj.status === 'active' && obj.currentCount >= obj.targetCount && combat.getActiveEnemyCount() === 0) {
          obj.status = 'completed';
        }
      } else if (obj.type === 'survive_waves') {
        obj.currentCount = Math.min(obj.targetCount, this.completedWaves);
        if (obj.status === 'active' && obj.currentCount >= obj.targetCount && combat.getActiveEnemyCount() === 0) {
          obj.status = 'completed';
        }
      } else if (obj.type === 'defeat_target') {
        const hitTarget = obj.targetCallsign ? this.defeatedCallsigns.has(obj.targetCallsign) : false;
        obj.currentCount = hitTarget ? 1 : 0;
        if (obj.status === 'active' && hitTarget) {
          obj.status = 'completed';
          this.setAnnouncement(
            `PRIORITY TARGET ELIMINATED · ${obj.targetCallsign ?? 'COMMANDER'}`,
            'complete',
            2.8,
          );
        }
      } else if (obj.type === 'survive_duration') {
        if (obj.elapsedSec >= obj.targetDurationSec) {
          obj.status = 'completed';
        }
      }

      if (obj.status !== 'completed') {
        allComplete = false;
      }
    }

    return allComplete;
  }

  private finishMission(outcome: 'completed' | 'failed', combat: CombatManager): void {
    if (!this.mission || this.status !== 'active') return;
    this.status = outcome;

    if (outcome === 'failed') {
      for (const obj of this.objectives) {
        if (obj.status === 'active') obj.status = 'failed';
      }
    }

    const completed = outcome === 'completed';
    const remainingHull = Math.max(0, combat.playerHealth.current);
    const maxHull = Math.max(1, combat.playerHealth.max);

    const scoreBreakdown = calculateMissionScore({
      enemiesDefeated: this.defeatedEnemies,
      totalEnemies: this.mission.totalEnemyCount,
      shotsFired: combat.stats.shotsFired,
      shotsHit: combat.stats.shotsHit,
      remainingHull,
      maxHull,
      damageReceived: combat.stats.damageTaken,
      timeTakenSec: this.elapsedSec,
      parTimeSec: this.mission.parTimeSec,
      completed,
    });

    const nextMission = completed ? getNextMission(this.mission.id) : null;
    const accuracyPct =
      combat.stats.shotsFired > 0
        ? Math.round((combat.stats.shotsHit / combat.stats.shotsFired) * 100)
        : 0;

    const result: MissionResult = {
      missionId: this.mission.id,
      missionNumber: this.mission.number,
      missionName: this.mission.name,
      difficulty: this.mission.difficulty,
      status: outcome,
      rank: completed ? scoreBreakdown.rank : null,
      scoreBreakdown,
      enemiesDefeated: this.defeatedEnemies,
      totalEnemies: this.mission.totalEnemyCount,
      shotsFired: combat.stats.shotsFired,
      shotsHit: combat.stats.shotsHit,
      accuracyPct,
      timeTakenSec: this.elapsedSec,
      damageReceived: Math.round(combat.stats.damageTaken),
      remainingHullPct: Math.round((remainingHull / maxHull) * 100),
      unlockedNextMissionId: nextMission?.id ?? null,
      unlockedNextMissionName: nextMission ? `${nextMission.code} — ${nextMission.name}` : null,
      isNewBestRank: false,
      isNewBestScore: false,
    };

    this.emitHud();
    this.callbacks.onMissionEnd?.(result);
  }

  private setAnnouncement(
    text: string,
    kind: 'info' | 'complete' | 'warning',
    durationSec: number,
  ): void {
    this.announcement = text;
    this.announcementKind = kind;
    this.announcementTimer = durationSec;
  }

  private emitHud(): void {
    const snap = this.getHudSnapshot();
    if (snap) {
      this.callbacks.onHudUpdate?.(snap);
    }
  }
}
