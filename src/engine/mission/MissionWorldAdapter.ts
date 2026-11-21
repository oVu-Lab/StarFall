import * as THREE from 'three';
import type { CombatEngagementZoneState } from '../../types/combat';
import type { CombatManager } from '../combat/CombatManager';
import type { EngagementZoneDefinition, MissionDefinition, MissionEvent, MissionRuntimeState } from '../../types/mission';

export const DEFAULT_CEZ_INNER_RADIUS = 160;
export const DEFAULT_CEZ_ACTIVE_RADIUS = 420;
export const DEFAULT_CEZ_SOFT_BOUNDARY_RADIUS = 565;
export const DEFAULT_CEZ_LEASH_RADIUS = 735;
const CEZ_TRANSITION_DURATION_SEC = 1.75;
const CEZ_MAX_TRANSITION_SPEED = 250;

export interface MissionWorldSnapshot {
  transport: { callsign: string; currentHull: number; maxHull: number; progress: number } | null;
  relay: { id: string; callsign: string; currentIntegrity: number; maxIntegrity: number; destroyed: boolean } | null;
  interaction: {
    kind: 'scan' | 'extract';
    targetLabel: string;
    prompt: string;
    available: boolean;
    progress: number;
    requiredProgress: number;
    distance: number | null;
  } | null;
  extractionPoint: { id: string; label: string; position: THREE.Vector3; radius: number } | null;
}

export interface MissionWorldAdapter {
  start(mission: MissionDefinition, playerMaxHull: number, playerPosition: THREE.Vector3): void;
  spawnWave(mission: MissionDefinition, waveIndex: number, playerPosition: THREE.Vector3): void;
  update(dt: number, playerPosition: THREE.Vector3, interactHeld: boolean, runtime: MissionRuntimeState): MissionEvent[];
  getActiveEnemyCount(): number;
  getSnapshot(runtime: MissionRuntimeState): MissionWorldSnapshot;
  getEngagementZone?(): CombatEngagementZoneState | null;
  cleanup(): void;
}

/** Combat implementation of mission world actions; objective handlers never see CombatManager. */
export class CombatMissionWorldAdapter implements MissionWorldAdapter {
  private mission: MissionDefinition | null = null;
  private extractionWorldPosition: THREE.Vector3 | null = null;
  private lastTransportProgress = -1;
  private scanningObjectiveId: string | null = null;
  private lostTransportReported = false;
  private lostRelayReported = false;
  private scanPrompt: MissionWorldSnapshot['interaction'] = null;
  private extractionPrompt: MissionWorldSnapshot['interaction'] = null;

  private readonly missionOrigin = new THREE.Vector3();
  private readonly resolvedAnchorOffset = new THREE.Vector3();
  private readonly prevZoneCenter = new THREE.Vector3();
  private lastStageId = '';
  private zoneTransitionTimer = 0;
  private readonly engagementZone: CombatEngagementZoneState = {
    id: '',
    active: false,
    anchorMode: 'static',
    center: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    targetCenter: new THREE.Vector3(),
    targetVelocity: new THREE.Vector3(),
    initialAnchorOffset: new THREE.Vector3(),
    innerRadius: DEFAULT_CEZ_INNER_RADIUS,
    activeRadius: DEFAULT_CEZ_ACTIVE_RADIUS,
    softBoundaryRadius: DEFAULT_CEZ_SOFT_BOUNDARY_RADIUS,
    leashRadius: DEFAULT_CEZ_LEASH_RADIUS,
    playerDistance: 0,
    playerInside: true,
  };

  public constructor(private readonly combat: CombatManager) {}

  public getEngagementZone(): CombatEngagementZoneState | null {
    return this.engagementZone.active ? this.engagementZone : null;
  }

  public start(mission: MissionDefinition, playerMaxHull: number, playerPosition: THREE.Vector3): void {
    this.mission = mission;
    this.missionOrigin.copy(playerPosition);
    this.lastTransportProgress = -1;
    this.scanningObjectiveId = null;
    this.lostTransportReported = false;
    this.lostRelayReported = false;
    this.scanPrompt = null;
    this.extractionPrompt = null;
    this.combat.clearCombatState(playerMaxHull, true);
    if (mission.relay) {
      this.combat.initializeRelay(
        mission.relay.id,
        mission.relay.callsign,
        mission.relay.maxIntegrity,
        mission.relay.offset,
        mission.relay.collisionRadius,
        this.missionOrigin,
      );
    }
    if (mission.escort) {
      this.combat.initializeTransport(mission.escort.callsign, mission.escort.maxHull, mission.escort.route, this.missionOrigin);
    }
    this.extractionWorldPosition = mission.extractionPoint
      ? new THREE.Vector3(...mission.extractionPoint.offset).add(this.missionOrigin)
      : null;

    this.lastStageId = mission.stages[0]?.id ?? '';
    this.zoneTransitionTimer = 0;
    this.applyStageZone(mission, this.lastStageId, true);
    this.engagementZone.playerDistance = playerPosition.distanceTo(this.engagementZone.center);
    this.engagementZone.playerInside = this.engagementZone.playerDistance <= this.engagementZone.activeRadius;
    this.combat.setEngagementZone(this.engagementZone);
  }

  public spawnWave(mission: MissionDefinition, waveIndex: number, _playerPosition: THREE.Vector3): void {
    const wave = mission.waves[waveIndex];
    if (!wave) return;
    const anchorPos = this.engagementZone.active && this.engagementZone.anchorMode === 'actor'
      ? this.engagementZone.center
      : this.missionOrigin;
    this.combat.spawnMissionWave(wave, mission.difficulty, mission.difficultyNumeric, anchorPos);
  }

  public update(dt: number, playerPosition: THREE.Vector3, interactHeld: boolean, runtime: MissionRuntimeState): MissionEvent[] {
    const events: MissionEvent[] = [];
    this.combat.updateTransport(dt);

    if (this.mission && runtime.currentStageId && runtime.currentStageId !== this.lastStageId) {
      this.lastStageId = runtime.currentStageId;
      this.applyStageZone(this.mission, this.lastStageId, false);
    }
    this.updateEngagementZone(dt, playerPosition);

    const transport = this.combat.transport;
    if (transport) {
      if (Math.abs(transport.progress - this.lastTransportProgress) >= 0.002 || transport.progress >= 1) {
        this.lastTransportProgress = transport.progress;
        events.push({
          type: 'actor_progress',
          actorId: transport.callsign,
          progress: transport.progress,
          currentIntegrity: transport.health.current,
          maxIntegrity: transport.health.max,
        });
      }
      if (transport.health.isDestroyed && !this.lostTransportReported) {
        this.lostTransportReported = true;
        events.push({ type: 'protected_actor_lost', actorId: 'transport-1', callsign: transport.callsign });
      }
    }
    const relay = this.combat.relay;
    if (relay?.health.isDestroyed && !this.lostRelayReported) {
      this.lostRelayReported = true;
      events.push({ type: 'protected_actor_lost', actorId: relay.id, callsign: relay.callsign });
    }

    this.updateReconInteraction(dt, playerPosition, interactHeld, runtime, events);
    this.updateExtractionInteraction(playerPosition, interactHeld, runtime, events);
    return events;
  }

  private resolveStageZoneDefinition(mission: MissionDefinition, stageId: string): EngagementZoneDefinition {
    const stage = mission.stages.find((candidate) => candidate.id === stageId);
    const explicit = stage?.engagementZone ?? mission.engagementZone;
    if (explicit) return explicit;

    if (mission.relay) {
      return {
        id: mission.relay.id,
        anchorMode: 'static',
        offset: mission.relay.offset,
      };
    }

    if (mission.escort) {
      return {
        id: 'escort-zone',
        anchorMode: 'actor',
        actorId: 'transport-1',
        offset: mission.escort.route[0] ?? [0, 0, 0],
      };
    }

    const stageWave = stage
      ? mission.waves.find((wave) => stage.waveNumbers.includes(wave.waveNumber))
      : mission.waves[0];

    if (mission.extractionPoint && (!stageWave || stage?.objectiveIds.some((id) =>
      mission.objectives.find((o) => o.id === id)?.type === 'extract',
    ))) {
      return {
        id: mission.extractionPoint.id,
        anchorMode: 'point',
        offset: mission.extractionPoint.offset,
      };
    }

    if (stageWave && stageWave.enemies.length > 0) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const enemy of stageWave.enemies) {
        sx += enemy.offset[0];
        sy += enemy.offset[1];
        sz += enemy.offset[2];
      }
      const inv = 1 / stageWave.enemies.length;
      return {
        id: stage ? `${stage.id}-zone` : `${mission.id}-zone`,
        anchorMode: 'stage_centroid',
        offset: [sx * inv, sy * inv, sz * inv],
      };
    }

    return {
      id: `${mission.id}-zone`,
      anchorMode: 'static',
      offset: [0, 0, -220],
    };
  }

  private applyStageZone(mission: MissionDefinition, stageId: string, immediate: boolean): void {
    const def = this.resolveStageZoneDefinition(mission, stageId);
    const zone = this.engagementZone;
    zone.id = def.id ?? (stageId || mission.id);
    zone.active = true;
    zone.anchorMode = def.anchorMode;
    zone.innerRadius = def.innerRadius ?? DEFAULT_CEZ_INNER_RADIUS;
    zone.activeRadius = def.activeRadius ?? DEFAULT_CEZ_ACTIVE_RADIUS;
    zone.softBoundaryRadius = def.softBoundaryRadius ?? Math.round(zone.activeRadius * 1.35);
    zone.leashRadius = def.leashRadius ?? Math.round(zone.activeRadius * 1.75);

    const offset = def.offset ?? [0, 0, 0];
    this.resolvedAnchorOffset.set(offset[0], offset[1], offset[2]);
    if (immediate) {
      zone.initialAnchorOffset.copy(this.resolvedAnchorOffset);
    }

    if (def.anchorMode === 'actor' && this.combat.transport?.active) {
      zone.targetCenter.copy(this.combat.transport.position);
      zone.targetVelocity.copy(this.combat.transport.velocity);
    } else {
      zone.targetCenter.copy(this.missionOrigin).add(this.resolvedAnchorOffset);
      zone.targetVelocity.set(0, 0, 0);
    }

    if (immediate) {
      zone.center.copy(zone.targetCenter);
      zone.velocity.copy(zone.targetVelocity);
      this.zoneTransitionTimer = 0;
    } else if (zone.center.distanceToSquared(zone.targetCenter) > 1) {
      this.zoneTransitionTimer = CEZ_TRANSITION_DURATION_SEC;
    }
  }

  private updateEngagementZone(dt: number, playerPosition: THREE.Vector3): void {
    const zone = this.engagementZone;
    if (!zone.active) return;

    if (zone.anchorMode === 'actor') {
      const transport = this.combat.transport;
      if (transport?.active && !transport.health.isDestroyed) {
        zone.targetCenter.copy(transport.position);
        zone.targetVelocity.copy(transport.velocity);
      } else {
        zone.targetVelocity.set(0, 0, 0);
      }
    } else {
      zone.targetCenter.copy(this.missionOrigin).add(this.resolvedAnchorOffset);
      zone.targetVelocity.set(0, 0, 0);
    }

    this.prevZoneCenter.copy(zone.center);
    const safeDt = Math.max(dt, 0.0001);
    const distSq = zone.center.distanceToSquared(zone.targetCenter);

    if (this.zoneTransitionTimer > 0) {
      this.zoneTransitionTimer = Math.max(0, this.zoneTransitionTimer - safeDt);
      const alpha = 1 - Math.exp(-3.5 * safeDt);
      zone.center.lerp(zone.targetCenter, alpha);
      zone.velocity.subVectors(zone.center, this.prevZoneCenter).divideScalar(safeDt);
    } else if (distSq > 0.25) {
      // Continue smooth convergence even after timer expires—never snap on residual gap
      const alpha = 1 - Math.exp(-6.0 * safeDt);
      zone.center.lerp(zone.targetCenter, alpha);
      zone.velocity.subVectors(zone.center, this.prevZoneCenter).divideScalar(safeDt);
    } else {
      zone.center.copy(zone.targetCenter);
      zone.velocity.copy(zone.targetVelocity);
    }

    const speedSq = zone.velocity.lengthSq();
    if (speedSq > CEZ_MAX_TRANSITION_SPEED * CEZ_MAX_TRANSITION_SPEED) {
      zone.velocity.multiplyScalar(CEZ_MAX_TRANSITION_SPEED / Math.sqrt(speedSq));
    }

    zone.playerDistance = playerPosition.distanceTo(zone.center);
    zone.playerInside = zone.playerDistance <= zone.activeRadius;
  }

  private updateReconInteraction(
    dt: number,
    playerPosition: THREE.Vector3,
    interactHeld: boolean,
    runtime: MissionRuntimeState,
    events: MissionEvent[],
  ): void {
    const objective = this.mission?.objectives.find((definition) => definition.type === 'recon' && runtime.objectives[definition.id]?.status === 'active');
    if (!objective?.targetCallsign) {
      this.scanningObjectiveId = null;
      this.scanPrompt = null;
      return;
    }
    const target = this.combat.getAimedEnemy();
    const distance = target ? playerPosition.distanceTo(target.position) : null;
    const maxRange = objective.maxRange ?? 300;
    const available = Boolean(target && target.callsign === objective.targetCallsign && distance != null && distance <= maxRange);
    const progress = runtime.objectives[objective.id]?.progress ?? 0;
    this.scanPrompt = {
      kind: 'scan',
      targetLabel: objective.targetCallsign,
      prompt: available ? `HOLD E TO SCAN ${objective.targetCallsign}` : `AIM AT ${objective.targetCallsign} · WITHIN ${Math.round(maxRange)}M`,
      available,
      progress,
      requiredProgress: objective.durationSec ?? objective.scanDurationSec ?? 5,
      distance,
    };

    if (interactHeld && available && target) {
      this.scanningObjectiveId = objective.id;
      events.push({ type: 'scan_progress', actorId: target.id, callsign: target.callsign, deltaSec: dt });
    } else if (this.scanningObjectiveId === objective.id) {
      events.push({ type: 'scan_interrupted', actorId: target?.id ?? '', callsign: objective.targetCallsign });
      this.scanningObjectiveId = null;
    }
  }

  private updateExtractionInteraction(
    playerPosition: THREE.Vector3,
    interactHeld: boolean,
    runtime: MissionRuntimeState,
    events: MissionEvent[],
  ): void {
    const definition = this.mission?.extractionPoint;
    const activeObjective = this.mission?.objectives.find((objective) =>
      objective.type === 'extract' && runtime.objectives[objective.id]?.status === 'active',
    );
    if (!definition || !activeObjective || !this.extractionWorldPosition) {
      this.extractionPrompt = null;
      return;
    }
    const distance = playerPosition.distanceTo(this.extractionWorldPosition);
    const available = distance <= definition.radius;
    this.extractionPrompt = {
      kind: 'extract',
      targetLabel: definition.label,
      prompt: available ? `HOLD E TO CONFIRM ${definition.label.toUpperCase()}` : `REACH ${definition.label.toUpperCase()}`,
      available,
      progress: 0,
      requiredProgress: 1,
      distance,
    };
    if (interactHeld && available) events.push({ type: 'extraction_point_reached', actorId: definition.id });
  }

  public getActiveEnemyCount(): number {
    return this.combat.getActiveEnemyCount();
  }

  public getSnapshot(runtime: MissionRuntimeState): MissionWorldSnapshot {
    const relay = this.combat.relay;
    const transport = this.combat.transport;
    const activeScan = this.mission?.objectives.find((objective) =>
      objective.type === 'recon' && runtime.objectives[objective.id]?.status === 'active',
    );
    const interaction = activeScan ? this.scanPrompt : this.extractionPrompt;
    if (interaction && activeScan) interaction.progress = runtime.objectives[activeScan.id]?.progress ?? 0;
    return {
      transport: transport ? {
        callsign: transport.callsign,
        currentHull: transport.health.current,
        maxHull: transport.health.max,
        progress: transport.progress,
      } : null,
      relay: relay ? {
        id: relay.id,
        callsign: relay.callsign,
        currentIntegrity: relay.health.current,
        maxIntegrity: relay.health.max,
        destroyed: relay.health.isDestroyed,
      } : null,
      interaction: interaction ? { ...interaction } : null,
      extractionPoint: this.mission?.extractionPoint && this.extractionWorldPosition ? {
        id: this.mission.extractionPoint.id,
        label: this.mission.extractionPoint.label,
        position: this.extractionWorldPosition.clone(),
        radius: this.mission.extractionPoint.radius,
      } : null,
    };
  }

  public cleanup(): void {
    this.engagementZone.active = false;
    this.combat.setEngagementZone(null);
    this.combat.clearMissionActors();
    this.mission = null;
    this.extractionWorldPosition = null;
    this.scanPrompt = null;
    this.extractionPrompt = null;
    this.scanningObjectiveId = null;
    this.lastStageId = '';
    this.zoneTransitionTimer = 0;
  }
}
