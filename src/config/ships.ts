import type { GameSettings, ShipConfig, ShipId } from '../types/game';
import { STEERING_BOUNDS, STEERING_CONFIG } from './steering';

export const SHIP_CONFIGS: Record<ShipId, ShipConfig> = {
  interceptor: {
    id: 'interceptor',
    callsign: 'VX-9 VANGUARD',
    name: 'Interceptor',
    role: 'High-Speed Recon & Dogfighter',
    description:
      'Needle-profile space superiority fighter built around twin vector plasma thrusters. Unmatched acceleration, snap roll authority, and aggressive turn rate.',
    playableInPhase1: true,
    unlockNote: 'Active Flight Prototype',
    maxHull: 100,
    maxShield: 75,
    shieldRechargeDelay: 4,
    shieldRechargeRate: 8,
    ratings: {
      speed: 96,
      maneuverability: 94,
      hull: 52,
      firepower: 68,
    },
    colors: {
      hullPrimary: '#1e293b',
      hullSecondary: '#0f172a',
      hullTrim: '#38bdf8',
      canopy: '#071426',
      engineCore: '#e0f2fe',
      engineGlow: '#06b6d4',
    },
    flight: {
      maxSpeed: 135,
      maxReverseSpeed: 42,
      acceleration: 95,
      deceleration: 120,
      passiveDrag: 0.72,
      lateralGrip: 4.8,
      boostMultiplier: 1.85,
      boostAccelMultiplier: 2.35,
      maxBoostEnergy: 100,
      boostDrainRate: 26,
      boostRegenRate: 18,
      boostRegenDelay: 0.65,
      yawSpeed: 2.1,
      pitchSpeed: 1.95,
      rollSpeed: 3.1,
      angularDamping: 7.5,
      visualBankStrength: 0.34,
    },
    weapons: {
      primaryName: 'Twin Pulse Cannons',
      damageRating: 68,
      fireRateRating: 92,
    },
  },
  striker: {
    id: 'striker',
    callsign: 'SR-4 VALKYRIE',
    name: 'Striker',
    role: 'Multi-Role Assault Fighter',
    description:
      'Balanced forward-wing strike craft engineered for sustained dogfights. Combines reliable hull plating with versatile weapon hardpoints.',
    playableInPhase1: false,
    unlockNote: 'Coming Soon — Unlockable in Combat Campaign',
    maxHull: 150,
    maxShield: 110,
    shieldRechargeDelay: 4,
    shieldRechargeRate: 9,
    ratings: {
      speed: 78,
      maneuverability: 79,
      hull: 76,
      firepower: 80,
    },
    colors: {
      hullPrimary: '#273549',
      hullSecondary: '#111827',
      hullTrim: '#60a5fa',
      canopy: '#0b192c',
      engineCore: '#dbeafe',
      engineGlow: '#3b82f6',
    },
    flight: {
      maxSpeed: 118,
      maxReverseSpeed: 36,
      acceleration: 82,
      deceleration: 105,
      passiveDrag: 0.8,
      lateralGrip: 4.2,
      boostMultiplier: 1.72,
      boostAccelMultiplier: 2.1,
      maxBoostEnergy: 100,
      boostDrainRate: 28,
      boostRegenRate: 16,
      boostRegenDelay: 0.75,
      yawSpeed: 1.8,
      pitchSpeed: 1.7,
      rollSpeed: 2.55,
      angularDamping: 6.8,
      visualBankStrength: 0.28,
    },
    weapons: {
      primaryName: 'Quad Plasma Repeaters',
      damageRating: 80,
      fireRateRating: 78,
    },
  },
  destroyer: {
    id: 'destroyer',
    callsign: 'HX-12 AEGIS',
    name: 'Destroyer',
    role: 'Heavy Gunship & Breaker',
    description:
      'Armored heavy assault hull outfitted with twin rail-accelerators and triple drive cores. Built to absorb punishment and dominate fleet engagements.',
    playableInPhase1: false,
    unlockNote: 'Coming Soon — Unlockable via Mission Rank Progression',
    maxHull: 230,
    maxShield: 160,
    shieldRechargeDelay: 4.5,
    shieldRechargeRate: 10,
    ratings: {
      speed: 62,
      maneuverability: 58,
      hull: 98,
      firepower: 96,
    },
    colors: {
      hullPrimary: '#1f2937',
      hullSecondary: '#0c1220',
      hullTrim: '#0ea5e9',
      canopy: '#061322',
      engineCore: '#cffafe',
      engineGlow: '#0284c7',
    },
    flight: {
      maxSpeed: 98,
      maxReverseSpeed: 30,
      acceleration: 65,
      deceleration: 88,
      passiveDrag: 0.85,
      lateralGrip: 3.5,
      boostMultiplier: 1.62,
      boostAccelMultiplier: 1.9,
      maxBoostEnergy: 100,
      boostDrainRate: 30,
      boostRegenRate: 15,
      boostRegenDelay: 0.85,
      yawSpeed: 1.4,
      pitchSpeed: 1.32,
      rollSpeed: 1.95,
      angularDamping: 5.8,
      visualBankStrength: 0.2,
    },
    weapons: {
      primaryName: 'Dual Heavy Rail Cannons',
      damageRating: 96,
      fireRateRating: 58,
    },
  },
};

export const SHIP_ORDER: ShipId[] = ['interceptor', 'striker', 'destroyer'];

export const DEFAULT_SETTINGS: GameSettings = {
  mouseSensitivity: STEERING_CONFIG.mouseSensitivity,
  joystickRadius: STEERING_CONFIG.joystickRadius,
  deadzone: STEERING_CONFIG.deadzone,
  yawSensitivity: STEERING_CONFIG.yawRate,
  pitchSensitivity: STEERING_CONFIG.pitchRate,
  maxYawRate: STEERING_CONFIG.maxYawRate,
  maxPitchRate: STEERING_CONFIG.maxPitchRate,
  responseCurve: STEERING_CONFIG.responseCurve,
  inputSmoothing: STEERING_CONFIG.inputSmoothing,
  invertY: false,
  cameraDistance: 9.8,
  cameraSensitivity: 1.0,
  masterVolume: 0.65,
  graphicsQuality: 'high',
  resolutionScale: 1.0,
  shadowQuality: 'medium',
  particleQuality: 'high',
  environmentDetail: 'high',
  drawDistance: 4200,
  antialias: true,
  postGlowEnabled: true,
  showPerfOverlay: false,
};

const SETTINGS_STORAGE_KEY = 'starfall.settings.v9';
const LEGACY_SETTINGS_KEY_V8 = 'starfall.settings.v8';
const LEGACY_SETTINGS_KEY_V7 = 'starfall.settings.v7';
const LEGACY_SETTINGS_KEY_V6 = 'starfall.settings.v6';
const LEGACY_SETTINGS_KEY_V5 = 'starfall.settings.v5';
const LEGACY_SETTINGS_KEY_V4 = 'starfall.settings.v4';
const LEGACY_SETTINGS_KEY_V3 = 'starfall.settings.v3';
const LEGACY_SETTINGS_KEY_V2 = 'starfall.settings.v2';
const LEGACY_SETTINGS_KEY_V1 = 'starfall.settings.v1';

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

export function loadSavedSettings(): GameSettings {
  try {
    const rawV9 = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const raw =
      rawV9 ??
      window.localStorage.getItem(LEGACY_SETTINGS_KEY_V8) ??
      window.localStorage.getItem(LEGACY_SETTINGS_KEY_V7) ??
      window.localStorage.getItem(LEGACY_SETTINGS_KEY_V6) ??
      window.localStorage.getItem(LEGACY_SETTINGS_KEY_V5) ??
      window.localStorage.getItem(LEGACY_SETTINGS_KEY_V4) ??
      window.localStorage.getItem(LEGACY_SETTINGS_KEY_V3) ??
      window.localStorage.getItem(LEGACY_SETTINGS_KEY_V2) ??
      window.localStorage.getItem(LEGACY_SETTINGS_KEY_V1);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    const validQuality =
      parsed.graphicsQuality === 'low' ||
      parsed.graphicsQuality === 'medium' ||
      parsed.graphicsQuality === 'high' ||
      parsed.graphicsQuality === 'ultra'
        ? parsed.graphicsQuality
        : DEFAULT_SETTINGS.graphicsQuality;

    // When migrating from pre-v9 storage, apply the calibrated direct nonlinear steering defaults
    // while preserving user aim boundary size, graphics, audio, camera, and invertY preferences.
    const mouseSensitivity = rawV9
      ? clampNumber(
          parsed.mouseSensitivity,
          STEERING_BOUNDS.mouseSensitivity.min,
          STEERING_BOUNDS.mouseSensitivity.max,
          DEFAULT_SETTINGS.mouseSensitivity,
        )
      : DEFAULT_SETTINGS.mouseSensitivity;

    const joystickRadius = clampNumber(
      parsed.joystickRadius,
      STEERING_BOUNDS.joystickRadius.min,
      STEERING_BOUNDS.joystickRadius.max,
      DEFAULT_SETTINGS.joystickRadius,
    );

    const deadzone = rawV9
      ? clampNumber(
          parsed.deadzone,
          STEERING_BOUNDS.deadzone.min,
          STEERING_BOUNDS.deadzone.max,
          DEFAULT_SETTINGS.deadzone,
        )
      : DEFAULT_SETTINGS.deadzone;

    const yawSensitivity = rawV9
      ? clampNumber(
          parsed.yawSensitivity,
          STEERING_BOUNDS.yawSensitivity.min,
          STEERING_BOUNDS.yawSensitivity.max,
          DEFAULT_SETTINGS.yawSensitivity,
        )
      : DEFAULT_SETTINGS.yawSensitivity;

    const pitchSensitivity = rawV9
      ? clampNumber(
          parsed.pitchSensitivity,
          STEERING_BOUNDS.pitchSensitivity.min,
          STEERING_BOUNDS.pitchSensitivity.max,
          DEFAULT_SETTINGS.pitchSensitivity,
        )
      : DEFAULT_SETTINGS.pitchSensitivity;

    const maxYawRate = rawV9
      ? clampNumber(
          parsed.maxYawRate,
          STEERING_BOUNDS.maxYawRate.min,
          STEERING_BOUNDS.maxYawRate.max,
          DEFAULT_SETTINGS.maxYawRate,
        )
      : DEFAULT_SETTINGS.maxYawRate;

    const maxPitchRate = rawV9
      ? clampNumber(
          parsed.maxPitchRate,
          STEERING_BOUNDS.maxPitchRate.min,
          STEERING_BOUNDS.maxPitchRate.max,
          DEFAULT_SETTINGS.maxPitchRate,
        )
      : DEFAULT_SETTINGS.maxPitchRate;

    const responseCurve = rawV9
      ? clampNumber(
          parsed.responseCurve,
          STEERING_BOUNDS.responseCurve.min,
          STEERING_BOUNDS.responseCurve.max,
          DEFAULT_SETTINGS.responseCurve,
        )
      : DEFAULT_SETTINGS.responseCurve;

    const inputSmoothing = rawV9
      ? clampNumber(
          parsed.inputSmoothing,
          STEERING_BOUNDS.inputSmoothing.min,
          STEERING_BOUNDS.inputSmoothing.max,
          DEFAULT_SETTINGS.inputSmoothing,
        )
      : DEFAULT_SETTINGS.inputSmoothing;

    return {
      ...DEFAULT_SETTINGS,
      invertY: typeof parsed.invertY === 'boolean' ? parsed.invertY : DEFAULT_SETTINGS.invertY,
      cameraDistance: clampNumber(parsed.cameraDistance, 7.2, 13.5, DEFAULT_SETTINGS.cameraDistance),
      cameraSensitivity: clampNumber(
        parsed.cameraSensitivity,
        0.6,
        1.6,
        DEFAULT_SETTINGS.cameraSensitivity,
      ),
      masterVolume: clampNumber(parsed.masterVolume, 0, 1, DEFAULT_SETTINGS.masterVolume),
      mouseSensitivity,
      joystickRadius,
      deadzone,
      yawSensitivity,
      pitchSensitivity,
      maxYawRate,
      maxPitchRate,
      responseCurve,
      inputSmoothing,
      graphicsQuality: validQuality,
      resolutionScale: clampNumber(
        parsed.resolutionScale,
        0.65,
        1.0,
        DEFAULT_SETTINGS.resolutionScale,
      ),
      shadowQuality:
        parsed.shadowQuality === 'off' ||
        parsed.shadowQuality === 'low' ||
        parsed.shadowQuality === 'medium' ||
        parsed.shadowQuality === 'high'
          ? parsed.shadowQuality
          : DEFAULT_SETTINGS.shadowQuality,
      particleQuality:
        parsed.particleQuality === 'low' ||
        parsed.particleQuality === 'medium' ||
        parsed.particleQuality === 'high'
          ? parsed.particleQuality
          : DEFAULT_SETTINGS.particleQuality,
      environmentDetail:
        parsed.environmentDetail === 'low' ||
        parsed.environmentDetail === 'medium' ||
        parsed.environmentDetail === 'high'
          ? parsed.environmentDetail
          : DEFAULT_SETTINGS.environmentDetail,
      drawDistance: clampNumber(parsed.drawDistance, 2000, 5200, DEFAULT_SETTINGS.drawDistance),
      antialias: typeof parsed.antialias === 'boolean' ? parsed.antialias : DEFAULT_SETTINGS.antialias,
      postGlowEnabled:
        typeof parsed.postGlowEnabled === 'boolean'
          ? parsed.postGlowEnabled
          : DEFAULT_SETTINGS.postGlowEnabled,
      showPerfOverlay: import.meta.env.DEV ? Boolean(parsed.showPerfOverlay) : false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}
