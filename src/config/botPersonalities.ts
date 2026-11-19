import type { BotPersonalityConfig } from '../types/combat';
import type { BotPersonality } from '../types/game';
import type { DifficultyLevel } from '../types/mission';
import { DIFFICULTY_PROFILES } from './difficulty';

export const BOT_PERSONALITIES: Record<BotPersonality, BotPersonalityConfig> = {
  aggressor: {
    id: 'aggressor',
    label: 'Aggressor',
    description: 'Closes distance quickly and maintains steady frontal offensive pressure.',
    cruiseSpeed: 74,
    boostSpeed: 108,
    turnRate: 1.55,
    detectionRange: 620,
    engageRange: 270,
    minSafeDistance: 58,
    preferredRange: 145,
    flankAngleRad: 0.12,
    aimSpreadRad: 0.048,
    fireCadenceScale: 1.0,
    reactionTime: 0.42,
    evadeResponsiveness: 0.48,
    evadeDuration: 1.4,
    weaponId: 'enemy_pulse_aggressor',
    maxHull: 80,
  },
  flanker: {
    id: 'flanker',
    label: 'Flanker',
    description: 'Carves wide lateral approach arcs to strike from oblique angles.',
    cruiseSpeed: 82,
    boostSpeed: 116,
    turnRate: 1.85,
    detectionRange: 640,
    engageRange: 250,
    minSafeDistance: 64,
    preferredRange: 135,
    flankAngleRad: 0.92,
    aimSpreadRad: 0.052,
    fireCadenceScale: 0.92,
    reactionTime: 0.34,
    evadeResponsiveness: 0.72,
    evadeDuration: 1.65,
    weaponId: 'enemy_pulse_flanker',
    maxHull: 70,
  },
  defender: {
    id: 'defender',
    label: 'Defender',
    description: 'Holds disciplined standoff range and breaks off aggressively under fire.',
    cruiseSpeed: 64,
    boostSpeed: 94,
    turnRate: 1.35,
    detectionRange: 660,
    engageRange: 310,
    minSafeDistance: 105,
    preferredRange: 215,
    flankAngleRad: 0.55,
    aimSpreadRad: 0.04,
    fireCadenceScale: 0.85,
    reactionTime: 0.45,
    evadeResponsiveness: 0.82,
    evadeDuration: 1.85,
    weaponId: 'enemy_pulse_defender',
    maxHull: 105,
  },
  ace: {
    id: 'ace',
    label: 'Ace',
    description: 'Elite dogfighter with tight reactions, smart evasion, and sharp lead accuracy.',
    cruiseSpeed: 88,
    boostSpeed: 126,
    turnRate: 2.1,
    detectionRange: 720,
    engageRange: 290,
    minSafeDistance: 62,
    preferredRange: 155,
    flankAngleRad: 0.65,
    aimSpreadRad: 0.026,
    fireCadenceScale: 1.15,
    reactionTime: 0.2,
    evadeResponsiveness: 0.92,
    evadeDuration: 1.5,
    weaponId: 'enemy_pulse_ace',
    maxHull: 95,
  },
};

export interface ScaledBotTuning {
  cruiseSpeed: number;
  boostSpeed: number;
  turnRate: number;
  aimSpreadRad: number;
  fireCadenceScale: number;
  reactionTime: number;
  evadeResponsiveness: number;
  coordinationIntervalSec: number;
  burstPressureScale: number;
}

const NUMERIC_TO_LEVEL: Record<number, DifficultyLevel> = {
  1: 'rookie',
  2: 'normal',
  3: 'veteran',
  4: 'expert',
  5: 'elite',
};

/**
 * Scales bot tactical performance cleanly using the structured campaign DifficultyProfile
 * (reaction speed, aiming accuracy, agility, speed, firing cadence, evasion, and squad coordination)
 * without giving enemies unfair bullet-sponge health or arbitrary damage inflation.
 */
export function resolveBotDifficultyTuning(
  personality: BotPersonalityConfig,
  difficulty: number | DifficultyLevel,
): ScaledBotTuning {
  const level: DifficultyLevel =
    typeof difficulty === 'string'
      ? difficulty
      : NUMERIC_TO_LEVEL[Math.max(1, Math.min(5, Math.round(difficulty)))] ?? 'normal';
  const profile = DIFFICULTY_PROFILES[level];

  return {
    cruiseSpeed: personality.cruiseSpeed * profile.speedScale,
    boostSpeed: personality.boostSpeed * profile.speedScale,
    turnRate: personality.turnRate * profile.agilityScale,
    aimSpreadRad: Math.max(0.014, personality.aimSpreadRad * profile.aimSpreadScale),
    fireCadenceScale: personality.fireCadenceScale * profile.fireCadenceScale,
    reactionTime: Math.max(0.11, personality.reactionTime * profile.reactionTimeScale),
    evadeResponsiveness: Math.min(0.96, personality.evadeResponsiveness * profile.evadeScale),
    coordinationIntervalSec: profile.coordinationIntervalSec,
    burstPressureScale: profile.burstPressureScale,
  };
}
