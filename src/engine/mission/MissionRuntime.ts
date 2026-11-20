import type {
  MissionCondition,
  MissionDefinition,
  MissionEvent,
  MissionFailureCondition,
  MissionRuntimeState,
  MissionStageDefinition,
  ObjectiveDefinition,
  ObjectiveRuntimeState,
} from '../../types/mission';
import { createObjectiveHandlerRegistry, type ObjectiveHandler } from './MissionObjectiveHandlers';

function createObjectiveState(definition: ObjectiveDefinition): ObjectiveRuntimeState {
  return {
    id: definition.id,
    type: definition.type,
    label: definition.label,
    status: 'locked',
    currentCount: 0,
    targetCount: definition.targetCount ?? definition.targetWaves ??
      (definition.type === 'intercept' || definition.type === 'boss' || definition.type === 'defeat_target' ? 1 : 0),
    elapsedSec: 0,
    targetDurationSec: definition.durationSec ?? definition.targetDurationSec ?? definition.scanDurationSec ?? 0,
    targetCallsign: definition.targetCallsign,
    optional: Boolean(definition.optional),
    progress: 0,
    trackedActorIds: [],
  };
}

export class MissionRuntime {
  private mission: MissionDefinition | null = null;
  private state: MissionRuntimeState | null = null;
  private readonly handlers: ReadonlyMap<string, ObjectiveHandler>;
  private readonly seenEnemyDestructions = new Set<string>();
  private eventHistory: MissionEvent[] = [];

  public constructor(handlers: ReadonlyMap<string, ObjectiveHandler> = createObjectiveHandlerRegistry()) {
    this.handlers = handlers;
  }

  public start(mission: MissionDefinition): MissionRuntimeState {
    this.mission = mission;
    this.seenEnemyDestructions.clear();
    this.eventHistory = [];
    this.state = {
      missionId: mission.id,
      status: 'active',
      elapsedSec: 0,
      currentStageId: mission.stages[0]?.id ?? '',
      currentWave: mission.waves[0]?.waveNumber ?? 0,
      objectives: Object.fromEntries(mission.objectives.map((definition) => [definition.id, createObjectiveState(definition)])),
      events: this.eventHistory,
    };
    this.refreshObjectiveActivation();
    return this.getState()!;
  }

  public getMission(): MissionDefinition | null {
    return this.mission;
  }

  public getState(): MissionRuntimeState | null {
    if (!this.state) return null;
    return {
      ...this.state,
      objectives: Object.fromEntries(Object.entries(this.state.objectives).map(([id, objective]) => [id, {
        ...objective,
        trackedActorIds: objective.trackedActorIds ? [...objective.trackedActorIds] : [],
      }])),
      events: [...this.state.events],
    };
  }

  /** Processes a simulation batch atomically so failure precedence is deterministic. */
  public processEvents(events: readonly MissionEvent[]): boolean {
    if (!this.mission || !this.state || this.state.status !== 'active') return false;
    for (const event of events) {
      if (event.type === 'enemy_destroyed') {
        if (this.seenEnemyDestructions.has(event.actorId)) continue;
        this.seenEnemyDestructions.add(event.actorId);
      }
      if (event.type === 'timer_elapsed') this.state.elapsedSec += event.deltaSec;
      if (event.type === 'wave_started') this.advanceStage(event.waveNumber);
      if (event.type !== 'timer_elapsed' && event.type !== 'actor_progress' && event.type !== 'scan_progress') {
        this.eventHistory.push(event);
      }
      for (const definition of this.mission.objectives) {
        const runtime = this.state.objectives[definition.id];
        if (runtime.status !== 'active') continue;
        this.getHandler(definition).onEvent(definition, runtime, event);
      }
      this.refreshObjectiveActivation();
    }

    const failure = this.mission.outcome.failure.some((condition) => this.conditionMatchesFailure(condition));
    const success = this.conditionMatches(this.mission.outcome.success);
    const failureFirst = this.mission.outcome.failurePrecedence !== 'success_first';
    const outcome = failureFirst ? (failure ? 'failed' : success ? 'completed' : null) : (success ? 'completed' : failure ? 'failed' : null);
    if (!outcome) return false;

    this.state.status = outcome;
    for (const objective of Object.values(this.state.objectives)) {
      if (objective.status === 'active' || objective.status === 'locked') {
        objective.status = outcome === 'completed' ? 'skipped' : objective.status === 'active' ? 'failed' : 'skipped';
      }
    }
    return true;
  }

  private getHandler(definition: ObjectiveDefinition): ObjectiveHandler {
    const handler = this.handlers.get(definition.type);
    if (!handler) throw new Error(`No objective handler registered for '${definition.type}'`);
    return handler;
  }

  private advanceStage(waveNumber: number): void {
    if (!this.mission || !this.state) return;
    this.state.currentWave = waveNumber;
    const stage = this.mission.stages.find((candidate) => candidate.waveNumbers.includes(waveNumber));
    if (stage) this.state.currentStageId = stage.id;
  }

  private refreshObjectiveActivation(): void {
    if (!this.mission || !this.state || this.state.status !== 'active') return;
    let didActivate = true;
    while (didActivate) {
      didActivate = false;
      for (const definition of this.mission.objectives) {
        const runtime = this.state.objectives[definition.id];
        if (runtime.status !== 'locked') continue;
        const dependencyStates = (definition.dependsOn ?? []).map((id) => this.state!.objectives[id]?.status);
        if (dependencyStates.some((status) => status === 'failed' || status === 'skipped')) {
          runtime.status = 'skipped';
          didActivate = true;
          continue;
        }
        const stage = this.mission.stages.find((candidate) => candidate.id === this.state!.currentStageId);
        const stageAllows = !stage || stage.objectiveIds.includes(definition.id);
        const waveAllows = !definition.activation || definition.activation.type !== 'wave_reached' ||
          this.state.currentWave >= definition.activation.waveNumber;
        const dependenciesComplete = dependencyStates.every((status) => status === 'completed');
        if (stageAllows && waveAllows && dependenciesComplete) {
          runtime.status = 'active';
          this.getHandler(definition).onActivate?.(definition, runtime, this.eventHistory);
          didActivate = true;
        }
      }
    }
  }

  private conditionMatches(condition: MissionCondition | { mode: 'all' | 'any'; objectiveIds: string[] }): boolean {
    if (!this.state) return false;
    if ('mode' in condition) {
      const matches = condition.objectiveIds.map((id) => this.state!.objectives[id]?.status === 'completed');
      return condition.mode === 'all' ? matches.every(Boolean) : matches.some(Boolean);
    }
    if (condition.kind === 'objective') return this.state.objectives[condition.objectiveId]?.status === 'completed';
    if (condition.kind === 'objective_status') return this.state.objectives[condition.objectiveId]?.status === condition.status;
    if (condition.kind === 'all' || condition.kind === 'any') {
      return condition.kind === 'all'
        ? condition.conditions.every((child) => this.conditionMatches(child))
        : condition.conditions.some((child) => this.conditionMatches(child));
    }
    return this.state.events.some((event) => event.type === condition.eventType && (!condition.actorId || eventActorId(event) === condition.actorId));
  }

  private conditionMatchesFailure(condition: MissionFailureCondition): boolean {
    if (condition === 'player_destroyed') return Boolean(this.state?.events.some((event) => event.type === 'player_destroyed'));
    if (condition === 'transport_destroyed') {
      const callsign = this.mission?.escort?.callsign;
      return Boolean(this.state?.events.some((event) => event.type === 'protected_actor_lost' &&
        (event.actorId === 'transport-1' || event.callsign === callsign)));
    }
    return this.conditionMatches(condition);
  }
}

function eventActorId(event: MissionEvent): string | undefined {
  if ('actorId' in event) return event.actorId;
  return undefined;
}

export function getActiveStage(mission: MissionDefinition, state: MissionRuntimeState): MissionStageDefinition | undefined {
  return mission.stages.find((stage) => stage.id === state.currentStageId);
}
