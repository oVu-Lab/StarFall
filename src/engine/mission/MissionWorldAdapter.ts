import * as THREE from 'three';
import type { CombatManager } from '../combat/CombatManager';
import type { MissionDefinition, MissionEvent, MissionRuntimeState, ObjectiveDefinition } from '../../types/mission';

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

  public constructor(private readonly combat: CombatManager) {}

  public start(mission: MissionDefinition, playerMaxHull: number, playerPosition: THREE.Vector3): void {
    this.mission = mission;
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
        playerPosition,
      );
    }
    if (mission.escort) {
      this.combat.initializeTransport(mission.escort.callsign, mission.escort.maxHull, mission.escort.route, playerPosition);
    }
    this.extractionWorldPosition = mission.extractionPoint
      ? new THREE.Vector3(...mission.extractionPoint.offset).add(playerPosition)
      : null;
  }

  public spawnWave(mission: MissionDefinition, waveIndex: number, playerPosition: THREE.Vector3): void {
    const wave = mission.waves[waveIndex];
    if (wave) this.combat.spawnMissionWave(wave, mission.difficulty, mission.difficultyNumeric, playerPosition);
  }

  public update(dt: number, playerPosition: THREE.Vector3, interactHeld: boolean, runtime: MissionRuntimeState): MissionEvent[] {
    const events: MissionEvent[] = [];
    this.combat.updateTransport(dt);
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
    this.combat.clearMissionActors();
    this.mission = null;
    this.extractionWorldPosition = null;
    this.scanPrompt = null;
    this.extractionPrompt = null;
    this.scanningObjectiveId = null;
  }
}
