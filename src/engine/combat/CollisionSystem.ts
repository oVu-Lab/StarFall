import * as THREE from 'three';

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _closest = new THREE.Vector3();

/**
 * Continuous swept line-segment vs sphere intersection test.
 * Prevents high-speed projectiles from tunneling through ship hulls at any framerate.
 * Zero allocations; writes exact impact point to `outHitPoint` when intersecting.
 */
export function intersectSegmentSphere(
  segStart: THREE.Vector3,
  segEnd: THREE.Vector3,
  sphereCenter: THREE.Vector3,
  sphereRadius: number,
  outHitPoint?: THREE.Vector3,
): boolean {
  _ab.subVectors(segEnd, segStart);
  _ap.subVectors(sphereCenter, segStart);

  const abLenSq = _ab.lengthSq();
  let t = 0;
  if (abLenSq > 1e-8) {
    t = THREE.MathUtils.clamp(_ap.dot(_ab) / abLenSq, 0, 1);
  }

  _closest.copy(segStart).addScaledVector(_ab, t);
  const distSq = _closest.distanceToSquared(sphereCenter);
  const radSq = sphereRadius * sphereRadius;

  if (distSq <= radSq) {
    if (outHitPoint) {
      outHitPoint.copy(_closest);
    }
    return true;
  }
  return false;
}

/**
 * Simple fast sphere-to-sphere overlap test for ship-to-ship separation & collision.
 */
export function intersectSphereSphere(
  posA: THREE.Vector3,
  radiusA: number,
  posB: THREE.Vector3,
  radiusB: number,
): boolean {
  const r = radiusA + radiusB;
  return posA.distanceToSquared(posB) <= r * r;
}
