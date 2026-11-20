import * as THREE from 'three';

export const MISSILE_LOCK_SECONDS = 2;
export const MISSILE_TURN_RATE = 2.7;
export const MISSILE_ACCELERATION = 42;
export const MISSILE_MAX_SPEED = 148;
export const MISSILE_EVASION_SPEED = 96;
export const MISSILE_EVASION_LATERAL_RATIO = 0.82;
export const MISSILE_EVASION_SECONDS = 0.48;

export function isTargetInCameraView(
  camera: THREE.PerspectiveCamera,
  targetPosition: THREE.Vector3,
  targetRadius: number,
): boolean {
  _cameraFrustum.setFromProjectionMatrix(
    _cameraViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  return _cameraFrustum.intersectsSphere(_targetSphere.set(targetPosition, targetRadius));
}

export interface TargetLockUpdate {
  targetId: string | null;
  progress: number;
  escaped: boolean;
}

export function updateTargetLock(
  currentTargetId: string | null,
  progress: number,
  candidateId: string | null,
  currentTargetValid: boolean,
  currentTargetInCameraView: boolean,
  dt: number,
): TargetLockUpdate {
  if (currentTargetId && progress >= MISSILE_LOCK_SECONDS) {
    if (currentTargetValid && currentTargetInCameraView) {
      return { targetId: currentTargetId, progress: MISSILE_LOCK_SECONDS, escaped: false };
    }
    return {
      targetId: candidateId,
      progress: candidateId ? Math.min(MISSILE_LOCK_SECONDS, Math.max(0, dt)) : 0,
      escaped: false,
    };
  }
  const previousTarget = currentTargetId && currentTargetValid ? currentTargetId : null;
  const nextCandidate = candidateId;
  if (nextCandidate) {
    const sameAcquisition = nextCandidate === previousTarget;
    return {
      targetId: nextCandidate,
      progress: sameAcquisition ? advanceLock(progress, true, dt).progress : Math.min(MISSILE_LOCK_SECONDS, Math.max(0, dt)),
      escaped: Boolean(previousTarget && previousTarget !== nextCandidate && progress > 0 && progress < MISSILE_LOCK_SECONDS),
    };
  }
  return {
    targetId: null,
    progress: 0,
    escaped: Boolean(previousTarget && progress > 0 && progress < MISSILE_LOCK_SECONDS),
  };
}

export function advanceLock(progress: number, targetRemainsInside: boolean, dt: number): { progress: number; escaped: boolean } {
  if (!targetRemainsInside) return { progress: 0, escaped: progress > 0 };
  return { progress: Math.min(MISSILE_LOCK_SECONDS, progress + Math.max(0, dt) + 1e-12), escaped: false };
}

export function canLaunchMissile(progress: number, targetValid: boolean, ammunition: number): boolean {
  return progress >= MISSILE_LOCK_SECONDS && targetValid && ammunition > 0;
}

export function steerMissile(direction: THREE.Vector3, targetDirection: THREE.Vector3, dt: number, turnRate = 3.1): void {
  const angle = direction.angleTo(targetDirection);
  if (angle < 1e-6) return;
  _turnAxis.crossVectors(direction, targetDirection);
  if (_turnAxis.lengthSq() < 1e-10) {
    _turnAxis.crossVectors(direction, Math.abs(direction.y) < 0.9 ? _worldUp : _worldRight);
  }
  _turnAxis.normalize();
  _turnRotation.setFromAxisAngle(_turnAxis, Math.min(angle, Math.max(0, turnRate * dt)));
  direction.applyQuaternion(_turnRotation).normalize();
}

export function advanceEvasion(progress: number, velocity: THREE.Vector3, launcherForward: THREE.Vector3, dt: number): number {
  const speed = velocity.length();
  const lateralRatio = speed > 0.01
    ? _perpendicular.copy(velocity).projectOnPlane(launcherForward).length() / speed
    : 0;
  return speed > MISSILE_EVASION_SPEED && lateralRatio > MISSILE_EVASION_LATERAL_RATIO
    ? progress + dt
    : Math.max(0, progress - dt * 1.5);
}

export function guideMissile(
  direction: THREE.Vector3,
  velocity: THREE.Vector3,
  missilePosition: THREE.Vector3,
  targetPosition: THREE.Vector3,
  targetVelocity: THREE.Vector3,
  dt: number,
): void {
  const speed = velocity.length();
  const distance = missilePosition.distanceTo(targetPosition);
  const leadTime = THREE.MathUtils.clamp(distance / Math.max(1, speed + 28), 0, 1.4);
  _leadPoint.copy(targetPosition).addScaledVector(targetVelocity, leadTime);
  _desiredDirection.subVectors(_leadPoint, missilePosition).normalize();
  steerMissile(direction, _desiredDirection, dt, MISSILE_TURN_RATE);
  const acceleratedSpeed = Math.min(MISSILE_MAX_SPEED, speed + MISSILE_ACCELERATION * Math.max(0, dt));
  velocity.copy(direction).multiplyScalar(acceleratedSpeed);
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
const _leadPoint = new THREE.Vector3();
const _desiredDirection = new THREE.Vector3();
const _turnAxis = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _worldRight = new THREE.Vector3(1, 0, 0);
const _turnRotation = new THREE.Quaternion();
const _cameraViewProjection = new THREE.Matrix4();
const _cameraFrustum = new THREE.Frustum();
const _targetSphere = new THREE.Sphere();
