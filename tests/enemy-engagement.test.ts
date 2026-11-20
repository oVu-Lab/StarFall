import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { BOT_PERSONALITIES, resolveBotDifficultyTuning } from '../src/config/botPersonalities.ts';
import { createHealthState, createShieldState } from '../src/engine/combat/HealthSystem.ts';
import {
  ATTACK_RUN_DURATION_SEC,
  EnemyAIController,
  getAttackRunEndReason,
  MAX_SIMULTANEOUS_ATTACK_RUNS,
} from '../src/engine/combat/EnemyAIController.ts';
import { ProjectilePool } from '../src/engine/combat/ProjectilePool.ts';
import { FlightController } from '../src/engine/FlightController.ts';
import { SHIP_CONFIGS } from '../src/config/ships.ts';
import type { BotAIState, EnemyEntity } from '../src/types/combat.ts';

const TARGET = new THREE.Vector3();
const TARGET_VELOCITY = new THREE.Vector3();
const TARGET_FORWARD = new THREE.Vector3(0, 0, -1);

function makeEnemy(personality: EnemyEntity['personality'], position: THREE.Vector3, state: BotAIState): EnemyEntity {
  const config = BOT_PERSONALITIES[personality];
  return {
    id: `test-${personality}`,
    callsign: personality,
    shipId: 'interceptor',
    personality,
    difficulty: 2,
    active: true,
    position: position.clone(),
    quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(),
    visualBankAngle: 0,
    collisionRadius: 3.6,
    health: createHealthState(config.maxHull),
    shield: createShieldState(config.maxShield, config.shieldRechargeDelay, config.shieldRechargeRate),
    aiState: state,
    aiStateTimer: state === 'engage' ? 3.2 : 0,
    reactionTimer: 0,
    coordinationTimer: 1000,
    weaponCooldown: 1000,
    burstTimer: 1000,
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
  };
}

function faceToward(enemy: EnemyEntity, point: THREE.Vector3): void {
  const matrix = new THREE.Matrix4().lookAt(enemy.position, point, new THREE.Vector3(0, 1, 0));
  enemy.quaternion.setFromRotationMatrix(matrix);
}

function simulate(enemy: EnemyEntity, duration: number): void {
  const ai = new EnemyAIController();
  const projectiles = new ProjectilePool(8);
  const all = [enemy];
  const steps = Math.ceil(duration * 60);
  for (let i = 0; i < steps; i++) {
    ai.updateEnemy(enemy, 1 / 60, i / 60, TARGET, TARGET_VELOCITY, true, projectiles, all, TARGET_FORWARD);
  }
}

test('enemies break off when behind and return to a forward approach lane', () => {
  const enemy = makeEnemy('aggressor', new THREE.Vector3(0, 0, -150), 'engage');
  const ai = new EnemyAIController();
  const projectiles = new ProjectilePool(8);
  let longestRearEngagement = 0;
  let currentRearEngagement = 0;
  for (let i = 0; i < 30 * 60; i++) {
    ai.updateEnemy(enemy, 1 / 60, i / 60, TARGET, TARGET_VELOCITY, true, projectiles, [enemy], TARGET_FORWARD);
    const isBehind = enemy.position.z > 12;
    if (isBehind && enemy.aiState === 'engage') {
      currentRearEngagement += 1 / 60;
      longestRearEngagement = Math.max(longestRearEngagement, currentRearEngagement);
    } else {
      currentRearEngagement = 0;
    }
  }
  assert.ok(longestRearEngagement < 0.25, `rear engagement lasted ${longestRearEngagement.toFixed(2)}s`);
  assert.notEqual(enemy.aiState, 'destroyed');
});

test("a repositioning enemy follows the player's newly rotated -Z hull-forward lane", () => {
  const flight = new FlightController(SHIP_CONFIGS.interceptor);
  const oldForward = flight.getShipForwardWorld(new THREE.Vector3());
  const enemy = makeEnemy('aggressor', new THREE.Vector3(300, 0, 0), 'reposition');
  const oldRight = new THREE.Vector3().crossVectors(oldForward, new THREE.Vector3(0, 1, 0)).normalize();
  enemy.repositionPoint.copy(TARGET)
    .addScaledVector(oldForward, BOT_PERSONALITIES.aggressor.preferredRange * 0.72)
    .addScaledVector(oldRight, BOT_PERSONALITIES.aggressor.preferredRange * 0.4)
    .add(new THREE.Vector3(0, 26, 0));

  flight.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const forward = flight.getShipForwardWorld(new THREE.Vector3());
  assert.ok(flight.getAimDirectionWorld(new THREE.Vector3()).dot(forward) > 0.999);
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const expectedApproach = TARGET.clone()
    .addScaledVector(forward, BOT_PERSONALITIES.aggressor.preferredRange * 0.72)
    .addScaledVector(right, BOT_PERSONALITIES.aggressor.preferredRange * 0.4)
    .add(new THREE.Vector3(0, 26, 0));
  faceToward(enemy, expectedApproach);

  const ai = new EnemyAIController();
  ai.updateEnemy(enemy, 1 / 60, 0, TARGET, TARGET_VELOCITY, true, new ProjectilePool(8), [enemy], forward);

  const targetOffset = enemy.repositionPoint.clone().sub(TARGET);
  assert.ok(targetOffset.dot(forward) > 0, 'reposition waypoint should remain ahead of the turned player');
  const moveDirection = enemy.velocity.clone().normalize();
  const towardWaypoint = enemy.repositionPoint.clone().sub(enemy.position).normalize();
  assert.ok(moveDirection.dot(towardWaypoint) > 0.99, 'enemy propulsion should point toward the refreshed world-space waypoint');
});

test('an enemy closes the forward gap when the moving player is within its pursuit envelope', () => {
  const flight = new FlightController(SHIP_CONFIGS.interceptor);
  const forward = flight.getShipForwardWorld(new THREE.Vector3());
  const targetPos = new THREE.Vector3();
  const targetVel = forward.clone().multiplyScalar(50);
  const enemy = makeEnemy('aggressor', forward.clone().multiplyScalar(-280), 'pursue');
  faceToward(enemy, TARGET);
  const initialForwardBearing = enemy.position.clone().sub(targetPos).dot(forward);
  const ai = new EnemyAIController();
  const projectiles = new ProjectilePool(8);
  for (let i = 0; i < 4 * 60; i++) {
    targetPos.addScaledVector(targetVel, 1 / 60);
    ai.updateEnemy(enemy, 1 / 60, i / 60, targetPos, targetVel, true, projectiles, [enemy], forward);
  }
  const finalForwardBearing = enemy.position.clone().sub(targetPos).dot(forward);
  assert.ok(finalForwardBearing > initialForwardBearing, `forward bearing did not improve: ${initialForwardBearing.toFixed(1)} -> ${finalForwardBearing.toFixed(1)}`);
});

test('flanker uses a lateral approach but commits to bounded attack runs', () => {
  const enemy = makeEnemy('flanker', new THREE.Vector3(0, 0, 120), 'pursue');
  faceToward(enemy, new THREE.Vector3(83, 0, -97));
  simulate(enemy, 1.0);
  assert.ok(Math.abs(enemy.position.x) > 10, `lateral approach displacement was ${enemy.position.x.toFixed(1)}m`);

  const run = makeEnemy('flanker', new THREE.Vector3(0, 0, -150), 'engage');
  faceToward(run, TARGET);
  const ai = new EnemyAIController();
  const projectiles = new ProjectilePool(8);
  let longestEngagement = 0;
  let engagement = 0;
  for (let i = 0; i < 18 * 60; i++) {
    ai.updateEnemy(run, 1 / 60, i / 60, TARGET, TARGET_VELOCITY, true, projectiles, [run], TARGET_FORWARD);
    if (run.aiState === 'engage') {
      engagement += 1 / 60;
      longestEngagement = Math.max(longestEngagement, engagement);
    } else engagement = 0;
  }
  assert.ok(longestEngagement <= ATTACK_RUN_DURATION_SEC.flanker + 0.05,
    `flanker orbited for ${longestEngagement.toFixed(2)}s without breaking away`);
});

test('aggressor attack run stays direct with little lateral displacement', () => {
  const enemy = makeEnemy('aggressor', new THREE.Vector3(0, 0, -180), 'engage');
  faceToward(enemy, TARGET);
  simulate(enemy, 2.0);
  assert.ok(enemy.position.z > -180, 'aggressor should advance toward the target on its run');
  assert.ok(Math.abs(enemy.position.x) < 4, `direct run drifted laterally by ${enemy.position.x.toFixed(1)}m`);
});

test('defender holds near its preferred standoff distance during an engagement window', () => {
  const enemy = makeEnemy('defender', new THREE.Vector3(0, 0, -215), 'engage');
  faceToward(enemy, TARGET);
  let minDistance = Infinity;
  let maxDistance = 0;
  const ai = new EnemyAIController();
  const projectiles = new ProjectilePool(8);
  for (let i = 0; i < 2 * 60; i++) {
    ai.updateEnemy(enemy, 1 / 60, i / 60, TARGET, TARGET_VELOCITY, true, projectiles, [enemy], TARGET_FORWARD);
    const distance = enemy.position.distanceTo(TARGET);
    minDistance = Math.min(minDistance, distance);
    maxDistance = Math.max(maxDistance, distance);
  }
  assert.ok(minDistance > 150, `defender closed too near: ${minDistance.toFixed(1)}m`);
  assert.ok(maxDistance < 260, `defender lost standoff range: ${maxDistance.toFixed(1)}m`);
});

test('enemies complete a breakaway and re-enter approach or attack', () => {
  const enemy = makeEnemy('aggressor', new THREE.Vector3(0, 0, -150), 'engage');
  const ai = new EnemyAIController();
  const projectiles = new ProjectilePool(8);
  let sawReposition = false;
  let reengagedAfterBreakaway = false;
  let leftReposition = false;
  for (let i = 0; i < 35 * 60; i++) {
    ai.updateEnemy(enemy, 1 / 60, i / 60, TARGET, TARGET_VELOCITY, true, projectiles, [enemy], TARGET_FORWARD);
    if (enemy.aiState === 'reposition') sawReposition = true;
    if (sawReposition && enemy.aiState !== 'reposition') leftReposition = true;
    if (leftReposition && (enemy.aiState === 'pursue' || enemy.aiState === 'engage')) {
      reengagedAfterBreakaway = true;
      break;
    }
  }
  assert.ok(sawReposition, 'enemy never broke away');
  assert.ok(reengagedAfterBreakaway, 'enemy did not return to a new attack approach');
});

test('attack runs last for their personality window unless a real break condition occurs', () => {
  assert.deepEqual(ATTACK_RUN_DURATION_SEC, {
    aggressor: 5.0,
    flanker: 4.5,
    defender: 5.8,
    ace: 4.2,
  });
  assert.equal(getAttackRunEndReason(50, 58, 100, 270, 2), 'danger-close');
  assert.equal(getAttackRunEndReason(100, 58, -71, 270, 2), 'passed-target');
  assert.equal(getAttackRunEndReason(400, 58, 100, 270, 2), 'lost-range');
  assert.equal(getAttackRunEndReason(200, 58, 100, 270, 0), 'timeout');
  assert.equal(getAttackRunEndReason(200, 58, 100, 270, 1), null);

  const enemy = makeEnemy('defender', new THREE.Vector3(0, 0, -215), 'engage');
  enemy.aiStateTimer = ATTACK_RUN_DURATION_SEC.defender;
  faceToward(enemy, TARGET);
  const ai = new EnemyAIController();
  const projectiles = new ProjectilePool(8);
  let elapsed = 0;
  for (let i = 0; i < 8 * 60; i++) {
    ai.updateEnemy(enemy, 1 / 60, i / 60, TARGET, TARGET_VELOCITY, true, projectiles, [enemy], TARGET_FORWARD);
    if (enemy.aiState !== 'engage') break;
    elapsed += 1 / 60;
  }
  assert.ok(elapsed >= 5.7 && elapsed <= 5.85, `defender run lasted ${elapsed.toFixed(2)}s`);
  assert.equal(enemy.aiState, 'reposition');

  for (const personality of ['aggressor', 'flanker', 'ace'] as const) {
    const runner = makeEnemy(personality, new THREE.Vector3(0, 0, -240), 'engage');
    runner.aiStateTimer = ATTACK_RUN_DURATION_SEC[personality];
    faceToward(runner, TARGET);
    const runnerAi = new EnemyAIController();
    const runnerProjectiles = new ProjectilePool(8);
    let runElapsed = 0;
    for (let i = 0; i < 8 * 60; i++) {
      runnerAi.updateEnemy(runner, 1 / 60, i / 60, TARGET, TARGET_VELOCITY, true, runnerProjectiles, [runner], TARGET_FORWARD);
      if (runner.aiState !== 'engage') break;
      runElapsed += 1 / 60;
    }
    assert.ok(runElapsed >= ATTACK_RUN_DURATION_SEC[personality] - 0.05,
      `${personality} broke early at ${runElapsed.toFixed(2)}s of ${ATTACK_RUN_DURATION_SEC[personality]}s`);
  }
});

test('five enemies stagger runs with no more than two active and both aggressors get pressure windows', () => {
  const personalities: EnemyEntity['personality'][] = ['aggressor', 'flanker', 'aggressor', 'defender', 'ace'];
  const enemies = personalities.map((personality, i) => {
    const x = (i - 2) * 42;
    const enemy = makeEnemy(personality, new THREE.Vector3(x, 0, -215), 'pursue');
    enemy.coordinationTimer = 1000;
    faceToward(enemy, TARGET);
    return enemy;
  });
  const ai = new EnemyAIController();
  const projectiles = new ProjectilePool(32);
  const entryCount = new Map<EnemyEntity, number>(enemies.map((enemy) => [enemy, 0]));
  let maxConcurrent = 0;
  for (let frame = 0; frame < 50 * 60; frame++) {
    for (const enemy of enemies) {
      const previous = enemy.aiState;
      ai.updateEnemy(enemy, 1 / 60, frame / 60, TARGET, TARGET_VELOCITY, true, projectiles, enemies, TARGET_FORWARD);
      if (previous !== 'engage' && enemy.aiState === 'engage') {
        entryCount.set(enemy, (entryCount.get(enemy) ?? 0) + 1);
      }
    }
    maxConcurrent = Math.max(maxConcurrent, enemies.filter((enemy) => enemy.aiState === 'engage').length);
  }

  assert.ok(maxConcurrent <= MAX_SIMULTANEOUS_ATTACK_RUNS, `saw ${maxConcurrent} simultaneous attack runs`);
  assert.ok((entryCount.get(enemies[0]) ?? 0) > 0, 'first aggressor never got an attack run');
  assert.ok((entryCount.get(enemies[2]) ?? 0) > 0, 'queued aggressor never got an attack run');
  assert.ok([...entryCount.values()].every((count) => count > 0), 'a staged personality never re-entered');
});

test('Ace keeps higher agility and precision while receiving a bounded attack window', () => {
  const ace = BOT_PERSONALITIES.ace;
  const aggressor = BOT_PERSONALITIES.aggressor;
  const aceTuning = resolveBotDifficultyTuning(ace, 'normal');
  const aggressorTuning = resolveBotDifficultyTuning(aggressor, 'normal');
  assert.ok(aceTuning.turnRate > aggressorTuning.turnRate);
  assert.ok(aceTuning.aimSpreadRad < aggressorTuning.aimSpreadRad);
  assert.ok(ATTACK_RUN_DURATION_SEC.ace < ATTACK_RUN_DURATION_SEC.aggressor);
});
