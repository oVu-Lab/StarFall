import type { MissionRank } from '../../types/game';
import type { MissionScoreBreakdown } from '../../types/mission';

export interface RankCalculationInput {
  enemiesDefeated: number;
  totalEnemies: number;
  shotsFired: number;
  shotsHit: number;
  remainingHull: number;
  maxHull: number;
  damageReceived: number;
  timeTakenSec: number;
  parTimeSec: number;
  completed: boolean;
  transportRemainingRatio?: number;
  completedRequiredObjectives?: number;
  totalRequiredObjectives?: number;
  completedOptionalObjectives?: number;
  totalOptionalObjectives?: number;
}

export const RANK_THRESHOLDS: Record<MissionRank, number> = { S: 820, A: 660, B: 480, C: 0 };
const RANK_ORDER: Record<MissionRank, number> = { S: 4, A: 3, B: 2, C: 1 };
export function isBetterRank(candidate: MissionRank, existing: MissionRank | null): boolean {
  return !existing || RANK_ORDER[candidate] > RANK_ORDER[existing];
}
export function rankForScore(score: number): MissionRank {
  return score >= 820 ? 'S' : score >= 660 ? 'A' : score >= 480 ? 'B' : 'C';
}

/** Mission neutral deterministic 0–1000 score. Kills contribute only to combat quality. */
export function calculateMissionScore(input: RankCalculationInput): MissionScoreBreakdown {
  const requiredTotal = Math.max(0, input.totalRequiredObjectives ?? 1);
  const requiredDone = Math.max(0, input.completedRequiredObjectives ?? (input.completed ? 1 : 0));
  const requiredObjectiveScore = Math.round(400 * Math.min(1, requiredDone / requiredTotal));
  const optionalTotal = Math.max(0, input.totalOptionalObjectives ?? 0);
  const optionalDone = Math.max(0, input.completedOptionalObjectives ?? 0);
  const optionalObjectiveScore = optionalTotal ? Math.round(200 * Math.min(1, optionalDone / optionalTotal)) : 200;

  const hullRatio = input.maxHull > 0 ? clamp(input.remainingHull / input.maxHull) : 0;
  const damageRatio = clamp(input.damageReceived / Math.max(input.maxHull * 1.2, 1));
  const assetRatio = input.transportRemainingRatio == null ? 1 : clamp(input.transportRemainingRatio);
  const survivalScore = input.completed
    ? Math.round((hullRatio * 0.6 + (1 - damageRatio) * 0.2 + assetRatio * 0.2) * 200)
    : Math.round(hullRatio * 80);

  const par = Math.max(15, input.parTimeSec);
  const timeScore = input.completed
    ? Math.round(100 * Math.max(0.2, Math.exp(-Math.max(0, input.timeTakenSec - par) / par)))
    : 0;
  const accuracy = input.shotsFired > 0 ? clamp(input.shotsHit / input.shotsFired) : 0.5;
  const killRatio = input.totalEnemies > 0 ? clamp(input.enemiesDefeated / input.totalEnemies) : 0.5;
  const combatScore = Math.round((accuracy * 0.7 + killRatio * 0.3) * 100);
  const totalScore = Math.min(1000, requiredObjectiveScore + optionalObjectiveScore + survivalScore + timeScore + combatScore);
  const rank = rankForScore(totalScore);
  return { requiredObjectiveScore, optionalObjectiveScore, combatScore, survivalScore, timeScore, totalScore, rank };
}
function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
