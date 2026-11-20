import assert from 'node:assert/strict';
import test from 'node:test';
import type { MissionResult } from '../src/types/mission';
import { applyMissionRewards, calculateMissionRewards } from '../src/engine/mission/CampaignRewards';
import { createDefaultCampaignSave } from '../src/engine/mission/CampaignProgressStore';
import { calculateMissionScore, rankForScore } from '../src/engine/mission/RankCalculator';
import { purchaseCollectionItem } from '../src/config/collection';

function result(overrides: Partial<MissionResult> = {}): MissionResult {
  return {
    missionId: 'mission-03', missionNumber: 3, missionName: 'Recon', difficulty: 'normal', status: 'completed', rank: 'B',
    scoreBreakdown: { requiredObjectiveScore: 400, optionalObjectiveScore: 0, combatScore: 50, survivalScore: 150, timeScore: 70, totalScore: 670, rank: 'A' },
    enemiesDefeated: 0, totalEnemies: 8, shotsFired: 0, shotsHit: 0, accuracyPct: 0, timeTakenSec: 90, damageReceived: 0, remainingHullPct: 100,
    unlockedNextMissionId: null, unlockedNextMissionName: null, isNewBestRank: false, isNewBestScore: false,
    completedObjectiveIds: [], optionalObjectiveIds: [], ...overrides,
  };
}

test('rank boundaries are inclusive and stable', () => {
  assert.deepEqual([479, 480, 659, 660, 819, 820, 1000].map(rankForScore), ['C', 'B', 'B', 'A', 'A', 'S', 'S']);
});

test('optional score normalizes configured objectives and score ignores mission type', () => {
  const base = { enemiesDefeated: 0, totalEnemies: 10, shotsFired: 0, shotsHit: 0, remainingHull: 100, maxHull: 100, damageReceived: 0, timeTakenSec: 50, parTimeSec: 100, completed: true, totalRequiredObjectives: 1, completedRequiredObjectives: 1 };
  const none = calculateMissionScore({ ...base, totalOptionalObjectives: 0, completedOptionalObjectives: 0 });
  const half = calculateMissionScore({ ...base, totalOptionalObjectives: 4, completedOptionalObjectives: 2 });
  assert.equal(none.optionalObjectiveScore, 200);
  assert.equal(half.optionalObjectiveScore, 100);
  assert.equal(none.totalScore - half.totalScore, 100);
  assert.equal(calculateMissionScore({ ...base, enemiesDefeated: 0 }).totalScore, calculateMissionScore({ ...base, enemiesDefeated: 10 }).totalScore - 30);
});

test('failed missions pay nothing; first clear, rank differential and optional rewards pay once', () => {
  const save = createDefaultCampaignSave();
  const failed = calculateMissionRewards(result({ status: 'failed', rank: null }), save);
  assert.equal(failed.creditsEarned, 0);
  const first = applyMissionRewards(result({ rank: 'B', completedObjectiveIds: ['scan-relay'], optionalObjectiveIds: ['scan-relay'] }), save);
  assert.equal(first.summary.creditsEarned, 310); // first clear + B rank + optional + Bonus Hunter
  const replay = applyMissionRewards(result({ rank: 'B', completedObjectiveIds: ['scan-relay'], optionalObjectiveIds: ['scan-relay'] }), first.nextSave);
  assert.equal(replay.summary.creditsEarned, 0);
  const lower = applyMissionRewards(result({ rank: 'C' }), first.nextSave);
  assert.equal(lower.summary.creditsEarned, 0);
  const improved = applyMissionRewards(result({ rank: 'A' }), first.nextSave);
  assert.equal(improved.summary.rankImprovement, 15);
  assert.equal(improved.summary.creditsEarned, 15);
});

test('achievement grants and duplicate ledger entries are one-time; progress records survive reward writes', () => {
  const save = createDefaultCampaignSave();
  save.missions['mission-02'] = { completed: true, bestRank: 'A', bestScore: 700, bestTimeSec: 42, attempts: 3 };
  const ace = result({ enemiesDefeated: 10 });
  const paid = applyMissionRewards(ace, save);
  assert.equal(paid.summary.achievementRewards.length, 1);
  assert.equal(paid.summary.achievementRewards[0].id, 'achievement:ace-hunter');
  const duplicatedState = { ...paid.nextSave, rewards: { ...paid.nextSave.rewards!, ledgerIds: [...paid.nextSave.rewards!.ledgerIds, 'mission-03:first-clear'] } };
  const replay = applyMissionRewards(ace, duplicatedState);
  assert.equal(replay.summary.creditsEarned, 0);
  assert.deepEqual(replay.nextSave.missions['mission-02'], save.missions['mission-02']);
});

test('new campaign and performance achievements unlock once and gate the ace skin', () => {
  const save = createDefaultCampaignSave();
  const aceResult = result({ missionId: 'mission-10', rank: 'S', completedObjectiveIds: ['cache'], optionalObjectiveIds: ['cache'] });
  const paid = applyMissionRewards(aceResult, save);
  assert.deepEqual(paid.summary.achievementRewards.map((achievement) => achievement.id), [
    'achievement:silent-professional', 'achievement:campaign-ace', 'achievement:bonus-hunter',
  ]);
  const gated = purchaseCollectionItem(paid.nextSave, 'skin', 'interceptor:stellar');
  assert.equal(gated.ok, true);
  const replay = applyMissionRewards(aceResult, paid.nextSave);
  assert.equal(replay.summary.achievementRewards.length, 0);
  assert.equal(replay.summary.creditsEarned, 0);
});
