/**
 * Pure (three.js-free) math for an alternative world-direction steering model.
 * Preserved for its simulation tests; the runtime uses screen-fixed V and camera unprojection.
 *
 * Why this exists
 * ---------------
 * The previous implementation stored the virtual mouse V in *screen pixels* and compared it with
 * a ship-fixed cannon ray R projected through a chase camera that rotates with the ship. Hull
 * rotation therefore moved V and R together on screen, so rotating could not reduce `V - R`; the
 * loop only closed through a 6% "gimbal" hack, and because the steering target was `clamp(V)`,
 * the error reached zero as soon as R touched the aim boundary (a ~12-18 degree turn).
 *
 * The model here keeps V as a persistent *world-space direction*:
 *   - mouse movement rotates V about the ship's current right/up axes (screen-relative, roll-safe)
 *   - V is never modified by ship or camera motion
 *   - R is the ship-fixed cannon ray (ship-local direction)
 *   - the alignment error is the true 3D rotation that takes R onto V
 *   - yaw/pitch rates are driven by that error, so every radian the hull turns removes one radian
 *     of error, and the ship keeps turning after the mouse stops until R reaches V.
 *
 * Both V and R are displayed by projecting `shipPosition + direction * distance` through the
 * active camera, so zero angular error is exactly zero on-screen error.
 *
 * Conventions: ship forward = -Z, right = +X, up = +Y. Positive yaw = rotation about +Y (nose
 * left). Positive pitch = rotation about +X (nose up). Screen offsets are CSS px from the
 * viewport centre, +x right, +y down.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Vertical FOV of the unboosted chase camera; used to convert mouse px to radians. */
export const BASE_CAMERA_FOV_DEG = 62;

/** Screen offsets are clamped to this magnitude so near-plane/behind-camera points stay finite. */
export const MAX_SCREEN_OFFSET_PX = 1e5;

export function focalLengthPx(viewportHeightPx: number, fovDeg: number): number {
  const half = (fovDeg * Math.PI) / 360;
  return Math.max(1, viewportHeightPx) * 0.5 / Math.tan(half);
}

export function rotateByQuat(v: Vec3Like, q: QuatLike, out: Vec3Like): Vec3Like {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  const ox = v.x + q.w * tx + (q.y * tz - q.z * ty);
  const oy = v.y + q.w * ty + (q.z * tx - q.x * tz);
  const oz = v.z + q.w * tz + (q.x * ty - q.y * tx);
  out.x = ox;
  out.y = oy;
  out.z = oz;
  return out;
}

/** Rotates by the inverse (conjugate) of a unit quaternion. */
export function rotateByQuatInverse(v: Vec3Like, q: QuatLike, out: Vec3Like): Vec3Like {
  const qx = -q.x;
  const qy = -q.y;
  const qz = -q.z;
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  const ox = v.x + q.w * tx + (qy * tz - qz * ty);
  const oy = v.y + q.w * ty + (qz * tx - qx * tz);
  const oz = v.z + q.w * tz + (qx * ty - qy * tx);
  out.x = ox;
  out.y = oy;
  out.z = oz;
  return out;
}

/** Rodrigues rotation of `v` about the unit axis (ax, ay, az) by `angle` radians. */
export function rotateAboutAxis(
  v: Vec3Like,
  ax: number,
  ay: number,
  az: number,
  angle: number,
  out: Vec3Like,
): Vec3Like {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dot = ax * v.x + ay * v.y + az * v.z;
  const cx = ay * v.z - az * v.y;
  const cy = az * v.x - ax * v.z;
  const cz = ax * v.y - ay * v.x;
  const ox = v.x * c + cx * s + ax * dot * (1 - c);
  const oy = v.y * c + cy * s + ay * dot * (1 - c);
  const oz = v.z * c + cz * s + az * dot * (1 - c);
  out.x = ox;
  out.y = oy;
  out.z = oz;
  return out;
}

function normalizeInPlace(v: Vec3Like): void {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len > 1e-12) {
    v.x /= len;
    v.y /= len;
    v.z /= len;
  } else {
    v.x = 0;
    v.y = 0;
    v.z = -1;
  }
}

const _axis: Vec3Like = { x: 0, y: 0, z: 0 };

/**
 * Applies relative mouse movement (already converted to radians) to the persistent world-space
 * virtual target. Rotation axes are the ship's *current* up and right axes, so "mouse right"
 * always means screen-right even when the ship is rolled or pitched past vertical.
 *
 * @param mouseRightRad  +: mouse moved right (target moves right on screen)
 * @param mouseDownRad   +: mouse moved down  (target moves down on screen)
 */
export function rotateTargetByMouse(
  targetWorld: Vec3Like,
  shipQuat: QuatLike,
  mouseRightRad: number,
  mouseDownRad: number,
): void {
  if (mouseRightRad !== 0) {
    // Positive rotation about ship-up turns the nose LEFT, so moving right is negative.
    rotateByQuat({ x: 0, y: 1, z: 0 }, shipQuat, _axis);
    rotateAboutAxis(targetWorld, _axis.x, _axis.y, _axis.z, -mouseRightRad, targetWorld);
  }
  if (mouseDownRad !== 0) {
    // Positive rotation about ship-right pitches the nose UP, so moving down is negative.
    rotateByQuat({ x: 1, y: 0, z: 0 }, shipQuat, _axis);
    rotateAboutAxis(targetWorld, _axis.x, _axis.y, _axis.z, -mouseDownRad, targetWorld);
  }
  normalizeInPlace(targetWorld);
}

export interface AlignmentError {
  /** Total angle (rad, 0..PI) of the shortest rotation taking the aim ray onto the target. */
  angle: number;
  /** Unit rotation axis in SHIP-LOCAL space. axisX drives pitch, axisY drives yaw. */
  axisX: number;
  axisY: number;
  axisZ: number;
}

export function createAlignmentError(): AlignmentError {
  return { angle: 0, axisX: 0, axisY: 0, axisZ: 0 };
}

/**
 * Shortest rotation from the ship-local aim ray to the ship-local target direction.
 * Continuous everywhere except exactly antiparallel, where yaw-left is chosen deterministically.
 */
export function computeAlignmentError(
  aimLocal: Vec3Like,
  targetLocal: Vec3Like,
  out: AlignmentError = createAlignmentError(),
): AlignmentError {
  const cx = aimLocal.y * targetLocal.z - aimLocal.z * targetLocal.y;
  const cy = aimLocal.z * targetLocal.x - aimLocal.x * targetLocal.z;
  const cz = aimLocal.x * targetLocal.y - aimLocal.y * targetLocal.x;
  const sin = Math.hypot(cx, cy, cz);
  const cos = aimLocal.x * targetLocal.x + aimLocal.y * targetLocal.y + aimLocal.z * targetLocal.z;

  if (sin < 1e-9) {
    if (cos > 0) {
      out.angle = 0;
      out.axisX = 0;
      out.axisY = 0;
      out.axisZ = 0;
    } else {
      out.angle = Math.PI;
      out.axisX = 0;
      out.axisY = 1;
      out.axisZ = 0;
    }
    return out;
  }

  out.angle = Math.atan2(sin, cos);
  out.axisX = cx / sin;
  out.axisY = cy / sin;
  out.axisZ = cz / sin;
  return out;
}

export interface AlignmentResponseConfig {
  /** Error (fraction of viewport height, measured as angle*focal) that maps to n = 1 */
  referenceFraction: number;
  /** Soft error deadzone in px-equivalent */
  errorDeadzonePx: number;
  linearGain: number;
  quadGain: number;
}

export interface AlignmentResponse {
  /** Soft-deadzoned, reference-normalised error */
  normalized: number;
  /** Demand magnitude in [0, 1): tanh(n * (lin + quad * n)) */
  demand: number;
}

/**
 * Progressive, continuous mapping from angular error to a 0..1 rate demand.
 * d(m) = m^2 / (m + dz) (C-infinity soft deadzone), n = d / (ref * viewportHeight),
 * s(n) = tanh(n * (lin + quad * n)).
 */
export function evaluateAlignmentResponse(
  angleRad: number,
  focalPx: number,
  viewportHeightPx: number,
  cfg: AlignmentResponseConfig,
  out: AlignmentResponse = { normalized: 0, demand: 0 },
): AlignmentResponse {
  const m = Math.max(0, angleRad) * focalPx;
  const dz = Math.max(0, cfg.errorDeadzonePx);
  const soft = m > 1e-9 ? (m * m) / (m + dz) : 0;
  const n = soft / Math.max(1, cfg.referenceFraction * viewportHeightPx);
  out.normalized = n;
  out.demand = Math.tanh(n * (cfg.linearGain + cfg.quadGain * n));
  return out;
}

export interface ScreenOffset {
  /** px from viewport centre, +x right */
  x: number;
  /** px from viewport centre, +y down */
  y: number;
  /** False when the point is at/behind the camera plane (offset then points toward the nearest edge) */
  inFront: boolean;
}

export function createScreenOffset(): ScreenOffset {
  return { x: 0, y: 0, inFront: true };
}

/**
 * Projects `shipPosition + direction * distance` through a pinhole camera described by its world
 * position, world quaternion and vertical FOV. Equivalent to Vector3.project for in-front points,
 * but also returns a finite, correctly-signed edge direction for points behind the camera.
 */
export function projectDirectionToScreenOffset(
  shipPosition: Vec3Like,
  direction: Vec3Like,
  distance: number,
  cameraPosition: Vec3Like,
  cameraQuat: QuatLike,
  fovDeg: number,
  viewportHeightPx: number,
  out: ScreenOffset = createScreenOffset(),
): ScreenOffset {
  const rel: Vec3Like = {
    x: shipPosition.x + direction.x * distance - cameraPosition.x,
    y: shipPosition.y + direction.y * distance - cameraPosition.y,
    z: shipPosition.z + direction.z * distance - cameraPosition.z,
  };
  const c = rotateByQuatInverse(rel, cameraQuat, rel); // camera space: +x right, +y up, -z forward
  const f = focalLengthPx(viewportHeightPx, fovDeg);
  const M = MAX_SCREEN_OFFSET_PX;

  if (c.z < -1e-3) {
    const inv = f / -c.z;
    out.x = Math.max(-M, Math.min(M, c.x * inv));
    out.y = Math.max(-M, Math.min(M, -c.y * inv));
    out.inFront = true;
  } else {
    const len = Math.hypot(c.x, c.y);
    if (len < 1e-6) {
      out.x = M;
      out.y = 0;
    } else {
      out.x = (c.x / len) * M;
      out.y = (-c.y / len) * M;
    }
    out.inFront = false;
  }
  return out;
}
