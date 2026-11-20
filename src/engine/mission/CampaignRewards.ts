import type { MissionRank } from '../../types/game';
import type { CampaignSaveData, MissionResult, RewardSummary } from '../../types/mission';
import { isBetterRank } from './RankCalculator';

export const MISSION_REWARD_CONFIG = {
  defaultBaseCredits: 100,
  firstClearCredits: 100,
  optionalObjectiveCredits: 25,
  baseCreditsByMission: {} as Record<string, number>,
};
const RANK_MULTIPLIER: Record<MissionRank, number> = { C: 1, B: 1.1, A: 1.25, S: 1.45 };
export const ACHIEVEMENTS = [
  { id: 'achievement:first-flight', name: 'First Flight', credits: 50, condition: (r: MissionResult) => r.status === 'completed' && r.missionId === 'mission-01' },
  { id: 'achievement:ace-hunter', name: 'Ace Hunter', credits: 100, condition: (r: MissionResult) => r.status === 'completed' && r.enemiesDefeated >= 10 },
  { id: 'achievement:ghost-in-machine', name: 'Ghost in the Machine', credits: 100, condition: (r: MissionResult) => r.status === 'completed' && r.missionId === 'mission-07' },
  { id: 'achievement:formation-breaker', name: 'Formation Breaker', credits: 100, condition: (r: MissionResult) => r.status === 'completed' && r.missionId === 'mission-08' && r.optionalObjectiveIds.some((id) => r.completedObjectiveIds.includes(id)) },
  { id: 'achievement:iron-wall', name: 'Iron Wall', credits: 125, condition: (r: MissionResult) => r.status === 'completed' && r.missionId === 'mission-09' && r.optionalObjectiveIds.some((id) => r.completedObjectiveIds.includes(id)) },
  { id: 'achievement:silent-professional', name: 'Silent Professional', credits: 150, condition: (r: MissionResult) => r.status === 'completed' && r.missionId === 'mission-10' },
  { id: 'achievement:campaign-ace', name: 'Campaign Ace', credits: 200, condition: (r: MissionResult) => r.status === 'completed' && r.rank === 'S' },
  { id: 'achievement:bonus-hunter', name: 'Bonus Hunter', credits: 75, condition: (r: MissionResult) => r.status === 'completed' && r.optionalObjectiveIds.some((id) => r.completedObjectiveIds.includes(id)) },
] as const;

/** Pure calculation: produces proposed grants without changing campaign state. */
export function calculateMissionRewards(result: MissionResult, save: CampaignSaveData): RewardSummary {
  if (result.status !== 'completed' || !result.rank) return { creditsEarned: 0, creditsBalance: save.rewards?.credits ?? 0, firstClear: 0, rankImprovement: 0, optionalRewards: [], achievementRewards: [] };
  const rewards = save.rewards;
  const firstClear = rewards?.paidFirstClearMissionIds.includes(result.missionId) ? 0 : MISSION_REWARD_CONFIG.firstClearCredits;
  const previous = rewards?.paidRankRewards[result.missionId] ?? null;
  const base = MISSION_REWARD_CONFIG.baseCreditsByMission[result.missionId] ?? MISSION_REWARD_CONFIG.defaultBaseCredits;
  const rankImprovement = isBetterRank(result.rank, previous)
    ? Math.max(0, Math.round(base * RANK_MULTIPLIER[result.rank]) - (previous ? Math.round(base * RANK_MULTIPLIER[previous]) : 0)) : 0;
  const optionalRewards = result.completedObjectiveIds.filter((id) => result.optionalObjectiveIds.includes(id))
    .map((id) => ({ id: `${result.missionId}:optional-${id}`, credits: MISSION_REWARD_CONFIG.optionalObjectiveCredits }))
    .filter((grant) => !rewards?.completedOptionalRewardIds.includes(grant.id));
  const achievementRewards = ACHIEVEMENTS.filter((achievement) => achievement.condition(result) && !rewards?.unlockedAchievementIds.includes(achievement.id))
    .map(({ id, name, credits }) => ({ id, name, credits }));
  const creditsEarned = firstClear + rankImprovement + optionalRewards.reduce((sum, grant) => sum + grant.credits, 0) + achievementRewards.reduce((sum, grant) => sum + grant.credits, 0);
  return { creditsEarned, creditsBalance: (rewards?.credits ?? 0) + creditsEarned, firstClear, rankImprovement, optionalRewards, achievementRewards };
}

/** Applies ledger-backed grants atomically. Duplicate IDs never change the balance. */
export function applyMissionRewards(result: MissionResult, save: CampaignSaveData): { nextSave: CampaignSaveData; summary: RewardSummary } {
  const summary = calculateMissionRewards(result, save);
  if (result.status !== 'completed' || !result.rank) return { nextSave: save, summary };
  const state = save.rewards ?? { credits: 0, paidFirstClearMissionIds: [], paidRankRewards: {}, completedOptionalRewardIds: [], unlockedAchievementIds: [], ledgerIds: [] };
  const ledger = new Set(state.ledgerIds);
  let earned = 0;
  const add = (id: string, amount: number) => { if (amount > 0 && !ledger.has(id)) { ledger.add(id); earned += amount; } };
  if (!state.paidFirstClearMissionIds.includes(result.missionId)) add(`${result.missionId}:first-clear`, summary.firstClear);
  const prev = state.paidRankRewards[result.missionId] ?? null;
  if (summary.rankImprovement > 0) add(`${result.missionId}:rank-${result.rank}`, summary.rankImprovement);
  const optionals = [...state.completedOptionalRewardIds];
  for (const grant of summary.optionalRewards) { add(grant.id, grant.credits); if (!optionals.includes(grant.id)) optionals.push(grant.id); }
  const achievements = [...state.unlockedAchievementIds];
  for (const grant of summary.achievementRewards) { add(grant.id, grant.credits); if (!achievements.includes(grant.id)) achievements.push(grant.id); }
  const rankRewards = { ...state.paidRankRewards };
  if (isBetterRank(result.rank, prev)) rankRewards[result.missionId] = result.rank;
  const paidFirst = state.paidFirstClearMissionIds.includes(result.missionId) ? state.paidFirstClearMissionIds : [...state.paidFirstClearMissionIds, result.missionId];
  const nextSave = { ...save, rewards: { ...state, credits: state.credits + earned, paidFirstClearMissionIds: paidFirst, paidRankRewards: rankRewards, completedOptionalRewardIds: optionals, unlockedAchievementIds: achievements, ledgerIds: [...ledger] } };
  return { nextSave, summary: { ...summary, creditsEarned: earned, creditsBalance: nextSave.rewards.credits } };
}
