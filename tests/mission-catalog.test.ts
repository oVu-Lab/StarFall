import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGN_MISSIONS,
  getMissionById,
  getNextMission,
  isMissionUnlockedInCatalog,
  validateMissionCatalog,
} from '../src/config/missions';
import { MissionManager } from '../src/engine/mission/MissionManager';
import { CombatManager } from '../src/engine/combat/CombatManager';
import * as THREE from 'three';

test('all six campaign definitions pass catalog validation', () => {
  assert.deepEqual(validateMissionCatalog(), []);
  assert.deepEqual(CAMPAIGN_MISSIONS.map((mission) => mission.id), [
    'mission-01', 'mission-02', 'mission-03', 'mission-04', 'mission-05', 'mission-06',
  ]);
});

test('catalog validation rejects dangling objective references and dependency cycles', () => {
  const first = getMissionById('mission-01');
  const dangling = {
    ...first,
    objectives: first.objectives.map((objective) =>
      objective.id === 'm1-intercept' ? { ...objective, dependsOn: ['missing-objective'] } : objective,
    ),
  };
  assert.ok(validateMissionCatalog([dangling]).some((error) => error.includes('unknown dependency')));

  const cyclic = {
    ...first,
    objectives: first.objectives.map((objective) => ({
      ...objective,
      dependsOn: [objective.id === 'm1-intercept' ? 'm1-clear' : 'm1-intercept'],
    })),
  };
  assert.ok(validateMissionCatalog([cyclic]).some((error) => error.includes('dependency cycle')));

  const unknownTarget = {
    ...first,
    objectives: first.objectives.map((objective) =>
      objective.id === 'm1-intercept' ? { ...objective, targetCallsign: 'MISSING' } : objective,
    ),
  };
  assert.ok(validateMissionCatalog([unknownTarget]).some((error) => error.includes('unknown target callsign')));
});

test('campaign progression is explicit and preserves Mission 06 behind Mission 05', () => {
  for (const mission of CAMPAIGN_MISSIONS.slice(0, -1)) {
    assert.equal(getNextMission(mission.id)?.id, mission.nextMissionId);
    assert.equal(getMissionById(mission.nextMissionId!).unlockRequirementId, mission.id);
  }
  assert.equal(getMissionById('mission-06').unlockRequirementId, 'mission-05');
  assert.equal(getNextMission('mission-06'), null);
  assert.equal(isMissionUnlockedInCatalog('mission-06', new Set(['mission-04'])), false);
  assert.equal(isMissionUnlockedInCatalog('mission-06', new Set(['mission-05'])), true);
});

test('campaign missions have distinct objective profiles and explicit outcomes', () => {
  assert.equal(CAMPAIGN_MISSIONS[0].objectives.some((objective) => objective.type === 'intercept'), true);
  assert.equal(CAMPAIGN_MISSIONS[1].objectives.some((objective) => objective.type === 'defend'), true);
  assert.equal(CAMPAIGN_MISSIONS[2].objectives.some((objective) => objective.type === 'recon'), true);
  assert.equal(CAMPAIGN_MISSIONS[3].stages.length, 2);
  assert.equal(CAMPAIGN_MISSIONS[4].objectives.some((objective) => objective.optional), true);
  assert.equal(CAMPAIGN_MISSIONS[5].escort?.callsign, 'CIVILIAN-07');
  assert.ok(CAMPAIGN_MISSIONS.every((mission) => 'objectiveIds' in mission.outcome.success && mission.outcome.success.objectiveIds.length > 0));
  assert.ok(CAMPAIGN_MISSIONS.every((mission) => 'objectiveIds' in mission.outcome.success &&
    mission.outcome.success.objectiveIds.every((id) => !mission.objectives.find((objective) => objective.id === id)?.optional),
  ));
});

test('dependent objectives start locked and expose the active mission stage', () => {
  const manager = new MissionManager();
  const combat = new CombatManager(100);
  const snapshot = manager.startMission(
    getMissionById('mission-01'), combat, 100, new THREE.Vector3(),
  );
  assert.equal(snapshot.objectives.find((objective) => objective.id === 'm1-intercept')?.status, 'active');
  assert.equal(snapshot.objectives.find((objective) => objective.id === 'm1-clear')?.status, 'locked');
  assert.equal(snapshot.stageLabel, 'First Contact');
});
