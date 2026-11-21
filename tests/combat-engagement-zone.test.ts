import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { BOT_PERSONALITIES, resolveBotDifficultyTuning } from '../src/config/botPersonalities';
import { getMissionById } from '../src/config/missions';
import { DEFAULT_SETTINGS, SHIP_CONFIGS } from '../src/config/ships';
import { CombatManager, selectEnemyTarget } from '../src/engine/combat/CombatManager';
import { EnemyAIController } from '../src/engine/combat/EnemyAIController';
import { createHealthState, createShieldState, applyShieldedDamage } from '../src/engine/combat/HealthSystem';
import { ProjectilePool } from '../src/engine/combat/ProjectilePool';
import { FlightController } from '../src/engine/FlightController';
import { InputManager } from '../src/engine/InputManager';
import { createInitialTelemetry } from '../src/engine/FlightController';
import { MissionManager } from '../src/engine/mission/MissionManager';
import { MissionRuntime } from '../src/engine/mission/MissionRuntime';
import {
  CombatMissionWorldAdapter,
  DEFAULT_CEZ_ACTIVE_RADIUS,
  DEFAULT_CEZ_INNER_RADIUS,
  DEFAULT_CEZ_LEASH_RADIUS,
  DEFAULT_CEZ_SOFT_BOUNDARY_RADIUS,
} from '../src/engine/mission/MissionWorldAdapter';
import type { CombatEngagementZoneState, EnemyEntity } from '../src/types/combat';

function makeStaticZone(center = new THREE.Vector3(0, 0, -220)): CombatEngagementZoneState {
  return {
    id: 'test-static-zone',
    active: true,
    anchorMode: 'static',
    center: center.clone(),
    velocity: new THREE.Vector3(),
    targetCenter: center.clone(),
    targetVelocity: new THREE.Vector3(),
    initialAnchorOffset: center.clone(),
    innerRadius: DEFAULT_CEZ_INNER_RADIUS,
    activeRadius: DEFAULT_CEZ_ACTIVE_RADIUS,
    softBoundaryRadius: DEFAULT_CEZ_SOFT_BOUNDARY_RADIUS,
    leashRadius: DEFAULT_CEZ_LEASH_RADIUS,
    playerDistance: 0,
    playerInside: true,
  };
}

function makeEnemy(
  personality: EnemyEntity['personality'],
  position: THREE.Vector3,
  state: EnemyEntity['aiState'] = 'pursue',
): EnemyEntity {
  const cfg = BOT_PERSONALITIES[personality];
  return {
    id: `cez-${personality}`,
    callsign: personality.toUpperCase(),
    shipId: personality === 'defender' ? 'destroyer' : personality === 'flanker' ? 'interceptor' : 'striker',
    personality,
    difficulty: 2,
    difficultyLevel: 'normal',
    active: true,
    position: position.clone(),
    quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(0, 0, -cfg.cruiseSpeed),
    visualBankAngle: 0,
    collisionRadius: 3.6,
    health: createHealthState(cfg.maxHull),
    shield: createShieldState(cfg.maxShield, cfg.shieldRechargeDelay, cfg.shieldRechargeRate),
    aiState: state,
    aiStateTimer: 2.0,
    reactionTimer: cfg.reactionTime,
    coordinationTimer: 10,
    weaponCooldown: 10,
    burstTimer: 10,
    burstActive: false,
    muzzleIndex: 0,
    patrolAnchor: position.clone(),
    patrolAngle: 0,
    flankSign: 1,
    evadeDir: new THREE.Vector3(1, 0, 0),
    repositionPoint: position.clone(),
    hitFlashTimer: 0,
    muzzleFlashTimer: 0,
    targetTransport: false,
    targetRelay: false,
    returningToZone: false,
    targetKind: 'player',
    targetLockTimer: 0,
    recentPlayerThreatTimer: 0,
  };
}

test('static CEZ contains all four personalities when player kites beyond leashRadius without snapping', () => {
  const zoneCenter = new THREE.Vector3(0, 0, -220);
  const zone = makeStaticZone(zoneCenter);
  const ai = new EnemyAIController();
  const projectiles = new ProjectilePool(16);

  const personalities: EnemyEntity['personality'][] = ['aggressor', 'flanker', 'defender', 'ace'];
  const enemies = personalities.map((p, i) =>
    makeEnemy(p, new THREE.Vector3((i - 1.5) * 60, 0, -220), 'pursue'),
  );

  // Player kites far outside leashRadius (1500m away)
  const playerPos = new THREE.Vector3(0, 0, -2000);
  const playerVel = new THREE.Vector3(0, 0, -180);
  const playerFwd = new THREE.Vector3(0, 0, -1);

  const dt = 1 / 60;
  for (let frame = 0; frame < 18 * 60; frame++) {
    playerPos.addScaledVector(playerVel, dt);
    for (const enemy of enemies) {
      const prevPos = enemy.position.clone();
      const prevQuat = enemy.quaternion.clone();
      ai.updateEnemy(enemy, dt, frame * dt, playerPos, playerVel, true, projectiles, enemies, playerFwd, zone);

      const tuning = resolveBotDifficultyTuning(BOT_PERSONALITIES[enemy.personality], 'normal');
      const stepDist = enemy.position.distanceTo(prevPos);
      const stepAngle = enemy.quaternion.angleTo(prevQuat);
      assert.ok(stepDist <= tuning.boostSpeed * dt * 1.08 + 0.01, `${enemy.personality} teleported: ${stepDist}`);
      assert.ok(stepAngle <= tuning.turnRate * dt * 1.08 + 0.001, `${enemy.personality} snapped turn: ${stepAngle}`);
    }
  }

  for (const enemy of enemies) {
    const distFromZone = enemy.position.distanceTo(zone.center);
    assert.ok(
      distFromZone <= zone.softBoundaryRadius + 30,
      `${enemy.personality} drifted out of zone: ${distFromZone.toFixed(1)}m`,
    );
  }
});

test('returningToZone clears only at activeRadius * 0.85 and enemies resume personality behavior on player re-entry', () => {
  const zone = makeStaticZone(new THREE.Vector3(0, 0, 0));
  const ai = new EnemyAIController();
  const projectiles = new ProjectilePool(8);

  const enemy = makeEnemy('flanker', new THREE.Vector3(0, 0, -(zone.softBoundaryRadius + 80)), 'pursue');
  const playerOutside = new THREE.Vector3(0, 0, -1200);
  const zeroVel = new THREE.Vector3();
  const fwd = new THREE.Vector3(0, 0, -1);

  // Step 1: triggers returningToZone outside softBoundaryRadius
  ai.updateEnemy(enemy, 1 / 60, 0, playerOutside, zeroVel, true, projectiles, [enemy], fwd, zone);
  assert.equal(enemy.returningToZone, true);

  // Move just inside activeRadius (0.95 * activeRadius) -> hysteresis keeps returningToZone true
  enemy.position.set(0, 0, -(zone.activeRadius * 0.95));
  ai.updateEnemy(enemy, 1 / 60, 1 / 60, playerOutside, zeroVel, true, projectiles, [enemy], fwd, zone);
  assert.equal(enemy.returningToZone, true);

  // Move inside activeRadius * 0.85 -> clears returningToZone
  enemy.position.set(0, 0, -(zone.activeRadius * 0.8));
  ai.updateEnemy(enemy, 1 / 60, 2 / 60, playerOutside, zeroVel, true, projectiles, [enemy], fwd, zone);
  assert.equal(enemy.returningToZone, false);
  assert.equal(enemy.aiState, 'patrol');

  // Player re-enters inside activeRadius -> flanker acquires & pursues
  const playerInside = new THREE.Vector3(40, 0, -140);
  for (let i = 0; i < 60; i++) {
    ai.updateEnemy(enemy, 1 / 60, (3 + i) / 60, playerInside, zeroVel, true, projectiles, [enemy], fwd, zone);
  }
  assert.ok(
    ['acquire', 'pursue', 'engage'].includes(enemy.aiState),
    `expected active re-acquisition, got ${enemy.aiState}`,
  );
});

test('M-06 moving Escort zone tracks transport position and velocity, predicts reposition, and spawns Wave 2 at transport', () => {
  const m06 = getMissionById('mission-06');
  const combat = new CombatManager(100);
  const world = new CombatMissionWorldAdapter(combat);
  const runtime = new MissionRuntime();
  const origin = new THREE.Vector3(10, 12, 40);

  runtime.start(m06);
  world.start(m06, 100, origin);
  world.spawnWave(m06, 0, origin);
  runtime.processEvents([{ type: 'wave_started', waveNumber: 1 }]);

  const initialZone = world.getEngagementZone()!;
  assert.equal(initialZone.anchorMode, 'actor');
  assert.ok(initialZone.center.distanceTo(combat.transport!.position) < 0.01);

  // Advance transport for 12 seconds along its route
  const dt = 1 / 60;
  for (let i = 0; i < 12 * 60; i++) {
    world.update(dt, origin, false, runtime.getState()!);
  }

  const movedZone = world.getEngagementZone()!;
  assert.ok(movedZone.center.distanceTo(combat.transport!.position) < 0.5);
  assert.ok(movedZone.velocity.length() > 18, `expected ~22 m/s zone velocity, got ${movedZone.velocity.length()}`);

  // Verify Wave 2 spawns around transport's current position without double-applying route[0]
  world.spawnWave(m06, 1, origin);
  assert.equal(combat.enemies.length, m06.waves[1].enemies.length);
  for (const enemy of combat.enemies) {
    const distToTransport = enemy.position.distanceTo(combat.transport!.position);
    assert.ok(distToTransport < movedZone.activeRadius, `Wave 2 enemy spawned too far from transport: ${distToTransport.toFixed(1)}m`);
  }

  // Verify moving-zone reposition clamping keeps repositionPoint near predicted zone center
  const ai = new EnemyAIController();
  const enemy = combat.enemies[0];
  enemy.aiState = 'engage';
  enemy.aiStateTimer = 0;
  ai.updateEnemy(
    enemy,
    dt,
    12,
    combat.transport!.position,
    combat.transport!.velocity,
    true,
    new ProjectilePool(8),
    combat.enemies,
    new THREE.Vector3(0, 0, -1),
    movedZone,
  );
  assert.ok(enemy.repositionPoint.distanceTo(movedZone.center) <= movedZone.activeRadius + 25);
});

test('static wave layouts spawn at missionOrigin + spec.offset regardless of playerPos', () => {
  const m02 = getMissionById('mission-02');
  const combat = new CombatManager(100);
  const world = new CombatMissionWorldAdapter(combat);
  const runtime = new MissionRuntime();
  const missionOrigin = new THREE.Vector3(0, 12, 40);

  runtime.start(m02);
  world.start(m02, 100, missionOrigin);
  // Pass a far-away playerPosition to spawnWave -> must still spawn relative to missionOrigin!
  const driftedPlayer = new THREE.Vector3(3000, 200, -4000);
  world.spawnWave(m02, 1, driftedPlayer);

  const expected = new THREE.Vector3(...m02.waves[1].enemies[0].offset).add(missionOrigin);
  assert.ok(combat.enemies[0].position.distanceTo(expected) < 0.01);
});

test('stage transitions converge smoothly without position or velocity spikes', () => {
  const base = getMissionById('mission-04');
  const combat = new CombatManager(100);
  const world = new CombatMissionWorldAdapter(combat);
  const runtime = new MissionRuntime();
  const origin = new THREE.Vector3(0, 0, 0);

  const twoStageMission = {
    ...base,
    stages: [
      {
        ...base.stages[0],
        engagementZone: { id: 's1', anchorMode: 'static' as const, offset: [0, 0, -200] as [number, number, number] },
      },
      {
        ...base.stages[1],
        engagementZone: { id: 's2', anchorMode: 'static' as const, offset: [300, 0, -600] as [number, number, number] },
      },
    ],
  };

  runtime.start(twoStageMission);
  world.start(twoStageMission, 100, origin);
  runtime.processEvents([{ type: 'wave_started', waveNumber: 1 }]);

  // Advance to stage 2
  runtime.processEvents([{ type: 'wave_cleared', waveNumber: 1 }, { type: 'wave_started', waveNumber: 2 }]);

  const dt = 1 / 60;
  let maxStep = 0;
  let prev = world.getEngagementZone()!.center.clone();
  for (let i = 0; i < 4 * 60; i++) {
    world.update(dt, origin, false, runtime.getState()!);
    const zone = world.getEngagementZone()!;
    const step = zone.center.distanceTo(prev);
    maxStep = Math.max(maxStep, step);
    assert.ok(Number.isFinite(zone.velocity.length()) && zone.velocity.length() <= 250.1);
    prev.copy(zone.center);
  }
  // Smooth convergence: no single-frame teleport (> 30m in 1/60s) and converges near target [300, 0, -600]
  assert.ok(maxStep < 30, `transition spiked ${maxStep.toFixed(1)}m in one frame`);
  assert.ok(world.getEngagementZone()!.center.distanceTo(new THREE.Vector3(300, 0, -600)) < 1.0);
});

test('target selection uses weighted scoring with hysteresis and refocuses objective when player leaves leash', () => {
  const zone = makeStaticZone(new THREE.Vector3(0, 0, -340));
  const relayPos = new THREE.Vector3(0, 0, -340);
  const enemyPos = new THREE.Vector3(0, 0, -260);
  const playerNear = new THREE.Vector3(20, 0, -280);
  const playerFar = new THREE.Vector3(0, 0, 1000);

  // Hysteresis holds current target while lock timer > 0
  const held = selectEnemyTarget({
    personality: 'flanker',
    enemyPosition: enemyPos,
    playerPosition: playerNear,
    playerAlive: true,
    relayPosition: relayPos,
    relayActive: true,
    transportActive: false,
    zone,
    currentTarget: 'relay',
    targetLockTimer: 1.5,
    recentPlayerThreatTimer: 4.0,
  });
  assert.equal(held, 'relay');

  // When lock expires and player is threatening nearby, flanker switches to player
  const switched = selectEnemyTarget({
    personality: 'flanker',
    enemyPosition: enemyPos,
    playerPosition: playerNear,
    playerAlive: true,
    relayPosition: relayPos,
    relayActive: true,
    transportActive: false,
    zone,
    currentTarget: 'relay',
    targetLockTimer: 0,
    recentPlayerThreatTimer: 4.0,
  });
  assert.equal(switched, 'player');

  // When player exits leashRadius, even with lock timer > 0, enemy refocuses on relay
  const refocused = selectEnemyTarget({
    personality: 'flanker',
    enemyPosition: enemyPos,
    playerPosition: playerFar,
    playerAlive: true,
    relayPosition: relayPos,
    relayActive: true,
    transportActive: false,
    zone,
    currentTarget: 'player',
    targetLockTimer: 2.0,
    recentPlayerThreatTimer: 0,
  });
  assert.equal(refocused, 'relay');
});

test('enemy shield recharge rules remain unchanged when player leaves CEZ', () => {
  const m01 = getMissionById('mission-01');
  const combat = new CombatManager(100);
  const manager = new MissionManager();
  const flight = new FlightController(SHIP_CONFIGS.interceptor);
  const input = new InputManager();
  const telemetry = createInitialTelemetry(SHIP_CONFIGS.interceptor);

  flight.reset(new THREE.Vector3(0, 12, 40));
  manager.startMission(m01, combat, 100, flight.position);
  const enemy = combat.enemies[0];
  applyShieldedDamage(enemy.shield, enemy.health, 20, 'player-1', 0);
  const damagedShield = enemy.shield.current;

  // Move player far outside CEZ and step for 1 second (< shieldRechargeDelay of 4.2s)
  flight.position.set(0, 12, 2000);
  for (let i = 0; i < 60; i++) {
    combat.update(1 / 60, flight, input.consumeSnapshot(1 / 60, DEFAULT_SETTINGS), telemetry);
  }

  assert.equal(enemy.shield.current, damagedShield, 'shield should not recharge before rechargeDelay');
  assert.equal(enemy.shield.isRecharging, false);
});

test('free-flight mode has no active engagement zone', () => {
  const combat = new CombatManager(100);
  combat.resetSession(100, new THREE.Vector3(0, 12, 40));
  assert.equal(combat.getEngagementZone(), null);
  assert.ok(combat.enemies.length > 0);
});
