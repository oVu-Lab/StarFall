import type { DifficultyLevel, DifficultyProfile } from '../types/mission';

/**
 * Configurable campaign difficulty profiles.
 * Difficulty governs tactical AI competence (reaction speed, aiming accuracy, agility,
 * firing pressure, evasion, and squad coordination) rather than unfair health/damage inflation.
 */
export const DIFFICULTY_PROFILES: Record<DifficultyLevel, DifficultyProfile> = {
  rookie: {
    id: 'rookie',
    label: 'Rookie',
    reactionTimeScale: 1.45,
    aimSpreadScale: 1.55,
    agilityScale: 0.84,
    speedScale: 0.88,
    fireCadenceScale: 0.72,
    evadeScale: 0.52,
    coordinationIntervalSec: 7.5,
    burstPressureScale: 0.78,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    reactionTimeScale: 1.0,
    aimSpreadScale: 1.08,
    agilityScale: 1.0,
    speedScale: 1.0,
    fireCadenceScale: 0.95,
    evadeScale: 0.85,
    coordinationIntervalSec: 5.2,
    burstPressureScale: 1.0,
  },
  veteran: {
    id: 'veteran',
    label: 'Veteran',
    reactionTimeScale: 0.8,
    aimSpreadScale: 0.82,
    agilityScale: 1.09,
    speedScale: 1.07,
    fireCadenceScale: 1.1,
    evadeScale: 1.12,
    coordinationIntervalSec: 4.0,
    burstPressureScale: 1.15,
  },
  expert: {
    id: 'expert',
    label: 'Expert',
    reactionTimeScale: 0.62,
    aimSpreadScale: 0.65,
    agilityScale: 1.18,
    speedScale: 1.14,
    fireCadenceScale: 1.24,
    evadeScale: 1.28,
    coordinationIntervalSec: 3.1,
    burstPressureScale: 1.28,
  },
  elite: {
    id: 'elite',
    label: 'Elite',
    reactionTimeScale: 0.48,
    aimSpreadScale: 0.52,
    agilityScale: 1.26,
    speedScale: 1.2,
    fireCadenceScale: 1.36,
    evadeScale: 1.4,
    coordinationIntervalSec: 2.4,
    burstPressureScale: 1.42,
  },
};
