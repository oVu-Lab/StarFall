import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CAMPAIGN_MISSIONS, getMissionById } from '../src/config/missions';
import { CombatManager, shouldEnemyTargetRelay } from '../src/engine/combat/CombatManager';
import { MissionManager } from '../src/engine/mission/MissionManager';
import { MissionRuntime } from '../src/engine/mission/MissionRuntime';
import { CombatMissionWorldAdapter } from '../src/engine/mission/MissionWorldAdapter';
import type { MissionDefinition, MissionEvent, ObjectiveDefinition } from '../src/types/mission';

function missionWith(objectives: ObjectiveDefinition[], outcome: MissionDefinition['outcome'], waves = 1): MissionDefinition {
  const base = getMissionById('mission-01');
  return {
    ...base,
    waves: Array.from({ length: waves }, (_, index) => ({
      waveNumber: index + 1,
      label: `Test Wave ${index + 1}`,
      triggerDelaySec: 0,
      enemies: [],
    })),
    objectives,
    stages: Array.from({ length: waves }, (_, index) => ({
      id: `stage-${index + 1}`,
      label: `Stage ${index + 1}`,
      waveNumbers: [index + 1],
      objectiveIds: objectives.map((objective) => objective.id),
    })),
    outcome,
    relay: undefined,
    escort: undefined,
    extractionPoint: undefined,
  };
}

function event(type: 'enemy_destroyed' | 'actor_destroyed', actorId: string, callsign: string): MissionEvent {
  return type === 'enemy_destroyed'
    ? { type, actorId, callsign, priority: false }
    : { type, actorId, callsign };
}

test('registry handlers complete eliminate, intercept, boss, survive, defend, escort, recon, and extract goals', () => {
  const cases: Array<{ objective: ObjectiveDefinition; events: MissionEvent[] }> = [
    {
      objective: { id: 'eliminate', type: 'eliminate', label: 'Clear', targetCount: 1 },
      events: [event('enemy_destroyed', 'enemy-a', 'A'), { type: 'wave_cleared', waveNumber: 1 }],
    },
    {
      objective: { id: 'intercept', type: 'intercept', label: 'Intercept', targetCallsign: 'A' },
      events: [event('enemy_destroyed', 'enemy-a', 'A')],
    },
    {
      objective: { id: 'boss', type: 'boss', label: 'Boss', targetCallsign: 'A' },
      events: [event('actor_destroyed', 'boss-a', 'A')],
    },
    {
      objective: { id: 'survive', type: 'survive', label: 'Hold', durationSec: 1, targetWaves: 1 },
      events: [{ type: 'timer_elapsed', deltaSec: 1, elapsedSec: 1 }, { type: 'wave_cleared', waveNumber: 1 }],
    },
    {
      objective: { id: 'defend', type: 'defend', label: 'Defend', actorId: 'relay', durationSec: 1, targetWaves: 1 },
      events: [
        { type: 'actor_damaged', actorId: 'relay', amount: 5, currentIntegrity: 95, maxIntegrity: 100 },
        { type: 'timer_elapsed', deltaSec: 1, elapsedSec: 1 },
        { type: 'wave_cleared', waveNumber: 1 },
      ],
    },
    {
      objective: { id: 'escort', type: 'escort', label: 'Escort', actorId: 'shuttle' },
      events: [{ type: 'actor_progress', actorId: 'shuttle', progress: 1, currentIntegrity: 80, maxIntegrity: 100 }],
    },
    {
      objective: { id: 'recon', type: 'recon', label: 'Scan', targetCallsign: 'A', durationSec: 1 },
      events: [{ type: 'scan_progress', actorId: 'enemy-a', callsign: 'A', deltaSec: 1 }],
    },
    {
      objective: { id: 'extract', type: 'extract', label: 'Extract', actorId: 'beacon' },
      events: [{ type: 'extraction_point_reached', actorId: 'beacon' }],
    },
  ];

  for (const { objective, events } of cases) {
    const runtime = new MissionRuntime();
    const mission = missionWith([objective], { success: { mode: 'all', objectiveIds: [objective.id] }, failure: [] });
    runtime.start(mission);
    runtime.processEvents([{ type: 'wave_started', waveNumber: 1 }, ...events]);
    assert.equal(runtime.getState()?.objectives[objective.id].status, 'completed', objective.type);
    assert.equal(runtime.getState()?.status, 'completed', objective.type);
  }
});

test('dependencies activate in event order, optional objectives are skipped, and stages advance on wave start', () => {
  const objectives: ObjectiveDefinition[] = [
    { id: 'first', type: 'intercept', label: 'First', targetCallsign: 'FIRST' },
    { id: 'second', type: 'intercept', label: 'Second', targetCallsign: 'SECOND', dependsOn: ['first'] },
    { id: 'optional', type: 'boss', label: 'Optional', targetCallsign: 'OPTIONAL', optional: true, stageId: 'stage-2' },
  ];
  const mission = missionWith(objectives, { success: { mode: 'all', objectiveIds: ['first', 'second'] }, failure: [] }, 2);
  const runtime = new MissionRuntime();
  runtime.start(mission);
  runtime.processEvents([
    { type: 'wave_started', waveNumber: 1 },
    event('enemy_destroyed', 'first-id', 'FIRST'),
  ]);
  assert.equal(runtime.getState()?.objectives.second.status, 'active');
  runtime.processEvents([{ type: 'wave_cleared', waveNumber: 1 }, { type: 'wave_started', waveNumber: 2 }]);
  assert.equal(runtime.getState()?.currentStageId, 'stage-2');
  runtime.processEvents([event('enemy_destroyed', 'second-id', 'SECOND')]);
  assert.equal(runtime.getState()?.status, 'completed');
  assert.equal(runtime.getState()?.objectives.optional.status, 'skipped');
});

test('failure wins over success when both become true in one event batch', () => {
  const objective: ObjectiveDefinition = { id: 'goal', type: 'intercept', label: 'Target', targetCallsign: 'TARGET' };
  const runtime = new MissionRuntime();
  runtime.start(missionWith([objective], { success: { mode: 'all', objectiveIds: ['goal'] }, failure: ['player_destroyed'] }));
  runtime.processEvents([
    event('enemy_destroyed', 'target-id', 'TARGET'),
    { type: 'player_destroyed', actorId: 'player-1' },
  ]);
  assert.equal(runtime.getState()?.status, 'failed');
});

test('Mission 03 recon requires a continuous target scan and fails if the target is lost first', () => {
  const mission = CAMPAIGN_MISSIONS.find((candidate) => candidate.id === 'mission-03')!;
  const recon = mission.objectives.find((objective) => objective.type === 'recon')!;
  const runtime = new MissionRuntime();
  runtime.start(mission);
  runtime.processEvents([{ type: 'wave_started', waveNumber: 1 }]);
  runtime.processEvents([
    { type: 'scan_progress', actorId: 'warden', callsign: 'WARDEN-5', deltaSec: 2 },
    { type: 'scan_interrupted', actorId: 'warden', callsign: 'WARDEN-5' },
  ]);
  assert.equal(runtime.getState()?.objectives[recon.id].progress, 0);
  runtime.processEvents([
    { type: 'scan_progress', actorId: 'warden', callsign: 'WARDEN-5', deltaSec: 5 },
  ]);
  assert.equal(runtime.getState()?.objectives[recon.id].status, 'completed');

  const failed = new MissionRuntime();
  failed.start(mission);
  failed.processEvents([{ type: 'wave_started', waveNumber: 1 }, event('enemy_destroyed', 'warden', 'WARDEN-5')]);
  assert.equal(failed.getState()?.status, 'failed');
});

test('relay has independent integrity, can be targeted, damaged, and destroyed', () => {
  const combat = new CombatManager(100);
  const damageEvents: Array<{ remainingHealth: number; destroyed: boolean }> = [];
  combat.setCallbacks({ onDamage: (damage) => damageEvents.push({ remainingHealth: damage.remainingHealth, destroyed: damage.destroyed }) });
  combat.initializeRelay('cobalt-relay', 'COBALT RELAY', 100, [0, 0, -100], 20, new THREE.Vector3());
  const mission = getMissionById('mission-02');
  combat.spawnMissionWave(mission.waves[0], mission.difficulty, mission.difficultyNumeric, new THREE.Vector3());
  assert.equal(combat.enemies.some((enemy) => enemy.targetRelay), true);
  assert.equal(shouldEnemyTargetRelay('aggressor', true), true);
  assert.equal(shouldEnemyTargetRelay('flanker', true), false);
  combat.applyRelayDamage(35, 'enemy-test', 'enemy-pulse', new THREE.Vector3());
  assert.equal(combat.relay?.health.current, 65);
  combat.applyRelayDamage(65, 'enemy-test', 'enemy-pulse', new THREE.Vector3());
  assert.equal(combat.relay?.health.isDestroyed, true);
  assert.equal(combat.playerHealth.current, 100);
  assert.equal(damageEvents.at(-1)?.destroyed, true);
});

test('extraction point requires interaction inside its configured radius', () => {
  const objective: ObjectiveDefinition = { id: 'extract', type: 'extract', label: 'Confirm extraction', actorId: 'test-beacon' };
  const mission = {
    ...missionWith([objective], { success: { mode: 'all', objectiveIds: ['extract'] }, failure: [] }, 0),
    extractionPoint: { id: 'test-beacon', label: 'Test Beacon', offset: [0, 0, 0] as [number, number, number], radius: 10 },
  };
  const combat = new CombatManager(100);
  const world = new CombatMissionWorldAdapter(combat);
  world.start(mission, 100, new THREE.Vector3());
  const runtime = new MissionRuntime();
  runtime.start(mission);
  const events = world.update(0.016, new THREE.Vector3(20, 0, 0), true, runtime.getState()!);
  assert.equal(events.some((candidate) => candidate.type === 'extraction_point_reached'), false);
  const reached = world.update(0.016, new THREE.Vector3(5, 0, 0), true, runtime.getState()!);
  assert.equal(reached.some((candidate) => candidate.type === 'extraction_point_reached'), true);
  runtime.processEvents(reached);
  assert.equal(runtime.getState()?.status, 'completed');
});

test('mission manager finalizes a mission once even when updates continue', () => {
  const objective: ObjectiveDefinition = { id: 'wait', type: 'survive', label: 'Survive', durationSec: 0.02 };
  const mission = missionWith([objective], { success: { mode: 'all', objectiveIds: ['wait'] }, failure: [] }, 0);
  const combat = new CombatManager(100);
  const manager = new MissionManager();
  let ends = 0;
  manager.setCallbacks({ onMissionEnd: () => { ends += 1; } });
  manager.startMission(mission, combat, 100, new THREE.Vector3());
  manager.update(0.03, combat, new THREE.Vector3());
  manager.update(0.03, combat, new THREE.Vector3());
  assert.equal(manager.getStatus(), 'completed');
  assert.equal(ends, 1);
});
