import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CAMPAIGN_MISSIONS, getNextMission } from '../src/config/missions';
import { CombatManager, shouldEnemyTargetTransport } from '../src/engine/combat/CombatManager';
import { applyDamage } from '../src/engine/combat/HealthSystem';
import { MissionManager } from '../src/engine/mission/MissionManager';
import { calculateMissionScore } from '../src/engine/mission/RankCalculator';

const escortMission = CAMPAIGN_MISSIONS.find((mission) => mission.id === 'mission-06')!;

test('transport health accepts damage once and cannot go below zero', () => {
  const combat = new CombatManager(100);
  combat.initializeTransport('CIVILIAN-07', 100, [[0, 0, 0], [0, 0, -10]], new THREE.Vector3());
  const health = combat.transport!.health;
  assert.equal(applyDamage(health, 35, 'enemy-1', 1).remaining, 65);
  const fatal = applyDamage(health, 90, 'enemy-1', 2);
  assert.equal(fatal.destroyedNow, true);
  assert.equal(fatal.remaining, 0);
  assert.equal(applyDamage(health, 10, 'enemy-1', 3).applied, false);
});

test('escort AI splits target pressure between the transport and player', () => {
  assert.equal(shouldEnemyTargetTransport('aggressor', true), true);
  assert.equal(shouldEnemyTargetTransport('defender', true), true);
  assert.equal(shouldEnemyTargetTransport('flanker', true), false);
  assert.equal(shouldEnemyTargetTransport('ace', true), false);
  assert.equal(shouldEnemyTargetTransport('aggressor', false), false);
});

test('transport extraction wins the mission exactly once', () => {
  const mission: typeof escortMission = {
    ...escortMission,
    waves: [],
    escort: { ...escortMission.escort!, route: [[0, 0, 0], [0, 0, -1]] },
  };
  const combat = new CombatManager(100);
  const manager = new MissionManager();
  let endCount = 0;
  let status: string | undefined;
  manager.setCallbacks({ onMissionEnd: (result) => { endCount += 1; status = result.status; } });
  manager.startMission(mission, combat, 100, new THREE.Vector3());
  manager.update(0.05, combat, new THREE.Vector3());
  manager.update(0.05, combat, new THREE.Vector3());
  assert.equal(status, 'completed');
  assert.equal(endCount, 1);
  manager.update(0.05, combat, new THREE.Vector3());
  assert.equal(endCount, 1);
});

test('transport destruction fails the escort and reports remaining hull', () => {
  const mission: typeof escortMission = { ...escortMission, waves: [] };
  const combat = new CombatManager(100);
  const manager = new MissionManager();
  let result: any;
  manager.setCallbacks({ onMissionEnd: (next) => { result = next; } });
  manager.startMission(mission, combat, 100, new THREE.Vector3());
  applyDamage(combat.transport!.health, escortMission.escort!.maxHull, 'enemy-1', 1);
  manager.update(0.016, combat, new THREE.Vector3());
  manager.update(0.016, combat, new THREE.Vector3());
  assert.equal(result.status, 'failed');
  assert.equal(result.transportRemainingHullPct, 0);
});

test('transport survival affects score while non-escort scoring stays identical', () => {
  const base = {
    enemiesDefeated: 0, totalEnemies: 0, shotsFired: 10, shotsHit: 5,
    remainingHull: 80, maxHull: 100, damageReceived: 20,
    timeTakenSec: 30, parTimeSec: 60, completed: true,
  };
  const existing = calculateMissionScore(base);
  assert.deepEqual(calculateMissionScore({ ...base, transportRemainingRatio: undefined }), existing);
  const safeTransport = calculateMissionScore({ ...base, transportRemainingRatio: 1 });
  const damagedTransport = calculateMissionScore({ ...base, transportRemainingRatio: 0.25 });
  assert.ok(safeTransport.survivalScore > damagedTransport.survivalScore);
});

test('original five missions retain their objectives and escort unlock follows mission five', () => {
  const originalMissions = CAMPAIGN_MISSIONS.filter((mission) => mission.number <= 5);
  assert.equal(originalMissions.length, 5);
  assert.ok(originalMissions.every((mission) => mission.escort === undefined));
  assert.ok(originalMissions.every((mission) => mission.objectives.every((objective) => objective.type !== 'escort_transport')));
  assert.equal(getNextMission('mission-05')?.id, 'mission-06');
});
