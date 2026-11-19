import { CAMPAIGN_MISSIONS } from '../../config/missions';
import type { MissionRank } from '../../types/game';
import type {
  CampaignSaveData,
  MissionDefinition,
  MissionProgressRecord,
} from '../../types/mission';
import { isBetterRank } from './RankCalculator';

const CAMPAIGN_STORAGE_KEY = 'starfall.campaign.v1';
const SAVE_SCHEMA_VERSION = 1;
const VALID_RANKS = new Set<MissionRank>(['S', 'A', 'B', 'C']);

function createEmptyRecord(): MissionProgressRecord {
  return {
    completed: false,
    bestRank: null,
    bestScore: 0,
    bestTimeSec: null,
    attempts: 0,
  };
}

export function createDefaultCampaignSave(): CampaignSaveData {
  const missions: Record<string, MissionProgressRecord> = {};
  for (const m of CAMPAIGN_MISSIONS) {
    missions[m.id] = createEmptyRecord();
  }
  return {
    version: SAVE_SCHEMA_VERSION,
    missions,
  };
}

/**
 * Loads campaign progression safely from browser LocalStorage.
 * Validates schema fields and gracefully recovers from corrupt, partial, or outdated data.
 */
export function loadCampaignProgress(): CampaignSaveData {
  const fallback = createDefaultCampaignSave();
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(CAMPAIGN_STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<CampaignSaveData>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== SAVE_SCHEMA_VERSION) {
      return fallback;
    }

    const rawMissions = parsed.missions;
    if (!rawMissions || typeof rawMissions !== 'object') {
      return fallback;
    }

    const sanitized = createDefaultCampaignSave();
    for (const mission of CAMPAIGN_MISSIONS) {
      const rec = rawMissions[mission.id] as Partial<MissionProgressRecord> | undefined;
      if (!rec || typeof rec !== 'object') continue;
      const validRank =
        typeof rec.bestRank === 'string' && VALID_RANKS.has(rec.bestRank as MissionRank)
          ? (rec.bestRank as MissionRank)
          : null;

      sanitized.missions[mission.id] = {
        completed: Boolean(rec.completed),
        bestRank: validRank,
        bestScore:
          typeof rec.bestScore === 'number' && Number.isFinite(rec.bestScore) && rec.bestScore >= 0
            ? Math.round(rec.bestScore)
            : 0,
        bestTimeSec:
          typeof rec.bestTimeSec === 'number' &&
          Number.isFinite(rec.bestTimeSec) &&
          rec.bestTimeSec > 0
            ? rec.bestTimeSec
            : null,
        attempts:
          typeof rec.attempts === 'number' && Number.isFinite(rec.attempts) && rec.attempts >= 0
            ? Math.floor(rec.attempts)
            : 0,
      };
    }

    return sanitized;
  } catch {
    return fallback;
  }
}

export function saveCampaignProgress(data: CampaignSaveData): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota or private-mode restriction
  }
}

export function isMissionUnlocked(mission: MissionDefinition, save: CampaignSaveData): boolean {
  if (!mission.unlockRequirementId) return true;
  const reqRecord = save.missions[mission.unlockRequirementId];
  return Boolean(reqRecord?.completed);
}

export function recordMissionOutcome(
  save: CampaignSaveData,
  missionId: string,
  completed: boolean,
  rank: MissionRank | null,
  score: number,
  timeTakenSec: number,
): {
  nextSave: CampaignSaveData;
  isNewBestRank: boolean;
  isNewBestScore: boolean;
  wasPreviouslyCompleted: boolean;
} {
  const prev = save.missions[missionId] ?? createEmptyRecord();
  const wasPreviouslyCompleted = prev.completed;

  let nextBestRank = prev.bestRank;
  let isNewBestRank = false;
  if (completed && rank && isBetterRank(rank, prev.bestRank)) {
    nextBestRank = rank;
    isNewBestRank = true;
  }

  let nextBestScore = prev.bestScore;
  let isNewBestScore = false;
  if (completed && score > prev.bestScore) {
    nextBestScore = score;
    isNewBestScore = true;
  }

  const nextBestTime =
    completed && (prev.bestTimeSec === null || timeTakenSec < prev.bestTimeSec)
      ? timeTakenSec
      : prev.bestTimeSec;

  const nextSave: CampaignSaveData = {
    version: SAVE_SCHEMA_VERSION,
    missions: {
      ...save.missions,
      [missionId]: {
        completed: prev.completed || completed,
        bestRank: nextBestRank,
        bestScore: nextBestScore,
        bestTimeSec: nextBestTime,
        attempts: prev.attempts + 1,
      },
    },
  };

  saveCampaignProgress(nextSave);

  return {
    nextSave,
    isNewBestRank,
    isNewBestScore,
    wasPreviouslyCompleted,
  };
}
