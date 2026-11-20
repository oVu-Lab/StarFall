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
  | 'eliminate'
  | 'escort'
  | 'defend'
  | 'intercept'
  | 'survive'
  | 'recon'
  | 'extract'
  | 'boss'
  | 'eliminate_all'
  | 'survive_duration'
  | 'defeat_target'
  | 'survive_waves'
  | 'escort_transport';

export type ObjectiveStatus = 'locked' | 'active' | 'completed' | 'failed' | 'skipped';

export interface ObjectiveActivationCondition {
  type: 'wave_reached';
  waveNumber: number;
}

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
  /** Optional goals never block the mission's declared success condition. */
  optional?: boolean;
  /** These objectives remain locked until every prerequisite is complete. */
  dependsOn?: string[];
  /** Additional activation gate, evaluated by the current Phase 1 runtime. */
  activation?: ObjectiveActivationCondition;
  /** Mission stage that owns this objective. */
  stageId?: string;
  /** Actor identity for defend, escort, recon, or extraction handlers. */
  actorId?: string;
  /** Explicit target set for elimination objectives. */
  targetCallsigns?: string[];
  /** Duration used by survive, defend, recon, or extract objectives. */
  durationSec?: number;
  /** Number of waves required by survive or defend objectives. */
  targetWaves?: number;
  /** Maximum range for a reconnaissance scan. */
  maxRange?: number;
  /** Continuous scan time required for reconnaissance completion. */
  scanDurationSec?: number;
  /** Minimum protected actor integrity required for a defense objective. */
  minIntegrity?: number;
}

export interface MissionStageDefinition {
  id: string;
  label: string;
  waveNumbers: number[];
  objectiveIds: string[];
}

export type MissionCondition =
  | { kind: 'objective'; objectiveId: string }
  | { kind: 'objective_status'; objectiveId: string; status: 'failed' | 'skipped' }
  | { kind: 'all'; conditions: MissionCondition[] }
  | { kind: 'any'; conditions: MissionCondition[] }
  | { kind: 'event'; eventType: MissionEventType; actorId?: string };

export type MissionFailureCondition =
  | 'player_destroyed'
  | 'transport_destroyed'
  | MissionCondition;

export interface MissionOutcomeDefinition {
  success: { mode: 'all' | 'any'; objectiveIds: string[] } | MissionCondition;
  failure: MissionFailureCondition[];
  failurePrecedence?: 'failure_first' | 'success_first';
}

export interface RelayDefinition {
  id: string;
  callsign: string;
  maxIntegrity: number;
  offset: [number, number, number];
  collisionRadius: number;
}

export interface ExtractionPointDefinition {
  id: string;
  label: string;
  offset: [number, number, number];
  radius: number;
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
  optional?: boolean;
  progress: number;
  detail?: string;
  currentIntegrity?: number;
  maxIntegrity?: number;
  trackedActorIds?: string[];
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
  stages: MissionStageDefinition[];
  outcome: MissionOutcomeDefinition;
  unlockRequirementId: string | null;
  /** Explicit catalog edge; null marks the end of this campaign path. */
  nextMissionId: string | null;
  rewardLabel: string;
  totalEnemyCount: number;
  escort?: {
    callsign: string;
    maxHull: number;
    route: Array<[number, number, number]>;
  };
  relay?: RelayDefinition;
  extractionPoint?: ExtractionPointDefinition;
}

export interface MissionScoreBreakdown {
  requiredObjectiveScore: number;
  optionalObjectiveScore: number;
  combatScore: number;
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
  completedObjectiveIds: string[];
  optionalObjectiveIds: string[];
  rewardSummary?: RewardSummary;
}

export interface RewardSummary {
  creditsEarned: number;
  creditsBalance: number;
  firstClear: number;
  rankImprovement: number;
  optionalRewards: Array<{ id: string; credits: number }>;
  achievementRewards: Array<{ id: string; name: string; credits: number }>;
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
  rewards?: CampaignRewardState;
  collection?: CampaignCollectionState;
}

export interface CampaignCollectionState {
  ownedShipIds: string[];
  ownedSkinIds: string[];
  selectedShipId: string;
  selectedSkinByShip: Record<string, string>;
}

export interface CampaignRewardState {
  credits: number;
  paidFirstClearMissionIds: string[];
  paidRankRewards: Record<string, MissionRank>;
  completedOptionalRewardIds: string[];
  unlockedAchievementIds: string[];
  ledgerIds: string[];
}

export interface MissionHudSnapshot {
  missionId: string;
  missionCode: string;
  missionName: string;
  difficultyLabel: string;
  waveIndex: number;
  totalWaves: number;
  stageId: string;
  stageLabel: string;
  elapsedSec: number;
  objectives: ObjectiveRuntimeState[];
  announcement: string | null;
  announcementKind: 'info' | 'complete' | 'warning';
  transport: { callsign: string; currentHull: number; maxHull: number; progress: number } | null;
  relay: { id: string; callsign: string; currentIntegrity: number; maxIntegrity: number; destroyed: boolean } | null;
  interaction: {
    kind: 'scan' | 'extract';
    targetLabel: string;
    prompt: string;
    available: boolean;
    progress: number;
    requiredProgress: number;
    distance: number | null;
  } | null;
}

export type MissionEventType =
  | 'enemy_destroyed'
  | 'actor_destroyed'
  | 'actor_damaged'
  | 'wave_started'
  | 'wave_cleared'
  | 'timer_elapsed'
  | 'scan_progress'
  | 'scan_completed'
  | 'scan_interrupted'
  | 'extraction_point_reached'
  | 'protected_actor_lost'
  | 'player_destroyed'
  | 'actor_progress';

export type MissionEvent =
  | { type: 'enemy_destroyed'; actorId: string; callsign: string; priority: boolean }
  | { type: 'actor_destroyed'; actorId: string; callsign?: string }
  | { type: 'actor_damaged'; actorId: string; callsign?: string; amount: number; currentIntegrity: number; maxIntegrity: number }
  | { type: 'wave_started'; waveNumber: number }
  | { type: 'wave_cleared'; waveNumber: number }
  | { type: 'timer_elapsed'; deltaSec: number; elapsedSec: number }
  | { type: 'scan_progress'; actorId: string; callsign: string; deltaSec: number }
  | { type: 'scan_completed'; actorId: string; callsign: string }
  | { type: 'scan_interrupted'; actorId: string; callsign: string }
  | { type: 'extraction_point_reached'; actorId: string }
  | { type: 'protected_actor_lost'; actorId: string; callsign?: string }
  | { type: 'player_destroyed'; actorId: string }
  | { type: 'actor_progress'; actorId: string; progress: number; currentIntegrity?: number; maxIntegrity?: number };

export interface MissionRuntimeState {
  missionId: string;
  status: 'active' | 'completed' | 'failed';
  elapsedSec: number;
  currentStageId: string;
  currentWave: number;
  objectives: Record<string, ObjectiveRuntimeState>;
  events: readonly MissionEvent[];
}
