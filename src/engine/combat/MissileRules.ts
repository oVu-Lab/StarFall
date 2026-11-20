import * as THREE from 'three';

export const MISSILE_LOCK_SECONDS = 3;

export function advanceLock(progress: number, targetRemainsInside: boolean, dt: number): { progress: number; escaped: boolean } {
  if (!targetRemainsInside) return { progress: 0, escaped: progress > 0 };
  return { progress: Math.min(MISSILE_LOCK_SECONDS, progress + Math.max(0, dt) + 1e-12), escaped: false };
}

export function canLaunchMissile(progress: number, targetValid: boolean, ammunition: number): boolean {
  return progress >= MISSILE_LOCK_SECONDS && targetValid && ammunition > 0;
}

export function steerMissile(direction: THREE.Vector3, targetDirection: THREE.Vector3, dt: number, turnRate = 3.1): void {
  direction.lerp(targetDirection, THREE.MathUtils.clamp(turnRate * dt, 0, 1)).normalize();
}

export function advanceEvasion(progress: number, velocity: THREE.Vector3, launcherForward: THREE.Vector3, dt: number): number {
  const speed = velocity.length();
  const lateralRatio = speed > 0.01
    ? _perpendicular.copy(velocity).projectOnPlane(launcherForward).length() / speed
    : 0;
  return speed > 58 && lateralRatio > 0.76
    ? progress + dt
    : Math.max(0, progress - dt * 1.5);
}

export function isIncomingMissile(active: boolean, homing: boolean, targetId: string | undefined, playerId: string, targetLost = false): boolean {
  return active && homing && !targetLost && targetId === playerId;
}

export function canMissileDamageTarget(ownerId: string, targetId: string | undefined, candidateId: string): boolean {
  return ownerId !== candidateId && (!targetId || targetId === candidateId);
}

export function shouldAiUseMissile(personality: string): boolean {
  return personality === 'aggressor' || personality === 'ace';
}

const _perpendicular = new THREE.Vector3();
