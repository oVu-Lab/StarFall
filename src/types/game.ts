import type * as THREE from 'three';
import type { CombatStats, MissileHudState, ProjectedEnemyMarker } from './combat';

export type GamePhase = 'menu' | 'loading' | 'playing' | 'paused' | 'results';

export type MenuSection = 'main' | 'missions' | 'hangar' | 'settings';

export type ShipId = 'interceptor' | 'striker' | 'destroyer';

export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';

export type ShadowQuality = 'off' | 'low' | 'medium' | 'high';

export type EffectQuality = 'low' | 'medium' | 'high';

export type FlightStatus =
  | 'STANDBY'
  | 'CRUISING'
  | 'ACCELERATING'
  | 'BOOSTING'
  | 'REVERSING'
  | 'DRIFTING'
  | 'BOOST DEPLETED';

export interface ShipFlightProfile {
  /** Base forward max speed in m/s */
  maxSpeed: number;
  /** Reverse max speed in m/s */
  maxReverseSpeed: number;
  /** Forward thrust acceleration in m/s^2 */
  acceleration: number;
  /** Braking / reverse thrust acceleration in m/s^2 */
  deceleration: number;
  /** Passive velocity drag when no thrust key is pressed */
  passiveDrag: number;
  /** How quickly the velocity vector aligns with ship nose (arcade lateral grip) */
  lateralGrip: number;
  /** Boost speed multiplier applied to maxSpeed */
  boostMultiplier: number;
  /** Boost acceleration multiplier */
  boostAccelMultiplier: number;
  /** Boost energy pool (0-100) */
  maxBoostEnergy: number;
  /** Energy consumed per second while boosting */
  boostDrainRate: number;
  /** Energy regenerated per second when not boosting */
  boostRegenRate: number;
  /** Delay in seconds after stopping boost before regen begins */
  boostRegenDelay: number;
  /** Max yaw angular speed in rad/s */
  yawSpeed: number;
  /** Max pitch angular speed in rad/s */
  pitchSpeed: number;
  /** Max roll angular speed in rad/s */
  rollSpeed: number;
  /** Angular response damping (higher = snappier stop) */
  angularDamping: number;
  /** Subtle automatic visual banking induced by yaw */
  visualBankStrength: number;
}

export interface ShipWeaponSpec {
  primaryName: string;
  damageRating: number; // 0-100 normalized for UI comparison
  fireRateRating: number;
}

export interface ShipConfig {
  id: ShipId;
  callsign: string;
  name: string;
  role: string;
  description: string;
  /** Whether playable in single-player campaign */
  playableInPhase1: boolean;
  unlockNote: string;
  maxHull: number;
  /** Normalized 0-100 ratings for hangar specification bars */
  ratings: {
    speed: number;
    maneuverability: number;
    hull: number;
    firepower: number;
  };
  colors: {
    hullPrimary: string;
    hullSecondary: string;
    hullTrim: string;
    canopy: string;
    engineCore: string;
    engineGlow: string;
  };
  flight: ShipFlightProfile;
  weapons: ShipWeaponSpec;
}

export type SteeringZone = 'deadzone' | 'active' | 'max';

export interface GameSettings {
  /** Base mouse sensitivity multiplier (0.30 to 2.50) */
  mouseSensitivity: number;
  /** Independent aim boundary scale relative to the 30% x 35% centered boundary (0.65 to 1.50) */
  joystickRadius: number;
  /** Preserved baseline deadzone parameter (0.00 to 0.20, unused in direct nonlinear steering) */
  deadzone: number;
  /** Independent horizontal yaw sensitivity balance multiplier (0.40 to 1.80) */
  yawSensitivity: number;
  /** Independent vertical pitch sensitivity balance multiplier (0.40 to 1.80) */
  pitchSensitivity: number;
  /** Independent maximum yaw angular rate ceiling for reference Interceptor hull (1.50 to 5.50 rad/s) */
  maxYawRate: number;
  /** Independent maximum pitch angular rate ceiling for reference Interceptor hull (1.50 to 5.00 rad/s) */
  maxPitchRate: number;
  /** Nonlinear mouse response curve exponent (1.00 = linear, up to 2.60) */
  responseCurve: number;
  /** Optional minimal input smoothing (0.00 = instant/off, up to 0.40) */
  inputSmoothing: number;
  invertY: boolean;
  cameraDistance: number; // 7.2 to 13.5
  cameraSensitivity: number; // 0.6 to 1.6
  masterVolume: number; // 0 to 1
  graphicsQuality: GraphicsQuality;
  resolutionScale: number; // 0.65 to 1.0
  shadowQuality: ShadowQuality;
  particleQuality: EffectQuality;
  environmentDetail: EffectQuality;
  drawDistance: number; // 2000 to 5200
  antialias: boolean;
  postGlowEnabled: boolean;
  /** Development-only performance monitor toggle (hidden in production builds) */
  showPerfOverlay: boolean;
}

/**
 * High-frequency mutable telemetry updated every simulation frame.
 * Read directly via refs inside HUD animation loops to guarantee zero React re-renders per frame.
 */
export interface FlightTelemetry {
  speed: number;
  signedSpeed: number;
  maxSpeed: number;
  effectiveMaxSpeed: number;
  throttle: number; // -1 to 1
  boostEnergy: number; // 0 to 100
  maxBoostEnergy: number;
  isBoosting: boolean;
  boostDepleted: boolean;
  boostIntensity: number; // 0 to 1 smoothly damped
  hull: number;
  maxHull: number;
  yawRate: number; // normalized angular velocity relative to base yawSpeed
  pitchRate: number; // normalized angular velocity relative to base pitchSpeed
  rollRate: number; // normalized -1..1
  /** Normalized virtual joystick deflection (-1..1 inside rounded-rectangle boundary) */
  aimNormalizedX: number;
  aimNormalizedY: number;
  /** Camera projection of the actual weapon convergence point, inside the aim boundary. */
  aimScreenX: number;
  aimScreenY: number;
  /** Screen-space [0..1] position of the unconstrained VIRTUAL MOUSE (may lie outside [0..1]) */
  virtualMouseScreenX: number;
  virtualMouseScreenY: number;
  /** Full V - T alignment error in viewport CSS pixels. */
  alignmentErrorPx: number;
  /** Live rounded-rectangle boundary geometry in game viewport CSS pixels */
  aimBoundaryWidthPx: number;
  aimBoundaryHeightPx: number;
  viewportWidthPx: number;
  viewportHeightPx: number;
  aimBoundaryCornerRadiusPx: number;
  /** Normalized radial virtual joystick displacement r in [0..1] along its ray to the boundary */
  joystickRadialMagnitude: number;
  /** Shaped normalized steering target outputs after deadzone & response curve (-1..1) */
  steeringOutputX: number;
  steeringOutputY: number;
  /** Screen-space [0..1] position of the active cannon ray; retained under its legacy telemetry key */
  boresightScreenX: number;
  boresightScreenY: number;
  /** Active virtual joystick region ('deadzone' | 'active' | 'max') */
  steeringZone: SteeringZone;
  headingDeg: number; // 0..359
  pitchDeg: number; // -90..90
  rollDeg: number; // -180..180
  altitude: number;
  status: FlightStatus;
  pointerLocked: boolean;
  // Combat telemetry
  isFiring: boolean;
  weaponName: string;
  weaponCooldownRatio: number;
  hitMarkerTimer: number;
  killMarkerTimer: number;
  damageFlashTimer: number;
  muzzleFlashLeft: number;
  muzzleFlashRight: number;
  playerDestroyed: boolean;
  combatStats: CombatStats;
  enemyMarkers: ProjectedEnemyMarker[];
  missileHud: MissileHudState;
  // Performance metrics (read by dev-only performance monitor)
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  activeProjectiles: number;
  activeParticles: number;
  activeEnemies: number;
  lastAssetLoadMs: number;
  cachedAssetCount: number;
}

export interface LoadingProgress {
  stage: string;
  percent: number;
  shipId: ShipId;
  missionCode?: string;
  missionName?: string;
  sectorName?: string;
  error?: string | null;
}

export type BotPersonality = 'aggressor' | 'flanker' | 'defender' | 'ace';

export type MissionRank = 'S' | 'A' | 'B' | 'C';

export interface ShipVisualHandle {
  group: THREE.Group;
  updateVisuals: (
    dt: number,
    speedRatio: number,
    boostIntensity: number,
    yawInput: number,
    pitchInput: number,
    rollInput: number,
  ) => void;
  setDetailLevel?: (highDetail: boolean) => void;
  dispose: () => void;
}
