import * as THREE from 'three';
import { STEERING_CONFIG } from '../config/steering';
import { WEAPON_CONFIGS } from '../config/weapons';
import { clampToRoundedRect, computeRoundedRectBoundary, createRoundedRectBoundary, createRoundedRectClampResult } from './AimBoundary';
import type { GameSettings } from '../types/game';
import type { FlightController } from './FlightController';

// Pre-allocated math scratch objects
const _offsetLocal = new THREE.Vector3();
const _desiredPos = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _lookMatrix = new THREE.Matrix4();
const _desiredQuat = new THREE.Quaternion();
const _shakeVec = new THREE.Vector3();
const _shipLocalDelta = new THREE.Quaternion();
const _rollDelta = new THREE.Quaternion();
const _shipInverse = new THREE.Quaternion();
const _swingDelta = new THREE.Quaternion();
const _partialDelta = new THREE.Quaternion();
const _identityQuat = new THREE.Quaternion();
const _rollInverse = new THREE.Quaternion();
const _aimPoint = new THREE.Vector3();
const _aimLocal = new THREE.Vector3();
const _desiredLocal = new THREE.Vector3();
const _correction = new THREE.Quaternion();
const _boundaryClamp = createRoundedRectClampResult();
const _cameraBoundary = createRoundedRectBoundary();

/**
 * Third-person chase camera with smooth positional & rotational tracking,
 * subtle turn lag, dynamic boost FOV widening, and menu/hangar showcase orbits.
 */
export class CameraController {
  private readonly currentPos = new THREE.Vector3(0, 16, 52);
  private readonly currentQuat = new THREE.Quaternion();
  private readonly cameraLocalQuat = new THREE.Quaternion();
  private readonly lastShipQuat = new THREE.Quaternion();
  private currentFov = 62;
  private initialized = false;
  private orbitTime = 0;

  public snapToShip(flight: FlightController, camera: THREE.PerspectiveCamera, distance: number): void {
    _offsetLocal.set(0, 2.35, distance).applyQuaternion(flight.quaternion);
    this.currentPos.copy(flight.position).add(_offsetLocal);

    _forward.set(0, 0, -1).applyQuaternion(flight.quaternion);
    _up.set(0, 1, 0).applyQuaternion(flight.quaternion);
    _lookTarget.copy(flight.position).addScaledVector(_forward, 24).addScaledVector(_up, 0.85);
    _lookMatrix.lookAt(this.currentPos, _lookTarget, _up);
    _desiredQuat.setFromRotationMatrix(_lookMatrix);
    this.currentQuat.copy(_desiredQuat);
    this.cameraLocalQuat.copy(flight.quaternion).invert().multiply(this.currentQuat).normalize();
    this.lastShipQuat.copy(flight.quaternion);

    camera.position.copy(this.currentPos);
    camera.quaternion.copy(this.currentQuat);
    this.currentFov = 62;
    camera.fov = this.currentFov;
    camera.updateProjectionMatrix();
    this.initialized = true;
  }

  public updateChase(
    dt: number,
    flight: FlightController,
    camera: THREE.PerspectiveCamera,
    settings: GameSettings,
    boostIntensity: number,
    elapsedTime: number,
    combatImpulse = 0,
  ): void {
    const safeDt = Math.min(Math.max(dt, 0.0001), 0.05);

    if (!this.initialized) {
      this.snapToShip(flight, camera, settings.cameraDistance);
      return;
    }

    _forward.set(0, 0, -1).applyQuaternion(flight.quaternion).normalize();
    _up.set(0, 1, 0).applyQuaternion(flight.quaternion).normalize();
    _right.set(1, 0, 0).applyQuaternion(flight.quaternion).normalize();

    // Subtle outside-arc lateral & vertical chase offset so maneuvers feel natural without
    // fighting ship rotation. Strictly decoupled from mouse sensitivity.
    const camFollow = THREE.MathUtils.clamp(settings.cameraSensitivity, 0.6, 1.6);
    const lagX = THREE.MathUtils.clamp(flight.yawVelocity * 0.18, -0.55, 0.55);
    const lagY = THREE.MathUtils.clamp(-flight.pitchVelocity * 0.14, -0.4, 0.4);

    // Pull back slightly on boost to emphasize acceleration
    const dynamicDist = settings.cameraDistance + boostIntensity * 1.45;
    const heightOffset = 2.25 - boostIntensity * 0.25;

    _offsetLocal.set(lagX, heightOffset + lagY, dynamicDist).applyQuaternion(flight.quaternion);
    _desiredPos.copy(flight.position).add(_offsetLocal);

    // Crisp frame-rate-independent positional follow
    const posLambda = (15.5 + boostIntensity * 3.5) * camFollow;
    const posAlpha = 1 - Math.exp(-posLambda * safeDt);
    this.currentPos.lerp(_desiredPos, posAlpha);

    // Guardrail: never allow camera to drift far from ship during fast directional changes
    const maxAllowedDist = dynamicDist + 1.8;
    const distFromShip = this.currentPos.distanceTo(flight.position);
    if (distFromShip > maxAllowedDist) {
      this.currentPos
        .sub(flight.position)
        .multiplyScalar(maxAllowedDist / distFromShip)
        .add(flight.position);
    }

    if (flight.steeringMode === 'mouse-alignment') {
      // Keep yaw/pitch follow gated during active steering so camera motion does not cancel
      // projected hull motion. Roll remains a full-strength part of ship attitude.
      // Keep camera rotation from canceling hull rotation while the real V - T error or actual
      // hull angular velocity remains significant. `alignmentRemaining` is only the gap to V
      // clamped to Boundary; it reaches zero at Boundary even while the ship still turns hard.
      const hullRate = Math.hypot(flight.yawVelocity, flight.pitchVelocity);
      const steeringActive = flight.steeringError.magnitude > 1 || hullRate > 0.05;
      const follow = steeringActive ? 0 : 0.55;
      if (steeringActive) {
        // The steering gate pauses camera heading follow, but ship roll is part of the
        // chase-camera attitude and must remain visible during mouse steering. Extract the
        // local-Z twist from the ship delta and conjugate it into world space.
        _shipLocalDelta.copy(this.lastShipQuat).invert().multiply(flight.quaternion).normalize();
        _rollDelta.set(0, 0, _shipLocalDelta.z, _shipLocalDelta.w).normalize();
        _rollInverse.copy(_rollDelta).invert();
        _swingDelta.copy(_shipLocalDelta).multiply(_rollInverse).normalize();
        _shipInverse.copy(this.lastShipQuat).invert();
        _rollDelta.premultiply(this.lastShipQuat).multiply(_shipInverse).normalize();
        _swingDelta.premultiply(this.lastShipQuat).multiply(_shipInverse).normalize();
        this.currentQuat.premultiply(_rollDelta).normalize();
        _partialDelta.copy(_identityQuat).slerp(_swingDelta, follow);
        this.currentQuat.premultiply(_partialDelta).normalize();
      } else {
        _shipLocalDelta.copy(this.lastShipQuat).invert().multiply(flight.quaternion).normalize();
        _rollDelta.set(0, 0, _shipLocalDelta.z, _shipLocalDelta.w).normalize();
        _rollInverse.copy(_rollDelta).invert();
        _swingDelta.copy(_shipLocalDelta).multiply(_rollInverse).normalize();
        _shipInverse.copy(this.lastShipQuat).invert();
        _rollDelta.premultiply(this.lastShipQuat).multiply(_shipInverse).normalize();
        _swingDelta.premultiply(this.lastShipQuat).multiply(_shipInverse).normalize();
        this.currentQuat.premultiply(_rollDelta).normalize();
        _partialDelta.copy(_identityQuat).slerp(_swingDelta, follow);
        this.currentQuat.premultiply(_partialDelta).normalize();
      }
      this.lastShipQuat.copy(flight.quaternion);
    } else {
      _desiredQuat.copy(flight.quaternion).multiply(this.cameraLocalQuat).normalize();
      this.currentQuat.copy(_desiredQuat);
      this.lastShipQuat.copy(flight.quaternion);
    }

    // Subtle high-frequency propulsion tremor during boost + brief combat impact impulse
    camera.position.copy(this.currentPos);
    const tremor = boostIntensity * 0.042 + combatImpulse * 0.14;
    if (tremor > 0.004) {
      _shakeVec
        .set(
          Math.sin(elapsedTime * 57.0) * tremor,
          Math.cos(elapsedTime * 67.0) * tremor,
          0,
        )
        .applyQuaternion(this.currentQuat);
      camera.position.add(_shakeVec);
    }

    camera.quaternion.copy(this.currentQuat);

    // Dynamic boost FOV widening
    const targetFov = 62 + boostIntensity * 16.5;
    const nextFov = THREE.MathUtils.damp(this.currentFov, targetFov, 7.0, safeDt);
    if (Math.abs(nextFov - this.currentFov) > 0.01) {
      this.currentFov = nextFov;
      camera.fov = this.currentFov;
      camera.updateProjectionMatrix();
    }

    if (flight.steeringMode === 'mouse-alignment') {
      const boundary = computeRoundedRectBoundary(
        flight.aimBoundary.viewportWidth, flight.aimBoundary.viewportHeight, settings.joystickRadius,
        STEERING_CONFIG.aimBoundaryWidth, STEERING_CONFIG.aimBoundaryHeight,
        STEERING_CONFIG.aimBoundaryCornerRadius, _cameraBoundary,
      );
      this.constrainAimProjection(flight, camera, boundary);
    }
  }

  private constrainAimProjection(
    flight: FlightController, camera: THREE.PerspectiveCamera, boundary: typeof _cameraBoundary,
  ): void {
    // Constrain the physical projection by rotating the camera, not the cannon or HUD.
    camera.updateMatrixWorld();
    flight.getAimTargetPoint(_aimPoint, WEAPON_CONFIGS.player_pulse_twin.convergenceDistance);
    _aimLocal.copy(_aimPoint).applyMatrix4(camera.matrixWorldInverse);
    _aimPoint.project(camera);
    const behind = _aimLocal.z >= -1e-6;
    // Use camera-space bearing for points at/behind the eye; projecting them would mirror
    // or produce NaNs on the camera plane. Exactly behind has no unique edge: choose right.
    const bearing = Math.hypot(_aimLocal.x, _aimLocal.y);
    const x = behind ? (bearing > 1e-9 ? _aimLocal.x / bearing * 1e6 : 1e6)
      : _aimPoint.x * boundary.viewportWidth * 0.5;
    const y = behind ? (bearing > 1e-9 ? -_aimLocal.y / bearing * 1e6 : 0)
      : -_aimPoint.y * boundary.viewportHeight * 0.5;
    clampToRoundedRect(x, y, boundary, _boundaryClamp);
    if (behind || !_boundaryClamp.inside) {
      // A small interior margin absorbs floating point roundoff at the boundary.
      const cx = _boundaryClamp.clampedX * 0.99999;
      const cy = _boundaryClamp.clampedY * 0.99999;
      _desiredLocal.set(2 * cx / boundary.viewportWidth, -2 * cy / boundary.viewportHeight, 0.5)
        .applyMatrix4(camera.projectionMatrixInverse).normalize();
      // The correction maps the desired camera-local bearing onto the current world aim
      // bearing; post-multiplying camera orientation therefore places the aim on desiredLocal.
      _correction.setFromUnitVectors(_desiredLocal, _aimLocal.normalize());
      this.currentQuat.multiply(_correction).normalize();
      camera.quaternion.copy(this.currentQuat);
      camera.updateMatrixWorld();
    }
  }

  /**
   * Cinematic showcase camera used on the Main Menu and Hangar screens.
   */
  public updateShowcase(
    dt: number,
    targetPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    mode: 'menu' | 'hangar',
    manualYawOffset = 0,
    manualPitchOffset = 0,
  ): void {
    const safeDt = Math.min(Math.max(dt, 0.0001), 0.05);
    this.orbitTime += safeDt * (mode === 'hangar' ? 0.13 : 0.14);

    const radius = mode === 'hangar' ? 10.2 : 11.4;
    const angle = (mode === 'hangar' ? 0.68 : 0.55) + this.orbitTime + manualYawOffset;
    const elevation =
      mode === 'hangar'
        ? THREE.MathUtils.clamp(2.15 + manualPitchOffset * 4.0, -1.35, 5.1)
        : 2.8 + Math.sin(this.orbitTime * 0.7) * 0.7;

    _desiredPos.set(
      targetPos.x + Math.sin(angle) * radius,
      targetPos.y + elevation,
      targetPos.z + Math.cos(angle) * radius,
    );

    const alpha = 1 - Math.exp(-4.8 * safeDt);
    this.currentPos.lerp(_desiredPos, alpha);

    if (mode === 'hangar') {
      // Frame the spacecraft cleanly in the unobstructed showcase region:
      // on wide desktop viewports shift look-target along camera-right so the ship centers
      // to the left of the inspector panel; on narrow screens shift down slightly so it
      // sits cleanly above the bottom drawer.
      const isWideDesktop = camera.aspect > 1.25;
      const rightOffset = isWideDesktop ? 1.55 : 0;
      const verticalOffset = isWideDesktop ? 0.1 : -0.6;
      const camRightX = Math.cos(angle);
      const camRightZ = -Math.sin(angle);
      _lookTarget.set(
        targetPos.x + camRightX * rightOffset,
        targetPos.y + verticalOffset,
        targetPos.z + camRightZ * rightOffset,
      );
    } else {
      // Offset slightly right on menu so the fighter frames beautifully beside left-aligned menu actions
      _lookTarget.set(targetPos.x - 2.2, targetPos.y + 0.25, targetPos.z);
    }

    _lookMatrix.lookAt(this.currentPos, _lookTarget, _up.set(0, 1, 0));
    _desiredQuat.setFromRotationMatrix(_lookMatrix);
    this.currentQuat.slerp(_desiredQuat, alpha);

    camera.position.copy(this.currentPos);
    camera.quaternion.copy(this.currentQuat);

    const targetFov = mode === 'hangar' ? 44 : 52;
    const nextFov = THREE.MathUtils.damp(this.currentFov, targetFov, 5.0, safeDt);
    if (Math.abs(nextFov - this.currentFov) > 0.01) {
      this.currentFov = nextFov;
      camera.fov = this.currentFov;
      camera.updateProjectionMatrix();
    }
    this.initialized = false;
  }
}
