import type { BotPersonality, MissionRank, ShipId } from './game';

export type DifficultyLevel = 'rookie' | 'normal' | 'veteran' | 'expert' | 'elite';

export interface DifficultyProfile {
  id: DifficultyLevel;
  label: string;
  /** Multiplier on bot reaction time (< 1 = faster reaction) */
  reactionTimeScale: number;
  /** Multiplier on bot aim dispersion (< 1 = tighter accuracy) */
  aimSpreadScale: number;
  /** Multiplier on bot turn rate & agility */
  agilityScale: number;
  /** Multiplier on bot cruise/boost flight speed */
  speedScale: number;
  /** Multiplier on bot firing cadence */
  fireCadenceScale: number;
  /** Multiplier on bot damage evasion probability */
  evadeScale: number;
  /** Seconds between coordinated squad flank/focus shifts */
  coordinationIntervalSec: number;
  /** Multiplier on burst duration & offensive engagement pressure */
  burstPressureScale: number;
}

export type ObjectiveType =
  | 'eliminate_all'
  | 'survive_duration'
  | 'defeat_target'
  | 'survive_waves'
  | 'escort_transport';

export type ObjectiveStatus = 'active' | 'completed' | 'failed';

export interface ObjectiveDefinition {
  id: string;
  type: ObjectiveType;
  label: string;
  /** Total count for eliminate_all or survive_waves */
  targetCount?: number;
  /** Duration in seconds for survive_duration */
  targetDurationSec?: number;
  /** Specific callsign for defeat_target */
  targetCallsign?: string;
}

export interface ObjectiveRuntimeState {
  id: string;
  type: ObjectiveType;
  label: string;
  status: ObjectiveStatus;
  currentCount: number;
  targetCount: number;
  elapsedSec: number;
  targetDurationSec: number;
  targetCallsign?: string;
}

export interface MissionWaveEnemySpec {
  callsign: string;
  shipId: ShipId;
  personality: BotPersonality;
  /** 3D spawn offset [x, y, z] relative to player position */
  offset: [number, number, number];
  /** Marks a priority boss/ace target for defeat_target objectives */
  isPriorityTarget?: boolean;
  /** Optional small tactical hull bonus ONLY for named final boss ace */
  hullBonus?: number;
}

export interface MissionWaveDefinition {
  waveNumber: number;
  label: string;
  triggerDelaySec: number;
  enemies: MissionWaveEnemySpec[];
}

export interface MissionEnvironmentTheme {
  id: string;
  sectorName: string;
  nebulaVoid: [number, number, number];
  nebulaMid: [number, number, number];
  nebulaIon: [number, number, number];
  fogColor: string;
  keyLightColor: string;
  hemiSkyColor: string;
  rimLightColor: string;
  planetBands: [string, string, string, string];
  atmosphereColor: string;
  asteroidTint: string;
  beaconColor: string;
}

export interface MissionDefinition {
  id: string;
  number: number;
  code: string;
  name: string;
  subtitle: string;
  description: string;
  difficulty: DifficultyLevel;
  difficultyNumeric: number; // 1..5
  parTimeSec: number;
  environment: MissionEnvironmentTheme;
  waves: MissionWaveDefinition[];
  objectives: ObjectiveDefinition[];
  unlockRequirementId: string | null;
  rewardLabel: string;
  totalEnemyCount: number;
  escort?: {
    callsign: string;
    maxHull: number;
    route: Array<[number, number, number]>;
  };
}

export interface MissionScoreBreakdown {
  combatScore: number;
  accuracyScore: number;
  survivalScore: number;
  timeScore: number;
  totalScore: number;
  rank: MissionRank;
}

export interface MissionResult {
  missionId: string;
  missionNumber: number;
  missionName: string;
  difficulty: DifficultyLevel;
  status: 'completed' | 'failed';
  rank: MissionRank | null;
  scoreBreakdown: MissionScoreBreakdown;
  enemiesDefeated: number;
  totalEnemies: number;
  shotsFired: number;
  shotsHit: number;
  accuracyPct: number;
  timeTakenSec: number;
  damageReceived: number;
  remainingHullPct: number;
  transportRemainingHullPct?: number | null;
  unlockedNextMissionId: string | null;
  unlockedNextMissionName: string | null;
  isNewBestRank: boolean;
  isNewBestScore: boolean;
}

export interface MissionProgressRecord {
  completed: boolean;
  bestRank: MissionRank | null;
  bestScore: number;
  bestTimeSec: number | null;
  attempts: number;
}

export interface CampaignSaveData {
  version: number;
  missions: Record<string, MissionProgressRecord>;
}

export interface MissionHudSnapshot {
  missionId: string;
  missionCode: string;
  missionName: string;
  difficultyLabel: string;
  waveIndex: number;
  totalWaves: number;
  elapsedSec: number;
  objectives: ObjectiveRuntimeState[];
  announcement: string | null;
  announcementKind: 'info' | 'complete' | 'warning';
  transport: { callsign: string; currentHull: number; maxHull: number; progress: number } | null;
}
