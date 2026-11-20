import type {
  MissionEvent,
  ObjectiveDefinition,
  ObjectiveRuntimeState,
  ObjectiveType,
} from '../../types/mission';

export interface ObjectiveHandler {
  onActivate?: (
    definition: ObjectiveDefinition,
    state: ObjectiveRuntimeState,
    history: readonly MissionEvent[],
  ) => void;
  onEvent: (
    definition: ObjectiveDefinition,
    state: ObjectiveRuntimeState,
    event: MissionEvent,
  ) => void;
}

const targetMatches = (definition: ObjectiveDefinition, actorId: string, callsign?: string) =>
  (!definition.actorId || definition.actorId === actorId) &&
  (!definition.targetCallsign || definition.targetCallsign === callsign) &&
  (!definition.targetCallsigns || definition.targetCallsigns.includes(callsign ?? ''));

const tracked = (state: ObjectiveRuntimeState, actorId: string): boolean => {
  if (state.trackedActorIds?.includes(actorId)) return true;
  state.trackedActorIds = [...(state.trackedActorIds ?? []), actorId];
  return false;
};

const eliminateHandler: ObjectiveHandler = {
  onActivate(definition, state, history) {
    for (const event of history) eliminateHandler.onEvent(definition, state, event);
  },
  onEvent(definition, state, event) {
    if (state.status !== 'active') return;
    if (event.type === 'enemy_destroyed' && targetMatches(definition, event.actorId, event.callsign)) {
      if (!tracked(state, event.actorId)) state.currentCount += 1;
    }
    if (event.type === 'wave_cleared' && state.currentCount >= state.targetCount) {
      state.status = 'completed';
    }
  },
};

const targetDestroyedHandler: ObjectiveHandler = {
  onActivate(definition, state, history) {
    for (const event of history) targetDestroyedHandler.onEvent(definition, state, event);
  },
  onEvent(definition, state, event) {
    if (state.status !== 'active') return;
    if (
      (event.type === 'enemy_destroyed' || event.type === 'actor_destroyed') &&
      targetMatches(definition, event.actorId, event.type === 'enemy_destroyed' ? event.callsign : event.callsign)
    ) {
      state.status = 'completed';
      state.currentCount = 1;
      state.progress = 1;
      state.detail = 'Target intercepted';
    }
  },
};

const surviveHandler: ObjectiveHandler = {
  onEvent(definition, state, event) {
    if (state.status !== 'active') return;
    if (event.type === 'timer_elapsed') {
      state.elapsedSec += event.deltaSec;
      const duration = definition.durationSec ?? definition.targetDurationSec ?? 0;
      if (duration > 0) state.progress = Math.min(1, state.elapsedSec / duration);
    } else if (event.type === 'wave_cleared') {
      state.currentCount += 1;
      const waves = definition.targetWaves ?? (definition.type === 'survive_waves' ? definition.targetCount : undefined);
      if (waves) state.progress = Math.min(1, state.currentCount / waves);
    }

    const duration = definition.durationSec ?? definition.targetDurationSec;
    const waves = definition.targetWaves ?? (definition.type === 'survive_waves' ? definition.targetCount : undefined);
    const durationDone = duration == null || duration <= 0 || state.elapsedSec >= duration;
    const wavesDone = waves == null || waves <= 0 || state.currentCount >= waves;
    if (durationDone && wavesDone && (duration != null || waves != null)) state.status = 'completed';
  },
};

const defendHandler: ObjectiveHandler = {
  onEvent(definition, state, event) {
    if (state.status !== 'active') return;
    if (event.type === 'actor_damaged' && event.actorId === definition.actorId) {
      state.currentIntegrity = event.currentIntegrity;
      state.maxIntegrity = event.maxIntegrity;
      state.detail = `Relay integrity ${Math.ceil(event.currentIntegrity)} / ${Math.ceil(event.maxIntegrity)}`;
      const threshold = definition.minIntegrity ?? 0;
      if (event.currentIntegrity <= threshold) {
        state.status = 'failed';
        return;
      }
    } else if (event.type === 'actor_progress' && event.actorId === definition.actorId) {
      if (event.currentIntegrity != null) state.currentIntegrity = event.currentIntegrity;
      if (event.maxIntegrity != null) state.maxIntegrity = event.maxIntegrity;
    } else if (event.type === 'timer_elapsed') {
      state.elapsedSec += event.deltaSec;
      const duration = definition.durationSec ?? definition.targetDurationSec ?? 0;
      if (duration > 0) state.progress = Math.min(1, state.elapsedSec / duration);
    } else if (event.type === 'wave_cleared') {
      state.currentCount += 1;
    } else if (event.type === 'protected_actor_lost' && event.actorId === definition.actorId) {
      state.status = 'failed';
      return;
    }
    const duration = definition.durationSec ?? definition.targetDurationSec ?? 0;
    const waves = definition.targetWaves ?? definition.targetCount ?? 0;
    if (duration > 0 && waves > 0) {
      state.progress = Math.min(1, state.elapsedSec / duration, state.currentCount / waves);
    } else if (duration > 0) {
      state.progress = Math.min(1, state.elapsedSec / duration);
    } else if (waves > 0) {
      state.progress = Math.min(1, state.currentCount / waves);
    }
    const durationDone = duration <= 0 || state.elapsedSec >= duration;
    const wavesDone = waves <= 0 || state.currentCount >= waves;
    if (durationDone && wavesDone) state.status = 'completed';
  },
};

const escortHandler: ObjectiveHandler = {
  onEvent(definition, state, event) {
    if (state.status !== 'active') return;
    if (event.type === 'actor_damaged' && (!definition.actorId || event.actorId === definition.actorId)) {
      state.currentIntegrity = event.currentIntegrity;
      state.maxIntegrity = event.maxIntegrity;
    } else if (event.type === 'actor_progress' && (!definition.actorId || event.actorId === definition.actorId)) {
      state.progress = Math.max(state.progress, event.progress);
      if (event.currentIntegrity != null) state.currentIntegrity = event.currentIntegrity;
      if (event.maxIntegrity != null) state.maxIntegrity = event.maxIntegrity;
      if (event.progress >= 1 && (state.currentIntegrity == null || state.currentIntegrity > 0)) {
        state.status = 'completed';
      }
    } else if (event.type === 'protected_actor_lost' && (!definition.actorId || event.actorId === definition.actorId || event.callsign === definition.actorId)) {
      state.status = 'failed';
    }
  },
};

const reconHandler: ObjectiveHandler = {
  onEvent(definition, state, event) {
    if (state.status !== 'active') return;
    if (event.type === 'scan_progress' && targetMatches(definition, event.actorId, event.callsign)) {
      state.elapsedSec += event.deltaSec;
      const duration = definition.durationSec ?? definition.scanDurationSec ?? 5;
      state.progress = Math.min(1, state.elapsedSec / duration);
      state.detail = `Scanning ${event.callsign}`;
      if (state.elapsedSec >= duration) {
        state.status = 'completed';
        state.progress = 1;
        state.detail = `Identified ${event.callsign}`;
      }
    } else if (event.type === 'scan_completed' && targetMatches(definition, event.actorId, event.callsign)) {
      state.status = 'completed';
      state.progress = 1;
      state.detail = `Identified ${event.callsign}`;
    } else if (event.type === 'scan_interrupted' && targetMatches(definition, event.actorId, event.callsign)) {
      state.elapsedSec = 0;
      state.progress = 0;
      state.detail = 'Scan interrupted';
    } else if (event.type === 'enemy_destroyed' && targetMatches(definition, event.actorId, event.callsign)) {
      state.status = 'failed';
      state.detail = `${event.callsign} lost before scan completion`;
    }
  },
};

const extractHandler: ObjectiveHandler = {
  onEvent(definition, state, event) {
    if (state.status === 'active' && event.type === 'extraction_point_reached' && event.actorId === definition.actorId) {
      state.status = 'completed';
      state.progress = 1;
      state.detail = 'Extraction confirmed';
    }
  },
};

export function createObjectiveHandlerRegistry(): ReadonlyMap<ObjectiveType, ObjectiveHandler> {
  const registry = new Map<ObjectiveType, ObjectiveHandler>();
  for (const type of ['eliminate', 'eliminate_all'] as const) registry.set(type, eliminateHandler);
  for (const type of ['intercept', 'boss', 'defeat_target'] as const) registry.set(type, targetDestroyedHandler);
  for (const type of ['survive', 'survive_duration', 'survive_waves'] as const) registry.set(type, surviveHandler);
  registry.set('defend', defendHandler);
  for (const type of ['escort', 'escort_transport'] as const) registry.set(type, escortHandler);
  registry.set('recon', reconHandler);
  registry.set('extract', extractHandler);
  return registry;
}
