import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMPAIGN_SAVE_KEY, LEGACY_CAMPAIGN_SAVE_KEY, SaveRepository, createEmptyCampaignSave, type StorageLike } from '../src/engine/mission/SaveRepository';

class MemoryStorage implements StorageLike {
  values = new Map<string, string>(); failRead = false; failWrite = false;
  getItem(key: string) { if (this.failRead) throw new Error('read'); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrite) throw new Error('write'); this.values.set(key, value); }
}
const legacy = () => ({ version: 1, missions: {
  'mission-01': { completed: true, bestRank: 'A', bestScore: 700, bestTimeSec: 42, attempts: 4 },
  'mission-06': { completed: true, bestRank: 'S', bestScore: 900, bestTimeSec: 80, attempts: 1 },
  'custom-mission': { completed: true, bestRank: 'C', bestScore: 500, bestTimeSec: 60, attempts: 2 },
}, rewards: { credits: 765, paidFirstClearMissionIds: ['mission-01'], paidRankRewards: { 'mission-01': 'A' }, completedOptionalRewardIds: ['mission-01:optional-x'], unlockedAchievementIds: ['achievement:first-flight'], ledgerIds: ['mission-01:first-clear', 'legacy-entry'] } });

test('fresh save initializes version and VX-9 collection defaults', () => {
  const storage = new MemoryStorage(); const result = new SaveRepository(storage).load();
  assert.equal(result.data.version, 2); assert.deepEqual(result.data.collection?.ownedShipIds, ['interceptor']);
  assert.deepEqual(result.data.collection?.ownedSkinIds, ['interceptor:default']);
  assert.equal(storage.values.has(CAMPAIGN_SAVE_KEY), false);
});
test('v1/Phase 3 migration preserves missions, credits, rewards and unlock continuity', () => {
  const storage = new MemoryStorage(); storage.values.set(LEGACY_CAMPAIGN_SAVE_KEY, JSON.stringify(legacy()));
  const result = new SaveRepository(storage).load();
  assert.equal(result.migrated, true); assert.equal(result.data.missions['mission-06'].completed, true);
  assert.equal(result.data.missions['custom-mission'].bestScore, 500); assert.equal(result.data.rewards?.credits, 765);
  assert.deepEqual(result.data.rewards?.ledgerIds, ['mission-01:first-clear', 'legacy-entry']);
  assert.equal(storage.values.has(LEGACY_CAMPAIGN_SAVE_KEY), true);
  assert.deepEqual(JSON.parse(storage.values.get(CAMPAIGN_SAVE_KEY)!).rewards.ledgerIds, result.data.rewards?.ledgerIds);
});
test('migration is idempotent and does not grant historical rewards', () => {
  const storage = new MemoryStorage(); storage.values.set(LEGACY_CAMPAIGN_SAVE_KEY, JSON.stringify(legacy()));
  const first = new SaveRepository(storage).load().data; const second = new SaveRepository(storage).load().data;
  assert.equal(first.rewards?.credits, second.rewards?.credits); assert.deepEqual(first.rewards, second.rewards);
});
test('malformed records are salvaged individually and optional fields default safely', () => {
  const storage = new MemoryStorage(); storage.values.set(LEGACY_CAMPAIGN_SAVE_KEY, JSON.stringify({ version: 1, missions: { good: { completed: true, bestScore: 321 }, bad: 'broken' }, rewards: { credits: 12, ledgerIds: ['x'] } }));
  const data = new SaveRepository(storage).load().data;
  assert.equal(data.missions.good.completed, true); assert.equal(data.missions.bad, undefined);
  assert.equal(data.rewards?.credits, 12); assert.deepEqual(data.rewards?.ledgerIds, ['x']);
});
test('invalid JSON, future versions and storage failures retain existing bytes and report errors', () => {
  const storage = new MemoryStorage(); storage.values.set(LEGACY_CAMPAIGN_SAVE_KEY, '{broken');
  assert.equal(new SaveRepository(storage).load().error?.kind, 'invalid-json'); assert.equal(storage.values.get(LEGACY_CAMPAIGN_SAVE_KEY), '{broken');
  storage.values.set(CAMPAIGN_SAVE_KEY, JSON.stringify({ version: 99 }));
  assert.equal(new SaveRepository(storage).load().error?.kind, 'unknown-version');
  const readFail = new MemoryStorage(); readFail.failRead = true; assert.equal(new SaveRepository(readFail).load().error?.kind, 'read-failed');
  const writeFail = new MemoryStorage(); writeFail.values.set(LEGACY_CAMPAIGN_SAVE_KEY, JSON.stringify(legacy())); writeFail.failWrite = true;
  assert.equal(new SaveRepository(writeFail).load().error?.kind, 'write-failed'); assert.equal(writeFail.values.has(LEGACY_CAMPAIGN_SAVE_KEY), true);
});
test('current version round trip retains reward state and collection fields', () => {
  const storage = new MemoryStorage(); const repo = new SaveRepository(storage); const data = createEmptyCampaignSave();
  data.rewards!.credits = 44; data.rewards!.ledgerIds.push('one');
  assert.equal(repo.write(data), true); const loaded = repo.load().data;
  assert.equal(loaded.rewards?.credits, 44); assert.deepEqual(loaded.rewards?.ledgerIds, ['one']);
});
