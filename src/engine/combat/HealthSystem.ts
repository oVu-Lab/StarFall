import type { EntityId, HealthState, ShieldState } from '../../types/combat';

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

export function createShieldState(
  maxShield: number,
  rechargeDelay = 3.5,
  rechargeRate = 7,
): ShieldState {
  const max = Math.max(0, maxShield);
  return {
    current: max,
    max,
    rechargeDelay: Math.max(0, rechargeDelay),
    rechargeRate: Math.max(0, rechargeRate),
    lastHitTime: -100,
    isBroken: false,
    isRecharging: false,
  };
}

export function resetShieldState(shield: ShieldState, maxShield?: number, rechargeDelay?: number, rechargeRate?: number): void {
  if (typeof maxShield === 'number' && maxShield >= 0) shield.max = maxShield;
  if (typeof rechargeDelay === 'number' && rechargeDelay >= 0) shield.rechargeDelay = rechargeDelay;
  if (typeof rechargeRate === 'number' && rechargeRate >= 0) shield.rechargeRate = rechargeRate;
  shield.current = shield.max;
  shield.lastHitTime = -100;
  shield.isBroken = false;
  shield.isRecharging = false;
}

export interface ShieldDamageResult extends DamageApplicationResult {
  incomingAmount: number;
  shieldDamage: number;
  hullDamage: number;
  shieldBrokenNow: boolean;
}

/** Route a hit through shields, then pass only overflow through the existing hull damage pipeline. */
export function applyShieldedDamage(
  shield: ShieldState,
  health: HealthState,
  amount: number,
  attackerId: EntityId,
  timestamp: number,
): ShieldDamageResult {
  const invalid = health.isDestroyed || !Number.isFinite(amount) || amount <= 0;
  if (invalid) {
    return { applied: false, appliedAmount: 0, remaining: health.current, destroyedNow: false,
      incomingAmount: 0, shieldDamage: 0, hullDamage: 0, shieldBrokenNow: false };
  }

  const incomingAmount = amount;
  const shieldBefore = shield.current;
  const shieldDamage = Math.min(shieldBefore, amount);
  const hullDamage = Math.max(0, amount - shieldDamage);
  shield.lastHitTime = timestamp;
  shield.isRecharging = false;
  if (shieldDamage > 0) {
    shield.current = Math.max(0, shieldBefore - shieldDamage);
    shield.isBroken = shield.current <= 0;
  }

  const hullResult = hullDamage > 0
    ? applyDamage(health, hullDamage, attackerId, timestamp)
    : { applied: true, appliedAmount: 0, remaining: health.current, destroyedNow: false };
  health.lastHitTime = timestamp;
  health.lastAttackerId = attackerId;
  return {
    applied: true,
    appliedAmount: hullResult.appliedAmount,
    remaining: hullResult.remaining,
    destroyedNow: hullResult.destroyedNow,
    incomingAmount,
    shieldDamage,
    hullDamage: hullResult.appliedAmount,
    shieldBrokenNow: shieldBefore > 0 && shield.current <= 0,
  };
}

export interface ShieldRechargeResult {
  began: boolean;
  amount: number;
}

export function updateShieldRecharge(shield: ShieldState, dt: number, timestamp: number): ShieldRechargeResult {
  if (shield.current >= shield.max || shield.max <= 0 || shield.rechargeRate <= 0 ||
      timestamp - shield.lastHitTime < shield.rechargeDelay) {
    shield.isRecharging = false;
    return { began: false, amount: 0 };
  }
  const began = !shield.isRecharging;
  shield.isRecharging = true;
  const before = shield.current;
  shield.current = Math.min(shield.max, shield.current + shield.rechargeRate * Math.max(0, dt));
  if (shield.current > 0) shield.isBroken = false;
  return { began, amount: shield.current - before };
}
