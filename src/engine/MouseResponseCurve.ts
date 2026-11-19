import * as THREE from 'three';
import { DIRECT_MOUSE_STEERING_CONFIG, STEERING_BOUNDS } from '../config/steering';

/**
 * Independent parameters for STARFALL's direct arcade nonlinear mouse response curve.
 * Every behavioral dimension is kept separate—no single multiplier conflates curve shape,
 * base sensitivity, axis balance, angular ceilings, or smoothing.
 */
export interface DirectMouseCurveParams {
  /** Base mouse sensitivity multiplier (scales normalized input speed) */
  mouseSensitivity: number;
  /** Nonlinear response curve exponent (1.0 = pure linear, >1.0 = precision + fast turn) */
  responseCurve: number;
  /** Low-speed linear precision floor `a` in `g(u) = a*u + (1-a)*u^p` */
  precisionLinearBlend: number;
  /** C2-continuous soft saturation knee in (0, 1) */
  softSaturationKnee: number;
  /** Reference mouse speed (px/s) where normalized input u = 1.0 at sensitivity 1.0 */
  inputNormalizationRange: number;
  /** Independent horizontal yaw sensitivity balance */
  yawSensitivity: number;
  /** Independent vertical pitch sensitivity balance */
  pitchSensitivity: number;
  /** Independent maximum yaw angular rate ceiling (rad/s) */
  maxYawRate: number;
  /** Independent maximum pitch angular rate ceiling (rad/s) */
  maxPitchRate: number;
  /** Invert vertical pitch axis */
  invertY: boolean;
}

/**
 * Zero-allocation output structure for per-frame direct mouse steering evaluation.
 */
export interface DirectMouseEvaluation {
  /** Instantaneous frame-rate-independent mouse speed magnitude in CSS px/s */
  speedPxPerSec: number;
  /** Normalized mouse speed `u = (speedPxPerSec * mouseSensitivity) / inputNormalizationRange` */
  normalizedInput: number;
  /** Unbounded nonlinear gain `g(u)` prior to axis balance & soft saturation */
  curveGain: number;
  /** Soft-saturated normalized horizontal steering demand in [-1, 1] */
  steerYaw: number;
  /** Soft-saturated normalized vertical steering demand in [-1, 1] */
  steerPitch: number;
  /** Target yaw angular rate in rad/s (capped smoothly at ±maxYawRate) */
  targetYawRate: number;
  /** Target pitch angular rate in rad/s (capped smoothly at ±maxPitchRate) */
  targetPitchRate: number;
}

export function createDirectMouseEvaluation(): DirectMouseEvaluation {
  return {
    speedPxPerSec: 0,
    normalizedInput: 0,
    curveGain: 0,
    steerYaw: 0,
    steerPitch: 0,
    targetYawRate: 0,
    targetPitchRate: 0,
  };
}

/**
 * C2-continuous signed soft saturation into (-1, +1).
 *
 * - For `|x| <= knee`: exact identity `x` (zero distortion in precision & medium ranges).
 * - For `|x| > knee`: `sign(x) * (knee + (1 - knee) * tanh((|x| - knee) / (1 - knee)))`.
 *   Matches value (knee), first derivative (1.0), and second derivative (0.0) at `|x| = knee`,
 *   eliminating any abrupt clipping corner or sudden spike as turn rate approaches ceiling.
 */
export function softSaturateSigned(
  value: number,
  knee: number = DIRECT_MOUSE_STEERING_CONFIG.softSaturationKnee,
): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const k = THREE.MathUtils.clamp(knee, 0.5, 0.98);
  const absVal = Math.abs(value);
  if (absVal <= k) return value;

  const headroom = 1 - k;
  const excess = (absVal - k) / headroom;
  const saturated = k + headroom * Math.tanh(excess);
  return value < 0 ? -saturated : saturated;
}

/**
 * Continuous monotonic nonlinear gain function `g(u)` for normalized input speed `u >= 0`:
 *
 *   `g(u) = a * u + (1 - a) * u^p`
 *
 * Properties:
 * - `g(0) = 0`, `g'(0) = a`: Small mouse movements produce subtle, predictable precision
 *   rotation rather than dropping into a deadzone.
 * - Strictly smooth (`C∞` for `u > 0`), monotonically increasing derivative for `p > 1`:
 *   Medium movements progressively accelerate steering response with zero jumps or knees.
 * - Anchored at `g(1) = 1` for all `p` and `a`: Changing curve exponent reshapes the
 *   precision-to-fast-turn progression cleanly without shifting the reference anchor.
 * - Reduces exactly to linear `g(u) = u` when `p = 1.0`.
 */
export function evaluateNonlinearGain(
  normalizedInput: number,
  responseCurve: number = DIRECT_MOUSE_STEERING_CONFIG.responseCurve,
  precisionLinearBlend: number = DIRECT_MOUSE_STEERING_CONFIG.precisionLinearBlend,
): number {
  if (!Number.isFinite(normalizedInput) || normalizedInput <= 0) return 0;

  const p = THREE.MathUtils.clamp(
    responseCurve,
    STEERING_BOUNDS.responseCurve.min,
    STEERING_BOUNDS.responseCurve.max,
  );
  const a = THREE.MathUtils.clamp(precisionLinearBlend, 0.05, 0.95);

  if (Math.abs(p - 1.0) < 1e-4) {
    return normalizedInput;
  }
  return a * normalizedInput + (1 - a) * Math.pow(normalizedInput, p);
}

/**
 * Scalar convenience evaluator combining `evaluateNonlinearGain` and `softSaturateSigned`.
 * Used for both verification and the Settings Panel live curve visualization.
 */
export function evaluateDirectMouseCurveScalar(
  normalizedInput: number,
  responseCurve: number = DIRECT_MOUSE_STEERING_CONFIG.responseCurve,
  precisionLinearBlend: number = DIRECT_MOUSE_STEERING_CONFIG.precisionLinearBlend,
  softSaturationKnee: number = DIRECT_MOUSE_STEERING_CONFIG.softSaturationKnee,
): number {
  if (!Number.isFinite(normalizedInput) || normalizedInput <= 0) return 0;
  const gain = evaluateNonlinearGain(normalizedInput, responseCurve, precisionLinearBlend);
  return softSaturateSigned(gain, softSaturationKnee);
}

/**
 * Evaluates raw Pointer Lock mouse deltas (`movementX`, `movementY`) over frame delta `dt`
 * into frame-rate-independent target yaw and pitch angular rates (rad/s).
 *
 * Frame-Rate Independence:
 *   Converts per-frame pixel deltas to instantaneous mouse speed `px/s` using clamped
 *   `velDt = max(dt, 1/240)` before applying the nonlinear curve, ensuring consistent
 *   angular response across 30, 60, 120, and 144+ FPS displays.
 *
 * Zero-Input Guarantee:
 *   When `mouseDeltaX === 0 && mouseDeltaY === 0`, outputs exact zeros across all fields.
 */
export function evaluateDirectMouseSteering(
  mouseDeltaX: number,
  mouseDeltaY: number,
  dt: number,
  params: DirectMouseCurveParams,
  out: DirectMouseEvaluation = createDirectMouseEvaluation(),
): DirectMouseEvaluation {
  const dx = Number.isFinite(mouseDeltaX) ? mouseDeltaX : 0;
  const dy = Number.isFinite(mouseDeltaY) ? mouseDeltaY : 0;

  if (dx === 0 && dy === 0) {
    out.speedPxPerSec = 0;
    out.normalizedInput = 0;
    out.curveGain = 0;
    out.steerYaw = 0;
    out.steerPitch = 0;
    out.targetYawRate = 0;
    out.targetPitchRate = 0;
    return out;
  }

  // Guard against sub-4ms synthetic dt spikes while staying exact at 30-240 FPS
  const velDt = Math.max(dt, 1 / 240);
  const ySign = params.invertY ? -1 : 1;

  const vx = dx / velDt;
  const vy = (dy * ySign) / velDt;
  const vMag = Math.hypot(vx, vy);

  if (vMag <= 1e-6) {
    out.speedPxPerSec = 0;
    out.normalizedInput = 0;
    out.curveGain = 0;
    out.steerYaw = 0;
    out.steerPitch = 0;
    out.targetYawRate = 0;
    out.targetPitchRate = 0;
    return out;
  }

  const ux = vx / vMag;
  const uy = vy / vMag;

  const baseSens = THREE.MathUtils.clamp(
    params.mouseSensitivity,
    STEERING_BOUNDS.mouseSensitivity.min,
    STEERING_BOUNDS.mouseSensitivity.max,
  );
  const normRange = Math.max(100, params.inputNormalizationRange);
  const u = (vMag * baseSens) / normRange;

  const gain = evaluateNonlinearGain(u, params.responseCurve, params.precisionLinearBlend);

  const yawSens = THREE.MathUtils.clamp(
    params.yawSensitivity,
    STEERING_BOUNDS.yawSensitivity.min,
    STEERING_BOUNDS.yawSensitivity.max,
  );
  const pitchSens = THREE.MathUtils.clamp(
    params.pitchSensitivity,
    STEERING_BOUNDS.pitchSensitivity.min,
    STEERING_BOUNDS.pitchSensitivity.max,
  );

  // Moving mouse right (+vx) yaws ship right (-Y rotation); moving mouse up (-vy) pitches nose up (+X rotation)
  const rawYaw = -ux * gain * yawSens;
  const rawPitch = -uy * gain * pitchSens;

  const steerYaw = softSaturateSigned(rawYaw, params.softSaturationKnee);
  const steerPitch = softSaturateSigned(rawPitch, params.softSaturationKnee);

  const maxYaw = Math.max(0.1, params.maxYawRate);
  const maxPitch = Math.max(0.1, params.maxPitchRate);

  out.speedPxPerSec = vMag;
  out.normalizedInput = u;
  out.curveGain = gain;
  out.steerYaw = steerYaw;
  out.steerPitch = steerPitch;
  out.targetYawRate = steerYaw * maxYaw;
  out.targetPitchRate = steerPitch * maxPitch;
  return out;
}

/**
 * Optional minimal exponential input smoothing with crisp stop-settling, zero reversal lag,
 * and single-frame browser event-coalescing continuity.
 *
 * - `inputSmoothing <= 0.001` (when not bridging an intra-drag coalescing tick):
 *   Zero lag, direct pass-through (`return targetRate`).
 * - `inputSmoothing > 0.001`: Ultra-light exponential filter (`tau = inputSmoothing * 0.05s`).
 *   At default `0.04`, `tau = 2ms`.
 * - Single-frame event-coalescing bridge (`isCoalescingGap === true`):
 *   When a high-refresh render frame fires between two physical `mousemove` packets during
 *   continuous mouse movement (`< 18ms` since the last non-zero delta), uses a short 22ms
 *   continuity decay instead of slamming angular velocity to `0` on that single frame.
 * - When `targetRate === 0` and `isCoalescingGap === false` (mouse input actually stopped),
 *   applies `stopDecayMultiplier` (4.5x faster decay) and snaps residual rates `< 0.02 rad/s`
 *   immediately to exact `0` so stopping the mouse never accumulates unwanted drift or inertia.
 * - When reversing direction (`targetRate * currentRate < 0`), clears opposite-sign velocity
 *   immediately so counter-corrections never fight leftover momentum from the prior direction.
 */
export function stepDirectAngularRate(
  currentRate: number,
  targetRate: number,
  inputSmoothing: number,
  dt: number,
  isCoalescingGap = false,
): number {
  const smooth = THREE.MathUtils.clamp(
    inputSmoothing,
    STEERING_BOUNDS.inputSmoothing.min,
    STEERING_BOUNDS.inputSmoothing.max,
  );

  if (targetRate === 0 && isCoalescingGap) {
    // Bridge a single-frame browser mousemove dispatch gap during an active drag without adding inertia
    const bridgeTau = 0.022;
    const alpha = 1 - Math.exp(-dt / bridgeTau);
    return currentRate * (1 - alpha);
  }

  if (smooth <= 0.001) {
    return targetRate;
  }

  const baseTau = smooth * DIRECT_MOUSE_STEERING_CONFIG.smoothingMaxTauSec;
  const isStopping = targetRate === 0;
  const isReversing = targetRate * currentRate < 0;
  const baseCurrent = isReversing ? 0 : currentRate;
  const effectiveTau = isStopping
    ? baseTau / DIRECT_MOUSE_STEERING_CONFIG.stopDecayMultiplier
    : isReversing
      ? baseTau * 0.5
      : baseTau;

  const alpha = 1 - Math.exp(-dt / Math.max(effectiveTau, 1e-4));
  const next = baseCurrent + (targetRate - baseCurrent) * alpha;

  if (isStopping && Math.abs(next) < 0.02) {
    return 0;
  }
  return next;
}
