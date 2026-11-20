import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { advanceEvasion, advanceLock, canLaunchMissile, canMissileDamageTarget, isIncomingMissile, shouldAiUseMissile, steerMissile } from '../src/engine/combat/MissileRules.ts';
import { createHealthState, applyDamage } from '../src/engine/combat/HealthSystem.ts';
import { ProjectilePool } from '../src/engine/combat/ProjectilePool.ts';
import { WEAPON_CONFIGS } from '../src/config/weapons.ts';

test('target lock requires three continuous seconds and resets on escape', () => {
  let progress = 0;
  for (let i = 0; i < 179; i++) progress = advanceLock(progress, true, 1 / 60).progress;
  assert.ok(progress < 3);
  progress = advanceLock(progress, true, 1 / 60).progress;
  assert.equal(progress, 3);
  const escaped = advanceLock(progress - 0.01, false, 1 / 60);
  assert.equal(escaped.progress, 0);
  assert.equal(escaped.escaped, true);
});

test('missile launch requires a valid completed lock and ammunition', () => {
  assert.equal(canLaunchMissile(2.99, true, 2), false);
  assert.equal(canLaunchMissile(3, false, 2), false);
  assert.equal(canLaunchMissile(3, true, 0), false);
  assert.equal(canLaunchMissile(3, true, 2), true);
});

test('homing steering turns toward target and keeps a bounded direction', () => {
  const direction = new THREE.Vector3(0, 0, -1);
  steerMissile(direction, new THREE.Vector3(1, 0, 0), 0.1);
  assert.ok(direction.x > 0);
  assert.ok(Math.abs(direction.length() - 1) < 1e-9);
});

test('high speed perpendicular evasion builds charge; ordinary movement decays it', () => {
  const forward = new THREE.Vector3(0, 0, -1);
  const sharp = new THREE.Vector3(70, 0, 0);
  let progress = 0;
  for (let i = 0; i < 20; i++) progress = advanceEvasion(progress, sharp, forward, 1 / 60);
  assert.ok(progress >= 0.26);
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
