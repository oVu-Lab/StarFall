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
}

export const RANK_THRESHOLDS: Record<MissionRank, number> = {
  S: 820,
  A: 660,
  B: 480,
  C: 0,
};

const RANK_ORDER: Record<MissionRank, number> = {
  S: 4,
  A: 3,
  B: 2,
  C: 1,
};

export function isBetterRank(candidate: MissionRank, existing: MissionRank | null): boolean {
  if (!existing) return true;
  return RANK_ORDER[candidate] > RANK_ORDER[existing];
}

/**
 * Deterministic mission scoring and rank evaluation (0 - 1000 points).
 * Identical inputs always produce the exact same breakdown and rank.
 *
 * Weighting:
 *  - Combat Completion: 0..400 pts
 *  - Accuracy:          0..250 pts (full credit at >= 55% hit rate)
 *  - Survival / Hull:   0..200 pts (hull integrity + low damage bonus)
 *  - Completion Speed:  0..150 pts (full credit at or under parTimeSec)
 */
export function calculateMissionScore(input: RankCalculationInput): MissionScoreBreakdown {
  const enemyRatio =
    input.totalEnemies > 0
      ? Math.max(0, Math.min(1, input.enemiesDefeated / input.totalEnemies))
      : input.completed
        ? 1
        : 0;
  const combatScore = Math.round(enemyRatio * 340 + (input.completed ? 60 : 0));

  const accuracyRatio =
    input.shotsFired > 0 ? Math.max(0, Math.min(1, input.shotsHit / input.shotsFired)) : 0;
  // 55% accuracy in 6DOF space dogfighting awards full accuracy score
  const normalizedAcc = Math.min(1, accuracyRatio / 0.55);
  const accuracyScore = Math.round(normalizedAcc * 250);

  const hullRatio =
    input.maxHull > 0 ? Math.max(0, Math.min(1, input.remainingHull / input.maxHull)) : 0;
  const lowDamageFactor = Math.max(0, 1 - input.damageReceived / Math.max(input.maxHull * 1.2, 1));
  const transportRatio = input.transportRemainingRatio == null
    ? 1
    : Math.max(0, Math.min(1, input.transportRemainingRatio));
  const hullSurvival = hullRatio * 0.65 + lowDamageFactor * 0.35;
  const survivalScore = input.completed
    ? Math.round((input.transportRemainingRatio == null ? hullSurvival : hullSurvival * 0.55 + transportRatio * 0.45) * 200)
    : Math.round((input.transportRemainingRatio == null ? hullRatio : hullRatio * 0.55 + transportRatio * 0.45) * 80);

  let timeScore = 0;
  if (input.completed) {
    const safePar = Math.max(15, input.parTimeSec);
    if (input.timeTakenSec <= safePar) {
      timeScore = 150;
    } else {
      const overtimeRatio = (input.timeTakenSec - safePar) / safePar;
      timeScore = Math.round(Math.max(20, 150 * Math.exp(-overtimeRatio * 1.15)));
    }
  }

  const totalScore = combatScore + accuracyScore + survivalScore + timeScore;

  let rank: MissionRank = 'C';
  if (totalScore >= RANK_THRESHOLDS.S) {
    rank = 'S';
  } else if (totalScore >= RANK_THRESHOLDS.A) {
    rank = 'A';
  } else if (totalScore >= RANK_THRESHOLDS.B) {
    rank = 'B';
  }

  return {
    combatScore,
    accuracyScore,
    survivalScore,
    timeScore,
    totalScore,
    rank,
  };
}
