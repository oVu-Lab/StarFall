import type { EntityId, HealthState } from '../../types/combat';

export interface DamageApplicationResult {
  applied: boolean;
  appliedAmount: number;
  remaining: number;
  destroyedNow: boolean;
}

export function createHealthState(maxHealth: number): HealthState {
  const clampedMax = Math.max(1, maxHealth);
  return {
    current: clampedMax,
    max: clampedMax,
    isDestroyed: false,
    lastHitTime: -100,
    lastAttackerId: null,
  };
}

export function resetHealthState(health: HealthState, maxHealth?: number): void {
  if (typeof maxHealth === 'number' && maxHealth > 0) {
    health.max = maxHealth;
  }
  health.current = health.max;
  health.isDestroyed = false;
  health.lastHitTime = -100;
  health.lastAttackerId = null;
}

/**
 * Validates and applies hull damage safely.
 * Destroyed entities are strictly immune to additional damage events.
 */
export function applyDamage(
  health: HealthState,
  amount: number,
  attackerId: EntityId,
  timestamp: number,
): DamageApplicationResult {
  if (health.isDestroyed || health.current <= 0 || !Number.isFinite(amount) || amount <= 0) {
    return {
      applied: false,
      appliedAmount: 0,
      remaining: health.current,
      destroyedNow: false,
    };
  }

  const prev = health.current;
  health.current = Math.max(0, prev - amount);
  health.lastHitTime = timestamp;
  health.lastAttackerId = attackerId;

  const destroyedNow = health.current <= 0;
  if (destroyedNow) {
    health.current = 0;
    health.isDestroyed = true;
  }

  return {
    applied: true,
    appliedAmount: prev - health.current,
    remaining: health.current,
    destroyedNow,
  };
}

export function getHealthRatio(health: HealthState): number {
  return Math.max(0, Math.min(1, health.current / Math.max(health.max, 1)));
}
