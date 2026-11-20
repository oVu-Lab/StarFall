import type * as THREE from 'three';
import type { BotPersonality, ShipId } from './game';

export type EntityId = string;

export type Faction = 'player' | 'enemy' | 'neutral';

export type BotAIState =
  | 'patrol'
  | 'acquire'
  | 'pursue'
  | 'engage'
  | 'evade'
  | 'reposition'
  | 'destroyed';

export interface WeaponConfig {
  id: string;
  name: string;
  /** Shots per second */
  fireRate: number;
  /** Projectile velocity in m/s */
  projectileSpeed: number;
  /** Hull damage per hit */
  damage: number;
  /** Maximum travel lifetime in seconds */
  lifetime: number;
  /** Projectile collision radius in meters */
  hitRadius: number;
  /** Default convergence distance along aim ray in meters */
  convergenceDistance: number;
  /** Angular spread in radians (0 = pinpoint) */
  spreadRad: number;
  /** Local-space hardpoint offsets [x, y, z] relative to ship root */
  muzzleOffsets: Array<[number, number, number]>;
  /** Visual bolt dimensions */
  boltLength: number;
  boltRadius: number;
  color: string;
  coreColor: string;
}

export interface HealthState {
  current: number;
  max: number;
  isDestroyed: boolean;
  lastHitTime: number;
  lastAttackerId: EntityId | null;
}

export interface ShieldState {
  current: number;
  max: number;
  rechargeDelay: number;
  rechargeRate: number;
  lastHitTime: number;
  isBroken: boolean;
  isRecharging: boolean;
}

export interface ProjectileState {
  id: number;
  active: boolean;
  ownerId: EntityId;
  faction: Faction;
  weaponId: string;
  position: THREE.Vector3;
  prevPosition: THREE.Vector3;
  velocity: THREE.Vector3;
  direction: THREE.Vector3;
  damage: number;
  age: number;
  maxLifetime: number;
  hitRadius: number;
  boltLength: number;
  boltRadius: number;
  isPlayerOwned: boolean;
  isHomingMissile?: boolean;
  targetId?: EntityId;
  launcherForward?: THREE.Vector3;
  evasionProgress?: number;
  targetLost?: boolean;
}

export interface BotPersonalityConfig {
  id: BotPersonality;
  label: string;
  description: string;
  /** Base preferred cruise speed in m/s */
  cruiseSpeed: number;
  /** Burst speed during pursuit/evade in m/s */
  boostSpeed: number;
  /** Maximum angular turn rate in rad/s */
  turnRate: number;
  /** Detection radius in meters */
  detectionRange: number;
  /** Distance where bot starts engaging with weapons */
  engageRange: number;
  /** Minimum distance before breaking off to reposition */
  minSafeDistance: number;
  /** Ideal combat standoff range */
  preferredRange: number;
  /** Lateral flank angle offset in radians (0 for direct aggressor) */
  flankAngleRad: number;
  /** Base accuracy dispersion in radians (lower = more accurate) */
  aimSpreadRad: number;
  /** Firing cadence multiplier relative to weapon base fireRate */
  fireCadenceScale: number;
  /** Delay before reacting to target state changes (seconds) */
  reactionTime: number;
  /** Probability/tendency to break into evasive maneuver on damage (0..1) */
  evadeResponsiveness: number;
  /** Duration of evasive jink in seconds */
  evadeDuration: number;
  /** Weapon config ID used by this personality */
  weaponId: string;
  /** Base hull integrity */
  maxHull: number;
  maxShield: number;
  shieldRechargeDelay: number;
  shieldRechargeRate: number;
}

export interface EnemyEntity {
  id: EntityId;
  callsign: string;
  shipId: ShipId;
  personality: BotPersonality;
  difficulty: number; // 1..5
  difficultyLevel?: 'rookie' | 'normal' | 'veteran' | 'expert' | 'elite';
  isPriorityTarget?: boolean;
  active: boolean;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  visualBankAngle: number;
  collisionRadius: number;
  health: HealthState;
  shield: ShieldState;
  aiState: BotAIState;
  aiStateTimer: number;
  reactionTimer: number;
  coordinationTimer: number;
  weaponCooldown: number;
  burstTimer: number;
  burstActive: boolean;
  muzzleIndex: number;
  patrolAnchor: THREE.Vector3;
  patrolAngle: number;
  flankSign: 1 | -1;
  evadeDir: THREE.Vector3;
  repositionPoint: THREE.Vector3;
  hitFlashTimer: number;
  muzzleFlashTimer: number;
  targetTransport: boolean;
  targetRelay: boolean;
  missileLockTimer?: number;
  missileCooldown?: number;
}

export interface TransportEntity {
  callsign: string;
  active: boolean;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  health: HealthState;
  collisionRadius: number;
  route: THREE.Vector3[];
  routeIndex: number;
  progress: number;
  hitFlashTimer: number;
}

export interface RelayEntity {
  id: string;
  callsign: string;
  active: boolean;
  position: THREE.Vector3;
  health: HealthState;
  collisionRadius: number;
  hitFlashTimer: number;
}

/**
 * Serializable combat event payloads structured for future host-authoritative multiplayer sync.
 */
export interface WeaponFireEvent {
  shooterId: EntityId;
  faction: Faction;
  weaponId: string;
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  timestamp: number;
}

export interface DamageEvent {
  targetId: EntityId;
  attackerId: EntityId;
  weaponId: string;
  amount: number;
  remainingHealth: number;
  maxHealth: number;
  destroyed: boolean;
  hitPoint: THREE.Vector3;
  timestamp: number;
  shieldDamage?: number;
  hullDamage?: number;
  shieldRemaining?: number;
  maxShield?: number;
}

export interface DestructionEvent {
  entityId: EntityId;
  callsign?: string;
  isPriorityTarget?: boolean;
  faction: Faction;
  killerId: EntityId;
  position: THREE.Vector3;
  timestamp: number;
}

export interface CombatStats {
  kills: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  damageTaken: number;
  score: number;
  wave: number;
  activeEnemies: number;
}

/**
 * Pre-allocated screen-space projection record for zero-allocation HUD enemy brackets.
 */
export interface ProjectedEnemyMarker {
  active: boolean;
  entityId: EntityId;
  callsign: string;
  personalityLabel: string;
  aiState: BotAIState;
  /** Normalized viewport coords [0..1] */
  screenX: number;
  screenY: number;
  /** Whether inside camera frustum in front of viewer */
  inFront: boolean;
  onScreen: boolean;
  distance: number;
  healthRatio: number;
  isPrimaryTarget: boolean;
  isPriorityTarget: boolean;
  /** Screen-space lead pip [0..1] for primary target */
  leadX: number;
  leadY: number;
  leadVisible: boolean;
}

export interface MissileHudState {
  lockProgress: number;
  lockTargetName: string;
  lockReady: boolean;
  lockEscaped: boolean;
  missilesRemaining: number;
  incomingMissile: boolean;
  incomingX: number;
  incomingY: number;
}
