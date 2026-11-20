import * as THREE from 'three';
import { WEAPON_CONFIGS } from '../config/weapons';
import {
  MOUSE_ALIGNMENT_CONFIG as MA,
  STEERING_BOUNDS,
  STEERING_CONFIG,
  type SteeringMode,
} from '../config/steering';
import type { ProjectedEnemyMarker } from '../types/combat';
import type {
  FlightStatus,
  FlightTelemetry,
  GameSettings,
  ShipConfig,
} from '../types/game';
import {
  clampToRoundedRect,
  computeRoundedRectBoundary,
  computeRoundedRectRayRadius,
  createRoundedRectBoundary,
  createRoundedRectClampResult,
  createVirtualJoystickEvaluation,
  evaluateVirtualJoystick,
  type RoundedRectBoundary,
  type RoundedRectClampResult,
  type VirtualJoystickEvaluation,
} from './AimBoundary';
import {
  createDirectMouseEvaluation,
  evaluateDirectMouseSteering,
  stepDirectAngularRate,
  type DirectMouseCurveParams,
  type DirectMouseEvaluation,
} from './MouseResponseCurve';
import type { InputSnapshot } from './InputManager';

export { evaluateResponseCurveScalar, evaluateVirtualJoystick } from './AimBoundary';
export {
  evaluateDirectMouseCurveScalar,
  evaluateDirectMouseSteering,
  evaluateNonlinearGain,
  softSaturateSigned,
  stepDirectAngularRate,
} from './MouseResponseCurve';
export type {
  RoundedRectBoundary,
  RoundedRectClampResult,
  VirtualJoystickEvaluation,
} from './AimBoundary';
export type { DirectMouseCurveParams, DirectMouseEvaluation } from './MouseResponseCurve';

// Reusable scratch objects (zero per-frame GC allocations)
const _AXIS_X = new THREE.Vector3(1, 0, 0);
const _AXIS_Y = new THREE.Vector3(0, 1, 0);
const _AXIS_Z = new THREE.Vector3(0, 0, 1);
const _FORWARD_LOCAL = new THREE.Vector3(0, 0, -1);

const _qYaw = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _forwardWorld = new THREE.Vector3();
const _rightWorld = new THREE.Vector3();
const _upWorld = new THREE.Vector3();
const _desiredVel = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _aimDirectionWorld = new THREE.Vector3();
const _aimProjectionPoint = new THREE.Vector3();
const _previousAimProjectionPoint = new THREE.Vector3();
const _mouseRayPoint = new THREE.Vector3();
const _mouseRayDirection = new THREE.Vector3();
const _mouseAimDirection = new THREE.Vector3();
const _shipInverse = new THREE.Quaternion();

/** Progressive normalized demand used by mouse-alignment runtime and its response tests. */
export function evaluateAlignmentProgressiveResponse(errorPx: number, viewportHeight: number): number {
  const height = Number.isFinite(viewportHeight) ? Math.max(1, viewportHeight) : 1;
  const magnitude = Number.isFinite(errorPx) ? Math.max(0, errorPx) : 0;
  const n = magnitude / (MA.alignmentReferenceFraction * height);
  return Math.tanh(n * (MA.alignmentLinearGain + MA.alignmentQuadGain * n));
}

function createEmptyEnemyMarkers(count = 6): ProjectedEnemyMarker[] {
  const list: ProjectedEnemyMarker[] = [];
  for (let i = 0; i < count; i++) {
    list.push({
      active: false,
      entityId: '',
      callsign: '',
      personalityLabel: '',
      aiState: 'patrol',
      screenX: 0.5,
      screenY: 0.5,
      inFront: false,
      onScreen: false,
      distance: 0,
      healthRatio: 1,
      isPrimaryTarget: false,
      isPriorityTarget: false,
      leadX: 0.5,
      leadY: 0.5,
      leadVisible: false,
    });
  }
  return list;
}

export function createInitialTelemetry(ship: ShipConfig): FlightTelemetry {
  const initWidthPx = 1280 * STEERING_CONFIG.aimBoundaryWidth;
  const initHeightPx = 720 * STEERING_CONFIG.aimBoundaryHeight;
  const initCornerPx =
    Math.min(initWidthPx * 0.5, initHeightPx * 0.5) * STEERING_CONFIG.aimBoundaryCornerRadius;

  return {
    speed: 0,
    signedSpeed: 0,
    maxSpeed: ship.flight.maxSpeed,
    effectiveMaxSpeed: ship.flight.maxSpeed,
    throttle: 0,
    boostEnergy: ship.flight.maxBoostEnergy,
    maxBoostEnergy: ship.flight.maxBoostEnergy,
    isBoosting: false,
    boostDepleted: false,
    boostIntensity: 0,
    hull: ship.maxHull,
    maxHull: ship.maxHull,
    yawRate: 0,
    pitchRate: 0,
    rollRate: 0,
    aimNormalizedX: 0,
    aimNormalizedY: 0,
    aimScreenX: 0.5,
    aimScreenY: 0.5,
    virtualMouseScreenX: 0.5,
    virtualMouseScreenY: 0.5,
    alignmentErrorPx: 0,
    aimBoundaryWidthPx: initWidthPx,
    aimBoundaryHeightPx: initHeightPx,
    viewportWidthPx: 1280,
    viewportHeightPx: 720,
    aimBoundaryCornerRadiusPx: initCornerPx,
    joystickRadialMagnitude: 0,
    steeringOutputX: 0,
    steeringOutputY: 0,
    boresightScreenX: 0.5,
    boresightScreenY: 0.5,
    steeringZone: 'deadzone',
    headingDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    altitude: 0,
    status: 'STANDBY',
    pointerLocked: false,
    isFiring: false,
    weaponName: ship.weapons.primaryName,
    weaponCooldownRatio: 0,
    hitMarkerTimer: 0,
    killMarkerTimer: 0,
    damageFlashTimer: 0,
    muzzleFlashLeft: 0,
    muzzleFlashRight: 0,
    playerDestroyed: false,
    combatStats: {
      kills: 0,
      shotsFired: 0,
      shotsHit: 0,
      damageDealt: 0,
      damageTaken: 0,
      score: 0,
      wave: 1,
      activeEnemies: 0,
    },
    enemyMarkers: createEmptyEnemyMarkers(6),
    missileHud: {
      lockProgress: 0, lockTargetName: '', lockReady: false, lockEscaped: false,
      missilesRemaining: 4, incomingMissile: false, incomingX: 0.5, incomingY: 0.5,
    },
    fps: 60,
    frameTimeMs: 16.6,
    drawCalls: 0,
    triangles: 0,
    activeProjectiles: 0,
    activeParticles: 0,
    activeEnemies: 0,
    lastAssetLoadMs: 0,
    cachedAssetCount: 0,
  };
}

const GIMBAL_MAX_YAW_RAD = 0.22;
const GIMBAL_MAX_PITCH_RAD = 0.16;
const _gimbalDirLocal = new THREE.Vector3();

/**
 * Controlled angular acceleration + frame-rate-independent damping step.
 * - Smoothly tracks requested angular velocity with crisp responsiveness and low latency.
 * - Caps maximum angular acceleration per frame so abrupt full-stick slams accelerate smoothly
 *   without snapping jerk, while small corrections remain immediate and un-clipped.
 * - Applies extra stopping damping when decelerating toward zero or reversing direction so
 *   returning the virtual joystick toward center settles cleanly without excessive inertia.
 */
function stepAngularVelocity(
  current: number,
  target: number,
  maxAccel: number,
  dampingRate: number,
  dt: number,
): number {
  const isStoppingOrReversing =
    Math.abs(target) < Math.abs(current) || target * current < 0;
  const effectiveLambda = isStoppingOrReversing
    ? dampingRate * STEERING_CONFIG.stoppingDampingBoost
    : dampingRate;
  const alpha = 1 - Math.exp(-effectiveLambda * dt);
  const desiredNext = current + (target - current) * alpha;

  const maxStep = maxAccel * dt;
  const delta = THREE.MathUtils.clamp(desiredNext - current, -maxStep, maxStep);
  const next = current + delta;

  // Cleanly settle tiny sub-threshold residual drift when target is zero
  if (target === 0 && Math.abs(next) < 1e-4) {
    return 0;
  }
  return next;
}

/**
 * Arcade 6DOF flight controller. Ship coordinates are Forward = -Z, Right = +X, Up = +Y.
 *
 * Mouse-alignment keeps V in CSS pixels and steers from its error to the real ship-forward
 * firing-ray projection. Ship rotation feeds back through the completed camera view; the chase
 * camera constrains the true projection, not the weapon or HUD.
 */
export class FlightController {
  public readonly position = new THREE.Vector3(0, 12, 40);
  public readonly quaternion = new THREE.Quaternion();
  public readonly velocity = new THREE.Vector3(0, 0, -24);

  // Controlled angular velocities (rad/s) in ship local space
  public yawVelocity = 0;
  public pitchVelocity = 0;
  public rollVelocity = 0;

  /**
   * 1. `mouseDelta`: Raw Pointer Lock relative mouse movement consumed exactly once per frame.
   * Never clamped or discarded when the visual reticle reaches its boundary.
   */
  public readonly mouseDelta = {
    x: 0,
    y: 0,
  };

  /** True bounded firing projection in alignment mode; legacy modes use the bounded joystick. */
  public readonly reticlePosition = {
    x: 0,
    y: 0,
    normalizedX: 0,
    normalizedY: 0,
    screenX: 0.5,
    screenY: 0.5,
  };

  /** Angular control demand derived from V - T in alignment mode. */
  public readonly steeringDemand = {
    yaw: 0,
    pitch: 0,
    targetYawRate: 0,
    targetPitchRate: 0,
  };

  /**
   * `virtualMouse` (V): Pointer Lock target offset in viewport CSS px from center. Mouse input
   * adds to V; actual ship rotation feeds its camera-projected motion back out of V.
   */
  public readonly virtualMouse = { x: 0, y: 0 };

  /**
   * Legacy diagnostic state retained for integrations that inspect it. In mouse-alignment mode
   * it mirrors the real, camera-projected cannon reticle rather than a synthetic screen cursor.
   */
  public readonly reticleTrue = { x: 0, y: 0 };

  /**
   * Unbounded screen-space error between V and the actual projected firing ray.
   */
  public readonly steeringError = { x: 0, y: 0, magnitude: 0, normalized: 0 };
  /** Closest reachable target, separate from the true, potentially nonzero V - T gap. */
  public readonly alignmentTarget = createRoundedRectClampResult();
  public readonly alignmentRemaining = { x: 0, y: 0, magnitude: 0 };

  // Bounded virtual reticle displacement in viewport CSS pixels (centered at 0, 0)
  public joystickX = 0;
  public joystickY = 0;

  // Normalized reticle deflection [-1..1] relative to boundary half-extents (for HUD & baseline mode)
  public aimCursorX = 0;
  public aimCursorY = 0;

  // Visual banking angle layered on the ship mesh for tactile feel
  public visualBankAngle = 0;

  // Live viewport-relative rounded-rectangle boundary, clamp, and response state (zero per-frame allocs)
  public readonly aimBoundary: RoundedRectBoundary = createRoundedRectBoundary();
  public readonly aimClamp: RoundedRectClampResult = createRoundedRectClampResult();
  public readonly joystickEval: VirtualJoystickEvaluation = createVirtualJoystickEvaluation();
  public readonly directMouseEval: DirectMouseEvaluation = createDirectMouseEvaluation();

  /** Active steering mode (defaults to projection-based mouse alignment; switchable for legacy rollback) */
  public steeringMode: SteeringMode = STEERING_CONFIG.steeringMode;

  private readonly directCurveParams: DirectMouseCurveParams = {
    mouseSensitivity: STEERING_CONFIG.mouseSensitivity,
    responseCurve: STEERING_CONFIG.responseCurve,
    precisionLinearBlend: STEERING_CONFIG.precisionLinearBlend,
    softSaturationKnee: STEERING_CONFIG.softSaturationKnee,
    inputNormalizationRange: STEERING_CONFIG.inputNormalizationRange,
    yawSensitivity: STEERING_CONFIG.yawRate,
    pitchSensitivity: STEERING_CONFIG.pitchRate,
    maxYawRate: STEERING_CONFIG.maxYawRate,
    maxPitchRate: STEERING_CONFIG.maxPitchRate,
    invertY: false,
  };

  private lastViewportWidth = 0;
  private lastViewportHeight = 0;
  private timeSinceLastMouseDeltaSec = 1.0;
  private readonly previousAimQuaternion = new THREE.Quaternion();
  private rotationFeedbackPending = false;

  private ship: ShipConfig;
  private boostEnergy: number;
  private boostCooldownTimer = 0;
  private boostLockedOut = false;
  private boostIntensity = 0;
  private wasBoosting = false;
  private hull: number;
  private boostJustEngaged = false;

  public constructor(ship: ShipConfig) {
    this.ship = ship;
    this.boostEnergy = ship.flight.maxBoostEnergy;
    this.hull = ship.maxHull;
  }

  public setShipConfig(ship: ShipConfig): void {
    this.ship = ship;
    this.boostEnergy = Math.min(this.boostEnergy, ship.flight.maxBoostEnergy);
    this.hull = ship.maxHull;
  }

  public centerAimCursor(): void {
    this.virtualMouse.x = 0;
    this.virtualMouse.y = 0;
    this.reticleTrue.x = 0;
    this.reticleTrue.y = 0;
    this.steeringError.x = 0;
    this.steeringError.y = 0;
    this.steeringError.magnitude = 0;
    this.steeringError.normalized = 0;
    this.alignmentRemaining.x = 0;
    this.alignmentRemaining.y = 0;
    this.alignmentRemaining.magnitude = 0;
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.reticlePosition.x = 0;
    this.reticlePosition.y = 0;
    this.reticlePosition.normalizedX = 0;
    this.reticlePosition.normalizedY = 0;
    this.reticlePosition.screenX = 0.5;
    this.reticlePosition.screenY = 0.5;
    this.steeringDemand.yaw = 0;
    this.steeringDemand.pitch = 0;
    this.steeringDemand.targetYawRate = 0;
    this.steeringDemand.targetPitchRate = 0;
    this.rotationFeedbackPending = false;
    this.timeSinceLastMouseDeltaSec = 1.0;
    this.joystickX = 0;
    this.joystickY = 0;
    this.aimCursorX = 0;
    this.aimCursorY = 0;
    this.directMouseEval.speedPxPerSec = 0;
    this.directMouseEval.normalizedInput = 0;
    this.directMouseEval.curveGain = 0;
    this.directMouseEval.steerYaw = 0;
    this.directMouseEval.steerPitch = 0;
    this.directMouseEval.targetYawRate = 0;
    this.directMouseEval.targetPitchRate = 0;
    clampToRoundedRect(0, 0, this.aimBoundary, this.aimClamp);
    evaluateVirtualJoystick(
      0,
      0,
      this.aimBoundary,
      STEERING_CONFIG.deadzone,
      STEERING_CONFIG.responseCurve,
      STEERING_CONFIG.precisionSensitivity,
      STEERING_CONFIG.maxSteeringInput,
      this.joystickEval,
    );
  }

  public reset(startPosition?: THREE.Vector3): void {
    if (startPosition) {
      this.position.copy(startPosition);
    } else {
      this.position.set(0, 12, 40);
    }
    this.quaternion.identity();
    this.velocity.set(0, 0, -28);
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
    this.rollVelocity = 0;
    this.centerAimCursor();
    this.visualBankAngle = 0;
    this.boostEnergy = this.ship.flight.maxBoostEnergy;
    this.boostCooldownTimer = 0;
    this.boostLockedOut = false;
    this.boostIntensity = 0;
    this.wasBoosting = false;
    this.hull = this.ship.maxHull;
  }

  public getBoostJustEngaged(): boolean {
    return this.boostJustEngaged;
  }

  /**
   * Returns the unit world-space centerline used for the weapon convergence point.
   * Alignment and direct modes use the ship boresight; the legacy joystick mode keeps its gimbal.
   */
  public getAimDirectionWorld(out: THREE.Vector3): THREE.Vector3 {
    if (this.steeringMode === 'mouse-alignment') {
      // This is the same physical ray that `syncAimProjection` projects for the HUD. There is
      // deliberately no fixed-FOV screen approximation in the firing path.
      out.copy(_FORWARD_LOCAL).applyQuaternion(this.quaternion).normalize();
      return out;
    }
    if (this.steeringMode === 'direct-nonlinear') {
      out.copy(_FORWARD_LOCAL).applyQuaternion(this.quaternion).normalize();
      return out;
    }
    const gimbalYaw = THREE.MathUtils.clamp(this.aimCursorX, -1, 1) * GIMBAL_MAX_YAW_RAD;
    const gimbalPitch = THREE.MathUtils.clamp(-this.aimCursorY, -1, 1) * GIMBAL_MAX_PITCH_RAD;
    _gimbalDirLocal.set(Math.sin(gimbalYaw), Math.sin(gimbalPitch), -1).normalize();
    out.copy(_gimbalDirLocal).applyQuaternion(this.quaternion).normalize();
    return out;
  }

  /** Populate bounded legacy geometry; alignment mode publishes the raw projection separately. */
  private publishAimScreen(offsetX: number, offsetY: number): void {
    clampToRoundedRect(offsetX, offsetY, this.aimBoundary, this.aimClamp);
    const clampedX = this.aimClamp.clampedX;
    const clampedY = this.aimClamp.clampedY;
    this.reticleTrue.x = clampedX;
    this.reticleTrue.y = clampedY;
    this.joystickX = clampedX;
    this.joystickY = clampedY;
    this.aimCursorX = this.aimClamp.normalizedX;
    this.aimCursorY = this.aimClamp.normalizedY;
    this.reticlePosition.x = clampedX;
    this.reticlePosition.y = clampedY;
    this.reticlePosition.normalizedX = this.aimClamp.normalizedX;
    this.reticlePosition.normalizedY = this.aimClamp.normalizedY;
    this.reticlePosition.screenX = this.aimClamp.screenX;
    this.reticlePosition.screenY = this.aimClamp.screenY;
  }

  /** Full V - T is retained separately from the closest reachable target. */
  private updateAlignmentState(vh: number): void {
    const V = this.virtualMouse;
    const ex = V.x - this.reticlePosition.x;
    const ey = V.y - this.reticlePosition.y;
    const mag = Math.hypot(ex, ey);
    const dz = Math.max(0, MA.alignmentErrorDeadzonePx);
    const softMag = mag > 1e-9 ? (mag * mag) / (mag + dz) : 0;
    this.steeringError.x = ex;
    this.steeringError.y = ey;
    this.steeringError.magnitude = mag;
    this.steeringError.normalized = softMag / Math.max(1, MA.alignmentReferenceFraction * vh);
    clampToRoundedRect(V.x, V.y, this.aimBoundary, this.alignmentTarget);
    this.alignmentRemaining.x = this.alignmentTarget.clampedX - this.reticlePosition.x;
    this.alignmentRemaining.y = this.alignmentTarget.clampedY - this.reticlePosition.y;
    this.alignmentRemaining.magnitude = Math.hypot(this.alignmentRemaining.x, this.alignmentRemaining.y);
  }

  /**
   * Projects the *same* cannon ray used by `getAimDirectionWorld` through the active camera.
   * This must run after CameraController updates each frame so camera offset, chase interpolation,
   * dynamic FOV, and camera rotation all participate in the one HUD coordinate system.
   */
  public syncAimProjection(
    camera: THREE.PerspectiveCamera,
    telemetry?: FlightTelemetry,
    viewportWidth = this.lastViewportWidth || 1280,
    viewportHeight = this.lastViewportHeight || 720,
  ): void {
    if (this.steeringMode !== 'mouse-alignment') return;

    const vw = Math.max(1, viewportWidth);
    const vh = Math.max(1, viewportHeight);
    camera.updateMatrixWorld();

    this.getAimDirectionWorld(_aimDirectionWorld);
    _aimProjectionPoint
      .copy(this.position)
      .addScaledVector(_aimDirectionWorld, WEAPON_CONFIGS.player_pulse_twin.convergenceDistance)
      .project(camera);

    const rawX = ((_aimProjectionPoint.x + 1) * 0.5 - 0.5) * vw;
    const rawY = ((1 - _aimProjectionPoint.y) * 0.5 - 0.5) * vh;
    this.publishAimScreen(rawX, rawY);
    // Publish the actual projection without falsifying it; CameraController constrains the view.
    this.reticleTrue.x = this.reticlePosition.x = rawX;
    this.reticleTrue.y = this.reticlePosition.y = rawY;
    this.reticlePosition.screenX = 0.5 + rawX / vw;
    this.reticlePosition.screenY = 0.5 + rawY / vh;

    if (this.rotationFeedbackPending) {
      // Compare old and current ship orientations through the same completed camera view.
      // This isolates weapon-ray displacement due to the real ship transform, excluding camera
      // follow, smoothing, and boundary correction from the measured feedback.
      _previousAimProjectionPoint.copy(_FORWARD_LOCAL).applyQuaternion(this.previousAimQuaternion)
        .multiplyScalar(WEAPON_CONFIGS.player_pulse_twin.convergenceDistance)
        .add(this.position)
        .project(camera);
      const previousX = _previousAimProjectionPoint.x * vw * 0.5;
      const previousY = -_previousAimProjectionPoint.y * vh * 0.5;
      const projectedShipDeltaX = rawX - previousX;
      const projectedShipDeltaY = rawY - previousY;
      if (Number.isFinite(projectedShipDeltaX) && Number.isFinite(projectedShipDeltaY)) {
        // V moves only by the screen displacement attributable to this actual quaternion change.
        this.virtualMouse.x -= projectedShipDeltaX;
        this.virtualMouse.y -= projectedShipDeltaY;
      }
      this.rotationFeedbackPending = false;
    }

    this.updateAlignmentState(vh);
    this.updateAimTelemetry(telemetry, vw, vh);
  }

  private updateAimTelemetry(telemetry: FlightTelemetry | undefined, vw: number, vh: number): void {
    if (!telemetry) return;
    telemetry.aimNormalizedX = this.aimCursorX;
    telemetry.aimNormalizedY = this.aimCursorY;
    telemetry.aimScreenX = this.reticlePosition.screenX;
    telemetry.aimScreenY = this.reticlePosition.screenY;
    telemetry.virtualMouseScreenX = 0.5 + this.virtualMouse.x / vw;
    telemetry.virtualMouseScreenY = 0.5 + this.virtualMouse.y / vh;
    telemetry.alignmentErrorPx = this.steeringError.magnitude;
    telemetry.aimBoundaryWidthPx = this.aimBoundary.widthPx;
    telemetry.aimBoundaryHeightPx = this.aimBoundary.heightPx;
    telemetry.viewportWidthPx = vw;
    telemetry.viewportHeightPx = vh;
    telemetry.aimBoundaryCornerRadiusPx = this.aimBoundary.cornerRadiusPx;
  }

  /**
   * Computes the 3D world-space convergence point along the player's firing ray.
   */
  public getAimTargetPoint(out: THREE.Vector3, distance: number): THREE.Vector3 {
    this.getAimDirectionWorld(out);
    out.multiplyScalar(distance).add(this.position);
    return out;
  }

  /**
   * Advances arcade flight simulation by delta time `dt` (seconds) and writes live telemetry.
   * Uses live game viewport dimensions (viewportWidth x viewportHeight) for aim boundary geometry.
   */
  public update(
    dt: number,
    input: InputSnapshot,
    settings: GameSettings,
    telemetry: FlightTelemetry,
    viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
    viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720,
    activeCamera?: THREE.PerspectiveCamera,
  ): void {
    const profile = this.ship.flight;
    const safeDt = Math.min(Math.max(dt, 0.0001), 0.05);
    const vw = Math.max(1, viewportWidth);
    const vh = Math.max(1, viewportHeight);

    // Preserve normalized V across viewport resizes; T will be reprojected from the camera.
    if (this.lastViewportWidth > 0 && this.lastViewportHeight > 0) {
      if (vw !== this.lastViewportWidth) {
        this.joystickX *= vw / this.lastViewportWidth;
        this.virtualMouse.x *= vw / this.lastViewportWidth;
        this.reticleTrue.x *= vw / this.lastViewportWidth;
      }
      if (vh !== this.lastViewportHeight) {
        this.joystickY *= vh / this.lastViewportHeight;
        this.virtualMouse.y *= vh / this.lastViewportHeight;
        this.reticleTrue.y *= vh / this.lastViewportHeight;
      }
    }
    this.lastViewportWidth = vw;
    this.lastViewportHeight = vh;

    // 1. Recompute viewport-relative rounded-rectangle aim boundary (independent of response curve)
    computeRoundedRectBoundary(
      vw,
      vh,
      settings.joystickRadius,
      STEERING_CONFIG.aimBoundaryWidth,
      STEERING_CONFIG.aimBoundaryHeight,
      STEERING_CONFIG.aimBoundaryCornerRadius,
      this.aimBoundary,
    );

    // Record raw Pointer Lock mouseDelta consumed once for this frame (never gated by reticle boundary)
    const rawMouseDeltaX = Number.isFinite(input.mouseDeltaX) ? input.mouseDeltaX : 0;
    const rawMouseDeltaY = Number.isFinite(input.mouseDeltaY) ? input.mouseDeltaY : 0;
    this.mouseDelta.x = rawMouseDeltaX;
    this.mouseDelta.y = rawMouseDeltaY;

    const hasMouseDelta = rawMouseDeltaX !== 0 || rawMouseDeltaY !== 0;
    const prevTimeSinceMouse = this.timeSinceLastMouseDeltaSec;
    if (hasMouseDelta) {
      this.timeSinceLastMouseDeltaSec = 0;
    } else {
      this.timeSinceLastMouseDeltaSec += safeDt;
    }
    // True only if a single high-refresh render frame (< 18ms) elapsed without a mousemove event right after active input
    const isCoalescingGap =
      !hasMouseDelta && prevTimeSinceMouse === 0 && this.timeSinceLastMouseDeltaSec < 0.018;

    // Optional arrow-key steering inputs
    let keyYaw = 0;
    if (input.keyYawLeft) keyYaw += 1;
    if (input.keyYawRight) keyYaw -= 1;
    let keyPitch = 0;
    if (input.keyPitchUp) keyPitch += 1;
    if (input.keyPitchDown) keyPitch -= 1;

    if (this.steeringMode === 'mouse-alignment') {
      // ---- Mouse-to-Reticle Alignment ----
      const yawClassScale = profile.yawSpeed / STEERING_CONFIG.referenceInterceptorYawSpeed;
      const pitchClassScale = profile.pitchSpeed / STEERING_CONFIG.referenceInterceptorPitchSpeed;
      const maxYaw =
        THREE.MathUtils.clamp(
          settings.maxYawRate,
          STEERING_BOUNDS.maxYawRate.min,
          STEERING_BOUNDS.maxYawRate.max,
        ) *
        yawClassScale *
        THREE.MathUtils.clamp(settings.yawSensitivity, 0.4, 1.8);
      const maxPitch =
        THREE.MathUtils.clamp(
          settings.maxPitchRate,
          STEERING_BOUNDS.maxPitchRate.min,
          STEERING_BOUNDS.maxPitchRate.max,
        ) *
        pitchClassScale *
        THREE.MathUtils.clamp(settings.pitchSensitivity, 0.4, 1.8);
      const mouseSens = THREE.MathUtils.clamp(
        settings.mouseSensitivity,
        STEERING_BOUNDS.mouseSensitivity.min,
        STEERING_BOUNDS.mouseSensitivity.max,
      );
      const ySign = settings.invertY ? -1 : 1;

      // 1. Accumulate raw Pointer Lock movement into V in CSS pixels. Pointer Lock already
      // reports relative CSS-pixel deltas; viewport scaling here would make the virtual mouse lie.
      const dMx = this.mouseDelta.x * mouseSens;
      const dMy = this.mouseDelta.y * ySign * mouseSens;
      this.virtualMouse.x += dMx;
      this.virtualMouse.y += dMy;

      // Apply relative mouse input first, then steer from the actual projected V - T error.
      this.updateAlignmentState(vh);

      // Steering follows the full V - T error. Do not let the screen boundary erase demand:
      // V can remain outside while the real projected reticle stays on the boundary. The
      // camera constraint keeps that projection visible; only true V/T alignment settles input.
      const remaining = this.steeringError;
      const n = remaining.magnitude / (MA.alignmentReferenceFraction * vh);
      const s = evaluateAlignmentProgressiveResponse(remaining.magnitude, vh);
      let yawAxis = 0;
      let pitchAxis = 0;
      if (activeCamera && remaining.magnitude > MA.alignmentErrorDeadzonePx) {
        activeCamera.updateMatrixWorld();
        _mouseRayPoint.set(
          2 * this.virtualMouse.x / vw,
          -2 * this.virtualMouse.y / vh,
          0.5,
        ).unproject(activeCamera);
        _mouseRayDirection.subVectors(_mouseRayPoint, activeCamera.position).normalize();
        _mouseRayPoint.copy(activeCamera.position).sub(this.position);
        const b = _mouseRayPoint.dot(_mouseRayDirection);
        const convergence = WEAPON_CONFIGS.player_pulse_twin.convergenceDistance;
        const c = _mouseRayPoint.lengthSq() - convergence * convergence;
        const distance = -b + Math.sqrt(Math.max(0, b * b - c));
        _mouseAimDirection.copy(activeCamera.position).addScaledVector(_mouseRayDirection, distance)
          .sub(this.position).normalize();
        _shipInverse.copy(this.quaternion).invert();
        _mouseAimDirection.applyQuaternion(_shipInverse);
        const axisLength = Math.hypot(_mouseAimDirection.x, _mouseAimDirection.y);
        if (axisLength > 1e-9) {
          yawAxis = -_mouseAimDirection.x / axisLength;
          pitchAxis = _mouseAimDirection.y / axisLength;
        }
      }
      let targetYawRate = yawAxis * s * maxYaw;
      let targetPitchRate = pitchAxis * s * maxPitch;
      targetYawRate = THREE.MathUtils.clamp(targetYawRate + keyYaw * maxYaw * 0.65, -maxYaw, maxYaw);
      targetPitchRate = THREE.MathUtils.clamp(
        targetPitchRate + keyPitch * maxPitch * 0.65,
        -maxPitch,
        maxPitch,
      );

      this.steeringDemand.yaw = THREE.MathUtils.clamp(targetYawRate / Math.max(maxYaw, 0.1), -1, 1);
      this.steeringDemand.pitch = THREE.MathUtils.clamp(
        targetPitchRate / Math.max(maxPitch, 0.1),
        -1,
        1,
      );
      this.steeringDemand.targetYawRate = targetYawRate;
      this.steeringDemand.targetPitchRate = targetPitchRate;

      // 4. First-order smoothing (dt-based, no spikes, symmetric on reversal)
      const a = 1 - Math.exp(-safeDt / MA.alignmentRateTauSec);
      this.yawVelocity += (targetYawRate - this.yawVelocity) * a;
      this.pitchVelocity += (targetPitchRate - this.pitchVelocity) * a;
      if (targetYawRate === 0 && Math.abs(this.yawVelocity) < 1e-4) this.yawVelocity = 0;
      if (targetPitchRate === 0 && Math.abs(this.pitchVelocity) < 1e-4) this.pitchVelocity = 0;

      const reticleRadius = Math.hypot(this.reticlePosition.x, this.reticlePosition.y);
      const reticleBoundaryRadius =
        reticleRadius > 1e-6
          ? computeRoundedRectRayRadius(
              this.reticlePosition.x / reticleRadius,
              this.reticlePosition.y / reticleRadius,
              this.aimBoundary,
            )
          : 1;
      this.joystickEval.radialMagnitude = THREE.MathUtils.clamp(
        reticleRadius / Math.max(reticleBoundaryRadius, 1e-6),
        0,
        1,
      );
      this.joystickEval.steeringMagnitude = s;
      this.joystickEval.steerX = -this.steeringDemand.yaw;
      this.joystickEval.steerY = -this.steeringDemand.pitch;
      this.joystickEval.zone = n <= 0.01 ? 'deadzone' : s > 0.95 ? 'max' : 'active';
    } else if (this.steeringMode === 'direct-nonlinear') {
      // 2. Continuous Steering Demand (computed directly from raw `mouseDelta`, completely independent of `reticlePosition`)
      const yawClassScale = profile.yawSpeed / STEERING_CONFIG.referenceInterceptorYawSpeed;
      const pitchClassScale = profile.pitchSpeed / STEERING_CONFIG.referenceInterceptorPitchSpeed;

      const effectiveMaxYaw =
        THREE.MathUtils.clamp(
          settings.maxYawRate,
          STEERING_BOUNDS.maxYawRate.min,
          STEERING_BOUNDS.maxYawRate.max,
        ) * yawClassScale;
      const effectiveMaxPitch =
        THREE.MathUtils.clamp(
          settings.maxPitchRate,
          STEERING_BOUNDS.maxPitchRate.min,
          STEERING_BOUNDS.maxPitchRate.max,
        ) * pitchClassScale;

      this.directCurveParams.mouseSensitivity = settings.mouseSensitivity;
      this.directCurveParams.responseCurve = settings.responseCurve;
      this.directCurveParams.precisionLinearBlend = STEERING_CONFIG.precisionLinearBlend;
      this.directCurveParams.softSaturationKnee = STEERING_CONFIG.softSaturationKnee;
      this.directCurveParams.inputNormalizationRange = STEERING_CONFIG.inputNormalizationRange;
      this.directCurveParams.yawSensitivity = settings.yawSensitivity;
      this.directCurveParams.pitchSensitivity = settings.pitchSensitivity;
      this.directCurveParams.maxYawRate = effectiveMaxYaw;
      this.directCurveParams.maxPitchRate = effectiveMaxPitch;
      this.directCurveParams.invertY = settings.invertY;

      evaluateDirectMouseSteering(
        this.mouseDelta.x,
        this.mouseDelta.y,
        safeDt,
        this.directCurveParams,
        this.directMouseEval,
      );

      // Blend optional keyboard arrow turning while respecting independent rate ceilings
      const keyYawRate = keyYaw * effectiveMaxYaw * 0.65;
      const keyPitchRate = keyPitch * effectiveMaxPitch * 0.65;

      const targetYawRate = THREE.MathUtils.clamp(
        this.directMouseEval.targetYawRate + keyYawRate,
        -effectiveMaxYaw,
        effectiveMaxYaw,
      );
      const targetPitchRate = THREE.MathUtils.clamp(
        this.directMouseEval.targetPitchRate + keyPitchRate,
        -effectiveMaxPitch,
        effectiveMaxPitch,
      );

      this.steeringDemand.yaw = THREE.MathUtils.clamp(
        targetYawRate / Math.max(effectiveMaxYaw, 0.1),
        -1,
        1,
      );
      this.steeringDemand.pitch = THREE.MathUtils.clamp(
        targetPitchRate / Math.max(effectiveMaxPitch, 0.1),
        -1,
        1,
      );
      this.steeringDemand.targetYawRate = targetYawRate;
      this.steeringDemand.targetPitchRate = targetPitchRate;

      this.yawVelocity = stepDirectAngularRate(
        this.yawVelocity,
        targetYawRate,
        settings.inputSmoothing,
        safeDt,
        isCoalescingGap && keyYaw === 0,
      );
      this.pitchVelocity = stepDirectAngularRate(
        this.pitchVelocity,
        targetPitchRate,
        settings.inputSmoothing,
        safeDt,
        isCoalescingGap && keyPitch === 0,
      );

      // 3. Independent Bounded Visual Reticle (`reticlePosition`):
      //    - Moves naturally with raw mouseDelta and clamps to the rounded-rectangle aim boundary.
      //    - Never auto-recenters, bounces, or feeds back into `steeringDemand`.
      const mouseSens = THREE.MathUtils.clamp(
        settings.mouseSensitivity,
        STEERING_BOUNDS.mouseSensitivity.min,
        STEERING_BOUNDS.mouseSensitivity.max,
      );
      const resScale = THREE.MathUtils.clamp(
        vh / STEERING_CONFIG.referenceViewportHeight,
        0.5,
        2.5,
      );
      const inputScale = mouseSens * resScale;
      const ySign = settings.invertY ? -1 : 1;

      const candidateX = this.joystickX + this.mouseDelta.x * inputScale;
      const candidateY = this.joystickY + this.mouseDelta.y * ySign * inputScale;

      clampToRoundedRect(candidateX, candidateY, this.aimBoundary, this.aimClamp);
      this.joystickX = this.aimClamp.clampedX;
      this.joystickY = this.aimClamp.clampedY;
      this.aimCursorX = this.aimClamp.normalizedX;
      this.aimCursorY = this.aimClamp.normalizedY;

      this.reticlePosition.x = this.aimClamp.clampedX;
      this.reticlePosition.y = this.aimClamp.clampedY;
      this.reticlePosition.normalizedX = this.aimClamp.normalizedX;
      this.reticlePosition.normalizedY = this.aimClamp.normalizedY;
      this.reticlePosition.screenX = this.aimClamp.screenX;
      this.reticlePosition.screenY = this.aimClamp.screenY;

      const reticleDist = Math.hypot(this.reticlePosition.x, this.reticlePosition.y);
      let reticleRadial = 0;
      if (reticleDist > 1e-6) {
        const rux = this.reticlePosition.x / reticleDist;
        const ruy = this.reticlePosition.y / reticleDist;
        const boundaryRadius = Math.max(
          1e-5,
          computeRoundedRectRayRadius(rux, ruy, this.aimBoundary),
        );
        reticleRadial = THREE.MathUtils.clamp(reticleDist / boundaryRadius, 0, 1);
      }

      const normTurnX = THREE.MathUtils.clamp(
        -this.yawVelocity / Math.max(effectiveMaxYaw, 0.1),
        -1,
        1,
      );
      const normTurnY = THREE.MathUtils.clamp(
        -this.pitchVelocity / Math.max(effectiveMaxPitch, 0.1),
        -1,
        1,
      );
      const steerMag = Math.min(1, Math.hypot(normTurnX, normTurnY));

      this.joystickEval.radialMagnitude = reticleRadial;
      this.joystickEval.steeringMagnitude = steerMag;
      this.joystickEval.steerX = normTurnX;
      this.joystickEval.steerY = normTurnY;
      this.joystickEval.zone =
        reticleRadial >= 0.985 ? 'max' : reticleRadial > 0.02 ? 'active' : 'deadzone';
    } else {
      // Preserved pre-calibration baseline path (virtual joystick) for independent rollback
      const mouseSens = THREE.MathUtils.clamp(
        settings.mouseSensitivity,
        STEERING_BOUNDS.mouseSensitivity.min,
        STEERING_BOUNDS.mouseSensitivity.max,
      );
      const resScale = THREE.MathUtils.clamp(
        vh / STEERING_CONFIG.referenceViewportHeight,
        0.5,
        2.5,
      );
      const inputScale = mouseSens * resScale;
      const ySign = settings.invertY ? -1 : 1;

      const candidateX = this.joystickX + this.mouseDelta.x * inputScale;
      const candidateY = this.joystickY + this.mouseDelta.y * ySign * inputScale;

      clampToRoundedRect(candidateX, candidateY, this.aimBoundary, this.aimClamp);
      this.joystickX = this.aimClamp.clampedX;
      this.joystickY = this.aimClamp.clampedY;
      this.aimCursorX = this.aimClamp.normalizedX;
      this.aimCursorY = this.aimClamp.normalizedY;

      this.reticlePosition.x = this.aimClamp.clampedX;
      this.reticlePosition.y = this.aimClamp.clampedY;
      this.reticlePosition.normalizedX = this.aimClamp.normalizedX;
      this.reticlePosition.normalizedY = this.aimClamp.normalizedY;
      this.reticlePosition.screenX = this.aimClamp.screenX;
      this.reticlePosition.screenY = this.aimClamp.screenY;

      evaluateVirtualJoystick(
        this.joystickX,
        this.joystickY,
        this.aimBoundary,
        settings.deadzone,
        settings.responseCurve,
        STEERING_CONFIG.precisionSensitivity,
        STEERING_CONFIG.maxSteeringInput,
        this.joystickEval,
      );

      const yawSens = THREE.MathUtils.clamp(
        settings.yawSensitivity,
        STEERING_BOUNDS.yawSensitivity.min,
        STEERING_BOUNDS.yawSensitivity.max,
      );
      const pitchSens = THREE.MathUtils.clamp(
        settings.pitchSensitivity,
        STEERING_BOUNDS.pitchSensitivity.min,
        STEERING_BOUNDS.pitchSensitivity.max,
      );

      const targetYawRate =
        THREE.MathUtils.clamp(
          -this.joystickEval.steerX * yawSens + keyYaw * 0.85,
          -STEERING_CONFIG.maxSafeYawMultiplier,
          STEERING_CONFIG.maxSafeYawMultiplier,
        ) * profile.yawSpeed;

      const targetPitchRate =
        THREE.MathUtils.clamp(
          -this.joystickEval.steerY * pitchSens + keyPitch * 0.85,
          -STEERING_CONFIG.maxSafePitchMultiplier,
          STEERING_CONFIG.maxSafePitchMultiplier,
        ) * profile.pitchSpeed;

      this.steeringDemand.yaw = THREE.MathUtils.clamp(
        targetYawRate / Math.max(profile.yawSpeed * STEERING_CONFIG.maxSafeYawMultiplier, 0.1),
        -1,
        1,
      );
      this.steeringDemand.pitch = THREE.MathUtils.clamp(
        targetPitchRate / Math.max(profile.pitchSpeed * STEERING_CONFIG.maxSafePitchMultiplier, 0.1),
        -1,
        1,
      );
      this.steeringDemand.targetYawRate = targetYawRate;
      this.steeringDemand.targetPitchRate = targetPitchRate;

      const shipAgility = profile.angularDamping / 7.5;
      const maxAngularAccel = STEERING_CONFIG.angularAcceleration * shipAgility;
      const dampingRate = STEERING_CONFIG.angularDamping * shipAgility;

      this.yawVelocity = stepAngularVelocity(
        this.yawVelocity,
        targetYawRate,
        maxAngularAccel,
        dampingRate,
        safeDt,
      );
      this.pitchVelocity = stepAngularVelocity(
        this.pitchVelocity,
        targetPitchRate,
        maxAngularAccel,
        dampingRate,
        safeDt,
      );
    }

    const stepYaw = this.yawVelocity * safeDt;
    const stepPitch = this.pitchVelocity * safeDt;

    // 6. Independent Roll via A / D (exact Phase 1 roll feel preserved)
    let rollDir = 0;
    if (input.rollLeft) rollDir += 1;
    if (input.rollRight) rollDir -= 1;
    const targetRollRate = rollDir * profile.rollSpeed;
    const rollAlpha = 1 - Math.exp(-(profile.angularDamping * 1.25) * safeDt);
    this.rollVelocity = THREE.MathUtils.lerp(this.rollVelocity, targetRollRate, rollAlpha);
    const stepRoll = this.rollVelocity * safeDt;

    this.rotationFeedbackPending = this.steeringMode === 'mouse-alignment' && !!activeCamera;
    if (this.rotationFeedbackPending) this.previousAimQuaternion.copy(this.quaternion);

    // 7. Apply Pure Local-Space Quaternion Rotations (Zero Gimbal Lock at any pitch/yaw)
    _qYaw.setFromAxisAngle(_AXIS_Y, stepYaw);
    _qPitch.setFromAxisAngle(_AXIS_X, stepPitch);
    _qRoll.setFromAxisAngle(_AXIS_Z, stepRoll);

    this.quaternion.multiply(_qYaw);
    this.quaternion.multiply(_qPitch);
    this.quaternion.multiply(_qRoll);
    this.quaternion.normalize();

    // Subtle visual bank when yawing without overriding deliberate A/D roll
    const targetBank = THREE.MathUtils.clamp(
      (this.yawVelocity / profile.yawSpeed) * profile.visualBankStrength,
      -0.44,
      0.44,
    );
    this.visualBankAngle = THREE.MathUtils.damp(this.visualBankAngle, targetBank, 6.5, safeDt);

    // 8. Boost energy management (exact Phase 1 behavior preserved)
    if (this.boostLockedOut && this.boostEnergy >= 18) {
      this.boostLockedOut = false;
    }

    const wantsBoost = input.boost && !input.backward && !this.boostLockedOut && this.boostEnergy > 0.5;
    const isBoosting = wantsBoost;
    this.boostJustEngaged = isBoosting && !this.wasBoosting;
    this.wasBoosting = isBoosting;

    if (isBoosting) {
      this.boostEnergy = Math.max(0, this.boostEnergy - profile.boostDrainRate * safeDt);
      this.boostCooldownTimer = profile.boostRegenDelay;
      if (this.boostEnergy <= 0.1) {
        this.boostEnergy = 0;
        this.boostLockedOut = true;
      }
    } else {
      if (this.boostCooldownTimer > 0) {
        this.boostCooldownTimer = Math.max(0, this.boostCooldownTimer - safeDt);
      } else if (this.boostEnergy < profile.maxBoostEnergy) {
        this.boostEnergy = Math.min(
          profile.maxBoostEnergy,
          this.boostEnergy + profile.boostRegenRate * safeDt,
        );
      }
    }

    this.boostIntensity = THREE.MathUtils.damp(
      this.boostIntensity,
      isBoosting ? 1 : 0,
      isBoosting ? 9.0 : 5.5,
      safeDt,
    );

    // 9. Linear thrust, controlled arcade inertia, and lateral redirection (exact Phase 1 physics)
    _forwardWorld.copy(_FORWARD_LOCAL).applyQuaternion(this.quaternion).normalize();
    _rightWorld.copy(_AXIS_X).applyQuaternion(this.quaternion).normalize();
    _upWorld.copy(_AXIS_Y).applyQuaternion(this.quaternion).normalize();

    const currentForwardSpeed = this.velocity.dot(_forwardWorld);
    const effectiveMaxSpeed = isBoosting
      ? profile.maxSpeed * profile.boostMultiplier
      : profile.maxSpeed;

    let nextForwardSpeed = currentForwardSpeed;
    let throttle = 0;

    if (isBoosting) {
      throttle = 1;
      const boostAccel = profile.acceleration * profile.boostAccelMultiplier;
      nextForwardSpeed = Math.min(effectiveMaxSpeed, currentForwardSpeed + boostAccel * safeDt);
    } else if (input.forward && !input.backward) {
      throttle = 1;
      if (currentForwardSpeed > profile.maxSpeed) {
        nextForwardSpeed = THREE.MathUtils.damp(currentForwardSpeed, profile.maxSpeed, 2.2, safeDt);
      } else {
        nextForwardSpeed = Math.min(
          profile.maxSpeed,
          currentForwardSpeed + profile.acceleration * safeDt,
        );
      }
    } else if (input.backward && !input.forward) {
      throttle = -1;
      nextForwardSpeed = Math.max(
        -profile.maxReverseSpeed,
        currentForwardSpeed - profile.deceleration * safeDt,
      );
    } else {
      const dragFactor = Math.exp(-profile.passiveDrag * safeDt);
      nextForwardSpeed = currentForwardSpeed * dragFactor;
      if (Math.abs(nextForwardSpeed) < 0.15) nextForwardSpeed = 0;
    }

    _desiredVel.copy(_forwardWorld).multiplyScalar(nextForwardSpeed);
    const gripLambda = isBoosting ? profile.lateralGrip * 1.45 : profile.lateralGrip;
    const gripAlpha = 1 - Math.exp(-gripLambda * safeDt);
    this.velocity.lerp(_desiredVel, gripAlpha);

    const updatedForward = this.velocity.dot(_forwardWorld);
    this.velocity.addScaledVector(_forwardWorld, nextForwardSpeed - updatedForward);

    this.position.addScaledVector(this.velocity, safeDt);

    // 10. Populate live HUD telemetry (in-place mutation, zero allocations)
    const speedMag = this.velocity.length();
    const signedSpeed = this.velocity.dot(_forwardWorld);

    _euler.setFromQuaternion(this.quaternion, 'YXZ');
    let headingDeg = THREE.MathUtils.radToDeg(-_euler.y) % 360;
    if (headingDeg < 0) headingDeg += 360;

    let status: FlightStatus = 'DRIFTING';
    if (this.boostLockedOut && input.boost) {
      status = 'BOOST DEPLETED';
    } else if (isBoosting) {
      status = 'BOOSTING';
    } else if (signedSpeed < -2.5) {
      status = 'REVERSING';
    } else if (input.forward) {
      status = speedMag > profile.maxSpeed * 0.9 ? 'CRUISING' : 'ACCELERATING';
    } else if (speedMag < 2) {
      status = 'STANDBY';
    } else {
      status = 'DRIFTING';
    }

    telemetry.speed = speedMag;
    telemetry.signedSpeed = signedSpeed;
    telemetry.maxSpeed = profile.maxSpeed;
    telemetry.effectiveMaxSpeed = effectiveMaxSpeed;
    telemetry.throttle = throttle;
    telemetry.boostEnergy = this.boostEnergy;
    telemetry.maxBoostEnergy = profile.maxBoostEnergy;
    telemetry.isBoosting = isBoosting;
    telemetry.boostDepleted = this.boostLockedOut;
    telemetry.boostIntensity = this.boostIntensity;
    telemetry.hull = this.hull;
    telemetry.maxHull = this.ship.maxHull;
    telemetry.yawRate = THREE.MathUtils.clamp(this.yawVelocity / profile.yawSpeed, -1.5, 1.5);
    telemetry.pitchRate = THREE.MathUtils.clamp(this.pitchVelocity / profile.pitchSpeed, -1.5, 1.5);
    telemetry.rollRate = THREE.MathUtils.clamp(this.rollVelocity / profile.rollSpeed, -1, 1);
    telemetry.aimNormalizedX = this.aimCursorX;
    telemetry.aimNormalizedY = this.aimCursorY;
    telemetry.aimScreenX = this.reticlePosition.screenX;
    telemetry.aimScreenY = this.reticlePosition.screenY;
    telemetry.virtualMouseScreenX = 0.5 + this.virtualMouse.x / vw;
    telemetry.virtualMouseScreenY = 0.5 + this.virtualMouse.y / vh;
    telemetry.alignmentErrorPx = this.steeringMode === 'mouse-alignment' ? this.steeringError.magnitude : 0;
    telemetry.aimBoundaryWidthPx = this.aimBoundary.widthPx;
    telemetry.aimBoundaryHeightPx = this.aimBoundary.heightPx;
    telemetry.viewportWidthPx = vw;
    telemetry.viewportHeightPx = vh;
    telemetry.aimBoundaryCornerRadiusPx = this.aimBoundary.cornerRadiusPx;
    telemetry.joystickRadialMagnitude = this.joystickEval.radialMagnitude;
    telemetry.steeringOutputX = this.joystickEval.steerX;
    telemetry.steeringOutputY = this.joystickEval.steerY;
    telemetry.steeringZone = this.joystickEval.zone;
    telemetry.headingDeg = headingDeg;
    telemetry.pitchDeg = THREE.MathUtils.radToDeg(_euler.x);
    telemetry.rollDeg = THREE.MathUtils.radToDeg(_euler.z);
    telemetry.altitude = this.position.y;
    telemetry.status = status;
    telemetry.pointerLocked = input.pointerLocked;
  }
}
