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
        id: 'm1-intercept',
        type: 'intercept',
        label: 'Intercept signal courier VEX-01',
        targetCallsign: 'VEX-01',
        targetCount: 1,
      },
      {
        id: 'm1-clear',
        type: 'intercept',
        label: 'Disable remaining scout VEX-02',
        targetCallsign: 'VEX-02',
        targetCount: 1,
        dependsOn: ['m1-intercept'],
      },
    ],
    stages: [{ id: 'contact', label: 'First Contact', waveNumbers: [1], objectiveIds: ['m1-intercept', 'm1-clear'] }],
    outcome: { success: { mode: 'all', objectiveIds: ['m1-intercept', 'm1-clear'] }, failure: ['player_destroyed'] },
    nextMissionId: 'mission-02',
  },
  {
    id: 'mission-02',
    number: 2,
    code: 'M-02',
    name: 'Hostile Squadron',
    subtitle: 'Cobalt Drift',
    description:
      'A raider squadron is probing the Cobalt relay. Hold the defense line through three timed assault waves, then intercept the defender directing their attacks.',
    difficulty: 'normal',
    difficultyNumeric: 2,
    parTimeSec: 95,
    unlockRequirementId: 'mission-01',
    rewardLabel: 'Unlocks Mission 03 — Ambush',
    totalEnemyCount: 10,
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
      {
        waveNumber: 2,
        label: 'Relay Pressure',
        triggerDelaySec: 2.2,
        enemies: [
          { callsign: 'KRAKEN-5', shipId: 'striker', personality: 'aggressor', offset: [-95, 22, -255] },
          { callsign: 'SHARD-6', shipId: 'interceptor', personality: 'flanker', offset: [105, -18, -245] },
          { callsign: 'BASTION-7', shipId: 'destroyer', personality: 'defender', offset: [0, 42, -325] },
        ],
      },
      {
        waveNumber: 3,
        label: 'Final Relay Push',
        triggerDelaySec: 2.6,
        enemies: [
          { callsign: 'KRAKEN-8', shipId: 'striker', personality: 'aggressor', offset: [-75, -12, -250] },
          { callsign: 'SHARD-9', shipId: 'interceptor', personality: 'flanker', offset: [85, 16, -265] },
          { callsign: 'BASTION-10', shipId: 'destroyer', personality: 'defender', offset: [0, 50, -330] },
        ],
      },
    ],
    objectives: [
      {
        id: 'm2-hold',
        type: 'defend',
        label: 'Defend the Cobalt relay for 75 seconds across all three waves',
        actorId: 'cobalt-relay',
        durationSec: 75,
        targetWaves: 3,
        minIntegrity: 0,
      },
      {
        id: 'm2-bastion',
        type: 'intercept',
        label: 'Optional: destroy the relay defense coordinator BASTION-3',
        targetCallsign: 'BASTION-3',
        targetCount: 1,
        optional: true,
      },
    ],
    stages: [
      { id: 'relay-screen', label: 'Crimson Screen', waveNumbers: [1], objectiveIds: ['m2-hold', 'm2-bastion'] },
      { id: 'relay-pressure', label: 'Relay Pressure', waveNumbers: [2], objectiveIds: ['m2-hold'] },
      { id: 'relay-final-push', label: 'Final Relay Push', waveNumbers: [3], objectiveIds: ['m2-hold'] },
    ],
    outcome: {
      success: { mode: 'all', objectiveIds: ['m2-hold'] },
      failure: ['player_destroyed', { kind: 'event', eventType: 'protected_actor_lost', actorId: 'cobalt-relay' }],
    },
    relay: { id: 'cobalt-relay', callsign: 'COBALT RELAY', maxIntegrity: 900, offset: [0, 0, -340], collisionRadius: 24 },
    nextMissionId: 'mission-03',
  },
  {
    id: 'mission-03',
    number: 3,
    code: 'M-03',
    name: 'Ambush',
    subtitle: 'Cryo-Belt Sector',
    description:
      'Sensors tripped too late—five hostile fighters are closing from multiple vectors. Hold WARDEN-5 in your aim and scan its command signature to identify the ambush wing before engaging.',
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
            isPriorityTarget: true,
          },
        ],
      },
    ],
    objectives: [
      {
        id: 'm3-recon',
        type: 'recon',
        label: 'Scan WARDEN-5 to identify the ambush command signal',
        targetCallsign: 'WARDEN-5',
        durationSec: 5,
        maxRange: 300,
      },
      {
        id: 'm3-clear',
        type: 'eliminate',
        label: 'Intercept the four identified ambush escorts',
        targetCount: 4,
        targetCallsigns: ['TALON-1', 'TALON-2', 'RAVEN-3', 'RAVEN-4'],
        dependsOn: ['m3-recon'],
      },
      {
        id: 'm3-warden',
        type: 'intercept',
        label: 'Optional: identify and intercept WARDEN-5, the signal source',
        targetCallsign: 'WARDEN-5',
        targetCount: 1,
        optional: true,
        dependsOn: ['m3-recon'],
      },
    ],
    stages: [{ id: 'ambush', label: 'Ambush Recon', waveNumbers: [1], objectiveIds: ['m3-recon', 'm3-clear', 'm3-warden'] }],
    outcome: {
      success: { mode: 'all', objectiveIds: ['m3-recon', 'm3-clear'] },
      failure: ['player_destroyed', { kind: 'objective_status', objectiveId: 'm3-recon', status: 'failed' }],
    },
    nextMissionId: 'mission-04',
  },
  {
    id: 'mission-04',
    number: 4,
    code: 'M-04',
    name: 'Ace Hunters',
    subtitle: 'Cerulean Rift',
    description:
      'A mercenary hunter wing has entered the rift. Break the first ace screen, then pursue PHANTOM-2 through a second wave before clearing its escort.',
    difficulty: 'expert',
    difficultyNumeric: 4,
    parTimeSec: 115,
    unlockRequirementId: 'mission-03',
    rewardLabel: 'Unlocks Mission 05 — Final Stand',
    totalEnemyCount: 4,
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
          { callsign: 'SPECTER-1', shipId: 'interceptor', personality: 'ace', offset: [-95, 28, -245] },
          { callsign: 'WRAITH-3', shipId: 'striker', personality: 'flanker', offset: [0, 62, -310] },
        ],
      },
      {
        waveNumber: 2,
        label: 'Phantom Intercept',
        triggerDelaySec: 2.4,
        enemies: [
          { callsign: 'PHANTOM-2', shipId: 'interceptor', personality: 'ace', offset: [95, -22, -265] },
          { callsign: 'WRAITH-4', shipId: 'striker', personality: 'flanker', offset: [-30, 42, -305] },
        ],
      },
    ],
    objectives: [
      {
        id: 'm4-specter',
        type: 'intercept',
        label: 'Intercept ace pilot SPECTER-1',
        targetCallsign: 'SPECTER-1',
        targetCount: 1,
      },
      {
        id: 'm4-phantom',
        type: 'intercept',
        label: 'Intercept ace pilot PHANTOM-2',
        targetCallsign: 'PHANTOM-2',
        targetCount: 1,
        dependsOn: ['m4-specter'],
        activation: { type: 'wave_reached', waveNumber: 2 },
        stageId: 'phantom-intercept',
      },
      {
        id: 'm4-clear',
        type: 'eliminate',
        label: 'Clear the remaining hunter escort',
        targetCount: 2,
        targetCallsigns: ['WRAITH-3', 'WRAITH-4'],
        dependsOn: ['m4-phantom'],
        stageId: 'phantom-intercept',
      },
    ],
    stages: [
      { id: 'specter-intercept', label: 'Specter Intercept', waveNumbers: [1], objectiveIds: ['m4-specter'] },
      { id: 'phantom-intercept', label: 'Phantom Intercept', waveNumbers: [2], objectiveIds: ['m4-phantom', 'm4-clear'] },
    ],
    outcome: { success: { mode: 'all', objectiveIds: ['m4-specter', 'm4-phantom', 'm4-clear'] }, failure: ['player_destroyed'] },
    nextMissionId: 'mission-05',
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
        type: 'survive',
        label: 'Clear all enemy waves',
        targetWaves: 3,
      },
      {
        id: 'm5-boss',
        type: 'boss',
        label: 'Defeat Ace Commander SOVEREIGN-ONE',
        targetCallsign: 'SOVEREIGN-ONE',
        targetCount: 1,
      },
      {
        id: 'm5-escort',
        type: 'intercept',
        label: 'Optional: break the command wing by destroying ESCORT-A',
        targetCallsign: 'ESCORT-A',
        targetCount: 1,
        optional: true,
      },
    ],
    stages: [
      { id: 'vanguard', label: 'Vanguard Wave', waveNumbers: [1], objectiveIds: ['m5-waves', 'm5-boss'] },
      { id: 'assault', label: 'Assault Wave', waveNumbers: [2], objectiveIds: ['m5-waves', 'm5-boss'] },
      { id: 'command', label: 'Command Wing', waveNumbers: [3], objectiveIds: ['m5-waves', 'm5-boss', 'm5-escort'] },
    ],
    outcome: { success: { mode: 'all', objectiveIds: ['m5-waves', 'm5-boss'] }, failure: ['player_destroyed'] },
    nextMissionId: 'mission-06',
  },
  {
    id: 'mission-06',
    number: 6,
    code: 'M-06',
    name: 'Last Shuttle Out',
    subtitle: 'Aurelia Evacuation Lane',
    description: 'A civilian shuttle is crossing the evacuation lane under a coordinated interdiction. Break the raider screen, protect CIVILIAN-07 to the beacon, then reach the extraction point and confirm the shuttle is clear.',
    difficulty: 'veteran',
    difficultyNumeric: 3,
    parTimeSec: 55,
    unlockRequirementId: 'mission-05',
    rewardLabel: 'Campaign complete',
    totalEnemyCount: 4,
    escort: {
      callsign: 'CIVILIAN-07',
      maxHull: 360,
      route: [[0, 0, -45], [24, 8, -330], [-18, 10, -650], [0, 0, -920]],
    },
    environment: {
      id: 'aurelia-evacuation',
      sectorName: 'Aurelia Evacuation Lane',
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
      beaconColor: '#fbbf24',
    },
    waves: [
      {
        waveNumber: 1,
        label: 'Interdiction Screen',
        triggerDelaySec: 0,
        enemies: [
          { callsign: 'RAIDER-1', shipId: 'striker', personality: 'aggressor', offset: [-65, 14, -240] },
          { callsign: 'RAIDER-2', shipId: 'striker', personality: 'aggressor', offset: [70, -10, -280] },
        ],
      },
      {
        waveNumber: 2,
        label: 'Pursuit Wing',
        triggerDelaySec: 2.4,
        enemies: [
          { callsign: 'SHARD-3', shipId: 'interceptor', personality: 'flanker', offset: [140, 32, -205] },
          { callsign: 'WARDEN-4', shipId: 'destroyer', personality: 'defender', offset: [-125, -18, -300] },
        ],
      },
    ],
    objectives: [
      { id: 'm6-screen', type: 'survive', label: 'Break both interdiction waves', targetWaves: 2 },
      { id: 'm6-escort', type: 'escort', label: 'Keep CIVILIAN-07 intact through extraction', actorId: 'CIVILIAN-07' },
      { id: 'm6-raider', type: 'intercept', label: 'Optional: destroy WARDEN-4 before it reaches the shuttle', targetCallsign: 'WARDEN-4', targetCount: 1, optional: true },
      { id: 'm6-extract', type: 'extract', label: 'Reach the beacon and confirm shuttle extraction', actorId: 'aurelia-beacon', dependsOn: ['m6-escort'] },
    ],
    stages: [
      { id: 'interdiction', label: 'Interdiction Screen', waveNumbers: [1], objectiveIds: ['m6-screen', 'm6-escort', 'm6-raider', 'm6-extract'] },
      { id: 'pursuit', label: 'Pursuit Wing', waveNumbers: [2], objectiveIds: ['m6-screen', 'm6-escort', 'm6-raider', 'm6-extract'] },
    ],
    outcome: { success: { mode: 'all', objectiveIds: ['m6-screen', 'm6-escort', 'm6-extract'] }, failure: ['player_destroyed', 'transport_destroyed'] },
    nextMissionId: null,
    extractionPoint: { id: 'aurelia-beacon', label: 'Aurelia extraction beacon', offset: [0, 0, -970], radius: 32 },
  },
];

export function getMissionById(id: string): MissionDefinition {
  const mission = findMissionById(id);
  if (!mission) throw new Error(`Unknown mission id: ${id}`);
  return mission;
}

export function findMissionById(id: string): MissionDefinition | undefined {
  return CAMPAIGN_MISSIONS.find((mission) => mission.id === id);
}

export function getNextMission(currentId: string): MissionDefinition | null {
  const nextId = findMissionById(currentId)?.nextMissionId;
  return nextId ? findMissionById(nextId) ?? null : null;
}

export function getMissionUnlockRequirement(missionId: string): string | null | undefined {
  return findMissionById(missionId)?.unlockRequirementId;
}

export function isMissionUnlockedInCatalog(
  missionId: string,
  completedMissionIds: ReadonlySet<string>,
): boolean {
  const requirementId = getMissionUnlockRequirement(missionId);
  return requirementId !== undefined && (requirementId === null || completedMissionIds.has(requirementId));
}

export function validateMissionCatalog(missions: readonly MissionDefinition[] = CAMPAIGN_MISSIONS): string[] {
  const errors: string[] = [];
  const missionIds = new Set<string>();

  for (const mission of missions) {
    if (missionIds.has(mission.id)) errors.push(`${mission.id}: duplicate mission id`);
    missionIds.add(mission.id);
  }

  for (const mission of missions) {
    const objectiveIds = new Set(mission.objectives.map((objective) => objective.id));
    const waveNumbers = new Set(mission.waves.map((wave) => wave.waveNumber));
    const stageIds = new Set(mission.stages.map((stage) => stage.id));
    const callsigns = new Set(mission.waves.flatMap((wave) => wave.enemies.map((enemy) => enemy.callsign)));
    const actorIds = new Set([
      ...callsigns,
      ...(mission.escort ? [mission.escort.callsign, 'transport-1'] : []),
      ...(mission.relay ? [mission.relay.id] : []),
      ...(mission.extractionPoint ? [mission.extractionPoint.id] : []),
    ]);
    if (waveNumbers.size !== mission.waves.length) errors.push(`${mission.id}: duplicate wave number`);
    if (objectiveIds.size !== mission.objectives.length) errors.push(`${mission.id}: duplicate objective id`);
    if (stageIds.size !== mission.stages.length) errors.push(`${mission.id}: duplicate stage id`);
    for (const objective of mission.objectives) {
      if (objective.targetCallsign && !callsigns.has(objective.targetCallsign)) {
        errors.push(`${mission.id}/${objective.id}: unknown target callsign ${objective.targetCallsign}`);
      }
      for (const callsign of objective.targetCallsigns ?? []) {
        if (!callsigns.has(callsign)) errors.push(`${mission.id}/${objective.id}: unknown target callsign ${callsign}`);
      }
      if (objective.actorId && !actorIds.has(objective.actorId)) {
        errors.push(`${mission.id}/${objective.id}: unknown actor ${objective.actorId}`);
      }
      if (objective.targetCount != null && (!Number.isInteger(objective.targetCount) || objective.targetCount < 1)) {
        errors.push(`${mission.id}/${objective.id}: target count must be a positive integer`);
      }
      if (objective.targetWaves != null && (!Number.isInteger(objective.targetWaves) || objective.targetWaves < 1)) {
        errors.push(`${mission.id}/${objective.id}: target waves must be a positive integer`);
      }
      if (objective.durationSec != null && (!Number.isFinite(objective.durationSec) || objective.durationSec <= 0)) {
        errors.push(`${mission.id}/${objective.id}: duration must be positive`);
      }
      for (const dependencyId of objective.dependsOn ?? []) {
        if (!objectiveIds.has(dependencyId)) errors.push(`${mission.id}/${objective.id}: unknown dependency ${dependencyId}`);
        if (dependencyId === objective.id) errors.push(`${mission.id}/${objective.id}: objective cannot depend on itself`);
      }
      if (objective.stageId && !stageIds.has(objective.stageId)) {
        errors.push(`${mission.id}/${objective.id}: unknown stage ${objective.stageId}`);
      } else if (objective.stageId && !mission.stages.find((stage) => stage.id === objective.stageId)?.objectiveIds.includes(objective.id)) {
        errors.push(`${mission.id}/${objective.id}: stage does not list its objective`);
      }
      if (objective.activation && !waveNumbers.has(objective.activation.waveNumber)) {
        errors.push(`${mission.id}/${objective.id}: activation references unknown wave ${objective.activation.waveNumber}`);
      }
    }
    for (const stage of mission.stages) {
      for (const waveNumber of stage.waveNumbers) {
        if (!waveNumbers.has(waveNumber)) errors.push(`${mission.id}/${stage.id}: unknown wave ${waveNumber}`);
      }
      for (const objectiveId of stage.objectiveIds) {
        if (!objectiveIds.has(objectiveId)) errors.push(`${mission.id}/${stage.id}: unknown objective ${objectiveId}`);
      }
    }
    for (const objective of mission.objectives) {
      if (!mission.stages.some((stage) => stage.objectiveIds.includes(objective.id))) {
        errors.push(`${mission.id}/${objective.id}: objective is not assigned to a stage`);
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visitObjective = (objectiveId: string) => {
      if (visiting.has(objectiveId)) {
        errors.push(`${mission.id}: objective dependency cycle includes ${objectiveId}`);
        return;
      }
      if (visited.has(objectiveId)) return;
      visiting.add(objectiveId);
      const objective = mission.objectives.find((candidate) => candidate.id === objectiveId);
      for (const dependencyId of objective?.dependsOn ?? []) {
        if (objectiveIds.has(dependencyId)) visitObjective(dependencyId);
      }
      visiting.delete(objectiveId);
      visited.add(objectiveId);
    };
    for (const objective of mission.objectives) visitObjective(objective.id);
    const successObjectiveIds = 'mode' in mission.outcome.success
      ? mission.outcome.success.objectiveIds
      : collectConditionObjectiveIds(mission.outcome.success);
    for (const objectiveId of successObjectiveIds) {
      if (!objectiveIds.has(objectiveId)) errors.push(`${mission.id}: success references unknown objective ${objectiveId}`);
    }
    if (successObjectiveIds.length === 0 && 'mode' in mission.outcome.success) errors.push(`${mission.id}: success condition has no objectives`);
    for (const condition of mission.outcome.failure) {
      if (condition === 'player_destroyed' || condition === 'transport_destroyed') continue;
      for (const objectiveId of collectConditionObjectiveIds(condition)) {
        if (!objectiveIds.has(objectiveId)) errors.push(`${mission.id}: failure references unknown objective ${objectiveId}`);
      }
    }
    if (mission.unlockRequirementId && !missions.some((candidate) => candidate.id === mission.unlockRequirementId)) {
      errors.push(`${mission.id}: unknown unlock requirement ${mission.unlockRequirementId}`);
    }
    if (mission.nextMissionId && !missions.some((candidate) => candidate.id === mission.nextMissionId)) {
      errors.push(`${mission.id}: unknown next mission ${mission.nextMissionId}`);
    } else if (mission.nextMissionId) {
      const next = missions.find((candidate) => candidate.id === mission.nextMissionId);
      if (next?.unlockRequirementId !== mission.id) errors.push(`${mission.id}: next mission unlock edge is inconsistent`);
    }
  }

  return errors;
}

function collectConditionObjectiveIds(condition: import('../types/mission').MissionCondition): string[] {
  if (condition.kind === 'objective' || condition.kind === 'objective_status') return [condition.objectiveId];
  if (condition.kind === 'event') return [];
  return condition.conditions.flatMap(collectConditionObjectiveIds);
}
