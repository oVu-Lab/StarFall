import type { DamageEvent, DestructionEvent } from '../../types/combat';
import type { MissionEvent } from '../../types/mission';
import { PLAYER_ENTITY_ID, TRANSPORT_ENTITY_ID } from '../combat/CombatManager';

/** Translates simulation callbacks into stable mission-domain events. */
export class MissionEventAdapter {
  public fromDestruction(event: DestructionEvent): MissionEvent[] {
    if (event.entityId === PLAYER_ENTITY_ID || event.faction === 'player') {
      return [{ type: 'player_destroyed', actorId: event.entityId }];
    }
    if (event.faction === 'enemy') {
      return [
        { type: 'enemy_destroyed', actorId: event.entityId, callsign: event.callsign ?? '', priority: Boolean(event.isPriorityTarget) },
        { type: 'actor_destroyed', actorId: event.entityId, callsign: event.callsign },
      ];
    }
    return [
      { type: 'actor_destroyed', actorId: event.entityId, callsign: event.callsign },
      { type: 'protected_actor_lost', actorId: event.entityId, callsign: event.callsign },
    ];
  }

  public fromDamage(event: DamageEvent): MissionEvent[] {
    const events: MissionEvent[] = [{
      type: 'actor_damaged',
      actorId: event.targetId,
      callsign: this.protectedCallsign(event.targetId),
      amount: event.amount,
      currentIntegrity: event.remainingHealth,
      maxIntegrity: event.maxHealth,
    }];
    if (event.destroyed && event.targetId !== PLAYER_ENTITY_ID) {
      events.push({
        type: 'protected_actor_lost',
        actorId: event.targetId,
        callsign: this.protectedCallsign(event.targetId),
      });
    }
    return events;
  }

  private protectedCallsign(actorId: string): string | undefined {
    if (actorId === TRANSPORT_ENTITY_ID) return 'CIVILIAN-07';
    return undefined;
  }
}
