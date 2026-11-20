import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SHIP_CONFIGS } from '../src/config/ships';
import { WEAPON_CONFIGS } from '../src/config/weapons';
import { CombatManager, type VfxBurstEvent } from '../src/engine/combat/CombatManager';
import { FlightController, createInitialTelemetry } from '../src/engine/FlightController';
import type { InputSnapshot } from '../src/engine/InputManager';
import {
  createPulseBoltCoreGeometry,
  createPulseBoltGlowGeometry,
  createPulseBoltTrailGeometry,
  createSparkStreakGeometry,
} from '../src/scene/CombatVFX';
import {
  createMuzzleJetGeometry,
  evaluateMuzzleFlashEnvelope,
  resolvePulseCannonMuzzles,
} from '../src/scene/PulseCannonVFX';
import { VANGUARD_HARDPOINTS } from '../src/scene/vanguardModel';

function makeIdleInput(overrides?: Partial<InputSnapshot>): InputSnapshot {
  return {
    forward: false,
    backward: false,
    rollLeft: false,
    rollRight: false,
    boost: false,
    firePrimary: false,
    missilePressed: false,
    keyPitchUp: false,
    keyPitchDown: false,
    keyYawLeft: false,
    keyYawRight: false,
    mouseDeltaX: 0,
    mouseDeltaY: 0,
    stickX: 0,
    stickY: 0,
    stickMagnitude: 0,
    steerYaw: 0,
    steerPitch: 0,
    steeringZone: 'deadzone',
    pointerLocked: true,
    ...overrides,
  };
}

function assertValidGeometry(geo: THREE.BufferGeometry, label: string): void {
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  assert.ok(pos && pos.count > 0, `${label}: must have vertices`);
  assert.ok(norm && norm.count === pos.count, `${label}: must have matching normals`);
  for (let i = 0; i < pos.count; i++) {
    assert.ok(
      Number.isFinite(pos.getX(i)) &&
        Number.isFinite(pos.getY(i)) &&
        Number.isFinite(pos.getZ(i)),
      `${label}: finite position at vertex ${i}`,
    );
    assert.ok(
      Number.isFinite(norm.getX(i)) &&
        Number.isFinite(norm.getY(i)) &&
        Number.isFinite(norm.getZ(i)),
      `${label}: finite normal at vertex ${i}`,
    );
  }
}

test('PulseCannonVFX resolves exact VX-9 Vanguard cannon muzzle hardpoints', () => {
  const muzzles = resolvePulseCannonMuzzles('interceptor');
  assert.equal(muzzles.length, 2);
  assert.deepEqual([...muzzles[0]], [...VANGUARD_HARDPOINTS.cannonMuzzles[0]]);
  assert.deepEqual([...muzzles[1]], [...VANGUARD_HARDPOINTS.cannonMuzzles[1]]);
  assert.deepEqual([...muzzles[0]], WEAPON_CONFIGS.player_pulse_twin.muzzleOffsets[0]);
  assert.deepEqual([...muzzles[1]], WEAPON_CONFIGS.player_pulse_twin.muzzleOffsets[1]);
});

test('Muzzle flash envelope expands rapidly, peaks early, and decays cleanly to zero', () => {
  const start = evaluateMuzzleFlashEnvelope(0);
  const peak = evaluateMuzzleFlashEnvelope(0.014);
  const mid = evaluateMuzzleFlashEnvelope(0.048);
  const end = evaluateMuzzleFlashEnvelope(0.10);

  assert.equal(start.intensity, 0);
  assert.ok(peak.intensity > 0.65, `expected strong early peak, got ${peak.intensity}`);
  assert.ok(mid.intensity < peak.intensity && mid.intensity > 0.1, 'smooth mid decay');
  assert.ok(mid.expansion > peak.expansion, 'monotonically expands during flash');
  assert.equal(end.intensity, 0);
});

test('Pulse Cannon procedural VFX geometries have valid finite attributes and proper alignment', () => {
  const jet = createMuzzleJetGeometry();
  const core = createPulseBoltCoreGeometry();
  const glow = createPulseBoltGlowGeometry();
  const trail = createPulseBoltTrailGeometry();
  const spark = createSparkStreakGeometry();

  assertValidGeometry(jet, 'muzzleJet');
  assertValidGeometry(core, 'pulseBoltCore');
  assertValidGeometry(glow, 'pulseBoltGlow');
  assertValidGeometry(trail, 'pulseBoltTrail');
  assertValidGeometry(spark, 'sparkStreak');

  // Muzzle jet must project forward along -Z from exact origin (z <= 0.001)
  jet.computeBoundingBox();
  assert.ok(jet.boundingBox!.max.z <= 0.001, 'muzzle jet originates at z=0 without poking backward');
  assert.ok(jet.boundingBox!.min.z <= -0.99, 'muzzle jet extends forward along -Z');

  // Trail must extend purely behind bolt junction (y <= 0.001)
  trail.computeBoundingBox();
  assert.ok(trail.boundingBox!.max.y <= 0.001, 'bolt trail starts at y=0 without overlapping nose');
  assert.ok(trail.boundingBox!.min.y <= -0.99, 'bolt trail tapers aft along -Y');

  jet.dispose();
  core.dispose();
  glow.dispose();
  trail.dispose();
  spark.dispose();
});

test('CombatManager preserves Pulse Cannon stats and emits distinct localized shield vs hull impact bursts', () => {
  const weapon = WEAPON_CONFIGS.player_pulse_twin;
  assert.equal(weapon.fireRate, 7.5);
  assert.equal(weapon.damage, 20);
  assert.equal(weapon.projectileSpeed, 520);

  const ship = SHIP_CONFIGS.interceptor;
  const flight = new FlightController(ship);
  flight.reset();
  flight.position.set(0, 0, 0);
  flight.quaternion.identity();
  flight.velocity.set(0, 0, 0);
  const telemetry = createInitialTelemetry(ship);

  const combat = new CombatManager(ship.maxHull);
  combat.clearCombatState(ship.maxHull, true);
  combat.spawnWave(1, new THREE.Vector3(0, 0, 0));

  // Position first enemy directly ahead along the cannon aim ray with controlled shield & hull
  const target = combat.enemies[0];
  target.position.set(0, 0, -45);
  target.velocity.set(0, 0, 0);
  target.shield.max = 35;
  target.shield.current = 35;
  target.shield.isBroken = false;
  target.health.max = 100;
  target.health.current = 100;
  for (let i = 1; i < combat.enemies.length; i++) {
    combat.enemies[i].active = false;
  }

  const firedOrigins: THREE.Vector3[] = [];
  const bursts: Array<{
    kind: VfxBurstEvent['kind'];
    position: THREE.Vector3;
    normal?: THREE.Vector3;
    weaponId?: string;
  }> = [];

  combat.setCallbacks({
    onPlayerFire: (evt) => {
      firedOrigins.push(evt.origin.clone());
    },
    onVfxBurst: (evt) => {
      bursts.push({
        kind: evt.kind,
        position: evt.position.clone(),
        normal: evt.normal?.clone(),
        weaponId: evt.weaponId,
      });
    },
  });

  // Step simulation while firing until we record shield-hit, shield-break, and bare-hull impact
  const dt = 0.016;
  for (let step = 0; step < 50; step++) {
    target.position.set(0, 0, -45);
    target.velocity.set(0, 0, 0);
    flight.position.set(0, 0, 0);
    flight.quaternion.identity();
    flight.velocity.set(0, 0, 0);

    combat.update(dt, flight, makeIdleInput({ firePrimary: true }), telemetry);
  }

  // Verify alternating exact Vanguard muzzle origins
  assert.ok(firedOrigins.length >= 3, `expected >= 3 shots, got ${firedOrigins.length}`);
  assert.ok(
    firedOrigins[0].distanceTo(new THREE.Vector3(-1.48, -0.14, -1.65)) < 1e-4,
    'first shot originates at exact left Vanguard muzzle',
  );
  assert.ok(
    firedOrigins[1].distanceTo(new THREE.Vector3(1.48, -0.14, -1.65)) < 1e-4,
    'second shot originates at exact right Vanguard muzzle',
  );

  const shieldHits = bursts.filter((b) => b.kind === 'shield-hit');
  const shieldBreaks = bursts.filter((b) => b.kind === 'shield-break');
  const hullImpacts = bursts.filter((b) => b.kind === 'impact');

  assert.ok(shieldHits.length >= 1, 'emitted localized shield-hit burst on shielded target');
  assert.ok(shieldBreaks.length >= 1, 'emitted localized shield-break burst on shield depletion');
  assert.ok(hullImpacts.length >= 1, 'emitted localized hull impact burst after shields depleted');

  for (const b of [...shieldHits, ...shieldBreaks, ...hullImpacts]) {
    assert.equal(b.weaponId, 'player_pulse_twin');
    assert.ok(b.normal && Math.abs(b.normal.length() - 1) < 1e-3, 'burst carries unit surface normal');
    // Localized right at the collision boundary around target (0, 0, -45)
    const distFromEnemy = b.position.distanceTo(new THREE.Vector3(0, 0, -45));
    assert.ok(
      distFromEnemy <= target.collisionRadius + weapon.hitRadius + 0.25,
      `impact localized at collision position (dist=${distFromEnemy.toFixed(2)})`,
    );
  }
});
