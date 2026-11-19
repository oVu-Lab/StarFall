/**
 * Centralized steering configuration for STARFALL.
 *
 * Preserves two cleanly separated configurations:
 * 1. `BASELINE_STEERING_CONFIG` — exact pre-calibration baseline preserved verbatim so this
 *    calibration can be reverted independently by switching `steeringMode`.
 * 2. `DIRECT_MOUSE_STEERING_CONFIG` — Precision + Fast Turning direct arcade mouse steering
 *    calibration using a continuous nonlinear mouse response curve with independent parameters.
 *
 * Aim Boundary Geometry (`aimBoundaryWidth`, `aimBoundaryHeight`, `aimBoundaryCornerRadius`)
 * remains strictly independent of the mouse response curve.
 */

export type SteeringMode = 'mouse-alignment' | 'direct-nonlinear' | 'virtual-joystick-baseline';

/**
 * Mouse-to-Reticle Alignment steering model (active default).
 *
 *   V  virtualMousePosition: accumulated movementX/Y (CSS px from viewport center). Never
 *      clamped, reset, or modified by camera movement.
 *   R  aim reticle: the active cannon ray projected through the active chase camera. It is a
 *      real 3D direction, not a visual interpolation proxy, and is constrained by the aim region.
 *   e  steeringError = clampToAimRegion(V) - R in the same CSS-pixel screen plane. V itself is
 *      kept unbounded; its boundary projection supplies a reachable directional target.
 *   The ray is mounted in ship local space, so genuine ship rotation changes R; FlightController
 *   then reprojects it through the camera after its chase interpolation has completed.
 *   d(m) = m^2 / (m + deadzonePx)  smooth soft deadzone (C-inf, no cutoff)
 *   n = d(|e|) / (alignmentReferenceFraction * viewportHeight)
 *   s(n) = tanh(n * (alignmentLinearGain + alignmentQuadGain * n))
 *   target rate = maxRate * s(n) * e/|e|
 */
export const MOUSE_ALIGNMENT_CONFIG = {
  /** Fraction of physical Pointer Lock motion immediately applied to the cannon reticle. */
  reticleInputGain: 0.12,
  /** Fraction of each real airframe yaw/pitch step transferred into the physical cannon gimbal. */
  gimbalRotationGain: 0.06,
  /** Distance used for camera-to-weapon screen-ray conversion; matches player cannon convergence. */
  projectionDistance: 240,
  /** Overshoot distance (fraction of viewport height) that maps to n = 1 */
  alignmentReferenceFraction: 0.26,
  /** Soft error deadzone (px): errors well below this produce almost no steering, smoothly */
  alignmentErrorDeadzonePx: 0.5,
  /** s'(0): slope of the demand curve at the boundary (precise, continuous onset) */
  alignmentLinearGain: 1.0,
  /** Extra quadratic growth of demand with distance (progressive strength) */
  alignmentQuadGain: 0.9,
  /** First-order rate smoothing time constant (s) */
  alignmentRateTauSec: 0.045,
} as const;

/**
 * Exact pre-calibration baseline preserved for independent rollback.
 */
export const BASELINE_STEERING_CONFIG = {
  aimBoundaryWidth: 0.3,
  aimBoundaryHeight: 0.35,
  aimBoundaryCornerRadius: 0.3,
  mouseSensitivity: 1.0,
  baseMouseSensitivity: 0.0022,
  stickSelfCenterRate: 10.0,
  maxStickDeflection: 1.0,
  joystickRadius: 1.0,
  deadzone: 0.06,
  precisionSensitivity: 0.85,
  maxSteeringInput: 1.0,
  responseCurve: 1.35,
  yawRate: 1.0,
  pitchRate: 0.9,
  angularAcceleration: 18.0,
  angularDamping: 14.0,
  stoppingDampingBoost: 1.25,
  referenceViewportHeight: 720,
  maxSafeYawMultiplier: 2.0,
  maxSafePitchMultiplier: 2.0,
} as const;

/**
 * Calibrated Direct Arcade Mouse Steering profile (Precision + Fast Turning).
 *
 * Input Normalization Range:
 *   `inputNormalizationRange = 750 px/s` (12.5 px/frame at 60 FPS).
 *   Instantaneous mouse speed `v = hypot(movementX, movementY) / dt` is normalized as:
 *     `u = (v * mouseSensitivity) / inputNormalizationRange`
 *
 * Nonlinear Response Curve:
 *   `g(u) = precisionLinearBlend * u + (1 - precisionLinearBlend) * u^responseCurve`
 *   followed by independent yaw/pitch balance and C2-continuous soft saturation
 *   (knee = `softSaturationKnee`) into `[-1, +1]`, then multiplied by independent
 *   `maxYawRate` and `maxPitchRate` ceilings.
 *
 * Strictly Independent Parameters:
 *   1. `mouseSensitivity`        — Base mouse sensitivity multiplier
 *   2. `responseCurve`           — Nonlinear response curve exponent (`1.0` = linear)
 *   3. `precisionLinearBlend`    — Subtle low-speed linear floor for micro-aim predictability
 *   4. `maxYawRate`              — Independent maximum yaw angular speed ceiling (rad/s, ref hull)
 *   5. `maxPitchRate`            — Independent maximum pitch angular speed ceiling (rad/s, ref hull)
 *   6. `yawRate` / `pitchRate`   — Independent yaw/pitch sensitivity balance multipliers
 *   7. `inputSmoothing`          — Optional minimal smoothing (`0` = instant, fast stop decay)
 */
export const DIRECT_MOUSE_STEERING_CONFIG = {
  /** Active steering pipeline mode (switch to 'virtual-joystick-baseline' to revert independently) */
  steeringMode: 'direct-nonlinear' as SteeringMode,

  /** Documented input normalization reference speed in CSS px/s (12.5 px/frame at 60 FPS for continuous steering) */
  inputNormalizationRange: 750,

  /** Base mouse sensitivity multiplier applied to normalized mouse speed */
  mouseSensitivity: 1.0,

  /** Nonlinear response curve exponent (1.0 = pure linear, >1.0 = fine low-speed + fast large turns) */
  responseCurve: 2.15,

  /** Low-speed linear precision floor `a` in `g(u) = a*u + (1-a)*u^p` (prevents dead micro-aim without center jump) */
  precisionLinearBlend: 0.05,

  /** C2-continuous soft saturation knee before reaching 1.0 ceiling (zero abrupt transitions) */
  softSaturationKnee: 0.85,

  /** Independent maximum yaw angular rate for reference Interceptor hull (rad/s, ~149 deg/s) */
  maxYawRate: 2.6,

  /** Independent maximum pitch angular rate for reference Interceptor hull (rad/s, ~129 deg/s) */
  maxPitchRate: 2.25,

  /** Independent horizontal yaw sensitivity balance */
  yawRate: 1.0,

  /** Independent vertical pitch sensitivity balance */
  pitchRate: 0.9,

  /** Optional minimal input smoothing (0 = off/instant, 0.04 = 2ms micro-jitter filter with instant stop) */
  inputSmoothing: 0.04,

  /** Maximum smoothing time constant (seconds) at inputSmoothing = 1.0 */
  smoothingMaxTauSec: 0.05,

  /** Extra stop-speed multiplier when mouse input ceases so rotation halts cleanly with zero drift */
  stopDecayMultiplier: 4.5,

  /** Reference Interceptor hull base rates used to preserve Striker / Destroyer class scaling */
  referenceInterceptorYawSpeed: 2.1,
  referenceInterceptorPitchSpeed: 1.95,
} as const;

export const STEERING_CONFIG = {
  // Independent aim boundary geometry (decoupled from mouse response curve)
  aimBoundaryWidth: BASELINE_STEERING_CONFIG.aimBoundaryWidth,
  aimBoundaryHeight: BASELINE_STEERING_CONFIG.aimBoundaryHeight,
  aimBoundaryCornerRadius: BASELINE_STEERING_CONFIG.aimBoundaryCornerRadius,
  joystickRadius: BASELINE_STEERING_CONFIG.joystickRadius,

  // Active direct nonlinear steering calibration
  steeringMode: 'mouse-alignment' as SteeringMode,
  inputNormalizationRange: DIRECT_MOUSE_STEERING_CONFIG.inputNormalizationRange,
  mouseSensitivity: DIRECT_MOUSE_STEERING_CONFIG.mouseSensitivity,
  responseCurve: DIRECT_MOUSE_STEERING_CONFIG.responseCurve,
  precisionLinearBlend: DIRECT_MOUSE_STEERING_CONFIG.precisionLinearBlend,
  softSaturationKnee: DIRECT_MOUSE_STEERING_CONFIG.softSaturationKnee,
  maxYawRate: DIRECT_MOUSE_STEERING_CONFIG.maxYawRate,
  maxPitchRate: DIRECT_MOUSE_STEERING_CONFIG.maxPitchRate,
  yawRate: DIRECT_MOUSE_STEERING_CONFIG.yawRate,
  pitchRate: DIRECT_MOUSE_STEERING_CONFIG.pitchRate,
  inputSmoothing: DIRECT_MOUSE_STEERING_CONFIG.inputSmoothing,
  smoothingMaxTauSec: DIRECT_MOUSE_STEERING_CONFIG.smoothingMaxTauSec,
  stopDecayMultiplier: DIRECT_MOUSE_STEERING_CONFIG.stopDecayMultiplier,
  referenceInterceptorYawSpeed: DIRECT_MOUSE_STEERING_CONFIG.referenceInterceptorYawSpeed,
  referenceInterceptorPitchSpeed: DIRECT_MOUSE_STEERING_CONFIG.referenceInterceptorPitchSpeed,

  // Preserved baseline parameters (used only if steeringMode === 'virtual-joystick-baseline')
  baseMouseSensitivity: BASELINE_STEERING_CONFIG.baseMouseSensitivity,
  stickSelfCenterRate: BASELINE_STEERING_CONFIG.stickSelfCenterRate,
  maxStickDeflection: BASELINE_STEERING_CONFIG.maxStickDeflection,
  deadzone: BASELINE_STEERING_CONFIG.deadzone,
  precisionSensitivity: BASELINE_STEERING_CONFIG.precisionSensitivity,
  maxSteeringInput: BASELINE_STEERING_CONFIG.maxSteeringInput,
  angularAcceleration: BASELINE_STEERING_CONFIG.angularAcceleration,
  angularDamping: BASELINE_STEERING_CONFIG.angularDamping,
  stoppingDampingBoost: BASELINE_STEERING_CONFIG.stoppingDampingBoost,
  referenceViewportHeight: BASELINE_STEERING_CONFIG.referenceViewportHeight,
  maxSafeYawMultiplier: BASELINE_STEERING_CONFIG.maxSafeYawMultiplier,
  maxSafePitchMultiplier: BASELINE_STEERING_CONFIG.maxSafePitchMultiplier,
} as const;

export const STEERING_BOUNDS = {
  aimBoundaryWidth: { min: 0.16, max: 0.6 },
  aimBoundaryHeight: { min: 0.18, max: 0.65 },
  aimBoundaryCornerRadius: { min: 0.05, max: 0.9 },
  mouseSensitivity: { min: 0.3, max: 2.5 },
  stickSelfCenterRate: { min: 2.0, max: 24.0 },
  maxStickDeflection: { min: 0.5, max: 1.5 },
  joystickRadius: { min: 0.65, max: 1.5 },
  deadzone: { min: 0.0, max: 0.2 },
  precisionSensitivity: { min: 0.4, max: 1.2 },
  maxSteeringInput: { min: 0.5, max: 1.25 },
  responseCurve: { min: 1.0, max: 2.6 },
  maxYawRate: { min: 1.5, max: 5.5 },
  maxPitchRate: { min: 1.5, max: 5.0 },
  yawSensitivity: { min: 0.4, max: 1.8 },
  pitchSensitivity: { min: 0.4, max: 1.8 },
  inputSmoothing: { min: 0.0, max: 0.4 },
} as const;
