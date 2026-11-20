import { isMissionUnlockedInCatalog } from '../../config/missions';
import type { MissionRank } from '../../types/game';
import type { CampaignSaveData, MissionDefinition, MissionProgressRecord } from '../../types/mission';
import { isBetterRank } from './RankCalculator';
import { campaignSaveRepository, createEmptyCampaignSave } from './SaveRepository';

const createEmptyRecord = (): MissionProgressRecord => ({ completed: false, bestRank: null, bestScore: 0, bestTimeSec: null, attempts: 0 });
export function createDefaultCampaignSave(): CampaignSaveData { return createEmptyCampaignSave(); }
export function loadCampaignProgress(): CampaignSaveData { return campaignSaveRepository.load().data; }
export function getCampaignSaveError() { return campaignSaveRepository.error; }
export function saveCampaignProgress(data: CampaignSaveData): boolean { return campaignSaveRepository.write(data); }
export function isMissionUnlocked(mission: MissionDefinition, save: CampaignSaveData): boolean {
  const completedMissionIds = new Set(Object.entries(save.missions).filter(([, record]) => record.completed).map(([id]) => id));
  return isMissionUnlockedInCatalog(mission.id, completedMissionIds);
}
export function recordMissionOutcome(save: CampaignSaveData, missionId: string, completed: boolean, rank: MissionRank | null, score: number, timeTakenSec: number): {
  nextSave: CampaignSaveData; isNewBestRank: boolean; isNewBestScore: boolean; wasPreviouslyCompleted: boolean;
} {
  const prev = save.missions[missionId] ?? createEmptyRecord();
  const wasPreviouslyCompleted = prev.completed;
  const isNewBestRank = completed && !!rank && isBetterRank(rank, prev.bestRank);
  const nextBestRank = isNewBestRank ? rank : prev.bestRank;
  const isNewBestScore = completed && score > prev.bestScore;
  const nextBestTime = completed && (prev.bestTimeSec === null || timeTakenSec < prev.bestTimeSec) ? timeTakenSec : prev.bestTimeSec;
  const nextSave: CampaignSaveData = { ...save, version: 2, missions: { ...save.missions, [missionId]: {
    completed: prev.completed || completed, bestRank: nextBestRank, bestScore: isNewBestScore ? score : prev.bestScore,
    bestTimeSec: nextBestTime, attempts: prev.attempts + 1,
  } } };
  saveCampaignProgress(nextSave);
  return { nextSave, isNewBestRank, isNewBestScore, wasPreviouslyCompleted };
}
