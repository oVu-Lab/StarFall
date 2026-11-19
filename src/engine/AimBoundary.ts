import * as THREE from 'three';
import { STEERING_BOUNDS, STEERING_CONFIG } from '../config/steering';
import type { SteeringZone } from '../types/game';

/**
 * Exact viewport-relative centered rounded-rectangle boundary geometry
 * for STARFALL's Virtual Joystick mouse flight control.
 * Centered at (0, 0) in game viewport CSS pixel offset coordinates.
 */
export interface RoundedRectBoundary {
  viewportWidth: number;
  viewportHeight: number;
  widthFraction: number;
  heightFraction: number;
  cornerRadiusRatio: number;
  widthPx: number;
  heightPx: number;
  halfW: number;
  halfH: number;
  cornerRadiusPx: number;
  innerHalfW: number;
  innerHalfH: number;
}

/**
 * Result of clamping a candidate virtual joystick displacement onto the centered
 * rounded-rectangle boundary (bounded logical displacement with C1-continuous corners).
 */
export interface RoundedRectClampResult {
  /** Clamped virtual joystick offset from viewport center in CSS pixels */
  clampedX: number;
  clampedY: number;
  /** True when the candidate displacement lay strictly inside or on the boundary */
  inside: boolean;
  /** Signed Euclidean distance to the rounded-rectangle perimeter in px (<= 0 inside, > 0 outside) */
  signedDistance: number;
  /** Clamped normalized deflection relative to halfW / halfH in [-1, 1] */
  normalizedX: number;
  normalizedY: number;
  /** Viewport-normalized [0..1] screen position of the virtual joystick reticle */
  screenX: number;
  screenY: number;
}

/**
 * Output of the smooth radial Virtual Joystick response evaluator.
 */
export interface VirtualJoystickEvaluation {
  /** Exact normalized radial displacement r in [0, 1] along the ray to the rounded-rect perimeter */
  radialMagnitude: number;
  /** Shaped steering magnitude in [0, maxSteeringInput] after deadzone and smooth response curve */
  steeringMagnitude: number;
  /** Final normalized horizontal steering output in [-maxSteeringInput, maxSteeringInput] */
  steerX: number;
  /** Final normalized vertical steering output in [-maxSteeringInput, maxSteeringInput] */
  steerY: number;
  /** Active virtual joystick region */
  zone: SteeringZone;
}

export function createRoundedRectBoundary(): RoundedRectBoundary {
  const vw = 1280;
  const vh = 720;
  const widthPx = vw * STEERING_CONFIG.aimBoundaryWidth;
  const heightPx = vh * STEERING_CONFIG.aimBoundaryHeight;
  const halfW = widthPx * 0.5;
  const halfH = heightPx * 0.5;
  const cornerRadiusPx = Math.min(halfW, halfH) * STEERING_CONFIG.aimBoundaryCornerRadius;

  return {
    viewportWidth: vw,
    viewportHeight: vh,
    widthFraction: STEERING_CONFIG.aimBoundaryWidth,
    heightFraction: STEERING_CONFIG.aimBoundaryHeight,
    cornerRadiusRatio: STEERING_CONFIG.aimBoundaryCornerRadius,
    widthPx,
    heightPx,
    halfW,
    halfH,
    cornerRadiusPx,
    innerHalfW: Math.max(0, halfW - cornerRadiusPx),
    innerHalfH: Math.max(0, halfH - cornerRadiusPx),
  };
}

export function createRoundedRectClampResult(): RoundedRectClampResult {
  return {
    clampedX: 0,
    clampedY: 0,
    inside: true,
    signedDistance: 0,
    normalizedX: 0,
    normalizedY: 0,
    screenX: 0.5,
    screenY: 0.5,
  };
}

export function createVirtualJoystickEvaluation(): VirtualJoystickEvaluation {
  return {
    radialMagnitude: 0,
    steeringMagnitude: 0,
    steerX: 0,
    steerY: 0,
    zone: 'deadzone',
  };
}

/**
 * Computes exact rounded-rectangle boundary dimensions for the current viewport (W x H).
 * Base profile (joystickRadius = 1.0):
 *   width  = 30% of viewport width  (halfW = 0.150 * W)
 *   height = 35% of viewport height (halfH = 0.175 * H)
 *   cornerRadius = 0.30 * min(halfW, halfH)
 */
export function computeRoundedRectBoundary(
  viewportWidth: number,
  viewportHeight: number,
  joystickRadius: number = STEERING_CONFIG.joystickRadius,
  baseWidthFraction: number = STEERING_CONFIG.aimBoundaryWidth,
  baseHeightFraction: number = STEERING_CONFIG.aimBoundaryHeight,
  cornerRadiusRatio: number = STEERING_CONFIG.aimBoundaryCornerRadius,
  out: RoundedRectBoundary = createRoundedRectBoundary(),
): RoundedRectBoundary {
  const vw = Math.max(1, Number.isFinite(viewportWidth) ? viewportWidth : 1280);
  const vh = Math.max(1, Number.isFinite(viewportHeight) ? viewportHeight : 720);

  const radiusScale = THREE.MathUtils.clamp(
    joystickRadius,
    STEERING_BOUNDS.joystickRadius.min,
    STEERING_BOUNDS.joystickRadius.max,
  );
  const wf = THREE.MathUtils.clamp(
    baseWidthFraction * radiusScale,
    STEERING_BOUNDS.aimBoundaryWidth.min,
    STEERING_BOUNDS.aimBoundaryWidth.max,
  );
  const hf = THREE.MathUtils.clamp(
    baseHeightFraction * radiusScale,
    STEERING_BOUNDS.aimBoundaryHeight.min,
    STEERING_BOUNDS.aimBoundaryHeight.max,
  );
  const rRatio = THREE.MathUtils.clamp(
    cornerRadiusRatio,
    STEERING_BOUNDS.aimBoundaryCornerRadius.min,
    STEERING_BOUNDS.aimBoundaryCornerRadius.max,
  );

  const widthPx = vw * wf;
  const heightPx = vh * hf;
  const halfW = widthPx * 0.5;
  const halfH = heightPx * 0.5;
  const cornerRadiusPx = Math.min(halfW, halfH) * rRatio;

  out.viewportWidth = vw;
  out.viewportHeight = vh;
  out.widthFraction = wf;
  out.heightFraction = hf;
  out.cornerRadiusRatio = rRatio;
  out.widthPx = widthPx;
  out.heightPx = heightPx;
  out.halfW = halfW;
  out.halfH = halfH;
  out.cornerRadiusPx = cornerRadiusPx;
  out.innerHalfW = Math.max(0, halfW - cornerRadiusPx);
  out.innerHalfH = Math.max(0, halfH - cornerRadiusPx);
  return out;
}

/**
 * C1-continuous closest-point projection of a candidate virtual joystick displacement
 * onto the centered rounded-rectangle boundary.
 *
 * - Inside the rounded rectangle: displacement is kept directly.
 * - Outside straight edges: clamped perpendicularly to the edge so parallel sliding stays smooth.
 * - Outside rounded corners: projected orthogonally onto the circular corner arc (zero snapping).
 */
export function clampToRoundedRect(
  rawX: number,
  rawY: number,
  boundary: RoundedRectBoundary,
  out: RoundedRectClampResult = createRoundedRectClampResult(),
): RoundedRectClampResult {
  const {
    halfW,
    halfH,
    cornerRadiusPx: r,
    innerHalfW,
    innerHalfH,
    viewportWidth,
    viewportHeight,
  } = boundary;

  const ax = Math.abs(rawX);
  const ay = Math.abs(rawY);
  const sx = rawX < 0 ? -1 : 1;
  const sy = rawY < 0 ? -1 : 1;

  const qx = ax - innerHalfW;
  const qy = ay - innerHalfH;

  // Exact Euclidean rounded-rectangle signed distance field (<= 0 inside, > 0 outside)
  const outX = qx > 0 ? qx : 0;
  const outY = qy > 0 ? qy : 0;
  const outLen = Math.hypot(outX, outY);
  const inDist = Math.min(Math.max(qx, qy), 0);
  const sdf = outLen + inDist - r;

  let clampedX = rawX;
  let clampedY = rawY;
  let inside = true;

  if (sdf > 0) {
    inside = false;
    if (qx > 0 && qy > 0) {
      // Corner quadrant: orthogonal projection onto circular corner arc of radius r
      const invD = outLen > 1e-6 ? 1 / outLen : 0;
      clampedX = sx * (innerHalfW + qx * invD * r);
      clampedY = sy * (innerHalfH + qy * invD * r);
    } else if (qx > 0) {
      // Left / right straight edge
      clampedX = sx * halfW;
      clampedY = rawY;
    } else {
      // Top / bottom straight edge
      clampedX = rawX;
      clampedY = sy * halfH;
    }
  }

  out.clampedX = clampedX;
  out.clampedY = clampedY;
  out.inside = inside;
  out.signedDistance = sdf;
  out.normalizedX = halfW > 0 ? THREE.MathUtils.clamp(clampedX / halfW, -1, 1) : 0;
  out.normalizedY = halfH > 0 ? THREE.MathUtils.clamp(clampedY / halfH, -1, 1) : 0;
  out.screenX = 0.5 + clampedX / viewportWidth;
  out.screenY = 0.5 + clampedY / viewportHeight;
  return out;
}

/**
 * Computes the exact Euclidean distance R(theta) from the center (0, 0) to the
 * rounded-rectangle perimeter along unit direction (ux, uy).
 * Guarantees that every point on the straight edges AND circular corners maps to r = 1.0
 * with C1 continuity across the entire 360° perimeter.
 */
export function computeRoundedRectRayRadius(
  ux: number,
  uy: number,
  boundary: RoundedRectBoundary,
): number {
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  if (ax < 1e-8 && ay < 1e-8) return Math.min(boundary.halfW, boundary.halfH);

  const { halfW, halfH, innerHalfW, innerHalfH, cornerRadiusPx: r } = boundary;
  const tX = ax > 1e-8 ? halfW / ax : Number.POSITIVE_INFINITY;
  const tY = ay > 1e-8 ? halfH / ay : Number.POSITIVE_INFINITY;
  const tBox = Math.min(tX, tY);

  const hitX = tBox * ax;
  const hitY = tBox * ay;

  // Straight edge hit (top/bottom or left/right)
  if (hitX <= innerHalfW + 1e-6 || hitY <= innerHalfH + 1e-6) {
    return tBox;
  }

  // Circular corner arc intersection: |t * (ax, ay) - (innerHalfW, innerHalfH)|^2 = r^2
  const b = ax * innerHalfW + ay * innerHalfH;
  const cross = ax * innerHalfH - ay * innerHalfW;
  const disc = r * r - cross * cross;
  return b + Math.sqrt(Math.max(0, disc));
}

/**
 * Pure scalar radial response curve for normalized virtual joystick magnitude r >= 0.
 *
 * - r <= deadzone: returns 0 (clean drift-free center).
 * - deadzone < r < 1: strictly monotonic, globally C1-continuous S-curve that keeps
 *   center sensitivity very low for precise aiming, ramps smoothly through mid-deflection,
 *   and eases its slope cleanly to zero as r -> 1 so reaching the aim boundary never
 *   produces an abrupt turn-rate surge.
 * - r >= 1: saturates cleanly at maxSteeringInput (zero runaway sensitivity beyond radius).
 */
export function evaluateResponseCurveScalar(
  radialMagnitude: number,
  deadzone: number = STEERING_CONFIG.deadzone,
  responseCurve: number = STEERING_CONFIG.responseCurve,
  precisionSensitivity: number = STEERING_CONFIG.precisionSensitivity,
  maxSteeringInput: number = STEERING_CONFIG.maxSteeringInput,
): number {
  const dz = THREE.MathUtils.clamp(
    deadzone,
    STEERING_BOUNDS.deadzone.min,
    STEERING_BOUNDS.deadzone.max,
  );
  const maxOut = THREE.MathUtils.clamp(
    maxSteeringInput,
    STEERING_BOUNDS.maxSteeringInput.min,
    STEERING_BOUNDS.maxSteeringInput.max,
  );

  if (!Number.isFinite(radialMagnitude) || radialMagnitude <= dz) {
    return 0;
  }
  if (radialMagnitude >= 1) {
    return maxOut;
  }

  const p = THREE.MathUtils.clamp(
    responseCurve,
    STEERING_BOUNDS.responseCurve.min,
    STEERING_BOUNDS.responseCurve.max,
  );
  const k = THREE.MathUtils.clamp(
    precisionSensitivity,
    STEERING_BOUNDS.precisionSensitivity.min,
    STEERING_BOUNDS.precisionSensitivity.max,
  );

  const u = (radialMagnitude - dz) / Math.max(1e-5, 1 - dz);
  const t = Math.pow(u, p);
  const smooth = t * t * (3 - 2 * t);
  const shaped = smooth * (k + (1 - k) * smooth);
  return THREE.MathUtils.clamp(shaped, 0, 1) * maxOut;
}

/**
 * Evaluates a bounded virtual joystick displacement (clampedX, clampedY) against
 * the centered rounded-rectangle boundary, producing normalized steering outputs.
 */
export function evaluateVirtualJoystick(
  clampedX: number,
  clampedY: number,
  boundary: RoundedRectBoundary,
  deadzone: number = STEERING_CONFIG.deadzone,
  responseCurve: number = STEERING_CONFIG.responseCurve,
  precisionSensitivity: number = STEERING_CONFIG.precisionSensitivity,
  maxSteeringInput: number = STEERING_CONFIG.maxSteeringInput,
  out: VirtualJoystickEvaluation = createVirtualJoystickEvaluation(),
): VirtualJoystickEvaluation {
  const dist = Math.hypot(clampedX, clampedY);
  if (dist <= 1e-6) {
    out.radialMagnitude = 0;
    out.steeringMagnitude = 0;
    out.steerX = 0;
    out.steerY = 0;
    out.zone = 'deadzone';
    return out;
  }

  const ux = clampedX / dist;
  const uy = clampedY / dist;
  const boundaryRadius = Math.max(1e-5, computeRoundedRectRayRadius(ux, uy, boundary));
  const r = THREE.MathUtils.clamp(dist / boundaryRadius, 0, 1);

  const dz = THREE.MathUtils.clamp(
    deadzone,
    STEERING_BOUNDS.deadzone.min,
    STEERING_BOUNDS.deadzone.max,
  );

  if (r <= dz) {
    out.radialMagnitude = r;
    out.steeringMagnitude = 0;
    out.steerX = 0;
    out.steerY = 0;
    out.zone = 'deadzone';
    return out;
  }

  const mag = evaluateResponseCurveScalar(
    r,
    dz,
    responseCurve,
    precisionSensitivity,
    maxSteeringInput,
  );

  out.radialMagnitude = r;
  out.steeringMagnitude = mag;
  out.steerX = ux * mag;
  out.steerY = uy * mag;
  out.zone = r >= 0.985 ? 'max' : 'active';
  return out;
}
