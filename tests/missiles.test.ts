import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { advanceEvasion, advanceLock, canLaunchMissile, canMissileDamageTarget, guideMissile, isIncomingMissile, isTargetInCameraView, MISSILE_EVASION_SECONDS, MISSILE_LOCK_SECONDS, shouldAiUseMissile, steerMissile, updateTargetLock } from '../src/engine/combat/MissileRules.ts';
import { createHealthState, applyDamage } from '../src/engine/combat/HealthSystem.ts';
import { ProjectilePool } from '../src/engine/combat/ProjectilePool.ts';
import { WEAPON_CONFIGS } from '../src/config/weapons.ts';

test('target lock requires two continuous seconds and resets on escape', () => {
  let progress = 0;
  for (let i = 0; i < 119; i++) progress = advanceLock(progress, true, 1 / 60).progress;
  assert.ok(progress < 2);
  progress = advanceLock(progress, true, 1 / 60).progress;
  assert.equal(progress, 2);
  const escaped = advanceLock(progress - 0.01, false, 1 / 60);
  assert.equal(escaped.progress, 0);
  assert.equal(escaped.escaped, true);
});

test('completed lock persists outside the boundary only while visible in camera', () => {
  // No acquisition candidate means the target is outside the HUD Boundary.
  const held = updateTargetLock('enemy-1', MISSILE_LOCK_SECONDS, null, true, true, 1 / 60);
  assert.equal(held.targetId, 'enemy-1');
  assert.equal(held.progress, 2);
  assert.equal(held.escaped, false);
  const outOfCamera = updateTargetLock('enemy-1', MISSILE_LOCK_SECONDS, null, true, false, 1 / 60);
  assert.equal(outOfCamera.targetId, null);
  assert.equal(outOfCamera.progress, 0);
  const invalid = updateTargetLock('enemy-1', MISSILE_LOCK_SECONDS, null, false, true, 1 / 60);
  assert.equal(invalid.targetId, null);
  assert.equal(invalid.progress, 0);
});

test('completed lock visibility uses the camera frustum, not the HUD boundary', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  assert.equal(isTargetInCameraView(camera, new THREE.Vector3(0, 0, -20), 2), true);
  assert.equal(isTargetInCameraView(camera, new THREE.Vector3(100, 0, -20), 2), false);
});

test('missile launch requires a valid completed lock and ammunition', () => {
  assert.equal(canLaunchMissile(1.99, true, 2), false);
  assert.equal(canLaunchMissile(2, false, 2), false);
  assert.equal(canLaunchMissile(2, true, 0), false);
  assert.equal(canLaunchMissile(2, true, 2), true);
});

test('homing steering turns toward target and keeps a bounded direction', () => {
  const direction = new THREE.Vector3(0, 0, -1);
  steerMissile(direction, new THREE.Vector3(1, 0, 0), 0.1);
  assert.ok(direction.x > 0);
  assert.ok(Math.abs(direction.length() - 1) < 1e-9);
});

test('missile accelerates, predicts target motion, and can pursue a fast fighter', () => {
  const direction = new THREE.Vector3(0, 0, -1);
  const velocity = direction.clone().multiplyScalar(68);
  const missilePosition = new THREE.Vector3();
  const targetPosition = new THREE.Vector3(40, 0, -190);
  const targetVelocity = new THREE.Vector3(92, 0, 0);
  let minimumDistance = missilePosition.distanceTo(targetPosition);
  for (let i = 0; i < 220; i++) {
    guideMissile(direction, velocity, missilePosition, targetPosition, targetVelocity, 1 / 60);
    missilePosition.addScaledVector(velocity, 1 / 60);
    targetPosition.addScaledVector(targetVelocity, 1 / 60);
    minimumDistance = Math.min(minimumDistance, missilePosition.distanceTo(targetPosition));
  }
  assert.ok(velocity.length() > 130, 'missile accelerates to high pursuit speed');
  assert.ok(minimumDistance < 18, `missile closes on the fast target (closest ${minimumDistance.toFixed(1)}m)`);
});

test('ordinary acceleration does not evade; sustained fast perpendicular maneuver does', () => {
  const forward = new THREE.Vector3(0, 0, -1);
  const straightBoost = new THREE.Vector3(4, 0, -145);
  let straightProgress = 0;
  for (let i = 0; i < 60; i++) straightProgress = advanceEvasion(straightProgress, straightBoost, forward, 1 / 60);
  assert.equal(straightProgress, 0);
  const sharp = new THREE.Vector3(125, 0, 0);
  let progress = 0;
  for (let i = 0; i < 40; i++) progress = advanceEvasion(progress, sharp, forward, 1 / 60);
  assert.ok(progress >= MISSILE_EVASION_SECONDS);
  const small = new THREE.Vector3(20, 0, -20);
  assert.ok(Math.abs(advanceEvasion(0.2, small, forward, 0.1) - 0.05) < 1e-9);
});

test('missile warning follows only an active threat targeting the player', () => {
  assert.equal(isIncomingMissile(true, true, 'player-1', 'player-1'), true);
  assert.equal(isIncomingMissile(false, true, 'player-1', 'player-1'), false);
  assert.equal(isIncomingMissile(true, true, 'enemy-2', 'player-1'), false);
  assert.equal(isIncomingMissile(true, true, 'player-1', 'player-1', true), false);
});

test('missile target filtering prevents friendly fire and collateral hits', () => {
  assert.equal(canMissileDamageTarget('player-1', 'enemy-1', 'enemy-1'), true);
  assert.equal(canMissileDamageTarget('player-1', 'enemy-1', 'enemy-2'), false);
  assert.equal(canMissileDamageTarget('enemy-1', 'player-1', 'enemy-1'), false);
});

test('missile hits use the shared hull damage state and trigger destruction', () => {
  const hull = createHealthState(30);
  const result = applyDamage(hull, 34, 'player-1', 4);
  assert.equal(result.applied, true);
  assert.equal(result.destroyedNow, true);
  assert.equal(hull.isDestroyed, true);
});

test('AI missile policy preserves personality differences', () => {
  assert.equal(MISSILE_LOCK_SECONDS, 2, 'AI uses the balanced two-second lock interval');
  assert.equal(shouldAiUseMissile('aggressor'), true);
  assert.equal(shouldAiUseMissile('ace'), true);
  assert.equal(shouldAiUseMissile('flanker'), false);
  assert.equal(shouldAiUseMissile('defender'), false);
});

test('ordinary pulse cannon spawn retains its original non-homing behavior', () => {
  const pool = new ProjectilePool(2);
  const p = pool.spawn('player-1', 'player', WEAPON_CONFIGS.player_pulse_twin, new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  assert.equal(p.weaponId, WEAPON_CONFIGS.player_pulse_twin.id);
  assert.equal(p.isHomingMissile, false);
  assert.equal(p.damage, WEAPON_CONFIGS.player_pulse_twin.damage);
});
