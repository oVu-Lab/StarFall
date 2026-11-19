import type { MissionDefinition } from '../types/mission';

export const CAMPAIGN_MISSIONS: MissionDefinition[] = [
  {
    id: 'mission-01',
    number: 1,
    code: 'M-01',
    name: 'First Contact',
    subtitle: 'Aurelia Outer Rim',
    description:
      'Two hostile scouts have breached the outer relay corridor. Acquire targets, test your twin pulse cannons, and neutralize both bogeys.',
    difficulty: 'rookie',
    difficultyNumeric: 1,
    parTimeSec: 65,
    unlockRequirementId: null,
    rewardLabel: 'Unlocks Mission 02 — Hostile Squadron',
    totalEnemyCount: 2,
    environment: {
      id: 'aurelia-rim',
      sectorName: 'Aurelia Outer Rim',
      nebulaVoid: [0.012, 0.024, 0.058],
      nebulaMid: [0.032, 0.088, 0.215],
      nebulaIon: [0.045, 0.42, 0.64],
      fogColor: '#040a18',
      keyLightColor: '#f8fafc',
      hemiSkyColor: '#38bdf8',
      rimLightColor: '#0ea5e9',
      planetBands: ['#071024', '#1e3a5f', '#6fa3c7', '#132a4f'],
      atmosphereColor: '#38bdf8',
      asteroidTint: '#94a3b8',
      beaconColor: '#22d3ee',
    },
    waves: [
      {
        waveNumber: 1,
        label: 'Scout Pair',
        triggerDelaySec: 0,
        enemies: [
          {
            callsign: 'VEX-01',
            shipId: 'striker',
            personality: 'aggressor',
            offset: [-55, 12, -210],
          },
          {
            callsign: 'VEX-02',
            shipId: 'striker',
            personality: 'aggressor',
            offset: [62, -10, -245],
          },
        ],
      },
    ],
    objectives: [
      {
        id: 'm1-elim',
        type: 'eliminate_all',
        label: 'Eliminate hostile scouts',
        targetCount: 2,
      },
    ],
  },
  {
    id: 'mission-02',
    number: 2,
    code: 'M-02',
    name: 'Hostile Squadron',
    subtitle: 'Cobalt Drift',
    description:
      'A four-ship interceptor squadron has formed a defensive screen. Break their formation as aggressors push forward while flankers and a defender cover their angles.',
    difficulty: 'normal',
    difficultyNumeric: 2,
    parTimeSec: 95,
    unlockRequirementId: 'mission-01',
    rewardLabel: 'Unlocks Mission 03 — Ambush',
    totalEnemyCount: 4,
    environment: {
      id: 'cobalt-drift',
      sectorName: 'Cobalt Drift',
      nebulaVoid: [0.01, 0.022, 0.068],
      nebulaMid: [0.024, 0.115, 0.26],
      nebulaIon: [0.06, 0.54, 0.68],
      fogColor: '#040c1f',
      keyLightColor: '#e0f2fe',
      hemiSkyColor: '#0ea5e9',
      rimLightColor: '#22d3ee',
      planetBands: ['#06162e', '#15426b', '#4db8d4', '#0d2b4a'],
      atmosphereColor: '#22d3ee',
      asteroidTint: '#7dd3fc',
      beaconColor: '#38bdf8',
    },
    waves: [
      {
        waveNumber: 1,
        label: 'Crimson Flight',
        triggerDelaySec: 0,
        enemies: [
          {
            callsign: 'KRAKEN-1',
            shipId: 'striker',
            personality: 'aggressor',
            offset: [-70, 18, -230],
          },
          {
            callsign: 'SHARD-2',
            shipId: 'interceptor',
            personality: 'flanker',
            offset: [88, -14, -240],
          },
          {
            callsign: 'BASTION-3',
            shipId: 'destroyer',
            personality: 'defender',
            offset: [0, 32, -310],
          },
          {
            callsign: 'KRAKEN-4',
            shipId: 'striker',
            personality: 'aggressor',
            offset: [-24, -24, -285],
          },
        ],
      },
    ],
    objectives: [
      {
        id: 'm2-elim',
        type: 'eliminate_all',
        label: 'Eliminate the hostile squadron',
        targetCount: 4,
      },
    ],
  },
  {
    id: 'mission-03',
    number: 3,
    code: 'M-03',
    name: 'Ambush',
    subtitle: 'Cryo-Belt Sector',
    description:
      'Sensors tripped too late—five hostile fighters are closing from multiple vectors around your ship. Use boost and barrel rolls to survive the opening encirclement and clear all hostiles.',
    difficulty: 'veteran',
    difficultyNumeric: 3,
    parTimeSec: 120,
    unlockRequirementId: 'mission-02',
    rewardLabel: 'Unlocks Mission 04 — Ace Hunters',
    totalEnemyCount: 5,
    environment: {
      id: 'cryo-belt',
      sectorName: 'Cryo-Belt Sector',
      nebulaVoid: [0.015, 0.02, 0.062],
      nebulaMid: [0.055, 0.085, 0.24],
      nebulaIon: [0.12, 0.36, 0.68],
      fogColor: '#05091a',
      keyLightColor: '#f1f5f9',
      hemiSkyColor: '#60a5fa',
      rimLightColor: '#38bdf8',
      planetBands: ['#0c1633', '#233b6e', '#8bb4e8', '#15254d'],
      atmosphereColor: '#60a5fa',
      asteroidTint: '#cbd5e1',
      beaconColor: '#67e8f9',
    },
    waves: [
      {
        waveNumber: 1,
        label: 'Ambush Wing',
        triggerDelaySec: 0,
        enemies: [
          {
            callsign: 'TALON-1',
            shipId: 'interceptor',
            personality: 'flanker',
            offset: [-190, 26, -70],
          },
          {
            callsign: 'TALON-2',
            shipId: 'interceptor',
            personality: 'flanker',
            offset: [195, -18, -65],
          },
          {
            callsign: 'RAVEN-3',
            shipId: 'striker',
            personality: 'aggressor',
            offset: [0, 125, -140],
          },
          {
            callsign: 'RAVEN-4',
            shipId: 'striker',
            personality: 'aggressor',
            offset: [-45, -35, 165],
          },
          {
            callsign: 'WARDEN-5',
            shipId: 'destroyer',
            personality: 'defender',
            offset: [18, 12, -280],
          },
        ],
      },
    ],
    objectives: [
      {
        id: 'm3-survive',
        type: 'survive_duration',
        label: 'Survive opening ambush',
        targetDurationSec: 20,
      },
      {
        id: 'm3-elim',
        type: 'eliminate_all',
        label: 'Eliminate all ambush hostiles',
        targetCount: 5,
      },
    ],
  },
  {
    id: 'mission-04',
    number: 4,
    code: 'M-04',
    name: 'Ace Hunters',
    subtitle: 'Cerulean Rift',
    description:
      'Three elite mercenary pilots have entered the rift to hunt you down. Expect high-G evasion, tight lead targeting, and relentless flanking maneuvers.',
    difficulty: 'expert',
    difficultyNumeric: 4,
    parTimeSec: 115,
    unlockRequirementId: 'mission-03',
    rewardLabel: 'Unlocks Mission 05 — Final Stand',
    totalEnemyCount: 3,
    environment: {
      id: 'cerulean-rift',
      sectorName: 'Cerulean Rift',
      nebulaVoid: [0.018, 0.016, 0.056],
      nebulaMid: [0.068, 0.062, 0.24],
      nebulaIon: [0.08, 0.48, 0.72],
      fogColor: '#06071a',
      keyLightColor: '#f8fafc',
      hemiSkyColor: '#818cf8',
      rimLightColor: '#22d3ee',
      planetBands: ['#111136', '#28336b', '#5ea1d8', '#171c47'],
      atmosphereColor: '#38bdf8',
      asteroidTint: '#a5b4fc',
      beaconColor: '#38bdf8',
    },
    waves: [
      {
        waveNumber: 1,
        label: 'Hunter Triad',
        triggerDelaySec: 0,
        enemies: [
          {
            callsign: 'SPECTER-1',
            shipId: 'interceptor',
            personality: 'ace',
            offset: [-95, 28, -245],
          },
          {
            callsign: 'PHANTOM-2',
            shipId: 'interceptor',
            personality: 'ace',
            offset: [95, -22, -265],
          },
          {
            callsign: 'WRAITH-3',
            shipId: 'striker',
            personality: 'flanker',
            offset: [0, 62, -310],
          },
        ],
      },
    ],
    objectives: [
      {
        id: 'm4-elim',
        type: 'eliminate_all',
        label: 'Defeat all elite hunter pilots',
        targetCount: 3,
      },
    ],
  },
  {
    id: 'mission-05',
    number: 5,
    code: 'M-05',
    name: 'Final Stand',
    subtitle: 'Starfall Singularity',
    description:
      'Hold the orbital line against three escalating hostile waves culminating in an engagement with the enemy commander, Ace pilot SOVEREIGN-ONE.',
    difficulty: 'elite',
    difficultyNumeric: 5,
    parTimeSec: 175,
    unlockRequirementId: 'mission-04',
    rewardLabel: 'Campaign Victory Commendation',
    totalEnemyCount: 9,
    environment: {
      id: 'starfall-singularity',
      sectorName: 'Starfall Singularity',
      nebulaVoid: [0.016, 0.014, 0.042],
      nebulaMid: [0.075, 0.055, 0.19],
      nebulaIon: [0.05, 0.45, 0.68],
      fogColor: '#050614',
      keyLightColor: '#fef3c7',
      hemiSkyColor: '#38bdf8',
      rimLightColor: '#f59e0b',
      planetBands: ['#120f29', '#2b2f5c', '#4fa3cf', '#141938'],
      atmosphereColor: '#06b6d4',
      asteroidTint: '#94a3b8',
      beaconColor: '#f59e0b',
    },
    waves: [
      {
        waveNumber: 1,
        label: 'Vanguard Wave',
        triggerDelaySec: 0,
        enemies: [
          {
            callsign: 'VANGUARD-1',
            shipId: 'striker',
            personality: 'aggressor',
            offset: [-80, 16, -240],
          },
          {
            callsign: 'VANGUARD-2',
            shipId: 'interceptor',
            personality: 'flanker',
            offset: [85, -14, -255],
          },
          {
            callsign: 'VANGUARD-3',
            shipId: 'striker',
            personality: 'aggressor',
            offset: [0, 42, -295],
          },
        ],
      },
      {
        waveNumber: 2,
        label: 'Assault Wave',
        triggerDelaySec: 2.2,
        enemies: [
          {
            callsign: 'BREAKER-1',
            shipId: 'destroyer',
            personality: 'defender',
            offset: [-110, 28, -270],
          },
          {
            callsign: 'BREAKER-2',
            shipId: 'interceptor',
            personality: 'flanker',
            offset: [115, -20, -250],
          },
          {
            callsign: 'BREAKER-3',
            shipId: 'interceptor',
            personality: 'ace',
            offset: [10, 56, -320],
          },
        ],
      },
      {
        waveNumber: 3,
        label: 'Command Wing',
        triggerDelaySec: 2.6,
        enemies: [
          {
            callsign: 'ESCORT-A',
            shipId: 'interceptor',
            personality: 'flanker',
            offset: [-95, 18, -265],
          },
          {
            callsign: 'ESCORT-B',
            shipId: 'destroyer',
            personality: 'defender',
            offset: [95, -18, -265],
          },
          {
            callsign: 'SOVEREIGN-ONE',
            shipId: 'interceptor',
            personality: 'ace',
            offset: [0, 34, -335],
            isPriorityTarget: true,
            hullBonus: 45,
          },
        ],
      },
    ],
    objectives: [
      {
        id: 'm5-waves',
        type: 'survive_waves',
        label: 'Clear all enemy waves',
        targetCount: 3,
      },
      {
        id: 'm5-boss',
        type: 'defeat_target',
        label: 'Defeat Ace Commander SOVEREIGN-ONE',
        targetCallsign: 'SOVEREIGN-ONE',
        targetCount: 1,
      },
    ],
  },
];

export function getMissionById(id: string): MissionDefinition {
  return CAMPAIGN_MISSIONS.find((m) => m.id === id) ?? CAMPAIGN_MISSIONS[0];
}

export function getNextMission(currentId: string): MissionDefinition | null {
  const idx = CAMPAIGN_MISSIONS.findIndex((m) => m.id === currentId);
  if (idx < 0 || idx >= CAMPAIGN_MISSIONS.length - 1) return null;
  return CAMPAIGN_MISSIONS[idx + 1];
}
